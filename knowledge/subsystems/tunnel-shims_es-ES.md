---
type: Subsystem
title: Shims del túnel
description: Clientes HTTP/1.1 y RFC 6455 hechos a mano sobre el túnel, y los tres arreglos medidos que los hacen funcionar.
tags: [subsystem, bridge, websocket, http, tunnel]
status: stable
generated: { by: agent:gentle-shell/4.8.0-main.95179bd6db8e, at: 2026-11-17T11:23:06Z }
sources:
  - id: http-js
    resource: bridge/http.js
    title: HTTP/1.1 encoder and response parser
  - id: ws-js
    resource: bridge/ws.js
    title: RFC 6455 client
  - id: transport-ts
    resource: ui/src/lib/tailcat-transport.ts
    title: createTunnelTransport, DeferredTunnelSocket
---

# Shims del túnel

El runtime de tailcat expone un dialer de bytes crudos, no `fetch` ni `WebSocket`. Así que el
cliente lleva su propio encoder de HTTP/1.1 y su propia implementación de RFC 6455 — unos
1700 líneas de `bridge/`, y el código más delicado del proyecto.

La UI los importa directamente (`ui/src/lib/bridge.ts` re-exporta, sin copias), con un test
que lo ancla para que una copia no diverja.

## HTTP/1.1 — `bridge/http.js`

`encodeRequest` (`:36–59`) escribe la request line, `Host: companion.device` como
placeholder, `Connection: close`, los headers extra title-cased, y un cuerpo JSON con
`Content-Length`.

`createResponseParser` (`:67–183`) es incremental: lee hasta `\r\n\r\n`
(`findHeadEnd`, `:78`), y después un cuerpo delimitado **estrictamente por Content-Length**
o por lectura-hasta-EOF. La codificación chunked está deliberadamente sin soporte (comentario
del header `:9–11`) — el daemon nunca la emite, y soportarla sería código sin probar en un
camino crítico.

### Arreglo 1 — acumulación de cuerpos multi-chunk

Este era el gran bug latente. `parseBody` (`:123–131`) ahora hace
`body = concatBytes(body, buf)` **antes** del chequeo de longitud.

Antes del arreglo, el parser comparaba la longitud del último chunk contra el
Content-Length, así que cualquier respuesta mayor que un chunk fallaba con
"connection closed after 1050 of 22929 body bytes". Funcionaba con JSONs chicos y fallaba en
cada payload real — el tipo de bug que parece una red inestable durante semanas.

`finish()` (`:166–179`) lanza error en un EOF prematuro con los conteos de bytes exactos,
que es lo que hizo diagnosticable el bug.

### Arreglo 2 — nada de half-close tras escribir

`bridgeFetch` (`:204–241`) **no** llama `closeWrite()` después de enviar. El comentario
(`:215–220`) documenta la medición: con un half-close, 2 de 10 GETs y 3 de 3 POSTs volvían
con un EOF de 0 bytes a través del relay DERP, porque el FIN adelanta a los bytes de la
petición en vuelo en los goroutines independientes de la conexión WASM. Sin eso, 10 de 10
funcionan. El `connection: close` del daemon delimita la respuesta en su lugar.

El mismo orden aplica en `:212–214` — esperar la escritura antes de hacer cualquier otra
cosa, por la misma razón de goroutines.

### Arreglo 3 — dialer explícito por petición

`createTunnelTransport` (`ui/src/lib/tailcat-transport.ts:96–99`) pasa el dialer
explícitamente en cada llamada a `bridgeFetch`.

`setBridgeDialer` es un global a nivel de módulo. Dos peticiones `refresh()` concurrentes
competían: la segunda limpiaba el dialer que la primera estaba por usar, produciendo
"no bridge dialer available". Pasarlo por petición elimina el estado compartido por
completo. Anclado con regresión en `ui/tests/tailcat-tunnel.test.ts:437–456`.

## RFC 6455 — `bridge/ws.js`

Un cliente completo: SHA-1 en JS puro (`:68–127`, porque Web Crypto no tiene SHA-1
síncrono), `computeAccept` (`:128–130`), frames de cliente enmascarados (`:140–169`), un
parser de frames incremental (`:180–233`), y `TunnelWebSocket` (`:235–500`).

| Aspecto | Dónde | Detalle |
| --- | --- | --- |
| Handshake | `:297–327` | GET + Upgrade/Connection/Key/Version-13, subprotocolos, Origin |
| Validación | `:355–389` | 101, `Upgrade: websocket`, digest de accept, subprotocolo ecoado; tope de 64 KB |
| Fragmentación | `:414–457` | Acumulación CONT hasta FIN; los control frames se intercalan; un CONT suelto se ignora |
| Ping | `:445–451` | Pong automático |
| Close | `:459–479` | Eco del frame de cierre del servidor, y después `closeWrite()` — tras esperar la escritura |

La validación estricta del handshake no es pedantería: un proxy que respondiera 200 con una
página HTML quedaría en manos de la aplicación como si fuera un WebSocket, y el fallo se
manifestaría como corrupción de mensajes misteriosa.

## DeferredTunnelSocket

`ui/src/lib/tailcat-transport.ts:163–252` le da al llamador un socket **síncrono** mientras
el dial asíncrono resuelve, y respeta fielmente la semántica del navegador:

- `send` antes de abrir lanza error (`:242–245`), como un WebSocket real.
- `close` mientras conecta entrega `onclose(1006)` y cancela el dial (`:227–240`).
- Un fallo de dial entrega `onerror` y después `onclose(1006)` (`:222–228`).
- Los eventos del shim se envuelven en las formas reales de `MessageEvent`/`CloseEvent`
  (`:150–160`).

Sin esto, `LiveConnection` — que espera un WebSocket de navegador — necesitaría un segundo
camino de código para el túnel.

## Reintento ante un stream truncado

`createTunnelTransport` reintenta **una vez** cuando el error dice
`connection closed before response headers` o `connection closed after …`
(`:100–110`). El relay DERP corta aproximadamente una de cada tres dials frescos, según la
medición en el comentario (`:93–95`). Un solo reintento convierte eso en una demora
invisible.

## Qué no funciona por el túnel

| Capacidad | Estado | Por qué |
| --- | --- | --- |
| Peticiones y respuestas JSON | Funciona | El caso común |
| Subida de archivos (`FormData`) | Rechazada (`:74–76`) | Sin streaming de cuerpo en el shim |
| Descarga de blobs | Rechazada (`:71–73`) | Igual |
| Reload fuera de LAN | Imposible sobre HTTP plano | Necesita HTTPS + un service worker |

Estos son límites documentados, no fallos silenciosos — el transporte lanza error en lugar
de producir una petición corrupta.

## Verificación

`ui/tests/tailcat-tunnel.test.ts` tiene 32 tests que cubren la detección de modos, el
mapeo de transportes, el dialer y la selección de DERP, `DeferredTunnelSocket`, y la
regresión del dialer concurrente. `bridge/http_test.mjs` tiene 42 checks;
`bridge/ws_test.mjs` cubre el codec de frames y el orden de cierre.

## Relacionados

- [UI](../subsystems/ui_es-ES.md) — la política de transporte que elige este camino
- [Tailcat](../subsystems/tailcat_es-ES.md) — el túnel sobre el que corren estos shims
- [Fallback de túnel](../flows/tunnel-fallback_es-ES.md) — cuándo se usa
