# Tailcat client UI — worker A (T1+T2) report

Branch: `feat/tailcat-client-ui` (from main 8820073). No commits made; all changes
unstaged in the worktree as instructed. A parallel worker's commit 5f9cf7f (server/
vendored runtime serving) was already on the branch when I started; the parent added
the CSP `connect-src https://tailcat.dev` change (server/src/assets.rs) after
approving option 1 — that file is the parent's, not mine.

## S# coverage (final)
- **T1 → S2** (UI consumes bridge shims without duplication): **done**.
- **T2 → S1** (tunnel mode alongside local/remote, injectable transport, authenticated
  HTTP included): **done**.
- S3 (QR/token pairing) and S4 (daemon serving) belong to other tasks; S4's server
  piece (5f9cf7f) plus the parent's CSP change unblock the daemon-served UI.

## T1 — shim consumption (S2)
- `bridge/http.d.ts`, `bridge/ws.d.ts` (new): strict ambient declarations for the
  plain-JS shims. Established convention: `.d.ts` beside the `.js` it declares.
  Verified TS 6.0.3 bundler resolution maps the `'…/bridge/http.js'` specifier to the
  sibling `http.d.ts`, Vite bundles the real JS, Node tests load the real JS.
- `ui/src/lib/bridge.ts` (new): typed re-export wrapper (`bridgeFetch`,
  `setBridgeDialer`, `TunnelWebSocket`, …). Zero copies of shim code; the ui:build
  bundle contains the shim code inlined from the single source (`bridge/http.js` +
  `bridge/ws.js` — verified in `server/web-dist` chunks).

## T2 — tunnel mode (S1)
- `ui/src/lib/tailcat-tunnel.ts` (new): pure mode detection. **Decision (documented
  per task):** reuse the bridge precedent localStorage keys
  `companion-bridge.tunnel-addr` / `companion-bridge.device-port` (bridge/app.js:8-9)
  so the bridge page, the future QR flow (T3) and the UI share one source of truth.
  Port fallback: 43722 (the daemon's `device_port()` default; tunnel port 0 means
  device port). Address blank/absent → tunnel mode off; local/remote untouched.
- `ui/src/lib/tailcat-runtime.ts` (new): loads the vendored WASM runtime the daemon
  serves at `/bridge/vendor/*` (wasm_exec.js script tag → Go → instantiateStreaming
  main.wasm → onTailcatReady), same pattern as bridge/app.js. `pickDerpMapURL` reuses
  the same policy as app.js (`?derpmap=` param → same-origin map → canonical
  tailcat.dev map); app.js's function is not exported and app.js is DOM-coupled
  (unimportable), so the policy is re-expressed in TS (~15 lines) — the one
  near-duplication, flagged for the parent. It probes `/bridge/derpmap.json` (the
  serving contract path) first, then page-relative `derpmap.json`.
- `ui/src/lib/tailcat-transport.ts` (new):
  - `createTunnelDialer`: runtime + DERP map, then `tailcatDial({addr, derpMapURL,
    port, verbose})` — same capability as `window.bridge.dial` (app.js is not
    importable; tailcatDial is the same underlying global).
  - `createTunnelTransport`: the `RequestTransport` for HTTP — one bridgeFetch
    exchange per request mapped onto a real `Response`, so **workspaceRequest's
    existing error classification applies unchanged** (no duplication of ApiError/
    WorkspaceConnectionError logic). Deadline race → same timeout message; caller
    abort rethrown as-is. All caller headers (including the device token's
    `Authorization: Bearer`) are forwarded to bridgeFetch. Refuses blob downloads
    and FormData uploads with clear errors (shim limitations).
  - `DeferredTunnelSocket`: LiveConnection's `create` hook is sync but tailcatDial is
    async, so the socket defers: WebSocket semantics (readyState, send-throw-when-
    not-open, close-while-connecting → 1006, dial/handshake failure → onerror +
    onclose(1006) so LiveConnection retries). Browser Event/MessageEvent/CloseEvent
    shapes forwarded.
- `bridge/http.js` (parent-approved surface expansion): optional `headers` parameter
  on `encodeRequest(method, path, body, headers?)` (extra `Name: value` lines) and
  `bridgeFetch(addr, port, method, path, body, headers?)` (passed through).
  Backward compatible — all pre-existing checks green, no behavior change when the
  parameter is omitted. Fixed a shadowing bug the change exposed (`headers` request
  param vs. destructured response headers in bridgeFetch).
- `bridge/http.d.ts`: declarations updated for the new optional parameter.
- `ui/src/lib/workspace-connection.ts`: optional `transport` parameter on
  workspaceRequest; **default path byte-identical** (plain fetch, same options).
- `ui/src/lib/connection.ts`: `create` hook type widened from `WebSocket` to a
  structural `LiveSocket` interface (types only; state machine untouched).
- `ui/src/lib/companion.svelte.ts`: tunnel wiring — `create` returns a
  DeferredTunnelSocket in tunnel mode; `request()` and `boot()`'s /api/context pass
  the tunnel transport. Local/remote paths untouched.

## Remaining risks / notes
- File uploads (FormData) and binary downloads (blob) over the tunnel: clear errors,
  not supported by the shim yet (T3/T5 scope).
- Tunnel mode activates only when the localStorage keys are set on the UI's origin
  (bridge page on the same origin, or the future T3 QR flow).
- Scratch left in /tmp (safe to delete): /tmp/tsprobe, /tmp/repro*.mjs, /tmp/repro5.ts,
  /tmp/livecheck.ts, /tmp/debug-test.ts, /tmp/tailcat-test-debug.ts,
  /tmp/transport-debug.ts, /tmp/ui-debug-test.ts.
- `ui/tests/tailcat-tunnel.test.ts` is not wired into `npm run test:extension`
  (root package.json lists `ui/automation.test.ts` explicitly; it is out of my
  surface). Run it with the command below or add it to the script.

## Test evidence (TDD, final)
- RED (headers): 4 checks in `bridge/http_test.mjs` failed before implementing the
  headers parameter (observed: "encode headers: authorization line",
  "encode headers: multiple extra headers", "fetch headers: authorization reached the
  server", "fetch headers: omitted param unchanged").
- GREEN (headers): `node bridge/http_test.mjs` → **all tests passed (38 ok checks**,
  up from 26; 12 new/updated, including the Authorization-on-the-wire assertion via a
  server that echoes the header back).
- `node --test --experimental-strip-types --no-warnings ui/tests/tailcat-tunnel.test.ts`
  → **31 pass / 0 fail** (mode detection 7, shim re-export 1, transport + error
  mapping 14 — including "Authorization header reaches the tunnel request" and
  "all caller headers forwarded" — dialer+DERP 3, deferred socket 6).
- PRESERVE: `npm run test:extension` → **359 pass / 0 fail**; `node bridge/ws_test.mjs`
  → all tests passed; `npm run ui:check` → 0 errors, 0 warnings; `npm run ui:build` →
  ok (bundle contains the tunnel modules and the inlined shim code from the single
  bridge source).
