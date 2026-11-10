# Adapt pi-companion to gentle-shell

Feature: `gentle-shell-adapt`. Make the `pi-companion` package usable under the `gentle-shell` / `gentle-pi` Pi environment: resolve its data home from gentle-shell's agent home, keep it loadable as a standard Pi package, restyle the web UI with gentle-shell's design tokens, and rebrand to "Gentle Companion".

## Context / decisions
- gentle-shell is `gentle-pi` 4.7.0, a Pi-native package/launcher built on `@earendil-works/pi-coding-agent@1.4.0` (same version pi-companion targets). Extension API surface (`ExtensionAPI`, `ExtensionContext`, `ExtensionUIContext`) is compatible — no import changes needed.
- gentle-shell launches Pi setting `PI_CODING_AGENT_DIR` and `GENTLE_PI_AGENT_HOME` to its agent home (`gentle-shell-launcher.ts:1122-1124`). Agent home default: `GENTLE_PI_AGENT_HOME || PI_CODING_AGENT_DIR || ~/.pi/agent` (`gentle-shell/agent-home.ts:10`).
- pi-companion currently resolves its data dir only via `PI_COMPANION_HOME`, fallback `~/.pi/agent/pi-companion` (`server/src/config.rs:119-122`).
- gentle-shell discovers loose extensions from `<agentDir>/extensions` and `<cwd>/.pi/extensions` and injects other declared packages via `-e` (`gentle-shell-launcher.ts:943,1006`).
- User decisions:
  - Integration: **Paquete Pi estándar** — install as a standard Pi package / register in gentle-shell `packages`; pi-companion only adapts home dir and theme.
  - Identity: **Gentle Companion, tema rosa oscuro** — rename UI to "Gentle Companion", adopt gentle-shell `Gentleman-Cute` dark-rose tokens as the theme.

## Specs
- S1: pi-companion's data/state home must resolve in this precedence: `PI_COMPANION_HOME` (most explicit) > `<agent home>/pi-companion` where `<agent home>` = `GENTLE_PI_AGENT_HOME` > `PI_CODING_AGENT_DIR` > `~/.pi/agent`. State file stays `state.json` under that dir; usage snapshot stays `usage.json`.
- S2: pi-companion must remain loadable as a standard Pi package by gentle-shell (its `pi.extensions` entry must be discoverable by gentle-shell's extension discovery / package injection).
- S3: The web UI adopts gentle-shell's dark-rose token set as its default theme: `--bg #060407`, `--accent #F095C8`, `--text #F6EFF3`, `--border #563040`, `--border-subtle #2A1720`, `--user-message-bg #2A1523`, `--muted #A78E9B`, `--dim #76616B`, `--deep-pink #C96AA2`, `--active-pink #FFB1DD`, `--warning #F2B86D`, `--error #FF718F`, `--selection #28121E`, `--tool-pending-bg #100A0F`, radius `8/12/16/999px`, fonts `Inter` / `IosevkaTerm NF`.
- S4: The UI is rebranded to "Gentle Companion": app title, PWA manifest name/short-name, and logo accent color updated to match gentle-shell.
- S5: README/docs explain how to install/load pi-companion under gentle-shell and document the new home env vars.

## Tasks
- T1 — Resolve companion data home from gentle-shell home env vars. Route: `server/src/config.rs` (+ Rust test). Covers S1. Commit: `feat: resolve companion home from gentle-shell agent home`.
- T2 — Keep pi-companion loadable as a standard Pi package under gentle-shell; add gentle-shell install helper/docs. Route: `package.json`, `tools/install-gentle-shell.mjs` (new), `README.md`. Covers S2, S5. Commit: `feat: add gentle-shell package install path and docs`.
- T3 — Restyle web UI with gentle-shell dark-rose tokens. Route: `ui/src/app.css`, `ui/src/lib/theme.svelte.ts`. Covers S3. Commit: `style: adopt gentle-shell dark-rose theme`.
- T4 — Rebrand UI to "Gentle Companion" (title, manifest, logo). Route: `ui/src/routes/+layout.svelte`, `ui/static/manifest.webmanifest`, `ui/src/assets/morph/logo.svg`. Covers S4. Commit: `feat: rebrand UI to Gentle Companion`.
- T5 — Build, test, smoke. Route: `npm run check`, `npm run test`, `npm run test:smoke`. Covers S1-S4 verification. Commit: none (verification).

## Risk
- T1: high-ish — changes where companion state lives; wrong precedence could drop existing state. Mitigation: preserve `~/.pi/agent/pi-companion` fallback and `PI_COMPANION_HOME` top priority; Rust test asserts precedence.
- T2: medium — extension discoverability depends on gentle-shell package discovery; verify with a load test.
- T3/T4: medium (UI) — restyle may break layout; verify visually + smoke previews.

## Log
- L1: User request verbatim: "adapta pi-companion para usarlo con /home/ricardo/Trabajo/IAI/gentle-shell (es un fork de pi), ajusta directorios y todo lo necesario, adapta también los temas gráficos a los usados en gentle-shell (hay ya una hoja de estilos en /home/ricardo/Trabajo/IAI/gentle-shell/design/system.md o /home/ricardo/Trabajo/IAI/gentle-shell/design(system.html )"
- L2 (decisions): Integration = "Paquete Pi estándar". Identity = "Gentle Companion, tema rosa oscuro".
- L3 (evidence): gentle-shell agent home = `GENTLE_PI_AGENT_HOME || PI_CODING_AGENT_DIR || ~/.pi/agent`; launcher sets `PI_CODING_AGENT_DIR`+`GENTLE_PI_AGENT_HOME` to home. pi-companion data dir currently `PI_COMPANION_HOME || ~/.pi/agent/pi-companion`. Pi version aligned at 1.4.0. gentle-shell default look = Gentleman-Cute dark rose.

## Progress — complete
- T1 — Resolve companion data home from gentle-shell home env vars. DONE. Route: `server/src/config.rs` + Rust test. Commit: `9d8f6ab`. Covers S1.
- T1b — TypeScript home resolution. DONE. Route: `src/home.ts` (new), `src/daemon.ts`, `src/background-service.ts`, `test/home.test.ts` (new), `test/daemon-lifecycle.test.ts`. Commit: `9d6843a`. Covers S1 (extension side).
- T2 — Keep pi-companion loadable as a standard Pi package under gentle-shell; add install helper/docs. DONE. Route: `package.json`, `tools/install-gentle-shell.mjs` (new), `README.md`. Commit: `b6b9df3`. Covers S2, S5.
- T3 — Restyle web UI with gentle-shell dark-rose tokens. DONE. Route: `ui/src/app.css`, `ui/src/lib/theme.svelte.ts`, `ui/src/routes/settings/+page.svelte`. Commit: `eccce0d`. Covers S3.
- T4 — Rebrand UI to "Gentle Companion". DONE. Route: `+layout.svelte`, `manifest.webmanifest`, `app.html`, `logo.svg`, PWA icons, `service-worker.js`, all UI brand strings. Commit: `eccce0d` (with T3). Covers S4.
- T5 — Build, test, smoke. DONE. Verification evidence below.

## Verification evidence (T5)
- UI build: `npm run ui:build` — ✓ wrote `server/web-dist`; dark-rose tokens present in built CSS, old amber palette absent, "Gentle Companion" present in built HTML/manifest.
- TypeScript tests: `node --test --experimental-transform-types test/*.test.ts ui/automation.test.ts` (Node v24.18.0) — 268 tests, 268 pass, 0 fail.
- Rust tests: `cargo test --manifest-path server/Cargo.toml` — 66 passed, 0 failed.
- Type check: `npm run check` — tsc --noEmit clean; svelte-check 0 errors, 0 warnings.
- Smoke: `npm run test:smoke` — UI build + cargo build + daemon HTTP smoke: "Daemon HTTP smoke passed: routes, version, create/start/history, authentication, shutdown."

## Delivery
- Work-unit commits on `feat/gentle-shell-adapt` (4 commits, 594 authored lines):
  - `9d8f6ab` feat(server): resolve companion data home from gentle-shell agent home
  - `9d6843a` feat(extension): resolve companion home from gentle-shell agent home
  - `b6b9df3` docs: add gentle-shell install path and companion home reference
  - `eccce0d` feat(ui): restyle with gentle-shell dark-rose theme and rebrand to Gentle Companion
- Push / PR / merge remain the user's decisions.
