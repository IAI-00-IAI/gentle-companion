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
- L3: README tailcat sections were stale (EN claimed binaries "not included yet"); refreshed both languages, commits e35fd5b / eb5829b. Slice boundary: ~400 lines reached (6 commits).
- L4: E2E found a real defect: `tailcat serve` always forwards to loopback, but the daemon bound the device surface only on the LAN IP (public_url is an IP). Fixed with a loopback mirror listener (same router, same origin middleware) enabled only while the tunnel is on; 141 cargo tests pass; commit d8a7136. Second slice boundary: ~2176 lines / 10 commits since origin/main.
- L5: T5 docs delegated and done: bridge/README.md (new) + README.md / README.es.md tailcat client paragraphs updated to point at the experimental bridge.
- L6: E2E probe over the tunnel: GET /api/context returned 200 (HTML from the SPA fallback — /api/settings does not exist on the device surface; /api/context is the auth-free JSON probe).
- L7: T4 GREEN. Root cause of the 401: `bridge/e2e_probe.mjs` destructured `[addr, port]` from argv and then read `process.argv[3]` as the token — that index is the port, so the page sent `token.43722`. Fixed to `[addr, port, token]`. Evidence: the 401 body was "Invalid device token." and the page-side diagnostic printed TOKLEN=5 TOKHEAD=43722. Final probe: `HTTP 200 remote=true version=0.4.3 || WS-OK first frame: {"type":"resync"}`, stable over 3 runs. Commit 9b8d986.
- L8: Intermittent failure (~25%) root-caused: `bridge/http.js` called `conn.write()` then `conn.closeWrite()` without awaiting; tailcat's WASM conn runs both on independent goroutines, so the FIN overtook the 85-byte request and the daemon saw an empty stream. Fixed by awaiting both (commit afe2e11); the same ordering race was fixed in ws.js close()/#handleClose, pinned by a RED test. Acceptance: 8/8 consecutive green E2E runs. Probe hardening (readiness poll, EOF retry, tracing) in 4de855a.
- L9: T4 closed. E2E verdict: `HTTP 200 remote=true version=0.4.3 || WS-OK first frame: {"type":"resync"}` through the tailcat tunnel, with the daemon's loopback mirror serving the forwarded stream. Suites: ws_test 59 ok, http_test 30 ok, cargo 141 ok.
