---
type: Asset Manifest
title: "Borradores — fuentes editables de la rosa"
description: "Los tres .xcf que Ricardo dejó el 2026-11-23: ediciones de la rosa hechas con GIMP, de las que salieron los PNG del logotipo. Fuera de git por peso; el manifiesto queda versionado para que no se pierda el rastro."
status: needs-review
author: "Ricardo (_00_) — las ediciones"
documented_by: "PINTO (session 01a1f971)"
source: "gentle-companion-aesthetic/odd/assets/borradores/"
generated: 2026-11-23
---

# Borradores — fuentes editables de la rosa

Esta carpeta **no está en git** (`odd/assets/borradores/*` ignorado). Solo este manifiesto
se versiona, para que quien clone el repo sepa que estas fuentes existen, dónde están y qué
son. Sin esto, mover los ficheros fuera del repo los habría vuelto invisibles.

## Los tres ficheros

| Fichero | Tamaño | Dimensiones | Qué se puede afirmar |
|---|---|---|---|
| `Compañero_ Rosa digital de conexion.xcf` | 3,72 MB | 1672 × 941 | La mayor y **apaisada**. El nombre sugiere conexión/emparejamiento |
| `logo_rosa_tr_0.xcf` | 0,42 MB | 627 × 627 | Cuadrada. El sufijo `_0` sugiere versión previa o primer intento |
| `logo_rosa_tr.xcf` | 0,32 MB | 1254 × 640 | **Apaisada.** No es el logo 1254×1254 que se envió |

**Diferencia que conviene no pasar por alto:** el PNG del logotipo medía **1254 × 1254**;
`logo_rosa_tr.xcf` mide **1254 × 640**. Es un recorte apaisado u otra edición, no la misma
imagen en formato editable.

## Lo que solo Ricardo puede responder

1. ¿Qué edición es cada uno?
2. ¿Cuál produjo el PNG transparente final?
3. ¿Hay capas con trabajo a medias que convenga saber antes de reabrir?
4. ¿Alguno quedó obsoleto por una edición posterior?
5. ¿El apaisado de 1672×941 es para otra superficie (¿emparejamiento?) o una prueba de encuadre?

## Nota práctica

`Compañero_ Rosa digital de conexion.xcf` lleva **un espacio en el nombre**: cualquier script
que itere sin comillas se queda con `Compañero_` y pierde 3,72 MB de los 4,5. Renombrar es
seguro; el contenido no depende del nombre.
