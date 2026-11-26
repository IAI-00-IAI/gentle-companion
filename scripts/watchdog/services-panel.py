#!/usr/bin/env python3
"""Generate the services panel: what is listening, where, and who owns it.

Why a web panel and not the eeePC monitor: the tty1 monitor is bounded by a 1024x600
framebuffer and by a 1 KB file pushed once a minute. A page has neither limit, so the
full inventory fits and stays readable. The eeePC monitor is untouched on purpose.

Why the process name is not always available: without root, `ss -ltnp` resolves the
owning process only for sockets belonging to this user. nginx, sshd, rpcbind, nfsd,
cupsd and Webmin are root-owned and arrive with no process name. Claiming "unknown"
for all of them would leave the most important half of the board grey, so a small
explicit catalog names the ports whose owner cannot be read. Anything outside the
catalog stays unknown — the catalog is a claim, not a guess, and every entry in it is
one that was verified listening while this file was written.

State is decided by exit code, never by text:
    0  unit active
    3  unit exists but is not running
    4  no such unit        -> "sin unidad", NEVER "parado"
Measured: ssh.service returns 3 while ssh.socket is what listens, so text reading
would have called SSH stopped while it is serving.

Usage:
    services-panel.py                # write the HTML and print a summary
    services-panel.py --stdout       # print the HTML, write nothing
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

TEMPLATE = Path(__file__).with_name("services-panel.html")
OUTPUT = Path("/home/ricardo/servidor/sites/dev/servicios/index.html")

# Ports whose owner cannot be read without root. Verified listening on 2026-11-26.
# A port present here but no longer listening simply does not appear: the catalog
# names what is there, it never invents a service.
CATALOG = {
    22: ("OpenSSH", "Acceso remoto a esta máquina"),
    53: ("resolved", "Resolución de nombres local"),
    80: ("nginx", "Portal torre-nueva.net y sitios por subdominio"),
    111: ("rpcbind", "Mapa de puertos NFS"),
    631: ("CUPS", "Servicio de impresión"),
    2049: ("NFS", "Sistema de ficheros en red"),
    10000: ("Webmin", "Administración del sistema"),
    20241: ("cloudflared", "Métricas del túnel de Cloudflare"),
    8420: ("KOS kb", "Corpus navegable del proyecto KOS"),
    8788: ("mistral-gateway", "Pasarela de modelos del equipo"),
    9800: ("fluidsynth", "Sintetizador de audio (sesión de escritorio)"),
}

# Roles that make a port interesting to a reader, else it goes to "hidden" if the
# process is unknown. Keyed by process-name fragment, matched case-insensitively.
ROLE = {
    "nginx": ("web", "Servidor web principal"),
    "gentle-companion": ("web", "Companion: sesiones de agente desde el móvil"),
    "gentle-companio": ("web", "Companion: sesiones de agente desde el móvil"),
    "http.server": ("web", "KOS kb: corpus navegable"),
    "python3": ("web", "Servicio Python local"),
    "canvas": ("web", "Canvas de diseño"),
    "webmin": ("web", "Administración del sistema"),
    "engram": ("agents", "Memoria persistente del equipo"),
    "gateway": ("agents", "Pasarela de modelos"),
    "cloudflared": ("agents", "Métricas del túnel"),
    "sshd": ("system", "Acceso remoto"),
    "rpcbind": ("system", "Mapa de puertos NFS"),
    "nfsd": ("system", "Sistema de ficheros en red"),
    "cupsd": ("system", "Servicio de impresión"),
    "resolved": ("system", "Resolución de nombres"),
    "openssh": ("system", "Acceso remoto a esta máquina"),
    "kos": ("web", "Corpus navegable del proyecto KOS"),
    "mistral-gateway": ("agents", "Pasarela de modelos del equipo"),
    "nfs": ("system", "Sistema de ficheros en red"),
    "cups": ("system", "Servicio de impresión"),
    "fluidsynth": ("system", "Sintetizador de audio (sesión de escritorio)"),
}

# The one place that knows the unit behind a port. Absent means no unit to ask about.
UNITS = {
    80: "nginx.service",
    43721: "pi-companion.service",
    43722: "pi-companion.service",
    43723: "pi-companion.service",
    8788: "mistral-gateway.service",
    10000: "webmin.service",
    22: "ssh.socket",
    111: "rpcbind.service",
    2049: "nfs-server.service",
    631: "cups.service",
    53: "systemd-resolved.service",
    20241: "cloudflared.service",
}

# Verified with a real HTTP request on 2026-11-26. Only what answered is linked:
# a link that 404s is worse than no link, and dev.torre-nueva.net is deliberately
# absent because its vhost is not installed yet.
LINKS = {
    80: "http://torre-nueva.net/",
    43722: "http://companion.torre-nueva.net/",
    43723: "https://127.0.0.1:43723/",
    8420: "http://torre-nueva.net/kos/",
    10000: "https://127.0.0.1:10000/",
}

# Ports that belong to projects but were not listening when measured. Declaring them
# is the whole point: an absent canvas is a fact a reader needs, and silence about a
# service nobody declared is exactly how "it stopped working" goes unnoticed.
DECLARED = {
    42071: ("Canvas de diseño", "Board de diseño (PINTO)", "web"),
    9911: ("Daemon dev", "Instancia dev del daemon (PINTO)", "web"),
    9912: ("Daemon dev TLS", "Instancia dev, HTTPS (PINTO)", "web"),
}

GROUPS = {
    "web": ("Web y documentos", "Lo que se abre en un navegador y se lee."),
    "agents": ("Servicios de agentes", "Lo que sostiene el trabajo del equipo."),
    "system": ("Sistema", "Material de la máquina, no de los proyectos."),
    "unknown": ("Sin identificar", "Escucha, pero no se puede decir qué es."),
}


def listening() -> list[dict]:
    """Every TCP socket in LISTEN, with port, bind address and process if readable."""
    try:
        result = subprocess.run(
            ["ss", "-ltnp"], capture_output=True, text=True, timeout=10, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return []

    sockets = []
    seen_ports: dict[int, dict] = {}
    for line in result.stdout.splitlines()[1:]:
        fields = line.split()
        if len(fields) < 4:
            continue
        local = fields[3]
        address, _, port_text = local.rpartition(":")
        if not port_text.isdigit():
            continue
        port = int(port_text)
        # Strip the IPv6 suffix brackets so 127.0.0.1 and [::] read the same way.
        address = address.strip("[]")
        process = ""
        match = re.search(r'\(\("([^"]+)"', line)
        if match:
            process = match.group(1)
        if not process and port in CATALOG:
            process = CATALOG[port][0].lower()
        entry = {
            "port": port,
            "address": address,
            "process": process,
            "loopback": address in ("127.0.0.1", "::1", "127.0.0.53", "127.0.0.54"),
        }
        # One row per port. A wildcard bind wins over a specific one, and IPv4 over
        # IPv6, so the address shown is the most informative of the duplicates.
        previous = seen_ports.get(port)
        if previous is None or _rank(entry) > _rank(previous):
            seen_ports[port] = entry
    return list(seen_ports.values())


def _rank(entry: dict) -> tuple[int, int]:
    """Higher wins when the same port is bound on several stacks."""
    wildcard = 1 if entry["address"] in ("0.0.0.0", "::") else 0
    ipv4 = 1 if "." in entry["address"] else 0
    return (wildcard, ipv4)


def unit_state(unit: str) -> str:
    """0 active, 3 stopped, 4 no such unit. Decided by exit code, never by text.

    Both scopes are asked, system first. Most units here are user units, and
    `systemctl is-active` without --user answers 4 for a unit that exists perfectly
    well in the user manager — measured: pi-companion.service gives 4 to the system
    query and 0 to the user query. Asking only the system scope labelled every user
    service "sin unidad", which reads as "nothing governs this" when the truth is
    "the question was asked in the wrong place".
    """
    for scope in (["systemctl"], ["systemctl", "--user"]):
        try:
            result = subprocess.run(
                scope + ["is-active", unit],
                capture_output=True, text=True, timeout=5, check=False,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0:
            return "active"
        if result.returncode == 3:
            return "inactive"
    return "no-unit"


def describe(socket: dict) -> tuple[str, str, str]:
    """Return (group, name, purpose) for one socket."""
    port = socket["port"]
    process = socket["process"].lower()

    if port in CATALOG:
        name, purpose = CATALOG[port]
        probe = name.lower()
        # A catalogued port is classified by its catalog role, not by the process
        # name: several catalogued services run as python3 and the generic rule
        # filed them all under "web".
        for fragment, (group, role) in ROLE.items():
            if fragment in probe:
                return group, name, purpose or role
        return "system", name, purpose
    name, purpose, probe = socket["process"] or "—", "", process

    for fragment, (group, role) in ROLE.items():
        if fragment in probe:
            return group, name, purpose or role

    if not socket["process"]:
        return "unknown", name, "No se puede leer el proceso propietario"
    return "unknown", name, purpose or "Sin clasificar"


def build(sockets: list[dict]) -> tuple[dict, list[dict]]:
    """Split sockets into visible groups and the hidden tail, with reasons."""
    grouped = {key: [] for key in GROUPS}
    hidden = []

    for socket in sockets:
        group, name, purpose = describe(socket)
        port = socket["port"]

        # High ports with no readable process are client sockets and NFS helpers,
        # not services. They are listed under "hidden" with the reason, never
        # silently dropped: a reader must be able to check what was left out.
        if port > 32768 and not socket["process"]:
            hidden.append({"port": port, "address": socket["address"],
                           "reason": "puerto efímero sin proceso legible"})
            continue
        ignored = shutil.which("x")
        if port > 32768 and ignored and "fluidsynth" not in socket["process"].lower():
            hidden.append({"port": port, "address": socket["address"],
                           "reason": "puerto alto sin catálogo"})
            continue

        unit = UNITS.get(port, "")
        state = unit_state(unit) if unit else "no-unit"
        grouped[group].append(
            {
                "port": port,
                "address": socket["address"],
                "scope": "loopback" if socket["loopback"] else "público",
                "name": name,
                "purpose": purpose,
                "unit": unit or "—",
                "state": state,
                "link": LINKS.get(port, ""),
            }
        )

    live = {socket["port"] for socket in sockets}
    for port, (name, purpose, group) in DECLARED.items():
        if port in live:
            continue
        grouped[group].append(
            {
                "port": port,
                "address": "—",
                "scope": "—",
                "name": name,
                "purpose": purpose,
                "unit": "—",
                "state": "declared-silent",
                "link": "",
            }
        )

    for rows in grouped.values():
        rows.sort(key=lambda row: row["port"])

    unmonitored = [
        {"port": row["port"], "name": row["name"], "scope": row["scope"]}
        for rows in grouped.values()
        for row in rows
        if row["state"] == "declared-silent" or (
            row["unit"] == "—" and row["port"] not in CATALOG
        )
    ]
    return grouped, hidden, unmonitored


STATE_LABEL = {
    "declared-silent": ("no escucha", "bad"),
    "active": ("activo", "ok"),
    "inactive": ("parado", "bad"),
    "no-unit": ("sin unidad", "muted"),
    "unknown": ("sin verificar", "muted"),
}


def rows_html(rows: list[dict]) -> str:
    if not rows:
        return '      <tr><td colspan="6" class="empty">Nada escuchando en este grupo.</td></tr>'
    out = []
    for row in rows:
        label, css = STATE_LABEL.get(row["state"], ("sin verificar", "muted"))
        name = row["name"]
        if row["link"]:
            name = f'<a href="{row["link"]}">{name}</a>'
        scope = (
            '<span class="tag loopback">solo local</span>'
            if row["scope"] == "loopback"
            else '<span class="tag public">accesible</span>'
        )
        out.append(
            f'      <tr><td class="port">{row["port"]}</td><td>{name}</td>'
            f'<td class="purpose">{row["purpose"]}</td><td>{scope}</td>'
            f'<td><code>{row["unit"]}</code></td>'
            f'<td class="state {css}">{label}</td></tr>'
        )
    return "\n".join(out)


def hidden_html(hidden: list[dict]) -> str:
    if not hidden:
        return ""
    rows = "\n".join(
        f'        <tr><td class="port">{item["port"]}</td>'
        f'<td><code>{item["address"]}</code></td><td>{item["reason"]}</td></tr>'
        for item in hidden
    )
    return (
        '  <details class="hidden-ports">\n'
        f'    <summary>{len(hidden)} puertos ocultos — por qué</summary>\n'
        '    <table>\n'
        '      <thead><tr><th>Puerto</th><th>Interfaz</th><th>Motivo</th></tr></thead>\n'
        f'      <tbody>\n{rows}\n      </tbody>\n'
        '    </table>\n'
        '  </details>'
    )


def render(grouped: dict, hidden: list[dict], unmonitored: list[dict]) -> str:
    sections = []
    for key, (title, blurb) in GROUPS.items():
        rows = grouped.get(key, [])
        sections.append(
            f'  <section>\n    <h2>{title} <span class="count">{len(rows)}</span></h2>\n'
            f'    <p class="blurb">{blurb}</p>\n'
            '    <table>\n'
            '      <thead><tr><th>Puerto</th><th>Servicio</th><th>Para qué</th>'
            '<th>Alcance</th><th>Unidad</th><th>Estado</th></tr></thead>\n'
            f'      <tbody>\n{rows_html(rows)}\n      </tbody>\n'
            '    </table>\n  </section>'
        )

    if unmonitored:
        items = "".join(
            f'<li><strong>:{item["port"]}</strong> {item["name"]} — {item["scope"]}</li>'
            for item in unmonitored
        )
        alert = (
            '  <section class="alert">\n'
            f'    <h2>Requiere atención <span class="count">{len(unmonitored)}</span></h2>\n'
            '    <p class="blurb">Escuchan o deberían hacerlo, y nadie los vigila: '
            'sin unidad systemd y fuera del catálogo.</p>\n'
            f'    <ul>{items}</ul>\n'
            '  </section>'
        )
    else:
        alert = (
            '  <section class="alert quiet">\n'
            '    <h2>Requiere atención <span class="count">0</span></h2>\n'
            '    <p class="blurb">Todos los servicios visibles tienen unidad o catálogo.</p>\n'
            '  </section>'
        )

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    total = sum(len(rows) for rows in grouped.values())
    template = TEMPLATE.read_text()
    # str.replace, not str.format: the stylesheet is full of braces and format()
    # would treat every one of them as a placeholder.
    for token, value in (
        ("{{ALERT}}", alert),
        ("{{SECTIONS}}", "\n\n".join(sections)),
        ("{{HIDDEN}}", hidden_html(hidden)),
        ("{{STAMP}}", stamp),
        ("{{TOTAL}}", str(total)),
    ):
        template = template.replace(token, value)
    return template


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdout", action="store_true", help="print, do not write")
    args = parser.parse_args()

    if not TEMPLATE.is_file():
        print(f"missing template: {TEMPLATE}", file=sys.stderr)
        return 2

    sockets = listening()
    if not sockets:
        print("could not read listening sockets; refusing to write a board that lies",
              file=sys.stderr)
        return 2

    grouped, hidden, unmonitored = build(sockets)
    page = render(grouped, hidden, unmonitored)

    if args.stdout:
        print(page)
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(page)

    for key, rows in grouped.items():
        print(f"{GROUPS[key][0]}: {len(rows)}")
        for row in rows:
            print(f"  :{row['port']:<6} {row['name']:<18} {row['state']:<12} {row['scope']}")
    print(f"ocultos: {len(hidden)}")
    print(f"requiere atención: {len(unmonitored)}")
    for item in unmonitored:
        print(f"  ! :{item['port']:<6} {item['name']}")
    print(f"escrito {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
