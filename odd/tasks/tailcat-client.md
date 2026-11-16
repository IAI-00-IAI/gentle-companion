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
  si hace falta). Route: worker A (T1+T2). Commit: 3286edb
- T2 (S1): modo túnel en la UI con transporte inyectable en
  companion.svelte.ts; modos existentes sin regresión. Route: worker A
  (T1+T2). Commit: 3286edb
- T3 (S3): QR desde el teléfono + copiar token como alternativa; arranque del
  cliente ya autenticado. Route: worker C. Commit: d795f39
- T4 (S4): el daemon sirve el cliente buildado desde su origen. Route:
  worker B. Commit: 5f9cf7f
- T5 (S1-S4): E2E extremo a extremo + docs bilingüe _es-ES. Route: parent
  (workers fallaron 4 veces sin reporte; docs inline + E2E inline). Commit:
  2516d90

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
- L4 (worker A, T1+T2): UI consume shims reales vía wrapper tipado + .d.ts
  ambientales (cero copias, verificado en bundle). Modo túnel: detección por
  las claves localStorage del bridge (companion-bridge.tunnel-addr /
  device-port, puerto por defecto 43722), WS vía DeferredTunnelSocket (dial
  async bajo create() sync), HTTP vía bridgeFetch con transporte inyectable
  en workspaceRequest (clasificación de errores preservada). Interacción
  resuelta por el padre: headers opcionales en encodeRequest/bridgeFetch
  (retrocompatible, test wire-level) + guard de auth eliminado. CSP del
  daemon ampliada con https://tailcat.dev (padre, assets.rs:40 + test :192).
  Evidencia: http_test 38 checks, ws_test ok, tunnel suite 31/31,
  test:extension 390/390 (ui/tests cableado a package.json), ui:check 0
  errores, cargo 143/143. Deuda anotada: política DERP reexpresada en TS
  (~15 líneas, app.js no importable); uploads FormData y downloads blob
  rechazados con error claro (alcance T3/T5). Commits 5f9cf7f + 3286edb;
  límite de slice: 1328 líneas (chocará en publicación: chained PR).
- L5 (worker C, T3): QR con dirección de túnel en el FRAGMENTO de la URL
  (#tunnel=<addr>&port=<port>, nunca llega al servidor → sin fuga en logs);
  invite sigue siendo el único query param y el claim no cambia; sin túnel la
  URL es byte a byte la anterior (test de conservación). La UI consume el
  fragmento en boot (parse → claves T2 → replaceState), la página devices
  muestra hint de copiar enlace (devices.token.hint EN+es-ES) y
  PairingResponse expone tunnelAddr/tunnelPort. Sin dependencias nuevas. TDD:
  cargo 145 (+2), test:extension 401 (+11), ui:check limpio. Commit d795f39.
  Aprendizaje: el SVG de la crate qrcode es solo datos de path (asertar
  estructura, no payload); location de SvelteKit no tiene replaceState
  (usar history.replaceState con history.state).
- L6 (parent, T5): workers fallaron 4 veces (provider_unavailable / sin
  reporte) → docs y E2E ejecutados inline por el padre. Docs: README EN+ES
  (cliente de primera clase servido por el daemon, QR con fragmento, fallback
  copiable), bridge/README EN+ES reposicionado como arnés manual de los shims
  compartidos. E2E inline contra túnel real (chromium CDP :9333 + static
  :8077, daemon con el build nuevo): GET / 200 SPA, main.wasm 200
  application/wasm (35610962B), wasm_exec.js 200 application/javascript,
  URL de pairing con #tunnel=<addr>&port=43722 (fragment parser validado
  contra la URL real), probe tunelado HTTP 200 remote=true version=0.5.0 ||
  WS-OK resync — 3/3 corridas consecutivas. Dispositivos de prueba
  revocados (4x 204). Gotcha: el daemon autoiniciado por la sesión Pi
  corre el binario viejo (deleted); hay que matarlo y relanzar el build
  nuevo para probar. Commit 2516d90.
- L7 (user report, parent): defecto UX real — el QR de Settings → Tunnel
  codificaba la dirección tc… cruda; el navegador del teléfono la mostraba
  como token opaco sin nada que abrir. Fix (3977d37): ese QR ahora codifica
  una URL de emparejamiento fresca (invite en query, túnel+puerto en
  fragmento si corre) — mismo flujo que el QR de Dispositivos. Verificado
  decodificando el SVG servido con OpenCV: URL correcta, invite presente,
  fragmento con tunnel= y port=. Hint nuevo settings.tailcat.qr.hint
  (EN+es-ES); el campo de dirección conserva su botón copiar para clientes
  externos. Suites: cargo 145, test:extension 401, ui:check limpio.
- L3 (user): «Ok, adelante, y lanza en paralelo la mayor cantidad de
  subagentes que puedas» — T1+T2 van a un writer (superficie ui/), T4 a otro
  (server/), en paralelo; T3 espera a ambos (depende del cliente túnel y del
  serving); T5 cierra la feature. Serving contract fijado entre writers:
  /bridge/vendor/main.wasm, /bridge/vendor/wasm_exec.js, /bridge/derpmap.json.
- L8 (user report, parent): dos defectos de uso real en el teléfono. (1) Al
  salir de la LAN se caía la conexión: el modo túnel se leía UNA vez al cargar
  el módulo, pero el fragmento del QR se consume después en boot → la primera
  sesión corría por LAN. Fix (ece0b31): la config se relee en cada creación de
  socket y en cada request HTTP, con transporte reconstruido si cambia.
  (2) El banner HTTPS ocupaba la pantalla sin poder cerrarse: ahora tiene
  botón Cerrar (shell.banner.dismiss EN+es-ES). Verificado: ui:check limpio,
  test:extension 401/401, E2E túnel real verde. Nota: falta smoke test en
  teléfono real para confirmar el (1) fuera de la LAN.
- L9 (user report, parent): el indicador tailcat quedaba "inactivo" en
  teléfono y desktop. Dos causas: (1) visible_to_device filtraba
  tailcat.update por falta de sessionId → los dispositivos nunca lo
  recibían (ahora explícitamente visible: es estado de conexión, sin
  datos de sesión); (2) un cliente que abre la UI después de que el
  túnel arrancó nunca ve un tailcat.update (solo se emite en
  start/stop) → /api/context del device surface ahora trae
  tailcatStatus (sin la dirección, que queda en settings/admin) y el
  boot de la UI lo alimenta al indicador. Verificado: remote context
  devuelve running:true; cargo 145, test:extension 401, ui:check
  limpio; web-dist reconstruido. Commit 324a397.
- L10 (debug round, parent): la sesión del teléfono en bucle "Cannot reach
  your workspace" — cadena causal resuelta con registro sistemático
  (diagnostics.ts + botón Copiar diagnóstico, pedido del usuario):
  (a) CSP bloqueaba instantiateStreaming → 'wasm-unsafe-eval';
  (b) transport sin header Origin → daemon rechazaba POST (claim);
  (c) bridgeFetch con closeWrite inmediato → el relay DERP perdía bytes
  (medido 2/10 GET, 3/3 POST) → sin half-close, el daemon delimita con
  connection:close;
  (d) dialer global único pisado por requests concurrentes → dial
  explícito por request (7º arg de bridgeFetch, retrocompatible);
  (e) RAÍZ: el parser de http.js NUNCA acumulaba el body entre chunks
  cuando había Content-Length → toda respuesta >1 chunk fallaba con
  'after 1050 of 22929' (determinístico). Fix: plegar buf en body antes
  del check. Latente desde siempre: todos los tests previos usaban
  respuestas de un solo chunk (/api/context = 197B).
  (f) timeout de túnel 30s (dial DERP 0.5-6s vs 10s LAN).
  Verificado E2E: pair → landing → estable, notice=null, 1 ciclo WS.
  Suites: http_test 42, ws_test ok, cargo 145, test:extension 402.
  Commits 29182b7 + 07ea52b. Slice: 2139 líneas / 14 commits.
- L11 (user report, parent): tras reinicios del daemon, (a) tailcat
  "inactivo" en teléfono y PC, (b) 'Mostrando {count} de {total} {unit}'
  sin interpolar en sesiones. Causas: (a) 11 procesos tailcat serve
  huérfanos acumulados de reinicios (stop_tailcat no mata hijos de
  daemons muertos) + dirección vieja en localStorage del teléfono →
  limpiados; el QR actual tiene la dirección nueva. (b) el interpolador
  solo reemplazaba {{var}} pero 30 entradas usan {var} → acepta ambos
  (9beff96). Deuda anotada: matar hijos tailcat al morir el daemon.
- L12 (user report, parent): el teléfono en la LAN del daemon no conectaba:
  el modo túnel era camino EXCLUSIVO — todo iba por DERP aunque el daemon
  estuviera a un salto, y con la WAN del teléfono caída (tether USB) el
  relay era inalcanzable. Fix (6326bd3): boot() sondea el camino directo
  (fetch a /api/context del propio origen); si responde como el daemon →
  LAN directa (sin túnel); si no → túnel. La sonda se cachea hasta un
  fallo; unavailable() la olvida para re-evaluar al moverse entre redes.
  E2E: direct probe -> true, context ok, notice null. Suites: 402/402,
  ui:check limpio.
- L13 (user report, parent): el panel "workspace connection interrupted"
  cubría la pantalla del teléfono durante los reintentos (la página
  detrás funcionaba). Fix: notice colapsable por defecto (franja fina
  con chevron, tap para expandir), auto-colapsa al recuperar conexión,
  role=alert conservado. Suites: 402/402, ui:check limpio.
