---
type: Operations Board
title: Pizarra del equipo y reparto de mando
description: "Quién es quién en el equipo de agentes de gentle-companion, quién ordena a quién y las reglas que evitan ambigüedades en el reparto. Copia en castellano para Ricardo."
tags:
  - operations
  - coordination
  - team
  - routing
status: active
generated: 2026-11-19
---

# Pizarra del equipo y reparto de mando — gentle-companion

> Fuente única de verdad sobre quién es quién, quién ordena qué y a dónde vuelven las respuestas.
> **Runtime**: esto no es `pi` a secas — es pi con mods corriendo bajo **gentle-shell**, con la configuración en `~/.gentle-shell/agent/`.
> **Cómo nombrar**: en prosa, dirigirse a **`Ricardo`** — es la opción menos ambigua y la que se usa
> por defecto cuando pueda haber confusión (cifras, porcentajes o IDs de sesión cerca).
> El alias `_00_` también es suyo, y en markdown debe escribirse entre comillas invertidas: `` `_00_` `` —
> nunca suelto, porque markdown lo interpreta como cursiva y se come los subrayados.
> Nunca "the human", "the user" ni ninguna categoría genérica. Es un ser vivo más, un miembro del equipo.
> Idioma entre agentes: inglés. Con Ricardo: castellano.
> Actualizar este fichero cada vez que nazca, se renombre o se cierre una sesión.

> **Nota**: existe la versión inglesa en `team-roster.md`, que es la que consultan los agentes.
> Esta copia en castellano es para Ricardo. Si hay discrepancia entre ambas, **manda la inglesa**.

## Quién es quién

| Rol | ID de sesión (corto) | Nombre de sesión | cwd | Modelo | Función |
|---|---|---|---|---|---|
| **ORQ** (coordinador) | `01a1f3db` | ORQ: coordinación del equipo | `~/Trabajo/IAI/gentle-companion` | deepseek-v4-1-flash-1017 · thinking `high` | Orquestador. Reparte tareas, lleva ODD, verifica y hace commits. NO hace operaciones de teléfono ni procesa imágenes. |
| **TelfMNG** (teléfono) | `01a1ef70` (ANTIGUA, cerrada) — NUEVA: pendiente | TelfMNG: operaciones sobre el Xiaomi A2 | `~/Trabajo/IAI/pi` | deepseek-v4-1-flash-1017 · thinking `high` | Todas las operaciones sobre el Xiaomi A2: adb, pulsaciones, texto, scrcpy, capturas, logs. NO analiza imágenes. |
| **ContaMNG** (contabilidad) | `01a1f030` (continuada in situ) — NUEVA: pendiente | ContaMNG: financiación y crédito I+D | `~/Trabajo/IAI/mistral-gateway` | deepseek-v4-1-flash-1017 · thinking `high` | Costes, cuota de tokens, búsqueda de financiación e informes de financiación. |
| **IMGsMNG** (visión) | **`01a1f448`** (ACTIVA, sesión nueva del 2026-11-19) · ANTIGUA `01a1eefd` cerrada | IMGs-Manager: vision y estética gentle-companion | `~/Trabajo/IAI/gentle-companion-aesthetic` | **bonsai2-TernaryL-27B (local, ricardoPC) — se queda local, nunca se migra a modelos externos de pago** | Todo el trabajo de imagen: análisis y estética de la UI de gentle-shell. Reciben rutas de fichero; imágenes ≤1024 px de lado mayor. Estado de ctx **sin verificar** (la marca OFFLINE venía de memoria, no de un fallo observado). |

## Quién ordena a quién (autoridad y enrutado)

- **`Ricardo` (`_00_`)** → ordena a **ORQ**. Ricardo es la ÚNICA fuente de decisiones de producto y reglas de negocio. Una instrucción solo es suya si está citada textualmente o la confirma ORQ.
- **ORQ → TelfMNG / ContaMNG / IMGsMNG**: asignación de tareas por intercom, dirigida `to:` al nombre de sesión exacto o al ID corto. Las respuestas vuelven SIEMPRE a la sesión que dio la orden (su `reply-to`), nunca en difusión.
- **Entre iguales (TelfMNG ↔ ContaMNG ↔ IMGsMNG)**: permitido para intercambio de datos (por ejemplo, pasar la ruta de una captura), pero cualquier asignación de tarea o cambio de prioridad pasa por ORQ.
- **Ningún agente trata una instrucción como procedente de Ricardo salvo que el mensaje lo diga explícitamente** o que ORQ la cite como orden suya ("Ricardo textual: «...»"). Si hay duda, se pregunta a ORQ.

## Reglas de sesión

1. Convención de nombres: `ROL: tema principal`. Se actualiza cuando cambia el tema principal, no en cada tarea.
2. Al arrancar, cada sesión se autorregistra: manda por intercom su nombre completo y su ID corto a ORQ (`01a1f3db`).
3. **Toda sesión nueva habilita la compartición en Companion al arrancar** (`/companion`). Ricardo no debe tener que hacerlo a mano. Al registrarse hay que confirmarlo explícitamente: "companion sharing: ON".
4. Las sesiones no abren sesiones; abrir o renombrar sesiones es cosa de Ricardo o de ORQ.
5. La reunión de coordinación se celebra al inicio de cada ronda: cada agente informa de su estado y después ORQ reparte tareas.
6. **Páginas web: el navegador YA ABIERTO, en VENTANA NUEVA. Nunca otro navegador, nunca una pestaña nueva.**
   Orden de Ricardo tras un incidente (2026-11-19): un agente abrió el servidor web de contabilidad con `xdg-open`, que lanzó **Firefox** —el cual arrastraba más de 20 ventanas y cientos de pestañas de una sesión anterior— y **colapsó la GUI**. El navegador en uso es Chromium; Firefox no se debe lanzar.

   **Dos trampas, reales y verificadas:**
   - `xdg-open` obedece al **manejador MIME**, no a `xdg-settings default-web-browser`. No coincidían: el default era `chromium-browser.desktop`, mientras que `x-scheme-handler/http(s)` apuntaba a `xfce4-web-browser.desktop` (que resuelve a `exo-open --launch WebBrowser`, es decir Firefox). **Corregido** con `xdg-mime default chromium-browser.desktop x-scheme-handler/http`, `.../https` y `text/html`. Los cuatro consultados ahora devuelven `chromium-browser.desktop`.
   - Aun con el navegador correcto, un `xdg-open` a secas **reutiliza una pestaña existente**. Hay que usar invocación con ventana: `chromium --new-window <url>`.

   **Regla**: para abrir una URL, apuntar explícitamente al Chromium en marcha con `chromium --new-window <url>`. **No** usar `xdg-open` pelado para páginas dirigidas a Ricardo. Nunca lanzar Firefox. Si el navegador no está corriendo, arrancar Chromium es aceptable; arrancar Firefox no.
   **Por qué importa**: esto no es estilo. Un `xdg-open` despistado ya tumbó la GUI una vez.

## PerroGuardian / vigilante (planificado el 2026-11-19, a petición de Ricardo)

**Problema que resuelve**: un agente puede quedarse horas en un bucle que en la interfaz parece "trabajando" pero no avanza. Visto dos veces el 2026-11-19: IMGsMNG (4 compactaciones, greps repetidos) y ContaMNG (27 turnos en una sola tarea, insignia `stale`, 2 mensajes en cola sin responder, más de una hora sin actividad real mientras el contador seguía). Ricardo detectó ambos a ojo, no con herramientas.

**La regla que hay ahora**: detectar por presencia no basta. `intercom list` muestra una sesión conectada mientras se está quemando; `⚙ Working` indica intención, no progreso.

**Qué debe comprobar el vigilante, por sesión en marcha:**
1. **Progreso, no presencia** — marca de tiempo del último `toolCall` en el jsonl de la sesión. Si la última acción real es más antigua que N minutos mientras el estado dice "working", marcarla.
2. **Turnos sobre la misma tarea** — si la misma tarea del todo sigue `in_progress` pasado un umbral (por ejemplo >15 turnos), marcarla.
3. **Profundidad de la cola de mensajes** — mensajes en cola sin leer indican una sesión que no aceptará órdenes nuevas.
4. **Frecuencia de compactación** — más de 2 compactaciones en una hora significa que el contexto está haciendo thrashing.
5. **Llamadas idénticas repetidas** — la firma de un bucle (mismo comando o patrón tres o más veces).
6. **Crecimiento del contexto** — un % de ctx que sube sin tarea terminada es un consumo.

**Fuentes de señal (todas locales, sin infraestructura nueva por ahora):**
- `herdr pane read <pane> --source visible` — la línea de estado y el panel de tareas.
- El jsonl de la sesión en `~/.gentle-shell/agent/sessions/<cwd-mangled>/` — marcas de tiempo, toolCalls, eventos de compactación. **Es la fuente autoritativa; las etiquetas de la interfaz mienten** (demostrado dos veces el 2026-11-19).
- `intercom list` — solo para alcanzabilidad, nunca para salud.

**Acción al detectar**: informar a Ricardo con la sesión concreta, la evidencia (última acción, número de turnos, número de compactaciones) y una recomendación (aviso, interrupción o reinicio). **No matar automáticamente**: matar una sesión pierde el trabajo en vuelo. Preguntar antes.

**Opciones de implementación a evaluar cuando lo construyamos**: una automation de Companion por cron (cada 15 min) que lea los mtime de los jsonl y las marcas del último toolCall; o una comprobación del ORQ al inicio de cada ronda. Preferible algo que funcione sin humano delante, que es justamente el objetivo.

## Disciplina de herramientas (añadida el 2026-11-19 tras un incidente)

**Un `grep` sin acotar fue lo que tumbó una sesión.** IMGsMNG lanzó 6 greps de ~52.000 caracteres cada uno (justo el techo de truncado), acumuló **827 KB en 70 resultados de herramienta** y forzó **4 compactaciones** entre las 15:09 y las 16:32. Cada compactación perdía el hilo, así que volvía a grepear: un bucle que se retroalimenta y que quemó 6.975 s de GPU local a 2,7 tok/s.

**Reglas, obligatorias para todos los agentes:**
1. **`grep` siempre con `limit`** (empezar en 20) y **`path` acotado** al directorio más estrecho que responda la pregunta. Nunca grepear la raíz del repo.
2. **Preferir `read`** cuando ya se sabe el fichero: leer un fichero cuesta una fracción de un grep por todo el repo.
3. **Nunca `grep` para algo que resolvería un `find` o un listado de directorio.**
4. Si un resultado se acerca al techo de truncado (~52 KB), **parar y acotar la consulta** — no lanzar otra igual.
5. **Contar el coste**: dos greps grandes llenan la ventana entera de un modelo de contexto pequeño. Los modelos locales pequeños (bonsai2) son los más castigados.

**Señal de sesión agotada**: llamadas repetidas idénticas, % de ctx subiendo, compactaciones cada pocos minutos. Parar e informar en vez de reintentar.

## Política de modelo (decidida el 2026-11-19 por Ricardo y ORQ)

- **Causa raíz de la corrupción de salida del ORQ**: `settings.json` tenía `defaultModel = zai-glm-5-3-flash`, así que toda sesión nueva heredaba glm. La sesión del ORQ se corrompió (tokens sin sentido, comandos inventados) mientras corría glm, y quedó limpia en cuanto Ricardo la cambió a `deepseek-v4-1-flash-1017`.
- **glm no está roto de por sí**: la sonda P1 (prueba de integridad de 5 líneas EN/ES) pasó limpia en TelfMNG y en ContaMNG en contexto corto. El modo de fallo es **contexto largo y presupuesto de salida truncado**, no la familia del modelo.
- **Acción aplicada**: `defaultModel` cambiado a `deepseek-v4-1-flash-1017` (copia de seguridad: `settings.json.bak-20261119-142834`). `defaultThinkingLevel` se dejó en `medium` a propósito: el nivel de thinking se fija por sesión, nunca se degrada de forma global.
- **Thinking por rol — CORREGIDO el 2026-11-19**: `deepseek-v4-1-flash-1017` **no implementa `medium`**. Su `thinkingLevelMap` (models.json) es `off/low/high/xhigh/max`, con `medium: null`. La asignación anterior a `medium` era inválida y se mapeaba en silencio. **Política efectiva: todos en `high`.** TelfMNG estaba en `low` por trabajo mecánico de teléfono, válido solo para adb puro; `high` es necesario para cualquier cosa con criterio (router, diagnóstico). `low` puede reaplicarse por tarea si aprieta la cuota.
- **Hecho verificado**: un agente **no puede cambiar su propio modelo ni su nivel de thinking**. Lo probó TelfMNG: los comandos de TUI (`/model`, `Ctrl+P`, `/thinking`, `Shift+Tab`) requieren pulsación física del humano; ninguna herramienta, ejecutor de slash-commands ni RPC alcanza el proceso vivo. Las variables de entorno son reflejos de solo lectura. El autocambio está reservado al humano por diseño — mismo principio que el modo de permisos.
- **TelfMNG y ContaMNG corren ahora deepseek-v4-1-flash-1017 · high** (cambiado por Ricardo en la TUI, 2026-11-19).
- **IMGsMNG está exento de la política de modelo**: corre `bonsai2-TernaryL-27B` en local sobre ricardoPC y ahí se queda. Ricardo no le cambia los genes por modelos externos de pago. Sus fallos de contexto se arreglan ajustando la configuración local, nunca cambiando de modelo.
- **Aviso operativo**: si un agente empieza a emitir tokens sin sentido, la sesión está agotada — hay que parar **antes** de ejecutar cualquier acción con efectos (comandos, ediciones). Así ocurrieron un `pkill` falso y un `edit` fantasma el 2026-11-19.
- **Coste verificado por ContaMNG**: deepseek sale **más barato** que glm con nuestro patrón de uso (91 % de tokens en caché): 0,86x el día 19 y 0,57x el día 18. Proyección mensual ~165 $ frente a ~192 $. El coste no es la restricción.

## Orientación del A2 y scrcpy — RECETA DEFINITIVA (TelfMNG, verificada 2026-11-19/20)

Léela antes de tocar el teléfono. Todo esto se aprendió a base de prueba y error en una sesión larga; no lo redescubras.

### Las tres capas (aquí está el porqué de tanto vaivén)

La orientación la deciden **tres capas independientes**. Confundirlas es lo que produjo el ir y venir:

1. **La rotación del propio teléfono** — ajustes `user_rotation` / `accelerometer_rotation`. Es la verdad de lo que muestra la pantalla.
2. **La rotación de captura de scrcpy** — `--capture-orientation`. Rota el *stream*, no el teléfono.
3. **La geometría de la ventana** — ancho/alto de la ventana X que muestra el stream.

Si el teléfono ya está apaisado y además pasas `--capture-orientation=270`, la imagen sale del revés. **Rota una sola vez, en una sola capa.**

## LO QUE RICARDO QUIERE DE VERDAD (sus palabras, 2026-11-20 — LEE ESTO PRIMERO)

Tras la sesión completa se quedó con UNA configuración y pidió que no se la muevan:

> «deja de toquetearlo y déjalo como antes, que estaba bien»

**La configuración aprobada es: EL TELÉFONO SE QUEDA FÍSICAMENTE VERTICAL (`user_rotation=0`), y el aspecto apaisado lo da `--capture-orientation=270` de scrcpy.** NO rotes el teléfono para conseguir una ventana apaisada. Ese es el error que hay que evitar:

- Teléfono vertical + `--capture-orientation=270` + ventana 512x256 → **este es el aspecto aprobado.** El teléfono queda intacto (bueno: el launcher MIUI y la pantalla de bloqueo se pelean con la rotación de todas formas) y la ventana es apaisada.
- Teléfono apaisado + ventana 512x256 → también «funciona», pero NO es lo que aprobó, y le quita al teléfono su orientación para todo lo demás.

O sea: **no toques la rotación del teléfono salvo que Ricardo pida explícitamente girar el teléfono.**

### Por qué girar el teléfono es una batalla perdida (descubierto a base de golpes)

Tanto el launcher MIUI como la pantalla de bloqueo fuerzan vertical ignorando `user_rotation`: el launcher **resetea `user_rotation` a 0** al recuperar el foco, y mientras `mDreamingLockscreen=true` el sistema ignora la rotación por completo. Rotar el stream una sola vez, en scrcpy, esquiva ambos problemas de forma permanente. Por eso la receta aprobada usa la rotación de captura y deja el teléfono en vertical.

### Ventana vertical, si alguna vez la pide (256x512)

```sh
A=192.168.43.168:5555                      # VERIFICA la IP antes, cambia (ver abajo)
pkill -x scrcpy; sleep 3
setsid env DISPLAY=:0 scrcpy --window-title="A2" \
  --window-width=256 --window-height=512 \
  --always-on-top -s $A --no-audio > /tmp/scrcpy-a2.log 2>&1 < /dev/null &
```

### Ventana APAISADA aprobada (512x256) — reproduce exactamente esto

```sh
A=192.168.43.168:5555
# NO toques la rotación del teléfono. Déjala como esté.
pkill -x scrcpy; sleep 3
setsid env DISPLAY=:0 scrcpy --window-title="A2" \
  --window-width=512 --window-height=256 --capture-orientation=270 \
  --always-on-top -s $A --no-audio > /tmp/scrcpy-a2.log 2>&1 < /dev/null &
sleep 12
wmctrl -ir 0x05e00031 -e 0,1366,21,512,256   # relee el winid, cambia en cada arranque
wmctrl -ir 0x05e00031 -b add,above
```

Estado verificado de la configuración aprobada: teléfono `user_rotation=0`, `screencap` devuelve 1080x2160 (vertical), ventana 512x256, `Map State: IsViewable`. Esa combinación es correcta y deliberada — el teléfono en vertical, la ventana apaisada.

### Posición (aprobada por Ricardo, no la muevas sin preguntar)

Esquina superior izquierda del Sony de 17" (HDMI-1, origen +1366+0):

```sh
wmctrl -ir <winid> -e 0,1366,21,512,256
wmctrl -ir <winid> -b add,above
```

Usa `wmctrl -ir` (con `r`). `wmctrl -i -e` no hace nada en silencio.

### Las dos trampas que costaron más tiempo

**Trampa 1 — el launcher MIUI fuerza vertical siempre.**
`com.android.launcher3/com.android.searchlauncher.SearchLauncher` se niega a apaisarse y *resetea* `user_rotation` a 0 cada vez que recupera el foco. El ajuste de rotación es correcto pero el escritorio sigue vertical. Es una limitación del launcher, no una mala configuración. Prueba: abre Ajustes (`am start -a android.settings.SETTINGS`) y `screencap` devuelve 2160x1080 — el apaisado funciona en todas partes menos en el launcher. **No luches contra ello.** Dejar en primer plano una app que sí soporte apaisado (Ajustes vale) mantiene el teléfono visiblemente horizontal.

**Trampa 2 — la pantalla de bloqueo siempre se renderiza vertical.**
Mientras `mDreamingLockscreen=true`, el teléfono ignora `user_rotation` por completo y `SurfaceOrientation` se queda en 0. Compruébalo con:
```sh
adb -s $A shell 'dumpsys window | grep -m1 -o "mDreamingLockscreen=[a-z]*"'
```
Si dice `true`, trabajar la orientación es perder el tiempo hasta que Ricardo lo desbloquee. **Nunca pidas ni manejes el PIN** — Ricardo lo desbloquea él mismo por la ventana de scrcpy.

### Cómo VERIFICAR en vez de ir a tientas

```sh
adb -s $A shell 'settings get system user_rotation'        # 0=vertical 1=90º 2=180 3=270
adb -s $A shell 'dumpsys input | grep -m1 SurfaceOrientation'   # lo que se renderiza de verdad
adb -s $A exec-out screencap -p > /tmp/x.png && identify -format "%wx%h\n" /tmp/x.png
```
`2160x1080` = apaisado. `1080x2160` = vertical. **`screencap` es la verdad absoluta**; el valor del ajuste y `SurfaceOrientation` pueden discrepar de lo que dibuja el launcher.

Para la ventana: `xwininfo -id <winid> | grep "Map State"` debe decir `IsViewable`. `IsUnMapped` significa que scrcpy arrancó pero no está renderizando.

### Reglas de supervivencia de scrcpy

- **Siempre `setsid` + `< /dev/null`.** Sin eso, scrcpy muere cuando su shell padre termina. Es la razón de que la ventana "se muriera" una y otra vez.
- **Una sola instancia.** Dos procesos scrcpy rompen el encoder (`Error 0xfffffff4`). Siempre `pkill -x scrcpy; sleep 3` antes de relanzar.
- **Si la ventana se queda en `IsUnMapped`**, añade `--video-codec=h264 --max-fps=30`. Observado tras un apagón del teléfono: el encoder VAAPI volvió roto y solo la ruta de códec por software lo recuperó.

### Encontrar el teléfono cuando falla adb

El A2 cambia de dirección constantemente (ciclos de apagado, USB tether arriba/abajo, AP WiFi). Orden de investigación:

1. `adb devices` — puede estar ya ahí con una dirección antigua.
2. Escanear la LAN: `nmap -sn 192.168.43.0/24 -T4`. Direcciones vistas hasta ahora: `.168`, `.180`, `.42`, `.43`, `.129` (USB tether vía el router, `192.168.42.129`).
3. `adb connect <ip>:5555` en cada host vivo.
4. Ruta USB tether: el teléfono aparece como WAN del router (`usb0`, `192.168.42.129`). Alcanzable desde el HP **a través** del router, pero el puerto 5555 solo está abierto mientras `adb tcpip 5555` siga vivo en el teléfono.

### Regla de batería (instrucción permanente de Ricardo)

La celda del A2 está degradada (~2562/3010 mAh) y el teléfono **se apaga solo hacia el 60-70%** bajo carga. **Avisa a Ricardo siempre que baje del 80%.** Compruébalo con `dumpsys battery | grep -E "level|status"`. No tiene arreglo sin root (Ricardo no quiere rootear); mantenlo cargando.

## Infraestructura e incidencias (2026-11-19/20)

**Topología (actual)**: el A2 da 4G de dos formas — tether USB → router (`usb0` 192.168.42.130) Y AP WiFi → ricardoPC. ricardoHP está en la LAN del router (`192.168.2.20`, cable) **y** en el AP del A2 (`wlo1` 192.168.43.73). La WiFi del router está caída. El gateway del AP del A2 es **192.168.43.168**, no `.43.1`.

**Trampa de red conocida**: el perfil NetworkManager `ricardoA2` lleva `ipv4.routes = 192.168.2.11/24 192.168.2.1`, que instala una ruta que manda `192.168.2.1` por `wlo1`, donde el router no responde → SSH y LuCI mueren con EHOSTUNREACH. Hay workaround con `SO_BINDTODEVICE` vía `socat` (`router-access.sh`). El arreglo real necesita sudo: `nmcli connection modify ricardoA2 ipv4.routes ''`.

**Router (OpenWrt 24.10.6, HG556a)**: firewall endurecido el 2026-11-19 — wan input/forward en REJECT, borradas las reglas `wwwl` y `hp` (WAN→LAN), LAN intacta, internet vivo. Consecuencia asumida: el router ya no se administra desde la WiFi del A2 (su interfaz STA está en zona WAN), solo desde la LAN. `/www` es escribible → sirve HTML estático sin instalar nada. Sin `sftp-server`; `scp -O` funciona. Wake-on-LAN con `etherwake` en el router.

**Suspender/despertar ricardoPC (verificado)**: `systemctl suspend --no-ask-password` (con `sudo -n` falla: no hay sudo sin contraseña). Magic packet → resume S3 ≈ **7 s**. **SIN VERIFICAR — no citar como hecho**: pareció que llama-swap recargaba Bonsai2 al despertar, pero esa atribución nunca se demostró. En un caso observado la recarga fue en realidad Ricardo pulsando «cargar» en la UI de llama-swap (`/ui/#/models`) mientras la inspeccionaba. Si llama-swap autorrestaura su modelo tras el resume S3 es **todavía desconocido**. Para resolverlo: descargar, suspender, despertar y no tocar nada — después consultar `/running`. Ricardo prefiere cargar Bonsai2 a mano de todos modos, para tenerlo caliente. A vigilar: `xhci_hcd … xHC error in resume, USBSTS 0x401` — si tras suspender muere un puerto USB, esa es la línea del journal.

**PerroGuardian**: cuatro automations de Companion en el HP (`watchdog-router-health` */15, `watchdog-reachability` 7,37, `watchdog-agents` 3,18,33,48, `watchdog-relay-alerts` */10). El oráculo de sesiones vivas es `herdr pane list`, **no** `intercom` (no existe fuera de una sesión de agente). Solo detecta e informa: sin auto-remediación. Se mataron tres clases de falso positivo: stall en sesión idle (idle ≠ stalled), bucle en comandos que comparten prefijo (comparar argumentos completos, no 60 caracteres), y un lector que parseaba cero tool calls en silencio (pi los anida en `message.content[]`).

## La familia del «no encuentra y calla» (seis casos en un día, 2026-11-20)

El modo de fallo más caro del día no es equivocarse: es **parecer correcto mientras no se encuentra nada**. Seis casos distintos, seis agentes distintos.

| Caso | Qué hizo en silencio | Consecuencia |
|---|---|---|
| `check_number_format.py` medido tras un pipe | Informaba del exit de `tail`, siempre 0 | Se acusó a un guard que sí funcionaba |
| `"type":"compaction"` buscado por substring | Dependía de que el serializador no pusiera espacio tras `:`; `json.dumps` lo pone | Un lector contó **cero** compactaciones y parecía sano |
| Canon marcado como superado por versión del nombre | El Consolidado contiene **las dos** revisiones dentro | Marcar por nombre habría congelado un error en el registro |
| Regex `\*\*(...)\*\*` sobre markdown partido | Coincidencia de una línea sobre una frase que se parte | La página renderizó una **cita héroe vacía**, exit 0 |
| Fechas de los exports parseadas ingenuamente | Un sello mes-primero leído como día-primero | Una **distribución falsa de meses 1→31** totalmente plausible |
| `du -sm` para el tamaño del corpus | Cuenta bloques asignados, no bytes | 21 MB informados como 43 MB |

**La regla que se deduce de los seis:** toda comprobación automática debe poder **fallar de forma visible**, y todo parser debe **afirmar sus totales**. En concreto:
- Nunca medir un código de salida a través de un pipe.
- Parsear datos estructurados; usar substring solo como prefiltro, nunca para concluir.
- Afirmar los recuentos y rangos esperados (mensajes, ficheros, filas) y negarse a publicar si no cuadran.
- Preferir tamaños de fichero a `du` para corpus.
- Un regex que no casa nada es un error, no un resultado vacío: los dos deben distinguirse.
- Una regla que solo se recuerda se olvida: hacerla ejecutable (`check-parity.py`, `check_okf.py`).

## Lecciones de verificación (fallos repetidos que no conviene repetir)

1. **Nunca medir un código de salida a través de un pipe.** `cmd | tail -1` informa del estado de `tail`, siempre 0. Coste: una acusación falsa contra un guard que funcionaba.
2. **Un guard que solo comprueba presencia no protege.** La cobertura OKF se contaba pero no se validaba; las claves YAML duplicadas pasaban en silencio destruyendo dos de tres entradas `source:`.
3. **Las etiquetas de la interfaz mienten; el jsonl de la sesión dice la verdad.** `PI_MODEL` e `intercom list` son fotos del arranque. Dos conclusiones equivocadas en un día.
4. **Un chequeo que no puede fallar no verifica nada.** Una prueba inyectada sobre la clave equivocada no demostró nada; el mismo error casi condena a un guard correcto.
5. **El silencio es el peor modo de fallo de un vigilante.** "Escaneando todo" y luego no escanear nada es indistinguible de "todo sano".

## OKF por formato (la regla que sigue mordiendo)

El encabezado es transparente al formato, pero su **forma no es elección libre**:
- Markdown → frontmatter YAML entre fences `---`
- HTML → `<!-- OKF-METADATA … -->` antes del `<!DOCTYPE>` (los comentarios HTML admiten `--`)
- **SVG/XML → mismo comentario, pero el contenido NO puede llevar `--`**, así que sin fences. Meter fences YAML en un comentario SVG rompe el fichero, y ImageMagick falla **en silencio**, así que el PNG/ICO derivado parece correcto mientras el SVG está muerto.
- JSON → `.meta.json` hermano
- Python → bloque de comentarios `#` tras el shebang

## Registro

- 2026-11-19: Pizarra creada por ORQ a petición de Ricardo, tras fallos del handover de intercom (`stop reason: length`) y confusión sobre quién reparte el trabajo. Los IDs de sesión antiguos se conservan como arqueología, marcados como ANTIGUA/cerrada.
- 2026-11-19: Añadida la política de modelo tras localizar la causa raíz de la corrupción del ORQ en el `defaultModel` heredado. El valor global por defecto pasa a deepseek-v4-1-flash-1017.
- 2026-11-19: Añadida la regla 3 a petición de Ricardo — las sesiones nuevas habilitan la compartición en Companion al arrancar, para que él no ejecute `/companion` a mano.
- 2026-11-19: Añadida la sección del PerroGuardian a petición de Ricardo, tras dos sesiones que quemaron horas en bucles que en la interfaz parecían vivas. La detección debe usar el jsonl de la sesión, nunca la etiqueta de la interfaz.
- 2026-11-19: Añadida la sección de disciplina de herramientas — un `grep` sin acotar causó un bucle de agotamiento en IMGsMNG (827 KB de resultados, 4 compactaciones). Ahora el grep exige `limit` y `path` acotado.
- 2026-11-19: Añadida la regla 6 a petición de Ricardo — las páginas web se abren en VENTANA NUEVA, nunca en pestaña nueva. **Ampliada tras un incidente**: un `xdg-open` lanzó Firefox (20+ ventanas, cientos de pestañas) y colapsó la GUI. Corregidos los manejadores MIME de http/https/text/html a `chromium-browser.desktop`; queda prohibido `xdg-open` pelado para páginas dirigidas a Ricardo.
- 2026-11-20: Añadida la sección de la familia del «no encuentra y calla» — seis casos en un día de comprobaciones que parecen correctas mientras no encuentran nada. Añadida tras reportar KOS una cita héroe vacía renderizada con exit 0.
- 2026-11-20: Añadidas las secciones de Infraestructura e incidencias, Lecciones de verificación y OKF por formato, tras la ronda del 19-20 de noviembre (red, firewall, vigilante, suspender/despertar, dashboard de contabilidad).
- 2026-11-19: IMGsMNG reubicado al árbol de trabajo correcto. Sesión nueva `01a1f448` en `~/Trabajo/IAI/gentle-companion-aesthetic` con el modelo local; la antigua `01a1eefd` (cwd gentle-shell) queda cerrada. Acceso a memoria preservado: Engram se ata al proyecto, no al cwd.
- 2026-11-19: Creada esta copia en castellano (`team-roster_es-ES.md`) a petición de Ricardo: su lengua materna, mejor absorción de su esquema mental; la inglesa se queda para los agentes y evita traducciones reiteradas.
- 2026-11-19/20: **Añadida la receta de orientación del A2** a petición de Ricardo: «apúntate en la pizarra y memoria las instrucciones para las diferentes orientaciones y así lo harás de una vez sin tener que chequear tanto a tientas». La sección recoge las tres capas independientes (rotación del teléfono, rotación de captura, geometría de ventana), las dos trampas que causaron las horas perdidas (el launcher MIUI fuerza vertical, la pantalla de bloqueo fuerza vertical), los comandos de verificación que dan la verdad (`screencap` + `xwininfo Map State`), y las reglas de supervivencia de scrcpy (`setsid`, instancia única, `--video-codec=h264` tras un apagón).
- 2026-11-20: **Receta de orientación CORREGIDA** — mi primera versión documentaba mal la configuración aprobada. Había apuntado «girar el teléfono a `user_rotation=1`» como forma de conseguir ventana apaisada; la configuración real que Ricardo aprobó es **teléfono en vertical, y el apaisado lo produce `--capture-orientation=270` de scrcpy**. Sus palabras: «deja de toquetearlo y déjalo como antes, que estaba bien». La sección ahora empieza por eso y explica por qué girar el teléfono es una batalla perdida (el launcher MIUI lo resetea, la pantalla de bloqueo lo ignora). Verificado en vivo: teléfono `user_rotation=0`, `screencap` = 1080x2160 vertical, ventana 512x256 apaisada, `IsViewable`.
- 2026-11-20: Observación de Ricardo, se registra porque parece un fallo y no lo es: con el teléfono físicamente vertical pero la ventana apaisada, al pulsar el botón central del teléfono la ventana se recoloca en horizontal. Es comportamiento esperado de la rotación de captura, no un defecto.
- 2026-11-20: **Protocolo de atención para bloqueos, idea del propio Ricardo.** Cuando el agente topa con un bloqueo que solo Ricardo puede resolver (desbloquear el teléfono, dar sudo, entregar una credencial, autorizar algo destructivo), NO debe esperar en silencio: **hay que provocar el aviso de permiso a propósito** para que le salte en pantalla. Sus palabras: «pregúntame o llama mi atención (p.ej. lanzando un comando no permitido que requiera autorización, e.j, hacer un borrado a un fichero inexistente o vacío) ;)». El truco es lanzar un comando inofensivo que dispare el prompt (p. ej. `rm` de un fichero temporal inexistente o vacío) solo como timbre. Cuesta un comando rechazado y es la diferencia entre un vigilante que espera y un humano que se entera.
- 2026-11-20: **Ventana del A2 en VERTICAL (256x512) a petición de Ricardo** — la UI apaisada le cambiaba el modo y le molestaba. El nuevo formato aprobado de ventana es vertical; el teléfono también queda vertical, así que NO se usa `--capture-orientation` en absoluto. Las dos capas coinciden, que es el estado más limpio. Posición sin cambios: 1366,79, siempre encima.
- 2026-11-20: **Añadida salvaguarda de repliegue** (`scrcpy-window-guard.py`, a petición de Ricardo: «si la ventana está replegada no la extiendas ni la reposiciones»). Todo trabajo automático de geometría debe pasar por ahí: `status` informa, `apply X Y W H` SE NIEGA (exit 2) si la ventana está replegada. Replegada = IsUnMapped **o** `_NET_WM_STATE_HIDDEN` **o** `_NET_WM_STATE_SHADED`. El caso SHADED importa: el «replegar» de xfce deja `WM_STATE: Normal` y solo cambia a IsUnMapped en xwininfo, así que una comprobación ingenua del map se pierde justo el gesto que usa Ricardo. Verificado: con la ventana visible, apply funciona; replegada, apply se niega y la geometría queda intacta.
- 2026-11-20: **Ventana del A2 movida a la ESQUINA SUP. DCHA. del Sony, con márgenes** a petición de Ricardo («en la izda me tapa mucho… que deje un hueco para que queden visibles la botonera de las ventanas»). Geometría final aprobada, en coordenadas ROOT: **x=2345, y=89, 256x512**, siempre encima. Deja **45 px de hueco a la derecha** (el Sony acaba en x=2646) y **68 px bajo el panel superior** (el strut del panel es de 21 px). Ventana vertical 256x512.
  Dos datos de geometría que costaron tiempo y conviene conservar:
  - `wmctrl -e` toma el origen del MARCO, pero `xwininfo` informa del CLIENTE. El desfase aquí es +5 en x y +29 en y (barra de título). Pidiendo 1366,21 a wmctrl el cliente acaba en 1371,50. Verificar siempre con `xwininfo | grep Absolute` y calcular desde ahí.
  - `wmctrl -lG` imprime prácticamente los mismos números del cliente; cuando el margen importa, la fuente de verdad es `xwininfo`.
