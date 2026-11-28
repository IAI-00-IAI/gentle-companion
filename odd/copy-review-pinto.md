---
type: Review Record
title: Copy reviewed — Spanish wording (PINTO → Ricardo → applied)
description: "Strings PINTO wrote in Spanish, reviewed by Ricardo, and the wording he corrected. Tabular, no prose. Three were already committed; the rest wait for his wording."
status: reviewed
source: "gentle-companion-aesthetic/odd/copy-review-pinto.md"
Author: PINTO (agent, session 01a1f971)
Reviewed_by: Ricardo (_00_)
Version: Rev0.0.3
generated: 2026-11-23
revised: 2026-11-23
---

# Copy review — Spanish wording

Ricardo: *"si tenéis dudas con la traducción decídmelo, que con el inglés me apaño y el castellano es lo mío"*.

Two blocks below. **A** is already committed and can be corrected in place. **B** is not
written yet — it waits for your wording, so nothing is invented first and fixed later.

---

## A. Already committed — needs a second opinion

| Key | English (current) | My Spanish (committed) | Where it shows |
|---|---|---|---|
| `session.detail.thought` | Thought for a moment | Pensó un momento | Session detail, thinking timer under 2 s |
| `session.detail.thought.seconds` | Thought for {n}s | Pensó {n}s | Same, under 1 min |
| `session.detail.thought.minutes` | Thought for {m}m {s}s | Pensó {m}m {s}s | Same, over 1 min |
| `sessiontable.caption` | Sessions with their workspace, model and status. {label} | Sesiones con su espacio de trabajo, modelo y estado. {label} | Screen-reader caption on the sessions table (home page) |
| `permissions.notifications.test.description` | Send a test notification to check that alerts arrive on this device. | Envía una notificación de prueba para comprobar que las alertas llegan a este dispositivo. | Body of the real test notification pushed to the device |

Notes worth knowing before you change anything:
- `session.detail.thought` is only used below **2 seconds**. "Pensó un momento" reads as a
  completed action; if you prefer present, "Pensando un momento" fits the live timer better.
- `sessiontable.caption` is **screen-reader only** (`sr-only`), never seen on screen. Complete
  sentences are correct there; commercial copy would be wrong.
- `permissions.notifications.test.description` is the **body of an OS notification**, so length
  matters — some systems truncate around 100 characters. The Spanish is 92.

---

## B. Not written yet — needs your wording first

These are **hardcoded in English today**, so they are visible bugs, not a style question.
I have deliberately not translated them: you asked to see them first.

### B1. `ui/src/lib/TerminalPopup.svelte`

| English today | My proposal | Where it shows |
|---|---|---|
| Pi popup | Ventana de Gentle-Shell | Popup heading |
| Connected to your terminal | Conectado a tu terminal | Popup status |
| Terminal view | Vista de terminal | Section heading |
| More terminal keys | Más teclas del terminal | Button/aria |
| Send text | Enviar texto | Button |
| Send text to Pi | Enviar texto a Gentle-Shell | Button aria |
| Send Escape to the popup | Enviar Escape a la ventana | Button title |
| Send Escape to close the terminal popup | Enviar Escape para cerrar la ventana del terminal | Button title |
| Back / Esc | Atrás / Esc | Hint |
| Scroll view down | Desplazar la vista abajo | aria |
| Smaller terminal text | Texto del terminal más pequeño | aria |
| Terminal view controls | Controles de la vista del terminal | aria |
| Waiting for the popup to render… | Esperando a que se dibuje la ventana… | Status |

### B2. `ui/src/lib/AskSheet.svelte`

| English today | My proposal | Where it shows |
|---|---|---|
| Answer | Responder | Button |
| Choose any | Elige cualquiera | Radio group hint |
| Later | Más tarde | Button |
| Other | Otro | Radio option |
| Question from Pi | Pregunta de Gentle-Shell | Sheet heading |
| Write your own answer | Escribe tu propia respuesta | Textarea placeholder |
| Your own answer | Tu propia respuesta | Textarea label |
| Your answer | Tu respuesta | Textarea placeholder |

### B3. `ui/src/lib/AutomatedSessionBadge.svelte`

| English today | My proposal | Where it shows |
|---|---|---|
| Automated · answers only | Automatizada · solo respuestas | Visible badge on an automation-driven session |

### B4. The long warning — blocked on scope, not on wording

`src/git-changes.ts:124`, consumed by `src/bridge.ts:9`. Lives in the **root `src/`**, not in
`ui/`. Currently hardcoded English:

> Only recorded session edits and applied Pi-Jar subagent files are shown. Shell-only edits or
> delegates without an applied-file report may be missing; shared files can include other changes.

**Not translated, deliberately.** Two open questions before wording matters:
1. Does `src/` (the bridge / daemon side) fall inside translation scope at all, or is this
   diagnostic text that stays English?
2. If it does: my draft is below, and it is long enough that wording is worth your pass.
   > Solo se muestran las ediciones registradas de la sesión y los archivos de subagente
   > aplicados de Pi Jar. Pueden faltar ediciones hechas solo desde la shell, o delegados sin
   > informe de archivos aplicados; los archivos compartidos pueden incluir cambios de otros.

---

## C. Two things I decided, so you can overrule them

**`sessiontable.model.mobile` and `sessiontable.model.none` have identical text** ("No model" /
"Ningún modelo"). Different contexts, same wording. I left them equal rather than inventing a
distinction the interface does not make. If the mobile one should read differently, say so.

-NO- 
**"Pi" stays as "Pi"** inside phrases (Pi popup, Question from Pi, Sesión de Pi). Only the  
surrounding words are translated. Renaming the product token was ruled out separately, and
`Pi-Jar` keeps its name — you confirmed that.
-SI-
**"Pi" don't stays as "Pi"** inside phrases, Gentle Shell does (Gentle Shell popup, Question from Gentle Shell, Sesión de Gentle Shell). Only the  
surrounding words are translated. Renaming the product token was ruled out separately, and
`Pi-Jar` keeps its name — you confirmed that
---

## D. Ricardo's corrections, applied

| Item | Was | Ricardo's ruling | State |
|---|---|---|---|
| "Pi" inside phrases | Keep the token `Pi` | **No.** Render as **Gentle Shell**: "Gentle Shell popup", "Question from Gentle Shell", "Sesión de Gentle Shell" | **Applied** — `settings.usage.source.session` now reads `Gentle Shell session` / `Sesión de Gentle Shell`; the daemon still sends the literal `Pi session`, so only its presentation changed |
| `sessiontable.model.mobile` vs `.none` | Left identical, flagged as a question | **Rejected as a finding** (`-NO-`) | No action; they stay identical |
| `Pi-Jar` | Keep the name | Confirmed, stays | Unchanged |

Two test assertions pinned the old wording and failed when it changed. Both updated, and the test
was renamed because it no longer described what it checks. Suite back to **399 pass, 0 fail**.

## How to answer

Cheapest for you: reply with the rows that are wrong and the wording you prefer. I do not need
a full table back. Anything you do not mention I will take as acceptable.

---

## E. Deferred to the next release — decided 2026-11-23

Ricardo: *"OK a Pi session, ya lo miraremos con tranquilidad"*. Nothing below is applied;
his wording is recorded so it is not lost.

| Item | His wording | Status |
|---|---|---|
| `Pi popup` | Ventana de Gentle-Shell | Not applied (string still English) |
| `Send text to Pi` | Enviar texto a Gentle-Shell | Not applied |
| `Question from Pi` | Pregunta de Gentle-Shell | Not applied |
| `Terminal view controls` | Controles de la vista del terminal | Not applied |
| `sessiontable.model.none` | Ningún modelo | Not applied |
| Hyphenation of the product name | He writes `Gentle-Shell`; the catalogue already ships `Gentle Shell` | **Unresolved** — must not ship two spellings of the same product in one screen |

Open question for whoever picks this up: **hyphen or space**. Everything already committed says
`Gentle Shell` (no hyphen). His handwritten review says `Gentle-Shell`. Pick one before applying
the 24 strings, or the interface ends up with both.

Also still open, and blocking one item: does root `src/` (the bridge) fall inside translation
scope? `src/git-changes.ts:124` stays hardcoded English until that is answered.

---

## F. "Pi" → "Gentle Shell" — los 12 literales incrustados (revisión pendiente)

De los comentarios del canvas: *"Reemplazar Pi por Gentle Shell"*. No están en el catálogo:
son literales incrustados en los componentes, así que tampoco traducen. **Nada aplicado.**

| # | Fichero:línea | Inglés actual | Propuesta castellano | Dónde se ve |
|---|---|---|---|---|
| 1 | `AskSheet.svelte:24` | Pi is asking | Gentle Shell está preguntando | Título del panel, tipo `companion` |
| 2 | `AskSheet.svelte:25` | Pi is asking | Gentle Shell está preguntando | Título del panel, tipo `tool` |
| 3 | `AskSheet.svelte:28` | Pi needs input | Gentle Shell necesita tu respuesta | Título del panel, tipo `input` |
| 4 | `AskSheet.svelte:147` | Question from Pi | Pregunta de Gentle Shell | Texto solo para lectores de pantalla |
| 5 | `AskSheet.svelte:8` | *(comentario de código)* Pi's questions | *no se traduce* | — |
| 6 | `TerminalPopup.svelte:63` | Pi popup | Ventana de Gentle Shell | Título del popup |
| 7 | `TerminalPopup.svelte:63` | Connected to your terminal / Waiting for connection | Conectado a tu terminal / Esperando conexión | Estado del popup |
| 8 | `TerminalPopup.svelte:69` | …just like in Pi. | …igual que en Gentle Shell. | Texto de ayuda |
| 9 | `TerminalPopup.svelte:112` | Send text to Pi | Enviar texto a Gentle Shell | Etiqueta del campo |
| 10 | `AutomationFlow.svelte:38` | Pi task | Tarea de Gentle Shell | Tipo de paso en el diagrama |
| 11 | `AutomationFlow.svelte:64` | Pi | Gentle Shell | Cabecera del nodo |
| 12 | `AutomatedSessionBadge.svelte:4` | Started by an automation. You can answer Pi's questions, but cannot steer, plan, or upload files. | Iniciada por una automatización. Puedes responder a las preguntas de Gentle Shell, pero no dirigirla, planificar ni subir archivos. | Tooltip del badge |

**Y uno más que no es "Pi" pero pide el mismo tratamiento:**
`AutomatedSessionBadge.svelte:4` muestra también el texto visible `Automated · answers only` →
propuesta **`Automatizada · solo respuestas`**.

### Cuatro decisiones que necesito de ti

1. **"Pi" a secas → ¿"Gentle Shell" siempre?** En el #11 la cabecera dice solo `Pi`. Traducirlo a
   "Gentle Shell" deja una cabecera larga en un nodo estrecho. ¿O prefieres dejarlo corto ahí?
2. **Los #1 y #2 tienen el mismo texto** (`Pi is asking`) para dos orígenes distintos. ¿Se quedan
   iguales o quieres diferenciarlos ahora que se tocan?
3. **El #5 es un comentario de código**, no texto de interfaz. Lo dejaría como está salvo que
   quieras coherencia también ahí.
4. **Esto son 12 cambios en 5 componentes** que además necesitan claves nuevas de i18n. ¿Los quieres
   todos juntos en un commit, o solo los visibles al usuario (#1-4, #6, #8-12) y el resto después?

**Riesgo si se aplica sin mirar:** `TerminalPopup` y `AskSheet` son los dos componentes cuya
redacción quedó pendiente de tu revisión. Meter las claves sin que las leas repetiría lo de la
lista anterior: traducir primero y corregir después.

---

## G. Preguntas del agente y de seguridad — sin traducir

Anotado por Ricardo: *"las preguntas del agente/seguridad hay que traducirlas"*.

**Dónde está:** `ui/src/lib/AskSheet.svelte:23-29`, el `sourceLabel` que titula el panel
cuando el agente pide algo. Son cinco literales, ninguno pasa por `t()`:

| Origen | Inglés actual | Propuesta castellano | Cuándo aparece |
|---|---|---|---|
| `companion` | Pi is asking | Gentle Shell está preguntando | Pregunta de Companion |
| `tool` | Pi is asking | Gentle Shell está preguntando | Pregunta de una herramienta |
| `select` | Choose an option | Elige una opción | Selección genérica |
| **`confirm`** | **Confirm** | **Confirmar** | **Confirmaciones — incluidas las de seguridad** |
| `input` | Pi needs input | Gentle Shell necesita tu respuesta | Entrada libre |

### Por qué importa más que las otras

`confirm` es la etiqueta que ve el usuario cuando el agente le pide **autorizar algo**. Hoy
dice solo `"Confirm"`, sin traducir y sin decir qué se confirma. Si esa pregunta es de
seguridad —conceder acceso, aprobar una acción— el usuario decide en un idioma que no es el
suyo y sobre una palabra que no explica el alcance.

**Hay una decisión de producto detrás, no solo de idioma:** una confirmación de seguridad
debería decir *qué* autoriza, no solo "Confirmar". El texto genérico vale para una acción
cualquiera; para un permiso, el usuario necesita saber qué concede antes de aceptar.

### Lo que falta para aplicarlo

1. Confirmar que `confirm` solo se usa para preguntas del agente, o también para permisos.
2. Decidir si las etiquetas genéricas valen para confirmaciones de seguridad, o si esas
   necesitan un texto propio que nombre lo que se autoriza.
3. Añadir las cinco claves a `en` y `es` y sustituir el `Record` literal.

Nada aplicado. Va con el bloque §F (los doce "Pi" incrustados), que comparte el mismo
problema: texto de interfaz que nunca pasó por el catálogo.
