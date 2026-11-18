# Change log

Newest first.

## 2026-11-18 — 0.6.1 alignment: TLS, persistent tunnel, revoked pairing, hashed assets

Aligned the bundle with what the code does at release 0.6.1 (`package.json`,
`server/Cargo.toml`), after two change rounds the documentation did not follow. Every claim
verified against the source at HEAD (commit `082a54f`), with counts from the suites:
cargo test 171 passing, `npm run test:extension` 428 passing, `npm run ui:check` clean.

- **New: [TLS](subsystems/tls.md) rewritten.** The certificate-name enumeration that the
  leaf-CA fix implies (CA:TRUE + keyCertSign for Firefox on Android, which rejects a leaf
  installed as a CA and fails every same-origin fetch — needs *Use Android CA store*),
  the Windows address probe (std::net UDP connect, no getifaddrs), the wildcard rule, and
  the `/cert.pem` surface on both routers.
- **New: [Tailcat](subsystems/tailcat.md) persistent identity.** `serve_args` binds `--key`
  to `<data dir>/tailcat/default.private.json`, generated with `tailcat genkey` on first
  use because tailcat refuses to create it. Without it the tunnel address is ephemeral and
  a paired phone dials an address that no longer exists.
- **Updated: [State](architecture/state.md).** `tlsSelfSigned` and `pairingHttps` are now
  persisted settings, same pattern as `deviceBind`: the supervisor rewrites `daemon.json`
  from Pi's own environment, erasing any `PI_COMPANION_*` set only there (the HTTPS port
  went dark twice this way).
- **Updated: [Pairing](flows/pairing.md).** The QR can target HTTPS when `pairingHttps`
  and the TLS port are both up (`pairing_base`); the HTTPS twin of an allowed origin is
  accepted.
- **Updated: [Assets](subsystems/assets.md) / [UI](subsystems/ui.md).** The service worker
  serves hashed assets network-first (cache v7, offline fallback), after cache-first
  pinned the client to a stale build whose hashed assets the daemon no longer served.
- **Updated: [Automation](subsystems/automation.md).** The action type is `gentle-shell`
  (aliases `pi` still accepted); the spawned program is `gentle-shell` so the session is
  visible to the Companion UI.
- **Updated: [Deployment](operations/deployment.md).** The static-host route —
  `tools/publish-client.mjs`, `.nojekyll`, `BASE_PATH`, and the
  `PI_COMPANION_ALLOWED_ORIGINS` requirement.
- **Recorded, not solved:** a revoked device does not re-render its page without a reload
  (verified on a phone: inputs 0 before, 2 after); the rule in `pairing-state.ts` is right,
  the rendering is stale.

Concepts now 21 + the two new TLS/identity rounds; two new pages named above.

## 2026-11-17 — Bundle created

Initial architecture bundle: 21 concepts across architecture, subsystems, flows and
operations, each with a Spanish counterpart. Derived from a full read of `server/src`,
`src/`, `ui/src` and `bridge/`, verified against the test suites (cargo 154, extension
402, ui:check clean).
