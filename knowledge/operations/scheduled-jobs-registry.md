---
type: Operations Registry
title: Registro de trabajo programado
description: "Una fila por trabajo programado del equipo: quién, cuándo, cómo, con qué registro. Fuente única para auditar qué corre en cada máquina sin leer cuatro ficheros distintos."
tags:
  [operations, scheduling, cron, companion, systemd, registry]
status: active
generated: 2026-11-20
---

# Registro de trabajo programado

> **Regla**: todo agente que añada un trabajo programado añade su fila aquí **antes** de activarlo.
> Un trabajo sin fila no existe para quien audita.

## Máquinas

| Alias | IP | Notas |
|---|---|---|
| `ricardoHP` | 192.168.2.20 | Máquina principal. Carga alta (loadavg ~18 en momentos de hoy) |
| `ricardoPC` | 192.168.2.11 | GPU, modelos locales (Bonsai2). Se suspende |
| `eeePC` | 192.168.2.30 | Monitor en tty1. Internet y sudo funcionando desde 2026-11-20 |
| `A2` | 192.168.43.x | Móvil. AP + tether |

## Registro

| Máquina | Planificador | Identificador | Cadencia | Qué ejecuta | Como | Log | Dueño | Propósito |
|---|---|---|---|---|---|---|---|---|
| ricardoHP | `cron` (usuario) | `sync-device-state.sh` | `* * * * *` (1 min) | `/home/ricardo/.local/share/gentle-watchdog/sync-device-state.sh` | `ricardo` | **ninguno** ⚠️ | INFRA | Recoge estado de router/Bonsai2/A2/HP y lo empuja al eeePC |
| ricardoHP | `companion` | `watchdog-router-health` | `*/15 * * * *` | Automación Companion → `check-router.sh` | `ricardo` | `watchdog.log` | INFRA | Salud del router OpenWrt |
| ricardoHP | `companion` | `watchdog-reachability` | `7,37 * * * *` | Automación → `check-reachability.sh` | `ricardo` | `watchdog.log` | INFRA | Alcanzabilidad (LAN, WAN, uplink) |
| ricardoHP | `companion` | `watchdog-agents` | `3,18,33,48 * * * *` | Automación → `check-agents.sh` | `ricardo` | `watchdog.log` | INFRA | Liveness de sesiones + compactaciones + bucles |
| ricardoHP | `companion` | `watchdog-alerts-publish` | `*/10 * * * *` | Automación → `relay-gate.sh` (solo `command`, sin modelo) | `ricardo` | `watchdog-alerts.txt` + `notify-send` (CRIT) | INFRA | Publica alertas nuevas. **Sin sesión Pi** |
| eeePC | `systemd` | `gentle-monitor.service` | continua (`restart=always`) | Monitor en tty1 | `telfmng` | journal del sistema | INFRA | Pantalla de estado visible |

## Pendiente de registrar (no activo aún)

| Máquina | Planificador | Identificador | Cadencia | Qué | Dueño | Estado |
|---|---|---|---|---|---|---|
| ? | ? | muestreador de cuota | ~15 min | Lee cuota y escribe `usage.db` | **CONTA** | Propuesto. Host por decidir |

## Cómo se añade una fila

1. Decide **máquina** y **planificador**. Preferencias, en orden:
   - `companion` para trabajo que debe correr **mientras haya sesión de agente** y cuyo estado ya vive ahí.
   - `cron` de usuario para trabajo independiente de las sesiones (sobrevive a que no haya agentes).
   - `systemd-timer` cuando haga falta gestión de recursos, reintentos o dependencias.
   - `systemd service` (como el monitor del eeePC) para procesos **continuos**, no periódicos.
2. Añade la fila **con log**. Un trabajo sin log es un trabajo que nadie puede depurar; hoy el `sync-device-state.sh` no tiene y es un hueco visible.
3. Si es una automación de Companion: **acción `command`, nunca `prompt`**. Un `prompt` arranca una sesión Pi por ejecución — medimos nueve sesiones en cuatro horas para entregar una línea de texto.
4. Si publica o notifica: **el script sale 0 de forma incondicional**. Un fallo de entrega no debe reportarse como la emergencia que anuncia.
5. Los ajustes (umbrales, cadencias, rutas) van en **un fichero de configuración**, no dispersos en el script.

## Reglas aprendidas (pagadas con tiempo)

- **Sin log, no hay diagnóstico.** `sync-device-state.sh` corre cada minuto y no deja rastro.
- **Rate-limit por condición**, y reportar la recuperación una sola vez. Un vigilante que grita cada 15 minutos por el mismo hecho se ignora.
- **Estado en fichero de texto plano**, una línea por hecho con timestamp: cualquier consumidor (TUI, web, script) lo lee sin integración.
- **Cuidado con los falsos positivos**: un trabajo que "no encuentra nada" y calla es indistinguible de uno que funciona.

## Historial

- 2026-11-20: registro creado a petición de Ricardo, coordinado por ORQ. Cinco planificadores en tres máquinas sin inventario previo.
