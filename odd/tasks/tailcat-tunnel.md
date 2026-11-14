# Tailcat tunnel option for device connections

Goal: give gentle-companion a tailcat-based connection option so devices can reach the daemon without a public IP. The daemon exposes the device surface through a tailcat tunnel; the phone side connects with a tailcat client.

## Specs

- S1: The daemon has a persisted setting `tailcatEnabled` (bool, default false) in `~/.pi/agent/pi-companion/state.json`.
- S2: When enabled, the daemon runs `tailcat serve <devicePort> --json` as a child process to expose the device surface port (default 43722).
- S3: The daemon parses the tailcat address from the server's stdout JSON `{"listenAddr":"tc..."}` and stores it in settings.
- S4: The UI shows the tailcat address, a copy button, a QR code, and instructions for the phone app.
- S5: When disabled, the daemon stops the tailcat child process and clears the stored address.
- S6: If the tailcat binary is not found, the daemon reports a clear error and does not crash.
- S7: The tailcat child is restarted on daemon restart when the setting is enabled.
- S8: The tailcat address is treated as sensitive; it is not logged to stdout beyond the daemon's own logs.
- S9: The daemon has a persisted setting `tailcatPort` (u16, default 0). Nonzero means the tunnel exposes that port; 0 means the daemon device port from `PI_COMPANION_DEVICE_ADDR` (default `127.0.0.1:43722`). Changing the port while enabled restarts the tunnel.
- S10: The settings UI shows a live status indicator for the tunnel: a green dot when the tailcat process is running, an amber dot while it is starting, an error dot with the daemon's error when it fails (e.g. binary missing, including a per-platform install hint), and a grey dot when disabled. The daemon exposes this as `tailcatStatus` in `/api/settings` and pushes a `tailcat.update` WebSocket event whenever the state changes.
- S11: The device surface binds so paired devices on the network can reach it: when the public URL is an IP literal (LAN), the daemon listens on that IP; an explicit `PI_COMPANION_DEVICE_ADDR` (bare `host:port` or full URL) always wins; a tunnel/domain public URL keeps the device surface on loopback and lets the tunnel/proxy provide public reachability.
- S12: The daemon ships bundled Tailcat binaries for Linux (`server/vendor/tailcat/tailcat-amd64`, `tailcat-arm64`, `tailcat-armv7`) and Windows (`tailcat-win-amd64.exe`, `tailcat-win-arm64.exe`) and prefers a local binary named `tailcat` in `cwd/` or `bin/` over the bundled one. On macOS it falls back to the system `tailcat` via PATH. When the binary is missing, the daemon reports a clear per-platform install hint instead of crashing.

## Tasks

- T1: Add `tailcatEnabled` and `tailcatAddress` to `Settings` in `server/src/config.rs`; extend `validate()` and the load/save path.
- T2: Create a `TailcatManager` module in the daemon that finds the tailcat binary, spawns `tailcat serve <port> --json`, reads the address from stdout, and manages the process lifecycle (start, stop, restart, health check).
- T3: Wire `TailcatManager` into the daemon startup/shutdown: start it when the daemon starts if `tailcatEnabled`, stop it on shutdown.
- T4: Extend the settings endpoint to expose the tailcat tunnel status and address to the UI.
- T5: Update the UI settings page to show the "Enable tailcat tunnel" toggle, the current address, copy button, QR code, and phone-app instructions.
- T6: Add Rust unit tests for the tailcat manager (mock spawn, address parsing, stop) and a test for the settings round-trip.
- T7: Update the README and `odd/tasks/tailcat-tunnel.md` with usage instructions.
- T8: Add the `tailcatPort` setting to `Settings`, validation, the settings endpoint, the UI settings page, and tests.
- T9: Add a live tunnel status indicator in the settings UI: daemon exposes `tailcatStatus` (enabled/running/address/port/error) in `/api/settings`, broadcasts `tailcat.update` on state change, and the UI shows a green/amber/red/grey dot with text.
- T10: Fix the device-surface bind so other LAN devices can reach the daemon: add `hostport_any`, `url_hostport`, `is_ip_literal`, and `remote_bind_addr` in `server/src/main.rs`; bind the remote listener, banner, and `deviceUrl` to that address; add a test covering explicit device addr, LAN public URL, and domain/tunnel fallback.
- T11: Vendor the Tailcat binary so the daemon does not require a separate install: download Linux (amd64/arm64/armv7) and Windows (amd64/arm64) binaries into `server/vendor/tailcat/`, extend `find_tailcat_bin` to be multi-platform (PATH first, then local `tailcat`, then bundled binary by OS/arch), and add a per-platform install hint to the missing-binary error. Document macOS install (`brew install tailcat` and alternatives) in the READMEs.

## Usage

Enable **Settings → Tunnel**. The daemon starts `tailcat serve <port> --json`, reads the tailcat address from stdout, and shows it in the UI with a copy button and QR code. The exposed port is the **Tunnel port** setting; leave it at 0 to use the daemon device port (`PI_COMPANION_DEVICE_ADDR`, default `127.0.0.1:43722`). Changing the port while the tunnel is enabled restarts the tunnel. Disable the tunnel to stop the child process and clear the stored address. The tailcat address is sensitive; do not share it publicly or commit it.

## License note

Tailcat is used by the optional tunnel feature and is licensed under the **BSD 3-Clause License**. The full license text is in `THIRD-PARTY-LICENSES.md`. The README and README.es document this note in English and Spanish.

## Log

- L1: User request: add a tailcat-based connection option in gentle-companion so devices can connect without requiring a public IP. User referenced OpenTailcat and pi-remote as reference phone-side clients, but only as references, not as the implementation.
- L2: User asked to add the Tailcat BSD 3-Clause license note to the repository licenses and to add the Tailcat license to the repository, plus bilingual documentation. Added `THIRD-PARTY-LICENSES.md`, updated `README.md` and `README.es.md`, and documented the Tailcat tunnel in both languages.
- L3: User asked for a configurable tunnel port. Added `tailcatPort` (u16, default 0 = daemon device port) to `Settings`, exposed it via the settings endpoint and UI, restarted the tunnel on port change, and added tests.
- L4: User reported that enabling the tunnel showed no address and no indication whether the daemon ran or the binary was missing. Added a live status indicator: `TailcatStatus` in the daemon, `tailcatStatus` in `/api/settings`, a `tailcat.update` WebSocket broadcast on state change, and a green/amber/red/grey dot in the settings UI. The daemon now also kills the orphaned tailcat child if the address read times out.
- L5: User reported the daemon only bound `127.0.0.1:43721`/`127.0.0.1:43722` in `ss -tlnp`, so other LAN devices could not connect even with a public IP URL. Root cause: `listen_addr` accepted only `127.0.0.1:*` for `PI_COMPANION_DEVICE_ADDR`, and the device listener bound to loopback. Added `remote_bind_addr` so the device surface binds to the LAN IP from the public URL when it is an IP literal, honors an explicit `PI_COMPANION_DEVICE_ADDR` (bare `host:port` or URL) first, and keeps loopback for tunnel/domain URLs. Verified with a new test `remote_bind_addr_prefers_explicit_device_addr_and_lan_public_url`; all 135 daemon tests pass.
- L6: Vendored Tailcat binaries so the daemon no longer requires a separate install: Linux amd64/arm64/armv7 and Windows amd64/arm64 under `server/vendor/tailcat/`. Made `find_tailcat_bin` multi-platform (PATH first, then local `tailcat` in `cwd/` or `bin/`, then the bundled binary for the current OS/arch) and added per-platform install hints to the missing-binary error, including macOS (`brew install tailcat`, `go install`, `nix`, `pixi`). Documented all platforms in `README.md` and `README.es.md`. All 135 daemon tests and the UI build pass.
