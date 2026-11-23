---
type: Borrador 
title: "Lista de Correcciones  para realziar en la GUI"
description: "Lista de Correcciones  para realziar en la GUI. Mayormente traducciones incompletas y alguna funcionalidad a añadir"
tags: [borrador, paraHAcer, ToDo, GUI, gentle-companion]
status: active
Author: ORQ v0.1
Revised: Ricardo v0.2
generated: 2026-11-23 01:35
---

# Lista para PINTO — borrador de ORQ

Estado: **parcial**. Los puntos 2 y 3 están diagnosticados; el 1 y el 4 llegaron sin contenido.
Ricardo: completa los huecos marcados con `TODO:` y avísame.

---

## 1. TODO: Comandos de la TUI alineados

**Lo que llegó (textual):** "Añadir los comandos de la TUI para estar alineados."

**Falta saber:**
- Alineados ¿con qué? ¿Con los de Pi upstream? ¿Con docs? ¿Entre superficies (TUI / web / companion)?
- ¿Qué comandos faltan exactamente, o cuáles están desalineados hoy?
- ¿Hay lista de referencia en algún sitio?
-
Ricardo:
Alineados cn los que se usan en consola, en la TUI, lo ideal es que sean lo mismos que se permiten por consola, al fin y al cabo comanion es un retransmisor*
La lista hay que sacarla de la gentle-shell, lo que no se exactamente la funcion, si eso lo miro (idea: aactivar mcp a devin, deepwiki.com, o preguntarle via web, lo podeís hacer vosotros o ya os lo miro)
---

## 2. Bridge devuelve 409 y la UI lo vuelca a consola

**Diagnóstico cerrado. Backend correcto, cliente deficitario.**

Traza observada:

```
POST http://127.0.0.1:43722/api/sessions/01a1f448-.../bridge/file  409 (Conflict)
[companion:req] .../bridge/file FAILED: Pi is not connected for this session. Start it again to use the bridge.
```

Causa: `server/src/bridge.rs:511` — `ensure_pi_connected` rechaza sesiones con
estado `stopped` o `disconnected`. La sesión `01a1f448` (Bonsai2) tiene su jsonl en
disco pero ningún proceso Pi vivo detrás. **El 409 es correcto.**

Defecto real: el cliente no trata ese estado conocido.

- `ui/src/lib/companion.svelte.ts:618` llama a `bridgeFile` sin distinguir 409.
- El error acaba en consola (`window.fetch @ CF1Ay7e7.js:2`, `request @ ZXIVJROg.js:10`,
  `bridgeFile @ ZXIVJROg.js:10`) en vez de en pantalla.
- Consecuencia: Ricardo ve un fallo sin explicación.

**Esperado:** detectar sesión parada y (a) no ofrecer adjuntar, o (b) mostrar
"esta sesión está parada, arráncala" con acción para arrancarla.

**Cómo reproducir:** parar la sesión, intentar adjuntar un fichero desde la UI.
**Cómo comprobar que el backend está bien:** arrancar la sesión; el 409 desaparece.

---

## 3. Daemon inalcanzable desde fuera en ricardoPC

**No es código: es configuración de máquina. Puede que no sea de PINTO.**

Dos síntomas distintos, mismo hueco:

| Puerto | Error | Lectura |
|---|---|---|
| 43722 | `409 Conflict` con mensaje del servidor | Llegó al daemon. Sesión parada (punto 2) |
| 43721 | `Obtener no ha podido cargar` (fallo de red) | **No hay servicio en ese puerto** |

Lo reportado por Ricardo: en ricardoPC el enlace de pairing muestra `127.0.0.1`,
así que no acepta conexiones externas.

**Lo que falta:** `publicUrl` (y el puerto correcto) apuntando a la IP de ricardoPC,
más el origen permitido.

**Precedente en ricardoHP** (funcionando): `publicUrl = http://192.168.2.20:43722`
y `PI_COMPANION_ALLOWED_ORIGINS` por drop-in de systemd. Origen ajeno sigue dando 403.

**Verificar primero** (no asumir):

```bash
ss -ltnp | grep -E '4372[0-9]'
```

Si solo escucha 43722, todo lo que apunte a 43721 está muerto por configuración.

--
Ricardo: el servidor escucha en el 43721 para ofrecer dispositivos, los clientes en el 43722, 
podeís comprobarlo: 192.168.2.11:43722, o conectaos por ssh y lo probaís contra localhost

---

## 4. TODO: "Variables sin asignar:"

Llegó el encabezado, nunca el cuerpo. Contenido desconocido.

-
Si, ese es el fallo, aparecen las variables en vez del valor, despúes he remirado pero no parecía el error, quizás es alguna race condition, puede esperar y ya verificaremos si se repite mucho.

---

## 5. TODO: Paneles flotantes

**Lo que llegó (textual):** "- paneles flotantes"

**Falta saber:** qué falla o qué falta. ¿No flotan? ¿Se solapan? ¿No se pueden
mover/cerrar/redimensionar? ¿Afecta a móvil, escritorio o ambos?
Todos los paneles emergentes son fijos,y por lo menos a mi me gusta que se puedan mover, para mirar lo que hay debajo y poder referenciarlo...yo es que tengo muy mala cabeza!!!, no es prioritario, ni secundario,...

---

## Contexto de entorno que puede cambiar decisiones

- **Dos raíces de estado compitiendo**, y es el problema de fondo del punto 3:
  - `~/.pi/agent/sessions` → 110 ficheros
  - `~/.gentle-shell/agent/sessions` → 73 ficheros
  - `43722` lo sirve `gentle-companio` pid 2323; tailcat pid 2482 usa la clave de `~/.pi`
  - La sesión de Bonsai2 vive en `.gentle-shell`, pero el daemon referencia `.pi`
- **Sesión de ORQ:** 7 MB, 2.380 eventos. Sesión de Bonsai2: 4,3 MB, 382 eventos.
  El TUI va lentísimo con estos volúmenes; sospecha razonable, **sin medir**.
- **Mudanza a ricardoPC en curso**, espejada por Ricardo sin INFRA. Reparto de repos
  en discos: **pendiente de INFRA**, no de PINTO.

---

## 6. Sesiones archivadas: ¿dónde van y se puede acceder?

**Verificado por ORQ en `server/src/main.rs`.** La petición de Ricardo: verificar dónde
van y si hay acceso al archivo; si no existe, añadir acceso en *Sesiones → Estado*.

Lo que hace hoy el archivado:

- `main.rs:1215` — comentario explícito: **"No filesystem operation is performed by archiving."**
- `main.rs:1213-1216` — `sessions.remove()`, borra actividad, revoca el bridge, difunde
  `session.removed`. **Solo desaparece del registro del daemon.**
- El `.jsonl` de Pi **sigue en disco**, intacto, en su directorio de sesiones.
- `auto_archive` (`main.rs:1227`) archiva automáticamente pasadas **7 días** desde
  `disconnectedAt`, y solo si la sesión está `stopped`/`disconnected`.
- Solo se puede archivar lo desconectado (`main.rs:1208`), nunca una sesión viva.

**Conclusión:** el archivo *existe* (los ficheros) pero **no hay UI para verlo**, porque
para el daemon la sesión archivada ya no existe. Añadir acceso significa decidir antes:
¿se listan los jsonl del directorio de sesiones aunque el daemon no los tenga en registro?
Eso es una vista nueva sobre el sistema de ficheros, no un filtro de la lista actual.

Ricardo: Yo lo entiendo igual que las finalizadas, y así había que tratarlas, ¿que sentido tiene archivarlas y no poder verlas? ¡para eso está la papelera!!!, y las finalizadas deberian tener la opción de poder reabrirse.

---

## 7. Coste del proveedor aparece como "no informado"

**Lo que llegó (textual):** "En Uso/consumo/costo del proveedor, hay que verificarlo y
añadirlo, si que existe pero aparece como no informado, coste->$ o €"

Hay tres ficheros con lógica de coste: `ui/src/lib/DotField.svelte`,
`ui/src/routes/sessions/[id]/+page.svelte`, `ui/src/routes/settings/+page.svelte`.

**Falta saber:** ¿el dato no llega del proveedor, o llega y la UI no lo pinta? Son dos
arreglos distintos. Y decidir moneda: `$` o `€` (afecta a formato y a conversión).

Ricardo: si, es un tema para CONTA y PINTO, los datos esstán, ya lo miramos, y via web se pueden bajar los csv si hiciera falta, lo de la moneda ya es otra historia, debería ser ajustable por el usuario, ya que la aplicación se usará en europa, america,...y la unidad podría ser diferente euros, dolares, yenes,dinares,,.

---

## 8. Licencia: AGPL-3 no reflejada en la app

**Lo que llegó (textual):** "La licencia no se ha corregido en la app: es AGPL 3"

El fichero `LICENSE` **sí es** GNU Affero General Public License (verificado, línea 1).
Lo que falta es corregirlo **en la app**: probablemente un texto de UI o metadatos
(`package.json`) que dicen otra cosa.

**Falta saber:** dónde aparece mal exactamente (¿footer? ¿pantalla Acerca de? ¿metadatos?).
Si es la vista Acerca de, es texto; si son `package.json`/`Cargo.toml`, son metadatos y
puede afectar a publicación.

RICARDO: Si, perdona, en la app, aunque si que enlaza al repo,  pone que es MIT, hay que cambiarlo (o quitarlo), pero yo opto por dejarlo puesto y visible AGPL 3, por si no hubiera conexion con el repo, o incluso directamente servir la licencia directamente como fichero
---

## 9. Logo de la rosa: quitar fondo y agrandar 5%

**Lo que llegó (textual):** "Quitar el fondo del logo de la rosa y agrandarla un 5%"

**Advertencia de ORQ, por un error previo:** `logo-gentle.svg` **no es la rosa, es la π**.
PINTO ya lo corrigió una vez: re-rasterizar desde ese SVG habría sustituido el arte del
producto. **Verificar qué fichero es la rosa antes de tocar nada.**

Relacionado y delicado: `icon-192.png` / `icon-512.png` los sirve `server/src/assets.rs:167-168`
y hay un test que fija la ruta. No borrar. Y ya hubo una regresión de canal alfa
(`srgb opaque=true`) que en iOS borraba el 9,9 % del dibujo: **si se quita fondo, revisar
el alfa explícitamente** en lugar de dejarlo al rasterizador.

Ricardo: Me refiero al logo de la pagina principal, a ariba a la izda, hay una rosa pero con el fondo oscuro (assets/gentle-logo.DHmQOaFm.png )
hay que ponerle fondo transparente y que aparezca un poco más grande, no es problema pq la imagen es muchisimo más grande
---

## 10. Probar que instala con el comando publicado

**Lo que llegó (textual):** "Probar que instala con el comando que se da:"

Los comandos que da el README:

- `README.md:52,60,138` → `gentle-shell install npm:@rgaricano/gentle-companion`
- `README.md:56` → `gentle-shell install git:github.com/IAI-00-IAI/gentle-companion`

**Prueba real, en entorno limpio** (no en el árbol del autor — regla aprendida ayer:
validar en clon fresco, encontró tres defectos invisibles):

1. Contenedor o usuario sin `~/.gentle-shell` previo.
2. Ejecutar literalmente cada comando del README.
3. Verificar: extensión cargada, daemon arrancado **sin** intervención manual,
   binario resuelto (orden documentado en `README.md:84`:
   `PI_COMPANION_SERVER` → `target/release` → `target/debug` → descarga cacheada → `PATH`).
4. Comprobar el caso que el README advierte: *"Package installation alone does not
   execute a downloader—Gentle Shell must load the extension once"* (`README.md:152`).
   Si un usuario instala y no reinicia la shell, ¿queda un estado a medias que parezca roto?

Ricardo: Eso es solo repasar la guia, porque falta completar mejor los pasos, ej.: en emparejar pone "Ejecuta /companion en Gentle Shell para compartir la sesión actual con dispositivos emparejados:" 
acabado en 2 puntos pero no pone ningún ejemplo, entiendo que es añadir un QR o el código,  por eso digo lo del punto 11.

---

## 11. Faltan detalles de cómo emparejar (QR, código, URL https)

**Lo que llegó (textual):** "Faltan detalles de como emparejar (QR, codigo url https,...detalles"

Es documentación **y** UI de onboarding. Hoy el usuario ve un enlace y no un procedimiento.

**Lo que falta documentar/implementar:**
- QR escaneable, no solo enlace de texto.
- Código de emparejamiento como alternativa al enlace.
- Cuándo aplica `https` y cuándo `http` (ver punto 3: en LAN es `http://IP:PUERTO`;
  el `https://192.168.2.20:43723` que probó Ricardo es superficie distinta).
- Caducidad del enlace/código y qué hacer si expira.
- Qué hacer si el dispositivo no conecta (los dos síntomas ya conocidos:
  409 por sesión parada, y fallo de red por puerto equivocado).

**Contexto verificado por ORQ** — puertos reales escuchando ahora mismo:

| Puerto | Bind | Rol |
|---|---|---|
| 43721 | `127.0.0.1` | superficie **admin** (loopback por diseño, `main.rs:57`) |
| 43722 | `0.0.0.0` | superficie **dispositivo** (`main.rs:60`) |
| 43723 | `0.0.0.0` | tercera superficie, servida por el mismo pid 2323 |

Esto explica el punto 3: `127.0.0.1` **es correcto en 43721** — es admin. El error fue
intentar emparejar contra el puerto admin. **El enlace de dispositivos debe salir en 43722
y con la IP de la LAN, no con la admin.** Verificar qué puerto usa el generador del enlace.

---

## 12. Cómo arrancar el demonio

**Lo que llegó (textual):** "Flt el comando para arrancar el demonio"

Comandos reales en el repo:

- `npm run daemon:service:install|uninstall|status` (`README.md:82`)
- `node tools/daemon-service.mjs install|uninstall|status` (`README.md:75`),
  con `--binary <path>` para forzar binario.
- Manual: `gentle-companion-server` (`README.md:66`) — solo para desarrollo o si
  `PI_COMPANION_AUTOSTART=0`.

**Lo que falta:** decirlo en la doc de forma que un usuario no tenga que leer tres
secciones. Y aclarar que el servicio corre con privilegios de usuario, no root
(`README.md:152`), con la nota de lingering en Linux.

---

## 13. Enlace a gentle-shell en la página principal (Resumen)

**Lo que llegó (textual):** "Hay que añadir enlace a gentle-shell, lo suyo es en la pagina
principal (Resumen), destacado pero sin subrayado"

Petición de UI, concreta y pequeña: un enlace a gentle-shell en la vista Resumen,
visualmente destacado y **sin subrayado**.

**Falta saber:** ¿a qué URL? (¿repo? ¿web del producto? ¿landing?). Y qué significa
"destacado" sin subrayado: ¿color de acento, peso tipográfico, botón?
--
Ricardo: Buena pregunta,si, habŕa que enlazar a la web: https://gentlemanprogramming.com/
---

## 14. TODO: columnas de la tabla de sesiones

**Lo que llegó (textual, fragmento del DOM):**
`sessiontable.th.sessionsessiontable.th.workspacesessiontable.th.modelsessiontable.th.status`

Se lee como las cabeceras actuales: **Session · Workspace · Model · Status**.

**Falta saber:** qué hay que cambiar. ¿Falta una columna (coste? headroom? archivadas?),
sobra alguna, o el problema es que no se muestra bien?

---
Ricardo: si, la race condition, me ha salido una vez pero depues si a renderizado bien...cosas de svelte, ningún problema, ya lo mirare pq esa cosas son finas y nada evidentes

---

## 15. `Variables sin asignar:` — sigue sin cuerpo

Tercera vez que llega el encabezado sin contenido. Se deja pendiente hasta que llegue.

---

## Hallazgo verificado sobre el punto 10 (instalar)

`gentle-shell install` **no es un subcomando propio**: el binario reenvía a `pi install`.

```
$ gentle-shell install
Missing install source.
Usage: pi install <source> [-l] [--approve|--no-approve]
```

Consecuencia práctica: los comandos del README funcionan, pero **el mensaje de error
que ve el usuario dice `pi install`, no `gentle-shell install`**. Si alguien omite el
origen, la ayuda que recibe habla de otro programa. Es coherencia de superficie, no un
fallo funcional. Anotarlo junto al punto 10.

---

## 16. Permitir retirar/editar los mensajes en espera

**Lo que llegó (textual):** "permitir retirar/editar los mensajes en espera."

Los mensajes que el usuario envía mientras el agente trabaja quedan encolados. Hoy
parece que se pueden encolar pero no retirar ni editar antes de que se envíen.

**Falta saber / decidir antes de implementar:**
- ¿Retirar = eliminar de la cola, o solo cancelar el envío?
- ¿Editar = recuperar al composer para reescribir, o editar en sitio la burbuja encolada?
- ¿Qué pasa si el agente termina justo mientras el usuario edita? Hay carrera entre
  "el mensaje sale" y "el usuario lo retira". **Requiere decisión explícita**, no
  improvisación: si el mensaje ya se entregó, retirarlo no debe existir como opción
  visible.
- ¿Cola de un solo mensaje o varios? Si son varios, ¿se reordena al retirar?

**Nota de ORQ:** este es el único punto de la lista que huele a **concurrencia** (carrera
entre envío y retirada). Merece su propio issue y su propio test, no ir de acompañante.

---
Ricardo: Yo pensaba como en la TUI, que si se escribe mientras respondeís se queda en cola  y si pulsas Alt+flecha lo recuperas y vuelve al cuadro de texto, donde lo puedes reeditar, borrar,...como si no lo hubieras enviado, vamos, lo que seria desencolarlo

---

## 17. Reemplazar "Pi" por "gentle-shell" en mensajes y notas

**Lo que llegó (textual)** — sección *staged*:

> "Only recorded session edits and applied Pi Jar subagent files are shown. Shell-only
> edits or delegates without an applied-file report may be missing; shared files can
> include other changes."

Es el aviso de la vista de cambios preparados. Habla de "Pi Jar subagent files" y
"Shell-only edits" al usuario final, que no sabe qué es un Pi Jar ni por qué hay dos
nombres para lo mismo.

**Falta decidir antes de traducir el texto:**
- ¿Se renombra **solo el texto visible**, o también el vocabulario interno del informe?
  Si el dato que lo alimenta distingue `pi` de `shell`, cambiar solo la cadena produce
  un mensaje que dice "gentle-shell" y explica una diferencia real que el usuario ya no
  puede ver.
- La frase describe tres limitaciones reales: (a) solo se muestran ediciones registradas
  de la sesión y ficheros de subagente aplicados, (b) puede faltar lo *shell-only* o
  delegados sin informe, (c) los ficheros compartidos pueden traer cambios ajenos.
  Al reescribir hay que **conservar las tres**, no aligerarlas.
- Términos candidatos: "Pi Jar subagent files" → ¿"ficheros de subagente"? ¿qué pasa con
  el nombre del producto Pi cuando el usuario corre sobre Pi? Puede ser correcto
  mencionarlo y el problema sea solo el orden de las palabras.

**Búsqueda para localizar todas las cadenas** (hacer esto antes de editar ninguna, para
no dejar la UI a medias entre dos nombres):

```bash
grep -rn "Pi Jar\|Pi jar\|Shell-only\|Shell only" --include=*.svelte --include=*.ts ui/src
```

**Relacionado:** punto 1 (comandos TUI alineados) y punto 15, que siguen sin contenido.
Si la intención es unificar el nombre del producto en toda la interfaz, conviene tratarlo
como un barrido único y no como arreglos sueltos por pantalla.

--
Ricardo: es solo cambiar Pi por gentle-shell, una tontería la verdad, no se ni porque lo he puesto cuando lo puedo hacer yo rapido.
Lo he puesto solo para documentarlo y hacer notar que eso se tenía que haber hecho cuando se dijo:reemplazar todas las referencias a pi por gentle-shell
---

## 18. Traducir "Unstaged/Staged" en el registro de cambios

**Lo que llegó (textual):** "y traducir Unstagged/staged) en registro de cambios"

Va con el punto 17: **el registro de cambios (vista de cambios / cambios preparados)
sigue en inglés**. Los términos de git se muestran tal cual al usuario final.

**Decisión que hay que tomar antes de traducir** (esto es lo que suele salir mal):

| Inglés | Traducción literal | Problema |
|---|---|---|
| Staged | preparado | Correcto en el dominio de git, opaco para quien no lo usa |
| Unstaged | no preparado | Se lee como "sin preparar", pero git ya lo preparó: solo no está en índice |
| Staged section | sección preparada | Ambiguo: ¿preparada para qué? |

En git, *staged* = en el índice, listo para commit. Si se traduce como "preparado" a
secas, quien no use git entenderá "aún en preparación" — **justo lo contrario**.

**Alternativas a decidir por Ricardo:**
1. Español técnico correcto: **"En el índice" / "Fuera del índice"**.
2. Español funcional: **"Listo para commit" / "Cambios sin preparar"**.
3. Dejar los términos en inglés y añadir ayuda contextual (tooltip).

**Y queda una tercera cadena del mismo bloque:** el aviso del punto 17 dice *"staged
section"* dentro del propio texto. Traducir la pestaña y dejar el párrafo en inglés deja
la vista incoherente. **Ambos van juntos.**

**Buscar antes de editar** (mismo barrido que el punto 17):

```bash
grep -rn "Staged\|Unstaged\|staged section" --include=*.svelte --include=*.ts ui/src
```
---
Ricardo: Si, son definiciones particulares, pero es que el que no sabe inglés aún se entera menos, podemos usar Listo/Borrador, Lista para enviar, ...
La idea es que como estamos usando i18n, que aunque no se traduzca inmediatamente si que estñe preeparado y ya lo traduciremos o modificaremos si surge algo mejor
---

## 19. Panel de vista previa: opción "decoración" para renderizar markdown y HTML simples

**Lo que llegó (textual):** "En panel de vista previa (de archivos) añadir la opción de
'decoración' para renderizar markdown, htmls,...(los sencillos)"

Hoy la vista previa muestra el fichero como texto. Se pide una opción (llamada
"decoración" por Ricardo) que lo renderice: markdown a HTML, y HTML simple.

**Decisiones que hay que tomar antes de implementar** — esta es la parte delicada:

1. **Defecto seguro.** Vista previa de un fichero del usuario no es lo mismo que abrir un
   sitio web. ¿La decoración viene **apagada** por defecto y se activa por fichero?
   Renderizar automáticamente markdown de un repo ajeno ejecuta lo que ese repo traiga.
2. **HTML: nunca con scripts.** "Los sencillos" hay que definirlo en código, no en prosa:
   sin `<script>`, sin `<iframe>`, sin `on*=` inline, sin `javascript:` en `href`.
   Eso es una **lista de permitidos**, no una lista de prohibidos — prohibir lo que se
   te ocurre deja pasar lo que no se te ocurrió.
3. **Sanitización, no confianza.** El markdown también escapa: un `[texto](javascript:...)`
   o un `<img onerror=...>` en un `.md` son vectores reales.
4. **Aislamiento.** Si se renderiza en el propio DOM del companion, comparte origen y
   cookies. Valorar sandbox o CSP restrictiva.
5. **Sin recursos remotos.** Que un `.md` no dispare peticiones a dominios externos
   (imágenes) revela cuándo se abrió el fichero.

**Relación con lo ya conocido:** el punto 3 de la lista (config del daemon) y el defecto
C2 del canvas documentan que el puente **no soporta service workers**
(`server/src/bridge.rs:1521`). Si la decoración requiere un worker, choca de frente.

**Clasificación de ORQ:** esto **no es un punto de release menor**. Es superficie de
renderizado de contenido no confiable: entra en el criterio de riesgo alto (seguridad).
Debería ir en su propio issue, con tests de sanitización, y no empaquetado con los
arreglos cosméticos de esta lista.

-
Ricardo: lo he apuntado, no tiene que ser inmediato, yo en otros projecto he usado librerias,de javascript/typescript y de python, tendría que mirarlo, tampoco hace falta ninguna muy compleja, si no lo veís claro, a la lista y para la siguiente release, que seguro hay más cosas que modificar y añadir, solo estamos empezand
---

## 20. Traducir tooltips y mensajes de botones

**Lo que llegó (textual):** "traducir Tooltips y mensajes de Botones:"

Los textos de ayuda (`title`, `aria-label`) y los avisos de los botones siguen en inglés,
como el registro de cambios de los puntos 17 y 18.

**Por qué esto no es cosmética, aunque lo parezca:**

- **`aria-label` es lo único que "lee" un lector de pantalla.** Un botón cuyo icono se
  entiende a la vista pero cuyo `aria-label` está en inglés deja fuera a quien no ve el
  icono. Traducir tooltips es accesibilidad, no estilo.
- **`title` es el único sitio donde cabe la explicación** de acciones peligrosas. Si el
  tooltip dice "Archive" y borra del registro, el usuario hispanohablante no leyó el aviso.
- **Coherencia con los puntos 17-18**: si el cuerpo de la vista se traduce y el tooltip
  no, la interfaz habla dos idiomas en la misma pantalla.

**Barrido previo obligatorio** (una sola pasada, no arreglos por pantalla):

```bash
grep -rn 'aria-label=\|title="' --include=*.svelte ui/src | grep -v 'aria-label="[^"]*[áéíóúñ¿¡]'
```

Ese filtro deja justo los que **no** tienen castellano: los pendientes.

**Falta saber:** ¿idioma fijo castellano, o conmutable? Si el producto se publica, un
selector de idioma es la diferencia entre traducir y traducir bien. Esta decisión
condiciona los puntos 17, 18 y 20 juntos.

**Nota de ORQ:** 17, 18 y 20 son **el mismo trabajo**: unificar idioma y vocabulario de la
interfaz. Tres issues separados producirían tres barridos incompletos.

--
Ricardo: si hace ayuda el que hada una lista con literales o más especifico lo preparamos mañana, he ido apuntando rápido lo que he visto.
---

## 21. TODO: "preview, download,"

**Lo que llegó (textual):** "preview, download,"

Son dos acciones del panel de ficheros, probablemente dos botones. **No llegó qué hay
que hacer con ellas**: ¿traducirlas (punto 20)? ¿añadirlas donde no están? ¿cambiar su
comportamiento? ¿fallan?

**Falta saber:** verbo + objeto. Ejemplo de lo que necesito: "traducir los botones
Preview y Download" / "añadir botón Download al panel de vista previa" / "Download baja
el fichero equivocado".

**Contexto que ya tengo:** el panel de vista previa es también el del punto 19
(decoración para markdown/HTML). Si estos dos botones viven ahí, conviene tratarlos
juntos en el mismo issue.

-
Ricardo: exacto, son los botones que aparecen en el panel de  preview/descarga de ficheros, hay que traducirlos (también podría haberlo hecho yo, creo que he enlazado el archivo fuente de svelte
---

## 22. VERIFICADO — La tabla de sesiones muestra claves crudas (causa del punto 14)

**El fragmento `sessiontable.th.sessionsessiontable.th.workspace…` no era HTML mal copiado.
Era la tabla renderizando sus claves de i18n.**

Verificado:

```bash
grep -oP "^\s*'\K[a-zA-Z0-9._]+(?=':)" ui/src/lib/i18n.svelte.ts | grep -i '^sessiontable'
→ cero coincidencias
```

El prefijo `sessiontable.*` **no existe en el catálogo**. Y `t()` devuelve la clave cuando
falta (`ui/src/lib/i18n.svelte.ts:1843`):

```ts
if (message === undefined) return key;   // sin excepción, sin hueco, sin undefined
```

**38 claves rotas en total** (843 pedidas, 896 definidas, `comm -23`):

| Área | N | Dónde se ve |
|---|---|---|
| `sessiontable.*` | 14 | Toda la tabla de sesiones: cabeceras, celdas, preguntas, "thinking" |
| `session.detail.*` | 17 | Compartir, adjuntos, tareas, "thought", filtro, uploading |
| `settings.*` | 2 | Hint de pairing HTTPS, aria de scroll de uso |
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

**Test que falta:** `t()` debe fallar (o avisar en desarrollo) al recibir una clave
inexistente. Sin eso, la siguiente regresión vuelve a ser invisible.

---

## 23. VERIFICADO — Traducción por comparación de literales en inglés

`ui/src/routes/automations/[id]/+page.svelte:75`

```ts
if (value === 'Scheduling disabled') return t('automation.next.disabled');
if (value === 'No upcoming occurrence') return t('automation.next.none');
```

El servidor envía **texto en inglés**; el cliente lo reconoce comparando la cadena. Si
alguien cambia una palabra en el backend, el `if` no casa y se muestra el inglés crudo.
Es el síntoma `Próxima` + `Scheduling disabled` mezclados.

Inconsistencia añadida en `:54`: compara `value.label` (propiedad) mientras el resto
compara `value` (cadena). Dos formas para el mismo dato → el mapeo creció sin diseño.

**Arreglo correcto:** estado con identificador desde el servidor
(`scheduling_disabled`, `schedule_paused`) y en cliente `t('automation.next.' + state)`.
Nunca comparar texto visible. **Toca Rust, no solo UI**: no es un issue de PINTO a solas.

---

## 24. VERIFICADO — Cadenas hardcodeadas en los paneles de automatizaciones

`ui/src/lib/AutomationFlow.svelte` — 8 cadenas que **nunca pasaron por `t()`**:

```
:30  aria-label="Automation execution phases"
:42  No steps configured
:43  View flowchart
:51  aria-label="Close flowchart"
:54  aria-label="Scrollable execution flowchart"
:68  If this {check|step} fails  /  If retries fail
:74  No steps in this phase. Continue directly.
:76  Cancellation stops all remaining steps, including finalizers.
```

`ui/src/lib/AutomationPagination.svelte` — 2 más.

Y el catálogo no tiene **ninguna** clave de flowchart (`grep -i flowchart` sobre
`i18n.svelte.ts` → vacío). No están mal traducidas: **nunca entraron al sistema**.

Esto es el "mezclado" reportado: la pantalla de automatizaciones tiene partes en
castellano y partes en inglés según si el autor de cada trozo usó `t()`.

**Barrido sugerido** (mismo criterio que el punto 20):

```bash
grep -nE '>[A-Z][a-z]+ [a-z]|aria-label="[A-Z]|placeholder="[A-Z]|title="[A-Z]' \
  ui/src/lib/Automation*.svelte ui/src/routes/automations/**/*.svelte | grep -v "t('"
```

--

## 25. VERIFICADO — Pies de página sin traducir, y el problema del plural

**Lo reportado:** "Traducir pies de página (footers) — (4 items · Page 1 of 1)"

`ui/src/lib/AutomationPagination.svelte:6-7`:

```
:6  {total} {total === 1 ? 'item' : 'items'} · Page {page} of {pages}
:7  aria-label="Previous page" … Previous  |  aria-label="Next page" … Next
```

**Tres problemas distintos en dos líneas:**

1. **Cadenas hardcodeadas** — misma clase que el punto 24. Ni `item(s)`, ni `Page…of`,
   ni `Previous`, ni `Next` pasan por `t()`.
2. **Plural resuelto con un ternario en la plantilla** — `total === 1 ? 'item' : 'items'`.
   Eso funciona en inglés. En castellano el plural cambia de otra forma y, sobre todo,
   **no se puede traducir sin mover la lógica al catálogo**.
3. **`aria-label` en inglés** — "Previous page" / "Next page": accesibilidad, no estilo.

**Hay un precedente que marca el camino** (`ui/src/lib/i18n.svelte.ts:717` y `:1615`):

```ts
'en': 'sessions.showing': 'Showing {count} of {total} {unit}'
'es': 'sessions.showing': 'Mostrando {count} de {total} {unit}'
```

Es decir: **la unidad (`{unit}`) se pasa como parámetro ya resuelto**, y el plural se
decide fuera del catálogo. Es el patrón existente; el pie de página no lo sigue.

**Decisión que hace falta antes de implementar:** ¿se adopta un mecanismo de plural
compartido (el catálogo tiene `sessiontable.question.plural` entre las claves rotas,
señal de un intento previo) o se generaliza el patrón `{unit}` de `sessions.showing`?
Si cada pantalla resuelve el plural a su manera, esto vuelve a aparecer en cada
traducción futura.

**Barrido para localizar todos los pies afectados:**

```bash
grep -rnE "\? '[a-z]+' : '[a-z]+s'|[0-9] items|Page \{|of \{pages\}" \
  ui/src --include=*.svelte | grep -v "t('"
```

**Nota de agrupación:** este punto, 24 (hardcodeadas), 22 (claves ausentes), 23 (mapeo
por literal), 17, 18 y 20 son **un solo tema**: i18n. Siete issues separados producirían
siete barridos incompletos y un mecanismo de plural distinto en cada uno.

---

## 26. VERIFICADO — El visor de vista previa es un iframe, y los SVG no se pueden servir así

**Lo reportado:** "añadir visores para la vista previa (svg fallan), revisar también la
descarga `ui/src/lib/BridgePreview.svelte`"

### Causa de que los SVG fallen

`ui/src/lib/BridgePreview.svelte:124` no tiene visores por tipo. **Todo se mete en un
`<iframe>`** con `sandbox="allow-scripts allow-forms allow-modals"`.

Un SVG servido por el puente llega con `Content-Type: image/svg+xml`. Y
`server/src/bridge.rs:1174` decide así:

```rust
match essence.as_str() {
    "text/html" | "application/xhtml+xml" => Some(Rewrite::Html),
    "text/css"  => Some(Rewrite::Css),
    "text/javascript" | ... => Some(Rewrite::Script),
    _ => None,          // ← image/svg+xml cae aquí: no se reescribe
}
```

Con `_Rewrite::None`, el contenido se sirve **sin reescritura de rutas**. Un SVG que
referencie rutas relativas (o un `<use xlink:href>`, o una fuente embebida) rompe, porque
el iframe vive bajo un prefijo `/bridge/…` y el SVG no fue reescrito para ese prefijo.
**Es la misma familia que el defecto C2 del canvas**: rutas absolutas que pierden el
segmento del puente.

### Y el sandbox agrava el diagnóstico

`sandbox="allow-scripts"` **sin** `allow-same-origin` es lo correcto para HTML de terceros.
Pero para una imagen es contraproducente: un SVG es un documento ejecutable, y meterlo en
un iframe con scripts permitidos convierte una imagen en superficie de ejecución.

### Lo que hace falta (decisión, no solo código)

1. **Visores por tipo.** Imagen (SVG/PNG/JPEG/WebP) → `<img>`, no iframe. Texto y
   markdown → `<pre>` o renderizado (esto enlaza con el punto 19: decoración). PDF →
   visor nativo. Desconocido → descarga, no intento de render.
2. **`<img>` para SVG** evita el problema de reescritura **y** el de sandbox: un SVG
   cargado como imagen **no ejecuta scripts**. Dos defectos, un arreglo.
3. **Política de contenido para SVG.** Un SVG puede traer `<script>`, `<foreignObject>` y
   `onload=`. Como `<img>` no ejecuta nada, basta con no promoverlo nunca a documento.
   Documentarlo en el código: el día que alguien "mejore" el visor a iframe, reintroduce
   el agujero.

### Descarga: lo que hay que revisar

`BridgePreview.svelte:152-157` tiene dos acciones (`fetchFile(false)` / `fetchFile(true)`)
y el botón de descarga depende del mismo `TempFile` del puente. Puntos a comprobar:
- ¿Se descarga con el `Content-Type` correcto, o se fuerza `octet-stream`?
- ¿El nombre de fichero viene saneado? Un `Content-Disposition` con nombre del usuario es
  una vía de inyección de cabecera si no se escapa.
- **Alfa y color de imagen:** ya hubo una regresión con `icon-192/512.png`
  (`srgb opaque=true`) que en iOS borraba el 9,9 % del dibujo. Si la descarga re-rasteriza,
  el mismo defecto puede reaparecer.

**Clasificación:** igual que el punto 19, esto es **seguridad de contenido no confiable**,
no cosmética. Visor propio y su issue propio.

**Relación:** punto 19 (decoración markdown/HTML) y defecto C2 del canvas. Los tres son
la misma pregunta: **qué se renderiza, dónde y con cuánta confianza.**

---

## 27. VERIFICADO — Sesiones históricas: el bloqueo son DOS guards, no uno

**Lo reportado:** "el error es porque la sesión no está activa, pero se debería poder
descargar aunque sea histórica, bloqueo innecesario"

Ricardo tiene razón en el fondo, pero el arreglo no es quitar un `if`. Hay **dos** bloqueos
encadenados, y el segundo es el difícil.

### Guard 1 — Pi no conectado (`server/src/bridge.rs:506`)

```rust
async fn ensure_pi_connected(...) {
    if matches!(status, Some("stopped" | "disconnected")) {
        return Err((StatusCode::CONFLICT, "Pi is not connected for this session..."));
    }
```

Es el 409 ya diagnosticado en el punto 2.

### Guard 2 — prueba de mención, sobre estado EN MEMORIA (`bridge.rs:669`)

```rust
async fn require_file_mention(...) {
    let activity = state.activity.read().await;
    let mentioned = candidates.iter().any(|c| activity.mentions(session_id, c, MentionKind::Path));
    ...
    Err((StatusCode::FORBIDDEN, "Only files the agent mentioned in this session can be fetched."))
}
```

Y `ActivityStore` (`server/src/activity.rs:135`) es **`HashMap` en memoria, sin persistencia**:

```rust
pub struct ActivityStore { logs: HashMap<String, ActivityLog> }   // no hay activity.json
```

Además `archive` hace `state.activity.write().await.remove(session_id)` (`main.rs:1214`).

**Consecuencia:** una sesión histórica no solo está parada. Su historial de actividad se
borró del daemon al archivarse, y tras **cualquier** reinicio del daemon se pierde el de
todas las sesiones. Aunque se saltara el guard 1, el guard 2 devolvería 403 porque nadie
recuerda la mención.

### Tercer efecto — un enlace abierto muere si la sesión se para

`authorize_endpoint` (`bridge.rs:1033`):

```rust
if ensure_pi_connected(state, &endpoint.session_id).await.is_err() {
    state.bridge.lock().await.revoke_session(&endpoint.session_id);
```

### Opciones (decisión de Ricardo, no de PINTO)

| Opción | Coste | Riesgo |
|---|---|---|
| A. Persistir `ActivityStore` a disco | Fichero nuevo + formato | **Alto**: contiene texto de conversación |
| B. Reconstruir menciones del `.jsonl` de Pi | Parseo bajo demanda | Lento; hay que no romper con formatos raros |
| C. **Persistir solo rutas mencionadas por sesión** | Un índice pequeño | Bajo: el guard necesita rutas, no conversación |

**Recomendación de ORQ: C.** El guard no necesita el texto, solo saber que esa ruta se
mencionó. Persistir rutas resuelve el caso histórico sin almacenar contenido.

-
Ricardo: No mo convence si es archivo hay que archivarlo, o que sea el usuario el que vea que hace con el cuando no tenga espacio, pero por ahora como veas, sea como sea no perdemos funcionalidad solo es, a mi entender, mejorarla, no hay dolor.
Si es un problema ponlo en el informe, con detalles del fichero/lineas donde están los bloqueos y ya lo miro


### Por qué esto es RIESGO ALTO

`require_file_mention` **es el guard que impide el path traversal que ya cerramos una vez**
(5 tests). Relajarlo mal reabre ese agujero. Issue propio, con tests que prueben:
- sesión histórica descarga un fichero **mencionado** → OK
- sesión histórica pide un fichero **nunca mencionado** → 403
- sesión histórica pide `/etc/passwd` o `../../` → 403
- tras reiniciar el daemon, el caso 1 sigue funcionando

### Dato pendiente de confirmar

El error que Ricardo ve en consola puede ser **409** (guard 1) o **403** (guard 2).
**El texto exacto decide cuál.** Sin él, este punto queda con dos ramas abiertas.

Ricardo: He visto los dos, uno en las descargas (409) y el 403 en lo ultimo que he adjuntado
