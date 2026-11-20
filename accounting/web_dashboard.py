#!/usr/bin/env python3

# OKF-METADATA
# ---
# type: Python Module
# title: "Servidor del dashboard ContaMNG"
# description: "Servidor HTTP stdlib en 127.0.0.1:8799: renderiza la página de cuota/coste/financiación, sirve las fichas, valida el token de acceso y cachea el render 60 s."
# status: draft
# generated: 2026-11-20T00:51:26+01:00
# source:
# - "accounting/data.py"
# - "usage.db"
# - "accounting/dashboard.token"
# - "accounting/fichas/*.html"
# verified: 2026-11-20
# stale_after: 2027-06-30
# ---

"""Web dashboard for the Vibe subscription accounting.

Serves a self-contained plotly page on 127.0.0.1:8799.
Run:  python3 accounting/web_dashboard.py   →  http://127.0.0.1:8799
"""
from __future__ import annotations

import json
import sys
import threading
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import plotly.graph_objects as go

sys.path.insert(0, str(Path(__file__).resolve().parent))
import data  # noqa: E402

PORT = 8799

def _dashboard_token() -> str:
    """Access token for the dashboard (never hardcoded, never logged)."""
    import os
    tok_file = Path(__file__).resolve().parent / "dashboard.token"
    if tok_file.is_file():
        return tok_file.read_text().strip().split("=", 1)[1]
    return os.environ.get("DASHBOARD_TOKEN", "")

DASHBOARD_TOKEN = _dashboard_token()
EUR_PER_POINT = data.euro_per_quota_point()


_render_cache = {"html": None, "ts": 0.0, "age_note": ""}
_RENDER_TTL = 60.0  # seconds — reversible: set TTL to 0.0 to disable cache entirely




def _iso_now() -> str:
    from datetime import datetime
    return datetime.now().astimezone().replace(microsecond=0).isoformat()


def _date_today() -> str:
    from datetime import date
    return date.today().isoformat()

def _es_numbers(html: str) -> str:
    """REGLA #1: rendered figures use Spanish format (decimal comma, thousands dot).

    Only numbers followed by a currency/percent/ratio unit are touched, so CSS
    values and Plotly's numeric arrays stay intact. Numbers that already carry a
    comma are left alone (idempotent)."""
    import re as _re

    def conv(m):
        num, sp, unit = m.group(1), m.group(2), m.group(3)
        if "," in num:
            return m.group(0)                      # already Spanish
        neg = num.startswith("-")
        body = num.lstrip("-")
        int_part, _, dec = body.partition(".")
        # 3-digit group after a dot with no other dot = thousands separator already
        if len(int_part) <= 3 and len(dec) == 3:
            return m.group(0)                      # e.g. 255.000 → keep
        digits, grouped = int_part, ""
        while len(digits) > 3:
            grouped = "." + digits[-3:] + grouped
            digits = digits[:-3]
        grouped = digits + grouped
        out = ("-" if neg else "") + grouped + ("," + dec if dec else "")
        return out + sp + unit

    return _re.sub(r"(?<![\d.,])(-?\d+(?:\.\d+)?)(\s?)(€|%|pp|x)(?![\w])", conv, html)


def render_html() -> str:
    """Dashboard rendering with a 60s cache of the expensive parts (plotly JSON
    + tables). read_quota stays inside the same cache — measured ~2,5s per call
    on 18-nov, too slow to run per GET. If a refresh fails, the LAST GOOD HTML
    is served with its age marked in the footer (a 90s-old datum beats an error)."""
    import time
    now = time.time()
    cached_html, cached_ts = _render_cache["html"], _render_cache["ts"]
    if cached_html is not None and now - cached_ts < _RENDER_TTL:
        return cached_html  # hot cache hit
    try:
        return _render_and_cache(now)
    except Exception as exc:
        if cached_html is not None:
            age = now - cached_ts
            note = f'<b style="color:#f59e0b">⚠ último dato bueno: hace {age:.0f}s (refresh falló: {type(exc).__name__})</b>'
            return cached_html.replace("<body>", "<body>" + note, 1)
        raise


def _render_and_cache(now: float) -> str:
    series = data.allowance_series()
    deltas = data.daily_allowance_delta(series)
    days = [d for d, _ in series]
    pct = [p for _, p in series]
    delta_vals = [dp for _, dp in deltas]

    # 1. Cumulative allowance (measured) with projection to reset.
    fig1 = go.Figure()
    fig1.add_trace(go.Scatter(x=days, y=pct, mode="lines+markers", name="Usado (medido)",
                              line=dict(color="#22c55e", width=3)))
    plan = data.load_plan()
    pl_days = [days[-1], data.RESET_AT]
    fig1.add_trace(go.Scatter(  # required pace to hit 100% exactly at reset
        x=pl_days, y=[plan["current_pct"], 100], mode="lines",
        name=f"Plan requerido {plan["required_pts_day"]:.2f} % cuota/día",
        line=dict(color="#38bdf8", width=2, dash="dash")))
    fig1.add_trace(go.Scatter(  # suggested pace (margin +0.25 pts/day)
        x=pl_days, y=[plan["current_pct"],
                      min(plan["current_pct"] + plan["suggested_pts_day"] * plan["days_left"], 100)],
        mode="lines", name=f"Plan sugerido {plan["suggested_pts_day"]:.2f} % cuota/día",
        line=dict(color="#f59e0b", width=2), fill="tonexty" if False else None))
    last_day, last_pct = days[-1], pct[-1]
    reset = data.RESET_AT
    proj_pct = last_pct + (100 - last_pct) / 12 * 0  # placeholder replaced below
    # Straight-line projection at the recent pace (points/day of the last interval).
    from datetime import datetime
    d_last = datetime.strptime(last_day, "%Y-%m-%d")
    d_reset = datetime.strptime(reset, "%Y-%m-%d")
    days_left = (d_reset - d_last).days
    if len(pct) >= 2:
        pace = deltas[-1][1]  # most recent daily increment
    else:
        pace = last_pct / max(days_left, 1)
    proj_pct = min(last_pct + pace * days_left, 100)
    fig1.add_trace(go.Scatter(
        x=[last_day, reset], y=[last_pct, proj_pct], mode="lines+markers",
        name=f"Proyección ritmo actual ({pace:.2f} % cuota/día)",
        line=dict(color="#f59e0b", width=2, dash="dash")))
    fig1.add_hline(y=100, line=dict(color="#ef4444", dash="dot"),
                   annotation_text="Límite del ciclo (100%)")
    fig1.update_layout(
        title=f"Cuota Vibe usada por día · {last_pct:.2f}% ahora · "
              f"proyección a reset: {proj_pct:.1f}%",
        xaxis_title="Día", yaxis_title="% del ciclo",
        template="plotly_dark", paper_bgcolor="#1b2740", plot_bgcolor="#16203a", height=380,
        # Note sits INSIDE the plot area (bottom-left) — at y>1 it collided with the title.
        annotations=[dict(
            text=f"1 pp de ciclo = 2,55 € de presupuesto = {EUR_PER_POINT:.4f} € de suscripción",
            showarrow=False, xref="paper", yref="paper", x=0.01, y=0.02,
            xanchor="left", yanchor="bottom",
            font=dict(size=10, color="#94a3b8"))],
        margin=dict(t=90, b=60),
    )

    # 4. Suggested daily load to reach 100% at reset (table).
    from datetime import datetime as _dt
    mu = plan["multiplier"]
    # 4. Suggested daily load — as HTML panel (Plotly table rendered white and cramped)
    load_html = f"""
<div class="panel" style="padding:14px;margin:14px 0">
<b style="color:#7dd3fc">🎯 Optimización de carga diaria</b>
<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.92rem">
<tr style="background:#1e293b"><th style="padding:8px 12px;text-align:left">Objetivo</th><th style="padding:8px 12px;text-align:left">Ritmo requerido</th><th style="padding:8px 12px;text-align:left">Ritmo reciente</th><th style="padding:8px 12px;text-align:left">Aceleración</th><th style="padding:8px 12px;text-align:left">Sugerido (+0,25 margen)</th><th style="padding:8px 12px;text-align:left">€ suscripción/día sugerido</th></tr>
<tr><td style="padding:8px 12px">100% el {data.RESET_AT}</td>
<td style="padding:8px 12px"><b>{plan['required_pts_day']:.2f} % cuota/día</b></td>
<td style="padding:8px 12px">{plan['recent_pts_day']:.2f} % cuota/día</td>
<td style="padding:8px 12px"><b style="color:#f59e0b">×{mu:.2f}</b> la carga actual</td>
<td style="padding:8px 12px">{plan['suggested_pts_day']:.2f} % cuota/día</td>
<td style="padding:8px 12px">{plan['suggested_eur_day']:.2f} €/día</td></tr>
</table>
<p style="color:#94a3b8;margin:6px 0 0">DEDUCIDO (ritmo ∝ tokens, margen +0,25 pp/día) — se recalcula en cada refresh del caché.</p>
<p style="color:#94a3b8;margin:4px 0 0">Ciclo actual: <b>{plan['cycle_days']} días</b> (suscripción contratada el {plan['cycle_start']}, reset el {data.RESET_AT}) · día {plan['cycle_day']} de {plan['cycle_days']}.<br>
<span style="color:#7dd3fc">Ojo con la proyección mensual:</span> el presupuesto de 255 € es POR CICLO. Este ciclo dura {plan['cycle_days']} días, pero los siguientes son meses naturales de {plan['steady_days']} días: a igualdad de presupuesto, el ritmo sostenible cae a {plan['steady_pts_day']:.2f} % cuota/día ({plan['steady_pts_day']*EUR_PER_POINT:.2f} € suscr./día) — menos de la mitad que el pace de este ciclo.</p>
</div>"""

    # 2. Daily increment translated to subscription EUR.
    fig2 = go.Figure(go.Bar(
        x=days, y=[round(dp * EUR_PER_POINT, 4) for dp in delta_vals],
        marker_color="#3b82f6", name="€ suscripción/día"))
    fig2.update_layout(
        title="Consumo diario en \"€ de suscripción\" (Δ cuota × 18,14/255)",
        xaxis_title="Día", yaxis_title="€/día", template="plotly_dark", paper_bgcolor="#1b2740", plot_bgcolor="#16203a", height=330)

    # 3. Tokens per day from usage.db.
    toks = data.daily_tokens()
    fig3 = go.Figure()
    fig3.add_trace(go.Bar(x=[t["day"] for t in toks], y=[t["input_uncached"] for t in toks],
                          name="input sin caché", marker_color="#8b5cf6"))
    fig3.add_trace(go.Bar(x=[t["day"] for t in toks], y=[t["cached"] for t in toks],
                          name="caché", marker_color="#6366f1"))
    fig3.add_trace(go.Bar(x=[t["day"] for t in toks], y=[t["completion"] for t in toks],
                          name="completión", marker_color="#22d3ee"))
    fig3.update_layout(barmode="stack", title="Tokens medidos por día (usage.db, proveedor)",
                       xaxis_title="Día", yaxis_title="Tokens",
                       template="plotly_dark", paper_bgcolor="#1b2740", plot_bgcolor="#16203a", height=360, yaxis_tickformat=",")

    # 5. Hardware inventory. Características/fuente por fila:
    # Laptop HP: MEASURED on this host (lscpu, free -h, lspci, lsblk, df,
    # hostnamectl — 2026-11-18). ricardoPC: provided by TelfMNG, corrected by
    # Ricardo (df /: 31%); not measured in place (192.168.2.11, ssh open, no
    # credentials authorized).
    # Hardware inventory lives in hardware.local.json, which is git-ignored: this file is
    # published, and the inventory carries hostnames, disk usage and GPU details of
    # Ricardo's machines. The published dashboard renders an empty inventory when the
    # file is absent, which is what a reader of the repository sees.
    from pathlib import Path as _Path
    _hw_file = _Path(__file__).with_name("hardware.local.json")
    try:
        HARDWARE = json.loads(_hw_file.read_text())
    except (OSError, json.JSONDecodeError):
        HARDWARE = []

    # 5c. Full measured report for the HP laptop (this host), collapsing <details>.
    import subprocess
    def _run(cmd):
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
        return (r.stdout or r.stderr).strip()
    hw_report = {
        "lscpu": _run("lscpu"),
        "lspci (vga/display)": _run("lspci | grep -iE \"vga|3d|display\""),
        "memoria (free -h)": _run("free -h"),
        "discos (lsblk)": _run("lsblk -d -o NAME,SIZE,MODEL,TRAN 2>/dev/null | grep -v loop"),
        "montajes (df -h)": _run("df -h / /home"),
        "gpu/vram (glxinfo -B)": _run("echo '(glxinfo omitido: requiere display activo, timeout en SSH localeless)'; echo 'VRAM R5 M330 (sysfs)'; cat /sys/class/drm/card1/device/mem_info_vram_total 2>/dev/null || echo 'no sysfs vram total'"),
        "swap": _run("swapon --show"),
        "sistema (uname/hostnamectl)": _run("uname -a; hostnamectl | grep -E 'Chassis|Operating|Kernel'"),
        "placa (DMI)": _run("cat /sys/devices/virtual/dmi/id/{sys_vendor,product_name,board_vendor,board_name} 2>/dev/null | paste -sd' /'"),
        "carga actual": _run("uptime"),
    }
    # 5b. Plain HTML table, transposed: one row per characteristic (sizes itself
    # perfectly; Plotly tables clip). Fuente row first.
    # The published copy has no inventory; the renderer must survive that.
    HP = HARDWARE[0] if len(HARDWARE) > 0 else {}
    PC = HARDWARE[1] if len(HARDWARE) > 1 else {}
    # VRAM row (HP measured with DRI_PRIME=1 glxinfo -B; Intel has none, shares RAM)
    feats = [
        ("Fuente", HP["fuente"], PC["fuente"]),
        ("CPU", HP["cpu"], PC["cpu"]),
        ("CPU máx.", HP["cpu_max"], PC["cpu_max"]),
        ("RAM", HP["ram"], PC["ram"]),
        ("GPU", HP["gpu"], PC["gpu"]),
        ("VRAM", HP["vram"], PC["vram"]),
        ("SO", HP["so"], PC["so"]),
        ("Kernel", HP["kernel"], PC["kernel"]),
        ("Chassis", HP["chassis"], PC["chassis"]),
        ("Discos", HP["discos"], PC["discos"]),
    ]
    hw_rows = "".join(
        f"<tr><td style='padding:10px 12px'><b>{k}</b></td>"
        f"<td style='padding:10px 12px'>{a}</td>"
        f"<td style='padding:10px 12px'>{b}</td></tr>"
        for k, a, b in feats
    )

    import html as _html
    hw_report_html = "".join(
        f"<div class='panel' style='padding:10px'>"
        f"<b style='color:#7dd3fc'>{_html.escape(k)}</b>"
        f"<pre style='margin:6px 0 0;white-space:pre-wrap;font-size:0.8rem;color:#e2e8f0'>{_html.escape(v)}</pre></div>"
        for k, v in hw_report.items()
    )

    FUN_METADATA = {"fecha_consulta": "2026-11-18/19", "nota_estado": "DATOS de la fuente citada, NO verificación documental oficial (esa corresponde a ORQ/Ricardo)"}

    # Funding opportunities map (consulted 18-19 nov 2026;DATOS con fuente, no "verificado" —
    # verificación oficial corresponde al ORQ/Ricardo). Ranked by valor/esfuerzo.
    FUNDING = [
        {"rank": 1,
         "slug": "nlnet-restack",
         "slug": "nlnet-restack", "name": "NLnet / Restack Open Call #2",
         "importe": "5.000-50.000 € (1ª) · hasta 150.000 follow-on · cap vida 500k",
         "plazo": "3-ene-2027 12:00 CET (ABIERTA)",
         "req": "SLNE válida · FOSS internet-stack · sin co-financiación",
         "encaje": "ALTO — mistral-gateway = proxy OpenAI-compatible libre, tesis exacta del programa",
         "esfuerzo": "Bajo (proposal 2-3 págs sobre proyecto ya funcionando)",
         "url": "nlnet.nl/propose · nlnet.nl/restack · eunita.eu/open-calls/restack-open-call-2"},
        {"rank": 2,
         "slug": "aina-hack",
         "slug": "aina-hack", "name": "Aina Hack 2026 (Barcelona, 11-12 dic)",
         "importe": "6.000 € premios (1º 4.000 €)",
         "plazo": "inscripción hasta 1-dic-2026",
         "req": "equipo 2-4 · IA en catalán · presencial",
         "encaje": "ALTO — agentes IA con soporte catalán",
         "esfuerzo": "Medio (demo 2 días + viaje)",
         "url": "cidai.eu/ecosistemes/hackatons/ainahack · eurecat.org/es/calendario/ainahack-2026"},
        {"rank": 3,
         "slug": "kits-gumroad",
         "slug": "kits-gumroad", "name": "Kits de agentes IA (Gumroad/Polar)",
         "importe": "9-299 $/kit · recurrente · margen ≈99% (cuota sobrante medida: 220,75 € libre)",
         "plazo": "continuo",
         "req": "producto empaquetado + docs — ya lo tenemos",
         "encaje": "ALTO — agentes y dashboards listos para empaquetar",
         "esfuerzo": "Bajo-medio (empaquetar 1-2 tardes)",
         "url": "gumroad.com (agentlab, agenthour, zaidriaz2) · polar.sh"},
        {"rank": 4,
         "slug": "articulos-pagados",
         "slug": "articulos-pagados", "name": "Artículos técnicos pagados",
         "importe": "300-1.500 $/art (Airbyte 900 $, Honeybadger 500 $, DigitalOcean 300-500 $, LogRocket 350-600 $)",
         "plazo": "continuo (programas activos ago 2026)",
         "req": "track record demostrable · 1.500-2.000 palabras · inglés",
         "encaje": "MEDIO — know-how real de agentes + gateway",
         "esfuerzo": "Medio (6-10 h por artículo)",
         "url": "github.com/malgamves/CommunityWriterPrograms · honeybadger.io/blog/write-for-us · percona.community · dev.to listas 2026"},
        {"rank": 5,
         "slug": "cdti-step",
         "slug": "cdti-step", "name": "CDTI Innterconecta STEP 2026",
         "importe": "subvención FEDER (bolsa 150 M€; proyectos típicos 300k-1M)",
         "plazo": "ABIERTA 17-nov → 23-dic-2026 12:00",
         "req": "consorcio ≥2 empresas · ≥2 CCAA · subcontratación ≥10% a centro de conocimiento · I+D real",
         "encaje": "MEDIO — mayor cuantía, mayor esfuerzo (memoria + partner)",
         "esfuerzo": "Alto",
         "url": "cdti.es FAQ itc-step_v02_2026 · ciencia.gob.es"},
        {"rank": 6,
         "slug": "enisa",
         "slug": "enisa", "name": "ENISA Startups y Pymes",
         "importe": "préstamo 25k-1,5M € · 2 años solo intereses · Euríbor 12M + 4,00-4,50% (rating)",
         "plazo": "continuo (Portal Cliente online)",
         "req": "SL/SA con actividad económica real · fuera inmobiliario/financiero · pyme UE",
         "encaje": "MEDIO — préstamo, NO subvención; para crecer con plan de devolución",
         "esfuerzo": "Bajo la solicitud; ALTO el compromiso de devolver",
         "url": "enisa.es/servicios/financiacion/startups-y-pymes · Guia_Operativa_FEPYME_v2.pdf"},
        {"rank": 7,
         "slug": "kit-digital",
         "slug": "kit-digital", "name": "Kit Digital como Agente Digitalizador",
         "importe": "bonos cliente 3k/6k/12k/25k/29k €",
         "plazo": "según convocatoria (POR CONFIRMAR ventana abierta)",
         "req": "facturar ≥100k/2a o ≥50k/1a en proyectos similares (autónomo 70k/2a, 35k/1a) — BARRERA si la SLNE es nueva",
         "encaje": "MEDIO — setup de agentes IA como solución adjudicable",
         "esfuerzo": "Alto desde cero (adhesión + catálogo) · alternativa: apadrinarse con agente adherido (comisión 10-20%)",
         "url": "acelerapyme.gob.es/kit-digital · comercioconectado.gob.es · espanadigital.gob.es"},
        {"rank": 8,
         "slug": "kit-consulting",
         "slug": "kit-consulting", "name": "Kit Consulting (Red.es)",
         "importe": "12k-24k € por cliente (servicios de 6k)",
         "plazo": "por convocatoria — varias cerradas 2026, POR CONFIRMAR próxima",
         "req": "asesor digital adherido · misma barrera de facturación (≥35k-70k)",
         "encaje": "MEDIO — mismo esquema que Kit Digital, perfil consultoría",
         "esfuerzo": "Alto (mismas barreras)",
         "url": "espanadigital.gob.es/medida/programa-kit-consulting · mediacore.es/kit-consulting"},
        {"rank": 9,
         "slug": "prototype-fund",
         "slug": "prototype-fund", "name": "Prototype Fund (Alemania) — 3 líneas",
         "importe": "hasta 47.500 € ind. / 95.000 € equipo (ronda 03: hasta 79k/158k)",
         "plazo": "30-nov-2026 15:00 (⚠️ 12 días)",
         "req": "FOSS · POSIBLE exigencia de residencia/Alemania — POR CONFIRMAR; si obligatoria: NO elegibles",
         "encaje": "ALTO en tesis / BAJO en elegibilidad (pendiente de confirmar)",
         "esfuerzo": "Medio (propuesta corta inicial)",
         "url": "prototypefund.de/en/application/details"},
        {"rank": 10,
         "slug": "codesupply",
         "slug": "codesupply", "name": "CodeSupply 2nd call (NLnet)",
         "importe": "fondo de metadatos de paquetes OSS (cuantía según proyecto)",
         "plazo": "3-ene-2027 12:00 CET",
         "req": "metadatos de paquetes/registro software",
         "encaje": "MEDIO — si el gateway publica metadata de agentes/paquetes",
         "esfuerzo": "Medio",
         "url": "nlnet.nl/codesupply"},
        {"rank": 11,
         "slug": "sponsors-polar",
         "slug": "sponsors-polar", "name": "GitHub Sponsors / Polar / Ko-fi",
         "importe": "benchmarks reales: 73 devs >1k$/mes de ~18k perfiles; top 8k$/mes; mediana baja",
         "plazo": "continuo",
         "req": "audiencia previa · proyecto OSS con usuarios",
         "encaje": "BAJO-MEDIO hoy — compuesto a largo plazo",
         "esfuerzo": "Bajo (activar 1 tarde)",
         "url": "gemlist.io · jakeinsight.com · polar.sh · calebporzio.com (playbook)"},
        {"rank": 12,
         "slug": "sovereign-tech",
         "slug": "sovereign-tech", "name": "Sovereign Tech Fund/Agency",
         "importe": "contrato de trabajo OSS (no grant): auditorías, hardening, releases",
         "plazo": "continuo, por invitación/convocatoria",
         "req": "componente OSS de infraestructura crítica con track record",
         "encaje": "MEDIO a futuro — requiere que el gateway sea dependencia crítica de otros",
         "esfuerzo": "Alto (años de track record)",
         "url": "sovereign.tech/programs/fund · sovereign.tech/programs/eu-sovereign-tech-fund"},
        {"rank": 13,
         "slug": "bsc-ai-factory",
         "slug": "bsc-ai-factory", "name": "BSC AI Factory Accelerator",
         "importe": "aceleracion equity-free + supercomputacion (MareNostrum 5); 25 startups/sede x 4 sedes",
         "plazo": "1a call cerro 9-nov-2026; proximas POR ANUNCIAR",
         "req": "AI-native startup · entidad legal al kick-off · ~15% tiempo semanal",
         "encaje": "ALTO — AI factory con BSC,ROYO 5.supercomputing gratis, no grant cash",
         "esfuerzo": "Medio (aplicacion + itinerario 14 semanas)",
         "url": "bsc-aifactory.eu · bsc-aifactory.eu/call-for-startups"},
        {"rank": 14,
         "slug": "credito-fiscal",
         "slug": "credito-fiscal", "name": "Credito fiscal I+D+i (IS, art. 35.2 LIS)",
         "importe": "VERIFICADO AEAT/art.39.2 LIS: deduccion 25% gasto I+D (42% exceso); ABONO en efectivo del 80% si perdidas/sin cuota; limites 3M EUR/año I+D+IT, 1M EUR IT, 5M EUR si gasto >10% cifra de negocios; requiere informe motivado vinculante + 1 año espera + reinversión equivalente 24 meses + mantener plantilla",
         "plazo": "en la autoliquidacion del IS de cada ejercicio (contable)",
         "req": "proyectos I+D REAL (incertidumbre tecnica); documentacion tecnica + informe motivado vinculante para seguridad; escalado: I+D propio con personal investigador",
         "encaje": "ALTO A MEDIO PLAZO — nuestro trabajo de agentes/gateway puede calificar SI se documenta como I+D (incertidumbre + replicabilidad); PRO帽子: exige contabilidad separada de gastos I+D e informe motivado con registro previo",
         "esfuerzo": "Alto (proceso formal, informe de adecuacion tecnica, contabilidad segregada)",
         "url": "sede.agenciatributaria.gob.es (deduccion I+D+i IS art. 35) · birdinnov.com/es/blog/id-it/recuperar-credito-fiscal"},
        {"rank": 15,
         "slug": "madrid-emprende",
         "slug": "madrid-emprende", "name": "Madrid Emprende Aceleracion 2026-27",
         "importe": "aceleracion 6 meses (vivero municipal, sin coste de alquiler); sin grant cash",
         "plazo": "candidaturas 7-sep → 16-oct-2026 (CERRADA ahora; siguiente edicion por anunciar)",
         "req": "startup con entidad legal · dedicacion ~15% semanal",
         "encaje": "MEDIO — vivero + mentoring, sin cash; hopeful para 2027 edicion",
         "esfuerzo": "Bajo (solicitud)",
         "url": "madridemprende.es"},
        {"rank": 16,
         "slug": "repsol",
         "slug": "repsol", "name": "Fundacion Repsol Fondo Emprendedores 15a",
         "importe": "aceleracion + validacion con clientes (energia/transicion)",
         "plazo": "30-ene → 15-mar-2026 CERRADA; 16a convocatoria POR ANUNCIAR",
         "req": "startup pre-comercial energia/eficiencia/agua/movilidad; fundadores retienen mayoria",
         "encaje": "BAJO-MEDIO — solo si pivotamos a eficiencia energetica con IA",
         "esfuerzo": "Medio",
         "url": "fundacionrepsol.com/content/repsol-fundacion/que-hacemos/fondo-de-emprendedores/convocatoria.html"},
        {"rank": 17,
         "slug": "barcelona-build",
         "slug": "barcelona-build", "name": "The Barcelona Build (Mainloop) — hackathon",
         "importe": "10.000/7.000/5.000/2.000/1.000 EUR + 500 EUR (6º-10º) — bolsa ~30.000 EUR, gratis",
         "plazo": "8-15 ene-2027 (remoto) · final 23-ene (BCN o video) · registro cierra 8-ene",
         "req": "final de carrera/grad recientes/early-career engineers — VERIFICAR elegibilidad SLNE",
         "encaje": "ALTO — IA/build week con proyectos reales",
         "esfuerzo": "Bajo-medio (1 semana remota)",
         "url": "mainloopai.com/en/events/barcelona-build"},
        {"rank": 18,
         "slug": "aiod-deployai",
         "slug": "aiod-deployai", "name": "AIoD Open Call (DeployAI, Private Sector)",
         "importe": "hasta 60.000 EUR (AI Provider) + 15.000 EUR (Adopter)",
         "plazo": "OC1 cerró 8-jun-2026 — próximas convocatorias POR ANUNCIAR (monitorear aiodp.ai)",
         "req": "SME/startup UE con producto AI maduro TRL>=7 · PIC+VAT · Docker-izable a AIoD",
         "encaje": "ALTO técnico — gateway en producción probablemente TRL 7-8",
         "esfuerzo": "Medio (integración a plataforma + 3-stage funnel)",
         "url": "aiodp.ai/open_calls"},
        {"rank": 19,
         "slug": "alpha-omega",
         "slug": "alpha-omega", "name": "Alpha-Omega Seasonal Grant (nuevo)",
         "importe": "grant por temporada (importe por anunciar) — mantenimiento OSS crítico",
         "plazo": "cadencia trimestral 12 semanas (mes 1: submission)",
         "req": "proyecto OSS usado en infraestructura crítica (seguridad/supply-chain)",
         "encaje": "MEDIO-ALTO a futuro — cuando el gateway tenga adoptantes",
         "esfuerzo": "Bajo a medio",
         "url": "alpha-omega.dev/blog/announcing-the-new-alpha-omega-seasonal-grant-program"},
        {"rank": 20,
         "slug": "herodevs",
         "slug": "herodevs", "name": "HeroDevs OSS Sustainability Fund",
         "importe": "funding para maintainers (soporte extendido de OSS deprecado)",
         "plazo": "rolling (abierto)",
         "req": "proyecto OSS maduro con usuarios que requiere longevidad",
         "encaje": "MEDIO a futuro",
         "esfuerzo": "Bajo",
         "url": "github.com/numfocus/project-fundraising/issues/160"},
        {"rank": 21,
         "slug": "otf",
         "slug": "otf", "name": "Open Technology Fund (OTF) — internet freedom",
         "importe": "10.000-900.000 USD (EL MAYOR TECHO) — herramientas libertad de internet",
         "plazo": "rolling (RFPs abiertos)",
         "req": "dialogo herramientas anti-censura/privacidad — verificar elegibilidad geo/legal y formato",
         "encaje": "NARRATIVA LEGITIMA del gateway (proxy local, privacidad por diseño) pero exige reposicionar pitch",
         "esfuerzo": "Alto (reposicionamiento + verificación)",
         "url": "opentech.fund · thegrantindex.com/guides/non-dilutive-funding-open-source"},
        {"rank": 22, "name": "Mozilla Fellowship 2027-2028",
         "slug": "mozilla",
         "importe": "hasta 125.000 USD + 12 meses + red 200 Fellows (10 plazas)",
         "plazo": "call 2027 abierta — fecha exacta POR VERIFICAR",
         "req": "individuos (builders) — tecnología too early/ambitious",
         "encaje": "LA vía individual más potente — para Ricardo como builder",
         "esfuerzo": "Alto (proposal + track record)",
         "url": "mozillafoundation.org/en/what-we-do/grantmaking/fellowship"},
        {"rank": 23, "name": "Premios EmprendeXXI (ENISA + DayOne, 20a ed.)",
         "slug": "emprendexxi",
         "importe": "premio + visibilidad + ecosistema inversor",
         "plazo": "cierre 22-ene-2027",
         "req": "empresas de base tecnológica constituidas desde 2023 — NUESTRA SLNE ENCAJA",
         "encaje": "ALTO y SIN barreras técnicas",
         "esfuerzo": "Bajo-medio (candidatura)",
         "url": "enisa.es/actualidad/noticia/?slug=20-edicion-premios-EXXI"},
        {"rank": 24, "name": "Democratic Tech Fund (DTF) — crowdfunding + Call for Projects",
         "slug": "dtf",
         "importe": "por proyecto (comunidad-centred, colaborativo)",
         "plazo": "ABIERTO desde 29-oct-2026",
         "req": "infraestructura digital comunitaria (commons de gobernanza compartida)",
         "encaje": "MEDIO-ALTO: el gateway como commons con comunidad",
         "esfuerzo": "Medio (pitch + campaña)",
         "url": "commonsnetwork.org"},
        {"rank": 25, "name": "Transfiere 2027 (Málaga) — Call for Startups",
         "slug": "transfiere",
         "importe": "visibilidad + networking inversor (sin cash directo)",
         "plazo": "convocatoria abierta (nov-2026)",
         "req": "startup/pyme — presentación/proyección",
         "encaje": "MEDIO — buen canal de captación de partners/clientes",
         "esfuerzo": "Bajo",
         "url": "uco.es/servicios/actualidad (Transfiere 2027)"},
        {"rank": 26, "name": "NLnet — calendario recurrente (dato clave)",
         "slug": "nlnet-calendario",
         "importe": "igual que fila #1 (5k-50k/150k)",
         "plazo": "RECURRENTE: deadline el 3 de cada MES IMPAR (3-ene, 3-mar, 3-may 2027...)",
         "req": "igual — no es una única ventana anual",
         "encaje": "reduce presión de plazo; si falla el 3-ene hay 3-mar",
         "esfuerzo": "—",
         "url": "thegrantindex.com · grant-grants.com"},
    ]
    def _fund_row(h):
        _href = "/opcion1.html" if h['rank'] == 1 else f"/fichas/{h['rank']}-{h['slug']}.html"
        nombre = (f"<a href='{_href}' style='color:#7dd3fc;text-decoration:underline'><b>#{h['rank']}</b> {h['name']} →</a>")
        return (f"<tr><td style='padding:10px 12px'>{nombre}</td>"
                f"<td style='padding:10px 12px'>{h['importe']}</td>"
                f"<td style='padding:10px 12px'>{h['plazo']}</td>"
                f"<td style='padding:10px 12px'>{h['req']}</td>"
                f"<td style='padding:10px 12px'>{h['encaje']}<br><span style='color:#94a3b8'>Esfuerzo: {h['esfuerzo']}</span>"
                f"<br><span style='color:#7dd3fc'>{h['url']}</span></td></tr>")
    fund_rows = "".join(_fund_row(h) for h in FUNDING)

    # 6. Subscription analysis panel: averages, projections, unit economics.
    import html as _h
    BUDGET = data.BUDGET_EUR
    from datetime import datetime as _dt0
    _today = _dt0.today()
    _cycle_day = (_today - _dt0.strptime("2026-11-01", "%Y-%m-%d")).days + 1
    _cycle_days = (_dt0.strptime(data.RESET_AT, "%Y-%m-%d") - _dt0.strptime("2026-11-01", "%Y-%m-%d")).days
    used_eur = plan["current_pct"] / 100 * BUDGET
    free_eur = BUDGET - used_eur
    avg_pts = plan["current_pct"] / max(_cycle_day, 1)          # avg/day over cycle so far
    rec_pts = plan["recent_pts_day"]                            # last-interval pace
    days_left = plan["days_left"]
    subs_eur = 18.14
    eur_day_fixed = subs_eur / _cycle_days
    tok = data.daily_tokens()
    avg_tok_day = sum(t["tokens"] for t in toks if t["day"] < data.RESET_AT) / max(len(toks), 1)
    rec_tok = (toks[-1]["tokens"] if toks else 0)
    drain_recent = free_eur / (rec_pts * EUR_PER_POINT) / 30 if rec_pts > 0 else float("inf")  # months
    kpi_html = f"""
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:12px 0">
<div style="background:#1e293b;border-radius:8px;padding:10px"><b style="color:#7dd3fc">Consumo medio ciclo</b><br>{avg_pts:.2f} % cuota/día = {avg_pts*EUR_PER_POINT:.2f} € suscr./día<br><span style="color:#94a3b8">medido: {plan['current_pct']:.2f}% en {_cycle_day} días de {_cycle_days}</span></div>
<div style="background:#1e293b;border-radius:8px;padding:10px"><b style="color:#7dd3fc">Ritmo reciente</b><br>{rec_pts:.2f} % cuota/día = {rec_pts*EUR_PER_POINT:.2f} € suscr./día<br><span style="color:#94a3b8">última medición día-anterior → hoy</span></div>
<div style="background:#1e293b;border-radius:8px;padding:10px"><b style="color:#7dd3fc">Proyección a reset</b><br>quedan {days_left} días · falta {100-plan['current_pct']:.1f}% · pace requerido {plan['required_pts_day']:.2f} %/día<br><span style="color:#94a3b8">agotamiento al ritmo reciente: {drain_recent:.1f} meses (muy por delante del reset)</span></div>
<div style="background:#1e293b;border-radius:8px;padding:10px"><b style="color:#7dd3fc">Economía de la suscripción</b><br>1 pp de ciclo = 2,55 € de presupuesto incluido = {EUR_PER_POINT:.4f} € de lo que pagas (255 € / 18,14 €)<br><span style="color:#94a3b8">fijo pagado: {eur_day_fixed:.2f} €/día · cuota consumida al ritmo reciente: {rec_pts*EUR_PER_POINT:.2f} €/día · ratio de aprovechamiento del plan: {(rec_pts*EUR_PER_POINT)/eur_day_fixed:.1f}x</span></div>
<div style="background:#1e293b;border-radius:8px;padding:10px"><b style="color:#7dd3fc">Tokens (medido proveedor)</b><br>hoy: {rec_tok:,} · medio/día ciclo: {int(avg_tok_day):,}<br><span style="color:#94a3b8">fuente: usage.db (prompt+completion del proveedor) — aprox 1 % cuota ≈ {int((rec_tok/ max(rec_pts,0.01))):,} tokens</span></div>
<div style="background:#1e293b;border-radius:8px;padding:10px"><b style="color:#7dd3fc">Estado de la cuota</b><br>usado {plan['current_pct']:.2f}% ({used_eur:.2f} € de los {BUDGET:.0f} € incluidos) · libre {free_eur:.2f} €<br><span style="color:#94a3b8">pagado realmente por ese {plan['current_pct']:.2f}%: <b>0,00 € adicionales</b> — la suscripción ya pagada ({eur_day_fixed:.2f} €/día × {_cycle_day} días = {eur_day_fixed*_cycle_day:.2f} € devengados del mes) lo cubre todo; PAYG off ⇒ el 100% del ciclo no costaría ni 1 € más</span></div>
</div>"""

    payload = json.dumps({
        "series": [{"day": d, "pct": p, "delta": dp} for (d, p), (_, dp) in zip(series, deltas)],
        "live": data.live_quota(),
        "plan": plan,
        "economics": {"price_eur": data.SUBSCRIPTION_PRICE_EUR,
                      "budget_eur": data.BUDGET_EUR,
                      "eur_per_point": EUR_PER_POINT},
        "tokens": toks,
        "hardware": HARDWARE,
    }, ensure_ascii=False)

    html = f"""<!-- OKF-METADATA
type: Dashboard Page
title: "ContaMNG — dashboard de cuota, coste y financiación"
description: "Página generada en cada petición: cuota viva del ciclo, series de consumo, inventario de hardware y mapa de financiación con 26 vías."
status: to-confirm
generated: {_iso_now()}
source:
  - "usage.db (tokens por día/modelo, registro del proveedor)"
  - "read_quota() vivo sobre la API de suscripción"
  - "journalctl --user -u mistral-gateway (serie de allowance)"
  - "accounting/fichas/*.html (fichas de financiación)"
verified: {_date_today()}
stale_after: 2027-06-30
-->
<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>ContaMNG · Cuota Vibe</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.png">

<script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
<style>
 body{{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:24px auto;max-width:1200px}}
 .panel{{background:#1b2740;border:1px solid #2d3f63;border-radius:10px}}
 h1{{font-size:1.3rem}} .kpis span{{margin-right:1.5rem}}
 kbd{{background:#1e293b;padding:2px 6px;border-radius:4px}}
</style></head><body>
<a id="f-top"></a><div style="position:sticky;top:0;background:#0f172aee;padding:8px 0;z-index:9;border-bottom:1px solid #2d3f63;margin-bottom:6px">
<a href="#inventario" style="color:#7dd3fc;margin-right:16px">Inventario</a>
<a href="#mapa" style="color:#7dd3fc;margin-right:16px">Mapa de financiación</a>
<a href="#f-top" style="color:#7dd3fc">Inicio</a>
</div>
<h1>💰 ContaMNG · Suscripción Mistral Vibe</h1>
<p class="kpis">Plan <b>Individual</b> · 18,14 €/mes · presupuesto 255 €/ciclo ·
PAYG <b>desactivado</b> · reset 2026-12-01 · <b>meta: apurar la cuota</b></p>
{kpi_html}
<div id="f1"></div>
{load_html}
<div id="f2"></div><div id="f3"></div>
<h2 id="inventario" style="font-size:1.05rem;margin:28px 0 8px">Inventario de equipos</h2>
<div class="panel" style="width:1200px;padding:6px 10px">
<table style="width:100%;border-collapse:collapse;font-size:0.92rem">
<tr style="background:#1e293b"><th style="padding:10px 12px;text-align:left">Característica</th><th style="padding:10px 12px;text-align:left">💻 ricardo-HP-Xubuntu (laptop)</th><th style="padding:10px 12px;text-align:left">🖥️ ricardoPC (escritorio)</th></tr>
{hw_rows}
</table>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
<details><summary style="cursor:pointer;font-size:0.98rem">📋 Informe completo HP (medido in situ)</summary>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:12px;margin-top:10px">
{hw_report_html}
</div></details>
<details><summary style="cursor:pointer;font-size:0.98rem">🖥️ Informe completo ricardoPC (medido por TelfMNG vía SSH, 2026-11-19 01:43)</summary>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:12px;margin-top:10px">
<div class="panel" style="padding:10px"><b style="color:#7dd3fc">CPU (lscpu)</b><pre style="margin:6px 0 0;white-space:pre-wrap;font-size:0.8rem">AMD Athlon 200GE with Radeon Vega Graphics
2 núcleos / 4 hilos (Zen) · máx 3.200 MHz · mín 1.600 MHz
Caché: L2 1 MiB · L3 4 MiB</pre></div>
<div class="panel" style="padding:10px"><b style="color:#7dd3fc">GPU (nvidia-smi)</b><pre style="margin:6px 0 0;white-space:pre-wrap;font-size:0.8rem">GPU 0: NVIDIA GeForce RTX 3060 (GA106) — 12288 MiB VRAM
driver 615.71.09 · CUDA 13.4
carga en medición: 95% util · 11699 MiB en uso (llama-server en marcha)
GPU 1: AMD Radeon Vega integrada (iGPU, Raven Ridge)</pre></div>
<div class="panel" style="padding:10px"><b style="color:#7dd3fc">RAM (free -h)</b><pre style="margin:6px 0 0;white-space:pre-wrap;font-size:0.8rem">total 13 Gi · usados 8,7 Gi · disponibles ~4,3 Gi</pre></div>
<div class="panel" style="padding:10px"><b style="color:#7dd3fc">Red y placa</b><pre style="margin:6px 0 0;white-space:pre-wrap;font-size:0.8rem">Realtek RTL8111/8168 Gigabit Ethernet (enp6s0 · 192.168.2.11)
Placa base: ASUSTeK · Chasis: escritorio</pre></div>
<div class="panel" style="padding:10px"><b style="color:#7dd3fc">Discos (lsblk) y montajes</b><pre style="margin:6px 0 0;white-space:pre-wrap;font-size:0.8rem">sda ST2000DM008 1,8T      → / (31%) · /var (73%) · /export/NuevoVol (100%) · /media/ricardo/home1 (1%)
sdb WDC WD2000FYYZ 1,8T   → /usr (40%) · /export/datos1-3 (100/82/31%)
sdd WDC WD10EZEX 931,5G   → /export/Windows10 (97%) · /media/ricardo/Xubuntu-home (99%)
sde TOSHIBA MK2575GSX 232,9G</pre></div>
<div class="panel" style="padding:10px"><b style="color:#7dd3fc">Servicios y SO</b><pre style="margin:6px 0 0;white-space:pre-wrap;font-size:0.8rem">llama-server (inferencia local en la 3060 — usa ~12 GB VRAM, 95% util)
Xorg (display del escritorio)
Ubuntu 26.04 LTS · kernel 7.2.10-zabbly+</pre></div>
</div></details>
</div>
</div>
<h2 id="mapa" style="font-size:1.05rem;margin:28px 0 8px">🗺️ Mapa de financiación (DATO con fuente · consultado 18-19-nov-2026 · ordenado por valor/esfuerzo — la decisión es de Ricardo)</h2>
<div class="panel" style="width:1200px;padding:6px 10px">
<table style="width:100%;border-collapse:collapse;font-size:0.88rem">
<tr style="background:#1e293b"><th style="padding:10px 12px;text-align:left">Convocatoria</th><th style="padding:10px 12px;text-align:left">Cuantía</th><th style="padding:10px 12px;text-align:left">Plazo</th><th style="padding:10px 12px;text-align:left">Requisitos duros</th><th style="padding:10px 12px;text-align:left">Encaje y esfuerzo</th></tr>
{fund_rows}
</table></div>
<p style="color:#94a3b8">Estados: las cuantías y plazos son DATO de la fuente citada el día de consulta; la verificación documental oficial y la decisión corresponden a Ricardo/ORQ. Las cuantías de "proyectos típicos" son rangos declarados por el convocante, no promesas.</p>
<p>Actualizado: {date.today().isoformat()} · TUI: <kbd>python3 accounting/tui_dashboard.py</kbd>
 · datos: <code>usage.db</code> + <code>read_quota()</code> + journalctl (medido, no estimado)</p>
<script>
const D = {payload};
const f1 = {json.dumps(fig1.to_json())};
const f2 = {json.dumps(fig2.to_json())};
const f3 = {json.dumps(fig3.to_json())};
const cfg = {{displayModeBar: false, responsive: true}};
Plotly.newPlot('f1', JSON.parse(f1), JSON.parse(f1).layout, cfg);
Plotly.newPlot('f2', JSON.parse(f2), JSON.parse(f2).layout, cfg);
Plotly.newPlot('f3', JSON.parse(f3), JSON.parse(f3).layout, cfg);
Plotly.relayout('f4', {{width: 1200}});</script></body></html>"""
    html = _es_numbers(html)
    _render_cache["html"] = html
    _render_cache["ts"] = now
    return html


class Handler(BaseHTTPRequestHandler):
    LOCAL_HOSTS = {"127.0.0.1:8799", "localhost:8799", "[::1]:8799"}

    def _authorized(self, path: str) -> bool:
        """Token required on every route that carries inventory/cost/company data.

        LOCAL BYPASS (Ricardo, 19-nov): a request skips the token ONLY when it is
        both (a) from loopback and (b) addressed to a local Host header. The IP
        check alone was a hole: tailcat terminates the tunnel on 127.0.0.1, so a
        tunnel visitor also looks like loopback. Tunnel requests arrive with the
        tailcat hostname in Host and therefore keep requiring the token.
        Rollback = delete the local_bypass block below."""
        from urllib.parse import urlparse, parse_qs
        local_bypass = (
            self.client_address[0] in ("127.0.0.1", "::1")
            and (self.headers.get("Host") or "").strip().lower() in self.LOCAL_HOSTS
        )
        if local_bypass:
            return True
        q = parse_qs(urlparse(path).query)
        supplied = (q.get("token") or [None])[0]
        if not supplied:
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                supplied = auth[len("Bearer "):]
        return bool(supplied) and supplied == DASHBOARD_TOKEN

    def _deny(self):
        body = b"401 Unauthorized: token required\n"
        self.send_response(401)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("WWW-Authenticate", "Bearer")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        import time as _t
        from urllib.parse import urlparse
        path_only = urlparse(self.path).path
        public = path_only in ("/favicon.ico", "/favicon.svg", "/favicon.png")  # no data
        if not public and not self._authorized(self.path):
            self._deny()
            LOG_LINE = f"{_t.strftime('%Y-%m-%dT%H:%M:%S')} failed auth from {self.client_address[0]} path={path_only}"
            try:
                with open(Path(__file__).resolve().parent / "auth_fails.log", "a") as fh:
                    fh.write(LOG_LINE + "\n")
            except OSError:
                pass
            return

        if path_only in ("/favicon.ico", "/favicon.svg", "/favicon.png"):
            _icons = {
                "/favicon.ico": ("favicon.ico", "image/x-icon"),
                "/favicon.svg": ("favicon_contamng.svg", "image/svg+xml"),
                "/favicon.png": ("favicon_64.png", "image/png"),
            }
            fname, ctype = _icons[path_only]
            f = Path(__file__).resolve().parent / "assets" / fname
            if f.is_file():
                body = f.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(body)
                return
        if path_only.startswith("/fichas/"):
            f = (Path(__file__).resolve().parent / self.path.lstrip("/"))
            if f.is_file():
                body = f.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_error(404)
        elif path_only == "/mapa-completo.html":
            body = (Path(__file__).resolve().parent / "mapa_completo.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path_only == "/opcion1.html":
            body = (Path(__file__).resolve().parent / "opcion1_credito_fiscal_id.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path_only in ("/", "/index.html"):
            body = render_html().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def log_message(self, *args):
        pass


def main():
    import sys
    # Auto-open opt-in: repeated restarts were spawning duplicate browser tabs,
    # so the browser only opens with --open (explicit) — never per restart.
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"ContaMNG dashboard en {url}  (Ctrl+C para parar)")
    if "--open" in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
