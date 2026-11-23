#!/bin/sh
# Watchdog shared library: config, rate-limited alerting, recovery notices.
# Sourced by check-router.sh, check-reachability.sh, check-agents.sh.

WATCHDOG_DIR=/home/ricardo/.local/share/gentle-watchdog
. "$WATCHDOG_DIR/thresholds.conf"

mkdir -p "$(dirname "$LOG")" "$STATE"

now_epoch() { date +%s; }

timestamp() { date '+%Y-%m-%dT%H:%M:%S'; }

# alert <key> <severity> <message>
# Rate limited per key: at most one alert per RATE_LIMIT_SEC, but recovery is
# always reported exactly once after a raised condition clears.
alert() {
    _key="$1"
    _sev="$2"
    _msg="$3"
    _now=$(now_epoch)
    _f="$STATE/$_key"

    _prev_sev=""
    _prev_ts=0
    if [ -f "$_f" ]; then
        _prev_sev=$(cut -d' ' -f1 "$_f" 2>/dev/null)
        _prev_ts=$(cut -d' ' -f2 "$_f" 2>/dev/null)
        [ -z "$_prev_ts" ] && _prev_ts=0
    fi

    # Recovery: condition cleared, we had an active alert.
    if [ "$_sev" = "OK" ]; then
        if [ -n "$_prev_sev" ] && [ "$_prev_sev" != "OK" ]; then
            printf '%s OK    %-14s RECOVERED: %s\n' "$(timestamp)" "$_key" "$_msg" >> "$LOG"
            printf 'OK %s\n' "$_now" > "$_f"
        fi
        return 0
    fi

    # Already alerted for this key recently and same severity: stay quiet.
    _delta=$((_now - _prev_ts))
    if [ -n "$_prev_sev" ] && [ "$_prev_sev" != "OK" ] && [ "$_delta" -lt "$RATE_LIMIT_SEC" ]; then
        return 0
    fi

    printf '%s %-5s %-14s %s\n' "$(timestamp)" "$_sev" "$_key" "$_msg" >> "$LOG"
    printf '%s %s\n' "$_sev" "$_now" > "$_f"
    return 1   # caller treats exit 1 as "this is a fresh alert worth notifying"
}

# Emits a compact summary of currently raised conditions (for the report).
raised_conditions() {
    for _f in "$STATE"/*; do
        [ -f "$_f" ] || continue
        _sev=$(cut -d' ' -f1 "$_f")
        [ "$_sev" = "OK" ] && continue
        printf '%s(%s) ' "$(basename "$_f")" "$_sev"
    done
}
