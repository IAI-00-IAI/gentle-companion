/**
 * Phone-side tunnel QR pairing (feature tailcat-client T3, spec S3).
 *
 * The daemon's tunnel pairing QR encodes the pairing URL with the tailcat address and
 * device port in the URL fragment — `…/pair?invite=<token>#tunnel=<addr>&port=<port>`.
 * The invite stays the only query parameter (single-use and short-lived as before);
 * the fragment is never sent to the server, so neither value can reach daemon logs,
 * proxies or the address bar history of later navigations.
 *
 * On boot the UI consumes the fragment into the exact localStorage keys the tunnel
 * mode reads (`companion-bridge.tunnel-addr` / `companion-bridge.device-port`, spec
 * S2 — one source of truth with the bridge page) and strips it from the address bar,
 * so a reload or a shared URL never re-carries the tunnel address.
 *
 * Pure module: no DOM access, unit-tested by ui/tests/tailcat-pairing.test.ts.
 */

import { DEFAULT_TUNNEL_PORT, TUNNEL_ADDR_KEY, TUNNEL_PORT_KEY, isValidPort, type TunnelConfig } from './tailcat-tunnel.ts';

/** One tunnel parameter set encoded in a pairing QR's fragment. */
export type TunnelPairing = { addr: string; port: number };

/** A Storage subset the fragment consumer writes; injectable for tests. */
type PairingStorage = Pick<Storage, 'setItem'>;

/**
 * Parses a URL fragment (`#tunnel=<addr>&port=<port>`, with or without the leading
 * `#`) into the tunnel configuration it carries, or null when it does not encode one.
 * The address is trimmed; a missing or invalid port falls back to the daemon's device
 * port, exactly like readTunnelConfig does for the stored value.
 */
export function parseTunnelPairing(fragment: string | null | undefined): TunnelPairing | null {
  if (!fragment) return null;
  const hash = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const addr = params.get('tunnel')?.trim();
  if (!addr) return null;
  const rawPort = params.get('port');
  const parsed = rawPort === null ? NaN : Number(rawPort);
  return { addr, port: isValidPort(parsed) ? parsed : DEFAULT_TUNNEL_PORT };
}

/**
 * Stores a parsed pairing into the tunnel-mode localStorage keys the UI reads at
 * boot. Returns false (storing nothing) when the pairing is null or storage is
 * blocked, so tunnel mode stays off and the existing local/remote behavior runs.
 */
export function storeTunnelPairing(pairing: TunnelPairing | null, storage: PairingStorage | null): boolean {
  if (!pairing || !storage) return false;
  try {
    storage.setItem(TUNNEL_ADDR_KEY, pairing.addr);
    // The default port is written too: the fragment is the freshest source and a
    // stale saved port must not outlive the QR that produced it.
    storage.setItem(TUNNEL_PORT_KEY, String(pairing.port));
    return true;
  } catch {
    return false;
  }
}
