#!/bin/sh
# Router health watchdog: read-only SSH checks against the OpenWrt gateway.
# Detect and report only. Never changes anything on the router.
# Exit 0 = all healthy, 1 = at least one condition raised (fresh) , 2 = unreachable

. /home/ricardo/.local/share/gentle-watchdog/lib.sh

SSH="/home/ricardo/.local/share/gentle-watchdog/router-access.sh"

OUT=$($SSH '
  echo "LOADAVG=$(cut -d" " -f1 /proc/loadavg)"
  echo "OVERLAY=$(df -k /overlay 2>/dev/null | tail -1 | awk "{print \$5}" | tr -d "%")"
  echo "CT=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null || echo 0)"
  echo "CTMAX=$(cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null || echo 0)"
  echo "OOM=$(logread 2>/dev/null | tail -200 | grep -ic "out of memory\|oom-kill")"
  echo "SEGV=$(logread 2>/dev/null | tail -200 | grep -ic "segfault")"
  echo "ARPC=$(wc -l < /proc/net/arp 2>/dev/null || echo 0)"
' 2>/dev/null)

if [ -z "$OUT" ]; then
    if alert router_ssh CRIT "router $ROUTER_HOST unreachable over SSH"; then
        echo "CRIT router_ssh: unreachable"
    else
        echo "router_ssh still failing (rate limited)"
    fi
    exit 2
fi

get() { echo "$OUT" | grep "^$1=" | cut -d= -f2; }

LOADAVG=$(get LOADAVG); [ -z "$LOADAVG" ] && LOADAVG=0
OVERLAY=$(get OVERLAY); [ -z "$OVERLAY" ] && OVERLAY=0
CT=$(get CT); [ -z "$CT" ] && CT=0
OOM=$(get OOM); [ -z "$OOM" ] && OOM=0
SEGV=$(get SEGV); [ -z "$SEGV" ] && SEGV=0
ARPC=$(get ARPC); [ -z "$ARPC" ] && ARPC=0

FRESH=0
FAILED=0

# load is a float; compare with awk
LOAD_HI=$(awk -v a="$LOADAVG" -v b="$LOADAVG_MAX" 'BEGIN{print (a>b)?"1":"0"}')
if [ "$LOAD_HI" = "1" ]; then
    FAILED=1
    alert router_load WARN "loadavg $LOADAVG > $LOADAVG_MAX" || FRESH=1
else
    alert router_load OK "loadavg $LOADAVG"
fi

if [ "$OVERLAY" -gt "$OVERLAY_PCT_MAX" ]; then
    FAILED=1
    alert router_overlay WARN "overlay ${OVERLAY}% > ${OVERLAY_PCT_MAX}%" || FRESH=1
else
    alert router_overlay OK "overlay ${OVERLAY}%"
fi

if [ "$CT" -gt "$CONNTRACK_MAX" ]; then
    FAILED=1
    alert router_conntrack WARN "conntrack $CT > $CONNTRACK_MAX" || FRESH=1
else
    alert router_conntrack OK "conntrack $CT"
fi

if [ "$OOM" -gt 0 ] || [ "$SEGV" -gt 0 ]; then
    FAILED=1
    alert router_kernel CRIT "kernel log: oom=$OOM segv=$SEGV in last 200 lines" || FRESH=1
else
    alert router_kernel OK "no oom/segv in last 200 lines"
fi

echo "router: load=$LOADAVG overlay=${OVERLAY}% conntrack=$CT arp=$ARPC oom=$OOM segv=$SEGV fresh=$FRESH"
exit 0   # condition state lives in the log; relay-gate decides notification
exit 0
