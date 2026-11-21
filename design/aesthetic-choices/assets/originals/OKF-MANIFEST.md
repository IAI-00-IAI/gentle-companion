---
type: Asset Manifest
title: "OKF manifest for this directory"
description: "Layer 2: index of the files in this directory with their hash and the carrier that holds their OKF header. Layer 1 is the header on the file itself."
status: verified
generated: 2026-11-21
source:
  - "gentle-companion-aesthetic/design/aesthetic-choices/assets/originals/OKF-MANIFEST.md (generated)"
verified: 2026-11-21
stale_after: 2027-06-30
---

# OKF manifest — `design/aesthetic-choices/assets/originals/`

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
| `mascot-full-300.jpg` | JPG | 8401 | `6d083f3eb72e47fa` | sibling .meta.json |
| `mascot-full-300.meta.json` | JSON | 438 | `5a25bad2d6f2c5f4` | sibling sidecar carrying the sibling binary's OKF |
| `mascot-glyph-31x40.meta.json` | JSON | 452 | `f1755d012ff58f5a` | sibling sidecar carrying the sibling binary's OKF |
| `mascot-glyph-31x40.webp` | WEBP | 1180 | `1ba3efe62a2bb0b3` | sibling .meta.json |
| `moustache-200.jpg` | JPG | 2886 | `4b70b54df06f39ff` | sibling .meta.json |
| `moustache-200.meta.json` | JSON | 442 | `606094b3b4e7817e` | sibling sidecar carrying the sibling binary's OKF |
