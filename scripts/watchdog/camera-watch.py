#!/usr/bin/env python3
"""Vigilancia por cámara con Bonsai2 — captura periódica y descarte.

FILOSOFÍA (heredada del applet Java de Ricardo, 48k, hace 25 años): no se sube
todo. Se captura cada N segundos, se comprime agresivamente, se envía, y la
imagen se DESCARTA tras la inferencia. El presupuesto de ancho de banda manda:
un día entero a 1 imagen/5s no puede pasar de unos MB.

DIFERENCIAS con el applet original, y por qué:
- Aquel subía al servidor y las rotaba en disco. Aquí no se guarda nada en disco
  salvo la última captura, y solo si se pide con --keep. Un archivo de imágenes
  de una cámara es un problema de privacidad y de espacio.
- Aquí el consumo no es ancho de banda de subida a internet, es un salto de LAN:
  el coste real es la GPU, que ya está ocupada con Bonsai2.

CÓMO CAPTURA: `screencap` del teléfono con la app de cámara abierta en
previsualización. Es un apaño consciente: Android no permite capturar la cámara
por adb sin root. Está documentado para que nadie lo confunda con una foto real
de la cámara.

USO:
  camera-watch.py --once              # una captura y análisis
  camera-watch.py --interval 30       # bucle cada 30 s
  camera-watch.py --interval 30 --keep /tmp/shots   # guarda las capturas
"""

import argparse
import base64
import io
import os
import subprocess
import sys
import time

ADB_SERIAL = "192.168.43.233:5555"
LLAMA_URL = "http://127.0.0.1:8096/v1/chat/completions"
MODEL = "bonsai2-TernaryL-27B"
MAX_WIDTH = 512          # imágenes pequeñas: menos datos y menos VRAM
JPEG_QUALITY = 55        # agresivo a propósito: es vigilancia, no fotografía
MAX_TOKENS = 200         # respuestas cortas: menos GPU por ciclo

PROMPT = (
    "Describe en una sola frase qué se ve en esta imagen. "
    "Si hay personas, di cuántas y qué hacen, sin identificarlas. "
    "Si la imagen está vacía o es una pantalla en negro, dilo."
)


def screencap(serial):
    """Captura la pantalla del teléfono como PNG en memoria."""
    try:
        res = subprocess.run(
            ["adb", "-s", serial, "exec-out", "screencap", "-p"],
            capture_output=True, timeout=25,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"ERROR captura: {exc}", file=sys.stderr)
        return None
    if res.returncode != 0 or not res.stdout:
        print(f"ERROR captura: rc={res.returncode}", file=sys.stderr)
        return None
    return res.stdout


def compress(png_bytes, max_width=MAX_WIDTH, quality=JPEG_QUALITY):
    """Reduce y recomprime. Devuelve (jpeg_bytes, ancho, alto) o None."""
    try:
        from PIL import Image
    except ImportError:
        print("ERROR: falta Pillow (python3-pil)", file=sys.stderr)
        return None

    try:
        img = Image.open(io.BytesIO(png_bytes))
    except OSError as exc:
        print(f"ERROR decodificando: {exc}", file=sys.stderr)
        return None

    if img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, int(img.height * ratio)))

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue(), img.width, img.height


def ask_bonsai(jpeg_bytes):
    """Envía la imagen a Bonsai2 y devuelve su descripción."""
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")
    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "temperature": 0.2,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ],
        }],
    }

    import json
    try:
        res = subprocess.run(
            ["curl", "-s", "-m", "90", "-H", "Content-Type: application/json",
             "-d", json.dumps(payload), LLAMA_URL],
            capture_output=True, text=True, timeout=100,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"ERROR inferencia: {exc}", file=sys.stderr)
        return None

    if res.returncode != 0 or not res.stdout:
        print(f"ERROR inferencia: rc={res.returncode}", file=sys.stderr)
        return None

    try:
        data = json.loads(res.stdout)
        msg = data["choices"][0]["message"]
        # Bonsai2 es un modelo de razonamiento: puede devolver reasoning_content
        # y dejar content vacío. Se prefiere content y se cae a reasoning.
        return (msg.get("content") or "").strip() or \
               (msg.get("reasoning_content") or "").strip() or None
    except (ValueError, KeyError, IndexError) as exc:
        print(f"ERROR parseando respuesta: {exc}", file=sys.stderr)
        return None


def cycle(serial, keep_dir=None):
    png = screencap(serial)
    if png is None:
        return False

    compressed = compress(png)
    if compressed is None:
        return False
    jpeg, w, h = compressed

    stamp = time.strftime("%Y%m%d-%H%M%S")

    if keep_dir:
        os.makedirs(keep_dir, exist_ok=True)
        path = os.path.join(keep_dir, f"{stamp}.jpg")
        try:
            with open(path, "wb") as fh:
                fh.write(jpeg)
        except OSError as exc:
            print(f"AVISO no se pudo guardar: {exc}", file=sys.stderr)

    print(f"[{stamp}] captura {w}x{h} {len(jpeg)/1024:.1f} KB -> Bonsai2...")

    answer = ask_bonsai(jpeg)
    if answer is None:
        print("  sin respuesta")
        return False

    # Una línea, sin saltos: el log debe poder leerse de un vistazo.
    print(f"  {answer.replace(chr(10), ' ')[:300]}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=0)
    ap.add_argument("--serial", default=ADB_SERIAL)
    ap.add_argument("--keep", default=None,
                    help="directorio donde conservar las capturas (por defecto: no se guardan)")
    args = ap.parse_args()

    if args.once:
        sys.exit(0 if cycle(args.serial, args.keep) else 1)

    if args.interval <= 0:
        ap.error("usa --once o --interval N")

    try:
        while True:
            cycle(args.serial, args.keep)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nparado")


if __name__ == "__main__":
    main()
