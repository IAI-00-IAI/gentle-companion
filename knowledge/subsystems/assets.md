---
type: Subsystem
title: Assets and CSP
description: The embedded SPA, the exact Content-Security-Policy, the cache policy, and why two directives matter.
tags: [subsystem, assets, csp, caching]
status: stable
generated: { by: agent:gentle-shell/4.8.0-main.95179bd6db8e, at: 2026-11-17T11:23:06Z }
sources:
  - id: assets-rs
    resource: server/src/assets.rs
    title: RustEmbed folders, CSP, caching
---

# Assets and CSP

The daemon serves the client from its own binary. No static file server, no CDN, no
separate deploy — the binary a user downloaded contains the UI.

## Embedding

```rust
#[derive(RustEmbed)]
#[folder = "web-dist/"]        // the built SPA
struct Assets;

#[derive(RustEmbed)]
#[folder = "../bridge/vendor/"] // main.wasm, wasm_exec.js
struct BridgeAssets;
```

`server/src/assets.rs:19–28`. Only those two files come from `bridge/vendor` — the tailcat
runtime the client needs to dial a tunnel.

## Serving

- Unknown paths fall back to `200.html` — the SPA shell, so client-side routes work on a
  cold load.
- `_app/**` and dot-paths are **404**, not the shell. A missing hashed asset must fail
  loudly; returning HTML for a `.js` request produces a confusing parse error instead.
- An unbuilt tree answers **503** (`:55`), which tells a developer what is actually wrong.

## The CSP

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' blob:;
connect-src 'self' https://tailcat.dev ws: wss:;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-src 'self' https:;
frame-ancestors 'none'
```

`server/src/assets.rs:39`. Two directives carry the weight:

- **`'wasm-unsafe-eval'`** — the tailcat runtime is WebAssembly. Without this, the browser
  refuses to compile the module and the tunnel cannot start. It is the narrowest
  permission that allows WASM; it does not enable `eval` for JavaScript.
- **`connect-src … https://tailcat.dev`** — the DERP map is fetched from there. Without it
  the tunnel cannot learn its relay.

`frame-src 'self' https:` is what lets the bridge proxy render a proxied dev server in an
iframe, and `frame-ancestors 'none'` stops anyone framing the Companion UI itself.

HTML responses also carry `permissions-policy: camera=(self)` and `X-Frame-Options: DENY`
(`:82`). The ETag carries a policy revision suffix (`-camera-v2-preview-v1`) so a changed
policy invalidates caches that would otherwise keep the old headers.

## Caching

| Path | Header | Why |
| --- | --- | --- |
| `_app/immutable/**` | `public, max-age=31536000, immutable` | Content-hashed names — a change means a new name |
| Everything else | `no-cache` + strong ETag | The shell and `version.json` must be revalidated |

The split is what makes an upgrade invisible: the shell is always revalidated, so a new
build is noticed on the next load, while the hashed assets are never re-fetched.

## The service worker

The service worker (`ui/static/service-worker.js`) decides what happens when the daemon is
unreachable, and it caches by *role*:

| What | Policy | Why |
| --- | --- | --- |
| Cache name | `pi-companion-shell-v7` (line 4) | Bumping the version is how a worker invalidates its own caches on activate |
| Navigations | Network-first, with a ≥500 answer or a `fetch` rejection falling back to the cached shell | A closed tunnel can answer with a gateway HTML page, not just a fetch error; the shell can explain that and offer retry |
| `/_app/immutable/*` | **Network-first**, cache only as the offline fallback (line 41) | Hashed names are unique per build, so a cached copy is either current or stale forever |
| The `SHELL` list (`/`, manifest, icons) | Cache-first (line 56) | Small, stable, needed offline |
| `/api/*`, `/ws/*` | Never cached | Data must be live |

The network-first rule for hashed assets exists because of a real bug: cache-first **pinned
the app to whatever build was cached first**, so the freshly revalidated shell loaded and
then every asset 404'd — the daemon no longer served those hashed names. Incognito worked
because it has no service worker, which is the signature of exactly this bug. Client-side
route changes alone never fix it; a worker version bump and network-first are what fix it.

## Verification

Three tests in `server/src/assets.rs` cover serving, the fallback, and the CSP header.

## Related

- [UI](../subsystems/ui.md) — what the shell does once loaded
- [Tunnel shims](../subsystems/tunnel-shims.md) — the WASM the CSP must allow
- [Deployment](../operations/deployment.md) — hosting the same build elsewhere
