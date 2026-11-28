# Align gentle-companion visual identity to gentle-shell

Goal: re-skin gentle-companion to gentle-shell's pink "Gentleman" aesthetic. Scope confirmed by user: full palette remap (dark + light), logo alignment, new `✿` petal glyph, all assets (PWA, favicon, README screenshots), plus a complete style book in docs.

## Specs

- **S1** (user verbatim): "busca los recursos de diseño gráfico de gentle-shell, quiero alinear gentle-companion con la estética de gentle-shell"
- **S2** (user verbatim): "busca los recursos de marca de gentle-shell, quiero cambiar el logo (y la estética en general) para alinearlos con gentle-shell"
- **S3** (user choice): "Completa + glifo ✿" — remap the full palette and introduce the `✿` petal glyph in the UI.
- **S4** (user custom): "Todo y añade un cuaderno/hoja de estilos completa en docu" — everything (PWA, favicon, README screenshots) plus a complete style book in docs.
- **S5** (user choice): color anchor "Rosa Gentleman (#f095c8)" — align to gentle-shell's pink family: accent `#f095c8`, dark plum backgrounds, `Inter` + `Iosevka Term/JetBrains Mono`.

## Specs (continued)

S6 — In the sidebar, the rose logo is the collapse/expand toggle and the title text carries the
link to `/`. The `✿` mark is removed everywhere. Collapsed, the toggle keeps a real hit target and
the nav icons plus the life indicator stay visible. The route home must remain reachable even
though the brand no longer links there.

## Target palette (from gentle-shell design/system.md)

| Token | Value |
| --- | --- |
| bg | `#1a1218` |
| bg-deep | `#000000` |
| surface | `#20161e` |
| surface-1 | `#241822` |
| surface-2 | `#342230` |
| border | `#342230` |
| border-soft | `#ffffff17` |
| text | `#f6eff3` |
| text-muted | `#a78e9b` |
| text-faint | `#76616b` |
| accent | `#f095c8` |
| accent-strong | `#ff76c3` |
| accent-soft | `#ffb1dd` |
| success | `#b4e7c7` |
| warning | `#e0c27a` |
| error | `#ff718f` |
| info | `#a9c7ee` |
| font-sans | `Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| font-mono | `"IosevkaTerm NF", "Iosevka Term", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace` |

## Tasks

- T1 — S1,S4 — Create this feature doc + Engram mirror. [meta, no commit]
- T2 — S5 — Remap dark + light CSS tokens in `ui/src/app.css` to the table above. Commit 1.
- T3 — S2,S3 — Align logo SVGs (`ui/static/pwa-icon.svg`, `ui/src/assets/morph/logo.svg`) and raster assets to the pink palette. Commit 2.
- T4 — S3 — Introduce the `✿` petal glyph in the UI (header/prompt). Commit 3.
- T5 — S2 — Update stale "warm amber" branding copy in `ui/src/app.css:2-3` and `README.md:500`. Commit 4.
- T6 — S4 — Update PWA manifest colors + regenerate PWA icons / favicon. Commit 5.
- T7 — S4 — Add a complete style book in `docs/`. Commit 6.
- T8 — S4 — Update README screenshots / re-capture (fallback if app cannot be run). Commit 7.
- T9 — S6 — Sidebar brand: logo toggles collapse, text stays the home link, no `✿`. Handoff from canvas artboard `front-review/01-sidebar-expanded.html`. **Reopened**: the artboard shows the pre-decision state, so the capture must be regenerated after the code matches.

## Log

- L1 (user, verbatim): "busca los recursos de diseño gráfico de gentle-shell, quiero alinear gentle-companion con la estética de gentle-shell"
- L2: User chose color anchor "Rosa Gentleman (#f095c8)".
- L3: User chose scope "Completa + glifo ✿" and custom "Todo y añade un cuaderno/hoja de estilos completa en docu".
- L4: gentle-companion dark accent is already `#F095C8`; gaps are dark bg/border (bluer `#060407`/`#563040`), light accent `#C96AA2`, stale "warm amber" copy, no `✿` glyph, old README screenshots.
- L5: Logo π recreated (Ricardo: "recrealo, no hay svg, que lo cree tmb"). Created ui/src/assets/morph/logo-gentle.svg as the editable source (line style coherent with morph/logo.svg; π #F095C8, orbit+moon #FFB1DD). Regenerated ui/src/assets/gentle-companion.webp (512x512) from that SVG: pink π on a #1a1218 rounded bg, replacing the old gold π. Renamed to drop "pi-" from asset names (project/app is gentle-companion). Verified legible at 512/96/48 px. No commit, no build; on branch fix/pairing-screen-polish.
- L6: Two visual decisions still open, so they were put on the design canvas instead of being decided or described: `design/aesthetic-choices/` holds `01-clay-tint.html` (A1 amber 350deg / A2 rose 286deg / A3 coral 320deg) and `02-icon-weight.html` (B1 2.0 / B2 2.5 / B3 3.0). The hue for each tint variant was computed by modelling the CSS filter chain on the real `bulb.webp`, not estimated: the first assumption that `330deg` would give the rose was wrong (it yields hue 20deg), and `286deg` is the measured match for the 326deg accent. Mockups only: `ui/src` unchanged. Design system synced to `design/system.md` + `design/system.html` from `ui/src/app.css` (58 token rows, all values verbatim).

### L9 — Handoff: artboard `front-review/01-sidebar-expanded.html` (2026-11-24)

The canvas offered this artboard as the implementation spec. **It is a capture of the running app,
not a design source**, and it is stale: it shows the `✿` and the old brand split (link + button),
both superseded by later decisions. So there was no visual spec to copy — the work was to make the
code match what was actually decided, then regenerate the capture so the board stops describing a
state that no longer exists.

Verified before touching code: every colour in the artboard (`#1a1218`, `#20161e`, `#342230`,
`#F6EFF3`, `#A78E9B`, `#F095C8`) exists in `ui/src/app.css`, so the capture is faithful to the
token source and nothing invented needs importing.

**Open, and blocking the final shape:** Ricardo wrote "El llevar a inicio lo puede mantener el
texto del logo". Read literally, the TEXT keeps the link home and the LOGO becomes the toggle. An
earlier message of mine stated the reverse and was wrong. He will confirm when his canvas review
finishes, so the structure is not changed yet.

## T10 — Border alignment (canvas comment 01-overview)

**Spec**: S6 plus Ricardo's canvas comment: "el ancho del borde tiene que estar
todos alineados... calcular el borde sin ese mensaje", and his follow-up
decision: "todos los banners de notificaciones de este tipo deben tener el
mismo, quizás lo más fácil que el margen esté alineado con el de la page y que
quede unificado".

**Cause (measured, 1440px, six pages)**: `main.content` scrolls, so its 21px
scrollbar sat inside the content box. `.page` uses `margin: 0 auto`, so it
centred on the scrollable width (1015px) not the box (1036px): left flush at
244, right 21px short at 1259. All six pages scroll, so all six were crooked.

**Fix**: `scrollbar-gutter: stable both-edges` on `.content` (`stable` alone
leaves the leading edge flush). The four banners moved INSIDE `main.content`
with `max-width: calc(min(1180px,100%) - 64px)` mirroring the page's inline
padding; a separate query covers the 16px mobile indent.

**Measured after**, with the final binary on `/`, `/automations`, `/settings`:
banner and first panel both 297..1227; `.page` margins 21/21.

**Caught by an existing test**: `sidebar.test.ts` failed because the banner rule
sat between `@media (max-width: 900px) {` and `.shell`. Moved to its own query.

**Commit**: d2a8e1b. **Tests**: `test/page-gutter.test.ts` (RED observed without
the fix, GREEN with it); 401 pass; svelte-check 0/0.

