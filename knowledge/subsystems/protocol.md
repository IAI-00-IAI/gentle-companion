---
type: Subsystem
title: Wire protocol
description: The bridge socket between Pi and the daemon, the browser socket with its resync contract, and every close code.
tags: [subsystem, protocol, websocket]
status: stable
generated: { by: agent:gentle-shell/4.8.0-main.95179bd6db8e, at: 2026-11-17T11:23:06Z }
sources:
  - id: protocol-ts
    resource: src/protocol.ts
    title: BridgeMessage and ServerMessage
  - id: main-ws
    resource: server/src/main.rs
    title: WebSocket handlers and close codes
  - id: activity-rs
    resource: server/src/activity.rs
    title: Activity log and seq
---

# Wire protocol

Two WebSockets, deliberately asymmetric. The bridge socket is typed and request-shaped; the
browser socket is a broadcast stream with a resync contract.

## Bridge socket — extension to daemon

Path `/ws/bridge/{session_id}` (`src/bridge.ts:open`, route `server/src/main.rs:578`).

### Extension → daemon

| Message | Payload | When |
| --- | --- | --- |
| `register` | `{ session: SessionSnapshot }` | On open — this is what creates the session |
| `session.update` | `{ session: Partial<SessionSnapshot> }` | Any snapshot patch |
| `event` | `{ event, payload }` | Lifecycle: `session.start/shutdown`, `agent.start/end/settled`, `assistant.delta`, `tool.start/end`, `provider.error` |
| `git.diff` | `{ staged, requestId, …GitChanges }` | Answers a browser `git_diff` command |
| `file.delete` | `{ requestId, fileId }` | Answers a delete request |

### Daemon → extension

| Message | Meaning |
| --- | --- |
| `command` | A `BrowserCommand`: `prompt`, `steer`, `abort`, `plan`, `git_diff`, `popup_input`, `popup_close`, `ask_answer`, `ask_cancel` |
| `temp.files` | The current uploaded-file list, after an upload or delete |
| `file.delete.result` | `{ requestId, ok, error }` |
| `ping` | Protocol-level ping every 15 s (`server/src/main.rs`, heartbeat in `bridge_socket`) |

The extension terminates the socket after 45 s of silence (`src/bridge.ts:alive()`). Fifteen
seconds against forty-five tolerates two lost pings before declaring the daemon gone.

## Browser socket — daemon to browser

Path `/ws/browser`. The first frame is **always** `{"type":"resync"}` (`server/src/main.rs:1626`),
then the broadcast stream:

| Message | Meaning |
| --- | --- |
| `session.register` | A session appeared |
| `session.update` | `{ sessionId, patch }` |
| `bridge.event` | `{ sessionId, message, seq }` |
| `files.update` | Temp files changed |
| `devices.update` | Pairing or revocation changed |

### The resync contract

A tab that falls behind gets **another** `resync` frame (`:1650–1652`) instead of being
disconnected. On receiving it, the client discards its incremental state and refetches.

This is the cheapest correct answer to slow consumers: the alternative is an unbounded
queue per tab, and a phone on a bad network would grow it without limit.

### Sequence numbers

Every activity event carries a per-session `seq` stamped in `ActivityLog::record`
(`server/src/activity.rs:28`). The client uses it to deduplicate the overlap between a
fetch and the stream: events already covered by a snapshot are discarded by `seq`, so a
reconnect never double-renders a message.

## Session visibility

`remoteEnabled` is a field of `SessionSnapshot` (`src/protocol.ts`). The daemon gates
device-visible broadcasts on it (`require_remote_session`), so a session the user has not
shared is invisible to devices even with a valid token.

Browser commands are forwarded only when the session is shared, and a `readOnly` session
accepts only `ask_answer` and `ask_cancel` (`forward_browser_command`). That is what makes
"watch but do not steer" a real mode rather than a UI convention.

## Close codes

| Code | Name | Meaning | Client action |
| --- | --- | --- | --- |
| **4001** | `CLOSE_DISCONNECTED` | The Pi socket dropped | Reconnect |
| **4003** | `CLOSE_REVOKED` | Device revoked, or sharing turned off | Stop; the credential is dead |
| **1012** | — | Daemon restarting | Reconnect after a delay |

Defined at `server/src/main.rs:167–168`, delivered through the `kick_tx` broadcast
(`:1258`, `:1272`); 1012 on shutdown (`:1495`).

The distinction is the whole reason the codes exist. A client that treated 4003 like 1012
would retry forever with a revoked token; one that treated 1012 like 4003 would never come
back after a routine upgrade.

## Related

- [Auth](../architecture/auth.md) — how the socket authenticates
- [Live session flow](../flows/live-session.md) — the protocol in motion
- [UI](../subsystems/ui.md) — how the client consumes it
