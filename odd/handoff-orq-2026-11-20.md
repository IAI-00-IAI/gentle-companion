---
type: Handoff
title: "ORQ — handoff de la jornada 2026-11-20"
description: "Lo que el coordinador sucesor necesita saber: el equipo y sus capacidades, las reglas pagadas con tiempo, el estado por sistema y los doce pendientes. Escrito porque la sesión del ORQ llega al 70% de contexto."
tags: [handoff, coordination, orq]
status: active
generated: 2026-11-20
---

# ORQ — handoff

## Lo que importa más que cualquier dato

El valor de este puesto no es ejecutar: es **saber quién puede hacer qué** y no pedirle a un martillo que atornille. Hoy se perdió una sesión entera de PINTO por eso.

## El equipo

| Rol | Sesión | Ventana | Fuerte en | **No usar para** |
|---|---|---|---|---|
| **ORQ** | `01a1f3db` | 1M | Coordinar, verificar, commits, diagnóstico por código | Imágenes |
| **INFRA** | `01a1ef70` | 1M | Red, router, firewall, watchdog, SSH/WoL | Contabilidad |
| **CONTA** | `01a1f030` | 1M | Cuota, costes, financiación, OKF en binarios | Imágenes, red |
| **Bonsai2** | `01a1f448` | **139k** | **Todo juicio visual**, sin tope de imágenes | Trabajo pesado de contexto |
| **PINTO** | `01a1f971` | 1M | Código UI, CSS/Svelte, builds | **Imágenes: tope 20, se bloquea** |
| **KOS** | `01a1f8b3` | 1M | Conocimiento, corpus, análisis documental | Infraestructura |

## Nueve reglas pagadas con tiempo

1. **Imágenes → Bonsai2, siempre.** PINTO se bloqueó con `400: images exceeds the maximum of 20`. `/reload` no libera; `/compact` o sesión nueva sí.
2. **Automations de Companion: acción `command`, nunca `prompt`.** Un prompt arranca una sesión Pi por ejecución (9 sesiones en 4 h para entregar una línea).
3. **Nunca medir un exit code por un pipe** (`| tail` devuelve el de `tail`).
4. **Un guard que solo comprueba presencia no protege.** Parsear, no buscar substrings.
5. **`du -sm` cuenta bloques, no bytes.** Para corpus, tamaño de fichero.
6. **Validar guards en un clon fresco**, no en el árbol del autor. Encontró 3 defectos reales.
7. **No dejar que un buen argumento se convierta en diagnóstico no verificado.** Hoy, cuatro casos.
8. **Slices de ~400 líneas.** Hay una rama con ~4.600 que habrá que partir.
9. **Rutas absolutas con `:line`** en conversación. Las backticks probablemente impiden el clic.

## Estado por sistema

**Modelo**: deepseek `high` en todo el equipo salvo Bonsai2 (local, decisión de Ricardo). `reserveTokens` 419430→**209715** (compacta al 80%). Requiere `/reload`. `medium` no existe en deepseek.

**Red**: HP con doble camino (`.2.20` cable + `.43.73` wifi). Gateway del AP del A2 = **192.168.43.168**, no .43.1. Ruta mala en el perfil NM `ricardoA2` → workaround socat; arreglo real pendiente de sudo.

**Router**: firewall endurecido (wan REJECT), `/www` escribible, `scp -O` funciona, `etherwake` despierta a otros (no a sí mismo).

**⚠ Daemon companion — PROBLEMA ABIERTO**: **~7 procesos `tailcat serve`** en el puerto 43722 con **2 identidades** (`.pi` y `.gentle-shell`). Causa de que el WebSocket de Ricardo se caiga. Arreglo: consolidar estado en `.gentle-shell`.

**eePC `.30`**: usuario `telfmng`, **sudo sin contraseña** (contraseña `TelfMNG` con mayúscula — costó horas asumir que estaba bloqueado). Pendiente `ssh-copy-id`.

## Los doce pendientes

1. Consolidar los ~7 tailcats (causa el WS caído)
2. Push de `feat/accounting` — 15 commits, `mistral-gateway`
3. Partir `feat/accounting-dashboard` (~4.600 líneas) en PRs encadenadas
4. Informe a Alan + fix del canvas (rutas absolutas en iframe)
5. Engram Cloud en ricardoPC
6. Verificar `terminal.hyperlinks: true` (aplicado, sin confirmar)
7. Tinte clay (A1/A2/A3) y grosor (B1/B2/B3) — decide Ricardo, canvas abierto
8. Mascota Mustachi al producto — solo está en maquetas
9. Muestreador de cuota — CONTA, host por decidir
10. Pasar 4 del corpus CDT — KOS
11. Traducción de `automation-flow.ts` y `AskSheet` — sin asignar
12. Traslado de `IAI` a `IAI-00-IAI` + espejo — sin prisa

## Git, y una trampa

- `gentle-companion` / `feat/accounting-dashboard`: pusheado hasta `2e4743a`.
- `gentle-companion-aesthetic` / `feat/gentle-shell-aesthetic`: `ff1dadf` + trabajo sin commitear de PINTO.
- `mistral-gateway` / `feat/accounting`: **15 commits sin pushear**.
- `gentle-shell`: actualizado a `25a965a13`, pusheado al fork.

**Trampa**: en `mistral-gateway`, `origin` es el upstream **ajeno** (Classic298) y el propio es `fork`. Un `git push` a secas iría al repo de otra persona.

**El guard de RDD** bloquea `git push` desde un `cd` en el mismo comando; usar `git -C <ruta> push`.
