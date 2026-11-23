#!/usr/bin/env python3
"""Report per-session context health from the session transcripts.

Why this exists: on 2026-11-23 a session was found degraded — five days old, two
compactions, 48% of its window, summaries stacked — and the only reason anyone
knew was that Ricardo asked directly. The existing watchdog caught *thrash*
(five compactions in thirty minutes), which is the acute symptom. It never
looked at the chronic one: a session that compacted once and quietly carries
less room for the rest of its life.

Design rules taken from failures already paid for:

1. Read the jsonl. UI labels have lied twice (2026-11-19).
2. Parse JSON; never match `"type":"compaction"` as a substring. The first
   version of compaction-window.py depended on the serializer emitting no space
   after the colon, and its own fixture read as zero records — a reader that
   finds nothing and says so politely is worse than one that errors.
3. Read each model's window from models.json. A bare percentage invites a wrong
   decision: 40% is routine on 1M and an emergency on 139k.
4. When a session cannot be read, report UNVERIFIED. Silence that looks like
   health is the failure mode this whole file exists to prevent.

Usage:
    health-report.py [--json] [--sessions-dir DIR]

Exit codes: 0 always when it produced a report (even a degraded one); 2 when it
could not read enough to report at all.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

AGENT_DIRS = [
    Path.home() / ".gentle-shell/agent",
    Path.home() / ".pi/agent",
]

# Fallback when models.json says nothing. Kept explicit rather than guessed.
DEFAULT_WINDOW = 1_048_576
DEFAULT_RESERVE = 209_715


def load_models(agent_dir: Path) -> dict[str, dict]:
    """Map model id -> {window, reserve, keep_recent, enabled, source}.

    Carries the compaction settings alongside the numbers because a percentage on its
    own cannot be interpreted. Ricardo asked for the configured values to appear on the
    board: a reader who sees `40%` and does not know whether the reserve is 209,715 or
    36,429 cannot tell routine from emergency.

    `source` records where each value came from — model override, global default, or
    the built-in fallback — so a wrong reading points at its own cause instead of
    looking like a measurement.
    """
    windows: dict[str, dict] = {}
    models_file = agent_dir / "models.json"
    try:
        data = json.loads(models_file.read_text())
    except (OSError, ValueError):
        data = {}

    for provider in (data.get("providers") or {}).values():
        for model in provider.get("models") or []:
            mid = model.get("id")
            if mid and model.get("contextWindow"):
                windows[mid] = {
                    "window": int(model["contextWindow"]),
                    "reserve": None,
                    "keep_recent": None,
                    "enabled": None,
                    "source": "window: models.json",
                }

    try:
        settings = json.loads((agent_dir / "settings.json").read_text())
        compaction = settings.get("compaction") or {}
        default_reserve = compaction.get("reserveTokens")
        keep_recent = compaction.get("keepRecentTokens")
        enabled = compaction.get("enabled")
        overrides = compaction.get("modelOverrides") or {}
        for key, entry in overrides.items():
            mid = key.split("/")[-1]
            reserve = (entry or {}).get("reserveTokens")
            if mid in windows and reserve is not None:
                windows[mid]["reserve"] = int(reserve)
                windows[mid]["source"] = "reserve: model override"
        for entry in windows.values():
            if entry["reserve"] is None:
                if default_reserve:
                    entry["reserve"] = int(default_reserve)
                    entry["source"] = "reserve: global default"
                else:
                    entry["reserve"] = DEFAULT_RESERVE
                    entry["source"] = "reserve: built-in fallback, NOT configured"
            entry["keep_recent"] = int(keep_recent) if keep_recent is not None else None
            entry["enabled"] = enabled
    except (OSError, ValueError):
        for entry in windows.values():
            if entry["reserve"] is None:
                entry["reserve"] = DEFAULT_RESERVE
                entry["source"] = "reserve: built-in fallback, NOT configured"
    return windows


def current_model(events: list[dict]) -> str | None:
    """Last model the session switched to, or the one it started with."""
    model = None
    for event in events:
        if event.get("type") == "model_change":
            model = event.get("model") or event.get("modelId") or model
    return model


def estimate_used(events: list[dict]) -> int:
    """Tokens in play right now, bounded by what the last compaction left behind.

    This is an estimate and is labelled as one. The authoritative figure is the
    provider's count; the jsonl gives us the compaction boundary and the raw size
    since.

    The first version summed the summary plus everything after it and produced
    341% on a session that had compacted nine times — a number above 100% is not a
    measurement, it is proof the estimator is wrong. The cause: `keepRecentTokens`
    means a compaction does not empty the file, it appends a summary and keeps a
    tail, so the raw char count after the event already includes what fits. Taking
    the max of the two bounds instead of their sum keeps the estimate honest, and
    clamping to the window keeps an impossible number from being reported as fact.
    """
    last_compaction = -1
    tokens_before = 0
    for index, event in enumerate(events):
        if event.get("type") == "compaction":
            last_compaction = index
            tokens_before = int(event.get("tokensBefore") or 0)

    if last_compaction < 0:
        chars = sum(len(json.dumps(event, ensure_ascii=False)) for event in events)
        return chars // 4

    tail = events[last_compaction + 1 :]
    summary_chars = len(json.dumps(events[last_compaction].get("summary") or "", ensure_ascii=False))
    tail_chars = sum(len(json.dumps(event, ensure_ascii=False)) for event in tail)
    # The summary plus the kept tail is one population; counting both the raw tail
    # and the summary doubled it. `tokensBefore` is the ceiling the provider saw.
    after = (summary_chars + tail_chars) // 4
    return min(after, tokens_before) if tokens_before else after


def session_report(path: Path, models: dict[str, dict]) -> dict:
    try:
        raw = path.read_text(errors="ignore")
    except OSError as error:
        return {"session": path.stem, "status": "UNVERIFIED", "reason": f"unreadable: {error}"}

    events = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except ValueError:
            continue

    if not events:
        return {"session": path.stem, "status": "UNVERIFIED", "reason": "no parseable events"}

    stamps = [event.get("timestamp") for event in events if event.get("timestamp")]
    compactions = [
        {"at": event.get("timestamp"), "tokensBefore": event.get("tokensBefore")}
        for event in events
        if event.get("type") == "compaction"
    ]

    model = current_model(events)
    spec = models.get(model or "", {})
    window = spec.get("window") or DEFAULT_WINDOW
    reserve = spec.get("reserve") or DEFAULT_RESERVE
    threshold = window - reserve

    used = estimate_used(events)
    # A window cannot hold more than itself. If the estimate exceeds it, the honest
    # report is "the estimate is unreliable here", not a percentage above 100.
    clamped = used > window
    used = min(used, window)
    to_compact = max(0, threshold - used)
    percent = round(100 * used / window, 1)

    started = stamps[0] if stamps else None
    age_days = None
    if started:
        try:
            began = datetime.fromisoformat(started.replace("Z", "+00:00"))
            age_days = round((datetime.now(timezone.utc) - began).total_seconds() / 86400, 1)
        except ValueError:
            pass

    # Judgement, with the reason. Never a bare number.
    reasons = []
    verdict = "healthy"
    if percent >= 60:
        verdict = "pressure"
        reasons.append(f"{percent}% of window used")
    elif to_compact < 50_000:
        verdict = "pressure"
        reasons.append(f"only {to_compact:,} tokens before compaction")
    if len(compactions) >= 2:
        verdict = "degraded" if verdict == "healthy" else "degraded"
        reasons.append(f"{len(compactions)} compactions, summaries stacked")
    if age_days is not None and age_days >= 3:
        reasons.append(f"{age_days}d old, carries its whole history")
    if "bonsai2" in (model or "").lower() and percent >= 40:
        verdict = "degraded" if verdict == "healthy" else verdict
        reasons.append("local model with a 139k window: 40% is near the edge")
    if clamped:
        verdict = "unreliable" if verdict == "healthy" else verdict
        reasons.append("estimate exceeds the window: transcript shape not understood, treat with suspicion")

    return {
        "session": path.stem,
        "status": "ok",
        "model": model or "unknown",
        "window": window,
        "reserve": reserve,
        "threshold": threshold,
        "keep_recent": spec.get("keep_recent"),
        "compaction_enabled": spec.get("enabled"),
        "settings_source": spec.get("source", "unknown"),
        "used_estimate": used,
        "to_compact": to_compact,
        "percent": percent,
        "compactions": compactions,
        "age_days": age_days,
        "verdict": verdict,
        "reasons": reasons or ["within every threshold"],
        "transcript_mb": round(len(raw) / 1_048_576, 1),
        "estimate_clamped": clamped,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--sessions-dir", action="append", default=None)
    args = parser.parse_args()

    roots = [Path(p) for p in args.sessions_dir] if args.sessions_dir else [
        agent / "sessions" for agent in AGENT_DIRS if (agent / "sessions").is_dir()
    ]
    if not roots:
        print("UNVERIFIED: no sessions directory found", file=sys.stderr)
        return 2

    models: dict[str, dict] = {}
    for agent in AGENT_DIRS:
        models.update(load_models(agent))

    # Each root carries its own settings, and they are NOT the same: on 2026-11-23
    # ~/.gentle-shell/agent set reserveTokens 209,715 for deepseek while ~/.pi/agent
    # still had 419,430. Merging every root into one map and keeping the last write
    # made every session claim the same ceiling, so a transcript under .pi was measured
    # against a reserve it never had. The threshold belongs to the root that owns the
    # transcript, so it is read per root.
    reports = []
    for root in roots:
        agent_dir = root.parent
        root_models = load_models(agent_dir) if (agent_dir / "settings.json").is_file() else models
        for path in sorted(root.rglob("*.jsonl")):
            report = session_report(path, root_models)
            report["settings_root"] = str(agent_dir)
            reports.append(report)

    reports.sort(key=lambda r: (r.get("age_days") is None, r.get("age_days") or 0))

    if args.json:
        print(json.dumps({"generated": datetime.now(timezone.utc).isoformat(), "sessions": reports}, indent=2))
        return 0

    if not reports:
        print("UNVERIFIED: no transcripts found")
        return 2

    print(f"{'session':14} {'model':28} {'ctx%':>6} {'to compact':>12} {'comp':>4} {'age':>6}  verdict")
    for report in reports:
        if report["status"] != "ok":
            print(f"{report['session'][:13]:14} {'—':28} {'—':>6} {'—':>12} {'—':>4} {'—':>6}  UNVERIFIED: {report.get('reason')}")
            continue
        print(
            f"{report['session'][:13]:14} {report['model'][:28]:28} {report['percent']:>5}% "
            f"{report['to_compact']:>12,} {len(report['compactions']):>4} "
            f"{report['age_days']:>5}d  {report['verdict']}" if report['age_days'] is not None else ""
        )
        for reason in report["reasons"]:
            print(f"{'':14} └ {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
