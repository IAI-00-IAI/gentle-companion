---
type: Asset Manifest
title: "Fuentes editables de la rosa (GIMP)"
description: "Los tres .xcf que Ricardo dejó el 2026-11-23 para no perderlos: son las ediciones de la rosa hechas con GIMP de las que salieron los PNG del logotipo. Falta documentar qué edición es cada uno."
status: organized
author: "Ricardo (_00_) — las ediciones"
documented_by: "PINTO (session 01a1f971) — este índice, 2026-11-23"
source: "gentle-companion-aesthetic/odd/assets/OKF-MANIFEST.md"
generated: 2026-11-23
---

# Fuentes editables de la rosa

Ricardo: *"los dejé yo ayer ahí para que no se perdieran, son ediciones de la rosa, hechas con
gimp, pero no llegué a documentarlo, era tarde"*.

Esto es la documentación que faltaba. **No la invento**: digo lo que se puede medir de los
ficheros, y marco como desconocido lo que solo Ricardo sabe.

## Los tres ficheros

| Fichero | Tamaño | Dimensiones | Qué se puede afirmar |
|---|---|---|---|
| `Compañero_ Rosa digital de conexion.xcf` | 3,72 MB | 1672 × 941 | La más grande y **apaisada**, no cuadrada. Nombre sugiere conexión/emparejamiento |
| `logo_rosa_tr_0.xcf` | 0,42 MB | 627 × 627 | Cuadrada. El sufijo `_0` sugiere versión previa o primer intento |
| `logo_rosa_tr.xcf` | 0,32 MB | 1254 × 640 | **Apaisada, no cuadrada.** No es el logo 1254×1254 que se envió después |

**Ojo con la tercera**: el PNG que llegó para el logotipo era **1254 × 1254**. Este `.xcf` mide
**1254 × 640**, así que es un recorte apaisado o una edición distinta, no la misma imagen
guardada en formato editable. No lo doy por equivalente.

## Lo que falta y solo Ricardo puede decir

Estos cinco puntos son los que convierten tres ficheros en material utilizable:

1. **¿Qué edición es cada uno?** Nombre, pero no propósito.
2. **¿Cuál produjo el PNG transparente final?** Se puede comparar, pero afirmarlo sin su palabra sería adivinar.
3. **¿Hay capas con trabajo a medias** que convenga saber antes de reabrir?
4. **¿Alguno está obsoleto** por una edición posterior?
5. **¿El de 1672×941 es para otro sitio** (¿emparejamiento?) o es una prueba de encuadre?

## Política de git: fuera del repositorio, pero registrado

4,5 MB de fuentes editables no pertenecen al repositorio, y ya hay precedente:
`03c6a41 chore: ignore GIMP .xcf sources` decidió lo mismo en `feat/accounting-dashboard`.
Estos aparecieron después, en otro sitio.

**Pero sacarlos sin dejar rastro es cómo se pierden.** Si se mueven fuera de git, el destino
tiene que quedar escrito aquí. Propuesta pendiente de decisión:

```
~/Trabajo/IAI/private-backups/art-sources/
```

Y este manifiesto se actualizará con la ruta real en cuanto se muevan. Un manifiesto que dice
"está fuera del repo" sin decir dónde no resuelve el problema que lo motivó.

## Nota sobre el nombre con espacio

`Compañero_ Rosa digital de conexion.xcf` lleva **un espacio en el nombre**. Cualquier script que
itere sin comillas (`for f in $(ls)`) se queda con `Compañero_` y pierde 3,72 MB de los 4,5.
Si se mueven, conviene renombrar a algo sin espacios: el contenido no depende del nombre.

## Organización actual (2026-11-23)

Decisión de Ricardo: *"los xcf los puedes mover a una carpeta de borradores y otra de
descartados para layout e index-boards, así los sacamos, guardamos evidencia y podemos
revisarlos"*.

```
odd/assets/
  borradores/   los tres .xcf, con su OKF-MANIFEST.md    (fuera de git, manifiesto versionado)
  descartados/  layout.json + index-boards.html          (fuera de git, manifiesto versionado)
```

Ambas carpetas están en `.gitignore` con excepción de sus manifiestos: **las fuentes no
viajan con el repo, pero el rastro de que existen sí.** Ese era el punto — sacarlas sin
perderlas.
