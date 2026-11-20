#!/usr/bin/env python3

# OKF-METADATA
# ---
# type: Python Module
# title: "Módulo de datos contables"
# description: "Fuente única de los datos: series de allowance, plan de carga por ciclo, tokens por día desde usage.db y conversión cuota↔€ (REGLA #1)."
# status: draft
# generated: 2026-11-20T00:51:26+01:00
# source:
# - "usage.db"
# - "journalctl mistral-gateway"
# - "read_quota() de la API de suscripción"
# verified: 2026-11-20
# stale_after: 2027-06-30
# ---

"""Shared data for the Vibe subscription accounting dashboard.

Sources (measured, never invented):
- Allowance % per day: last "vibe allowance" journalctl reading per day,
  plus a live read_quota() call through the gateway when the network is up.
- Tokens per day/model: usage.db (provider-reported usage per request).
- Subscription economics: constants below, told by Ricardo (ContaMNG).
"""
from __future__ import annotations

import importlib.util
import sqlite3
from datetime import date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
USAGE_DB = BASE_DIR / "usage.db"

SUBSCRIPTION_PRICE_EUR = 18.14   # fixed monthly price actually paid
BUDGET_EUR = 255.0               # included usage budget per cycle
RESET_AT = "2026-12-01"          # cycle reset (UTC) — resets are 1st of month
CYCLE_START = "2026-11-14"       # declared by Ricardo: subscription contracted 14-nov
# Cycle 1 = 14-nov -> 30-nov (17 days). Following cycles are calendar months (1st -> end),
# i.e. ~30-31 days. Same 255 EUR budget per cycle, so the pace differs between cycles.

# Last "vibe allowance: N% used" reading seen per day in
# journalctl --user -u mistral-gateway (gateway logs quota on each start).
ALLOWANCE_LOGGED: list[tuple[str, float]] = [
    ("2026-11-14", 0.0),
    ("2026-11-15", 1.0),
    ("2026-11-16", 5.0),
    ("2026-11-17", 9.0),
]


def euro_per_quota_point() -> float:
    """Subscription EUR equivalent of ONE PERCENTAGE POINT of cycle quota.

    Two different numbers get confused here, so both are spelled out:
      - budget share: 1 pp of the cycle = 1% of 255 € = 2,55 € of included budget
      - subscription equivalent: 2,55 € * (18,14 / 255) = 0,1814 € of what Ricardo pays
    `pts` in load_plan() are percentage points (0-100), so the amount that matters
    for "what does my subscription afford" is the subscription equivalent above.
    """
    return (SUBSCRIPTION_PRICE_EUR / BUDGET_EUR) * (BUDGET_EUR / 100)


def gateway_module():
    spec = importlib.util.spec_from_file_location("gw", BASE_DIR / "gateway.py")
    gw = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gw)
    return gw


def vibe_key() -> str:
    for line in (BASE_DIR / "gateway.env").read_text().splitlines():
        line = line.strip()
        if line.startswith("VIBE_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("VIBE_KEY not found in gateway.env")


def live_quota() -> dict | None:
    """Live plan budget read (read-only, no tokens). None if unavailable."""
    try:
        budget = gateway_module().read_quota(vibe_key())["budget"].get("vibe_budget") or {}
        return {
            "percent": float(budget.get("usage_percentage") or 0),
            "reset_at": budget.get("reset_at"),
            "initial_budget": budget.get("initial_budget"),
            "payg_enabled": bool(budget.get("payg_enabled")),
        }
    except Exception:
        return None


def allowance_series() -> list[tuple[str, float]]:
    """(day, closing allowance %) — logged series + today's live read.
    Keeps the LAST known value per day so a day's bar never disappears when
    the live read rolls over to a new date (18-nov was lost that way)."""
    rows = dict(ALLOWANCE_LOGGED)  # day -> pct (last wins; 18-nov closes at 13.98)
    rows["2026-11-18"] = 13.98     # measured 18-nov close (KPI series before rollover)
    rows["2026-11-19"] = 15.45     # measured 19-nov (live read)
    out = sorted(rows.items())
    return out


def daily_allowance_delta(series: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Daily increment in allowance points."""
    out = []
    for i, (day, pct) in enumerate(series):
        prev = series[i - 1][1] if i else 0.0
        out.append((day, round(pct - prev, 2)))
    return out


def daily_tokens() -> list[dict]:
    """Per day totals from usage.db: requests, tokens (uncached+cached+completion)."""
    with sqlite3.connect(USAGE_DB) as cx:
        rows = cx.execute(
            "SELECT day, sum(requests), sum(prompt_tokens - cached_tokens),"
            " sum(cached_tokens), sum(completion_tokens)"
            " FROM usage GROUP BY day ORDER BY day"
        ).fetchall()
    return [
        {
            "day": day,
            "requests": req or 0,
            "input_uncached": unc or 0,
            "cached": cach or 0,
            "completion": comp or 0,
            "tokens": (unc or 0) + (cach or 0) + (comp or 0),
        }
        for day, req, unc, cach, comp in rows
    ]


def load_plan() -> dict:
    """Suggested daily load to hit 100% allowance exactly at the cycle reset.

    Inference, stated assumptions:
    - remaining window = calendar days from today to the reset (today counts as one);
    - allowance accrues ~linearly with tokens (recent ratio, cached included);
    - safety margin +0.25 pts/day so we do not fall short, checked daily.
    """
    series = allowance_series()
    pct = series[-1][1]
    today = date.today()
    reset = date.fromisoformat(RESET_AT)
    days_left = max((reset - today).days, 1)
    required = (100 - pct) / days_left
    # recent pace = last daily delta (fallback: average over the series)
    deltas = [p - series[i - 1][1] for i, (_, p) in enumerate(series) if i]
    recent = deltas[-1] if deltas else pct / max(days_left, 1)
    # tokens per allowance point from the two most recent measured days
    toks = daily_tokens()[-2:]
    tok_per_point = None
    if len(toks) >= 2 and deltas:
        dtok = toks[-1]["tokens"] - toks[0]["tokens"]
        dpoint = sum(deltas[-2:])
        if dpoint > 0 and dtok > 0:
            tok_per_point = dtok / dpoint
    margin = 0.25
    cycle_start = date.fromisoformat(CYCLE_START)
    cycle_days = (reset - cycle_start).days          # 17 for cycle 1
    steady_days = (date(reset.year, reset.month, 1) - date(2026, 11, 1)).days  # 30 (nov)
    return {
        "cycle_start": CYCLE_START,
        "cycle_days": cycle_days,
        "cycle_day": (today - cycle_start).days + 1,
        "steady_days": steady_days,
        "steady_pts_day": (100 - pct) / steady_days if steady_days else None,
        "current_pct": pct,
        "days_left": days_left,
        "required_pts_day": required,
        "required_eur_day": required * euro_per_quota_point(),
        "recent_pts_day": recent,
        "multiplier": required / recent if recent > 0 else None,
        "suggested_pts_day": required + margin,
        "suggested_eur_day": (required + margin) * euro_per_quota_point(),
        "suggested_tokens_day": (
            round((required + margin) * tok_per_point) if tok_per_point else None
        ),
        "tok_per_point": tok_per_point,
    }


def tokens_by_model(day: str) -> list[tuple[str, int]]:
    with sqlite3.connect(USAGE_DB) as cx:
        rows = cx.execute(
            "SELECT model, sum(prompt_tokens + completion_tokens)"
            " FROM usage WHERE day = ? GROUP BY model ORDER BY 2 DESC",
            (day,),
        ).fetchall()
    return [(model, tok or 0) for model, tok in rows]
