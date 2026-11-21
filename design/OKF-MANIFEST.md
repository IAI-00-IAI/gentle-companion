---
type: Asset Manifest
title: "OKF manifest for this directory"
description: "Layer 2: index of the files in this directory with their hash and the carrier that holds their OKF header. Layer 1 is the header on the file itself."
status: verified
generated: 2026-11-21
source:
  - "gentle-companion-aesthetic/design/./OKF-MANIFEST.md (generated)"
verified: 2026-11-21
stale_after: 2027-06-30
---

# OKF manifest — `design/`

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
| `system.html` | HTML | 13024 | `5438c72c3fa00ef4` | HTML comment before doctype |
| `system.md` | MD | 7157 | `6e42e370e8dc22a2` | YAML frontmatter |
