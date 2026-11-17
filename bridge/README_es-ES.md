# bridge — arnés de pruebas manual para el transporte del túnel tailcat

Este directorio contiene los shims de transporte del túnel tailcat
compartidos con la UI real de Companion, más una página de pruebas
estática para ejercitarlos. El shim HTTP-over-stream (`http.js`) y el
shim WebSocket-over-stream (`ws.js`) son la fuente única que consumen
esta página y la UI de Companion (que los importa directamente — no hay
copias); esta página (`index.html` más JavaScript plano, sin paso de
build) queda como arnés manual: carga la compilación WASM de tailcat,
marca (`dial`) la dirección `tc…` del daemon y luego sirve HTTP
(`/api/context`) y WebSocket (`/ws/browser`, usando el subprotocolo
`token.<t>`) sobre el stream tunelizado, las mismas rutas que usa la
superficie de dispositivos emparejados.

> **Experimental.** Es una herramienta de desarrollo para ejercitar el
> túnel, no un producto terminado. Espera irregularidades y cambios.

## Requisitos previos

- Un daemon en ejecución con **Configuración → Túnel** activado, de modo
  que muestre una dirección `tc…` de tailcat (visible en
  **Configuración → Túnel**, con un botón de copiar y un código QR).
- La distribución WASM de vendor (ver abajo), que se incluye en este repositorio.

## Compilar la distribución vendor

La página necesita los artefactos WASM precompilados de tailcat en
`bridge/vendor/`: `main.wasm`, `main.wasm.gz` y `wasm_exec.js`
(~35 MB, ahora incluidos en el repositorio). Se compilan desde el repositorio tailcat; ver
[vendor/README_es-ES.md](vendor/README_es-ES.md) para los comandos exactos.

## Alojar la página

El puente son archivos estáticos simples, así que cualquier servidor de
archivos estáticos sirve:

    cd bridge
    python3 -m http.server 8080

Alternativamente, copia el directorio `bridge/` al host de la URL pública
del daemon y sírvelo desde ahí. Alojarlo desde el origen público del propio
daemon es la opción más simple porque ese origen ya está permitido por la
superficie de dispositivos (ver la nota de seguridad abajo).

## Usar el puente

1. Abre la página alojada en un navegador.
2. Pega la dirección del túnel del daemon (`tc…`) y el puerto de
   dispositivos (el ajuste **Puerto del túnel**, o el puerto de
   dispositivos del daemon cuando es `0`; por defecto `43722`).
3. Pulsa **Dial**. La página marca el daemon a través del túnel y sondea
   la API con una petición `GET /api/settings`.
4. Pulsa **Test WS** con un token de dispositivo para abrir un WebSocket
   tunelizado a `/ws/browser` (el token viaja en el subprotocolo
   `token.<t>`, como la conexión en vivo de la UI) e informar del primer
   frame recibido.

## Nota de seguridad

- La dirección del túnel es sensible: trátala como un código de
  emparejamiento. Concede acceso a través del túnel, así que no la
  compartas públicamente ni la commitees en un repositorio.
- La superficie de dispositivos del daemon aplica una lista de orígenes
  permitidos (el origen de la URL pública, los orígenes loopback de
  dispositivos, más `PI_COMPANON_ALLOWED_ORIGINS`). Una página de puente
  alojada en otro sitio debe tener su origen listado en la variable de
  entorno `PI_COMPANION_ALLOWED_ORIGINS`, o servirse desde el origen
  público del propio daemon, para que su WebSocket conecte.
