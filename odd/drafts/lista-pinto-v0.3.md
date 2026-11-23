---
type: Draft
title: "Lista de correcciones para la GUI — v0.3 consolidada"
description: "Borrador de trabajo con las 27 correcciones detectadas en la GUI de gentle-companion, las respuestas de Ricardo punto por punto y cuatro correcciones verificadas contra el código. Fuente de información sobre qué se pidió y por qué."
tags: [borrador, todo, gui, i18n, bridge, gentle-companion]
status: active
author: "ORQ v0.1"
revised: "Ricardo v0.2 · ORQ v0.3"
generated: 2026-11-23
version: 0.3
supersedes: /tmp/lista-pinto.md (v0.1, sin OKF, no versionada)
---

# Lista de correcciones para la GUI — v0.3

> **Por qué existe este documento.** Es un borrador, no un informe. Se guarda
> porque explica **qué se pidió y por qué**, y eso no se reconstruye desde el
> código. v0.1 vivió en `/tmp` sin OKF: corregido por indicación de Ricardo
> (2026-11-23), los artefactos intermedios también se versionan.

**Cómo leerlo.** Cada punto lleva *Lo que llegó* (cita textual de Ricardo),
*Lo verificado* (evidencia de código con `ruta:line`) y *Decisión pendiente*
(lo que no puede resolver PINTO solo). Los puntos marcados ✅ VERIFICADO
tienen causa localizada; los marcados ⬜ TODO no tienen aún contenido suficiente.

---

## Correcciones a v0.1 verificadas en esta ronda

Cuatro afirmaciones de v0.1 resultaron incompletas o falsas. Se registran porque
el valor del borrador está en no repetir el razonamiento fallido.

| # | Lo que decía v0.1 | Lo que dice la evidencia |
|---|---|---|
| 3 | "43721 es admin, no sirve para emparejar" | **Falso.** `local_router` (`server/src/main.rs:610`) sirve `/api/pairing/start` en 43721. Ricardo tenía razón: ahí **se ofrece** el emparejamiento; 43722 es lo que consumen los clientes |
| 14 | "puede ser una race condition" (dicho por Ricardo) | **Falso.** `sessiontable.*` no existe en **ningún** chunk servido (60 descargados y comprobados) ni en el fuente. Es determinista |
| 2 | "solo hay 409" | **Incompleto.** Reproducido 409 con `curl`. Pero Ricardo vio también **403**, y su origen es distinto: el adjunto que sube el usuario, no el fichero de sesión |
| 27 | "el 403 es hipótesis" | **Confirmado que existe**, con causa propia (ver punto 27) |

---

## 1. ⬜ Comandos de la TUI alineados con la consola

**Lo que llegó (v0.1):** "Añadir los comandos de la TUI para estar alineados."

**Ricardo (v0.2):** *"Alineados con los que se usan en consola, en la TUI, lo ideal es
que sean los mismos que se permiten por consola; al fin y al cabo companion es un
retransmisor. La lista hay que sacarla de gentle-shell, lo que no sé exactamente la
función, si eso lo miro (idea: activar MCP a devin, deepwiki.com, o preguntarle vía
web, lo podéis hacer vosotros o ya os lo miro)."*

**Lectura:** companion **retransmite**; el catálogo de comandos autoritativo vive en
gentle-shell. La tarea es: obtener la lista real desde gentle-shell, compararla con la
que la TUI expone, y cubrir la diferencia.

**Decisión pendiente:** ¿quién obtiene la lista (vosotros o Ricardo)?

---

## 2. ✅ VERIFICADO — 409 en `bridge/file` y la UI que lo vuelca a consola

**Lo que llegó:** trazas de consola con `POST .../bridge/file 409 (Conflict)`.

**Reproducido por ORQ** (sesión `01a1f448`, dos referencias distintas):

```
POST /api/sessions/01a1f448-.../bridge/file  →  409
"Pi is not connected for this session. Start it again to use the bridge."
```

Causa: `server/src/bridge.rs:506` — `ensure_pi_connected` corta **antes** de evaluar el
fichero. Ni siquiera llega al guard de mención.

**Defecto real:** `ui/src/lib/companion.svelte.ts:618` no distingue el 409. El estado se
tira a consola (`window.fetch`, `request`, `bridgeFile`) en lugar de mostrarse.

**Esperado:** no ofrecer adjuntar en sesión parada, o mostrar "esta sesión está parada,
arráncala" con acción.

---

## 3. ✅ VERIFICADO — Superficies y puertos: 43721 ofrece, 43722 consume

**Ricardo (v0.2):** *"el servidor escucha en el 43721 para ofrecer dispositivos, los
clientes en el 43722. Podéis comprobarlo: 192.168.2.11:43722, o conectaros por ssh y
probarlo contra localhost."*

**Verificado y confirmado:**

| Router | Dirección | Contenido |
|---|---|---|
| `local_router` (`main.rs:590`) | `127.0.0.1:43721` (`main.rs:57`) | `/api/pairing/start` (`main.rs:610`) — **aquí se genera la oferta** |
| `remote_router` (`main.rs:630`) | `0.0.0.0:43722` (`main.rs:60`) | superficie de dispositivo |

**Síntoma en ricardoPC:** el enlace de emparejamiento muestra `127.0.0.1`, así que no
acepta conexiones externas.

**Lo que falta:** que el enlace generado apunte a la **IP de LAN en 43722**, más
`PI_COMPANION_ALLOWED_ORIGINS`. Precedente funcionando en ricardoHP:
`publicUrl = http://192.168.2.20:43722` por drop-in de systemd.

**No es código de PINTO:** es configuración de máquina.

---

## 4. ✅ VERIFICADO — "Variables sin asignar": claves crudas en pantalla

**Ricardo (v0.2):** *"Sí, ese es el fallo, aparecen las variables en vez del valor,
después he remirado pero no parecía el error, quizás es alguna race condition, puede
esperar y ya verificaremos si se repite mucho."*

**Corrección a la hipótesis de race condition — no hay carrera:**

```bash
# 60 chunks descargados del daemon y comprobados
grep -l 'sessiontable\.th\.session' *.js   →  NINGUNO
grep -l 'session\.detail\.shared'  *.js    →  cPS82xEN.js   (control: el método funciona)
```

`sessiontable.*` **no existe** en el catálogo (`ui/src/lib/i18n.svelte.ts`, 0
apariciones) **ni en ningún bundle servido**. Es determinista: la tabla de sesiones
siempre muestra sus claves. Ver punto 22 para el alcance completo (38 claves).

---

## 5. ⬜ Paneles emergentes movibles

**Ricardo (v0.2):** *"Todos los paneles emergentes son fijos, y por lo menos a mí me
gusta que se puedan mover, para mirar lo que hay debajo y poder referenciarlo… yo es que
tengo muy mala cabeza. No es prioritario, ni secundario."*

**Alcance:** los `<dialog>` del companion son estáticos. Añadir arrastre (y
posiblemente redimensionado) opcional.

**Prioridad:** explícitamente no urgente. Última de la lista.

---

## 6. ✅ VERIFICADO — Sesiones archivadas: verlas y poder reabrirlas

**Ricardo (v0.2):** *"Yo lo entiendo igual que las finalizadas, y así habría que
tratarlas. ¿Qué sentido tiene archivarlas y no poder verlas? ¡Para eso está la
papelera! Y las finalizadas deberían tener la opción de poder reabrirse."*

**Verificado en código:**

- `server/src/main.rs:1215` — comentario explícito: **"No filesystem operation is
  performed by archiving."**
- `main.rs:1213-1216` — `sessions.remove()`, borra actividad, revoca bridge, difunde
  `session.removed`. **Solo desaparece del registro del daemon.**
- El `.jsonl` de Pi **sigue en disco**, intacto.
- `auto_archive` (`main.rs:1227`) archiva a los **7 días** de `disconnectedAt`.

**Conclusión:** el archivo existe (los ficheros), pero para el daemon la sesión ya no
existe. Verlas exige listar el directorio de sesiones, no filtrar la lista actual.

**Decisión pendiente:** papelera con restauración (propuesta de Ricardo) frente a
archivo sin restauración. Ricardo: *"mientras tengamos sitio lo guardamos todo."*

---

## 7. ⬜ Coste del proveedor como "no informado" y moneda ajustable

**Ricardo (v0.2):** *"Sí, es un tema para CONTA y PINTO, los datos están, ya lo miraremos,
y vía web se pueden bajar los CSV si hiciera falta. Lo de la moneda ya es otra historia:
debería ser ajustable por el usuario, ya que la aplicación se usará en Europa, América…
y la unidad podría ser diferente: euros, dólares, yenes, dinares…"*

**Ficheros con lógica de coste:** `ui/src/lib/DotField.svelte`,
`ui/src/routes/sessions/[id]/+page.svelte`, `ui/src/routes/settings/+page.svelte`.

**Dos trabajos separados:** (a) que el dato se muestre cuando existe, (b) moneda
configurable por el usuario.

**Nota:** (b) toca formato, conversión y persistencia de preferencia. Issue propio.

---

## 8. ✅ VERIFICADO — La app muestra MIT; debe ser AGPL-3

**Ricardo (v0.2):** *"Sí, perdona: en la app, aunque sí enlaza al repo, pone que es MIT.
Hay que cambiarlo (o quitarlo), pero yo opto por dejarlo puesto y visible AGPL 3, por si
no hubiera conexión con el repo, o incluso servir la licencia directamente como fichero."*

**Verificado:** `LICENSE:1` **ya es** GNU Affero General Public License. El defecto está
en la UI, que declara MIT y enlaza al repo.

**Decisión tomada por Ricardo:** dejarlo visible **y** servir la licencia como fichero
(no depender del enlace).

---

## 9. ✅ VERIFICADO — Logo de la rosa: transparencia y +5 %

**Ricardo (v0.2):** *"Me refiero al logo de la página principal, arriba a la izquierda:
hay una rosa pero con el fondo oscuro (`assets/gentle-logo.DHmQOaFm.png`). Hay que
ponerle fondo transparente y que aparezca un poco más grande; no es problema porque la
imagen es muchísimo más grande."*

**Fichero identificado:** `assets/gentle-logo.DHmQOaFm.png` — resuelto, ya no hay
ambigüedad.

**Advertencia que sigue en pie:** `logo-gentle.svg` **no es la rosa, es la π**. PINTO ya
lo corrigió una vez: re-rasterizar desde ese SVG habría sustituido el arte del producto.
**Trabajar sobre el PNG, no sobre el SVG.**

**Riesgo conocido:** regresión de canal alfa (`srgb opaque=true`) que en iOS borraba el
9,9 % del dibujo. Al hacer transparente, **verificar el alfa explícitamente**.

---

## 10. ⬜ Repasar la guía de instalación y emparejamiento

**Ricardo (v0.2):** *"Eso es solo repasar la guía, porque falta completar mejor los
pasos. Ej.: en emparejar pone 'Ejecuta /companion en Gentle Shell para compartir la
sesión actual con dispositivos emparejados:' acabado en 2 puntos pero no pone ningún
ejemplo. Entiendo que es añadir un QR o el código, por eso digo lo del punto 11."*

**Comandos publicados:** `README.md:52,60,138` → `gentle-shell install
npm:@rgaricano/gentle-companion`; `README.md:56` → `gentle-shell install
git:github.com/IAI-00-IAI/gentle-companion`.

**Hallazgo de v0.1 que se mantiene:** `gentle-shell install` **reenvía a `pi install`**.
Sin origen, el error que ve el usuario dice `Usage: pi install <source>`, no
`gentle-shell install`. Coherencia de superficie.

---

## 11. ⬜ Emparejamiento: falta QR, código y URL https

**Lo que llegó (v0.1):** "Faltan detalles de cómo emparejar (QR, código, url https…)."

**Ampliado por Ricardo en el punto 10:** la guía se corta en dos puntos sin ejemplo.

**Lo que falta:** QR escaneable, código alternativo, cuándo aplica `https` frente a
`http`, caducidad del enlace, y qué hacer si no conecta.

**Contexto verificado:** puertos y roles en el punto 3.

---

## 12. ⬜ Cómo arrancar el demonio, en un solo sitio

**Lo que llegó (v0.1):** "Faltan el comando para arrancar el demonio."

**Comandos reales:** `npm run daemon:service:install|uninstall|status`
(`README.md:82`); `node tools/daemon-service.mjs …` (`README.md:75`) con
`--binary <path>`; manual `gentle-companion-server` (`README.md:66`) solo para
desarrollo o con `PI_COMPANION_AUTOSTART=0`.

**Falta:** que un usuario no tenga que leer tres secciones. Y la nota de que el servicio
corre con privilegios de usuario, no root (`README.md:152`), con lingering en Linux.

---

## 13. ⬜ Enlace a gentle-shell en la página principal (Resumen)

**Lo que llegó (v0.1):** "Añadir enlace a gentle-shell, en la página principal
(Resumen), destacado pero sin subrayado."

**URL decidida por Ricardo (v0.2):** *"Sí, habría que enlazar a la web:
https://gentlemanprogramming.com/"*

**Pendiente de diseño:** qué significa "destacado sin subrayado" (color de acento, peso
tipográfico, botón).

---

## 14. ✅ VERIFICADO — Tabla de sesiones: muestra claves crudas (duplicado de 22)

Ricardo apuntó el fragmento del DOM:
`sessiontable.th.sessionsessiontable.th.workspacesessiontable.th.modelsessiontable.th.status`

**No era HTML mal copiado: era la tabla renderizando sus claves.** Ver punto 22, que
contiene el alcance completo (38 claves) y el comando de detección.

**Cabeceras actuales:** Session · Workspace · Model · Status (+ actions con `sr-only`),
en `ui/src/lib/SessionTable.svelte:17`.

**Pendiente:** qué columnas se quieren realmente. Con las claves rotas arregladas, la
tabla dirá "Sesión · Espacio · Modelo · Estado" — y ahí se ve si falta alguna.

---

## 15. ⬜ `Variables sin asignar:` — cubierto por el punto 4

---

## 16. ⬜ Retirar/editar mensajes en espera (como Alt+flecha en la TUI)

**Ricardo (v0.2):** *"Yo pensaba como en la TUI, que si se escribe mientras respondéis se
queda en cola y si pulsas Alt+flecha lo recuperas y vuelve al cuadro de texto, donde lo
puedes reeditar, borrar… como si no lo hubieras enviado; vamos, lo que sería
desencolarlo."*

**Comportamiento objetivo, concretado:** escribir mientras el agente responde → el
mensaje queda **en cola**. `Alt+flecha` lo **recupera al composer** para reeditarlo o
borrarlo, como si no se hubiera enviado.

**Ventana de concurrencia:** entre "el mensaje sale" y "el usuario lo retira". Si ya se
entregó, la acción no debe existir. **Requiere decisión explícita, no improvisación.**

**Riesgo:** concurrencia. Issue propio con su test.

---

## 17. ⬜ Reemplazar "Pi" por "gentle-shell" en mensajes y notas

**Ricardo (v0.2):** *"Es solo cambiar Pi por gentle-shell, una tontería. Lo he puesto
solo para documentarlo y hacer notar que eso se tenía que haber hecho cuando se dijo:
reemplazar todas las referencias a Pi por gentle-shell."*

**Texto afectado (sección staged):** *"Only recorded session edits and applied Pi Jar
subagent files are shown. Shell-only edits or delegates without an applied-file report
may be missing; shared files can include other changes."*

**Ojo:** la frase describe tres limitaciones reales (solo ediciones registradas y
ficheros de subagente aplicados; puede faltar lo *shell-only*; ficheros compartidos
pueden traer cambios ajenos). Al renombrar hay que **conservar las tres**.

**Barrido previo**, para no dejar la UI a medias entre dos nombres:

```bash
grep -rn "Pi Jar\|Pi jar\|Shell-only\|Shell only" --include=*.svelte --include=*.ts ui/src
```

---

## 18. ⬜ Traducir "Staged/Unstaged" en el registro de cambios

**Ricardo (v0.2):** *"Sí, son definiciones particulares, pero es que el que no sabe
inglés aún se entera menos. Podemos usar Listo/Borrador, Lista para enviar… La idea es
que como estamos usando i18n, aunque no se traduzca inmediatamente, sí que esté
preparado y ya lo traduciremos o modificaremos si surge algo mejor."*

**Decisión de Ricardo:** **preparado en i18n desde ya**, traducción afinable después.

**Criterio pendiente:** "Unstaged" no es "no preparado" — en git significa *fuera del
índice*. La opción de Ricardo (Listo/Borrador) evita el tecnicismo y es la elegida.

---

## 19. ⬜ Panel de vista previa: opción de "decoración" (render markdown/HTML simple)

**Ricardo (v0.2):** *"No tiene que ser inmediato. Yo en otros proyectos he usado
librerías de JavaScript/TypeScript y de Python, tendría que mirarlo. Tampoco hace falta
ninguna muy compleja. Si no lo veis claro, a la lista y para la siguiente release."*

**Decisión:** **no entra en esta release.** Queda registrado.

**Cuatro decisiones que habrá que tomar**, por seguridad de contenido no confiable:
apagado por defecto · sin scripts ni `on*` ni `javascript:` (lista de permitidos, no de
prohibidos) · sin recursos remotos (fuga por imágenes) · aislamiento respecto al origen
del companion.

**Choque conocido:** el puente **no soporta service workers** (`server/src/bridge.rs:1521`).
Si la decoración necesita worker, no hay por dónde.

---

## 20. ⬜ Traducir tooltips, `aria-label` y mensajes de botones

**Ricardo (v0.2):** *"Sí; si hace falta una lista con literales o más específico, lo
preparamos mañana. He ido apuntando rápido lo que he visto."*

**Por qué no es cosmética:** `aria-label` es lo único que lee un lector de pantalla. Un
botón con icono claro y `aria-label="Archive"` deja fuera a quien no ve el icono.

**Barrido** (deja solo los pendientes, sin castellano):

```bash
grep -rn 'aria-label=\|title="' --include=*.svelte ui/src \
  | grep -v 'aria-label="[^"]*[áéíóúñ¿¡]'
```

---

## 21. ⬜ Traducir los botones del panel de preview/descarga

**Ricardo (v0.2):** *"Exacto, son los botones que aparecen en el panel de preview/descarga
de ficheros; hay que traducirlos (también podría haberlo hecho yo, creo que he enlazado
el archivo fuente de Svelte)."*

**Resuelto:** no era funcionalidad nueva, es traducción. Pertenece al bloque i18n.

---

## 22. ✅ VERIFICADO — 38 claves i18n ausentes: la UI muestra claves crudas

**El defecto de mayor alcance de la lista.**

`t()` devuelve la clave cuando falta (`ui/src/lib/i18n.svelte.ts:1843`):

```ts
if (message === undefined) return key;   // sin excepción, sin hueco, sin undefined
```

**38 claves** pedidas en código y ausentes del catálogo (843 pedidas, 896 definidas):

| Área | N | Dónde se ve |
|---|---|---|
| `sessiontable.*` | 14 | Toda la tabla de sesiones |
| `session.detail.*` | 17 | Compartir, adjuntos, tareas, "thought", filtro, uploading |
| `settings.*` | 2 | Hint de pairing HTTPS, aria del scroll de uso |
| `shell.connection.*` | 2 | Estado offline, diagnóstico manual |
| `permissions.*` | 1 | Descripción del test de notificaciones |

Incluye `session.detail.share` y `session.detail.share.note` (el catálogo tiene
`session.detail.shared`, sin `.note`).

**Detección reproducible:**

```bash
grep -rhoP "t\('\K[a-zA-Z0-9._]+" ui/src --include=*.svelte --include=*.ts | sort -u > /tmp/pedidas
grep -oP "^\s*'\K[a-zA-Z0-9._]+(?=':)" ui/src/lib/i18n.svelte.ts | sort -u > /tmp/definidas
comm -23 /tmp/pedidas /tmp/definidas
```

**Test que falta:** `t()` debe fallar (o avisar en desarrollo) ante una clave
inexistente. Sin eso, la siguiente regresión es invisible.

---

## 23. ✅ VERIFICADO — Traducción comparando literales en inglés

`ui/src/routes/automations/[id]/+page.svelte:75`

```ts
if (value === 'Scheduling disabled') return t('automation.next.disabled');
if (value === 'No upcoming occurrence') return t('automation.next.none');
```

El servidor envía **texto en inglés**; el cliente lo reconoce comparando la cadena. Si
alguien cambia una palabra en el backend, el `if` no casa y se muestra el inglés crudo.
Síntoma: `Próxima` + `Scheduling disabled` mezclados.

Inconsistencia añadida en `:54`: compara `value.label` (propiedad) mientras el resto
compara `value` (cadena).

**Arreglo:** estado con identificador desde el servidor (`scheduling_disabled`,
`schedule_paused`) y `t('automation.next.' + state)`. **Toca Rust**, no solo UI.

---

## 24. ✅ VERIFICADO — Cadenas hardcodeadas en los paneles de automatizaciones

`ui/src/lib/AutomationFlow.svelte` — 8 cadenas que nunca pasaron por `t()`:

```
:30  aria-label="Automation execution phases"
:42  No steps configured
:43  View flowchart
:51  aria-label="Close flowchart"
:54  aria-label="Scrollable execution flowchart"
:68  If this {check|step} fails / If retries fail
:74  No steps in this phase. Continue directly.
:76  Cancellation stops all remaining steps, including finalizers.
```

Más 2 en `ui/src/lib/AutomationPagination.svelte`.

El catálogo no tiene **ninguna** clave de flowchart (`grep -i flowchart` → vacío).

---

## 25. ✅ VERIFICADO — Pies de página: hardcodeados y plural por ternario

`ui/src/lib/AutomationPagination.svelte:6-7`:

```
:6  {total} {total === 1 ? 'item' : 'items'} · Page {page} of {pages}
:7  aria-label="Previous page" … Previous  |  aria-label="Next page" … Next
```

**Tres defectos:** cadenas sin `t()` · plural resuelto con ternario en plantilla (no
traducible) · `aria-label` en inglés.

**Precedente que marca el camino** (`i18n.svelte.ts:717` y `:1615`): `sessions.showing`
pasa `{unit}` ya resuelto, con el plural decidido fuera del catálogo.

**Decisión pendiente:** mecanismo de plural compartido, o generalizar el patrón
`{unit}`. Entre las 38 claves rotas está `sessiontable.question.plural`: alguien empezó
un mecanismo y quedó sin terminar.

---

## 26. ✅ VERIFICADO — Vista previa: todo va a un iframe, y los SVG fallan

`ui/src/lib/BridgePreview.svelte:124` no tiene visores por tipo: **todo a `<iframe>`**
con `sandbox="allow-scripts allow-forms allow-modals"`.

Un SVG llega con `Content-Type: image/svg+xml` y `server/src/bridge.rs:1174` lo clasifica:

```rust
match essence.as_str() {
    "text/html" | "application/xhtml+xml" => Some(Rewrite::Html),
    "text/css"  => Some(Rewrite::Css),
    "text/javascript" | ... => Some(Rewrite::Script),
    _ => None,          // ← image/svg+xml cae aquí: no se reescribe
}
```

Sin reescritura, un SVG con rutas relativas, `<use xlink:href>` o fuentes embebidas
rompe: el iframe vive bajo `/bridge/…` y el SVG no fue reescrito para ese prefijo.
**Misma familia que el defecto C2 del canvas.**

**Arreglo que resuelve dos cosas:** `<img>` para SVG.
- Evita el problema de reescritura.
- **Cierra el sandbox**: un SVG en `<img>` no ejecuta scripts. Hoy, con
  `allow-scripts`, un SVG es documento ejecutable.

Resto: imagen → `<img>`, texto → `<pre>`, PDF → visor nativo, desconocido → descarga.

**Descarga, a revisar:** `Content-Disposition` con nombre sin escapar (inyección de
cabecera) · ¿se respeta el tipo o se fuerza `octet-stream`? · si re-rasteriza, cuidado
con el alfa (regresión `srgb opaque=true` ya vista).

---

## 27. ✅ VERIFICADO — El 403 del adjunto: subes un fichero y no puedes recuperarlo

**Ricardo (v0.2):** *"He visto los dos: uno en las descargas (409) y el 403 en lo último
que he adjuntado."*

**Causa localizada.** `bridge_file` exige prueba de mención del **agente**
(`server/src/bridge.rs:669`):

```rust
async fn require_file_mention(...) {
    let activity = state.activity.read().await;
    let mentioned = candidates.iter().any(|c| activity.mentions(session_id, c, MentionKind::Path));
    if mentioned { return Ok(()); }
    Err((StatusCode::FORBIDDEN, "Only files the agent mentioned in this session can be fetched."))
}
```

Un fichero **subido por el usuario** no lo mencionó el agente → **no se puede volver a
descargar**. Defecto de diseño evidente: se sube y no se recupera.

**Y el guard depende de estado en memoria.** `ActivityStore` (`server/src/activity.rs:135`)
es `HashMap`, sin persistencia:

```rust
pub struct ActivityStore { logs: HashMap<String, ActivityLog> }   // no hay activity.json
```

`archive` lo borra (`main.rs:1214`), y **cualquier reinicio del daemon** borra el de
todas las sesiones.

**Tercer efecto:** `authorize_endpoint` (`bridge.rs:1033`) **revoca el endpoint** cuando Pi
se desconecta; un enlace abierto muere aunque el usuario esté mirándolo.

**Opciones para el caso histórico:**

| Opción | Coste | Riesgo |
|---|---|---|
| A. Persistir `ActivityStore` completo | Fichero + formato | **Alto**: contiene texto de conversación |
| B. Reconstruir menciones del `.jsonl` | Parseo bajo demanda | Lento; formatos raros |
| C. **Persistir solo rutas mencionadas** | Índice pequeño | Bajo: el guard necesita rutas, no conversación |

**Recomendación de ORQ: C.** El guard necesita saber *que* una ruta se mencionó, no el
texto.

**Riesgo alto:** `require_file_mention` **es el guard que cierra el path traversal** ya
arreglado (5 tests). Relajarlo mal reabre el agujero.

**Tests exigibles:**
- sesión histórica descarga fichero **mencionado** → OK
- sesión histórica pide fichero **nunca mencionado** → 403
- cualquier sesión pide `/etc/passwd` o `../../` → 403
- **fichero subido por el usuario se puede descargar** → OK (defecto nuevo)
- tras reiniciar el daemon, los casos anteriores siguen iguales

---

## Clasificación para el reparto

**Riesgo alto — issue propio, con tests:**
- **16** concurrencia (retirar mensajes en cola)
- **19** renderizado de contenido no confiable (aplazado por Ricardo)
- **26** SVG + sandbox del iframe
- **27** guards de bridge, 403 del adjunto, historial en memoria

**Subsistema i18n — un solo issue con tres clases de fallo:**
- **17, 18, 20, 21, 22, 24, 25** y el mecanismo de plural
  (claves ausentes · cadenas sin `t()` · mapeo por literal inglés)

**Toca Rust, no solo UI:**
- **23** estado con identificador desde el servidor
- **27** persistencia de rutas mencionadas

**Configuración de máquina (no es PINTO):**
- **3** `publicUrl` y origen permitido en ricardoPC

**Doc y onboarding:**
- **10, 11, 12, 13**

**Cosmética / cuando haya hueco:**
- **5** paneles movibles · **8** AGPL visible · **9** logo · **14** columnas

**Fuera de esta release (decidido por Ricardo):**
- **19** decoración markdown/HTML

---

## Log de revisiones

- **v0.1** (ORQ) — enumeración inicial a partir de los reportes en conversación.
  Vivió en `/tmp/lista-pinto.md`, sin OKF ni versionado.
- **v0.2** (Ricardo) — respuestas punto por punto, correcciones de contexto (puertos,
  logo, licencia, moneda, archivado), y decisión de aplazar el punto 19.
- **v0.3** (ORQ) — consolidación: cuatro correcciones verificadas contra código
  (puntos 3, 4, 2 y 27), causa localizada del 403 del adjunto, clasificación por
  riesgo y reparto, y OKF + versionado por indicación de Ricardo.
