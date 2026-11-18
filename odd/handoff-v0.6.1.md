# Handoff: HTTPS/PWA round → 0.6.1

Written 2026-11-18 at session close. Everything here is verified unless marked otherwise.

## State

| Where | What |
| --- | --- |
| `main` | Everything from this round except the version bump |
| **PR de release** | `release/v0.6.1` → `main`: the checkbox fix, the version bump and this handoff |
| Tags | `v0.6.0` is the last. Tag `v0.6.1` **after** the release PR merges — the workflow triggers on `v*.*.*` |

Merged this round: #14 (TLS surface), #15 (static host), #17 (settings patch), #12/#13
(knowledge bundle). PR #16 was auto-closed when #14's branch was deleted on merge; its
commits were rebased and reopened as #17.

```
cargo test              168 passed
npm run test:extension  423 passed
npm run ui:check        0 errors
npm run knowledge:check 44 files, 20 concepts, 0 errors
```

## What this round added

- **Opt-in HTTPS on a dedicated port** (device port + 1). Dedicated because `tailcat serve`
  forwards to loopback as plain HTTP; wrapping that port in TLS would break the tunnel.
- **Persistent TLS switch** (`Settings.tlsSelfSigned`) — see the trap below.
- **Stable tunnel identity**: `<data dir>/tailcat/default.private.json`, generated with
  `tailcat genkey` on first use.
- **Client publishable to a static host** (`npm run client:publish`, Pages workflow).
- **Certificate route** `/cert.pem` on both surfaces, unauthenticated.
- **Untrusted-certificate detection** in the connection notice, with the download link.

## The seven bugs, and what made each hard

1. **Wildcard bind became a certificate name.** With `PI_COMPANION_DEVICE_ADDR=0.0.0.0:43722`
   the SAN read `IP Address:0.0.0.0`. A phone rejects that for the *wrong host*, so trusting
   the CA did nothing and the app stayed uninstallable — the one thing TLS exists to fix.
2. **HTTPS origin twin missing from the allow-list.** HTTP→HTTPS changes the origin, and the
   phone dials the interface it is on (`192.168.43.73` when tethered), which never appears in
   `publicUrl`, so listing the twin by hand was impossible in advance. Claim succeeded, then
   `403 Origin not allowed`.
3. **A settings save erased the tunnel address.** `*settings = valid` replaced the whole
   struct, and the page round-trips every field. Any save wrote `""` over the
   daemon-discovered `tailcat_address`; the QR lost its fragment and the phone went offline
   off-LAN. **It looked like a network fault.** Found because a test of mine killed the live
   tunnel with an empty address.
4. **A partial settings body reset everything.** `Settings` derives `Default`, so
   `PUT {"maxUploadMb":33}` also reset the bridge and the TTL. Now a field-by-field patch;
   unknown keys answer 400 naming the field.
5. **The service worker pinned the app to a stale build.** Hashed assets were served
   cache-first forever: the shell loaded, its assets 404'd, the menu did nothing. **Incognito
   worked** — the signature of this bug. Now network-first with the cache as offline fallback.
6. **A revoked device dead-ended on `/pair`.** The token was already gone; the form was behind
   an `else`, so reinstalling the app was the only way forward.
7. **Checkboxes inside a stray frame.** They inherited the text-input `min-height` and focus
   `box-shadow`. `AutomationEditor` already neutralised this; settings never did.

## Traps worth remembering

- **`daemon.json` is rewritten from Pi's environment** (`src/background-service.ts:18`), so a
  `PI_COMPANION_*` set only there disappears on every supervisor reinstall. This is why the
  HTTPS port vanished twice, silently. Anything durable belongs in `state.json` — that is
  what `deviceBind` and `tlsSelfSigned` do.
- **`rust-embed` bakes assets at compile time.** After `npm run ui:build` you must
  `cargo build` again, or the daemon serves a shell whose hashed assets no longer exist.
- **tailcat needs the key file to exist**; it fails with "no such file or directory" rather
  than creating it.
- **The certificate is reused.** Delete `<data dir>/tls/` to regenerate after a LAN address
  change.
- `https://host:43723` and `http://host:43722` are different origins. The twin rule covers
  the allow-list; any new origin source must go through `device_origins`.
- The safety guard blocks shell commands containing certificate file paths — build the path
  with `printf` when fetching one.

## Plan for the next session

### 1. Merge the release PR and tag `v0.6.1` (blocking, 2 minutes)

Merge the PR, then create the tag so the release workflow runs and publishes the four
binaries plus `SHA256SUMS`. Verify the assets appear.

### 2. The revoked-device fix does not re-render live (real defect)

Verified on the phone: after revoking, `/pair` showed "ACCESS REVOKED … Pair this device"
with `inputs: 0`. After a reload, `inputs: 2` and the full form — so the rule is right and
the **rendering** is stale. Suspicion: the layout `$effect` that calls `goto('/pair')` races
the re-render of the page that is already mounted. Needs DevTools on a stable connection; the
remote socket dropped repeatedly last session.

### 3. Firefox on Android (documented, not fixable here)

Firefox ignores user-installed CAs unless *Use Android CA store* is enabled in its secret
settings (Settings → About Firefox → tap the logo 5×). Chrome works, and the PWA is installed
and reaching `Live` over HTTPS on the real phone. Worth a README note so the next person does
not chase it as a bug.

### 4. Complete the off-LAN tunnel test

Never finished. The address is now stable, so a device that re-pairs once keeps working. The
phone still had the old address stored; re-pair on the LAN, then switch to mobile data.

### 5. The three areas no review has covered

- **Concurrent-write races**: the `RwLock` protects the data, not the sequence. Two settings
  saves, or a save racing the tunnel's address write, are unexamined.
- **Bridge limits under real load**: quotas, permits and lease expiry are tested functionally,
  not under pressure.
- **Tunnel across intermittent drops**: the retry-once-on-truncated-stream behaviour is
  measured for fresh dials only.

Ask for measured evidence, not a reading.

### 6. Smaller items

- Destructive daemon scripts (`stop`, `restart`, `service:install/uninstall`) still
  unexercised.
- Known debt unchanged: orphaned `tailcat serve` children when the daemon dies without its
  shutdown path; DERP map policy expressed twice; uploads and blob downloads refused over the
  tunnel; reload off-LAN impossible over plain HTTP.

## Machine notes (this host)

- `rtl8723be` wifi drops association repeatedly (`reason=15`) and at session close it stopped
  seeing networks entirely until the module is reloaded:
  `sudo modprobe -r rtl8723be && sudo modprobe rtl8723be`.
- Phone reachable over adb at `192.168.43.174:5555`; Chrome DevTools via
  `adb forward tcp:9222 localabstract:chrome_devtools_remote` (drops often — re-arm it).
- The PWA is bound to `https://192.168.43.73:43723`, so it only works while the PC holds that
  address on `wlo1`.
