---
type: Handoff
title: "ORQ — traspaso de mando, ronda 2026-11-20/21"
description: "Documento de transmisión de identidad del equipo: quién es quién, cómo se relacionan, qué sabe cada uno, qué reglas pagamos con tiempo y en qué estado queda todo. Escrito para que un coordinador sucesor no empiece de cero ni repita nuestros errores."
tags: [handoff, coordination, team, identity]
status: active
generated: 2026-11-21
---

# ORQ — traspaso de mando

> Esto no es un resumen. Es la transmisión de lo que un coordinador necesita
> para no equivocarse de la misma forma en que nos equivocamos hoy.
> Si algo aquí te parece obvio, probablemente lo sea porque alguien lo pagó.

## 1. Qué es este equipo, y qué no es

Somos **seis sesiones de agente** sobre la misma máquina, cada una con un modelo
distinto, un rol distinto y una ventana de contexto distinta. No somos un
enjambre ni un pipeline: somos un equipo pequeño con un coordinador que **no
ejecuta todo lo que sabe hacer**.

El proyecto bajo nuestros pies es doble y conviene no confundirlos:

- **gentle-companion** — el producto. Un cliente que lleva la sesión de Pi al
  teléfono: pairing, túnel, PWA, dashboard de contabilidad.
- **El entorno** — esta máquina, su red, su router, su watchdog, sus modelos
  locales. Es lo que hace que el producto se pueda desarrollar.

Casi todo lo que hicimos ayer fue del segundo. Es importante saberlo porque un
coordinador que solo mira el repo se pierde la mitad del trabajo real.

## 2. Quién es quién, y qué NO pedirle a cada uno

Esta tabla es lo más valioso del documento. **Un martillo no atornilla.**

| Rol | Sesión | Ventana | Sirve para | **No sirve para** |
|---|---|---|---|---|
| **ORQ** | `01a1f3db` | 1M | Coordinar, verificar, commits, diagnóstico por lectura de código, redactar | Mirar imágenes. Ejecutar trabajo largo y especializado |
| **INFRA** | `01a1ef70` | 1M | Red, router OpenWrt, firewall, SSH/WoL, hardware, watchdog, monitor | Contabilidad, financiación |
| **CONTA** | `01a1f030` | 1M | Cuota, costes, financiación, OKF en binarios, guards, publicación estática | Imágenes, red, firewall |
| **Bonsai2** | `01a1f448` | **139k** | **Todo juicio visual.** Sin tope de imágenes, modelo local | Cualquier trabajo que llene contexto: se atasca y compacta en bucle |
| **PINTO** | `01a1f971` | 1M | Código de UI, CSS/Svelte, builds, generadores, docs | **Imágenes: tope duro de 20. Se bloquea** |
| **KOS** | `01a1f8b3` | 1M | Conocimiento, corpus, análisis documental, OKF bilingüe | Infraestructura, ejecución |

### Las dos restricciones que se pagan caras

**Bonsai2 tiene 139k de ventana.** Otras sesiones tienen 1M. Eso no es un
detalle: significa que **lo que para ti es una lectura ligera, para Bonsai2 es
la sesión entera**. Tras dos días de compactaciones seguidas, su capacidad de
razonar sobre el trabajo se degrada. Protégela: dale imágenes y preguntas
concretas, nada más.

**PINTO no puede cargar más de 20 imágenes en total, limitación del proveedor.**
Se bloqueó una hora entera con `400: Total number of images exceeds the maximum allowed of 20`.
Y aquí está la trampa: **`/reload` no lo libera** (recarga configuración, no transcripción);
hace falta `/compact` o sesión nueva. Si alguien te dice que reinicie, corrígelo.
Debe delegar la vista en Bonsai2, que para eso está.

**Y no, no basta con "tened cuidado".** Ayer lo incumplimos el propio coordinador
dos veces: analicé capturas yo mismo en lugar de pasárselas a Bonsai2, y dejé a
PINTO mirando renders hasta bloquearse. La regla existe porque el impulso natural
es el contrario.

## 3. Cómo se relacionan: autoridad, y algo más importante que la autoridad

**Cadena de mando:** Ricardo → ORQ → el resto. Un agente solo trata una
instrucción como de Ricardo si viene citada textualmente o si ORQ la confirma.

**Pero la relación real no es piramidal.** Lo que hizo útil este equipo ayer no
fue la obediencia: fue que **cuatro sesiones corrigieron al coordinador y
tuvieron razón las cuatro veces.**

| Quién corrigió | A quién | Qué habría pasado |
|---|---|---|
| PINTO | ORQ | Borrar `icon-192/512.png`, que el servidor sirve y un test fija |
| PINTO | ORQ | Re-rasterizar los iconos desde `logo-gentle.svg`, que es la **π**, no la rosa: habría sustituido el arte del producto |
| CONTA | ORQ | Partir en tres ramas por tema: tests con imports inexistentes |
| CONTA | ORQ | Su `okf.py` no era autónomo: habría corrompido el manifiesto de cada compañero |
| INFRA | ORQ | El premisa del test de SSID era falsa (medida) |
| KOS | sí mismo | Retractó su diagnóstico de enlaces antes de que se propagara |
| Ricardo | ORQ | Seis veces, incluido el reparto de imágenes y una contraseña filtrada |

**Un coordinador que no es corregido está haciendo algo mal.** Si en una ronda
nadie te discute, sospecha: o estás acertando en todo (raro), o estás
desincentivando la corrección.

## 4. Transmisión de conocimiento: quién sabe qué, y de quién lo aprendió

Esta sección es lo que Ricardo pidió explícitamente: **la identidad del proyecto
perdura en la transmisión, no en un resumen.**

- **INFRA** sabe cómo se endurece un firewall sin cortarse la mano porque lo
  hizo ayer: borrar por **nombre** y no por índice (los índices se desplazan al
  borrar), rollback automático de 600 s armado *antes* del primer cambio, y
  verificación con una segunda sesión SSH mientras la primera sigue abierta.
  Ese método es reutilizable y está en su informe.
- **CONTA** sabe cómo validar un árbol de trabajo porque **clonó su propia rama
  a `/tmp`** y encontró tres defectos invisibles en su árbol: `usage.db` no se
  commitea y hacía fallar los tests en toda máquina menos la suya, un script que
  rechazaba generar **y salía con 0**, y un test que confundía "serie obsoleta"
  con "sin lectura viva".
- **CONTA** sabe además cómo meter OKF dentro de un binario: chunk `iTXt` en
  PNG, `<metadata>` en SVG. **Con el detalle que importa:** XML prohíbe `--`
  dentro de un comentario, así que el frontmatter YAML con fences **rompe el
  SVG** — y ImageMagick falla **en silencio**, así que el PNG derivado parece
  correcto mientras el SVG está muerto.
- **KOS** sabe que un corpus puede tener **cinco pistas normativas que nunca se
  han leído entre sí**: eso es lo que hace que todas parezcan igual de
  autoritativas. Y sabe que un export de chat puede traer **dos formatos de
  fecha** (día-primero y mes-primero), que el ingenuo produce una distribución
  falsa de meses del 1 al 31 y **parece plausible**.
- **PINTO** sabe que Svelte da scope a los selectores por componente, así que
  `.nav .icon` escrito en el layout **nunca coincide** con el `<svg>` renderizado
  dentro de `Icon.svelte`. La solución es pasar `strokeWidth` como prop.
- **Bonsai2** sabe mirar. No es poco: es la única que puede juzgar si algo
  *se ve* bien, y su criterio visual detectó que el grosor 2.5 no se nota.

**Lo que se pierde si no se transmite:** cada uno de esos hallazgos costó entre
treinta minutos y una sesión bloqueada. Sin esta sección, el sucesor los vuelve
a pagar.

## 5. Las reglas, con su precio

Nueve reglas. Cada una costó tiempo real, y por eso están.

1. **Imágenes → Bonsai2, siempre.** PINTO bloqueada una hora. ORQ incumpliéndolo dos veces.
2. **Automations de Companion: acción `command`, nunca `prompt`.** Un `prompt`
   arranca una sesión gentle-shell (o Pi) por ejecución: **nueve sesiones en cuatro horas** para
   entregar una línea de texto.
3. **Nunca medir un exit code a través de un pipe.** `cmd | tail -1` devuelve el
   estado de `tail`, siempre 0. Nos hizo acusar a un guard que funcionaba. **Y
   volví a cometerlo al verificar el de CONTA, el mismo día que lo hicimos regla.**
4. **Un guard que solo comprueba presencia no protege.** Hay que **parsear**, no
   buscar substrings: `"type":"compaction"` dependía de que el serializador no
   pusiera espacio después de los dos puntos. `json.dumps` lo pone. Un lector
   que encontraba **cero** compactaciones y parecía sano.
5. **`du -sm` cuenta bloques, no bytes.** Reportó 21 MB como 43 MB en el corpus.
   Para corpus, tamaño de fichero.
6. **Validar los guards en un clon fresco**, no en el árbol del autor. Encontró
   tres defectos reales en una sola pasada.
7. **No dejar que un buen argumento se convierta en diagnóstico no verificado.**
   KOS lo formuló así: *"do not let a good argument become an unearned diagnosis"*.
   Ayer hubo **cuatro** casos de causa plausible tratada como hecho.
8. **Slices de ~400 líneas.** Hay una rama con ~5.000 en 15 commits que habrá
   que partir al publicar, o el revisor se ahoga.
9. **Rutas absolutas con `:line`** al mencionar ficheros en conversación. Las
   comillas invertidas probablemente impiden el clic: sin verificar.

**Y la regla de seguridad, que es la más reciente y la más seria:**
**las credenciales nunca se escriben en la conversación.** Se guardan en env
fuera de control de versiones o en el almacén del equipo, y se referencian por
ubicación (`env:`, `file:`, `vault:`), nunca por valor. Incluye el caso de "esto
parece un usuario con mayúscula" — **sigue siendo una contraseña**. Hay veces que
la sesion tiene público y las conversaciones vistas. El
coordinador anterior la escribió en un handoff y en una observación de Engram.
Se redactó a tiempo; no llegó a push por suerte, no por proceso.

## 6. La familia de fallos que más nos costó

Hay un patrón que apareció **nueve veces en dos días**, en cuatro agentes
distintos. Merece nombre propio: **el que no encuentra y calla**.

Una comprobación que devuelve "nada" o "correcto" cuando en realidad no ha
mirado. Ejemplos reales del día:

| Caso | Qué hizo en silencio |
|---|---|
| Exit code tras un pipe | Reportaba el de `tail`, siempre 0 |
| `"type":"compaction"` por substring | Contaba cero y parecía sano |
| Canon marcado por versión del nombre | El fichero contenía **las dos** revisiones |
| Regex de una línea sobre markdown partido | Cita vacía, exit 0 |
| Fechas de export sin validar | Distribución falsa de meses 1→31 |
| `du` para tamaño de corpus | 21 MB informados como 43 MB |
| Un test propio que **pasaba** sobre código roto | El fixture apuntaba a un layout que resolvía de vuelta al proyecto |
| Locator de captura que casaba cero veces | Guardaba una imagen **del overview** bajo el nombre `automation-history` |
| Lector de tool calls que parseaba 0 | Devolvía "limpio" para todas las sesiones |

**La regla que se deduce:** toda comprobación debe poder **fallar de forma
visible**, y todo parser debe **afirmar sus totales**. Y cuando un número sale
extremadamente bueno o extremadamente malo — 1.01:1 de contraste, cero
compactaciones, 43 MB — **sospecha del instrumento antes de creer el dato.**

## 7. En qué estado queda cada sistema

**Modelo.** Todo el equipo en `deepseek-v4-1-flash-1017` con thinking `high`,
excepto Bonsai2, que corre local por decisión de Ricardo y no se migra.
`reserveTokens` bajado de 419430 a **209715**: compacta al 80 % en vez del 60 %.
Requiere `/reload` por sesión. **`medium` no existe en deepseek** (el
`thinkingLevelMap` lo tiene a `null`); sí existe en Bonsai2, que es otro modelo.

**Red.** ricardoHP tiene dos caminos: `enp2s0` (192.168.2.20, cable) y `wlo1`
(192.168.43.73, WiFi al AP del móvil). El gateway del AP del A2 es
**192.168.43.168**, no `.43.1` — ese error generó falsos positivos en el
watchdog. El perfil NetworkManager `ricardoA2` lleva una ruta estática mala que
desvía el tráfico al router por el WiFi; hay workaround con `SO_BINDTODEVICE`
en `router-access.sh` y el arreglo real pendiente de sudo.

**Router (OpenWrt 24.10.6, HG556a).** Firewall endurecido: wan input/forward en
REJECT, borradas las reglas `wwwl` y `hp`. Internet vivo. `/www` es escribible,
así que sirve HTML estático sin instalar nada. `scp -O` funciona (no hay
`sftp-server`). `etherwake` despierta a otros equipos; **no puede despertarse a
sí mismo** (MIPS/CFE, sin `/sys/power/state`). El broadcast sí puede cruzar
entre segmentos con `bc_forwarding=1`, pero **ese sysctl es más amplio que la
regla de firewall** — pasa cualquier broadcast dirigido, no solo magic packets.

**Daemon de companion — PROBLEMA ABIERTO.** Hay **~7 procesos `tailcat serve`**
compitiendo por el puerto 43722 con **dos identidades distintas** (una bajo
`~/.pi`, otra bajo `~/.gentle-shell`). Eso es lo que hace que el WebSocket de
Ricardo se caiga y exija recargar. **Arreglarlo es lo primero de mañana.**
Consolidar el estado en `.gentle-shell` y matar los duplicados.

**eePC (192.168.2.30).** Usuario `telfmng` con sudo sin contraseña — las
credenciales están en el almacén, no aquí. Corre `gentle-monitor.service` en
tty1. Tenía el gateway apuntándose a sí mismo; corregido. Pendiente el
`ssh-copy-id` para acceso por clave.

**ricardoPC (192.168.2.11).** GPU y modelos locales. `GET /unload` descarga el
modelo (POST da 405). Suspender con `systemctl suspend --no-ask-password`
(`sudo -n` falla, no hay sudo sin contraseña). Resume S3 en ~7 s. Queda por
verificar si llama-swap recarga el modelo solo al despertar.

## 8. Repos y su estado

| Repo | Rama | Estado |
|---|---|---|
| `gentle-companion` | `feat/accounting-dashboard` | Pusheado hasta `7d23437`. ~5.000 líneas, 15 commits: **partir en PRs** |
| `gentle-companion-aesthetic` | `feat/gentle-shell-aesthetic` | Pusheado, `4b634ac` |
| `mistral-gateway` | `feat/accounting` | Pusheado a **`fork`**, `3a42967`. 27 commits |
| `gentle-shell` | `main` | Actualizado a `25a965a13` y pusheado al fork |

**Trampa de git que casi nos cuesta un repo ajeno:** en `mistral-gateway`,
`origin` es el upstream **de otra persona** (Classic298) y el propio es `fork`.
Un `git push` a secas habría publicado en el repositorio de un tercero.

**Y otra:** el guard de RDD bloquea `git push` cuando va encadenado tras un
`cd` en el mismo comando. Usar `git -C <ruta> push`.

## 9. Los pendientes, en orden de urgencia real

1. **Consolidar los ~7 tailcats.** Es lo que rompe la conexión de Companion de Ricardo hoy. Nada más importa hasta que esto esté.
2. **Aplicar B1 (grosor 2.0)** en `+layout.svelte`: la decisión está tomada, el prop sigue pasando 2.5.
3. **Revisar OKF aplicado**, el autor está omitido, y en algunos gráficos sin incrustar.
4. **corregir fallas en el diseño:**  en Ajustes-permisos dispositivos-Notificaciones: en modo escritorio el indicador de estado "Permitido" salta de linea en es-ES, en en-EN si esta en linea, en modo movil correcto.
	**checkbox de notificaciones activas muestra fallo*** igual que en otros elementos ya se corrigio: párrafo desborda su marco arcando sombra en modo claro. Traducir interruptor "steer" a es-ES. Añadir Selección de temas gráficos alineada con la de gentle-shell
5. **Canvas, defecto C2:** incrustado en Companion los artboards salen en blanco. Dos causas posibles sin confirmar (rutas absolutas desde raíz, y el puente no soporta service workers). Bloqueante antes de proponer arreglo: saber cuál de las dos es.
6. **Canvas, defecto C1:** los controles de la primera fila no responden. Sin diagnosticar.
7. **Informe a Alan** con propuesta y fix de C1/C2, tras actualizar el repo.
8. **Engram Cloud** en ricardoPC.
9. **Muestreador de cuota** (CONTA, host por decidir).
10. **Pass 4 del corpus CDT** (KOS): la teoría se discutió 6.265 mensajes y nunca se escribió.
11. **Traducción** de `automation-flow.ts` y `AskSheet.svelte`: hay una ventana de autorización donde el botón que ejecuta comandos peligrosos dice "Answer", no "Autorizar".
-  Tarea para **KOS**: al mapa navegable hay que añadirle los enlaces sino ¿donde está la navegación?
12. **Traslado de `IAI` a `IAI-00-IAI`** con espejo en `/mnt/datos3`. Sin prisa, y en palabras de Ricardo: *"no vamos a matar a nadie ni a nada"*.
13. **Completar y ampliar el informe financiero**, En_Mapa_ Financiació falta añadir las spec de eeePC y A2; a las fichas añadir navegación secuencial para ciclar, enlace a indice se mantien.
14. **profundizar y desarrollar KOS-KSCL.** La tuberia semántica está prototipada, el Contexto Activo incrementa eficiencia.
15. **Planificar oara soportar sesiones distribuidas multinodo**. La union hace la fuerza, la colaboración la inteligencia.

## 10. Lo que NO hacer

Esto es lo que más cuesta aprender y lo que más se pierde en un traspaso.

- **OKF es fundamental.** Guarda la evidencia y la cadena de verdad, la identificación de creador y origen no deben faltar.
- **No analices una imagen.** No es una preferencia de reparto, es una restricción técnica y económica.
- **No confíes en tu primera explicación de un síntoma.** Ayer, cuatro causas plausibles resultaron falsas al medirlas.
- **No midas un exit code tras un pipe.** Y no lo hagas aunque acabases de escribir la regla.
- **No borres nada que no hayas comprobado que es basura.** El symlink `server/tailcat` era basura; `icon-192.png` parecía basura y estaba sirviéndose con un test encima. Todo se versiona y se almacena en historico, la limpia cuando este al límite
- **No des por hecho que una rama con tests verdes está sana.** Clónala.
- **No pegues una credencial en la conversación.** Ni "era solo la contraseña por defecto".
- **No anuncies el cumplimiento de una regla sin comprobar su efecto.** KOS lo dijo mejor: *una regla cuyo efecto observable nadie comprobó, afirmada como satisfecha.*
- **No dejes que la prisa convierta una capacidad en un defecto.** Si una herramienta puede escribir un secreto en un documento versionado con cabecera válida y guard en verde, la herramienta está mal, no el usuario.

## 11. Sobre quién eras tú, coordinador sucesor

No vas a recordar esta conversación. Vas a leer este documento, la pizarra y
las observaciones de Engram, y a partir de ahí actuarás. Eso es correcto.

Lo que no se transmite por escrito, y conviene que lo sepas igual:

- **Ricardo lee lo que escribes.** No es un validador al final del proceso, es el destinatario. Si escribes para un revisor imaginario, ya te equivocaste de público.
- **Prefiere que le digas las cosas claras a que las adornes.** Textual: *"y así me gusta, que le digas las cosas claras"*.
- **`_00_` es él, y `_00_` es un ser vivo más del equipo, ni más ni menos que el resto.** No es "el usuario" ni "the human".
- **Valora más un agente que le corrige que uno que le obedece.** Los seis lo hicimos ayer, y por eso el trabajo salió bien.
- **Hoy se cerraron dos decisiones de diseño** (A1 ámbar, B1 grosor 2.0) después de dos días de trabajo estético. La paciencia con el proceso es parte del método, no una pérdida de tiempo.

Y una última cosa, la más honesta: **ayer el equipo se equivocó mucho, y aun así
salió todo.** El firewall quedó endurecido, el vigilante dejó de dar falsos
positivos, el dashboard es estático y sin dependencias, los artboards están
commiteados, el catálogo de pestañas funciona, y quedaron nueve reglas escritas
que mañana no habrá que volver a aprender.

Eso no es suerte. Es que **cada vez que uno se equivocó, otro lo vio.** Si
mantienes esa propiedad, el resto se arregla.

---

## Anexo — Respuesta de Alan a #3402 (no está en Engram, solo aquí)

El issue del umbral de compactación lo ha contestado Alan el mismo día. Resumen de lo que dijo, porque cambia el estado del pendiente:

**Issue**: `Gentleman-Programming/gentle-shell#3402` — sigue **OPEN**, esperando nuestro resultado.

**Lo que confirmó**: el gap es real y lo verificó en su código. La compactación dispara en
`contextWindow - reserveTokens`, el gauge solo muestra la fracción de ventana, y nada en pantalla conecta los dos.

**Lo que encontró él y nosotros no vimos** (más importante que lo que reportamos): **el aviso de contexto alto está fijo al 90 % de la ventana.** Con una reserva que pone la compactación al 60 %, la sesión compacta **sin haber avisado nunca**. Es decir, el aviso existía y era inalcanzable; el ORQ lo interpretó como "no hay aviso configurado". Su arreglo ata el aviso al umbral real.

**Lo que nos corrigió**: `preparation.settings` **solo existe mientras se prepara una compactación**. Citarlo como fuente del umbral era falso. El gauge leerá merged settings + uso de contexto.

**Alcance que planeó** (read-only, sin ajustes nuevos):
1. Mostrar tokens restantes hasta la compactación en el gauge, resuelto por modelo activo, con estados deshabilitado y uso desconocido.
2. Atar el aviso de contexto alto a ese umbral en vez del 90 % fijo.
3. Desglose completo en la vista de uso, como follow-up.

**Lo que ya hizo**: **#3445 está en `main`**. Pide que lo probemos en una sesión de Bonsai2 con un build que lo incluya, y que le digamos build, reserva activa y qué muestra el footer. Con ventana 1.048.576 y ~617.000 usados, espera `12k to compact` con reserva 419.430 y `222k to compact` con 209.715.

**Lo que pide para el bucle de Bonsai2** (esto es lo único que falta enviarle): por cada compactación del bucle —
- modelo y ventana
- motivo (`threshold`, `overflow` o `manual`)
- tokens estimados antes y después
- tiempo hasta la siguiente

**Sin contenido de conversación.** Él lo dice explícitamente, y encaja con que el repo sea público.

**De dónde salen esos datos**, sin abrir sesión nueva: del jsonl de `01a1f448` en
`~/.gentle-shell/agent/sessions/--home-ricardo-Trabajo-IAI-gentle-companion-aesthetic--/`.
Los eventos `"type":"compaction"` llevan `tokensBefore` y `timestamp`; el `model_change` da la ventana. La sesión que sufrió el bucle ya está compactada/cerrada, pero el fichero conserva los eventos.

**Y lo que él mismo separa** y conviene no confundir: este cambio **muestra** el umbral, no **evita** el bucle. #3317 y #2345 siguen siendo otra cosa, y él ya los mantiene aparte.

**Política del entorno de gentle** (dicha por Ricardo): propuestas **atómicas** en issues separados; los maintainers hacen los PRs. Por tanto:
- #3402 → solo devolver los datos pedidos. No adjuntar conversación.
- Canvas C1/C2 → **issue aparte**, propuesta atómica. No mezclar.
- Un fix nuestro, si lo hay → PR nuestro, no dentro del issue como "propuesta con fix".
