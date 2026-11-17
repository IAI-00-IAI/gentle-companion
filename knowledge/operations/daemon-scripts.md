---
type: Operations
title: Daemon scripts
description: Manual start, stop, status, service installation and logs on Linux, macOS and Windows.
tags: [operations, daemon, scripts, service]
status: stable
generated: { by: agent:gentle-pi, at: 2026-09-27T00:00:00Z }
sources:
  - id: daemon-mjs
    resource: tools/daemon.mjs
    title: start, stop, status, restart
  - id: service-mjs
    resource: tools/daemon-service.mjs
    title: install, uninstall, status
  - id: logs-mjs
    resource: tools/daemon-logs.mjs
    title: journalctl, log show, file fallback
---

# Daemon scripts

The extension starts the daemon automatically. These scripts are for when you want to do it
yourself — a server, a container, a machine where Pi is not running, or a debugging session.

They live in `tools/` and are **not** shipped in the npm package: the package ships the
extension and what it needs, not operator tooling.

## Commands

| npm script | Does |
| --- | --- |
| `npm run daemon:start` | Start detached, wait for `/api/context` |
| `npm run daemon:stop` | Graceful `/api/shutdown`, then verify |
| `npm run daemon:status` | Report pid, ports, version, tunnel state |
| `npm run daemon:restart` | Stop then start |
| `npm run daemon:service:install` | Register the platform service |
| `npm run daemon:service:uninstall` | Remove it |
| `npm run daemon:service:status` | Is the service registered and running |
| `npm run daemon:logs` | Tail the platform log |

Every script accepts `--json` for machine-readable output.

## Start

`tools/daemon.mjs start` spawns the resolved binary detached, writes a pid file, and waits
for `/api/context` to answer. It fails loudly if the port is already taken — which is also
how it detects an already-running daemon, since a second instance exits cleanly by design
(see [Process model](../architecture/process-model.md)).

## Stop

`stop` posts `/api/shutdown` and waits for the process to exit, escalating to `SIGTERM` if
it does not. It verifies the pid before signalling: an unverifiable pid means it refuses
rather than risk killing an unrelated process.

## Service

`tools/daemon-service.mjs` mirrors what the extension does in
`src/background-service.ts`, so a service installed by hand and one installed by the
extension are the same thing:

| Platform | Mechanism | Name |
| --- | --- | --- |
| Linux | systemd user unit | `pi-companion.service` |
| macOS | launchd agent | `dev.pi-companion.daemon` |
| Windows | Scheduled Task | `Pi Companion` |

Installing by hand is useful when Pi will not run on the machine at all.

## Logs

`tools/daemon-logs.mjs` picks the right source per platform: `journalctl --user -u
pi-companion` on Linux, `log show` on macOS, and the supervisor's log file as a fallback
when no service is registered.

## Verification

The scripts were exercised for `start`, `status` and `logs`. The destructive paths —
`stop`, `restart`, `service:install`, `service:uninstall` — are **not** yet exercised
end-to-end. Treat them as reviewed-but-unproven until they are.

## Related

- [Daemon lifecycle](../subsystems/daemon-lifecycle.md) — the automatic path
- [Deployment](../operations/deployment.md) — environment and origins
- [Process model](../architecture/process-model.md) — the single-instance guard these rely on
