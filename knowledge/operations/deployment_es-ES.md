---
type: Operations
title: Despliegue
description: Las variables de entorno que importan, las tres formas de conseguir un origen de cliente seguro, y la allow-list de orígenes que traba a todos.
tags: [operations, deployment, tls, pages, origins]
status: stable
generated: { by: agent:gentle-pi, at: 2026-09-27T00:00:00Z }
sources:
  - id: main-env
    resource: server/src/main.rs
    title: Environment variables and origin handling
  - id: tls-doc
    resource: docs/daemon-tls.md
    title: TLS guide
  - id: pages-doc
    resource: docs/static-client-host.md
    title: Static hosting guide
---

# Despliegue

Tres formas de despliegue, de la más simple a la más capaz.

## Forma 1 — solo LAN

Nada que configurar. El daemon hace bind en `127.0.0.1:43722` por defecto; definir
`PI_COMPANION_DEVICE_ADDR=0.0.0.0:43722` (o `settings.deviceBind`) lo expone a la red, y hay
que agregar el origen del teléfono a la allow-list.

HTTP plano, así que sin service worker, sin app instalable, sin portapapeles. Suficiente
para una mirada rápida.

## Forma 2 — LAN más túnel

Agrega alcance desde cualquier lugar. Habilitar el túnel en settings; el daemon spawnnea
`tailcat serve` y el cliente lo marca cuando la LAN falla.

Sigue siendo HTTP plano, así que aplican los mismos límites del navegador. Ver
[Fallback de túnel](/flows/tunnel-fallback_es-ES.md).

## Forma 3 — un origen seguro

Dos caminos, y resuelven problemas distintos:

| Ruta | Da | Cuesta |
| --- | --- | --- |
| **TLS en el daemon** (`PI_COMPANION_TLS_SELF_SIGNED=1`) | Contexto seguro en la LAN; app instalable; portapapeles | Una advertencia de certificado salvo que proveas un cert real |
| **Host estático** (`npm run client:publish`) | Origen seguro que funciona desde cualquier lugar; el daemon solo se alcanza por el túnel | Un paso de deploy público; el origen debe estar permitido |

Ambos están documentados en detalle en `docs/daemon-tls.md` y `docs/static-client-host.md`.

## Variables de entorno

| Variable | Default | Efecto |
| --- | --- | --- |
| `PI_COMPANION_ADMIN_ADDR` | `127.0.0.1:43721` | Bind de la consola |
| `PI_COMPANION_DEVICE_ADDR` | settings, si no `127.0.0.1:43722` | Bind de la superficie de dispositivo |
| `PI_COMPANION_PUBLIC_URL` | — | La URL que usan los teléfonos; aporta un origen permitido |
| `PI_COMPANION_ALLOWED_ORIGINS` | — | Orígenes extra separados por coma |
| `PI_COMPANION_TLS_CERT` / `_KEY` | — | Ambas o ninguna |
| `PI_COMPANION_TLS_SELF_SIGNED` | — | `1`, `true`, `yes`, `on` |
| `PI_COMPANION_TLS_PORT` | puerto del dispositivo + 1 | El listener HTTPS |
| `PI_COMPANION_HOME` | `~/.pi/agent/pi-companion` | Directorio de datos |

## La allow-list de orígenes

Este es el fallo que parece un emparejamiento roto y no lo es. La superficie de dispositivo
valida `Origin`; un navegador manda el origen de la página, que debe estar en la unión de:

- los orígenes de loopback del bind real del dispositivo (`http://127.0.0.1:<port>`,
  `localhost`, `[::1]`);
- el origen de `PI_COMPANION_PUBLIC_URL`;
- cada entrada de `PI_COMPANION_ALLOWED_ORIGINS`.

Síntoma: el claim tiene éxito, y después el WebSocket responde **403 Origin not allowed**.

Arreglo: agregar el origen exacto — scheme, host, puerto, sin barra final:

```
PI_COMPANION_ALLOWED_ORIGINS=http://192.168.2.20:43722,https://user.github.io
```

Notar que `http://host:80` y `http://host` son el mismo origen (`origin_of` quita los
puertos por defecto), pero `http://host:43722` y `https://host:43723` **no** — la superficie
TLS es un origen distinto y necesita su propia entrada.

## Dónde poner la configuración

En `state.json` para lo que sea duradero (`settings.deviceBind`), porque el supervisor
reescribe el entorno del servicio en cada actualización. En el entorno del servicio para
overrides por máquina que estés dispuesto a reaplicar.

## Checklist de verificación

| Chequeo | Comando |
| --- | --- |
| Daemon arriba | `curl -s 127.0.0.1:43721/api/context` |
| Superficie de dispositivo alcanzable | `curl -s http://<lan-ip>:43722/api/context` |
| Superficie TLS | `curl -sk https://<lan-ip>:43723/api/context` |
| Túnel corriendo | `npm run daemon:status` |
| Origen aceptado | Abrir el cliente y observar si hay 403 en el WS |

## Relacionados

- [TLS](/subsystems/tls_es-ES.md) — la restricción del puerto dedicado
- [Superficies HTTP](/architecture/http-surfaces_es-ES.md) — la lógica de orígenes en código
- [Scripts del daemon](/operations/daemon-scripts_es-ES.md) — cómo correrlo
