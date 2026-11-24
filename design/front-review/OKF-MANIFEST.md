---
type: Asset Manifest
title: "Front review — pantallas reales para marcar"
description: "Capturas de la app en ejecucion (0.7.1) con marcadores numerados y selectores CSS, para que Ricardo senale sobre artefactos visuales en vez de escribir una lista."
status: open
author: "PINTO (agent, session 01a1f971)"
source: "gentle-companion-aesthetic/design/front-review/OKF-MANIFEST.md"
generated: 2026-11-24
---

# Front review

Capturas de la **app real**, no maquetas. Verificado antes de empezar: `http://127.0.0.1:43721/`
responde 200, reporta 0.7.1, `.sidebar` presente.

## Prueba de que cada captura muestra lo que promete

El estado del sidebar se persiste en `localStorage['pi-companion-sidebar']`, asi que dos capturas
pueden salir identicas sin que se note. Por eso se fijo el estado antes de cada una y se **midio
el ancho real de la columna**:

```
01-sidebar-expanded   sidebar = 234 px
02-sidebar-collapsed  sidebar =  58 px
06-home               sidebar = 234 px
```

Anchos distintos donde deben serlo. Una captura que existe no es una captura correcta.

## Que NO se capturo, y por que

| Pantalla | Estado |
|---|---|
| Composer (caja de entrada) | **No capturada**: no hay sesion abierta, el composer no existe que fotografiar |
| Panel de preguntas | **No capturada**: no hay pregunta pendiente |

No se maquetaron. Un revisor senalando sobre una pantalla inventada estaria revisando una mentira.

## Archivos

| Archivo | Tipo | Bytes | SHA-256 (16) |
|---|---|---|---|
| `01-sidebar-expanded.html` | HTML | 601874 | `6a56c653ca90a291` |
| `01-sidebar-expanded.png` | PNG | 449168 | `752545a227a580a6` |
| `01-sidebar-expanded.png.meta.json` | JSON | 413 | `461bedd46c58a0a2` |
| `02-sidebar-collapsed.html` | HTML | 759807 | `00c9a9a602dfb981` |
| `02-sidebar-collapsed.png` | PNG | 567823 | `db008798230e507e` |
| `02-sidebar-collapsed.png.meta.json` | JSON | 414 | `c1696b39d78ddd24` |
| `06-home.html` | HTML | 754288 | `867f9294ff091a79` |
| `06-home.png` | PNG | 563819 | `dabb7292e0994860` |
| `06-home.png.meta.json` | JSON | 382 | `8f83c609333ccfc4` |
