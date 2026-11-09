# Security model

Pi Companion intentionally exposes less power than Pi itself.

## Trust zones

### Local admin surface

127.0.0.1:43721

Trusted local administrator only. It can create pairing invitations, see which paired devices are connected, disconnect or revoke them, change daemon settings, and inspect all registered sessions.

Do not place this listener behind a tunnel or reverse proxy.

It has no credentials, so it refuses any request whose `Origin` is not its own loopback address (`http://127.0.0.1:43721`, `localhost`, `[::1]`) or listed in `PI_COMPANION_ALLOWED_ORIGINS`. A web page on another origin can therefore not open its WebSocket and steer Pi. Requests without `Origin` (the Pi bridge, CLI tools) are accepted.

### Paired-device surface

127.0.0.1:43722

Designed to sit behind an HTTPS/WSS tunnel. Every control/data endpoint requires a paired-device credential, except the one-time pairing claim endpoint and static pairing UI.

Strict Origin checks: WebSocket upgrades and POST/DELETE requests must carry an `Origin` equal to the loopback device address, the configured public URL, or an entry of `PI_COMPANION_ALLOWED_ORIGINS`; GET requests may omit `Origin` but are refused with any foreign one.

Pairing invitations are single-use and expire (5 minutes by default). The short typed code is rate limited: ten wrong codes within ten minutes withdraw every open invitation and further code claims get HTTP 429 until the window passes.

Extension startup may download/start the daemon and register a per-user login service (launchd, systemd user service, or Windows scheduled task), but never activates normal session sharing. Services run with the current user's permissions. Downloads are SHA256-verified and version-checked before an older daemon is stopped. `PI_COMPANION_AUTOSTART=0` disables extension-managed starts/upgrades; `PI_COMPANION_SERVICE=0` disables new service registration. Neither setting uninstalls an existing service; see README for removal instructions.

Paired devices can see only sessions that explicitly enabled remote control, including daemon-owned automation sessions created by an authorized automation run. Paired devices may read automation definitions/history and start/stop existing automations, but cannot create, edit, delete, or enable/disable them.

Revoking a device deletes its credential hash and closes its open connections immediately (WebSocket close 4003). Disconnecting closes them without deleting the credential (close 4001).

### Stored state

Paired devices (name, browser user agent, pairing and last-seen times, and the SHA-256 hash of the credential; never the credential) and settings are written atomically to `~/.pi/agent/pi-companion/state.json`. On Unix the directory is 0700 and the file is created 0600 before any byte is written; a looser mode found at startup is tightened.

Automation definitions, prompts, and bounded run output are stored separately in `automations.json`, using atomic replacement and private Unix permissions. Output can contain sensitive command/agent data; it is readable by paired devices. Failed or stopped runs are retained; interrupted runs are marked failed on daemon restart.

### Automations

Only the local admin surface can author automation scripts. Native extension and standalone MCP tools use that surface and do not start the daemon implicitly. Commands use argv without an implicit shell, but both commands and spawned Pi agents run with the OS user's permissions; this is not a sandbox. A paired device can start a previously authorized script with side effects. Disabling a definition prevents scheduling, not explicit manual runs.

Automation sessions accept only question answers/cancellation from browsers. Prompts, steering, abort/plan/diff commands, uploads, and file deletion are denied server-side. Stop a run through its automation endpoint instead. Five-field UTC schedules run only while the daemon is alive, without overlapping runs or catch-up. Automatic session archiving after seven disconnected days removes registry/feed records only, never local Pi/project files.

### Web UI hardening

HTML responses keep app scripts, styles, fonts and connections under the existing Content-Security-Policy, with `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. An explicit `frame-src 'self' https:` exception supports opt-in website previews; it does not permit remote scripts in the Companion app itself.

Agent links open a preview confirmation, not a host browser. Only absolute HTTPS URLs with public-looking DNS names are accepted for website previews; credentials, IP literals, local/reserved names and the Companion origin are refused. This is a client-side URL policy, not a DNS or redirect allowlist. Public websites are never proxied or fetched by the daemon; localhost servers and local files go through the separately gated [Companion bridge](#companion-bridge). After the user chooses **Load website preview**, their browser contacts the site directly and may send that site's cookies. Frames run with `sandbox="allow-scripts"` but without same-origin access, forms, popups, downloads or top navigation; referrers and sensitive browser permissions are disabled. Websites can refuse embedding with CSP or X-Frame-Options. Companion does not bypass these restrictions or claim that a frame load event proves the page is available. **Open in new tab** is an explicit fallback outside the sandbox.

Shared-file previews use the existing authenticated, session-scoped download endpoint and opaque file ids. A preview link must match a registered upload; paths that are not uploads can only enter that registry through the confirmed bridge below. Previews are limited to 2 MiB. Safe raster images and escaped text are supported; SVG is text, not active markup. Standalone HTML is sanitized to HTML-only elements (inline SVG/MathML is removed) and shown as a static snapshot in a sandboxed `srcdoc` frame with scripts, network resources, forms, nested frames and link navigation disabled. External assets and JavaScript-dependent pages may not render fully. Companion never copies its paired-device bearer credential into frame URLs or documents. Uploaded content and user-provided URL query parameters may themselves contain secrets, so share and open them deliberately. Unsupported files remain attachment downloads, not inline same-origin content.

### Companion bridge

The bridge lets a paired device (or the local console) use localhost servers and files the agent mentions. It deliberately widens what the daemon can read and reach, so it is gated several times. `bridgeEnabled` in Settings (default on) switches it off entirely, including already-issued links.

Both entry points are session-scoped, refuse automation (read-only) sessions, and on the device surface require the device credential and a shared session. The UI asks before calling them; the daemon does not trust that prompt and enforces the rules itself.

**Mention gate.** The file path or server address must appear in what the session's agent or tools produced. Text typed into the companion (`user.message`) never counts. This is a guardrail rather than a boundary: a paired device can already instruct Pi, and Pi can already read these files.

**File fetch** (`POST /api/sessions/{id}/bridge/file`). The reference is resolved (`file://`, `~/`, relative to the session's working directory), canonicalized with symlinks resolved, and must lie inside the session's working directory or the shared Companion temp directory. It must be a regular file within the upload size limit and MIME allowlist. Credential-like locations are refused even inside those roots: `.ssh`, `.gnupg`, `.aws`, `.kube`, `.azure`, `.docker`, `.config/gcloud`, `.pi/agent`, `.env*`, `.netrc`, `.npmrc`, `.pypirc`, SSH key names, `*.pem|*.key|*.p12|*.pfx|*.kdbx|*.keystore`, and the daemon's own data directory. The file is copied into the session sandbox as an agent upload; the host path is kept server-side and never sent to browsers. Fetching the same file again replaces the earlier copy.

**Endpoint proxy** (`POST /api/sessions/{id}/bridge/endpoint`, then `/bridge/{token}/...`). Only `http://` targets whose host is `localhost` or a loopback/unspecified IP are accepted, so this is not a general proxy or SSRF primitive toward the LAN. The response carries a 256-bit token scoped to the session, the calling surface and (for devices) the specific device. It expires after two idle hours, stops working if the setting is turned off, the session stops being shared, or the device is revoked, and a console token is not valid on the device surface.

Proxy routes sit outside the Origin checks because a sandboxed frame sends `Origin: null` and cannot hold the device credential. The token is the credential, so treat bridge URLs as secrets. Every bridge response carries `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'`, which gives the document an opaque origin even when opened directly in a tab; proxied pages cannot read Companion's storage or device credential. The UI frame repeats this with `sandbox="allow-scripts allow-forms allow-modals"` (no same-origin, popups, top navigation or downloads). Only a fixed allowlist of upstream response headers is forwarded, so an upstream cannot set cookies, send `Clear-Site-Data`, relax the sandbox or change framing; `Cookie` and `Referer` are not forwarded upstream, `Origin` is rewritten to the target, and redirects are rewritten to stay inside the bridge. Responses are `no-store` with `Access-Control-Allow-Origin: *` (no credentials are involved). HTML, CSS and JavaScript up to 5 MiB have root-relative URLs rewritten; this is heuristic. WebSockets are not proxied.

Residual risk: a localhost server is trusted to the extent the person confirmed it. Pages from it run scripts inside the sandbox and can call back to that same server through the bridge, so opening a server that exposes dangerous local endpoints exposes them to that frame. Do not open servers you would not open in your own browser.

### Pi bridge

Each Pi process keeps one outbound localhost WebSocket to the daemon. The browser cannot invoke arbitrary extension tools. The allowed command set is a closed protocol.

## Files

Uploads are daemon-owned and session-scoped.

The browser cannot choose a destination path. The daemon derives a final filename (last path component, no control characters or leading dots), prefixes it with an opaque id, and places it in the current session sandbox. Session ids that reach the filesystem are restricted to `[A-Za-z0-9_-]`.

Uploads above the configured size limit are refused (HTTP 413) and their partial file is removed. An optional MIME allowlist (Settings) refuses other types with HTTP 415; both the type implied by the file name and any specific declared Content-Type must be allowed.

Agent deletion uses the opaque id rather than a path. Before unlinking, the daemon verifies that the recorded file is still beneath the expected session sandbox.

## Non-goals

Pi Companion does not provide:

- arbitrary remote shell access (paired devices can start admin-authored automation commands)
- arbitrary filesystem browsing (the bridge fetches only agent-mentioned files inside the working directory and shared temp folder)
- arbitrary tool invocation
- direct git push/commit endpoints
- a second copy of Pi conversation state

These should remain Pi actions, where Pi's existing policies and agent loop remain in control.
