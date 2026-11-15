# bridge — experimental web client for the tailcat tunnel

This directory holds an experimental browser client for Companion's
[Tailcat tunnel](../README.md#tailcat-tunnel). It is a static page
(`index.html` plus plain JavaScript, no build step) that loads the
tailcat WASM build and reaches the Companion daemon through the tunnel:
it dials the daemon's `tc…` tunnel address and then serves HTTP
(`/api/context`) and WebSocket (`/ws/browser`, using the `token.<t>`
subprotocol) over the tunneled stream, the same routes the paired-device
surface uses.

> **Experimental.** This is a development tool for exercising the
> tunnel, not a finished product. Expect rough edges and changes.

## Prerequisites

- A running daemon with **Settings → Tunnel** enabled, so it prints a
  `tc…` tailcat address (shown in **Settings → Tunnel**, with a copy
  button and a QR code).
- The vendor WASM distribution (see below), because the tailcat browser
  client is not committed to this repository.

## Building the vendor distribution

The page needs the prebuilt tailcat WASM artifacts in `bridge/vendor/`:
`main.wasm`, `main.wasm.gz` and `wasm_exec.js` (~35 MB, gitignored).
They are built from the tailcat repository; see
[vendor/README.md](vendor/README.md) for the exact build commands.

## Hosting the page

The bridge is plain static files, so any static file server works:

    cd bridge
    python3 -m http.server 8080

Alternatively, copy the `bridge/` directory to the daemon's public URL
host and serve it from there. Hosting it from the daemon's own public
origin is the simplest option because that origin is already allowed by
the device surface (see the security note below).

## Using the bridge

1. Open the hosted page in a browser.
2. Paste the daemon's tunnel address (`tc…`) and the device port (the
   **Tunnel port** setting, or the daemon device port when it is `0`,
   by default `43722`).
3. Press **Dial**. The page dials the daemon through the tunnel and
   probes the API with a `GET /api/settings` request.
4. Press **Test WS** with a device token to open a tunneled WebSocket to
   `/ws/browser` (the token rides the `token.<t>` subprotocol, like the
   UI's live connection) and report the first frame received.

## Security note

- The tunnel address is sensitive: treat it like a pairing code. It
  grants access through the tunnel, so do not share it publicly or
  commit it to a repository.
- The daemon's device surface enforces an origin allow-list (the public
  URL origin, loopback device origins, plus
  `PI_COMPANION_ALLOWED_ORIGINS`). A bridge page hosted elsewhere must
  have its origin listed in the `PI_COMPANION_ALLOWED_ORIGINS`
  environment variable, or be served from the daemon's own public URL
  origin, for its WebSocket to connect.
