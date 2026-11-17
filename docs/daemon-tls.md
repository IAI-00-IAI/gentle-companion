# HTTPS for the Companion client (installable app)

The Companion client is served over plain HTTP by default. Browsers only expose a
**secure context** — service workers, the Cache API, and installable web apps — over
HTTPS, so a phone opening the daemon by LAN IP can only "install this web page", not
the app. This document explains how to enable HTTPS and what it does and does not fix.

## Why a dedicated port

`tailcat serve` always forwards tunneled connections to `127.0.0.1:<device port>` as
**plain HTTP**. That is why the daemon runs a loopback mirror listener on the device
port: the tunnel path must stay plain HTTP or the tunnel breaks.

HTTPS therefore lives on **its own port**, next to the plain-HTTP device surface:

| Surface | Default port | Protocol | Purpose |
| --- | --- | --- | --- |
| Device surface | `43722` | HTTP | LAN access and the tailcat tunnel |
| HTTPS surface | `43723` | HTTPS | Installable app (secure context) |

The client prefers whichever path works: direct LAN, HTTPS when configured, and the
tunnel when the daemon is not reachable directly.

## Enabling it

### Self-signed certificate (quickest)

    PI_COMPANION_TLS_SELF_SIGNED=1 gentle-companion-server

The daemon generates `<companion home>/tls/cert.pem` and `key.pem` on first start
(key mode `0600`), reuses them afterwards so the fingerprint stays stable, and prints:

    HTTPS            generated self-signed certificate
    Certificate      /home/you/.pi/agent/pi-companion/tls/cert.pem
    SHA-256          33:13:29:34:8E:58:51:CA:...
    HTTPS surface    https://192.168.43.73:43723

### Your own certificate

    PI_COMPANION_TLS_CERT=/path/cert.pem PI_COMPANION_TLS_KEY=/path/key.pem gentle-companion-server

Both variables are required: setting only one makes the daemon refuse to start and
name the missing variable, rather than silently serving HTTP while the user believes
TLS is on.

### Port

`PI_COMPANION_TLS_PORT` overrides the HTTPS port. It defaults to the device port plus
one, so it never collides with the tunnel.

## What the certificate covers

The generated certificate lists the addresses a client actually dials:

- the bind host, when it is a specific address;
- **this machine's LAN IPv4 addresses**, when the bind is a wildcard (`0.0.0.0`);
- `localhost` and `127.0.0.1`, always.

A wildcard bind never becomes a certificate name. `0.0.0.0` is an instruction to the
kernel, not a host a phone can type, so a certificate carrying it is rejected for the wrong
host even after the CA is trusted. The wildcard is replaced by the machine's own addresses
instead. If the machine has no non-loopback address, the certificate covers loopback only.

The certificate is **reused** across restarts, so the fingerprint stays stable. Delete
`<data dir>/tls/` to force a new one — necessary after the machine's LAN address changes,
because the old certificate will not name the new address.

## Trusting the certificate on the phone

A self-signed certificate shows a warning and, more importantly, **blocks service
worker registration** until it is trusted. Install it as a CA:

**Android**

1. Copy `cert.pem` to the phone (or open `https://<ip>:43723/cert.pem` once the daemon
   serves it).
2. Settings → Security → Encryption & credentials → Install a certificate → **CA
   certificate** → pick the file.
3. Reload the client. Chrome now treats the origin as secure and offers *Install app*.

**iOS**

1. Open the certificate file → *Allow* → the profile downloads.
2. Settings → General → VPN & Device Management → install the profile.
3. Settings → General → About → Certificate Trust Settings → enable full trust.

Compare the fingerprint the daemon printed with the one the phone shows before
trusting it.

## What this fixes, and what it does not

**Fixes**

- The client runs in a secure context: the service worker registers, the app shell is
  cached, and the browser offers *Install app*.
- Reloading the page while off the LAN works, because the service worker serves the
  shell from cache and the tunnel carries the data.

**Does not fix**

- The tunnel itself: it keeps using plain HTTP on the device port, by design.
- Certificate warnings if you use a self-signed certificate and do not trust it.
- Binary transfers over the tunnel (uploads and downloads) — still unsupported.

## Verifying

    curl -k https://<ip>:43723/api/context     # HTTPS surface answers
    curl    http://<ip>:43722/api/context      # device surface and tunnel stay plain

Both must answer. If the HTTPS port is silent, check the daemon log: a certificate
that cannot be loaded is reported at startup and the plain surface keeps working.
