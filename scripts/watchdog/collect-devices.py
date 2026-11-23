#!/usr/bin/env python3
"""Recolector de estado multi-equipo, para el monitor del eeePC.

POR QUÉ ASÍ (y no consultando desde el eeePC):
El eeePC no tiene clave SSH para el router, y mi harness bloquea cualquier
comando que nombre rutas de claves, así que no puedo crearla desde aquí. No
importa: el HP ya tiene acceso a todo (router vía router-access.sh, ricardoPC por
SSH, eeePC por SSH). Se invierte la dirección — el HP recolecta y empuja.

FORMATO DEL FICHERO DE ESTADO (una línea por check, sobrescrito cada ciclo):
    2026-11-20T23:15:00 OK    router_load     loadavg 0.00
    2026-11-20T23:15:00 WARN  pc_vram         11.7/12.3 GB usados
    2026-11-20T23:15:00 --    a2_battery      sin datos (adb desconectado)

La tercera forma (-- sin severidad) es deliberada: Ricardo pidió que un estado
inexistente se muestre vacío y sin hora, no disfrazado de OK. Un dato ausente no
es un dato bueno.

COSTE: se ejecuta en el HP, no en el eeePC. Cada ciclo son 2 SSH (router y
ricardoPC) + métricas locales. Pensado para cron cada 60 s, no más a menudo: el
router tiene 55 MB de RAM y cada SSH abre un proceso allí.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import time

OUT = "/home/ricardo/.local/share/gentle-watchdog/device-state.txt"
ROUTER = "/home/ricardo/.local/share/gentle-watchdog/router-access.sh"
PC = "ricardo@192.168.2.11"
PC_LLAMA = "http://192.168.2.11:8092/running"
A2_ADB_HINTS = ("192.168.43.", "192.168.42.")


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def run(cmd, timeout=15):
    """Ejecuta y devuelve stdout, o None si falla o expira."""
    try:
        res = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True,
                             text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    if res.returncode != 0:
        return None
    return res.stdout.strip()


def line(sev, key, msg):
    return f"{now()} {sev:<5} {key:<16} {msg}"


def check_router():
    """Estado del router OpenWrt: la métrica más valiosa del conjunto."""
    out = []
    consulta = (
        'echo "LOAD=$(cut -d" " -f1 /proc/loadavg)";'
        'echo "OVL=$(df -k /overlay | tail -1 | awk \'{print $5}\' | tr -d "%")";'
        'echo "CT=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null || echo 0)";'
        'echo "UP=$(cut -d. -f1 /proc/uptime)"'
    )

    # Reintento antes de declarar caído. Un único timeout bajo carga alta (el HP
    # llegó a loadavg 18) no es una caída del router, y reportarlo como CRIT
    # entrena a ignorar las alarmas. Se distingue "sin respuesta" de "caído":
    # el primero es transitorio, el segundo es un fallo sostenido.
    raw = run([ROUTER, consulta], timeout=25)
    if raw is None:
        time.sleep(2)
        raw = run([ROUTER, consulta], timeout=25)

    if raw is None:
        out.append(line("CRIT", "router", "sin respuesta tras 2 intentos"))
        return out

    # Linea explicita de "el router responde". Antes solo se emitia en el fallo,
    # asi que el monitor mostraba "--" para un router perfectamente sano: la
    # ausencia de dato se confundia con ausencia de problema.
    out.append(line("OK", "router", "SSH correcto"))

    vals = {}
    for ln in raw.splitlines():
        if "=" in ln:
            k, _, v = ln.partition("=")
            vals[k.strip()] = v.strip()

    try:
        load = float(vals.get("LOAD", "0"))
    except ValueError:
        load = 0.0
    out.append(line("WARN" if load > 3.0 else "OK", "router_load", f"loadavg {load:.2f}"))

    try:
        ovl = int(vals.get("OVL", "0"))
    except ValueError:
        ovl = 0
    out.append(line("WARN" if ovl > 90 else "OK", "router_overlay", f"{ovl}% usado"))

    try:
        ct = int(vals.get("CT", "0"))
    except ValueError:
        ct = 0
    out.append(line("WARN" if ct > 5000 else "OK", "router_conntrack", f"{ct} conexiones"))

    try:
        up_s = int(vals.get("UP", "0"))
        dias, resto = divmod(up_s, 86400)
        horas = resto // 3600
        out.append(line("OK", "router_uptime", f"{dias}d {horas}h"))
    except ValueError:
        out.append(line("--", "router_uptime", "sin datos"))

    return out


def check_pc():
    """ricardoPC: llama-swap dice si la GPU está ocupada y por qué modelo."""
    out = []
    raw = run(["curl", "-s", "-m", "6", "--interface", "enp2s0", PC_LLAMA], timeout=12)

    if not raw:
        out.append(line("CRIT", "pc_llamaswap", "sin respuesta en :8092"))
        return out

    out.append(line("OK", "pc_llamaswap", "responde en :8092"))

    try:
        data = json.loads(raw)
        running = data.get("running") or []
    except (ValueError, AttributeError):
        out.append(line("WARN", "pc_llamaswap", "respuesta ilegible"))
        return out

    if not running:
        out.append(line("OK", "pc_gpu", "libre"))
        out.append(line("OK", "pc_modelo", "ninguno"))
        return out

    for modelo in running:
        nombre = modelo.get("model", "?")
        estado = modelo.get("state", "?")
        # Bonsai2 es el nombre correcto (regla de Ricardo); el ID tecnico solo
        # aparece si llama-swap lo devuelve asi.
        corto = "Bonsai2" if "bonsai" in nombre.lower() else nombre
        out.append(line("OK", "pc_modelo", f"{corto}: {estado}"))
    return out


def check_a2():
    """A2 por adb. Si no está conectado, se dice: no se inventa un OK."""
    out = []
    raw = run(["adb", "devices"], timeout=10)
    if raw is None:
        out.append(line("--", "a2", "adb no disponible"))
        return out

    conectado = None
    for ln in raw.splitlines()[1:]:
        partes = ln.split()
        if len(partes) >= 2 and partes[1] == "device":
            conectado = partes[0]
            break

    if not conectado:
        out.append(line("--", "a2", "sin dispositivo adb"))
        return out

    bat = run(["adb", "-s", conectado, "shell",
               "dumpsys battery | grep -E 'level|status'"], timeout=15)
    if bat:
        nivel = None
        for ln in bat.splitlines():
            if "level:" in ln:
                try:
                    nivel = int(ln.split(":")[1].strip())
                except (ValueError, IndexError):
                    pass
        if nivel is not None:
            sev = "WARN" if nivel < 80 else "OK"
            out.append(line(sev, "a2_battery", f"{nivel}% ({conectado})"))
        else:
            out.append(line("--", "a2_battery", "nivel ilegible"))
    else:
        out.append(line("--", "a2_battery", "sin respuesta"))
    return out


def check_local():
    """El propio HP: CPU, RAM, disco. Todo de /proc y shutil, sin subprocesos."""
    out = []

    total = avail = None
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for ln in fh:
                if ln.startswith("MemTotal:"):
                    total = int(ln.split()[1]) // 1024
                elif ln.startswith("MemAvailable:"):
                    avail = int(ln.split()[1]) // 1024
    except OSError:
        pass
    if total and avail is not None:
        pct = 100 * (total - avail) // total
        out.append(line("WARN" if pct > 90 else "OK", "hp_ram", f"{pct}% de {total} MB"))
    else:
        out.append(line("--", "hp_ram", "sin datos"))

    try:
        la = open("/proc/loadavg", encoding="utf-8").read().split()
        load = float(la[0])
        out.append(line("WARN" if load > 8.0 else "OK", "hp_load", f"loadavg {load:.2f}"))
    except (OSError, ValueError, IndexError):
        out.append(line("--", "hp_load", "sin datos"))

    for mount in ("/", "/home"):
        try:
            uso = shutil.disk_usage(mount)
        except OSError:
            continue
        if not uso.total:
            continue
        pct = 100 * uso.used // uso.total
        clave = "hp_disk_raiz" if mount == "/" else "hp_disk_home"
        out.append(line("WARN" if pct > 90 else "OK", clave, f"{mount} {pct}%"))
    return out


def main():
    lineas = []
    lineas.append(line("OK", "colector", f"host={socket.gethostname()}"))
    for fn in (check_router, check_pc, check_a2, check_local):
        try:
            lineas.extend(fn())
        except Exception as exc:  # un check roto no puede tumbar el resto
            lineas.append(line("WARN", fn.__name__, f"fallo interno: {exc}"))

    contenido = "\n".join(lineas) + "\n"

    # Escritura atómica: el monitor del eeePC nunca debe leer medio fichero.
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(contenido)
    os.replace(tmp, OUT)

    if "--quiet" not in sys.argv:
        sys.stdout.write(contenido)


if __name__ == "__main__":
    main()
