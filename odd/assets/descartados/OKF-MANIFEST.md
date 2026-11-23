---
type: Asset Manifest
title: "Descartados — pruebas y estado de herramienta"
description: "Dos ficheros que no son artefactos del proyecto: el layout que genera el canvas al arrastrar paneles y un índice temporal de tableros. Se conservan como evidencia, fuera de git."
status: discarded
author: "PINTO (session 01a1f971)"
source: "gentle-companion-aesthetic/odd/assets/descartados/"
generated: 2026-11-23
---

# Descartados

No son contenido del proyecto. Están aquí **como evidencia**, no como material a usar: se
conservan para poder responder "¿de dónde salió esto?" si alguien lo pregunta, sin ensuciar
el árbol de trabajo.

| Fichero | Qué es | Por qué no va en git |
|---|---|---|
| `layout.json` | Posición de los tableros, **escrita por el canvas** al arrastrar paneles (`design-canvas-server.ts:896`) | Estado de herramienta, no artefacto. Versionarlo produciría un diff espurio cada vez que alguien mueve un panel |
| `index-boards.html` | Índice estático que PINTO creó para servir los tableros cuando el canvas estaba caído | Cumplió su función. Un fichero con nombre oficial que no es oficial se lee como oficial |

## Por qué se conservan en vez de borrarse

Borrar destruye la capacidad de responder preguntas. Estos dos no costan nada (2,7 KB) y su
valor es documental: si alguien encuentra una referencia a `index-boards.html` en un mensaje
antiguo, aquí está el fichero que la explica.
