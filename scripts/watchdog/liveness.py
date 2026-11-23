#!/usr/bin/env python3
"""Decide which session jsonl files belong to LIVE agent sessions.

Liveness oracle is `herdr pane list`, the only source that works from a plain
shell (the watchdog runs as a Companion automation, outside any pi session, so
`intercom` is unavailable there — that was the first failed attempt).

Matching rule, deliberately strict. A jsonl is LIVE only if one of:
  A. Its last `session_info` alias appears in a live pane's terminal_title
     (primary; exact substring match on the alias).
  B. It has NO alias, and its cwd equals an unnamed pane's cwd, AND the file was
     modified within RECENT_MINUTES. The recency guard is what stops every old
     session that happened to share a cwd from being counted as live.

Anything else is CLOSED and skipped. Unmatched live panes are reported on
stderr so a mapping gap is visible instead of silently mis-paired.

Output: "<STATE> <shortid> <alias|cwd> <path>" per line.
Exit codes: 0 ok, 3 herdr unavailable (caller must warn UNVERIFIED).
"""

import json
import os
import re
import subprocess
import sys
import time
import glob

SESSIONS_DIR = "/home/ricardo/.gentle-shell/agent/sessions"
RECENT_MINUTES = 30
MAX_FILES = 20

SID_RE = re.compile(r"_([0-9a-f]{8})-[0-9a-f-]+\.jsonl$")


def live_panes():
    """Return [(pane_id, title, cwd)] for panes that have an agent, or None."""
    try:
        out = subprocess.run(
            ["herdr", "pane", "list"],
            capture_output=True, text=True, timeout=20, check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"herdr failed: {exc}", file=sys.stderr)
        return None
    if out.returncode != 0 or not out.stdout.strip():
        print(f"herdr exit {out.returncode} with no output", file=sys.stderr)
        return None
    try:
        panes = json.loads(out.stdout)["result"]["panes"]
    except (ValueError, KeyError, TypeError) as exc:
        print(f"herdr output unparseable: {exc}", file=sys.stderr)
        return None
    return [
        (p.get("pane_id", "?"), p.get("terminal_title", ""), p.get("cwd", ""),
         p.get("agent_status", "unknown"))
        for p in panes
        if p.get("agent")
    ]


def session_meta(path):
    """Return (shortid, alias, cwd). Alias = last session_info name in the file."""
    match = SID_RE.search(path)
    sid = match.group(1) if match else "unknown"
    alias = ""
    cwd = ""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"type":"session"' in line and not cwd:
                    try:
                        cwd = json.loads(line).get("cwd", "")
                    except ValueError:
                        pass
                elif '"type":"session_info"' in line:
                    try:
                        found = json.loads(line).get("name", "")
                    except ValueError:
                        found = ""
                    if found:
                        alias = found
    except OSError:
        pass
    return sid, alias, cwd


def main():
    panes = live_panes()
    if panes is None:
        print("HERDR_UNAVAILABLE", file=sys.stderr)
        sys.exit(3)

    now = time.time()
    files = sorted(
        glob.glob(os.path.join(SESSIONS_DIR, "*", "*.jsonl")),
        key=os.path.getmtime,
        reverse=True,
    )[:MAX_FILES]

    matched = set()
    rows = []
    for path in files:
        sid, alias, cwd = session_meta(path)
        age_min = (now - os.path.getmtime(path)) / 60.0
        hit = None
        how = ""


        if alias:
            for pane_id, title, _, _st in panes:
                if alias in title:
                    hit, how = pane_id, "alias"
                    break
        if hit is None and not alias and cwd:
            if age_min <= RECENT_MINUTES:
                for pane_id, title, pane_cwd, _st in panes:
                    if pane_cwd == cwd and "agent" in title.lower() or (
                        pane_cwd == cwd and "π" in title
                    ):
                        hit, how = pane_id, "cwd+recent"
                        break

        if hit:
            matched.add(hit)
            status = next(st for pid, _t, _c, st in panes if pid == hit)
            rows.append(("LIVE", sid, f"{alias or cwd}|{status} [{how}]", path))
        else:
            rows.append(("CLOSED", sid, alias or cwd or "(unnamed)", path))

    for pane_id, title, pane_cwd, _st in panes:
        if pane_id not in matched:
            print(f"UNMATCHED PANE {pane_id} title={title!r} cwd={pane_cwd!r}",
                  file=sys.stderr)

    for state, sid, label, path in rows:
        print(f"{state} {sid} {label} {path}")


if __name__ == "__main__":
    main()
