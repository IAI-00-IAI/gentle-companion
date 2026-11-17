# Hosting the client on a public static site

The daemon serves the client over plain HTTP from its LAN address. That is fine at home
and it is what the tailcat tunnel carries, but it has two limits: a phone away from the
network cannot load the page at all, and browsers refuse to install a web app from an
insecure origin.

Publishing the built client to an HTTPS host removes both limits. The phone opens the
public URL, gets a secure context (service worker, installable app, offline shell), and
reaches the daemon only through the tailcat tunnel.

## What gets published

`tools/publish-client.mjs` assembles a directory from two sources:

| Source | Contents | Why |
| --- | --- | --- |
| `server/web-dist/` | The built SPA (`200.html`, `_app/`, manifest, service worker, icons) | Produced by `npm run ui:build` |
| `bridge/vendor/` | `wasm_exec.js`, `main.wasm` | The tailcat runtime the client fetches at `/bridge/vendor/*` |

It also writes `.nojekyll`, because GitHub Pages runs Jekyll by default and Jekyll drops
directories whose name starts with `_` — which would delete the entire `_app/` bundle.

    npm run ui:build
    npm run client:publish          # writes dist/client-pages
    npm run client:publish:check    # verifies every required file is present

The assembled tree is about 40 MB (the tailcat WASM dominates). Most static hosts accept
that; check your host's limits if you add more assets.

## GitHub Pages

The `pages.yml` workflow does the whole thing on demand:

1. Repository settings → Pages → **Source: GitHub Actions** (once).
2. Actions → *Publish client* → **Run workflow**.

### The base path

A GitHub Pages **project** site lives under `https://<user>.github.io/<repo>/`, while the
SPA references its assets from the root (`/_app/...`). Pick one:

- **Custom domain** (Settings → Pages → Custom domain): the site serves at the root, so
  leave the workflow's `base_path` input empty. Simplest and what most deployments want.
- **Default project path**: pass `base_path` = `/<repo>` when running the workflow. The
  build then emits asset URLs under that prefix (`BASE_PATH` is read by
  `ui/vite.config.ts`).

Without one of the two the page loads but every asset 404s.

## Pointing the phone at it

After the deploy, open the site with the tunnel coordinates in the fragment:

    https://<host>/#tunnel=tc…&port=43722

The fragment never reaches any server, so the tunnel address stays out of the host's
logs. The client stores it and dials the tunnel.

## The daemon must accept the origin

The device surface validates the `Origin` header. Add the published origin to the
daemon's allow-list, or the WebSocket and the API answer `403 Origin not allowed`:

    PI_COMPANION_ALLOWED_ORIGINS=https://<user>.github.io

Set it in the service environment (see the daemon scripts) and restart the daemon.

## Security notes

- **Published files are public.** Never place a token or a tunnel address in them; the
  address belongs only in the URL fragment.
- The tunnel address is a credential: anyone holding it can reach the device surface,
  subject to the pairing token.
- The published client is versioned separately from the daemon. Re-run the workflow when
  the UI changes, or the site keeps serving the older shell.
