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
01-sidebar-expanded   grid column = 244 px   .sidebar box = 234 px
02-sidebar-collapsed  grid column =  68 px   .sidebar box =  58 px
06-home               grid column = 244 px   .sidebar box = 234 px
```

**Medido en vivo, y corrige una afirmación mía anterior.** Llegué a decir que el token
`--sidebar-collapsed: 68px` "miente" porque el elemento medía 58. **Falso**: el grid reserva
los 68 px correctamente, y lo que mide 58 es la caja del `aside` dentro de esa columna.

La diferencia son 16 px de padding (8+8) más 1 de borde y 2 de scrollbar, con
`box-sizing: border-box` (`app.css:113`). El token es correcto; yo había medido el elemento
equivocado. Anotado porque el error es más instructivo que el dato: **medir el elemento
interior y culpar al token es cómo se "arregla" algo que no estaba roto.**

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
| `03-sessions-list.html` | HTML | 404366 | `4713821e582fdde7` |
| `03-sessions-list.png` | PNG | 301477 | `52388abf3e290d4a` |
| `03-sessions-list.png.meta.json` | JSON | 419 | `c95140b0be09d109` |
| `04-session-detail.html` | HTML | 236358 | `c326abdd1d8d50a5` |
| `04-session-detail.png` | PNG | 175541 | `f12e0a57d8db5ba4` |
| `04-session-detail.png.meta.json` | JSON | 369 | `a4f07ffe70c1cf5d` |
| `05-ask-sheet.html` | HTML | 328574 | `ab3689ac8c21763f` |
| `05-ask-sheet.png` | PNG | 244411 | `7b5fa39039339cb3` |
| `05-ask-sheet.png.meta.json` | JSON | 568 | `51a32d762d81e888` |
| `06-home.html` | HTML | 754288 | `867f9294ff091a79` |
| `06-home.png` | PNG | 563819 | `dabb7292e0994860` |
| `06-home.png.meta.json` | JSON | 382 | `8f83c609333ccfc4` |
| `07-automations-list.html` | HTML | 396874 | `a4354f041d492ea9` |
| `07-automations-list.png` | PNG | 295914 | `6a76522e4c8dce85` |
| `07-automations-list.png.meta.json` | JSON | 411 | `2cef259e9a52932e` |
| `08-settings.html` | HTML | 431744 | `7f37fbd5877619d7` |
| `08-settings.png` | PNG | 322104 | `74866bcd3a3f364b` |
| `08-settings.png.meta.json` | JSON | 412 | `c635ed6b2ec5ac7a` |
| `09-devices.html` | HTML | 409510 | `5b9ff77dddae79ed` |
| `09-devices.png` | PNG | 305573 | `c17d2f6499b5a385` |
| `09-devices.png.meta.json` | JSON | 371 | `2effd2ea1100d72a` |
| `10-help.html` | HTML | 349857 | `cfad6ed983a4afc3` |
| `10-help.png` | PNG | 260953 | `32abbdab7bcebb52` |
| `10-help.png.meta.json` | JSON | 357 | `f9a1d93c727cf33d` |
| `11-privacy.html` | HTML | 364136 | `f9f9215fd98c4d7d` |
| `11-privacy.png` | PNG | 271670 | `878db3e182dce7de` |
| `11-privacy.png.meta.json` | JSON | 357 | `5b4d609e15aaf4ac` |
| `12-terms.html` | HTML | 381888 | `db4c001b2a6e95b9` |
| `12-terms.png` | PNG | 284962 | `c04c3a7e210a00b4` |
| `12-terms.png.meta.json` | JSON | 388 | `7c279d2cc6fa7661` |
