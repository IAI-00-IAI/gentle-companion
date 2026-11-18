---
type: Operations
title: Deployment
description: The environment variables that matter, the three ways to get a secure client origin, and the origin allow-list that trips everyone up.
tags: [operations, deployment, tls, pages, origins]
status: stable
generated: { by: agent:gentle-shell/4.8.0-main.95179bd6db8e, at: 2026-11-17T11:23:06Z }
sources:
  - id: main-env
    resource: server/src/main.rs
    title: Environment variables and origin handling
  - id: tls-doc
    resource: docs/daemon-tls.md
    title: TLS guide
  - id: pages-doc
    resource: docs/static-client-host.md
    title: Static hosting guide
---

# Deployment

Three deployment shapes, from simplest to most capable.

## Shape 1 — LAN only

Nothing to configure. The daemon binds `127.0.0.1:43722` by default; set
`PI_COMPANION_DEVICE_ADDR=0.0.0.0:43722` (or `settings.deviceBind`) to expose it to the
network, and add the phone's origin to the allow-list.

Plain HTTP, so no service worker, no installable app, no clipboard. Fine for a quick look.

## Shape 2 — LAN plus tunnel

Adds reachability from anywhere. Enable the tunnel in settings; the daemon spawns
`tailcat serve` and the client dials it when the LAN fails.

Still plain HTTP, so the same browser limits apply. See
[Tunnel fallback](../flows/tunnel-fallback.md).

## Shape 3 — a secure origin

Two ways, and they solve different problems:

| Route | Gives | Costs |
| --- | --- | --- |
| **TLS on the daemon** (the persisted `tlsSelfSigned` switch, or `PI_COMPANION_TLS_SELF_SIGNED=1`) | Secure context on the LAN; installable app; clipboard | A certificate warning unless you supply a real cert |
| **Static host** (`npm run client:publish`) | Secure origin that works from anywhere; the daemon is only reached through the tunnel | A public deploy step; the origin must be allowed |

Both are documented in full in `docs/daemon-tls.md` and `docs/static-client-host.md`.

## Publishing the client to a static host

The same client build can be published to any static host (GitHub Pages, Netlify, …) with
`npm run client:publish` (`tools/publish-client.mjs`); `--check` only verifies the build.
The workflow is `.github/workflows/pages.yml`.

**`.nojekyll` is required** (`tools/publish-client.mjs:101`): GitHub Pages runs Jekyll by
default, and Jekyll drops directories starting with `_` — which is exactly where the
built client lives (`_app/`). Without the file the page loads and every asset 404s.

**Base path.** Pages serves a project site under `/<repo>/`, while the built SPA references
its assets from the root (`/ _app/...`). Two supported setups — without one of the two, the
page loads but its assets 404:

- A custom domain (Settings → Pages → Custom domain) serves at the root: nothing else to do.
- The default `github.io/<repo>/` path needs the client rebuilt with that base: set the
  `BASE_PATH` variable (workflow input, or `ui/vite.config.ts:25`,
  `paths.base = process.env.BASE_PATH || ''`) to `/<repo>` and the build picks it up.

**Allowed origins.** A phone served from the static host reaches the daemon only through the
tailcat tunnel, and the daemon validates `Origin`. Add the static origin to
`PI_COMPANION_ALLOWED_ORIGINS` (comma-separated), or the WebSocket answers
**403 Origin not allowed** after a successful claim — the failure that looks like a broken
pairing and is not.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `PI_COMPANION_ADMIN_ADDR` | `127.0.0.1:43721` | Console bind |
| `PI_COMPANION_DEVICE_ADDR` | settings, else `127.0.0.1:43722` | Device surface bind |
| `PI_COMPANION_PUBLIC_URL` | — | The URL phones use; contributes an allowed origin |
| `PI_COMPANION_ALLOWED_ORIGINS` | — | Comma-separated extra origins |
| `PI_COMPANION_TLS_CERT` / `_KEY` | — | Both or neither |
| `PI_COMPANION_TLS_SELF_SIGNED` | — | `1`, `true`, `yes`, `on` |
| `PI_COMPANION_TLS_PORT` | device port + 1 | The HTTPS listener |
| `PI_COMPANION_HOME` | `~/.pi/agent/pi-companion` | Data directory |

## The origin allow-list

This is the failure that looks like a broken pairing and is not. The device surface
validates `Origin`; a browser sends the page's origin, which must be in the union of:

- the loopback origins of the actual device bind (`http://127.0.0.1:<port>`, `localhost`,
  `[::1]`);
- the origin of `PI_COMPANION_PUBLIC_URL`;
- every entry in `PI_COMPANION_ALLOWED_ORIGINS`.

Symptom: the claim succeeds, then the WebSocket answers **403 Origin not allowed**.

Fix: add the exact origin — scheme, host, port, no trailing slash:

```
PI_COMPANION_ALLOWED_ORIGINS=http://192.168.2.20:43722,https://user.github.io
```

Note that `http://host:80` and `http://host` are the same origin (`origin_of` strips
default ports), but `http://host:43722` and `https://host:43723` are **not** — the TLS
surface is a different origin and needs its own entry.

## Where to put the configuration

In `state.json` for anything durable (`settings.deviceBind`), because the supervisor
rewrites the service environment on every upgrade. In the service environment for
per-machine overrides you are willing to re-apply.

## Verification checklist

| Check | Command |
| --- | --- |
| Daemon up | `curl -s 127.0.0.1:43721/api/context` |
| Device surface reachable | `curl -s http://<lan-ip>:43722/api/context` |
| TLS surface | `curl -sk https://<lan-ip>:43723/api/context` |
| Tunnel running | `npm run daemon:status` |
| Origin accepted | Open the client and watch for 403 on the WS |

## Related

- [TLS](../subsystems/tls.md) — the dedicated-port constraint
- [HTTP surfaces](../architecture/http-surfaces.md) — the origin logic in code
- [Daemon scripts](../operations/daemon-scripts.md) — running it
