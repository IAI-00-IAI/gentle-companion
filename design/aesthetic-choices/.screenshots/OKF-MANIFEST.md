---
type: Asset Manifest
title: "OKF manifest for this directory"
description: "Layer 2: index of the files in this directory with their hash and the carrier that holds their OKF header. Layer 1 is the header on the file itself."
status: verified
generated: 2026-11-21
source:
  - "gentle-companion-aesthetic/design/aesthetic-choices/.screenshots/OKF-MANIFEST.md (generated)"
verified: 2026-11-21
stale_after: 2027-06-30
---

# OKF manifest — `design/aesthetic-choices/.screenshots/`

Screenshots attached by Ricardo to canvas comments. They are **source artwork**, not
captures of the rendered boards: each carries a solid black field where the boards have
plum `#1a1218`.

- **`.webp` / `.jpg`** — the embedded payload cannot be read back through the standard
  API, so the header lives in the sibling `X.meta.json`.

Rule: if a file changes, its hash changes here in the same commit. Regenerate once,
after every file in the directory is stamped, so no row records a stale hash.

| File | Kind | Bytes | SHA-256 (16) | OKF carrier |
|---|---|---|---|---|
| `7xxd62vb.jpg` | JPEG | 2886 | `4b70b54df06f39ff` | sibling .meta.json |
| `7xxd62vb.meta.json` | JSON | 480 | `342b9a651d8083b8` | sibling sidecar carrying the sibling image's OKF |
| `8yyi8ghh.meta.json` | JSON | 450 | `9e12686a9616784d` | sibling sidecar carrying the sibling image's OKF |
| `8yyi8ghh.webp` | WEBP | 1180 | `1ba3efe62a2bb0b3` | sibling .meta.json |
| `gw7pt3cc.jpg` | JPEG | 8401 | `6d083f3eb72e47fa` | sibling .meta.json |
| `gw7pt3cc.meta.json` | JSON | 485 | `0e5ac83d1e39cd0e` | sibling sidecar carrying the sibling image's OKF |
