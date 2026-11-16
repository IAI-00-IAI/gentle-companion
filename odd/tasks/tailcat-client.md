# Tailcat first-class client — Companion UI over the tunnel

The real Companion UI (ui/) works as a phone client through the tailcat
tunnel, served by the daemon, with QR pairing from the phone itself.

## Specs

- S1: "la UI de Companion funciona como cliente a través del túnel (no solo
  la página de prueba), reutilizando LiveConnection con transporte
  inyectable". Decisión del usuario: modo túnel adicional (opción A) junto a
  los modos local/remote existentes; los dos modos existentes quedan intactos.
- S2: "unificar el path del puente WASM (bridge/http.js + ws.js) con la UI
  real; sin duplicación de shims". La UI consume los shims existentes
  (bridgeFetch / TunnelWebSocket), sin copias.
- S3: "emparejamiento y arranque desde el propio teléfono (QR + código ya
  existen en el daemon)". Decisión del usuario: "MVP con QR y opción de
  copiar token (p.ej. si el teléfono o cliente no tiene cámara o no tiene
  acceso directo)".
- S4: "empaquetado/serving del cliente (desde el origen público del daemon u
  host estático) + docs bilingüe _es-ES". Decisión del usuario: servido por
  el daemon (opción A); host estático queda documentado como alternativa, no
  implementado.

## Tasks

- T1 (S2): la UI consume los shims de bridge/ sin duplicarlos (adaptación TS
  si hace falta). Route: worker A (T1+T2). Commit: —
- T2 (S1): modo túnel en la UI con transporte inyectable en
  companion.svelte.ts; modos existentes sin regresión. Route: worker A
  (T1+T2). Commit: —
- T3 (S3): QR desde el teléfono + copiar token como alternativa; arranque del
  cliente ya autenticado. Route: pending. Commit: —
- T4 (S4): el daemon sirve el cliente buildado desde su origen. Route:
  worker B. Commit: 5f9cf7f
- T5 (S1-S4): E2E extremo a extremo + docs bilingüe _es-ES. Route: pending.
  Commit: —

## Log

- L1 (user): «lee memoria id 865, topic_key: tailcat-first-class-client-plan
  y empezamos la planificación» — arranca la planificación del cliente
  tailcat de primera clase (memoria id 865, plan S1–S4).
- L2 (user): decisiones de diseño: «A (modo túnel adicional) + A (servido por
  el daemon) + MVP con QR y opción de copiar token (p.ej. si el teléfono o
  cliente no tiene cámara o no tiene acceso directo)». Descartadas: unificar
  todo detrás de una interfaz de transporte (sobre-ingeniería hoy); host
  estático (documentado como alternativa en S4).
- L3 (worker B, T4): serving implementado con rust-embed dedicado apuntando a
  ../bridge/vendor/ con filtros #[include] (feature include-exclude); evita
  duplicar los 35 MB en web-dist y CI queda intacto. derpmap.json NO se
  sirve: no hay mapa vendorizado en el repo y el cliente usa la canónica
  https://tailcat.dev/derpmap.json. CSP sin cambios (mismo origen; el dial
  tunelado es ws:). TDD: RED 404 -> GREEN; suite completa 143 passed (era
  141). Rutas en ambos routers (main.rs local :455-458, remote :492-495),
  exactas, ganan al catch-all /bridge/{token}/{*rest}. Commit 5f9cf7f.
  Aprendizajes: claves de rust-embed relativas a la carpeta; mime_guess da
  text/javascript para .js (normalizado a application/javascript);
  instantiateStreaming exige application/wasm exacto.
- L3 (user): «Ok, adelante, y lanza en paralelo la mayor cantidad de
  subagentes que puedas» — T1+T2 van a un writer (superficie ui/), T4 a otro
  (server/), en paralelo; T3 espera a ambos (depende del cliente túnel y del
  serving); T5 cierra la feature. Serving contract fijado entre writers:
  /bridge/vendor/main.wasm, /bridge/vendor/wasm_exec.js, /bridge/derpmap.json.
