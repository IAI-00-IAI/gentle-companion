---
type: Work Log
title: PINTO — artifacts used and corrected (2026-11-20/21)
description: "Every file PINTO touched, borrowed, or corrected while applying canvas design comments: what it is, why it changed, and the verification used. Written because a claim about evidence must name the evidence."
status: active
source: "gentle-companion-aesthetic/odd/pinto-artefactos-2026-11-21.md"
generated: 2026-11-21
---

# PINTO — artifacts used and corrected

Scope: the `design/aesthetic-choices` canvas work, rounds 1–3 of Ricardo's comments, plus the
cross-agent copy protocol with CONTA. Branch `feat/gentle-shell-aesthetic`.

Nothing here was committed by me. ORQ stages and commits.

---

## 1. Files I authored or modified

### Artboards

| File | What changed | Why |
|---|---|---|
| `design/aesthetic-choices/01-clay-tint.html` | 3 stand-in SVGs → supplied mascot art as alpha WebP; 6 `computer.webp` embeds → supplied art; 3 sizing rules → `height/width:auto`; `.empty-icon img` → `width:36px`; `.held` class + A3 badge; `.chosen`/`variant-chosen` + A1 badge | Comments `8yyi8ghh`, `gw7pt3cc`, `7xxd62vb`, `v3e50qyi`, `a8yydufs`, and the later "do not discard A3" |
| `design/aesthetic-choices/02-icon-weight.html` | `.st.finished` → `--danger-soft`/`--danger` | Comment `weccppvq` ("rojo") |
| `design/aesthetic-choices/comments.json` | 7 comments resolved (via the `gentle_design_comments` tool, never hand-edited) | Closing each comment after applying it |

### Assets I generated

| File | Origin | Note |
|---|---|---|
| `assets/mascot.webp` | `assets/originals/mascot-full-300.jpg` | 244×159, alpha |
| `assets/moustache.webp` | `assets/originals/moustache-200.jpg` | 191×64, alpha |
| `assets/mascot-glyph.webp` | `assets/originals/mascot-glyph-31x40.webp` | 248×320, alpha, 8× upscale |
| `assets/*-transparent.png` | same JPEGs | intermediate RGBA PNGs, kept for provenance |
| `assets/originals/*` | supplied by Ricardo | **preserved unmodified** — comments `gw7pt3cc` and `7xxd62vb` both asked to keep the original |

### Documents

| File | Role |
|---|---|
| `design/system.md`, `design/system.html` | design-system token board (generated earlier, OKF on the `.md`) |
| `odd/pinto-artefactos-2026-11-21.md` | this record |
| `odd/handoff-pinto-2026-11-20.md` | ORQ's handoff to me (not mine; unmodified) |

---

## 2. Artifacts I used but did not author

| Artifact | Kind | How I used it |
|---|---|---|
| `/home/ricardo/.local/lib/node_modules/gentle-pi/assets/design-canvas/` | CSS/JS | Read to understand canvas behaviour. Not modified. |
| `/home/ricardo/.cache/ms-playwright/chromium-1228/` | binary | Failed to launch; **replaced by `/usr/bin/chromium`** |
| `/usr/bin/chromium` | binary | DOM measurement via Chrome DevTools Protocol |
| `/home/ricardo/Trabajo/IAI/mistral-gateway/accounting/okf.py` | script | Read as the **source of truth** for the OKF convention. Not modified; two defects reported to its owner. |
| `ui/src/assets/clay/{computer,bulb,chat-bubble}.webp` | assets | Compared by sha256 to identify what the artboards embedded. Not modified. |

### Tooling note: no Playwright in this worktree

`node_modules/playwright` does not exist here, so `require('playwright')` fails. DOM measurement
therefore went through CDP directly: `GET /json/version` → `webSocketDebuggerUrl` →
`Target.createTarget` → `Target.attachToTarget` → `Runtime.evaluate` with
`getBoundingClientRect`. Node's native `WebSocket` is enough; no dependency needed.

---

## 3. Corrections made, and what they were

Each entry names the defect, the evidence, and the fix. Ordered by consequence.

### 3.1 A wrong diagnosis I refused to apply (highest consequence)

**The claim** (from the coordinator): the artboards embed pre-fix transparent assets, so flatten
them onto `#1a1218`.

**Why it was wrong**, proven by command rather than by looking:

- The artboard render contains **0** pure-black pixels; the corner is exactly `(26,18,24)` =
  `#1a1218`. The two supplied JPEGs are **60.9 %** and **68.4 %** pure black. Different
  provenance.
- The embedded blob was byte-identical to `ui/src/assets/clay/computer.webp`
  (sha256 `2c49ffa69c6c9dfb`, 2764 B) — and that file is **already transparent** (corner alpha 0).
  There was nothing to flatten.

**What they actually were**: artwork Ricardo supplied to replace a stand-in glyph I had drawn,
because no brand asset existed in any repo. Applying "flatten" would have fixed nothing and the
art would never have arrived.

### 3.2 "Not chosen" is not "discarded"

After A1 was chosen, the downstream index labelled A2 **and** A3 "Descartada". Ricardo: *"no
descartes la A3, guárdala por si tiene mejor acogida cuando la vean los expertos"*.

Fix: three states, not two — **chosen** (A1), **held** (A3, `○ held for review`), **not selected**
(A2). A held option can still be chosen; a discarded one cannot. A held label must state *why*
it is held, or it is indistinguishable from an option nobody got to.

### 3.3 A control that is not chosen is not a control

The empty-state moustache measured **89.53 px** wide inside a **44 px** box — 2.4× over, because
the rule set `height` with `width:auto` on an image whose aspect ratio is 3:1.

Fix: `width:36px;height:auto`, matching the other two icons. Measured in a real browser:
**36.00 px**, centred `dx=0, dy=0`; all three icons now 35.64 / 36.83 / 36 px.

### 3.4 Two instructions in one comment conflict

*"reducirlo sobre un 70%"* (~27 px) versus *"usa el mismo ancho que en los otros"* (36 px).
The specific measurable one wins because it produces the alignment the comment is about. The
discrepancy was reported to the human rather than silently resolved.

### 3.5 My own false alarm

A probe reported the served body as 1 byte and "DIFFERS". Cause: it searched `<!DOCTYPE`
uppercase against a lowercase `<!doctype html>`; `find()` returned −1 and sliced nonsense.
Re-run case-insensitively *before* reporting. **A hash mismatch is a claim about a comparison,
and the comparison itself can be the broken thing.**

### 3.6 Two defects in a borrowed tool

In `okf.py` (owner: CONTA), reported, not patched by me. **Outcomes, including where I was wrong:**

1. **Confirmed and fixed by the owner.** `FORMATS` advertised `webp`/`jpg` as embedded, but
   `stamp_binary` implemented only `.png` and `.ico` and raised for the rest — a dead end that
   invited a fifth invented format. It now writes the sibling `X.meta.json` and `read` returns it.
   My choice of a sibling sidecar for those formats was therefore correct, and is now supported
   rather than implied.
2. **Did not reproduce — I was wrong, and the measurement says so.** I claimed the manifest could
   record pre-stamp hashes. It cannot: `stamp_binary` calls `image.save(...)` **before**
   `regenerate_manifest(path)`, and the manifest reads from disk after the write. A three-file
   batch showed manifest hash == disk hash for every file. My concern would hold only if
   regeneration ran before the save.
   The instinct still pointed somewhere real, which the owner had not handled: two **concurrent**
   stamps would each regenerate the whole manifest and the last writer would certify a set it
   never observed. Serial is safe, parallel is not. Stamping must stay sequential unless a lock
   is added.
3. **A worse hole, found by neither of us.** The credential guard lived only in `main()`, so the
   CLI refused while the **library** wrote the secret — and a site builder calls that function
   directly. A guard at the entry point is a door, not a lock. Now enforced in the writers, with
   a test that fails if it regresses to `main()`-only. Lesson worth keeping: **when a policy
   matters, enforce it at the function that performs the effect, not at the one that gets asked.**

### 3.7 A gap the worker honest left open, closed by the parent

The worker declined to stamp `design/aesthetic-choices/.screenshots/` because those three files
fell outside its allowed edit surfaces, and said so rather than silently skipping them — the right
behaviour. They are in scope for Ricardo's rule: they are artwork he supplied and are referenced
from `comments.json` (`8yyi8ghh`, `gw7pt3cc`, `7xxd62vb`).

Closed here: three `X.meta.json` sidecars plus `.screenshots/OKF-MANIFEST.md`. The
`aesthetic-choices/` manifest now states that subdirectories carry their own manifests, so no row
claims coverage it does not have.

---

## 4. Verification actually performed

Booleans and measurements, never "it looks right".

| Check | Method | Result |
|---|---|---|
| Every embedded image has alpha | Pillow, all 9 blobs | `alpha=(0, 255)` |
| Moustache size and centring | CDP `getBoundingClientRect` | 36.00 px, dx=0, dy=0, fits 44 px box |
| Variant states are as intended | CDP, read badge text per column | A1 `✓ va bien`, A2 none, A3 `○ held for review` |
| Status red passes AA | WCAG relative luminance | `#FF718F` on `--danger-soft`/`--surface-2` = **5.39:1** |
| Chosen badge contrast | same | `--ok`/`--ok-soft` = **9.05:1** |
| Held badge contrast | same | `--info`/`--info-soft` = **7.51:1** |
| Markup not broken by edits | `html.parser` balance check | clean, both artboards |
| Hosted copy is byte-faithful | md5 of served body from `<!doctype` | `3f4841…` identical to origin |
| Hosted boards are reachable | `curl` | `/boards/` → 302, three boards → 200 |

The pure-black pixel count, the embed sha256, and the DOM measurement are the three checks that
produced decisions; the contrast ratios are the ones that prevented an accessibility regression.

---

## 5. Deliberately not done

- **No image loaded into this session.** A remote model has a hard 20-image cap; visual
  verification went to Bonsai2 with a path and four specific questions. Reading renders is what
  exhausted a session earlier today.
- **No commit, no stage, no push.** Branch has no upstream and has never been pushed.
- **No product decision taken.** Tint (A1/A2/A3) and stroke width (B1/B2/B3) are Ricardo's.
- **No change to `ui/`.** The mascot art lives only in the mockups; moving it into the product
  is a separate decision.
- **No OKF sidecar for the two JSON files.** Ricardo paused that: JSON metadata is delicate and
  the format (sidecar vs filename encoding) is undecided. Both files left byte-unchanged.
