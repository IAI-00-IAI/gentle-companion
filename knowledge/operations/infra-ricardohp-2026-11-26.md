# Infraestructura de ricardoHP — estado 2026-11-26

Documento de referencia del servidor web y su monitorización. Escrito para que otro
agente (o Ricardo dentro de dos meses) pueda retomarlo sin arqueología.

## Panorama

```
Internet ──→ Cloudflare (TLS) ──túnel──→ cloudflared ──→ nginx :80
                                                            ├── torre-nueva.net       portal + /kos /conta /design
                                                            ├── www.torre-nueva.net    «en construcción»
                                                            ├── companion.torre-nueva.net  PWA (proxy 43722)
                                                            ├── dev.torre-nueva.net   SOLO LAN, trabajo por departamentos
                                                            └── default_server        444 (cierra conexiones)
```

**Por qué `dev.` no está en el túnel**: expone puertos y topología interna. Un hostname
ausente de `/etc/cloudflared/config.yml` no existe desde Internet — ese es el mecanismo
de protección, no un acuerdo verbal.

**Por qué `www` no está en el túnel**: Ricardo lo dejó como placeholder público vía
DNS de Cloudflare, pero el hostname del túnel es otra decisión. Hoy `www` solo responde
en LAN.

## El panel de servicios

`http://dev.torre-nueva.net/servicios/`

Generado por `services-panel.py` desde los sockets reales, no desde una lista escrita a
mano. Tres grupos, tal como los pidió Ricardo: **Web y documentos**, **Servicios de
agentes**, **Sistema**. Más **Sin identificar** para lo que escucha y no se puede leer.

### Qué muestra cada fila

| Columna | De dónde sale |
|---|---|
| Puerto | `ss -ltnp` |
| Servicio | Catálogo o nombre del proceso |
| Para qué | Catálogo |
| Alcance | `solo local` (127.0.0.1) o `accesible` (0.0.0.0) |
| Unidad | Catálogo de puerto→unidad |
| Estado | `systemctl is-active`, **por código de salida** |

### Reglas que no son obvias

**Una fila por puerto.** Un puerto en IPv4 e IPv6 es un servicio, no dos. Gana el bind
comodín. Sin esto el recuento engaña.

**`systemctl` se consulta en los dos ámbitos.** `pi-companion.service` responde `4` al
ámbito de sistema y `0` al de usuario. Preguntar solo al sistema etiqueta todo como
«sin unidad», que lee como «nada lo gobierna» cuando la verdad es «pregunté en el sitio
equivocado».

**`sin unidad` ≠ `parado`.** Los servicios con unidad dicen `activo` o `parado`. Los que
no la tienen dicen `sin unidad`, y eso es información, no un fallo.

**Los puertos altos sin proceso se ocultan con motivo.** Son conexiones de cliente y
ayudantes de NFS. Van a un `<details>` plegable, nunca se borran en silencio: un lector
debe poder comprobar qué quedó fuera.

**Un servicio declarado que no escucha se muestra.** `canvas :42071` y `daemon dev
:9911/:9912` están en `DECLARED`: aparecen como **no escucha**. Un servicio ausente es
un dato que Ricardo quiere ver, no algo que desaparece de la tabla.

## El watchdog

`services-watchdog.sh`, cada 10 minutos por la automation `watchdog-services-panel`
(id `844fdea8-5296-4cb0-b21e-a0c4620bc795`).

1. Regenera el panel y la portada de `dev.`
2. Compara los puertos sin vigilar con la pasada anterior
3. Alerta **solo si un puerto es nuevo Y sin vigilar**

### Por qué la alerta es de «nuevo», no de «sin vigilar»

Un servicio llevando semanas sin unidad es deuda técnica, no incidente. Alertar de eso
cada 10 minutos entrena a ignorar la alerta, y así se pierde la que importa. El backlog
completo sigue visible en el panel, en la sección «Requiere atención».

### Comprobación de que no repite alerta

```bash
sh ~/.local/share/gentle-watchdog/services-watchdog.sh   # primera: NEW ...
sh ~/.local/share/gentle-watchdog/services-watchdog.sh   # segunda: new: (vacío)
```

## La portada de `dev.`

`gen-dev-index.py` construye `dev/index.html` leyendo los directorios que tienen
`index.html`. Una sección nueva aparece sola: no hay que editar el script.

Orden: `servicios` primero (es lo que un lector quiere al llegar), luego alfabético.

## nginx: cosas aprendidas por las malas

**`default_server` es obligatorio.** Sin él, un Host desconocido cae en el primer bloque
del puerto — medido: `Host: no-existe.inventado` devolvía la PWA de Companion con 200.
`return 444` cierra la conexión sin respuesta, que es la respuesta correcta para un
nombre que no existe.

**`location ~ \.md$` con `root` no hereda el `alias` de un `location` de prefijo.** El
error log lo probó: `/kos/LEER-PRIMERO.md` se resolvía contra `sites/dev/kos/` y daba
404. Hay que repetir el `alias` dentro del regex.

**El túnel manda sobre el panel.** En túneles con `config.yml`, los hostnames del fichero
son los que valen. Añadir uno en el dashboard no basta.

## La PWA de Companion y su cabecera `Origin`

El daemon (`gentle-companion-server`) valida `Origin` contra una lista construida de tres
fuentes: loopback, `publicUrl` y `PI_COMPANION_ALLOWED_ORIGINS`. El dominio público no
estaba en ninguna, así que el navegador recibía 403 en todos los chunks mientras `curl`
—que no envía `Origin`— obtenía 200.

Configurado en el drop-in `~/.config/systemd/user/pi-companion.service.d/10-origins.conf`:

```
Environment=PI_COMPANION_ALLOWED_ORIGINS=http://192.168.43.73:43722,https://192.168.43.73:43723,http://192.168.2.20:43722,https://192.168.2.20:43723,https://companion.torre-nueva.net
```

**`Environment=` en un drop-in reemplaza, no suma.** Hay que repetir la lista completa.

**La prueba que lo resolvió**: el mismo fichero con y sin `Origin`. Un segundo de
trabajo, tras varias hipótesis falsas (caché, IPv6, proxy, comodín DNS).

## Entorno de terminal

`systemctl --user` necesita `XDG_RUNTIME_DIR` y `DBUS_SESSION_BUS_ADDRESS`. Sin ellas
responde **«no existe la unidad»**, no «no puedo conectar» — un entorno incompleto
disfrazado de servicio ausente.

Añadido a `~/.bashrc`. Detalle en `~/servidor/docs/terminal-sin-bus-systemd.md`.

## Ficheros

| Ruta | Qué |
|---|---|
| `~/servidor/sites/ricardohp.conf` | vhosts: portal, www, ricardohp, catch-all |
| `~/servidor/sites/companion.torre-nueva.net.conf` | vhost de la PWA |
| `~/servidor/sites/dev.torre-nueva.net.conf` | vhost de trabajo (LAN) |
| `~/servidor/sites/websocket-upgrade.conf` | map para WebSocket |
| `~/servidor/sites/tunnel-config.yml` | ingress del túnel |
| `~/servidor/sites/portal/index.html` | puerta principal |
| `~/servidor/sites/www/index.html` | «en construcción» |
| `~/servidor/sites/gen-dev-index.py` | portada de dev. |
| `~/servidor/sites/gen-agent-index.py` | índices por agente (JSON + plantilla) |
| `scripts/watchdog/services-panel.py` + `.html` | panel |
| `scripts/watchdog/services-watchdog.sh` | watchdog |
| `~/.local/share/gentle-watchdog/` | copias en runtime |

Rama: `feat/watchdog-health-board`. Commits: `85b0c97`, `38736aa`, `d1e31d7`.

## Pendiente

- **Cuatro servicios sin unidad**: canvas `:42071`, daemon dev `:9911`/`:9912`, engram
  `:7437`. Convertirlos en `systemctl --user` los haría gobernables y quitaría el
  backlog del panel.
- **Clasificación público / interno / nunca** para pizarra (`knowledge/operations/`) e
  informes de cuota (`mistral-gateway/accounting/informes/`). Sin esa decisión no se
  puede «colgar todo».
- **Pulsador de servicios**: no escrito. Requiere decidir auth y alcance. Hoy solo dos
  servicios tienen unidad, así que alcanzaría a muy pocos.
- **`www` público**: hoy solo LAN. Añadir al túnel si se quiere.
- **TLS en origen**: innecesario con el túnel (el tramo ya va cifrado). Certbot está
  corriendo sin nada que hacer.
