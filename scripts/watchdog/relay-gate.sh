#!/bin/sh
# Alert publisher: turns new WARN/CRIT log lines into a rolling inbox file.
#
# HISTORY, because the shape of this file looks odd otherwise:
#   v1 was only a PRECONDITION for a pi-prompt action. That prompt created a NEW
#      Pi session per alert: nine sessions in four hours to deliver one line of
#      already-formatted text. (Measured 2026-11-20: 01a1f5c1, f5c9, f5e5, f62e,
#      f637, f641, f64a, f653, f69c.)
#   v2 (this) is the PUBLISHER. It runs as a plain `command` action: no model, no
#      session, no quota. It always exits 0, because a delivery problem must
#      never be reported as the emergency it was meant to announce.
#
# Ricardo's actual want (2026-11-21): not a stream of interruptions, but a
# STATUS MONITOR he can look at — "un monitor de estado del servidor, tanto en
# TUI como en GUI por web". So the outputs here are PULL-based:
#   - watchdog-alerts.txt : rolling inbox (last 200 lines), ready for a TUI/GUI
#   - watchdog.log        : the machine record, written by lib.sh as it happens
#   - notify-send         : best-effort, CRIT only, silent when there is no DBUS

WATCHDOG_DIR=/home/ricardo/.local/share/gentle-watchdog
. "$WATCHDOG_DIR/thresholds.conf"

SENT="$WATCHDOG_DIR/last-notified"
PENDING="$WATCHDOG_DIR/pending-alerts"
ALERTS="$WATCHDOG_DIR/watchdog-alerts.txt"

# How many alert lines have we already published?
LAST=0
[ -f "$SENT" ] && LAST=$(cat "$SENT" 2>/dev/null)
case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac

TOTAL=0
[ -f "$LOG" ] && TOTAL=$(wc -l < "$LOG" 2>/dev/null)
case "$TOTAL" in ''|*[!0-9]*) TOTAL=0 ;; esac

if [ "$TOTAL" -le "$LAST" ]; then
    exit 0   # nothing new: nothing to publish, and that is not a failure
fi

# Take only the new WARN/CRIT lines since the last publication.
tail -n $((TOTAL - LAST)) "$LOG" 2>/dev/null | grep -E ' (WARN|CRIT) ' > "$PENDING" 2>/dev/null

if [ ! -s "$PENDING" ]; then
    printf '%s' "$TOTAL" > "$SENT"
    exit 0   # new lines were all recoveries; nothing to alert
fi

printf '%s' "$TOTAL" > "$SENT"

# 1. Rolling inbox for the monitor to read. Bounded so it can be shown on a
#    small screen without paging logic.
cat "$PENDING" >> "$ALERTS" 2>/dev/null
if [ -f "$ALERTS" ]; then
    tail -n 200 "$ALERTS" > "$ALERTS.tmp" 2>/dev/null && mv "$ALERTS.tmp" "$ALERTS"
fi

# 2. Best-effort desktop notice, CRIT only. Every part of this may fail (no
#    DISPLAY, no DBUS, no session) and none of it may affect the exit status.
if command -v notify-send >/dev/null 2>&1; then
    CRITS=$(grep -c ' CRIT ' "$PENDING" 2>/dev/null)
    case "$CRITS" in ''|*[!0-9]*) CRITS=0 ;; esac
    if [ "$CRITS" -gt 0 ]; then
        notify-send -u critical "gentle-watchdog" "$(grep ' CRIT ' "$PENDING" | head -3)" >/dev/null 2>&1 || true
    fi
fi

exit 0
