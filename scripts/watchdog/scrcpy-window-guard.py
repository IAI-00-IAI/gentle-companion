#!/usr/bin/env python3
"""Guard the A2 scrcpy window geometry, but NEVER against Ricardo's own will.

Ricardo's rule (2026-11-20): "si la ventana está replegada no la extiendas ni la
reposiciones". He collapses the window when it bothers him; a watchdog that pops
it back is worse than no watchdog.

This helper therefore does two separate things:

  status   Report the window state and whether it is SAFE to touch.
  apply    Move/resize ONLY when the window is visible and not collapsed.
           Refuses and explains otherwise. Never un-minimises, never raises a
           collapsed window, never toggles the above hint on a hidden window.

"Collapsed" means any of:
  - X map state is not IsViewable (iconified / unmapped)
  - _NET_WM_STATE_HIDDEN is set (minimised by the WM)
  - the window is absent entirely

Exit codes: 0 = acted or safe; 2 = refused because the window is collapsed/absent.
Usage: scrcpy-window-guard.py status|apply X Y WIDTH HEIGHT
"""

import re
import subprocess
import sys

TITLE = "A2"


def x(args):
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=10,
                             check=False)
        return out.returncode, out.stdout
    except (OSError, subprocess.SubprocessError):
        return 1, ""


def find_window():
    """Return the window id whose title is exactly A2, or None."""
    rc, out = x(["wmctrl", "-lG"])
    if rc != 0:
        return None
    for line in out.splitlines():
        # id desktop x y w h host title...
        parts = line.split(None, 7)
        if len(parts) < 8:
            continue
        if parts[7].strip() == TITLE:
            return parts[0]
    return None


def window_state(win):
    """Return (mapped, states, width, height)."""
    rc, out = x(["xwininfo", "-id", win])
    mapped = "IsViewable" in out
    width = height = 0
    m = re.search(r"Width:\s+(\d+)", out)
    if m:
        width = int(m.group(1))
    m = re.search(r"Height:\s+(\d+)", out)
    if m:
        height = int(m.group(1))
    rc2, props = x(["xprop", "-id", win, "_NET_WM_STATE"])
    states = props.partition("=")[2].strip() if "=" in props else ""
    return mapped, states, width, height


def is_collapsed(mapped, states):
    """Collapsed = anything that means "Ricardo is not looking at it".

    IsUnMapped alone is not enough: a SHADED window (rolled up to its titlebar,
    xfce's "replegar") reports IsUnMapped in xwininfo while WM_STATE still says
    Normal, so the map check misses it. SHADED is the very gesture Ricardo uses.
    """
    if not mapped:
        return True
    for flag in ("_NET_WM_STATE_HIDDEN", "_NET_WM_STATE_SHADED"):
        if flag in states:
            return True
    return False


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("status", "apply"):
        print("usage: scrcpy-window-guard.py status|apply [X Y W H]")
        return 1

    action = sys.argv[1]
    win = find_window()
    if win is None:
        print("ABSENT: no window titled A2 (scrcpy not running, or renamed)")
        return 2

    mapped, states, width, height = window_state(win)
    collapsed = is_collapsed(mapped, states)
    verb = "COLLAPSED" if collapsed else "VISIBLE"
    print(f"{verb} {win} {width}x{height} states=[{states}]")

    if action == "status":
        return 0 if not collapsed else 2

    if collapsed:
        # The whole point: respect the collapse. Say why and stop.
        print("REFUSED: window is collapsed or hidden; not extending, "
              "not repositioning, not raising.")
        return 2

    if len(sys.argv) < 6:
        print("usage: scrcpy-window-guard.py apply X Y WIDTH HEIGHT")
        return 1

    gx, gy, gw, gh = sys.argv[2:6]
    x(["wmctrl", "-ir", win, "-e", f"0,{gx},{gy},{gw},{gh}"])
    # Re-check before raising: it could have been collapsed mid-flight.
    mapped2, states2, _, _ = window_state(win)
    if is_collapsed(mapped2, states2):
        print("SKIPPED raise: window collapsed during the move")
        return 2
    x(["wmctrl", "-ir", win, "-b", "add,above"])
    print(f"APPLIED {gx},{gy} {gw}x{gh} on {win}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
