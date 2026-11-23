#!/bin/sh
# Reachability watchdog: LAN gateway, internet, and the router's 4G uplink.
# Needs TWO consecutive failures before alerting, because the 4G link blips.
# Detect and report only.
#
# NOTE on topology (corrected 2026-11-19): ricardoHP sits on the router's LAN
# (192.168.2.20). The A2's WiFi AP (192.168.43.1) serves ricardoPC, a DIFFERENT
# segment, and is NOT reachable from here — checking it from the HP produced a
# permanent false positive. The 4G path is verified on the router side instead.

. /home/ricardo/.local/share/gentle-watchdog/lib.sh

FAILFILE_DIR="$WATCHDOG_DIR/streaks"
mkdir -p "$FAILFILE_DIR"

# check_target <key> <host> <severity>
check_target() {
    _key="$1"
    _host="$2"
    _sev="$3"
    _streak_file="$FAILFILE_DIR/$_key"

    if ping -I "$PING_IFACE" -c "$PING_COUNT" -W "$PING_TIMEOUT" "$_host" >/dev/null 2>&1; then
        printf '0' > "$_streak_file"
        alert "$_key" OK "ping $_host ok"
        echo "$_key: OK"
        return 0
    fi

    _streak=$(cat "$_streak_file" 2>/dev/null || echo 0)
    case "$_streak" in ''|*[!0-9]*) _streak=0 ;; esac
    _streak=$((_streak + 1))
    printf '%s' "$_streak" > "$_streak_file"

    if [ "$_streak" -lt 2 ]; then
        echo "$_key: fail #$_streak (below alert threshold)"
        return 0
    fi

    alert "$_key" "$_sev" "ping $_host failed $_streak consecutive times"
    echo "$_key: FAIL x$_streak"
    return 1
}

# The 4G uplink lives behind the router: check its default route exists and
# that the router itself can still reach the internet through it.
check_uplink() {
    _key="net_uplink"
    _streak_file="$FAILFILE_DIR/$_key"

    _ok=$(/home/ricardo/.local/share/gentle-watchdog/router-access.sh \
        'ip route | grep -q "^default" && ping -c1 -W3 8.8.8.8 >/dev/null 2>&1 && echo UP || echo DOWN' 2>/dev/null)

    if [ "$_ok" = "UP" ]; then
        printf '0' > "$_streak_file"
        alert "$_key" OK "router 4G uplink up"
        echo "$_key: OK"
        return 0
    fi

    _streak=$(cat "$_streak_file" 2>/dev/null || echo 0)
    case "$_streak" in ''|*[!0-9]*) _streak=0 ;; esac
    _streak=$((_streak + 1))
    printf '%s' "$_streak" > "$_streak_file"

    if [ "$_streak" -lt 2 ]; then
        echo "$_key: fail #$_streak (below alert threshold)"
        return 0
    fi

    alert "$_key" WARN "router 4G uplink down $_streak consecutive checks"
    echo "$_key: FAIL x$_streak"
    return 1
}

check_target net_lan "$GW_LAN" CRIT
check_target net_wan "$GW_WAN" WARN
check_uplink

exit 0   # condition state lives in the log; relay-gate decides notification
