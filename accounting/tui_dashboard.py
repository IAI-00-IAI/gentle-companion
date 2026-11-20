#!/usr/bin/env python3

# OKF-METADATA
# ---
# type: Python Module
# title: "Dashboard TUI (rich)"
# description: "Vista de terminal con ciclos, progresión de cuota y tokens por modelo, para revisión rápida sin navegador."
# status: draft
# generated: 2026-11-20T00:51:26+01:00
# source:
# - "accounting/data.py"
# verified: 2026-11-20
# stale_after: 2027-06-30
# ---

"""TUI dashboard for the Vibe subscription accounting (rich-based).

Run:  python3 accounting/tui_dashboard.py
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from rich.align import Align
from rich.bar import Bar
from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text

sys.path.insert(0, str(Path(__file__).resolve().parent))
import data  # noqa: E402

EUR_PER_POINT = data.euro_per_quota_point()
CONSOLE = Console()


def banner() -> Rule:
    return Rule(
        f"[bold cyan]ContaMNG · Vibe subscription[/] · {date.today().isoformat()} · "
        f"[yellow]meta: apurar la cuota[/]"
    )


def cycle_panel(series: list[tuple[str, float]]) -> Panel:
    live = data.live_quota()
    pct = live["percent"] if live else (series[-1][1] if series else 0.0)
    used_eur = pct / 100 * data.BUDGET_EUR
    sub_equiv = pct * EUR_PER_POINT
    left_pct = 100 - pct
    used = Table.grid(padding=(0, 2))
    used.add_row("[b]Cuota usada[/]", f"[bold green]{pct:.2f}%[/]  ({used_eur:.2f} € de {data.BUDGET_EUR:.0f} €)")
    used.add_row("[b]Suscr. equivalente[/]", f"{sub_equiv:.2f} € de 18,14 €")
    used.add_row("[b]Cuota restante[/]", f"{left_pct:.2f}%  ({data.BUDGET_EUR - used_eur:.2f} €)")
    used.add_row("[b]Reset ciclo[/]", str(live["reset_at"]) if live else data.RESET_AT)
    used.add_row("[b]PAYG[/]", "activo" if (live and live["payg_enabled"]) else "desactivado")
    return Panel(
        Group(
            used,
            Text(),
            Align.center(Bar(size=50, begin=0, end=100, width=round(pct), color="green")),
            Align.center(Text(f"{pct:.1f}%", style="bold green")),
        ),
        title="[b]Ciclo en vivo[/]",
        border_style="cyan",
    )


def series_panel(series: list[tuple[str, float]], deltas: list[tuple[str, float]]) -> Panel:
    t = Table(title=None, expand=True)
    t.add_column("Día")
    t.add_column("Acum. %", justify="right")
    t.add_column("Δ %/día", justify="right")
    t.add_column("€ suscr. acum.", justify="right")
    t.add_column("€/día", justify="right")
    t.add_column("Progresión", ratio=2)
    for (day, pct), (_, delta) in zip(series, deltas):
        width = int(pct * 0.8)  # 0..80 chars for 0..100 %
        t.add_row(
            day,
            f"{pct:.2f}%",
            f"+{delta:.2f}",
            f"{pct * EUR_PER_POINT:.2f} €",
            f"{delta * EUR_PER_POINT:.2f} €",
            "[green]" + "█" * max(width, 1) + "[/]",
        )
    return Panel(t, title="[b]Progresión de cuota (medida)[/]", border_style="cyan")


def plan_panel() -> Panel:
    plan = data.load_plan()
    g = Table.grid(padding=(0, 2))
    mu = plan["multiplier"]
    g.add_row("[b]Objetivo[/]", "100% de cuota exactamente el reset (2026-12-01)")
    g.add_row("[b]Ritmo requerido[/]", f"[bold cyan]{plan['required_pts_day']:.2f} % cuota/día[/] "
              f"= {plan['required_eur_day']:.2f} € de suscripción/día")
    g.add_row("[b]Ritmo reciente[/]", f"{plan['recent_pts_day']:.2f} % cuota/día")
    if mu:
        g.add_row("[b]Aceleración[/]", f"[bold yellow]×{mu:.2f}[/] la carga actual")
    g.add_row("[b]Sugerido (margen +0,25)[/]", f"[bold green]{plan['suggested_pts_day']:.2f} % cuota/día[/] "
              f"= {plan['suggested_eur_day']:.2f} € de suscripción/día")
    tok = plan["suggested_tokens_day"]
    if tok:
        g.add_row("[b]Tokens/día sugeridos[/]", f"~{tok:,}")
    else:
        g.add_row("[b]Tokens/día[/]", "[dim]aún sin datos suficientes (se rellena con más historial)[/]")
    return Panel(g, title="[b]Plan de carga sugerido[/]", border_style="yellow")


def tokens_panel() -> Panel:
    rows = data.daily_tokens()
    t = Table(expand=True)
    t.add_column("Día")
    t.add_column("Req.", justify="right")
    t.add_column("Tokens", justify="right")
    t.add_column("Cache", justify="right")
    t.add_column("", ratio=2)
    max_tok = max((r["tokens"] for r in rows), default=1)
    for r in rows[-10:]:
        w = int(r["tokens"] / max_tok * 28)
        t.add_row(
            r["day"],
            f"{r['requests']:,}",
            f"{r['tokens']:,}",
            f"{r['cached']:,}",
            "[blue]" + "▇" * max(w, 1) + "[/]",
        )
    today_tokens = rows[-1] if rows else {}
    by_model = data.tokens_by_model(today_tokens.get("day", date.today().isoformat()))
    t2 = Table(title=f"Tokens de hoy por modelo ({today_tokens.get('day', '-')})", expand=True)
    t2.add_column("Modelo")
    t2.add_column("Tokens", justify="right")
    for model, tok in by_model[:8]:
        t2.add_row(model, f"{tok:,}")
    return Panel(Group(t, Text(), t2), title="[b]Tokens medidos (usage.db)[/]", border_style="cyan")


def build() -> Group:
    series = data.allowance_series()
    deltas = data.daily_allowance_delta(series)
    return Group(
        banner(),
        cycle_panel(series),
        plan_panel(),
        series_panel(series, deltas),
        tokens_panel(),
    )


def main() -> None:
    with Live(build(), console=CONSOLE, refresh_per_second=1, screen=False) as live:
        import time

        while True:
            time.sleep(10)
            live.update(build())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
