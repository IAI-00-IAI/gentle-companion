---
type: Design System
title: Gentle Companion design system (synced)
description: "Tokens captured from ui/src/app.css and docs/design-system.md for the gentle-design canvas. Every value is read from the sources, none invented."
status: active
generated: 2026-11-20
---

# Gentle Companion — design system (synced)

Captured read-only from the project sources so the canvas artboards use real tokens.
Sources: `ui/src/app.css` (defaults + `[data-theme='light']`), `docs/design-system.md`.
No project source was modified.

Palette doctrine (from `docs/design-system.md`): the anchor `#F095C8` is the
**dark/identity** colour; light mode uses the darker derivative `#C96AA2` because
`#F095C8` reaches only 1.97:1 on paper. Do not "fix" the light accent to match the anchor.

## Colors — dark (default, `:root, [data-theme='dark']`)

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--bg` | `#1a1218` | App background (plum) | `ui/src/app.css` |
| `--bg-sunken` | `#000000` | Deepest well | `ui/src/app.css` |
| `--surface` | `#20161e` | Base surface | `ui/src/app.css` |
| `--surface-2` | `#241822` | Raised surface | `ui/src/app.css` |
| `--surface-3` | `#342230` | Highest surface | `ui/src/app.css` |
| `--border` | `#342230` | Default border | `ui/src/app.css` |
| `--border-strong` | `#4d3146` | Emphasised border | `ui/src/app.css` |
| `--border-soft` | `#ffffff17` | Hairline | `ui/src/app.css` |
| `--text` | `#F6EFF3` | Primary text | `ui/src/app.css` |
| `--text-2` | `#A78E9B` | Secondary text | `ui/src/app.css` |
| `--text-3` | `#76616B` | Metadata | `ui/src/app.css` |
| `--accent` | `#F095C8` | Primary accent | `ui/src/app.css` |
| `--accent-hover` | `#FFB1DD` | Accent hover | `ui/src/app.css` |
| `--accent-text` | `#FFB1DD` | Accent text/icons | `ui/src/app.css` |
| `--accent-ink` | `#28121E` | Text on accent fills | `ui/src/app.css` |
| `--accent-soft` | `rgb(240 149 200 / 0.12)` | Soft accent fill | `ui/src/app.css` |
| `--accent-line` | `rgb(240 149 200 / 0.38)` | Accent hairline | `ui/src/app.css` |
| `--ok` | `#b4e7c7` | Success | `ui/src/app.css` |
| `--warning` | `#e0c27a` | Warning | `ui/src/app.css` |
| `--info` | `#a9c7ee` | Information | `ui/src/app.css` |
| `--danger` | `#FF718F` | Error / destructive | `ui/src/app.css` |
| `--ok-soft` | `rgb(180 231 199 / 0.14)` | Success badge fill | `ui/src/app.css` |
| `--warning-soft` | `rgb(224 194 122 / 0.14)` | Warning badge fill | `ui/src/app.css` |
| `--info-soft` | `rgb(169 199 238 / 0.14)` | Info badge fill | `ui/src/app.css` |
| `--danger-soft` | `rgb(255 113 143 / 0.12)` | Danger badge fill | `ui/src/app.css` |
| `--code-bg` | `#171018` | Code surface | `ui/src/app.css` |

## Colors — light (`[data-theme='light']`)

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--bg` | `#f8f5f7` | Paper background | `ui/src/app.css` |
| `--bg-sunken` | `#f0eae0` | Deepest well | `ui/src/app.css` |
| `--surface` | `#ffffff` | Base surface | `ui/src/app.css` |
| `--surface-2` | `#f7f3f5` | Raised surface | `ui/src/app.css` |
| `--surface-3` | `#efe8ec` | Highest surface | `ui/src/app.css` |
| `--border` | `#e0d3dc` | Default border | `ui/src/app.css` |
| `--border-strong` | `#c9b0c0` | Emphasised border | `ui/src/app.css` |
| `--text` | `#1a161a` | Primary text | `ui/src/app.css` |
| `--text-2` | `#6d5f6a` | Secondary text | `ui/src/app.css` |
| `--text-3` | `#90818c` | Metadata | `ui/src/app.css` |
| `--accent` | `#C96AA2` | Primary accent on paper | `ui/src/app.css` |
| `--accent-hover` | `#F095C8` | Accent hover | `ui/src/app.css` |
| `--accent-text` | `#A8517E` | Accent text (AA contrast) | `ui/src/app.css` |
| `--accent-soft` | `rgb(201 106 162 / 0.14)` | Soft accent fill | `ui/src/app.css` |
| `--accent-line` | `rgb(201 106 162 / 0.4)` | Accent hairline | `ui/src/app.css` |
| `--ok` | `#17824f` | Success | `ui/src/app.css` |
| `--danger` | `#c2372d` | Error / destructive | `ui/src/app.css` |

## Typography

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--font` | `Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Sans stack | `ui/src/app.css` |
| `--mono` | `"IosevkaTerm NF", "Iosevka Term", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace` | Mono stack | `ui/src/app.css` |

Base size is `15px` with `line-height: 1.5` on `:root`. Only system and
locally-declared font stacks are used; nothing loads from the network.

## Radius

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--radius-sm` | `8px` | Small controls | `ui/src/app.css` |
| `--radius-md` | `12px` | Medium | `ui/src/app.css` |
| `--radius` | `12px` | Default | `ui/src/app.css` |
| `--radius-lg` | `16px` | Large | `ui/src/app.css` |
| `--radius-pill` | `999px` | Pills | `ui/src/app.css` |
| `--radius-bento` | `20px` | Bento tiles | `ui/src/app.css` |
| `--clay-radius` | `22px` | Clay surfaces | `ui/src/app.css` |

## Shadows (claymorphism)

Solid surfaces, outer drop shadow plus inset highlight and shade. No blur or glass.
Dark values shown; light overrides exist in the same file with warm-grey tints.

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--clay-raised` | `0 12px 26px -12px rgb(0 0 0 / 0.65), inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 -4px 8px rgb(0 0 0 / 0.38)` | Raised panel | `ui/src/app.css` |
| `--clay-soft` | `0 5px 12px -6px rgb(0 0 0 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 -2px 5px rgb(0 0 0 / 0.32)` | Soft elevation | `ui/src/app.css` |
| `--clay-pressed` | `inset 0 3px 8px rgb(0 0 0 / 0.5), inset 0 -1px 0 rgb(255 255 255 / 0.05)` | Pressed / inset well | `ui/src/app.css` |
| `--clay-accent` | `0 10px 20px -10px rgb(240 149 200 / 0.6), inset 0 2px 1px rgb(255 255 255 / 0.35), inset 0 -4px 7px rgb(95 35 65 / 0.4)` | Accent button | `ui/src/app.css` |

## Layout constants

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--sidebar` | `244px` | Sidebar width | `ui/src/app.css` |
| `--tabbar` | `64px` | Mobile tab bar height | `ui/src/app.css` |

## Component rules

- **Icons** are Lucide line icons inlined in `ui/src/lib/Icon.svelte` (ISC); `stroke-width` is a prop, default `2`. Nav and tab bar pass `2.5`.
- **Clay surfaces** use `--clay-radius` with `--clay-raised` / `--clay-soft`; interactive pressed states use `--clay-pressed`.
- **Small icons** sit on raised clay wells rather than floating on the surface.
- **The ✿ petal glyph** is the brand accent, set next to the logo in the sidebar and topbar, coloured `--accent`.
- **The app icon is the rose**, not the π. Both `ui/src/assets/morph/logo.svg` and `logo-gentle.svg` are the π mark and must never be used to regenerate the app icons.

## Known open items

Both are live in the shipped UI and pending a decision; see `docs/design-system.md`.

- The clay art tint at `ui/src/routes/+page.svelte:368` is `sepia(0.55) saturate(1.65) hue-rotate(350deg)`, producing amber (~45–60° hue) from greyscale source art. It is shared by three selectors.
- Icon stroke width `2.5` on nav/tab bar: intent undocumented, difference from `2` judged subtle.
