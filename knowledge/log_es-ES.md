# Registro de cambios

Los más recientes primero.

## 2026-11-18 — Alineación 0.6.1: TLS, túnel persistente, re-emparejamiento revocado, assets hasheados

Alineado el bundle con lo que el código hace en el release 0.6.1 (`package.json`,
`server/Cargo.toml`), tras dos rondas de cambios que la documentación no siguió. Cada
afirmación verificada contra el código en HEAD (commit `082a54f`), con los conteos de las
suites: cargo test 171 pasando, `npm run test:extension` 428 pasando, `npm run ui:check`
limpio.

- **Nuevo: [TLS](subsystems/tls_es-ES.md) reescrito.** La enumeración de nombres del
  certificado que implica el arreglo de CA de hoja (CA:TRUE + keyCertSign para Firefox en
  Android, que rechaza una hoja instalada como CA y hace fallar cada fetch same-origin —
  requiere *Use Android CA store*), la consulta de direcciones en Windows (std::net UDP
  connect, sin getifaddrs), la regla del wildcard, y la superficie `/cert.pem` en ambos
  routers.
- **Nuevo: identidad persistente en [Tailcat](subsystems/tailcat_es-ES.md).** `serve_args`
  liga `--key` a `<data dir>/tailcat/default.private.json`, generada con `tailcat genkey`
  en el primer uso porque tailcat se niega a crearla. Sin ella la dirección del túnel es
  efímera y un teléfono emparejado marca una dirección que ya no existe.
- **Actualizado: [Estado](architecture/state_es-ES.md).** `tlsSelfSigned` y
  `pairingHttps` son ahora settings persistidos, mismo patrón que `deviceBind`: el
  supervisor reescribe `daemon.json` desde el entorno propio de Pi, borrando cualquier
  `PI_COMPANION_*` configurado solo ahí (el puerto HTTPS se apagó dos veces así).
- **Actualizado: [Emparejamiento](flows/pairing_es-ES.md).** El QR puede apuntar a HTTPS
  cuando `pairingHttps` y el puerto TLS están ambos activos (`pairing_base`); el gemelo
  HTTPS de un origen permitido es aceptado.
- **Actualizado: [Assets](subsystems/assets_es-ES.md) / [UI](subsystems/ui_es-ES.md).**
  El service worker sirve los assets hasheados network-first (caché v7, fallback sin
  conexión), después de que cache-first fijó el cliente a una compilación vencida cuyos
  assets hasheados el daemon ya no servía.
- **Actualizado: [Automatizaciones](subsystems/automation_es-ES.md).** El tipo de acción es
  `gentle-shell` (el alias `pi` sigue aceptándose); el programa spawnneado es
  `gentle-shell` para que la sesión sea visible para la UI de Companion.
- **Actualizado: [Despliegue](operations/deployment_es-ES.md).** La ruta de host estático
  — `tools/publish-client.mjs`, `.nojekyll`, `BASE_PATH`, y el requerimiento de
  `PI_COMPANION_ALLOWED_ORIGINS`.
- **Registrado, no resuelto:** un dispositivo revocado no re-renderiza su página sin un
  reload (verificado en un teléfono: inputs 0 antes, 2 después); la regla en
  `pairing-state.ts` es correcta, el renderizado está vencido.

21 conceptos tras las dos rondas nuevas; las dos páginas nuevas se nombran arriba.

## 2026-11-17 — Bundle creado

Bundle inicial de arquitectura: 20 conceptos repartidos en arquitectura, subsistemas,
flujos y operación, cada uno con su contraparte en español. Derivado de una lectura
completa de `server/src`, `src/`, `ui/src` y `bridge/`, verificado contra las suites de
tests (cargo 154, extensión 402, ui:check limpio).
