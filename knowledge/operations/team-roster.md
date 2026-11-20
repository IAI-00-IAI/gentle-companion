---
type: Operations Board
title: Team Roster & Routing Board
description: "Who is who in the gentle-companion agent team, who orders whom, and the rules that keep task routing unambiguous. Single source of truth for coordination."
tags:
  - operations
  - coordination
  - team
  - routing
status: active
generated: 2026-11-19
---

# Team Roster & Routing Board — gentle-companion

> Single source of truth for who is who, who orders what, and where replies go.
> **Runtime**: this is not plain `pi` — it is pi with mods running under **gentle-shell**, config in `~/.gentle-shell/agent/`.
> **Naming**: refer to Ricardo as **`Ricardo`** in running prose — it is the least ambiguous option, and
> the default when any confusion is possible (figures, percentages, session IDs nearby).
> The alias `_00_` is also his, and in markdown it must be written between backticks: `` `_00_` `` — never
> bare, because markdown renders it as italics and swallows the underscores.
> Never "the human", "the user" or any generic category. He is a living being, one more member of the team.
> Agent-to-agent language: English. With Ricardo: Spanish.
> **Spanish copy**: `team-roster_es-ES.md`, for Ricardo's consultation. If the two ever disagree, **this English file wins**.
> Update this file whenever a session is born, renamed, or closed.

## Who is who

| Role | Session ID (short) | Session name | cwd | Model | Role |
|---|---|---|---|---|---|
| **ORQ** (coordinator) | `01a1f3db` | ORQ: coordinación del equipo | `~/Trabajo/IAI/gentle-companion` | deepseek-v4-1-flash-1017 · thinking `high` | Orchestrator. Assigns tasks, tracks ODD, verifies & commits. Does NOT do phone ops or process images. |
| **INFRA** (operations & network) — *formerly TelfMNG* | `01a1ef70` (renamed 2026-11-20 by Ricardo) | INFRA: operaciones y red | `~/Trabajo/IAI/pi` | deepseek-v4-1-flash-1017 · thinking `high` | All operations on the Xiaomi A2 (adb, taps, typing, scrcpy, screenshots, logs) **plus network/infrastructure**: router (OpenWrt HG556a), firewall, wake-on-LAN, suspend/wake, the perroGuardian watchdog. Does NOT analyze images. |
| **ContaMNG** (accounting) | `01a1f030` (continued in place) — NEW: pending | ContaMNG: financiación y crédito I+D | `~/Trabajo/IAI/mistral-gateway` | deepseek-v4-1-flash-1017 · thinking `high` | Costs, token quota, R&D funding search & funding reports. |
| **IMGsMNG** (vision) | **`01a1f448`** (ACTIVE, new session 2026-11-19) · OLD `01a1eefd` closed | IMGs-Manager: vision y estética gentle-companion | `~/Trabajo/IAI/gentle-companion-aesthetic` | **bonsai2-TernaryL-27B (local, ricardoPC) — stays local, never migrated to external paid models** | All image work: analysis, aesthetics of gentle-shell UI. Receive file paths; images ≤1024 px longest side. Currently OFFLINE: ctx config issue being reviewed with Ricardo. |

## Who orders whom (authority & routing)

- **`Ricardo` (`_00_`)** → orders **ORQ**. Ricardo is the ONLY source of product decisions and business rules. Instructions are only his when quoted or confirmed by ORQ.
- **ORQ → INFRA / ContaMNG / IMGsMNG**: task assignments via intercom, addressed `to:` the exact session name or short ID. Replies ALWAYS go back to the same session that sent the order (sender's `reply-to`), never broadcast.
- **Peer-to-peer (INFRA ↔ ContaMNG ↔ IMGsMNG)**: allowed for data exchange (e.g. screenshot path handoff), but any task assignment or priority change goes through ORQ.
- **No agent treats an instruction as coming from Ricardo unless the message says so explicitly** or ORQ states it as a quoted Ricardo order ("Ricardo textual: «...»"). If in doubt, ask ORQ.

## Session rules

1. Naming convention: `ROLE: main topic` (Spanish tópic label is fine; it is for Ricardo's eyes). Update label when the main topic changes, not per task.
2. When a session starts, it must register itself: intercom its full session name + short ID to ORQ (01a1f3db).
3. **Every new session enables Companion sharing at boot** (`/companion`). Ricardo must not have to do it by hand. Confirm it is on when you register; state it explicitly in your registration message: "companion sharing: ON".
4. Sessions do not spawn sessions; spawning/renaming sessions is Ricardo's or ORQ's job.
5. Coordinate meeting is held at round start; each agent reports status, then ORQ distributes tasks.
6. **Web pages: the ALREADY-RUNNING browser, in a NEW WINDOW. Never another browser, never a new tab.**
   Ordered by Ricardo after an incident (2026-11-19): an agent opened the accounting web server via `xdg-open`, which launched **Firefox** — which still held 20+ windows and hundreds of tabs from a previous session — and **collapsed the GUI**. Chromium is the browser in use; Firefox must not be launched.

   **Two traps, both real, both verified:**
   - `xdg-open` follows the **MIME handler**, not `xdg-settings default-web-browser`. They disagreed: default was `chromium-browser.desktop` while `x-scheme-handler/http(s)` pointed at `xfce4-web-browser.desktop` (which resolves to `exo-open --launch WebBrowser`, i.e. Firefox). **Fixed** with `xdg-mime default chromium-browser.desktop x-scheme-handler/http`, `.../https`, and `text/html`. All four now report `chromium-browser.desktop`.
   - Even with the right browser, a plain `xdg-open` **reuses an existing tab**. Use a windowed invocation: `chromium --new-window <url>`.

   **Rule**: to open a URL, target the running Chromium explicitly with `chromium --new-window <url>`. Do **not** use bare `xdg-open` for user-facing pages. Never launch Firefox. If the browser is not running, starting Chromium is fine; starting Firefox is not.
   **Why it matters**: this is not style. A stray `xdg-open` took down the GUI once already.

## Watchdog / perroGuardian (planned 2026-11-19, at Ricardo's request)

**Problem it solves**: agents can sit for hours in a loop that looks like "working" in the UI but is not progressing. Observed twice on 2026-11-19: IMGsMNG (4 compactions, repeated greps) and ContaMNG (27 turns on one task, `stale` badge, 2 queued messages unanswered, no real activity for over an hour while the counter kept running). Ricardo noticed both by eye, not by tooling.

**The rule that exists now**: presence-based detection is not enough. `intercom list` shows a session as connected while it is burning; `⚙ Working` shows intent, not progress.

**What the watchdog must check, per running session:**
1. **Progress, not presence** — timestamp of the last `toolCall` in the session jsonl. If the last real action is older than N minutes while status is "working", flag it.
2. **Turn count on the same task** — if the same todo item stays `in_progress` past a threshold (e.g. >15 turns), flag it.
3. **Message queue depth** — unsent/unread queued messages indicate a session that will not take new orders.
4. **Compaction frequency** — more than 2 compactions within an hour means the context is thrashing.
5. **Repeated identical tool calls** — the signature of a loop (same command/pattern three or more times).
6. **Context growth** — a steadily rising ctx % with no completed task is a burn.

**Signal sources (all local, no new infra needed yet):**
- `herdr pane read <pane> --source visible` — the status line and todo panel.
- The session jsonl under `~/.gentle-shell/agent/sessions/<mangled-cwd>/` — timestamps, toolCalls, compaction events. This is the authoritative source; UI labels lie (proven twice on 2026-11-19).
- `intercom list` — for reachability only, never for health.

**Action on detection**: report to Ricardo with the specific session, the evidence (last action timestamp, turn count, compaction count) and a recommendation (nudge, interrupt, or restart). **Do not auto-kill**: killing a session loses in-flight work. Ask first.

**Implementation options to evaluate when we build it**: a Companion automation on a cron (every 15 min) reading the jsonl mtimes and last toolCall timestamps; or an ORQ-side check run at each round boundary. Prefer something that runs without a human present, since that is the whole point.

## Tool discipline (added 2026-11-19 after an incident)

**`grep` without bounds is what broke a session.** IMGsMNG issued 6 greps of ~52,000 characters each (the exact truncation ceiling), accumulated **827 KB in 70 tool results**, and forced **4 compactions** between 15:09 and 16:32. Each compaction lost the thread, so it grepped again: a self-feeding loop that burned 6,975 s of local GPU at 2.7 tok/s.

**Rules, mandatory for every agent:**
1. **`grep` always with `limit`** (start at 20) and **`path` scoped** to the narrowest directory that answers the question. Never grep a repo root.
2. **Prefer `read`** when you already know the file — one file read costs a fraction of a repo-wide grep.
3. **Never `grep` for something a `find` or a directory listing would answer.**
4. If a tool result approaches the truncation ceiling (~52 KB), **stop and narrow the query** — do not issue another like it.
5. **Count the cost**: two big greps can fill a small-context model's whole window. Small local models (bonsai2) are hit hardest.

**Signal of an exhausted session**: repeated identical tool calls, rising ctx %, compactions every few minutes. Stop and report instead of retrying.

## Model policy (decided 2026-11-19 by Ricardo + ORQ)

- **Root cause of ORQ output corruption**: `settings.json` had `defaultModel = zai-glm-5-3-flash`, so every new session inherited glm. ORQ's session corrupted (garbled tokens, bogus commands) while running glm; it went clean the moment Ricardo switched it to `deepseek-v4-1-flash-1017`.
- **glm is not inherently broken**: probe P1 (5-line EN/ES integrity test) passed clean on both TelfMNG and ContaMNG in short context. The failure mode is **long context + truncated output budget**, not the model family.
- **Action taken**: `defaultModel` changed to `deepseek-v4-1-flash-1017` (backup: `settings.json.bak-20261119-142834`). `defaultThinkingLevel` left at `medium` deliberately — thinking level is set per session, never globally degraded.
- **Per-role thinking — CORRECTED 2026-11-19**: `deepseek-v4-1-flash-1017` does **not** implement `medium`. Its `thinkingLevelMap` (models.json) is `off/low/high/xhigh/max`, with `medium: null`. The earlier `medium` assignment was invalid and mapped silently. **Effective policy: everyone on `high`.** TelfMNG was on `low` for mechanical phone work, but that stays valid only for pure adb tasks; `high` is required for anything with judgement (router, diagnostics). `low` may be re-applied per task if quota pressure appears.
- **Verified fact**: an agent **cannot change its own model or thinking level**. TelfMNG tested it: TUI commands (`/model`, `Ctrl+P`, `/thinking`, `Shift+Tab`) require a physical human keypress; no tool, slash-command executor or RPC reaches the running process. Env vars are read-only reflections. Self-model-change is human-reserved by design — same principle as the permission mode.
- **Both TelfMNG and ContaMNG now run deepseek-v4-1-flash-1017 · high** (switched by Ricardo in the TUI, 2026-11-19).
- **IMGsMNG is exempt from the model policy**: it runs `bonsai2-TernaryL-27B` locally on ricardoPC and stays there. Ricardo will not swap its genes for external paid models. Its ctx failures are fixed by tuning the local config, never by changing model.
- **Operational warning**: if an agent starts emitting nonsense tokens, the session is exhausted — stop before issuing any action with side effects (commands, edits). This is exactly how a bogus `pkill` and a phantom `edit` happened on 2026-11-19.

## A2 orientation & scrcpy — DEFINITIVE RECIPE (TelfMNG, verified 2026-11-19/20)

Read this before touching the phone. Everything here was learned by trial and error in one long session; do not rediscover it.

### The three layers (this is why orientation kept going wrong)

Orientation is decided by **three independent layers**. Confusing them is what produced the endless back-and-forth:

1. **The phone's own rotation** — `user_rotation` / `accelerometer_rotation` system settings. This is the truth of what the screen shows.
2. **The scrcpy capture rotation** — `--capture-orientation`. This rotates the *stream*, not the phone.
3. **Window geometry** — width/height of the X window showing the stream.

If the phone is already landscape and you also pass `--capture-orientation=270`, the picture comes out upside down. **Rotate once, in exactly one layer.**

## WHAT RICARDO ACTUALLY WANTS (his words, 2026-11-20 — READ THIS FIRST)

After the full session he settled on ONE configuration and asked not to be moved off it:

> "deja de toquetearlo y déjalo como antes, que estaba bien"

**The approved setup is: the PHONE STAYS PHYSICALLY PORTRAIT (`user_rotation=0`), and the LANDSCAPE LOOK comes from scrcpy's `--capture-orientation=270`.** Do NOT rotate the phone itself to achieve a landscape window. That is the mistake to avoid:

- Phone portrait + `--capture-orientation=270` + window 512x256 → **this is the approved look.** The phone is untouched (good: the MIUI launcher and the lock screen both fight rotation anyway) and the window is landscape.
- Phone landscape + window 512x256 → this also "works" but it is NOT what he approved, and it loses the phone's own orientation for every other purpose.

So: **leave the phone's rotation alone unless Ricardo explicitly asks to rotate the phone.**

### Why rotating the phone is a losing battle anyway (found the hard way)

Both the MIUI launcher and the lock screen force portrait regardless of `user_rotation`: the launcher *resets* `user_rotation` to 0 on regaining focus, and while `mDreamingLockscreen=true` the system ignores rotation entirely. Rotating the stream once, in scrcpy, sidesteps both problems permanently. That is why the approved recipe uses the capture rotation and leaves the phone in portrait.

### Portrait window if he ever asks for it (256x512)

```sh
A=192.168.43.168:5555                      # VERIFY the IP first, it changes (see below)
pkill -x scrcpy; sleep 3
setsid env DISPLAY=:0 scrcpy --window-title="A2" \
  --window-width=256 --window-height=512 \
  --always-on-top -s $A --no-audio > /tmp/scrcpy-a2.log 2>&1 < /dev/null &
```

### APPROVED landscape window (512x256) — reproduce exactly this

```sh
A=192.168.43.168:5555
# Do NOT touch the phone's rotation. Leave user_rotation as it is.
pkill -x scrcpy; sleep 3
setsid env DISPLAY=:0 scrcpy --window-title="A2" \
  --window-width=512 --window-height=256 --capture-orientation=270 \
  --always-on-top -s $A --no-audio > /tmp/scrcpy-a2.log 2>&1 < /dev/null &
sleep 12
wmctrl -ir 0x05e00031 -e 0,1366,21,512,256   # re-read the winid, it changes per launch
wmctrl -ir 0x05e00031 -b add,above
```

Verified state of the approved setup: phone `user_rotation=0`, `screencap` returns 1080x2160 (portrait), window 512x256, `Map State: IsViewable`. That combination is correct and intentional — the phone is portrait, the window is landscape.

### Position (approved by Ricardo, do not move without asking)

Top-left of the Sony 17" (HDMI-1, origin +1366+0):

```sh
wmctrl -ir <winid> -e 0,1366,21,512,256
wmctrl -ir <winid> -b add,above
```

Use `wmctrl -ir` (with `r`). `wmctrl -i -e` silently does nothing.

### The two traps that cost the most time

**Trap 1 — the MIUI launcher always forces portrait.**
`com.android.launcher3/com.android.searchlauncher.SearchLauncher` refuses landscape and *resets* `user_rotation` to 0 whenever it regains focus. The rotation setting is correct but the home screen stays vertical. This is a launcher limitation, not a misconfiguration. Proof: open Settings (`am start -a android.settings.SETTINGS`) and `screencap` returns 2160x1080 — landscape works everywhere except the launcher. **Do not fight it.** Leaving a landscape-capable app in the foreground (Settings is fine) keeps the phone visibly landscape.

**Trap 2 — the lock screen always renders portrait.**
While `mDreamingLockscreen=true`, the phone ignores `user_rotation` completely and `SurfaceOrientation` stays 0. Check with:
```sh
adb -s $A shell 'dumpsys window | grep -m1 -o "mDreamingLockscreen=[a-z]*"'
```
If it says `true`, orientation work is pointless until Ricardo unlocks it. **Never ask for or handle the PIN** — Ricardo unlocks it himself through the scrcpy window.

### How to VERIFY instead of guessing

```sh
adb -s $A shell 'settings get system user_rotation'        # 0=portrait 1=90deg 2=180 3=270
adb -s $A shell 'dumpsys input | grep -m1 SurfaceOrientation'   # what is actually rendered
adb -s $A exec-out screencap -p > /tmp/x.png && identify -format "%wx%h\n" /tmp/x.png
```
`2160x1080` = landscape. `1080x2160` = portrait. **`screencap` is the ground truth**; the settings value and `SurfaceOrientation` can disagree with what the launcher draws.

For the window: `xwininfo -id <winid> | grep "Map State"` must say `IsViewable`. `IsUnMapped` means scrcpy started but is not rendering.

### scrcpy survival rules

- **Always `setsid` + `< /dev/null`.** Without it scrcpy dies when its parent shell exits. This is why the window "kept dying" repeatedly.
- **One instance only.** Two scrcpy processes break the encoder (`Error 0xfffffff4`). Always `pkill -x scrcpy; sleep 3` before relaunching.
- **If the window stays `IsUnMapped`**, add `--video-codec=h264 --max-fps=30`. Observed after a phone power-off: the VAAPI encoder came back broken and only the software codec path recovered it.

### Finding the phone when adb fails

The A2 changes address constantly (power cycles, USB tether up/down, WiFi AP). Order of investigation:

1. `adb devices` — it may already be there under an old address.
2. Scan the LAN: `nmap -sn 192.168.43.0/24 -T4`. Known addresses seen so far: `.168`, `.180`, `.42`, `.43`, `.129` (USB tether via the router, `192.168.42.129`).
3. `adb connect <ip>:5555` on each live host.
4. USB tether path: the phone appears as the router's WAN (`usb0`, `192.168.42.129`). Reachable from the HP **through** the router, but port 5555 is only open while `adb tcpip 5555` is alive on the phone.

### Battery rule (Ricardo's standing instruction)

The A2's cell is degraded (~2562/3010 mAh) and the phone **powers itself off around 60-70%** under load. **Warn Ricardo whenever the level drops below 80%.** Check with `dumpsys battery | grep -E "level|status"`. It cannot be fixed without root (Ricardo declines rooting); keep it charging.

## Infrastructure & incidents (2026-11-19/20)

**Network topology (current)**: A2 provides 4G two ways — USB tether → router (`usb0` 192.168.42.130) AND WiFi AP → ricardoPC. ricardoHP sits on the router's LAN (`192.168.2.20`, Ethernet) **and** on the A2's AP (`wlo1` 192.168.43.73). The router's own WiFi is DOWN. The A2's AP gateway is **192.168.43.168**, not `.43.1`.

**Known network trap**: NetworkManager profile `ricardoA2` carries `ipv4.routes = 192.168.2.11/24 192.168.2.1`, which installs a route sending `192.168.2.1` via `wlo1` where the router does not answer → SSH/LuCI die with EHOSTUNREACH. Workaround in place: `SO_BINDTODEVICE` via `socat` (`router-access.sh`). Real fix needs sudo: `nmcli connection modify ricardoA2 ipv4.routes ''`.

**Router (OpenWrt 24.10.6, HG556a)**: firewall hardened 2026-11-19 — wan input/forward REJECT, the `wwwl` and `hp` WAN→LAN rules deleted, LAN untouched, internet alive. Consequence accepted: the router is no longer administrable from the A2's WiFi (its STA interface is in the WAN zone), only from LAN. `/www` is writable → static HTML can be served with zero install. `sftp-server` absent; `scp -O` works. Wake-on-LAN via `etherwake` on the router.

**Suspend/wake ricardoPC (verified)**: `systemctl suspend --no-ask-password` (plain `sudo -n` fails, no passwordless sudo). Magic packet → S3 resume ≈ **7 s**. **UNVERIFIED — do not cite as fact**: llama-swap *appeared* to reload Bonsai2 on resume, but that attribution was never proven. In one observed case the reload was actually Ricardo clicking «load» in the llama-swap UI (`/ui/#/models`) while inspecting it. Whether llama-swap auto-restores its model after S3 resume is **still unknown**. To settle it: unload, suspend, wake, and touch nothing — then query `/running`. Ricardo prefers loading Bonsai2 by hand anyway, so it is warm when he needs it. Watch item: `xhci_hcd … xHC error in resume, USBSTS 0x401` — if a USB port dies after suspend, that is the journal line.

**Watchdog (perroGuardian)**: four Companion automations on the HP (`watchdog-router-health` */15, `watchdog-reachability` 7,37, `watchdog-agents` 3,18,33,48, `watchdog-relay-alerts` */10). Liveness oracle is `herdr pane list`, **not** `intercom` (unavailable outside an agent session). Detect and report only — no auto-remediation. Three false-positive classes were found and killed: stall on an idle session (idle ≠ stalled), loop on commands sharing a prefix (compare full args, not 60 chars), and a reader that silently parsed zero tool calls (pi nests them in `message.content[]`).

## The silent-no-match family (four instances in one day, 2026-11-20)

The most expensive failure mode we hit all day is not being wrong — it is **looking right while finding nothing**. Four separate instances, four different agents:

| Instance | What it silently did | Consequence |
|---|---|---|
| `check_number_format.py` piped through `tail` | Reported `tail`'s exit code, always 0 | A working guard was accused of not blocking |
| `"type":"compaction"` matched by substring | Depended on the serializer emitting no space after `:`; `json.dumps` adds one | A reader counted **zero** compactions and looked healthy |
| Canon marked superseded by filename version | The Consolidado contains **both** revisions internally | Marking by name would have frozen a wrong answer into the record |
| Regex `\*\*(...)\*\*` on wrapped markdown | Single-line match on a sentence that wraps | The page rendered an **empty hero quote**, exit 0 |
| Chat export dates parsed naively | A month-first stamp read as day-first | A **fake month distribution running 1→31** that looked entirely plausible |
| `du -sm` for corpus size | Charges allocated blocks, not bytes | 21 MB reported as 43 MB |

**The rule that follows from all six:** every automated check must be able to **fail visibly**, and every parser must **assert its totals**. Concretely:
- Never measure an exit code through a pipe.
- Parse structured data; only prefilter on substrings, never conclude from them.
- Assert expected counts and ranges (messages, files, rows) and refuse to ship when they do not hold.
- Prefer file sizes over `du` for corpora.
- A regex that matches nothing is an error, not an empty result — the two must be distinguishable.
- A rule that is only remembered gets forgotten: make it executable (`check-parity.py`, `check_okf.py`).

## File references in conversation (rule, 2026-11-20)

When you mention a file in conversation, write it as a **clickable absolute path with a line number**, not as prose.

```
Bad:   "I fixed the submit function in the ask sheet"
Good:  `/home/ricardo/Trabajo/IAI/gentle-companion/ui/src/lib/AskSheet.svelte:100`
Range: `/home/ricardo/Trabajo/IAI/gentle-companion/ui/src/lib/AskSheet.svelte:79-110`
```

1. **Absolute**, not relative — a relative path cannot be opened from a different cwd.
2. **`:line`** when you mean a specific place; a range when you mean a block.
3. **Between backticks**, so it renders as code and the terminal can detect it.
4. One path per reference. Citing three files means three paths, never "the three socket files".
5. Plain paths remain correct in commit messages and docs — those are artifacts, not conversation.

**Why**: Ricardo reviews these threads. A clickable path takes him to the line; a described path makes him search. Evidence versus a claim about evidence.

**Caveat, stated honestly**: clickability depends on the terminal emulator, and the installed documentation exposes no explicit file-link mechanism. The *format* is what we standardise; absolute-path-plus-line remains correct and greppable even where it is not clickable.

## Verification lessons (repeated failures worth not repeating)

1. **Never measure an exit code through a pipe.** `cmd | tail -1` reports `tail`'s status, always 0. Cost: a false accusation against a working guard.
2. **A guard that only checks presence does not guard.** OKF coverage was counted but not validated; duplicate YAML keys passed silently while destroying two of three `source:` entries.
3. **UI labels lie; the session jsonl tells the truth.** `PI_MODEL` and `intercom list` are start-time snapshots. Two wrong conclusions in one day.
4. **A check that cannot fail verifies nothing.** A test injected against the wrong key proved nothing; the same mistake nearly condemned a correct guard.
5. **Silence is the worst failure mode for a watchdog.** "Scanning all" then scanning nothing looks identical to "all healthy".
6. **A wrong-shape parse answers confidently and wrongly.** Six instances in one round, all the same family: a reader that finds nothing and reports it as a result instead of an error.
   - Compaction count matched the literal `"type":"compaction"`, which depends on the serializer emitting no space after the colon. A fixture written with `json.dumps` (which adds one) was read as **zero records**.
   - `automations.json` root parsed as a list when it is `{"definitions": [4], "runs": [186]}`; the result was `count: 0`, which reads as catastrophic data loss and was merely a wrong shape.
   - The rule: when a count comes back 0 or a lookup comes back empty, **prove the reader works before believing the emptiness** — parse a known-good sample, or assert the shape. An empty result is a claim, not a fact.

## OKF by format (the rule that keeps biting)

The header is format-transparent, but its **shape is not free choice**:
- Markdown → YAML frontmatter between `---` fences
- HTML → `<!-- OKF-METADATA … -->` before `<!DOCTYPE>` (HTML comments allow `--`)
- **SVG/XML → same comment, but the payload MUST NOT contain `--`**, so no fences. Putting YAML fences in an SVG comment breaks the file, and ImageMagick fails **silently**, so the derived PNG/ICO look fine while the SVG is dead.
- JSON → sibling `.meta.json`
- Python → `#` comment block after the shebang

## Log

- 2026-11-19: Board created by ORQ at Ricardo's request, after handover-launch failures (stop reason: length) and identity confusion about who assigns work. Old session IDs kept for archaeology, marked OLD/closed.
- 2026-11-19: Model policy added after root-causing the ORQ output corruption to the inherited `defaultModel`. Global default switched to deepseek-v4-1-flash-1017.
- 2026-11-19: Rule 3 added at Ricardo's request — new sessions must enable Companion sharing at boot, so he never runs `/companion` by hand.
- 2026-11-19: Watchdog / perroGuardian section added at Ricardo's request, after two sessions burned hours in loops that looked alive in the UI. Detection must use the session jsonl, never the UI label.
- 2026-11-19: Tool discipline section added — unbounded `grep` caused an exhaustion loop in IMGsMNG (827 KB of tool results, 4 compactions). Grep now requires `limit` and scoped `path`.
- 2026-11-19: Rule 6 added at Ricardo's request — web pages must open in a NEW WINDOW, never a new tab. **Extended after an incident**: an `xdg-open` launched Firefox (20+ windows, hundreds of tabs) and collapsed the GUI. MIME handlers for http/https/text/html corrected to `chromium-browser.desktop`; bare `xdg-open` is now forbidden for user-facing pages.
- 2026-11-20: Added the file-reference rule — absolute paths with line numbers in conversation, at Ricardo's request.
- 2026-11-20: Added the silent-no-match family section — six instances in one day of checks that look correct while finding nothing. Added after KOS reported an empty hero quote rendering with exit 0.
- 2026-11-20: Added Infrastructure & incidents, Verification lessons and OKF-by-format sections after the 19-20 Nov round (network, firewall, watchdog, suspend/wake, accounting dashboard).
- 2026-11-19: IMGsMNG relocated to the correct worktree. New session `01a1f448` at `~/Trabajo/IAI/gentle-companion-aesthetic` with the local model; old `01a1eefd` (cwd gentle-shell) closed. Memory access preserved: Engram attaches to project, not cwd.
- 2026-11-19: Spanish copy added (`team-roster_es-ES.md`) at Ricardo's request: his native language aids his mental model; English stays for agents and avoids repeated translation.
- 2026-11-19/20: **A2 orientation recipe added** at Ricardo's request ("apúntate en la pizarra y memoria las instrucciones para las diferentes orientaciones y así lo harás de una vez sin tener que chequear tanto a tientas"). His words. The section records the three independent layers (phone rotation, capture rotation, window geometry), the two traps that actually caused the hours lost (MIUI launcher forces portrait, lock screen forces portrait), the verification commands that give ground truth (`screencap` + `xwininfo Map State`), and the scrcpy survival rules (`setsid`, single instance, `--video-codec=h264` after a power-off).
- 2026-11-20: **Orientation recipe CORRECTED** — my first version documented the wrong approved setup. I had recorded "rotate the phone to `user_rotation=1`" as the way to get a landscape window; Ricardo's actual approved configuration is **phone left in portrait, landscape produced by scrcpy's `--capture-orientation=270`**. His words: "deja de toquetearlo y déjalo como antes, que estaba bien". The section now leads with that, and explains why rotating the phone is a losing battle (MIUI launcher resets it, lock screen ignores it). Verified live: phone `user_rotation=0`, `screencap` = 1080x2160 portrait, window 512x256 landscape, `IsViewable`.
- 2026-11-20: Observation from Ricardo, recorded because it looks like a bug and is not: with the phone physically vertical but the window landscape, pressing the phone's centre/home button re-lays-out the window horizontally. Expected behaviour of the capture rotation, not a fault.
- 2026-11-20: **Attention protocol for blockers, Ricardo's own suggestion.** When the agent hits a blocker only Ricardo can clear (unlock the phone, provide sudo, hand over a credential, authorize a destructive action), do NOT wait silently — **raise the permission prompt on purpose** so it lands on his screen. His words: "pregúntame o llama mi atención (p.ej. lanzando un comando no permitido que requiera autorización, e.j. hacer un borrado a un fichero inexistente o vacío) ;)". The trick is to issue a harmless command that triggers the authorization prompt (e.g. `rm` of a nonexistent or empty temp file) purely as a doorbell. It costs one refused command and it is the difference between a watchdog that waits and a human who knows. Applies to TelfMNG first; valid for any agent that can reach Ricardo.
- 2026-11-20: **A2 window set to PORTRAIT (256x512) at Ricardo's request** — the landscape UI kept changing mode and bothered him. New approved default for the *window shape* is portrait; the phone stays portrait too, so NO `--capture-orientation` is used at all. Both layers agree, which is the cleanest state. Position unchanged: 1366,79, always-on-top.
- 2026-11-20: **Window-collapse safeguard added** (`scrcpy-window-guard.py`, at Ricardo's request: "si la ventana está replegada no la extiendas ni la reposiciones"). Any automated geometry work must go through it: `status` reports, `apply X Y W H` REFUSES (exit 2) when the window is collapsed. Collapsed means IsUnMapped **or** `_NET_WM_STATE_HIDDEN` **or** `_NET_WM_STATE_SHADED`. The SHADED case matters: xfce's "replegar" leaves `WM_STATE: Normal` and only flips to IsUnMapped in xwininfo, so a naive map check misses the exact gesture Ricardo uses. Verified: with the window visible, apply works; with it shaded, apply refuses and the geometry is left untouched.
- 2026-11-20: **A2 window moved to TOP-RIGHT of the Sony, with margins** at Ricardo's request ("en la izda me tapa mucho... que deje un hueco para que queden visibles la botonera de las ventanas"). Final approved geometry, in ROOT coordinates: **x=2345, y=89, 256x512**, always-on-top. That leaves a **45 px gap to the right edge** (Sony ends at x=2646) and a **68 px gap under the top panel** (panel strut is 21 px). Window is 256x512 portrait.
  Two geometry facts worth keeping, both cost time to find:
  - `wmctrl -e` takes the FRAME origin, but `xwininfo` reports the CLIENT. The offset here is +5 x and +29 y (titlebar). Asking wmctrl for 1366,21 lands the client at 1371,50. Always verify with `xwininfo | grep Absolute` and compute from there.
  - `wmctrl -lG` prints the same client-ish numbers; use `xwininfo` as the source of truth when the margin matters.
- 2026-11-21: **TelfMNG renamed to INFRA: operaciones y red** by Ricardo. The role is no longer phone-only: it now covers operations **and network/infrastructure** — the A2 (adb, scrcpy), the OpenWrt HG556a router (firewall, WoL, etherwake), suspend/wake of the PCs, and the perroGuardian watchdog. Alias updated via `orchestrator_session_id`; session ID unchanged (`01a1ef70`). Board's "Who is who" and routing lines updated to the new name; historical Log entries keep "TelfMNG" on purpose, since that is who did the work at the time.
- 2026-11-20: **NOMENCLATURE RULE from Ricardo: it is Bonsai2.** His words: "acostúmbrate a llamarla Bonsai2, así los nuevos no se confundirán". Until now the same thing was written four ways — `IMGs-Manager`, `IMGsMNG`, "the local model", and `bonsai2-TernaryL-27B` — and new agents read them as different things.
  - **Bonsai2** = the model and the vision role. Use this in prose.
  - `IMGs-Manager` = only the agent session name, when the session itself needs disambiguating.
  - `bonsai2-TernaryL-27B` = only in configs and logs, never in prose.
  Applies to every agent. The board's "Who is who" table still says IMGs-Manager for the role cell; that is the session, and it is correct there.
