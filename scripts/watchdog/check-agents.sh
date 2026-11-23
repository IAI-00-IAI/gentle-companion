#!/bin/sh
# Agent watchdog: detects exhausted/thrashing agent sessions.
#
# LIVENESS comes from `herdr pane list` via liveness.py, NOT from the filesystem.
# History of this file, so the next maintainer does not repeat it:
#   v1 treated jsonl mtime as liveness -> flagged closed sessions forever
#      (01a1eefd, closed at 22:15, alerted at 22:39 and 00:03).
#   v2 used `intercom` for liveness -> returns nothing outside a pi session, so
#      the watchdog skipped EVERYTHING and went silent. Silence is worse than a
#      false positive: it is indistinguishable from "all healthy".
#   v3 (this one) shells out to herdr, which works from a plain process, and
#      FAILS LOUDLY (UNVERIFIED) if herdr cannot answer.
#
# Signatures: compaction thrash, identical-call loop, stall.
# Detect and report only. Never kills a session.

. /home/ricardo/.local/share/gentle-watchdog/lib.sh

NOW=$(now_epoch)
STREAKS="$WATCHDOG_DIR/streaks"
mkdir -p "$STREAKS"
LIVENESS="$WATCHDOG_DIR/liveness.py"

num() {
    case "$1" in
        ''|*[!0-9]*) echo 0 ;;
        *) echo "$1" ;;
    esac
}

# --- Liveness ---------------------------------------------------------------
LIVE_OUT=$("$LIVENESS" 2>"$WATCHDOG_DIR/liveness.err")
LIVE_RC=$?

if [ "$LIVE_RC" -ne 0 ]; then
    # Never go quiet. Watch everything and mark every alert UNVERIFIED.
    alert agent_liveness WARN "UNVERIFIED: cannot determine live sessions (herdr rc=$LIVE_RC); all recent sessions scanned, alerts may include closed ones" || true
    echo "UNVERIFIED: herdr unavailable (rc=$LIVE_RC) — scanning all recent sessions; alerts marked UNVERIFIED"
    LIVE_IDS=""
    TRUST=0
    # Fallback must actually WATCH things: when liveness is unknown, take the
    # most recent session files ourselves instead of trusting liveness.py output
    # (which is empty when herdr fails). Otherwise we would announce "scanning
    # all" and then scan nothing — the exact silence we are trying to avoid.
    LIVE_OUT=$(find "$SESSION_DIR" -name '*.jsonl' -mmin -180 -size -50M 2>/dev/null \
        | head -12 | while read -r p; do
            sid=$(basename "$p" .jsonl | sed 's/.*_\([0-9a-f]\{8\}\)-.*/\1/')
            printf 'LIVE %s unknown|unknown [fallback] %s\n' "$sid" "$p"
        done)
else
    alert agent_liveness OK "herdr reachable"
    LIVE_IDS=$(echo "$LIVE_OUT" | awk '$1=="LIVE"{print $2}' | sort -u)
    TRUST=1
fi

SKIPPED=0
SKIPPED_IDS=""
WATCHED_IDS=""
FAILED=0

# Files come from liveness.py so there is exactly one notion of "recent".
for f in $(echo "$LIVE_OUT" | awk '{print $NF}'); do
    [ -f "$f" ] || continue
    sid=$(echo "$LIVE_OUT" | awk -v p="$f" '$NF==p{print $2; exit}')
    astatus=$(echo "$LIVE_OUT" | awk -v p="$f" '$NF==p{print $3; exit}' | sed 's/.*|//; s/\[.*//')

    if [ "$TRUST" = "1" ] && ! echo "$LIVE_IDS" | grep -qx "$sid"; then
        SKIPPED=$((SKIPPED + 1))
        SKIPPED_IDS="$SKIPPED_IDS $sid"
        continue
    fi

    WATCHED_IDS="$WATCHED_IDS $sid"
    MARK=""
    [ "$TRUST" = "0" ] && MARK="UNVERIFIED "

    size=$(num "$(wc -c < "$f" 2>/dev/null)")
    mtime=$(num "$(stat -c %Y "$f" 2>/dev/null)")
    age_min=$(( (NOW - mtime) / 60 ))
    # Count compactions INSIDE the rolling window, not over the file's lifetime.
    # Counting lifetime made a session that compacted five times yesterday alert
    # forever (01a1f448, six alerts overnight, all five records 20-22 h old).
    compactions=$(num "$(python3 "$WATCHDOG_DIR/compaction-window.py" "$f" "$COMPACTION_WINDOW_MIN" 2>/dev/null)")

    # Compare the FULL call, not a truncated prefix: two different commands that
    # merely start with the same "cd /repo && ..." are not a loop. Learned by
    # false-positiving on ContaMNG, whose 15 "repeats" were 15 distinct commands.
    longest=$(python3 "$WATCHDOG_DIR/looprun.py" "$f")
    longest_n=$(num "$longest")

    sf="$STREAKS/size_$sid"
    prev_size=$(num "$(cat "$sf" 2>/dev/null)")
    printf '%s' "$size" > "$sf"
    stalled=0
    # A stall means "says it is working but the file stopped growing". An idle
    # session that stops growing is simply idle: that is not a fault.
    if [ "$prev_size" -gt 0 ] && [ "$size" -eq "$prev_size" ] \
       && [ "$age_min" -ge "$STALL_MINUTES" ] && [ "$astatus" = "working" ]; then
        stalled=1
    fi

    if [ "$compactions" -ge "$COMPACTION_COUNT_MAX" ]; then
        FAILED=1
        alert "agent_compaction_$sid" WARN "${MARK}session $sid: $compactions compactions (thrash)" || true
    else
        alert "agent_compaction_$sid" OK "session $sid compactions=$compactions"
    fi

    if [ "$longest_n" -ge "$IDENTICAL_RUN_MAX" ]; then
        FAILED=1
        alert "agent_loop_$sid" WARN "${MARK}session $sid: identical call repeated $longest_n times (loop)" || true
    else
        alert "agent_loop_$sid" OK "session $sid longest identical run=$longest_n"
    fi

    if [ "$stalled" = "1" ]; then
        FAILED=1
        alert "agent_stall_$sid" WARN "${MARK}session $sid: no growth for ${age_min}m (possible stall)" || true
    else
        alert "agent_stall_$sid" OK "session $sid growing or recent"
    fi

    printf 'WATCH %s: %s age=%sm size=%s compactions=%s identical_run=%s stalled=%s\n' \
        "$sid" "$astatus" "$age_min" "$size" "$compactions" "$longest_n" "$stalled"
done

# Auditable silence: always say what was skipped, so "nothing wrong" can be told
# apart from "nothing checked".
printf 'SKIP  %s closed session(s):%s\n' "$SKIPPED" "$SKIPPED_IDS"
printf 'LIVE  watched:%s\n' "$WATCHED_IDS"
[ -s "$WATCHDOG_DIR/liveness.err" ] && sed 's/^/NOTE  /' "$WATCHDOG_DIR/liveness.err"

exit 0   # condition state lives in the log; relay-gate decides notification
