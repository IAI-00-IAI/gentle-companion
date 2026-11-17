---
okf_version: "0.2"
title: Bundle de conocimiento de gentle-companion
description: Arquitectura, subsistemas, flujos y operación de gentle-companion — una extensión de Pi más un daemon en Rust que pone la UI real de Companion en un teléfono.
generated: { by: agent:gentle-pi, at: 2026-09-27T00:00:00Z }
---

# gentle-companion

Una extensión de Pi y un daemon en Rust que exponen una sesión de Pi en ejecución a un
teléfono como una app web real, alcanzable por la LAN o a través de un túnel tailcat.

## Empezá por acá

- [Vista de arquitectura](/architecture/overview_es-ES.md) — los tres procesos y cómo se hablan
- [Modelo de proceso](/architecture/process-model_es-ES.md) — qué arranca el daemon y en qué orden
- [Protocolo de cable](/subsystems/protocol_es-ES.md) — cada mensaje en ambas direcciones
- [Flujo de emparejamiento](/flows/pairing_es-ES.md) — del QR al token de dispositivo

## Arquitectura

| Concepto | Qué responde |
| --- | --- |
| [Vista general](/architecture/overview_es-ES.md) | Qué procesos existen y qué posee cada uno |
| [Modelo de proceso](/architecture/process-model_es-ES.md) | Orden de arranque, tareas, apagado |
| [Superficies HTTP](/architecture/http-surfaces_es-ES.md) | Router de admin vs dispositivo, middleware, reglas de origen |
| [Autenticación](/architecture/auth_es-ES.md) | Emparejamiento, almacenamiento de tokens, upgrade de WS, revocación |
| [Estado](/architecture/state_es-ES.md) | Qué vive en memoria y qué en disco |

## Subsistemas

| Concepto | Qué responde |
| --- | --- |
| [Extensión](/subsystems/extension_es-ES.md) | Tools, hooks, interruptor de compartición |
| [Ciclo de vida del daemon](/subsystems/daemon-lifecycle_es-ES.md) | ensureDaemon, descarga, registro del servicio |
| [Protocolo](/subsystems/protocol_es-ES.md) | Conjuntos de mensajes de ambos WebSockets |
| [Bridge](/subsystems/bridge_es-ES.md) | Búsqueda de archivos y proxy de endpoints loopback |
| [Automatizaciones](/subsystems/automation_es-ES.md) | Definiciones, tick de cron, ejecución de runs |
| [Tailcat](/subsystems/tailcat_es-ES.md) | Proceso del túnel y espejo loopback |
| [TLS](/subsystems/tls_es-ES.md) | HTTPS optativo en puerto dedicado |
| [Assets](/subsystems/assets_es-ES.md) | SPA embebido, CSP, caché |
| [UI](/subsystems/ui_es-ES.md) | Rutas, máquina de estados de conexión, direct-first |
| [Shims del túnel](/subsystems/tunnel-shims_es-ES.md) | Clientes HTTP/1.1 y RFC 6455 sobre el túnel |

## Flujos

| Concepto | Qué responde |
| --- | --- |
| [Emparejamiento](/flows/pairing_es-ES.md) | Invitación → QR → claim → token → socket |
| [Sesión en vivo](/flows/live-session_es-ES.md) | Snapshot → actividad → pregunta → steering |
| [Fallback al túnel](/flows/tunnel-fallback_es-ES.md) | LAN primero, túnel cuando la LAN no está |

## Operación

| Concepto | Qué responde |
| --- | --- |
| [Scripts del daemon](/operations/daemon-scripts_es-ES.md) | start, stop, service, logs |
| [Despliegue](/operations/deployment_es-ES.md) | TLS, hosting estático, orígenes permitidos |

## Convenciones

- Los diagramas son Mermaid y renderizan en GitHub.
- Cada afirmación está anclada al código como `path:line` o a un test.
- La versión en inglés de cada concepto es la misma entrada sin el sufijo `_es-ES`.
