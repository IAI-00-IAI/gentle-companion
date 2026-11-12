# Rebrand pi-companion to gentle-shell + add Spanish

Feature: `gentle-shell-rebrand`. Rebrand the user-facing command references from `pi` to `gentle-shell`, point repository references at the new repository `IAI-00-IAI/gentle-companion`, and add a Spanish version of the app UI and the docs.

## Background

The repo lives at `/home/ricardo/Trabajo/IAI/pi-companion`, on branch `feat/gentle-shell-adapt`. The package was already restyled/rebranded in `gentle-shell-adapt` (theme, logo, "Gentle Companion" name). The remote is `https://github.com/IAI-00-IAI/gentle-companion.git`. The app is a SvelteKit UI (`ui/src`) embedded in a Rust daemon; strings are hardcoded in English with no existing i18n infrastructure.

## Specs

- S1: User-facing command references in README.md, docs/*.md, and the web UI should use `gentle-shell` instead of `pi` for install/run commands (e.g. `pi install` → `gentle-shell install`, `pi -e` → `gentle-shell -e`, `pi mcp add` → `gentle-shell mcp add`).
- S2: Repository references should point at the new repository `IAI-00-IAI/gentle-companion` (not `ygrip/pi-companion`).
- S3: The web app must be bilingual, with a switchable Spanish version (default English).
- S4: The documentation must include a Spanish version.
- S5: Do not change internal identifiers that are not user-facing command/repo references: npm package name `@yunazgr/pi-companion`, daemon binary name `pi-companion-server`, cache keys, localStorage keys, state directory `~/.pi/agent/pi-companion`, and the `pi.extensions` / `pi.package` manifest keys (these must stay for Pi compatibility).

## Tasks

- T1 — Update README.md command and repository references. Covers S1, S2. Route: `README.md`. Commit: `docs: rebrand README commands to gentle-shell and point at gentle-companion`.
- T2 — Update docs/automations.md command and repository references. Covers S1, S2. Route: `docs/automations.md`. Commit: `docs: rebrand automations docs to gentle-shell`.
- T3 — Update user-facing repository metadata (package.json homepage/repository/bugs/image, src/daemon.ts REPO, tools/promo-video/README.md). Covers S2. Route: `package.json`, `src/daemon.ts`, `tools/promo-video/README.md`. Commit: `chore: point repo metadata at IAI-00-IAI/gentle-companion`.
- T4 — Create i18n infrastructure: dictionary module, reactive language state, localStorage persistence, language toggle. Covers S3. Route: `ui/src/lib/i18n.ts` (new), `ui/src/routes/settings/+page.svelte`, `ui/src/routes/+layout.svelte`. Commit: `feat(ui): add i18n dictionary and language toggle`.
- T5 — Translate all user-facing UI strings in `.svelte` and lib files to use the i18n module (ES + EN). Covers S3. Route: all `ui/src/**/*.svelte` and `ui/src/lib/*.ts` with hardcoded UI copy. Commit: `feat(ui): translate app UI to Spanish`.
- T6 — Add Spanish documentation. Covers S4. Route: `docs/automations.es.md` (new), README link if appropriate. Commit: `docs: add Spanish automations documentation`.
- T7 — Verify: run `npm run check`, `npm run test`, and grep for stray `pi ` command references / `ygrip/pi-companion` in user-facing files. Covers all. Commit: none (verification only).

## Log

- L1: User request verbatim: "En las páginas web, readme y documentación hay que corregir las referencias de los comandos pi y sustituirlos por gentle-shell, también las referencias al repositorio (hay que referenciar el nuevo), también hace falta que la app y documentación esté en bilingüe, con versión en español"
- T1 DONE — README.md commands + repo refs (commit `5fd8621`). Reopened for L2: fork header + all user-facing 'Pi' → 'Gentle Shell' (commit `9845197`). Verified clean of `pi install`/`pi -e`/`pi mcp`/`ygrip/pi-companion`; only `Pi Jar`, `a Pi fork`, `Pi package gallery` and internal identifiers remain.
- T2 DONE — docs/automations.md commands + repo refs. Commit `95a2315`.
- T3 DONE — repo metadata (package.json, daemon.ts, lib.rs, terms, help). Commit `c514f81`. Rendered promo assets `docs/pi-companion-promo.*` left as-is (recorded footage git-ignored/absent); `lib.rs` source refs fixed for future re-record.
- T4 DONE — i18n infra + language toggle. `ui/src/lib/i18n.svelte.ts` (renamed from `.ts`; `$state` global in `.svelte.ts`, `export let lang`). `svelte-check` clean.
- T5 DONE — full UI translated to i18n (ES + EN) across all pages: main, settings, help, privacy, terms, pair, sessions, automations, devices, error, about, permissions, artifact preview, automation editor (followed by the `spanish-translation.md` extension, commits `078dfd7`/`e997773`/`6818bef`). Overview rebrand pass (commit `dde8d01`) replaced 'Pi' with 'Gentle Shell' in Overview copy and removed the redundant hero language selector (toggle now in left panel + Settings). `npm run ui:check`: 0 errors, 0 warnings.
- T6 DONE — `docs/automations.es.md` complete (all 10 sections, no stale command/repo refs); README links both `docs/automations.md` and `docs/automations.es.md`.
- L2: User request verbatim (README expansion): "El README.md hay que tocarlo, decir en el encabezado que es una bifurcación/fork de https://github.com/ygrip/pi-companion para adaptarlo a Gentle Shell pero en el resto de referencias de repositorio que apunten a https://github.com/IAI-00-IAI/gentle-companion. Y repasar que todas las referencias a 'Pi' estén sustituidas por 'Gentle Shell'". Scope expanded from command-focused to all user-facing 'Pi' product references (fork header + full rebrand of README). Commit `9845197`. Kept: `Pi Jar` extension name, `a Pi fork`, `Pi package gallery`/`pi.dev/packages`, and all internal identifiers.

## Notes / decisions

- Command references in docs describing daemon internals (e.g. "A Pi action starts `pi --mode rpc --no-session`") are changed to `gentle-shell --mode rpc` for consistency; flag if the daemon literally still shells out to `pi`.
- "Pi sessions", "Pi owns execution", "Pi 1.4.0" etc. are product/platform references (not commands); per L2 the user requested these be replaced with 'Gentle Shell' in README.md (commit `9845197`). Kept: `Pi Jar` (extension name), `a Pi fork` (upstream reference), `Pi package gallery`/`pi.dev/packages` (real gallery), and all internal identifiers.
- No destructive git operations. Work on `feat/gentle-shell-adapt`.
- i18n default language: English, switchable to Spanish, persisted in localStorage.
- Delivery strategy: `single-pr` — user chose "One PR" at the slice boundary. All remaining work lands in one pull request to main.
- Slice boundary recorded at commit `2f8c409`: 1272 authored changed lines on `feat/gentle-shell-adapt` since main (lock files excluded). No further splitting; final delivery is a single PR.
