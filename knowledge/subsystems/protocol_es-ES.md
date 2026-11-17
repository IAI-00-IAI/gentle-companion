---
type: Subsystem
title: Protocolo de red
description: El socket de bridge entre Pi y el daemon, el socket de navegador con su contrato de resync, y todos los códigos de cierre.
tags: [subsystem, protocol, websocket]
status: stable
generated: { by: agent:gentle-pi, at: 2026-09-27T00:00:00Z }
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

# Protocolo de red

Dos WebSockets, deliberadamente asimétricos. El socket de bridge está tipado y tiene forma
de petición; el socket de navegador es un stream de broadcast con un contrato de resync.

## Socket de bridge — extensión al daemon

Ruta `/ws/bridge/{session_id}` (`src/bridge.ts:open`, ruta `server/src/main.rs:578`).

### Extensión → daemon

| Mensaje | Payload | Cuándo |
| --- | --- | --- |
| `register` | `{ session: SessionSnapshot }` | Al abrir — esto es lo que crea la sesión |
| `session.update` | `{ session: Partial<SessionSnapshot> }` | Cualquier parche del snapshot |
| `event` | `{ event, payload }` | Ciclo de vida: `session.start/shutdown`, `agent.start/end/settled`, `assistant.delta`, `tool.start/end`, `provider.error` |
| `git.diff` | `{ staged, requestId, …GitChanges }` | Responde un comando `git_diff` del navegador |
| `file.delete` | `{ requestId, fileId }` | Responde una petición de borrado |

### Daemon → extensión

| Mensaje | Significado |
| --- | --- |
| `command` | Un `BrowserCommand`: `prompt`, `steer`, `abort`, `plan`, `git_diff`, `popup_input`, `popup_close`, `ask_answer`, `ask_cancel` |
| `temp.files` | La lista actual de archivos subidos, tras una subida o un borrado |
| `file.delete.result` | `{ requestId, ok, error }` |
| `ping` | Ping a nivel de protocolo cada 15 s (`server/src/main.rs`, heartbeat en `bridge_socket`) |

La extensión cierra el socket tras 45 s de silencio (`src/bridge.ts:alive()`). Quince
segundos contra cuarenta y cinco toleran dos pings perdidos antes de dar el daemon por
muerto.

## Socket de navegador — daemon al navegador

Ruta `/ws/browser`. El primer frame es **siempre** `{"type":"resync"}`
(`server/src/main.rs:1626`), y después el stream de broadcast:

| Mensaje | Significado |
| --- | --- |
| `session.register` | Apareció una sesión |
| `session.update` | `{ sessionId, patch }` |
| `bridge.event` | `{ sessionId, message, seq }` |
| `files.update` | Los archivos temporales cambiaron |
| `devices.update` | El emparejamiento o la revocación cambiaron |

### El contrato de resync

Una pestaña que quedó atrás recibe **otro** frame `resync` (`:1650–1652`) en lugar de ser
desconectada. Al recibirlo, el cliente descarta su estado incremental y vuelve a traer
todo.

Es la respuesta correcta más barata ante consumidores lentos: la alternativa es una cola
sin límite por pestaña, y en un teléfono con mala red crecería sin cota.

### Números de secuencia

Cada evento de actividad lleva un `seq` por sesión estampado en `ActivityLog::record`
(`server/src/activity.rs:28`). El cliente lo usa para deduplicar el solape entre un fetch y
el stream: los eventos ya cubiertos por un snapshot se descartan por `seq`, así que una
reconexión nunca renderiza dos veces un mensaje.

## Visibilidad de la sesión

`remoteEnabled` es un campo de `SessionSnapshot` (`src/protocol.ts`). El daemon condiciona
los broadcasts visibles por dispositivos a ese campo (`require_remote_session`), así que una
sesión que el usuario no compartió es invisible para los dispositivos incluso con un token
válido.

Los comandos del navegador solo se reenvían si la sesión está compartida, y una sesión
`readOnly` acepta solo `ask_answer` y `ask_cancel` (`forward_browser_command`). Eso es lo
que hace de "observar pero no gobernar" un modo real y no una convención de UI.

## Códigos de cierre

| Código | Nombre | Significado | Acción del cliente |
| --- | --- | --- | --- |
| **4001** | `CLOSE_DISCONNECTED` | El socket de Pi se cayó | Reconectar |
| **4003** | `CLOSE_REVOKED` | Dispositivo revocado, o el compartir se apagó | Parar; la credencial está muerta |
| **1012** | — | El daemon se está reiniciando | Reconectar tras una demora |

Definidos en `server/src/main.rs:167–168`, entregados por el broadcast de `kick_tx`
(`:1258`, `:1272`); 1012 en el apagado (`:1495`).

La distinción es toda la razón de ser de estos códigos. Un cliente que tratara 4003 como
1012 reintentaría para siempre con un token revocado; uno que tratara 1012 como 4003 nunca
volvería después de una actualización rutinaria.

## Relacionados

- [Auth](/architecture/auth_es-ES.md) — cómo se autentica el socket
- [Flujo de sesión en vivo](/flows/live-session_es-ES.md) — el protocolo en movimiento
- [UI](/subsystems/ui_es-ES.md) — cómo lo consume el cliente
