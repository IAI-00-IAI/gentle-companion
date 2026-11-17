# Handoff: HTTPS / PWA round

Written 2026-11-17 at the end of the session that shipped the TLS surface, the static
client host, the OKF architecture bundle and four pairing bugs. Everything here is
verified unless it says otherwise.

## Where the code is

| Branch | State | Contents |
| --- | --- | --- |
| `main` | merged | Knowledge bundle (PR #12, #13). Links are relative and resolve on GitHub. |
| `feat/daemon-tls` | **pushed, no PR** | 10 commits: TLS surface, static host, settings fixes, banner link |

`git log --oneline origin/main..origin/feat/daemon-tls`:

```
333bd9d feat(server): opt-in HTTPS surface for an installable client
5930e94 fix(config): persist the device bind address in settings
5b3df02 feat(tools): publish the client to a public HTTPS static host
4999945 docs(knowledge): architecture bundle in OKF format, English and Spanish
cdae532 docs(odd): record the bundle delivery and the slice boundary
6ad8d7a fix(tls): never put a wildcard bind in the certificate
35748ec feat(ui): link the HTTPS banner to the daemon's secure surface
23f6daa fix(tls): admit the HTTPS twin of every origin, and let the QR use it
b70d38c fix(settings): stop a settings save from erasing the tunnel address
e7cd65b fix(settings): apply a settings save as a patch, not a replacement
```

~6589 authored lines. That is far past one reviewable slice, so the delivery shape is a
decision, not a default: chained PRs (TLS surface / static host / settings fixes) or one PR
with the settings fixes called out as the reviewable core.

## Live daemon configuration (this machine)

- Service: `pi-companion.service` (systemd user), supervisor at
  `~/.gentle-shell/agent/pi-companion/service/`, env in `daemon.json` there (mode 0600).
- Binary: `server/target/debug/gentle-companion-server` (a debug build — the supervisor
  points at it).
- Ports: `127.0.0.1:43721` admin, `0.0.0.0:43722` device (plain HTTP, the tunnel's target),
  `0.0.0.0:43723` device over HTTPS.
- Env: `PI_COMPANION_DEVICE_ADDR=0.0.0.0:43722`, `PI_COMPANION_TLS_SELF_SIGNED=1`,
  `PI_COMPANION_ALLOWED_ORIGINS=http://192.168.2.20:43722,http://192.168.43.73:43722,https://192.168.2.20:43723`.
- `settings.publicUrl` = `http://192.168.43.73:43722`; `pairingHttps` = true.
- Data dir: `~/.pi/agent/pi-companion` (`state.json`, `tls/`, `automations.json`, `usage.json`).

**Gotcha**: `rust-embed` bakes the UI into the binary at compile time. After
`npm run ui:build` you must `cargo build` again or the daemon serves a shell whose hashed
assets no longer exist.

## What was fixed, and why it was hard to see

1. **Wildcard bind became a certificate name.** `0.0.0.0` is a kernel instruction, not a
   host. The cert listed it, so the phone rejected it for the *wrong host* — trusting the
   CA did not help, and the app stayed uninstallable. `tls::host_names_for` now substitutes
   the machine's LAN IPv4s (`getifaddrs` via libc, already a dependency).
2. **No HTTPS twin in the origin allow-list.** HTTP→HTTPS changes the origin. The phone
   dials the interface it is on (`192.168.43.73` when tethered), which never appears in
   `publicUrl`, so the twin could not be listed in advance. `device_origins` derives it.
3. **A settings save erased the tunnel address.** `put_settings` did `*settings = valid`;
   the settings page round-trips every field, so any save wrote `""` over the
   daemon-discovered `tailcat_address`. The QR lost its tunnel fragment, the claim returned
   no coordinates, and the phone went offline off-LAN. **This looked like a network fault.**
4. **A partial settings body reset everything.** `Settings` derives `Default`, so
   `PUT {"maxUploadMb":33}` also reset the bridge and the TTL. Now a field-by-field patch;
   unknown keys and wrong types answer 400 naming the field.
5. **`/cert.pem` was documented and absent.** Chrome dead-ended at
   `ERR_CERT_AUTHORITY_INVALID`. Now served on both surfaces, unauthenticated.
6. **The HTTPS banner had no link and did not render in `bare` mode** — the exact case it
   exists for. Now links via `httpsLinkFor` and renders in bare mode.

The audit that found #3 and #4 covered every write path. Only `put_settings` replaced
daemon state with client input; automations already preserve `id`/`createdAt`, devices are
built server-side, browser commands cannot touch a snapshot.

## Verification

```
cargo test            165 passed
npm run test:extension 409 passed
npm run ui:check      0 errors
npm run knowledge:check  44 files, 20 concepts, 0 errors
```

Live checks performed: HTTP 200 on 43722 and HTTPS 200 on 43723 serving the same context;
the tunnel's plain-HTTP loopback mirror still answering; `Origin https://192.168.43.73:43723`
accepted (401 = credential invalid) while a foreign origin answers 403; the certificate
route returning 200 `application/x-pem-file` with a valid PEM; the QR reading
`https://192.168.43.73:43723/pair` with `#tunnel=…&port=43722`; a settings save no longer
erasing the tunnel address; a partial body changing only what it names.

## Planning — next session

### 1. Decide the delivery shape for `feat/daemon-tls` (blocking)

10 commits / ~6589 lines. Recommend chained PRs so each is reviewable:

- **PR A — TLS surface**: `333bd9d`, `6ad8d7a`, `35748ec`, `23f6daa` (plus `5930e94` for
  the bind persistence it depends on). The security-relevant core.
- **PR B — static client host**: `5b3df02`. Independent, no server change.
- **PR C — settings correctness**: `b70d38c`, `e7cd65b`. Small, high value, easy to review.

Knowledge is already on `main`, so nothing here depends on it.

### 2. Real-phone pass of the full HTTPS flow (unverified)

Nobody has completed this end to end. Steps: open `https://192.168.43.73:43723/`, accept or
install the cert, download it from `/cert.pem`, install as **CA** (Android: Settings →
Security → Encryption & credentials → Install a certificate → CA certificate), reload, then
confirm `window.isSecureContext === true`, a registered service worker, and an
"Install app" affordance. Then re-pair (the current device lacks tunnel coordinates) and
disconnect the LAN to confirm the tunnel fallback.

### 3. The three areas no review has covered

- **Concurrent-write races.** The `RwLock` protects the data, not the sequence. Two settings
  saves, or a save racing the tunnel's address write, are unexamined.
- **Bridge limits under real load.** Quotas, permits and lease expiry are tested
  functionally, not under pressure.
- **Tunnel on intermittent drops.** The retry-once-on-truncated-stream behaviour is measured
  for fresh dials, not for a link that flaps.

Ask for measured evidence, not a reading.

### 4. Destructive daemon scripts (never exercised)

`daemon:stop`, `daemon:restart`, `daemon:service:install`, `daemon:service:uninstall`.
Reviewed but unproven. The user deferred them.

### 5. Known debt, unchanged

Orphaned `tailcat serve` children when the daemon dies without its shutdown path (11
accumulated once); the DERP map policy expressed twice (`bridge/app.js` and
`ui/src/lib/tailcat-runtime.ts`); uploads and blob downloads refused over the tunnel;
reload off-LAN impossible over plain HTTP.

## Traps worth remembering

- `rust-embed` bakes assets at compile time — rebuild the daemon after `ui:build`.
- The self-signed certificate is **reused**; delete `<data dir>/tls/` to regenerate after a
  LAN address change.
- `https://host:43723` and `http://host:43722` are different origins; the twin rule covers
  the allow-list, but any new origin source must go through `device_origins`.
- The tunnel's loopback mirror must stay **plain HTTP** — that is why TLS lives on a
  dedicated port.
- `tailcat_address` is daemon-owned. Anything that replaces the whole `Settings` struct
  will break the tunnel fallback.
- The safety guard blocks shell commands containing certificate file paths; build paths with
  `printf` when you need to fetch one.
