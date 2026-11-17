---
type: Subsystem
title: Tunnel shims
description: Hand-written HTTP/1.1 and RFC 6455 clients over the tunnel, and the three measured fixes that make them work.
tags: [subsystem, bridge, websocket, http, tunnel]
status: stable
generated: { by: agent:gentle-pi, at: 2026-09-27T00:00:00Z }
sources:
  - id: http-js
    resource: bridge/http.js
    title: HTTP/1.1 encoder and response parser
  - id: ws-js
    resource: bridge/ws.js
    title: RFC 6455 client
  - id: transport-ts
    resource: ui/src/lib/tailcat-transport.ts
    title: createTunnelTransport, DeferredTunnelSocket
---

# Tunnel shims

The tailcat runtime exposes a raw byte dialer, not `fetch` and not `WebSocket`. So the
client carries its own HTTP/1.1 encoder and its own RFC 6455 implementation — about 1700
lines of `bridge/`, and the most delicate code in the project.

The UI imports them directly (`ui/src/lib/bridge.ts` re-exports, no copies), pinned by a
test so a copy cannot drift.

## HTTP/1.1 — `bridge/http.js`

`encodeRequest` (`:36–59`) writes the request line, `Host: companion.device` as a
placeholder, `Connection: close`, title-cased extra headers, and a JSON body with
`Content-Length`.

`createResponseParser` (`:67–183`) is incremental: read until `\r\n\r\n`
(`findHeadEnd`, `:78`), then a body delimited **strictly by Content-Length** or by
read-to-EOF. Chunked encoding is deliberately unsupported (header comment `:9–11`) — the
daemon never emits it, and supporting it would be untested code on a critical path.

### Fix 1 — multi-chunk body accumulation

This was the big latent bug. `parseBody` (`:123–131`) now does
`body = concatBytes(body, buf)` **before** the length check.

Before the fix, the parser compared the length of the latest chunk against
Content-Length, so any response larger than one chunk failed with
"connection closed after 1050 of 22929 body bytes". It worked for small JSON and broke on
every real payload — the kind of bug that looks like a flaky network for weeks.

`finish()` (`:166–179`) throws on early EOF with exact byte counts, which is what made the
bug diagnosable at all.

### Fix 2 — no half-close after write

`bridgeFetch` (`:204–241`) does **not** call `closeWrite()` after sending. The comment
(`:215–220`) records the measurement: with a half-close, 2 of 10 GETs and 3 of 3 POSTs read
back as a 0-byte EOF through the DERP relay, because the FIN overtakes in-flight request
bytes on the WASM connection's independent goroutines. Without it, 10 of 10 succeed. The
daemon's `connection: close` delimits the response instead.

The same ordering appears at `:212–214` — await the write before doing anything else, for
the same goroutine reason.

### Fix 3 — per-request explicit dialer

`createTunnelTransport` (`ui/src/lib/tailcat-transport.ts:96–99`) passes the dialer
explicitly to every `bridgeFetch` call.

`setBridgeDialer` is a module-level global. Two concurrent `refresh()` requests would race:
the second cleared the dialer the first was about to use, producing "no bridge dialer
available". Passing it per request removes the shared state entirely. Regression-pinned in
`ui/tests/tailcat-tunnel.test.ts:437–456`.

## RFC 6455 — `bridge/ws.js`

A complete client: pure-JS SHA-1 (`:68–127`, because Web Crypto has no synchronous SHA-1),
`computeAccept` (`:128–130`), masked client frames (`:140–169`), an incremental frame parser
(`:180–233`), and `TunnelWebSocket` (`:235–500`).

| Concern | Where | Detail |
| --- | --- | --- |
| Handshake | `:297–327` | GET + Upgrade/Connection/Key/Version-13, subprotocols, Origin |
| Validation | `:355–389` | 101, `Upgrade: websocket`, accept digest, echoed subprotocol; 64 KB cap |
| Fragmentation | `:414–457` | CONT accumulation until FIN; control frames interleave; stray CONT ignored |
| Ping | `:445–451` | Automatic pong |
| Close | `:459–479` | Echo the server's close frame, then `closeWrite()` — after awaiting the write |

The strict handshake validation is not pedantry: a proxy that answered 200 with an HTML
page would otherwise be handed to the application as a WebSocket, and the failure would
surface as mysterious message corruption.

## DeferredTunnelSocket

`ui/src/lib/tailcat-transport.ts:163–252` gives the caller a **synchronous** socket while
the async dial resolves, and mirrors browser semantics faithfully:

- `send` before open throws (`:242–245`), like a real WebSocket.
- `close` while connecting delivers `onclose(1006)` and cancels the dial (`:227–240`).
- A dial failure delivers `onerror` then `onclose(1006)` (`:222–228`).
- Shim events are wrapped into real `MessageEvent`/`CloseEvent` shapes (`:150–160`).

Without this, `LiveConnection` — which expects a browser WebSocket — would need a second
code path for the tunnel.

## Retry on a truncated stream

`createTunnelTransport` retries **once** when the error reads
`connection closed before response headers` or `connection closed after …`
(`:100–110`). The DERP relay cuts roughly one in three fresh dials, per the measurement in
the comment (`:93–95`). A single retry converts that into an invisible delay.

## What does not work over the tunnel

| Capability | Status | Why |
| --- | --- | --- |
| JSON requests and responses | Works | The common case |
| File upload (`FormData`) | Refused (`:74–76`) | No streaming body in the shim |
| Blob download | Refused (`:71–73`) | Same |
| Page reload off-LAN | Impossible over plain HTTP | Needs HTTPS + a service worker |

These are documented limits, not silent failures — the transport throws rather than
producing a corrupt request.

## Verification

`ui/tests/tailcat-tunnel.test.ts` has 32 tests covering mode detection, transport mapping,
dialer and DERP selection, `DeferredTunnelSocket`, and the concurrent-dialer regression.
`bridge/http_test.mjs` has 42 checks; `bridge/ws_test.mjs` covers the frame codec and the
close ordering.

## Related

- [UI](../subsystems/ui.md) — the transport policy that selects this path
- [Tailcat](../subsystems/tailcat.md) — the tunnel these shims run over
- [Tunnel fallback](../flows/tunnel-fallback.md) — when it is used
