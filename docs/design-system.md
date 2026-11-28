---
type: Design System
title: Gentle Companion Design System
description: "Style book for the Gentle Companion web UI; palette aligned with gentle-shell's pink Gentleman palette (warm rose on plum in dark, warm rose on paper in light)."
tags:
  - design-system
  - gentle-companion
  - ui
  - palette
  - gentle-shell
status: active
generated:
  by: gentle-companion-agent/bonsai2-TernaryL-27B
  at: 2026-11-18T22:42:30Z
  revised:
    by: PINTO/session-01a1f971
    at: 2026-11-20T17:15:00Z
    note: "Light/dark accent doctrine, dead-token claims, icon sources and opaque-field rule, two measurement lessons." 
sources:
  - id: app-css
    resource: ui/src/app.css
    title: "Gentle Companion UI CSS — source of truth for tokens"
  - id: logo-svg
    resource: ui/src/assets/morph/logo.svg
    title: "Gentle logo SVG"
---

# Gentle Companion — Design System

Style book for the Gentle Companion web UI. The palette is aligned with
gentle-shell's pink "Gentleman" palette: warm rose on plum (dark) or paper
(light), matching gentle-shell. Source of truth: `ui/src/app.css`.

- Typeface: **Inter** (system fallbacks), monospace **Iosevka Term** / JetBrains Mono.
- Accent: **pink**. The S5 anchor `#F095C8` is the **dark/identity** colour; light
  mode uses a darker derivative `#C96AA2`. This is a rule, not an exception: on paper
  `#F095C8` reaches only **1.97:1** contrast (under the 3:1 non-text minimum), while
  `#C96AA2` reaches **3.20:1**, and `--accent-text` `#A8517E` reaches **4.68:1** for
  text. On plum, `#F095C8` reaches **8.60:1**. Do not "fix" the light accent to match
  the anchor; contrast is the reason for the split.
- Signature mark: the **✿ petal glyph**, used as a brand accent next to the logo.

## Open items

Two visual questions are live in the shipped UI and are **not yet decided**. This
document is `active` because it names them, not because they are settled.

- **Amber hourglass/bulb clay art** — `ui/src/assets/clay/bulb.webp` (256×256), the
  "First time here?" tile on the dashboard. The only genuinely off-brand element a
  visual review found: it reads amber-yellow in an otherwise rose/plum palette.
  **Not an asset problem.** The file is greyscale (0 saturated pixels); the colour comes
  entirely from one shared CSS tint at `ui/src/routes/+page.svelte:368`:

  ```css
  .guide-art img, .section-head h2 img, .empty .empty-icon img {
    filter: sepia(0.55) saturate(1.65) hue-rotate(350deg);
  }
  ```

  Measured output of that chain is hue ≈45–60° (amber). The same filter also tints
  `clay/computer.webp`, which is greyscale for the same reason, so the decision is about
  the **rule**, not the one image. Pending a decision from Ricardo: point the tint at the
  rose family (`hue-rotate` toward ≈330°), or keep amber as a deliberate warm accent.
  Cheap either way — one CSS line, no asset regeneration.
- **Icon stroke width 2.5** — `.nav` and `.tabbar` icons in `ui/src/routes/+layout.svelte`,
  passed as the `strokeWidth` prop to `Icon.svelte`. The intent is undocumented, and a
  visual review judged the difference from the default `2` to be subtle rather than
  visibly bolder. Pending a decision from Ricardo: raise it until the change is
  visible, or keep `2.5` and describe it accurately as a slight refinement.

---

## 1. Dark theme tokens

Active as the default and via `data-theme='dark'`.

### Base / background

| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | <span class="swatch" style="background:#1a1218"></span>`#1a1218` | App background (plum) |
| `--bg-sunken` | <span class="swatch" style="background:#000000"></span>`#000000` | Wells, inputs, segmented controls |
| `--surface` | <span class="swatch" style="background:#20161e"></span>`#20161e` | Cards, panels, buttons |
| `--surface-2` | <span class="swatch" style="background:#241822"></span>`#241822` | Hover surfaces, quiet chips |
| `--surface-3` | <span class="swatch" style="background:#342230"></span>`#342230` | Elevated/quiet badges |
| `--tool-pending-bg` | <span class="swatch" style="background:#100A0F"></span>`#100A0F` | Pending tool-call background |
| `--code-bg` | <span class="swatch" style="background:#171018"></span>`#171018` | Code blocks |
| `--overlay` | <span class="swatch" style="background:rgb(0 0 0 / 0.55)"></span>`rgb(0 0 0 / 0.55)` | Dialog backdrops |
| `--selection` | <span class="swatch" style="background:#28121E"></span>`#28121E` | Text selection |

### Border

| Token | Value | Usage |
| --- | --- | --- |
| `--border` | <span class="swatch" style="background:#342230"></span>`#342230` | Default borders |
| `--border-strong` | <span class="swatch" style="background:#4d3146"></span>`#4d3146` | Inputs, buttons, scrollbars |
| `--border-soft` | `#ffffff17` | Hairline separators |

### Text

| Token | Value | Usage |
| --- | --- | --- |
| `--text` | <span class="swatch" style="background:#F6EFF3"></span>`#F6EFF3` | Primary text |
| `--text-2` | <span class="swatch" style="background:#A78E9B"></span>`#A78E9B` | Secondary text, `.muted` |
| `--text-3` | <span class="swatch" style="background:#76616B"></span>`#76616B` | Tertiary text, `.subtle`, placeholders |
| `--accent-ink` | <span class="swatch" style="background:#28121E"></span>`#28121E` | Text/icons on accent fills |

### Accent (pink)

| Token | Value | Usage |
| --- | --- | --- |
| `--accent` | <span class="swatch" style="background:#F095C8"></span>`#F095C8` | Primary accent, active dots, brand ✿ |
| `--accent-hover` | <span class="swatch" style="background:#FFB1DD"></span>`#FFB1DD` | Hover state on accent fills |
| `--accent-text` | <span class="swatch" style="background:#FFB1DD"></span>`#FFB1DD` | Accent-colored text/icons |
| `--accent-soft` | <span class="swatch" style="background:rgb(240 149 200 / 0.12)"></span>`rgb(240 149 200 / 0.12)` | Soft accent fills, focus rings |
| `--accent-line` | <span class="swatch" style="background:rgb(240 149 200 / 0.38)"></span>`rgb(240 149 200 / 0.38)` | Accent hairlines |
| `--deep-pink` | <span class="swatch" style="background:#C96AA2"></span>`#C96AA2` | **Unused.** Legacy alias with no consumers in `ui/src`; retained in CSS, not part of the live palette |
| `--active-pink` | <span class="swatch" style="background:#FFB1DD"></span>`#FFB1DD` | **Unused.** Legacy alias with no consumers in `ui/src`; retained in CSS, not part of the live palette |
| `--glow` | `0 10px 30px #f095c84d` | Ambient pink glow |

### Status

| Token | Value | Usage |
| --- | --- | --- |
| `--ok` | <span class="swatch" style="background:#b4e7c7"></span>`#b4e7c7` | Online / success |
| `--ok-soft` | <span class="swatch" style="background:rgb(180 231 199 / 0.14)"></span>`rgb(180 231 199 / 0.14)` | Soft success fills |
| `--warning` | <span class="swatch" style="background:#e0c27a"></span>`#e0c27a` | Warnings, starting states |
| `--warning-soft` | <span class="swatch" style="background:rgb(224 194 122 / 0.14)"></span>`rgb(224 194 122 / 0.14)` | Soft warning fills |
| `--danger` | <span class="swatch" style="background:#FF718F"></span>`#FF718F` | Errors, offline / revoked |
| `--danger-soft` | <span class="swatch" style="background:rgb(255 113 143 / 0.12)"></span>`rgb(255 113 143 / 0.12)` | Soft danger fills |
| `--info` | <span class="swatch" style="background:#a9c7ee"></span>`#a9c7ee` | Informational accents |
| `--info-soft` | <span class="swatch" style="background:rgb(169 199 238 / 0.14)"></span>`rgb(169 199 238 / 0.14)` | Soft info fills |

### Diff

| Token | Value | Usage |
| --- | --- | --- |
| `--diff-add` | <span class="swatch" style="background:rgb(180 231 199 / 0.12)"></span>`rgb(180 231 199 / 0.12)` | Added lines |
| `--diff-del` | <span class="swatch" style="background:rgb(255 113 143 / 0.12)"></span>`rgb(255 113 143 / 0.12)` | Removed lines |

### Background field & decoration

| Token | Value | Usage |
| --- | --- | --- |
| `--dot-color` | <span class="swatch" style="background:#F095C8"></span>`#F095C8` | Dot-field base color |
| `--grid-line` | `color-mix(in srgb, var(--accent) 11%, transparent)` | 30px background grid |
| `--ambient-dot` | `color-mix(in srgb, var(--accent) 14%, transparent)` | Dots at grid intersections |
| `--dot-field-ambient` | `0.13` | Ambient dot opacity factor |
| `--dot-field-strength` | `1.05` | Dot-field strength |
| `--shadow-sm` | `0 1px 0 rgb(255 255 255 / 0.03) inset` | Inset highlight |
| `--shadow` | `0 1px 0 rgb(255 255 255 / 0.03) inset, 0 18px 40px -18px rgb(0 0 0 / 0.6)` | Raised cards |

---

## 2. Light theme tokens

Active via `data-theme='light'`.

### Base / background

| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | <span class="swatch" style="background:#f8f5f7"></span>`#f8f5f7` | App background (paper) |
| `--bg-sunken` | <span class="swatch" style="background:#f0eae0"></span>`#f0eae0` | Wells, inputs |
| `--surface` | <span class="swatch" style="background:#ffffff"></span>`#ffffff` | Cards, panels |
| `--surface-2` | <span class="swatch" style="background:#f7f3f5"></span>`#f7f3f5` | Hover surfaces |
| `--surface-3` | <span class="swatch" style="background:#efe8ec"></span>`#efe8ec` | Elevated/quiet badges |
| `--code-bg` | <span class="swatch" style="background:#fbf9fb"></span>`#fbf9fb` | Code blocks |
| `--overlay` | <span class="swatch" style="background:rgb(26 24 21 / 0.35)"></span>`rgb(26 24 21 / 0.35)` | Dialog backdrops |

### Border

| Token | Value | Usage |
| --- | --- | --- |
| `--border` | <span class="swatch" style="background:#e0d3dc"></span>`#e0d3dc` | Default borders |
| `--border-strong` | <span class="swatch" style="background:#c9b0c0"></span>`#c9b0c0` | Inputs, buttons, scrollbars |

### Text

| Token | Value | Usage |
| --- | --- | --- |
| `--text` | <span class="swatch" style="background:#1a161a"></span>`#1a161a` | Primary text |
| `--text-2` | <span class="swatch" style="background:#6d5f6a"></span>`#6d5f6a` | Secondary text |
| `--text-3` | <span class="swatch" style="background:#90818c"></span>`#90818c` | Tertiary text, placeholders |
| `--accent-ink` | <span class="swatch" style="background:#28121E"></span>`#28121E` | Text/icons on accent fills |
| `--selection` | `inherit`; text selection uses `--accent-soft` | Selection |

### Accent (pink)

| Token | Value | Usage |
| --- | --- | --- |
| `--accent` | <span class="swatch" style="background:#C96AA2"></span>`#C96AA2` | Primary accent on paper |
| `--accent-hover` | <span class="swatch" style="background:#F095C8"></span>`#F095C8` | Hover state on accent fills |
| `--accent-text` | <span class="swatch" style="background:#A8517E"></span>`#A8517E` | Accent-colored text/icons (AA contrast) |
| `--accent-soft` | <span class="swatch" style="background:rgb(201 106 162 / 0.14)"></span>`rgb(201 106 162 / 0.14)` | Soft accent fills |
| `--accent-line` | <span class="swatch" style="background:rgb(201 106 162 / 0.4)"></span>`rgb(201 106 162 / 0.4)` | Accent hairlines |

### Status

| Token | Value | Usage |
| --- | --- | --- |
| `--ok` | <span class="swatch" style="background:#17824f"></span>`#17824f` | Online / success |
| `--ok-soft` | <span class="swatch" style="background:rgb(23 130 79 / 0.1)"></span>`rgb(23 130 79 / 0.1)` | Soft success fills |
| `--danger` | <span class="swatch" style="background:#c2372d"></span>`#c2372d` | Errors |
| `--danger-soft` | <span class="swatch" style="background:rgb(194 55 45 / 0.08)"></span>`rgb(194 55 45 / 0.08)` | Soft danger fills |

### Icon and asset sources

The PNG icon set is the shipped source of truth; no SVG icon source is kept in
`ui/static/` (the former `pwa-icon.svg` and `pwa-maskable.svg` were removed with it).

| Asset | Size | Notes |
| --- | --- | --- |
| `ui/static/pwa-192.png`, `pwa-512.png` | 192, 512 | Manifest `any` icons |
| `ui/static/pwa-maskable-512.png` | 512 | Manifest `maskable` icon |
| `ui/static/favicon.png` | 192 | Browser tab icon |
| `ui/static/apple-touch-icon.png` | 360 | iOS home screen |
| `ui/static/icon-192.png`, `icon-512.png` | 192, 512 | Served at `/icon-192.png`, `/icon-512.png` and asserted by `server/src/assets.rs::pwa_assets_are_served_with_correct_types_and_revalidation`. Not orphans: do not delete without removing that route and its test. |

Every one of these carries an **opaque** `#1a1218` field. That is not cosmetic: the
rose is drawn largely in near-white strokes, so on a light or transparent field it
loses most of its detail, and iOS composites `apple-touch-icon` transparency on black.

**Do not rasterise the app icons from a vector source — there is no rose SVG.**
The shipped artwork is the **rose**, which comes from the raster lineage of
`ui/src/assets/gentle-logo.png`. The two SVGs under `ui/src/assets/morph/` are the
**π mark** (`logo.svg`, `logo-gentle.svg`), a different mark; regenerating the icons
from either silently replaces the rose with a π.

To re-issue the icons, flatten the existing PNGs onto the field:

```sh
# keeps the pixels, restores the opaque field, drops the alpha channel
convert old.png -background '#1a1218' -alpha remove -alpha off new.png
```

then assert `opaque=true` as described under "Verifying these assets".

### Verifying these assets

Two measurement traps, both hit in practice — read before trusting an icon or palette number:

1. **Sampling a composited canvas cannot measure contrast against a background that is also in the canvas.** If you flatten an icon onto a launcher background and then take the darkest sample as "ink", on a dark background that sample *is* the background, and the result is a meaningless ratio (~1.01:1). Separate the artwork's own pixels through the alpha channel first, or the measurement is not a measurement.
2. **An alarming number deserves the same suspicion as a comfortable one.** Two days of review produced several false negatives (a check that found nothing and reported success); this was a false positive that would have sent us chasing a contrast defect that did not exist. In both directions, the fix is the same: prove the metric can produce a *known* value before believing an extreme one.

Icon opacity is asserted as a **boolean**, never by eye:

```sh
identify -format '%[channels] opaque=%[opaque]\n' ui/static/pwa-512.png
# must read: srgb opaque=true
```

All five shipped icons must be opaque. A transparent one loses the rose's near-white line work on any light or black field.

> The light theme has no dedicated `--warning` / `--info`; it inherits the
> dark values if referenced. Dark-only tokens (`--deep-pink`, `--active-pink`,
> `--warning*`, `--info*`, `--border-soft`, `--tool-pending-bg`, `--glow`,
> `--selection`, `--dot-field-*`) are defined in the dark block and are not
> overridden per theme unless a component needs one.

### Diff

| Token | Value | Usage |
| --- | --- | --- |
| `--diff-add` | <span class="swatch" style="background:rgb(23 130 79 / 0.1)"></span>`rgb(23 130 79 / 0.1)` | Added lines |
| `--diff-del` | <span class="swatch" style="background:rgb(194 55 45 / 0.08)"></span>`rgb(194 55 45 / 0.08)` | Removed lines |

### Background field & decoration

| Token | Value | Usage |
| --- | --- | --- |
| `--dot-color` | <span class="swatch" style="background:#C96AA2"></span>`#C96AA2` | Dot-field base color (pink, was stale amber) |
| `--grid-line` | `color-mix(in srgb, var(--accent) 8%, transparent)` | 30px background grid |
| `--ambient-dot` | `color-mix(in srgb, var(--accent) 11%, transparent)` | Dots at grid intersections |
| `--dot-field-ambient` | `0.2` | Ambient dot opacity factor |
| `--dot-field-strength` | `1.12` | Dot-field strength |
| `--shadow-sm` | `0 1px 2px rgb(26 24 21 / 0.05)` | Soft drop shadow |
| `--shadow` | `0 1px 2px rgb(26 24 21 / 0.05), 0 14px 32px -16px rgb(26 24 21 / 0.18)` | Raised cards |

---

## 3. Typography

| Token | Stack |
| --- | --- |
| `--font` (sans) | `Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| `--mono` | `"IosevkaTerm NF", "Iosevka Term", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace` |

| Rule | Value |
| --- | --- |
| Root font size | `15px`, `line-height 1.5` |
| `h1` | `clamp(1.6rem, 2.4vw, 2rem)`, weight 700, `letter-spacing -0.025em` |
| `h2` | `1.05rem`, weight 650 |
| `h3` | `0.95rem`, weight 600 |
| `.mono` / `code` / `pre` | `var(--mono)`, `0.85em` |
| `.eyebrow` | `600 0.72rem/1 var(--mono)`, uppercase, `letter-spacing 0.12em`, color `--accent-text` |

System fonts only — nothing loads from the network.

---

## 4. Radii

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-sm` | `8px` (buttons render at `12px`) | Buttons, inputs |
| `--radius-md` / `--radius` | `12px` | Small cards, wells |
| `--radius-lg` | `16px` | Cards |
| `--radius-pill` | `999px` | Chips, badges, dots, grips |
| `--radius-bento` | `20px` | Bento tiles |
| `--clay-radius` | `22px` | Clay surfaces (cards, tiles, sheets use `24px` for sheet corners) |

---

## 5. Claymorphism (shadows)

Soft, solid "clay" surfaces: outer drop shadow + inset highlight + inset
shade. No blur or glass. Dark theme (light theme has warm-grey tints instead):

| Token | Value |
| --- | --- |
| `--clay-raised` | `0 12px 26px -12px rgb(0 0 0 / 0.65), inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 -4px 8px rgb(0 0 0 / 0.38)` |
| `--clay-soft` | `0 5px 12px -6px rgb(0 0 0 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 -2px 5px rgb(0 0 0 / 0.32)` |
| `--clay-pressed` | `inset 0 3px 8px rgb(0 0 0 / 0.5), inset 0 -1px 0 rgb(255 255 255 / 0.05)` |
| `--clay-accent` | `0 10px 20px -10px rgb(240 149 200 / 0.6), inset 0 2px 1px rgb(255 255 255 / 0.35), inset 0 -4px 7px rgb(95 35 65 / 0.4)` |

`--clay-surface` resolves to `var(--surface)`.

---

## 6. The ✿ petal glyph

Gentle Companion's brand glyph: a pink petal (✿) that accompanies the logo.

```css
.brand-mark {
  color: var(--accent);
  font-size: 1.1em;
  line-height: 1;
  margin-left: 6px;
  font-family: var(--font);
}
```

Usage rules:

- Always `aria-hidden="true"` — it is decorative; the brand text carries meaning.
- Wrap in `<span class="brand-mark">✿</span>` immediately after the logo `<img>`.
- Used in both brand marks: the sidebar brand (36px logo) and the topbar brand (30px logo).
- Color follows `--accent` in both themes — never hardcode a pink hex value.

---

## 7. Component rules

### Brand

- Structure: logo `<img>` → `span.brand-mark` (✿, `aria-hidden`) → name text.
- The wordmark is strong text; the sidebar additionally shows a connection
  status (`small`), the topbar just the name.
- Whole brand is an anchor to `/`.

### Buttons

- `.btn` — standard button: min-height 36px (44px on coarse pointers),
  `--radius` corners, `--border-strong` border, `--clay-soft` shadow,
  hover lifts background to `--surface-2`.
- `.btn-primary` — `--accent` fill, `--accent-ink` text, `--clay-accent` shadow,
  hover shifts to `--accent-hover`.
- `.btn-ghost` — transparent, muted text, no shadow.
- `.btn-danger` — `--danger` text/border, `--danger-soft` hover fill; `.solid`
  inverts to a `--danger` fill with white text.
- `.btn-bento` — large thumb-friendly tile button, `--radius-bento`, 52px tall.
- Active/press: `scale(0.97)` + `--clay-pressed` shadow.
- All states use token transitions with `--ease`; no hardcoded colors.

### Panels

- `.card` / `.tile` — `--clay-radius`, `--border` border, `--surface` fill,
  `--clay-raised` shadow.
- `.tile.sunken` — `--clay-pressed` shadow; depressed vessel.
- `.tile.accent` — `--accent-soft` fill with `--accent-line` border.
- `.sheet` (bottom sheet) — 24px top corners, `--overlay` backdrop, body
  scrolls, never crops; on wide screens it floats with all 24px corners.
- Chips/badges are pill-shaped (`--radius-pill`), `--surface-2` fill,
  `--clay-soft` shadow; selected state uses `--accent-soft` +
  `--clay-pressed`.
- `.clay-well` — 36px icon well, `--surface-2`, `--accent-text` icon.

### Status dots

- `.dot.ok` / `.active` — `--ok` with a `--ok-soft` halo.
- `.dot.idle` / `.connecting` — `--accent` with an `--accent-soft` halo.
- `.dot.offline` / `.revoked` / `.disconnected` — `--danger` with a
  `--danger-soft` halo.

### Focus & selection

- `:focus-visible` — 2px `--accent` outline, 2px offset.
- `::selection` — `--accent-soft`.
- Inputs focus into `--accent` border + 3px `--accent-soft` ring.

---

## 8. Layout constants

| Token | Value |
| --- | --- |
| `--sidebar` | `244px` |
| `--tabbar` | `64px` |
| `--ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` |

Layout rule: the window never scrolls. Each region owns its scrolling —
sidebar, page content, and feeds/lists/code blocks inside panels. Page width
caps at `1180px`.

---

## 9. PANTONE reference

Nearest Pantone® matches for the main brand colors (hex → Pantone conversion; verify against physical Pantone swatches before print):

| Color | Hex | Nearest Pantone® |
| --- | --- | --- |
| Rosa Gentleman — accent, dark | <span class="swatch" style="background:#F095C8"></span>`#F095C8` | 223 C |
| Rosa profundo — accent, light | <span class="swatch" style="background:#C96AA2"></span>`#C96AA2` | 7431 C |
| Rosa claro — hover | <span class="swatch" style="background:#FFB1DD"></span>`#FFB1DD` | Magenta 0521 C |

## 10. Brand marks

The brand has two marks and a wordmark. The **Gentle rose** is what ships as the app icon, the favicon and the PWA install icon, and it carries the Gentle identity; the **Gentle Companion π** is a line mark used inside the product; the **wordmark** is the name. Two marks, two jobs — do not swap them.

### Gentle rose

A neon rose — dark petals edged in glowing rose-pink, with a stem that dissolves into a circuit trace with node dots. It reads as "Gentle" plus the product's technological character.

- **File:** `ui/src/assets/gentle-logo.png` (1254×1254 PNG; no SVG source exists for the rose)
- **Use:** the app brand, in the sidebar (36px) and topbar (30px).
- **Field:** always on a dark surface — the neon glow needs dark to read.
- **Do:** keep the pink glow and the dark field; keep the circuit stem.
- **Don't:** recolor the rose, flatten or remove the glow, drop it on a light surface, or crop the stem.

### Gentle Companion π

A line-based **π (pi) with an orbit and a little companion moon** — the "Pi" the app steers and its companion.

- **Files:** `ui/src/assets/morph/logo.svg` and `ui/src/assets/morph/logo-gentle.svg` (both 320×320 line marks). These are the **only** π sources; the former `ui/static/pwa-icon.svg` and `pwa-maskable.svg` were deleted.
- **Use:** the companion line mark. **Not the app icon** — the shipped PWA/favicon set is the **rose** above, not the π.
- **Colors:** strokes `#F095C8` (mark) with `#FFB1DD` accents (orbit, moon).
- **Warning:** do not regenerate the app icons from either π SVG. It would replace the rose with a π in five shipped files without anyone noticing the swap.

### Wordmark

The name is set as **Gentle Companion** in the UI typeface (**Inter**, `--font`), preceded by the **✿ petal glyph** as the brand accent.

- **Sidebar:** logo → `✿` → **Gentle Companion** + a small status line (`local` / `paired`).
- **Topbar:** logo → `✿` → **Gentle Companion**.
- **Type:** Inter, weight 700, `letter-spacing -0.01em`. The name is never italicized or set in another face.

### Usage guidelines

- **Clear space:** keep clear space around a mark equal to the height of the π's moon (π mark) or the width of the bloom (rose mark).
- **Minimum size:** app icon ≥ 32px; π mark legible to ~24px; rose mark to ~28px.
- **Color:** marks use only the pink family (`#F095C8`, `#C96AA2`, `#FFB1DD`); the rose mark always needs a dark field.
- **Never:** gradients, 3D effects, drop shadows, recoloring outside the pink family, or adding text around the marks.

## 11. Provenance

The palette was aligned to **gentle-shell** (pink "Gentleman" palette):
warm rose on plum in dark mode (`#1a1218` plum background, `#F095C8` rose
accent) and warm rose on paper in light mode (`#C96AA2` accent). The image
marks (`ui/src/assets/morph/logo.svg`) and the raster PWA icons were regenerated to
match: icon background `#1a1218`, circle fill `#20161e`, moon/stroke accents in
`#F095C8` / `#FFB1DD` two-tone pink. See `design/system.md` in gentle-shell
for the source palette.