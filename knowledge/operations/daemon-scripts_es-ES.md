---
type: Operations
title: Scripts del daemon
description: Arranque, parada, estado, instalación del servicio y logs por consola en Linux, macOS y Windows.
tags: [operations, daemon, scripts, service]
status: stable
generated: { by: agent:gentle-shell/4.8.0-main.95179bd6db8e, at: 2026-11-17T11:23:06Z }
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

# Scripts del daemon

La extensión arranca el daemon automáticamente. Estos scripts son para cuando querés
hacerlo vos — un servidor, un contenedor, una máquina donde Pi no corre, o una sesión de
debugging.

Viven en `tools/` y **no** se distribuyen en el paquete npm: el paquete lleva la extensión y
lo que ella necesita, no tooling de operación.

## Comandos

| Script npm | Hace |
| --- | --- |
| `npm run daemon:start` | Arranca detached, espera a `/api/context` |
| `npm run daemon:stop` | Apagado elegante con `/api/shutdown`, y luego verifica |
| `npm run daemon:status` | Reporta pid, puertos, versión, estado del túnel |
| `npm run daemon:restart` | Parar y arrancar |
| `npm run daemon:service:install` | Registra el servicio de plataforma |
| `npm run daemon:service:uninstall` | Lo elimina |
| `npm run daemon:service:status` | Si el servicio está registrado y corriendo |
| `npm run daemon:logs` | Sigue el log de la plataforma |

Cada script acepta `--json` para salida machine-readable.

## Start

`tools/daemon.mjs start` spawnnea el binario resuelto detached, escribe un pid file, y
espera a que `/api/context` responda. Falla ruidosamente si el puerto ya está ocupado — lo
cual es también cómo detecta un daemon ya corriendo, porque una segunda instancia sale
limpia por diseño (ver [Modelo de procesos](../architecture/process-model_es-ES.md)).

## Stop

`stop` hace POST a `/api/shutdown` y espera a que el proceso salga, escalando a `SIGTERM`
si no lo hace. Verifica el pid antes de señalizar: un pid no verificable significa que se
niega en lugar de arriesgarse a matar un proceso ajeno.

## Service

`tools/daemon-service.mjs` replica lo que hace la extensión en
`src/background-service.ts`, así que un servicio instalado a mano y uno instalado por la
extensión son lo mismo:

| Plataforma | Mecanismo | Nombre |
| --- | --- | --- |
| Linux | unidad systemd de usuario | `pi-companion.service` |
| macOS | agente launchd | `dev.pi-companion.daemon` |
| Windows | Scheduled Task | `Pi Companion` |

Instalar a mano sirve cuando Pi no va a correr en la máquina en absoluto.

## Logs

`tools/daemon-logs.mjs` elige la fuente correcta por plataforma: `journalctl --user -u
pi-companion` en Linux, `log show` en macOS, y el log de archivo del supervisor como
fallback cuando no hay servicio registrado.

## Verificación

Los scripts fueron ejercitados para `start`, `status` y `logs`. Los caminos destructivos —
`stop`, `restart`, `service:install`, `service:uninstall` — **no** están ejercitados de
punta a punta. Tratarlos como revisados-pero-no-probados hasta que lo estén.

## Relacionados

- [Ciclo de vida del daemon](../subsystems/daemon-lifecycle_es-ES.md) — el camino automático
- [Despliegue](../operations/deployment_es-ES.md) — entorno y orígenes
- [Modelo de procesos](../architecture/process-model_es-ES.md) — el guardia de instancia única del que estos dependen
