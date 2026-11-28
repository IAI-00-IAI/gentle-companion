---
type: Session Log
title: "PINTO session log — aesthetic, i18n and sidebar work"
description: "Verified record of what this session built, what broke, what was measured against the wrong build, and what is still open. Written before compaction so the next session reads this instead of the transcript."
status: active
author: "PINTO (agent, session 01a1f971)"
source: "gentle-companion-aesthetic/odd/session-log-pinto.md"
generated: 2026-11-27
---

# PINTO — session log

**Read this first, not the transcript.** The transcript is 67% of a context window
and half of it is dead ends. This is what survived contact with the code.

Branch `feat/gentle-shell-aesthetic`. 35 commits ahead of `origin/main`.
Suite: **399 pass, 0 fail**. `svelte-check`: **0 errors, 0 warnings**.

---

## 1. THE THING TO KNOW BEFORE TOUCHING ANYTHING

### A daemon can serve a binary that no longer exists

```
pid 42049
exe -> .../gentle-companion-server (deleted)
```

The process was started 2026-11-26 16:39. I rebuilt, `cargo clean` replaced the
file on disk, and **the running process kept the deleted inode open**. Linux does
that until the process dies. It served `0.BR8Xzb2x.css`, a file that exists
nowhere on disk — `find /` will never locate it.

**Consequence:** every measurement I took before restarting was against the wrong
code. I reported "all pages at 52px" from that daemon. Ricardo saw something else,
and he was right.

**Check before trusting any measurement:**

```bash
pid=$(ss -ltnp | grep :9911 | grep -oE 'pid=[0-9]+' | cut -d= -f2)
ls -l /proc/$pid/exe        # must NOT say "(deleted)"
```

---

## 2. WHAT IS BUILT

### i18n (already merged and published in 0.7.x)
- A test that fails when a UI key is missing from the catalogue
- 36 missing keys added, `en` + `es`
- Automation pagination and flowchart translated (the flowchart needed two whole
  sentences, not a concatenation: Spanish changes gender, "este paso" vs "esta
  comprobación")
- 36 aria-labels, `Borrador`/`Listo` for Staged/Unstaged
- `Pi` inside phrases renders as `Gentle Shell`; `Pi-Jar` keeps its name

### Sidebar
- Collapsible by clicking the brand; logo is inside the toggle
- The `✿` mark removed (Ricardo chose "A, sin flor")
- Theme and language became cyclic pressers with an `aria-live` announcement
- **The trigger once hid itself**: `.brand-text` was its only child and got
  `display: none`, leaving the button with no hit area. It has a 40×40 target and
  a chevron now.

### AskSheet concurrency
Ricardo: a keystroke became an answer he never gave. Root cause was `autofocus`
stealing the caret, plus a one-click send path. Now: 600ms open delay, no
autofocus, submit gated on a settle flag, instant-send removed.

### Message queue (new behaviour, not a fix)
The product said `Messages are not queued` — it had never been built. One slot,
`Alt+ArrowUp` to recall, auto-send when the turn ends, visible indicator.

### Logo
Transparent rose for the sidebar; opaque asset for the hero (the dot field paints
ink directly when there is no alpha, so the black field vanishes and the rose
keeps full weight). EXIF, XMP and OKF iTXt all preserved.

---

## 3. WHAT BROKE, AND WHAT I GOT WRONG

**My commit `5aa94b2` fixed a real bug and created another.** Removing `instant`
left `{#if !instant}` in the markup. Nothing caught it: the compiler accepted it,
`svelte-check` reported 0 errors, the build passed, no test rendered the component.
At runtime it threw and SvelteKit showed an HTTP 500 that blamed the workspace
server. The client was at fault for hours.

**The guard** (`5912832`) compiles each component and looks for `if (!name)` in the
emitted JS with no binding anywhere in that output. It analyses **compiled output,
not source syntax** — my first attempt parsed source and produced 15 false
positives in a row (props, runes, `{@const}`, snippet params, destructured
`{#each}`). Proven to bite: reinstating the guard fails with
`lib/AskSheet.svelte: instant`.

**I did not commit the fix.** HEAD still had the bug while my working tree had the
repair. Caught by diffing an unexpected `git status` entry. Committed as
`ada1221`.

**I measured against the deleted binary** (section 1) and reported a fix that was
never verified. Ricardo's observation was more reliable than my measurement.

---

## 4. LAYOUT — the long thread, resolved

Ricardo: panels and spacing differ between sections.

**Width:** Settings was alone in carrying `.narrow { width: min(920px, 100%) }`.
Removed. All pages now 1180 / 1116 inner / 32 gutter.

**Top spacing:** three attempts, all measured:
1. `margin-top: 0` on first child — no change, margin was already 0
2. `:empty { display: none }` — no change, `PullToRefresh` is not empty
3. `.refresh-control { display: contents }` — no change, still took a grid row

**Real cause:** `PullToRefresh` was the first child *inside* `.page`, so it took a
grid row and the 24px gap counted before the header (28 + 24 = 52). Only Sessions
and Automations had it. **Fixed structurally**: the component moved outside
`.page`, because it is a container control, not page content.

Measured after, on a correctly rebuilt daemon: **28px on all six pages.**

---

## 5. HOW TO RUN THINGS

```bash
# Tests — the whole suite, not just the one you touched
node --test --experimental-strip-types --no-warnings test/*.test.ts

# Static checks — svelte-check catches type and dead-selector errors
# that the test suite cannot see
cd ui && npx svelte-check --fail-on-warnings

# UI build
npm run ui:build

# Daemon on a private port (never touch the human's 43721)
PI_COMPANION_ADMIN_ADDR=127.0.0.1:9911 \
PI_COMPANION_DEVICE_ADDR=127.0.0.1:9912 \
  ./server/target/release/gentle-companion-server

# Rebuild binary after a UI change — assets are EMBEDDED (assets.rs:20)
cd .. && cargo build --release --manifest-path server/Cargo.toml
```

**The binary embeds `web-dist/`.** A UI change without a Rust rebuild serves the
old assets. And an old *process* serves a deleted binary silently.

---

## 6. OPEN, WITH REASONS

| Item | State |
|---|---|
| 12 hardcoded `Pi` literals in 5 components | Needs 4 wording decisions from Ricardo; list in `odd/copy-review-pinto.md` §F |
| 5 untranslated source labels in AskSheet (`confirm` among them) | §G; a security confirmation should name what it authorises |
| Lazy load of session history (point 31) | Needs a decision on the `server/` boundary before writing |
| Mobile capture for point 38 | Not done; needs a narrow viewport pass |
| Theme density on 2K | Ricardo chose "freeze while moving" now, density after the move |
| Archived sessions | Feature request, to discuss with ORQ |

---

## 7. WHAT I COULD NOT VERIFY

- **The queue has never been tried in a real browser.** The tests are structural.
  Four cases still need a human: type while busy, second message rejected,
  `Alt+ArrowUp` recalls, auto-send on turn end.
- **`Alt+ArrowUp` could still collide** with a browser shortcut in some
  environment. It was `Alt+ArrowLeft`, which is browser-back and was eaten.
- **No render test exists for any component.** `mount()` needs a DOM and no
  jsdom/happy-dom is installed. Installing one is a project decision.

---

## 8. COMMITS, AND WHERE THEY LIVE

The branch **is on the remote** — `origin/feat/gentle-shell-aesthetic` exists at
`c44ee20`. My local HEAD is `2ffbffb`, **one commit ahead**. Earlier notes claiming
"35 commits with no copy outside this disk" were wrong.

Not pushed, by instruction: web push is Ricardo's call.

---

## 9. CONVENTIONS THAT COST TIME TO LEARN

- **Identity changes are proposed, agreed, then committed.** Ricardo's rule,
  after a `✿` appeared in a diff without discussion.
- **Nothing is deleted.** Discarded material goes to `odd/assets/descartados/`
  with a manifest; drafts to `borradores/`. Both are gitignored, their manifests
  are not.
- **Every artefact carries OKF.** PNGs get sidecars, HTML gets a comment block
  before `<!doctype`, markdown gets frontmatter. The `feature` field must be a
  real `odd/tasks/<name>.md` path or the canvas warns and ignores it.
- **A capture that exists is not a capture that is correct.** Measure the state
  the image claims to show — a blank screenshot weighs a few KB, a real one
  hundreds.
- **Answer Ricardo in Spanish; agent-to-agent in English.**
