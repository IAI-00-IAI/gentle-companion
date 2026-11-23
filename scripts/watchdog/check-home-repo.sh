#!/bin/sh
# Guard: the home directory must not be a git repository.
#
# Why this exists: $HOME once carried a .git. Any agent running `git add -A` from
# ~/Trabajo/KOS committed the home directory — 174 untracked entries. It was removed,
# verified, and came back without anyone noticing. LABY caught it, not a monitor.
# Ricardo: "no es resuelto y vigilado, es resuelto y sin vigilancia".
#
# WHY NOT `git rev-parse --show-toplevel` ALONE (measured, 2026-11-23):
#   empty ~/.git   -> rc=128, "fatal: no es un repositorio git (ni ninguno de los
#                     directorios superiores): .git"
#   clean home     -> rc=128, "fatal: no es un repositorio git (ni ningún padre en el
#                     punto de montaje /)"
# Both exit 128, so an exit-code-only check built on rev-parse reports OK in exactly
# the case this guard exists to catch. The empty .git is the incident's actual shape.
# Existence of .git is therefore the primary signal; rev-parse only adds coverage for
# an ancestor repository above the home directory.
#
# Rules honoured here, both paid for already:
#   - Measure the exit code, never a piped exit status. Every command below is run
#     redirecting to a file, then `rc=$?`. No `cmd | grep`, which reports the status
#     of grep and turns a failure into a pass.
#   - When the state cannot be determined, report UNVERIFIED. Silence that looks like
#     health is the failure mode this whole directory exists to prevent.
#
# Detect and report only. It never deletes anything: ~/.git.bk and ~/.degit are
# Ricardo's to remove, and a guard that silently repairs cannot be trusted to report.

set -u
WATCHDOG_DIR=/home/ricardo/.local/share/gentle-watchdog

# Test hook: the remote root can be overridden so the failure path is exercisable
# without creating a repository in the real home directory.
HOME_ROOT="${1:-$HOME}"

# WATCHDOG_NO_ALERT=1 suppresses the rate-limited alerting and the evidence file, so the
# failure paths can be exercised without polluting the real alert state. Learned the hard
# way: the first test run wrote a CRITICAL for /tmp/dubl-probe into watchdog.log and left
# alert-state/home_repo raised, which would have produced a false RECOVERED notice later.
NO_ALERT="${WATCHDOG_NO_ALERT:-0}"

. "$WATCHDOG_DIR/lib.sh"

# notify <key> <severity> <message>: alert for real, or no-op under WATCHDOG_NO_ALERT=1.
notify() {
    [ "$NO_ALERT" = "1" ] && return 0
    alert "$1" "$2" "$3" || return $?
    return 0
}

# record <text>: write the evidence file, or skip it when testing.
record() {
    [ "$NO_ALERT" = "1" ] && return 0
    printf '%s\n' "$1" >"$EVIDENCE"
}
KEY=home_repo
EVIDENCE="$WATCHDOG_DIR/home-repo.state"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

if [ ! -d "$HOME_ROOT" ]; then
    notify "$KEY" CRITICAL "cannot inspect $HOME_ROOT: not a directory"
    echo "home-repo: UNVERIFIED — $HOME_ROOT is not a directory"
    exit 2
fi

# Primary signal: the presence of .git itself. A worktree or submodule stores .git as
# a file, so test for existence, never for a directory.
if [ -e "$HOME_ROOT/.git" ]; then
    kind=dir
    [ -d "$HOME_ROOT/.git" ] || kind=file
    # mtime says *when* it reappeared, which is the datum the incident lacked:
    # the empty .git was dated 2026-09-24T19:18 and nobody knew until LABY looked.
    when=$(stat -c '%y' "$HOME_ROOT/.git" 2>"$TMP")
    stat_rc=$?
    if [ "$stat_rc" -ne 0 ]; then
        when="mtime unavailable: $(head -1 "$TMP")"
    fi
    record "present\t$kind\t$when\t$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    notify "$KEY" CRITICAL "$HOME_ROOT is a git repository (.git $kind, mtime $when)"
    echo "home-repo: FAIL — $HOME_ROOT/.git exists ($kind), mtime $when"
    exit 1
fi

# Secondary coverage: a repository rooted above the home directory would make the home
# a worktree without any .git of its own.
git -C "$HOME_ROOT" rev-parse --show-toplevel >"$TMP" 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
    toplevel=$(head -1 "$TMP")
    record "ancestor\t$toplevel\t\t$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    notify "$KEY" CRITICAL "$HOME_ROOT is inside the git worktree at $toplevel"
    echo "home-repo: FAIL — $HOME_ROOT is inside the worktree at $toplevel"
    exit 1
fi

# rc != 0 is only meaningful if git actually answered "not a repository". Any other
# failure (git missing, unreadable path, dubious ownership) means the state is unknown,
# and unknown must never be reported as clean.
if ! grep -qi "not a git repository\|no es un repositorio" "$TMP"; then
    record "unknown\t\t\t$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    notify "$KEY" WARNING "cannot determine whether $HOME_ROOT is a repository: $(head -1 "$TMP")"
    echo "home-repo: UNVERIFIED — $(head -1 "$TMP")"
    exit 2
fi

[ "$NO_ALERT" = "1" ] || rm -f "$EVIDENCE"
notify "$KEY" OK "$HOME_ROOT is not a git repository"
echo "home-repo: OK — $HOME_ROOT is not a repository, and no ancestor is either"
exit 0
