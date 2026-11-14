# Tailcat web bridge — phone client over the tunnel

Browser (phone) client that reaches the Companion daemon through the Tailcat
tunnel using the existing WebAssembly tailcat client, with no native app.

## Specs

- S1: Bridge page (static, hostable without the tunnel) that loads the tailcat
  WASM client from `/home/ricardo/Trabajo/IAI/tailcat/web` (user-provided path)
  and lets the user enter (and later scan) the `tc…` tunnel address, persisting
  it in localStorage.
- S2: HTTP-over-stream shim: issue fetch-like requests to the daemon device API
  (`/api/*`, pairing included) through the `tailcatDial` TCP stream.
- S3: WebSocket-over-stream shim: implement the `/ws/browser` handshake and
  framing (subprotocol `pi-companion`, `token.<t>`) over the stream so
  `LiveConnection` works through the tunnel.
- S4: The full Companion UI loads through the bridge: UI transports are
  injectable so the tunnel path reuses the existing UI without duplication.

## Tasks

- T1 (S1): bridge/ static page + tailcat WASM dist (copy or build) + address
  entry; verify `tailcatDial` reaches a local vendored `tailcat serve`.
- T2 (S2): HTTP shim over the stream; verify with a real request to the daemon.
- T3 (S3): WebSocket shim; verify LiveConnection connects through the tunnel.
- T4 (S1-S3): end-to-end test with the vendored binary and the daemon.
- T5 (S1-S4): README/docs update + this log.

## Log

- L1 (user): «arranca ese plan» — approves the 5-task plan proposed for the
  web bridge (T1 bridge page, T2 HTTP shim, T3 WebSocket shim, T4 end-to-end,
  T5 docs), following «¿y lo que comentamos de webasembly o similar: ej
  /home/ricardo/Trabajo/IAI/tailcat/webdemo y /home/r…».
- L2: Context backstop fired (91%); T1+ delegated to a worker.
