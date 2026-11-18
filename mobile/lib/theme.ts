/**
 * Gentle Movil design tokens — dark theme only for v1.
 *
 * Source of truth: `design/system.md` plus the artboards in
 * `design/mobile-app-onboarding/`. Values are transcribed 1:1; do not invent
 * new tokens here — extend `design/system.md` first.
 *
 * Typography note: the product identity is monospace, but no font is bundled in
 * this app (no asset under `mobile/assets/` and no dependency such as
 * `@expo-google-fonts/*`), so no `fontFamily` is set anywhere: the platform
 * default is used. Bundle a mono font (e.g. Iosevka Term) before setting one.
 */

/** Colour tokens (dark theme). */
export const colors = {
  bg: '#060407',
  bgSunken: '#0a060c',
  surface: '#100A0F',
  border: '#563040',
  borderStrong: '#7a4558',
  text: '#F6EFF3',
  accent: '#F095C8',
  accentHover: '#FFB1DD',
  accentInk: '#28121E',
  accentText: '#FFB1DD',
  deepPink: '#C96AA2',
  warning: '#F2B86D',
  ok: '#4fc58c',
  danger: '#FF718F',
  codeBg: '#0f0c12',
  muted: 'rgba(246,239,243,0.72)',
  faint: 'rgba(246,239,243,0.56)',
  overlay: 'rgba(0,0,0,0.55)',
  accentSoft: 'rgba(240,149,200,0.12)',
  warningSoft: 'rgba(242,184,109,0.14)',
  dangerSoft: 'rgba(255,113,143,0.12)',
  okSoft: 'rgba(79,197,140,0.12)',
  /** Base colour for the CTA glow (`--glow` in `design/system.md`). */
  glow: 'rgba(240,149,200,0.30)',
} as const;

export type ColorToken = keyof typeof colors;

/** Corner radii (`--radius-*`). */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  bento: 20,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;

/** Spacing scale in density-independent pixels. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export type SpacingToken = keyof typeof spacing;

/**
 * Type scale from `design/system.md` (`0.7 · 0.75 · 0.8 · 0.9 · 0.95 · 1.05rem`,
 * 1rem = 16px) with the line heights and tracking used by the artboards.
 */
export const typography = {
  /** Uppercase eyebrow above a screen title (0.7rem, 0.18em tracking). */
  eyebrow: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.9,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  /** Screen title (1.6rem, 1.2 line height, -0.025em tracking). */
  h1: {
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.65,
    fontWeight: '700',
  },
  /** Supporting paragraph under the title (0.9rem, 1.55 line height). */
  lede: {
    fontSize: 14,
    lineHeight: 22,
  },
  /** Uppercase group legend ("Tu computadora", "Autenticación"). */
  legend: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.8,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  /** Field label (0.75rem). */
  label: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  /** Inline label hint, e.g. "por defecto 22" (0.7rem). */
  hint: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
  },
  /** Text entered in a field (0.9rem). */
  input: {
    fontSize: 14,
    lineHeight: 20,
  },
  /** Per-field validation message (0.72rem). */
  error: {
    fontSize: 12,
    lineHeight: 18,
  },
  /** Primary button label (0.9rem). */
  cta: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  /** Top bar chip (0.7rem, 0.04em tracking). */
  chip: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  /** Product wordmark. */
  wordmark: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  /** Monospaced-looking hex fingerprint (0.85rem). */
  fingerprint: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  /** Fine print inside cards (0.7rem, 1.55 line height). */
  fine: {
    fontSize: 11,
    lineHeight: 17,
  },
  /** Inline notices and hints (0.72rem). */
  body: {
    fontSize: 12,
    lineHeight: 19,
  },
} as const;

/**
 * Elevation tokens. Classic `shadow*` + `elevation` props are used because they
 * are supported on both platforms across the current RN version.
 */
export const elevation = {
  /** CTA glow (`--glow`). */
  glow: {
    shadowColor: colors.accent,
    shadowOpacity: 0.34,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  /** Card drop shadow (`--shadow`). */
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 18 },
    elevation: 3,
  },
} as const;

/** Aggregate access for consumers that prefer one import. */
export const theme = {
  colors,
  radius,
  spacing,
  typography,
  elevation,
} as const;
