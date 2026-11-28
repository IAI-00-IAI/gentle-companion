---
type: Asset Manifest
title: "OKF manifest for this directory"
description: "Layer 2: index of the files in this directory with their hash and the carrier that holds their OKF header. Layer 1 is the header on the file itself."
status: verified
generated: 2026-11-21
source:
  - "gentle-companion-aesthetic/design/aesthetic-choices/OKF-MANIFEST.md (generated)"
verified: 2026-11-21
stale_after: 2027-06-30
---

# OKF manifest — `design/aesthetic-choices/`

This directory's files only. Its **subdirectories have their own manifests**:
`assets/OKF-MANIFEST.md`, `assets/originals/OKF-MANIFEST.md` and
`.screenshots/OKF-MANIFEST.md`. A file living in a subdirectory is indexed there,
never here, so no row of this manifest claims coverage it does not have.

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
| `01-clay-tint.html` | HTML | 155836 | `d2cb12de3c46f059` | HTML comment before doctype |
| `02-icon-weight.html` | HTML | 22700 | `9f26d1279503ba56` | HTML comment before doctype |
| `comments.json` | JSON | 7734 | `00edb6b5c6f6ec0d` | not stamped: JSON carrier format undecided (human decision pending) |
| `design.json` | JSON | 1183 | `9455c72f17640e70` | not stamped: JSON carrier format undecided (human decision pending) |
