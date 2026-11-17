---
type: Subsystem
title: Assets y CSP
description: La SPA embebida, la Content-Security-Policy exacta, la política de caché, y por qué importan dos directivas.
tags: [subsystem, assets, csp, caching]
status: stable
generated: { by: agent:gentle-pi, at: 2026-09-27T00:00:00Z }
sources:
  - id: assets-rs
    resource: server/src/assets.rs
    title: RustEmbed folders, CSP, caching
---

# Assets y CSP

El daemon sirve el cliente desde su propio binario. Sin servidor de archivos estáticos, sin
CDN, sin deploy separado — el binario que el usuario descargó contiene la UI.

## Embebido

```rust
#[derive(RustEmbed)]
#[folder = "web-dist/"]        // the built SPA
struct Assets;

#[derive(RustEmbed)]
#[folder = "../bridge/vendor/"] // main.wasm, wasm_exec.js
struct BridgeAssets;
```

`server/src/assets.rs:19–28`. Solo esos dos archivos vienen de `bridge/vendor` — el runtime
de tailcat que el cliente necesita para marcar un túnel.

## Servicio

- Las rutas desconocidas caen a `200.html` — el shell de la SPA, para que las rutas del lado
  cliente funcionen en una carga fría.
- `_app/**` y las rutas con punto son **404**, no el shell. Un asset hasheado faltante debe
  fallar ruidosamente; devolver HTML para una petición de `.js` produce un error de parseo
  confuso en su lugar.
- Un árbol sin compilar responde **503** (`:55`), lo que le dice a un desarrollador qué es
  lo que realmente pasa.

## La CSP

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' blob:;
connect-src 'self' https://tailcat.dev ws: wss:;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-src 'self' https:;
frame-ancestors 'none'
```

`server/src/assets.rs:39`. Dos directivas cargan con el peso:

- **`'wasm-unsafe-eval'`** — el runtime de tailcat es WebAssembly. Sin esto, el navegador se
  niega a compilar el módulo y el túnel no puede arrancar. Es el permiso más angosto que
  permite WASM; no habilita `eval` para JavaScript.
- **`connect-src … https://tailcat.dev`** — el mapa DERP se trae de ahí. Sin esto el túnel
  no puede conocer su relay.

`frame-src 'self' https:` es lo que permite al proxy del bridge renderizar un dev server
proxiado en un iframe, y `frame-ancestors 'none'` evita que cualquiera enmarque la UI de
Companion.

Las respuestas HTML también llevan `permissions-policy: camera=(self)` y
`X-Frame-Options: DENY` (`:82`). El ETag lleva un sufijo de revisión de política
(`-camera-v2-preview-v1`) para que una política cambiada invalide cachés que de otro modo
conservarían los headers viejos.

## Caché

| Ruta | Header | Por qué |
| --- | --- | --- |
| `_app/immutable/**` | `public, max-age=31536000, immutable` | Nombres con hash de contenido — un cambio significa un nombre nuevo |
| Todo lo demás | `no-cache` + ETag fuerte | El shell y `version.json` deben revalidarse |

La división es lo que hace invisible una actualización: el shell siempre se revalida, así
que una compilación nueva se nota en la próxima carga, mientras que los assets hasheados
nunca se vuelven a traer.

## Verificación

Tres tests en `server/src/assets.rs` cubren el servicio, el fallback y el header de CSP.

## Relacionados

- [UI](../subsystems/ui_es-ES.md) — qué hace el shell una vez cargado
- [Shims del túnel](../subsystems/tunnel-shims_es-ES.md) — el WASM que la CSP debe permitir
- [Despliegue](../operations/deployment_es-ES.md) — hostear la misma compilación en otro lado
