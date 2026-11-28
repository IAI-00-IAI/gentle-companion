---
type: Asset Manifest
title: "OKF manifest for this directory"
description: "Layer 2: index of the files in this directory with their hash and the carrier that holds their OKF header. Layer 1 is the header on the file itself."
status: verified
generated: 2026-11-21
source:
  - "gentle-companion-aesthetic/design/aesthetic-choices/assets/OKF-MANIFEST.md (generated)"
verified: 2026-11-21
stale_after: 2027-06-30
---

# OKF manifest — `design/aesthetic-choices/assets/`

Not every format can carry its header in the same place, so each file declares
where its OKF lives:

- **`.html`** — `<!-- OKF-METADATA -->` comment above `<!doctype`; the body from
  `<!doctype` onwards is untouched by the stamp.
- **`.md`** — YAML frontmatter between `---`.
- **`.png`** — `iTXt` chunk, readable back with
  `Image.open(p).info["OKF-METADATA"]`.
- **`.webp` / `.jpg`** — the embedded payload cannot be read back through the
  standard API, so the header lives in the sibling `X.meta.json`.

Rule: if a file changes, its hash changes here in the same commit. Regenerate once,
after every file in the directory is stamped, so no row records a stale hash.

| File | Kind | Bytes | SHA-256 (16) | OKF carrier |
|---|---|---|---|---|
| `mascot-glyph-248x320.png` | PNG | 86104 | `e29fe5c4ad27494b` | embedded (PNG iTXt) |
| `mascot-glyph.meta.json` | JSON | 356 | `127a44a68fc2cabc` | sibling sidecar carrying the sibling binary's OKF |
| `mascot-glyph.webp` | WEBP | 22046 | `926fda4c7cc06aa7` | sibling .meta.json |
| `mascot-transparent.png` | PNG | 54793 | `3dae69f07779bfb6` | embedded (PNG iTXt) |
| `mascot.meta.json` | JSON | 337 | `3f52a5de5781d31a` | sibling sidecar carrying the sibling binary's OKF |
| `mascot.webp` | WEBP | 11100 | `c82ba18d1ddc064f` | sibling .meta.json |
| `moustache-transparent.png` | PNG | 14059 | `70122843208bb223` | embedded (PNG iTXt) |
| `moustache.meta.json` | JSON | 343 | `d07ac17c66e62a3e` | sibling sidecar carrying the sibling binary's OKF |
| `moustache.webp` | WEBP | 2838 | `30ad4c60159b3f40` | sibling .meta.json |
