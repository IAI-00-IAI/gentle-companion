---
type: Asset Manifest
title: "Descartados — iconos previos y estado de herramienta"
description: "Siete ficheros retirados del arbol activo y conservados como evidencia: los cuatro iconos opacos previos al pase de transparencia del 2026-11-25, mas el layout del canvas y un indice temporal."
status: discarded
author: "PINTO (agent, session 01a1f971)"
discarded_by: "Ricardo (_00_)"
source: "gentle-companion-aesthetic/odd/assets/descartados/"
generated: 2026-11-25
---

# Descartados

Nada se borra: lo que sale del arbol activo se conserva aqui con su motivo. Un fichero
retirado sin rastro es un fichero perdido, y estos explican por que el arbol actual es
como es.

## Iconos previos (retirados 2026-11-25)

Ricardo: *"favicon y logo: los he modificado, he hecho fondo transparente a los cuatro... los
antiguos los he pasado a descartados"*.

| Fichero | Qué era |
|---|---|
| `apple-touch-icon.png` | 360x360 **opaco**, la version cuyo campo se restauro el 2026-11-20 para que iOS no compusiera la transparencia sobre negro |
| `favicon.png` | 192x192 **opaco**, restaurado el 2026-11-20 |
| `icon-192.png` | 192x192 **opaco**, servido por `server/src/assets.rs:167` |
| `icon-512.png` | 512x512 **opaco**, servido por `server/src/assets.rs:168` |

**Medido, no supuesto:** los cuatro descartados son 100% opacos; los cuatro que los sustituyen
estan entre 27% y 30% opacos.

## Estado de herramienta

| Fichero | Que es | Por que no va en git |
|---|---|---|
| `layout.json` | Posicion de los tableros, escrita por el canvas al arrastrar paneles | Estado de herramienta, no artefacto |
| `index-boards.html` | Indice temporal que PINTO creo para servir los tableros cuando el canvas estaba caido | Cumplio su funcion; un fichero con nombre oficial que no es oficial se lee como oficial |

## Archivos

| Archivo | Tipo | Bytes | SHA-256 (16) |
|---|---|---|---|
| `apple-touch-icon.png` | PNG | 57214 | `e39edd7cbb2f1e9c` |
| `favicon.png` | PNG | 26965 | `a4a06a2d38713db3` |
| `icon-192.png` | PNG | 37368 | `8bf2ad36f600c82d` |
| `icon-512.png` | PNG | 241248 | `f17ef2063c4a87c2` |
| `index-boards.html` | HTML | 2506 | `38924aef4b538fb6` |
| `layout.json` | JSON | 233 | `566116db74225b50` |
