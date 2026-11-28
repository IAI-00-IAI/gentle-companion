---
type: Handoff
title: "PINTO — estado para retomar tras liberar el límite de imágenes"
description: "Qué ha hecho PINTO en feat/gentle-shell-aesthetic, qué está arreglado, qué comentarios siguen abiertos y su causa, y qué queda por hacer. Escrito para que una sesión nueva o compactada pueda continuar sin releer la conversación."
tags: [handoff, aesthetic, pinto]
status: active
generated: 2026-11-20
---

# PINTO — handoff

## Por qué este fichero

PINTO agotó el límite del proveedor (**20 imágenes máximo**, error 400
`Total number of images exceeds the maximum allowed of 20`) cargando renders
para verificarlos él mismo. Las imágenes viven en la transcripción, así que
`/reload` no las libera: hace falta `/compact` o sesión nueva.

## Estado de la rama

- Repo: `/home/ricardo/Trabajo/IAI/gentle-companion-aesthetic`
- Rama: `feat/gentle-shell-aesthetic`
- ~67 ficheros cambiados, **nada commiteado por PINTO** (el ORQ commitea).
- Hay un staged heredado de Bonsai2: `ui/src/assets/gentle-companion.webp`.

## Arreglado y verificado (no rehacer)

1. **Selectores CSS muertos** (`.nav .icon`, `.tabbar .icon`): resueltos pasando
   `strokeWidth` como prop a `Icon.svelte`. `svelte-check --fail-on-warnings`
   da **0 errores, 0 warnings** (antes 2). Se probó que el check *puede* fallar
   inyectando un selector sin uso.
2. **Regresión de transparencia en los 5 iconos servidos**: esta rama les había
   quitado el fondo; en iOS eso borra parte del dibujo sobre negro. Reparado
   aplanando sobre `#1a1218` → los cinco dan `srgb opaque=true`, en fuente y en
   `server/web-dist/`.
3. **Style book** (`docs/design-system.md`): `status: active` con sección
   "Open items". Corregidas dos imágenes rotas, el π/rosa mal documentado, y la
   receta de aplanado probada:
   `convert old.png -background '#1a1218' -alpha remove -alpha off new.png`
4. **Cache del service worker** subido a `v8` (prefijo sin cambiar, para no
   huérfanar la cache vieja).
5. **`server/tailcat`**: symlink roto añadido a `.gitignore`.
6. **Screenshots de docs**: 19 imágenes regeneradas; tres localizadores estaban
   rotos en HEAD y se arreglaron.

## Comentarios abiertos en el canvas (4) y su causa

Los cuatro están en `design/aesthetic-choices/`:

| id | Archivo | Texto | Causa |
|---|---|---|---|
| `weccppvq` | `02-icon-weight.html` | "rojo" | sin diagnosticar |
| `8yyi8ghh` | `01-clay-tint.html` | "fondo transparente" | `<svg>` inline sin fondo |
| `gw7pt3cc` | `01-clay-tint.html` | "convertir png - fondo transparente y ajustar. (conservar original)" | embebe `.webp` originales, transparentes |
| `7xxd62vb` | `01-clay-tint.html` | "convertir a png, fondo trans y ajustar tamaño, (guardar original)" | ídem |

**Causa común de los tres de fondo**: los artboards embeben los `.webp`
originales (`6 × data:image/webp;base64`), que son **transparentes**. El
producto ya usa la versión opaca desde el arreglo de esta tarde, así que
**los mockups enseñan el estado anterior**. Ricardo lo vio y tiene razón.

**Arreglo**: re-embeker los webp con el fondo `#1a1218` aplanado, guardando los
originales en un subdirectorio. Es trabajo de código —no requiere mirar nada— y
por tanto es de PINTO. La verificación visual es de Bonsai2.

## Reparto que hay que respetar

- **PINTO**: código, HTML/CSS, docs, generadores. **No carga imágenes.**
- **Bonsai2**: todo juicio visual. Recibe rutas y preguntas concretas.
  Imágenes ≤1024 px de lado mayor.
- **ORQ**: commits, verificación de texto, coordinación.

Motivo: Bonsai2 corre un modelo de visión local sin tope; PINTO corre un modelo
remoto con tope de 20 imágenes. Cargar un render "para comprobar que se ve bien"
es la operación que mata la sesión.

## Qué queda

1. Re-embeker los tres assets con fondo (arriba).
2. Diagnosticar el comentario "rojo" de `02-icon-weight.html`.
3. Pedir a Bonsai2 la verificación visual de los artboards corregidos.
4. Las dos decisiones de diseño de Ricardo siguen abiertas: tinte del arte clay
   y grosor del trazo (2.0 / 2.5 / 3.0).
5. Commit de los tres slices, que hace el ORQ.
