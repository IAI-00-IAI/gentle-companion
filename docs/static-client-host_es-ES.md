# Alojar el cliente en un sitio estático público

El daemon sirve el cliente por HTTP simple desde su dirección de LAN. Eso está bien en
casa y es lo que transporta el túnel tailcat, pero tiene dos límites: un teléfono fuera
de la red no puede cargar la página, y los navegadores se niegan a instalar una app web
desde un origen inseguro.

Publicar el cliente compilado en un host HTTPS elimina ambos límites. El teléfono abre la
URL pública, obtiene un contexto seguro (service worker, app instalable, shell offline) y
alcanza el daemon solo a través del túnel tailcat.

## Qué se publica

`tools/publish-client.mjs` arma un directorio desde dos fuentes:

| Origen | Contenido | Por qué |
| --- | --- | --- |
| `server/web-dist/` | El SPA compilado (`200.html`, `_app/`, manifest, service worker, iconos) | Lo produce `npm run ui:build` |
| `bridge/vendor/` | `wasm_exec.js`, `main.wasm` | El runtime de tailcat que el cliente pide en `/bridge/vendor/*` |

También escribe `.nojekyll`, porque GitHub Pages ejecuta Jekyll por defecto y Jekyll
descarta los directorios que empiezan con `_` — lo que borraría el bundle `_app/` entero.

    npm run ui:build
    npm run client:publish          # escribe dist/client-pages
    npm run client:publish:check    # verifica que estén todos los archivos requeridos

El árbol ensamblado pesa unos 40 MB (el WASM de tailcat domina). La mayoría de los hosts
estáticos lo aceptan; revisá los límites de tu host si agregás más recursos.

## GitHub Pages

El workflow `pages.yml` hace todo el trabajo a demanda:

1. Ajustes del repositorio → Pages → **Source: GitHub Actions** (una vez).
2. Actions → *Publish client* → **Run workflow**.

### El path base

Un sitio de **proyecto** de GitHub Pages vive en `https://<usuario>.github.io/<repo>/`,
mientras que el SPA referencia sus recursos desde la raíz (`/_app/...`). Elegí una opción:

- **Dominio propio** (Ajustes → Pages → Custom domain): el sitio se sirve en la raíz, así
  que dejá vacío el input `base_path` del workflow. Es lo más simple y lo que la mayoría
  de los despliegues quiere.
- **Path de proyecto por defecto**: pasá `base_path` = `/<repo>` al ejecutar el workflow.
  La compilación emite entonces las URLs de recursos con ese prefijo (`BASE_PATH` lo lee
  `ui/vite.config.ts`).

Sin una de las dos, la página carga pero todos los recursos dan 404.

## Apuntar el teléfono

Después del despliegue, abrí el sitio con las coordenadas del túnel en el fragmento:

    https://<host>/#tunnel=tc…&port=43722

El fragmento nunca llega a ningún servidor, así que la dirección del túnel queda fuera de
los logs del host. El cliente la guarda y marca el túnel.

## El daemon debe aceptar el origen

La superficie de dispositivo valida el header `Origin`. Agregá el origen publicado a la
lista blanca del daemon, o el WebSocket y la API responden `403 Origin not allowed`:

    PI_COMPANION_ALLOWED_ORIGINS=https://<usuario>.github.io

Definilo en el entorno del servicio (ver los scripts del daemon) y reiniciá el daemon.

## Notas de seguridad

- **Los archivos publicados son públicos.** Nunca pongas un token ni una dirección de
  túnel en ellos; la dirección va solo en el fragmento de la URL.
- La dirección del túnel es una credencial: quien la tenga puede alcanzar la superficie de
  dispositivo, sujeto al token de emparejamiento.
- El cliente publicado se versiona por separado del daemon. Volvé a ejecutar el workflow
  cuando cambie la UI, o el sitio sigue sirviendo el shell anterior.
