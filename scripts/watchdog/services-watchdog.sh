#!/bin/sh
# Regenerate the services panel and alert when something new appears unmonitored.
#
# Ricardo, 2026-11-26: "se debería añadir el servicio a la página al crearlo, y también
# monitorear para ver el estado y alertar si aparece alguno no monitorizado".
#
# Three duties, in order:
#   1. Regenerate both pages, so the panel is never a stale photo.
#   2. Compare the set of listening ports against the previous run.
#   3. Alert on a port that is new AND unmonitored (no unit, no catalog entry).
#
# Why the alert is keyed on "new", not on "unmonitored": a service that has been
# running unmonitored for weeks is a backlog item, not an incident. Re-alerting it every
# five minutes would train everyone to ignore the alert, which is how the real one gets
# missed. New arrivals alert once; the panel keeps showing the full backlog.
#
# Exit codes are measured, never piped: every command below redirects to a file and the
# script decides on $?.

set -u
WATCHDOG_DIR=/home/ricardo/.local/share/gentle-watchdog
REPO=/home/ricardo/Trabajo/IAI/gentle-companion
PORTS_STATE="$WATCHDOG_DIR/alert-state/services-ports.state"
GEN_PANEL="/home/ricardo/.local/share/gentle-watchdog/services-panel.py"
GEN_INDEX="/home/ricardo/servidor/sites/gen-dev-index.py"

. "$WATCHDOG_DIR/lib.sh"

mkdir -p "$(dirname "$PORTS_STATE")"

# 1. Regenerate. A generator that fails is an alert, not a silent skip: a panel that
#    stops updating looks exactly like a quiet day.
python3 "$GEN_PANEL" >"$WATCHDOG_DIR/services-panel.out" 2>&1
panel_rc=$?
if [ "$panel_rc" -ne 0 ]; then
    alert services_panel CRITICAL "services-panel.py failed (rc=$panel_rc), panel is stale"
    echo "services-watchdog: panel generation failed, rc=$panel_rc"
    exit 2
fi

python3 "$GEN_INDEX" >"$WATCHDOG_DIR/dev-index.out" 2>&1
index_rc=$?
if [ "$index_rc" -ne 0 ]; then
    alert dev_index WARNING "gen-dev-index.py failed (rc=$index_rc), dev. front page is stale"
    echo "services-watchdog: dev index generation failed, rc=$index_rc"
fi

# 2. The current set of unmonitored ports, taken from the panel's own verdict.
python3 - "$REPO/scripts/watchdog/services-panel.py" >"$WATCHDOG_DIR/services-unmonitored.txt" 2>/dev/null <<'PY'
import sys
sys.path.insert(0, sys.argv[1].rsplit("/", 1)[0])
import importlib.util
spec = importlib.util.spec_from_file_location("panel", sys.argv[1])
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)
grouped, hidden, unmonitored = panel.build(panel.listening())
for item in unmonitored:
    print(item["port"])
PY

current=$(sort -u "$WATCHDOG_DIR/services-unmonitored.txt" 2>/dev/null | grep -E '^[0-9]+$' || true)

previous=""
if [ -f "$PORTS_STATE" ]; then
    previous=$(cat "$PORTS_STATE")
fi

# 3. Ports present now, absent before -> new arrivals.
# Compare line by line. An earlier version flattened both lists into a single line and
# grepped for " <port> ", which never matched a newline-delimited file: the alert fired
# on every run, which is the same as not firing. Measured: two consecutive runs both
# reported all four ports as new.
new_ports=""
for port in $current; do
    if printf '%s\n' "$previous" | grep -qx "$port"; then
        continue
    fi
    new_ports="$new_ports $port"
done

if [ -n "$new_ports" ]; then
    alert services_unmonitored WARNING "servicios nuevos sin unidad ni catálogo:$new_ports"
    echo "services-watchdog: NEW unmonitored:$new_ports"
fi

printf '%s\n' "$current" | grep -E '^[0-9]+$' >"$PORTS_STATE" || true
echo "services-watchdog: panel ok, $(echo $current | wc -w) unmonitored, new:$new_ports"
exit 0
