#!/usr/bin/env python3
"""Count compactions in a pi session jsonl that fall INSIDE a rolling window.

Why this module exists: the first version counted `"type":"compaction"` over the
whole file lifetime, so a session that compacted five times yesterday afternoon
alerted forever. Measured 2026-11-21 on session 01a1f448: all five compactions
were 20-22 h old, the session was alive and had not compacted since, and the
check still fired six times overnight. Same class of bug as the closed-session
false positive: treating history as current state.

A watchdog reports current trouble. A compaction storm last week is not news.

Why the record type is compared after JSON parsing instead of by substring: the
first attempt matched the literal `"type":"compaction"`, which silently depends
on the serializer emitting no space after the colon. My own test fixture
(json.dumps, which does add a space) was read as zero records — and a reader
that quietly finds nothing is worse than one that errors. A cheap substring
prefilter keeps it fast on 20 MB files; only candidate lines are parsed.

Usage: compaction-window.py <jsonl> <window_minutes>
Prints one integer. Records without a parsable timestamp are skipped rather than
assumed recent, because assuming recent turns missing metadata into a false alarm.
"""

import json
import sys
from datetime import datetime, timedelta, timezone


def parse_ts(value):
    """Parse a pi ISO timestamp; return None when absent or unparseable."""
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def main() -> None:
    if len(sys.argv) < 3:
        print(0)
        return
    path, window_arg = sys.argv[1], sys.argv[2]
    try:
        window_min = float(window_arg)
    except ValueError:
        print(0)
        return

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_min)
    count = 0

    try:
        fh = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        print(0)
        return

    with fh:
        for line in fh:
            # Cheap prefilter: skip lines that cannot contain a compaction type,
            # whatever the whitespace around the colon.
            if "compaction" not in line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj.get("type") != "compaction":
                continue
            when = parse_ts(obj.get("timestamp"))
            if when is None:
                continue
            if when >= cutoff:
                count += 1

    print(count)


if __name__ == "__main__":
    main()
