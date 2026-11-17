---
okf_version: "0.2"
title: gentle-companion knowledge bundle
description: Architecture, subsystems, flows and operations of gentle-companion — a Pi extension plus a Rust daemon that puts the real Companion UI on a phone.
generated: { by: agent:gentle-shell/4.8.0-main.95179bd6db8e, at: 2026-11-17T11:23:06Z }
---

# gentle-companion

A Pi extension and a Rust daemon that expose a running Pi session to a phone as a real
web app, reached over the LAN or through a tailcat tunnel.

## Start here

- [Architecture overview](architecture/overview.md) — the three processes and how they talk
- [Process model](architecture/process-model.md) — what the daemon starts, in what order
- [Wire protocol](subsystems/protocol.md) — every message in both directions
- [Pairing flow](flows/pairing.md) — QR to device token

## Architecture

| Concept | What it answers |
| --- | --- |
| [Overview](architecture/overview.md) | Which processes exist and what each owns |
| [Process model](architecture/process-model.md) | Startup order, tasks, shutdown |
| [HTTP surfaces](architecture/http-surfaces.md) | Admin vs device router, middleware, origin rules |
| [Auth](architecture/auth.md) | Pairing, token storage, WS upgrade, revocation |
| [State](architecture/state.md) | What is in memory, what is on disk |

## Subsystems

| Concept | What it answers |
| --- | --- |
| [Extension](subsystems/extension.md) | Tools, hooks, sharing toggle |
| [Daemon lifecycle](subsystems/daemon-lifecycle.md) | ensureDaemon, download, service registration |
| [Protocol](subsystems/protocol.md) | Bridge WS and browser WS message sets |
| [Bridge](subsystems/bridge.md) | File fetch and loopback endpoint proxy |
| [Automation](subsystems/automation.md) | Definitions, cron tick, run execution |
| [Tailcat](subsystems/tailcat.md) | Tunnel process and loopback mirror |
| [TLS](subsystems/tls.md) | Opt-in HTTPS on a dedicated port |
| [Assets](subsystems/assets.md) | Embedded SPA, CSP, caching |
| [UI](subsystems/ui.md) | Routes, connection state machine, direct-first |
| [Tunnel shims](subsystems/tunnel-shims.md) | HTTP/1.1 and RFC 6455 clients over the tunnel |

## Flows

| Concept | What it answers |
| --- | --- |
| [Pairing](flows/pairing.md) | Invite → QR → claim → token → socket |
| [Live session](flows/live-session.md) | Snapshot → activity → ask → steering |
| [Tunnel fallback](flows/tunnel-fallback.md) | LAN first, tunnel when the LAN is gone |

## Operations

| Concept | What it answers |
| --- | --- |
| [Daemon scripts](operations/daemon-scripts.md) | start, stop, service, logs |
| [Deployment](operations/deployment.md) | TLS, static hosting, allowed origins |

## Conventions

- Diagrams are Mermaid and render on GitHub.
- Every claim in these concepts is anchored to source as `path:line` or to a test.
- The Spanish counterpart of each concept is the same directory entry with `_es-ES`.
