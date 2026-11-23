#!/usr/bin/env python3
"""Monitor de estado para la tty1 del miniPC (eeePC).

POR QUÉ EXISTE: Ricardo quiere ver el estado de todos los equipos en la pantalla
del login, sin escritorio. Esta máquina es un Atom N270 de 2008 con 2 GB de RAM.

RESTRICCIÓN DE PANTALLA (2026-11-21): el framebuffer es 1024x600, así que en una
sola columna el contenido desborda. El render es ADAPTABLE: mide filas/columnas
reales del terminal y, si no caben en una columna, reparte en dos. Nunca asume un
tamaño fijo.

FILOSOFÍA DE FALLOS: si algo no se puede leer se muestra "--" sin color, no un
verde optimista. Un dato ausente no es un dato bueno.
"""

import glob
import os
import shutil
import socket
import sys
import time

STATE_FILE = "/home/telfmng/device-state.txt"
REFRESH_SECONDS = 5

# Etiquetas de las claves que produce collect-devices.py. El orden importa:
# es el orden en que se muestran.
LABELS = [
    ("colector", "Recolector"),
    ("router", "Router (SSH)"),
    ("router_load", "Router carga"),
    ("router_overlay", "Router overlay"),
    ("router_conntrack", "Router conexiones"),
    ("router_uptime", "Router encendido"),
    ("pc_llamaswap", "ricardoPC :8092"),
    ("pc_gpu", "GPU libre"),
    ("pc_modelo", "Modelo en GPU"),
    ("a2", "A2 (adb)"),
    ("a2_battery", "A2 bateria"),
    ("hp_ram", "HP RAM"),
    ("hp_load", "HP carga"),
    ("hp_disk_raiz", "HP disco /"),
    ("hp_disk_home", "HP disco /home"),
]

if os.environ.get("TERM", "linux") in ("dumb", ""):
    RED = GREEN = YELLOW = CYAN = BOLD = DIM = RESET = ""
else:
    RED, GREEN, YELLOW = "\033[31m", "\033[32m", "\033[33m"
    CYAN, BOLD, DIM = "\033[36m", "\033[1m", "\033[2m"
    RESET = "\033[0m"


def read_first_line(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.readline().strip()
    except OSError:
        return None


def terminal_size():
    """Filas y columnas reales del terminal. 24x80 es el fallback conservador."""
    try:
        size = os.get_terminal_size(sys.stdout.fileno())
        return size.lines, size.columns
    except OSError:
        return 24, 80


def cpu_times():
    line = read_first_line("/proc/stat")
    if not line or not line.startswith("cpu "):
        return None
    try:
        values = [int(p) for p in line.split()[1:]]
    except ValueError:
        return None
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return idle, sum(values)


def meminfo():
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            data = fh.read()
    except OSError:
        return None, None
    total = avail = None
    for line in data.splitlines():
        if line.startswith("MemTotal:"):
            total = int(line.split()[1]) // 1024
        elif line.startswith("MemAvailable:"):
            avail = int(line.split()[1]) // 1024
    return total, avail


def loadavg():
    raw = read_first_line("/proc/loadavg")
    return raw.split()[:3] if raw else None


def temperature():
    for path in sorted(glob.glob("/sys/class/thermal/thermal_zone*/temp")):
        val = read_first_line(path)
        if not val:
            continue
        try:
            celsius = int(val) / 1000.0
        except ValueError:
            continue
        if 0 < celsius < 120:
            return celsius
    return None


def uptime_text():
    raw = read_first_line("/proc/uptime")
    if not raw:
        return "n/d"
    try:
        seconds = int(float(raw.split()[0]))
    except (ValueError, IndexError):
        return "n/d"
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def device_state():
    """Lee el fichero que empuja el HP: "ts SEV clave mensaje" por línea."""
    try:
        with open(STATE_FILE, "r", encoding="utf-8", errors="replace") as fh:
            lines = [ln.rstrip() for ln in fh if ln.strip()]
    except OSError:
        return {}
    estado = {}
    for ln in lines:
        partes = ln.split(None, 3)
        if len(partes) < 3:
            continue
        ts, sev, clave = partes[0], partes[1], partes[2]
        estado[clave] = (sev, ts)
    return estado


def bar(pct, width=16):
    filled = min(width, max(0, int(width * pct / 100)))
    return "[" + "#" * filled + "." * (width - filled) + "]"


def colour_for(pct, warn, crit):
    if pct >= crit:
        return RED
    if pct >= warn:
        return YELLOW
    return GREEN


def short_time(ts):
    """De 2026-11-21T00:10:02 saca "21/11 00:10"."""
    if "T" not in ts or len(ts) < 16:
        return ts
    fecha, hora = ts.split("T", 1)
    partes = fecha.split("-")
    if len(partes) != 3:
        return ts
    return f"{partes[2]}/{partes[1]} {hora[:5]}"


def severity_mark(sev):
    """Devuelve (texto, color) para una severidad. Sin sev => sin dato."""
    if sev in ("", "--"):
        return None, DIM
    if sev == "CRIT":
        return "CRIT", RED
    if sev == "WARN":
        return "WARN", YELLOW
    if sev == "OK":
        return " OK ", GREEN
    return sev[:4], DIM


def build_blocks(prev_cpu):
    """Construye bloques lógicos; el layout decide luego cómo colocarlos."""
    times = cpu_times()
    cpu_pct = 0.0
    if times and prev_cpu:
        d_idle = times[0] - prev_cpu[0]
        d_total = times[1] - prev_cpu[1]
        if d_total > 0:
            cpu_pct = 100.0 * (d_total - d_idle) / d_total

    local = []
    c = colour_for(cpu_pct, 70, 90)
    local.append(f"{BOLD}CPU {RESET}{c}{bar(cpu_pct)}{RESET} {cpu_pct:4.0f}%")

    total, avail = meminfo()
    if total:
        pct = 100 * (total - avail) // total
        c = colour_for(pct, 75, 90)
        local.append(f"{BOLD}RAM {RESET}{c}{bar(pct)}{RESET} {pct:3d}% {DIM}{total - avail}/{total}M{RESET}")
    else:
        local.append(f"{BOLD}RAM {RESET}n/d")

    for mount, clave in (("/", "raiz"), ("/home", "home")):
        try:
            uso = shutil.disk_usage(mount)
        except OSError:
            continue
        if not uso.total:
            continue
        pct = 100 * uso.used // uso.total
        c = colour_for(pct, 85, 95)
        libre = uso.free / (1024 ** 3)
        local.append(f"{BOLD}DISK{RESET}{c}{bar(pct, 12)}{RESET}{pct:3d}% {DIM}{mount} {libre:.1f}G{RESET}")

    la = loadavg()
    if la:
        c = colour_for(float(la[0]) * 50, 90, 130)
        local.append(f"{BOLD}LOAD{RESET} {c}{la[0]}{RESET}")

    temp = temperature()
    if temp is not None:
        c = colour_for(temp, 70, 85)
        local.append(f"{BOLD}TEMP{RESET} {c}{temp:.0f}C{RESET}")

    # Estado de los equipos remotos
    remoto = []
    estado = device_state()
    for clave, etiqueta in LABELS:
        sev, ts = estado.get(clave, ("", ""))
        marca, col = severity_mark(sev)
        if marca is None:
            remoto.append(f"  {DIM}{etiqueta:<17}  --{RESET}")
        else:
            remoto.append(f"  {col}[{marca}]{RESET} {etiqueta:<17} {DIM}{short_time(ts)}{RESET}")

    return local, remoto, times


def render(prev_cpu):
    rows, cols = terminal_size()
    local, remoto, times = build_blocks(prev_cpu)

    header = []
    header.append(f"{BOLD}MONITOR{RESET} {DIM}{socket.gethostname()}{RESET}")
    header.append(f"{DIM}{time.strftime('%d/%m %H:%M:%S')} up {uptime_text()}{RESET}")
    # La cabecera de dos lineas solo se usa si hay sitio holgado; en pantallas
    # cortas se compacta a una, que es lo que permite que los remotos quepan.

    # ¿Cabe todo en una columna? Se reservan filas para el pie y un margen:
    # la consola real del eeePC mide 37x128, y sin margen el contenido de 40
    # lineas desborda por arriba (la primera linea desaparece de la pantalla).
    reservado_pie = 2
    margen = 1
    total_lineas = (
        len(header) + 1          # cabecera + linea en blanco
        + 1 + len(local)         # rotulo LOCAL + metricas
        + 1 + 1 + len(remoto)    # blanco, rotulo EQUIPOS, filas
        + reservado_pie
    )
    usa_dos_columnas = total_lineas + margen > rows

    out = []
    out.extend(header)
    out.append("")

    if usa_dos_columnas:
        # Cabecera compacta: una linea en vez de dos.
        out = [f"{BOLD}MONITOR{RESET} {DIM}{socket.gethostname()} "
               f"{time.strftime('%d/%m %H:%M')} up {uptime_text()}{RESET}", ""]
        # Columna izquierda: métricas locales. Derecha: equipos.
        ancho_izq = 30
        max_filas = max(len(local), len(remoto))
        for i in range(max_filas):
            izq = local[i] if i < len(local) else ""
            der = remoto[i] if i < len(remoto) else ""
            # Relleno visible: contar sin códigos ANSI
            plano = izq
            while "\033" in plano:
                ini = plano.index("\033")
                fin = plano.index("m", ini) + 1
                plano = plano[:ini] + plano[fin:]
            pad = " " * max(0, ancho_izq - len(plano))
            out.append(f"{izq}{pad}{der}")
    else:
        out.append(f"{BOLD}LOCAL{RESET}")
        out.extend(local)
        out.append("")
        out.append(f"{BOLD}EQUIPOS{RESET} {DIM}(perroGuardian){RESET}")
        out.extend(remoto)

    # Pie, solo si queda sitio
    if len(out) + 2 <= rows:
        out.append("")
        out.append(f"{DIM}Ctrl+Alt+F7 escritorio{RESET}")

    return "\n".join(out), times


def main():
    prev = cpu_times()
    sys.stdout.write("\033[?25l")
    try:
        while True:
            if prev is None:
                time.sleep(REFRESH_SECONDS)
                prev = cpu_times()
                continue
            screen, prev = render(prev)
            sys.stdout.write("\033[H\033[2J")
            sys.stdout.write(screen + "\n")
            sys.stdout.flush()
            time.sleep(REFRESH_SECONDS)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[?25h\033[0m\n")


if __name__ == "__main__":
    main()
