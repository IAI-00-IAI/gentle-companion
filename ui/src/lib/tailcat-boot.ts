/**
 * Boot hook for the phone-side tunnel QR pairing (feature tailcat-client T3, spec S3).
 *
 * The daemon's tunnel pairing QR encodes the pairing URL with the tailcat address and
 * device port in the URL fragment (#tunnel=<addr>&port=<port>). When a phone opens
 * that URL, this hook runs once before companion.boot(): it parses the fragment,
 * stores it into the tunnel-mode localStorage keys the UI reads (one source of truth
 * with the bridge page, spec S2) and strips the fragment from the address bar, so a
 * reload or a shared URL never re-carries the tunnel address.
 *
 * The browser-dependent parts (history, storage) are injectable so
 * ui/tests/tailcat-boot.test.ts can cover the logic under plain Node.
 */

import { parseTunnelPairing, storeTunnelPairing, type TunnelPairing } from './tailcat-pairing.ts';

/** A Location + History subset the hook reads; injectable for tests. */
type PairingLocation = { href: string; hash: string; replaceState(url: string): void };

/**
 * Consumes the tunnel pairing fragment, if present. Returns the stored pairing or
 * null when the page was not opened from a tunnel pairing QR (or storage is blocked):
 * tunnel mode then stays off and the existing local/remote behavior runs. A foreign
 * fragment is still stripped so it cannot linger in the address bar or history.
 */
export function consumeTunnelPairingFragment(location: PairingLocation, storage: Pick<Storage, 'setItem'> | null): TunnelPairing | null {
  const pairing = parseTunnelPairing(location.hash);
  const stored = pairing ? storeTunnelPairing(pairing, storage) : false;
  if (location.hash) stripFragment(location);
  return stored ? pairing : null;
}

/** Replaces the current history entry with the same URL minus its fragment. */
function stripFragment(location: PairingLocation): void {
  try {
    const url = new URL(location.href);
    url.hash = '';
    // replaceState, not location.replace(): the page must not reload — boot has not
    // run yet, and a reload would lose the just-stored fragment consumer state.
    location.replaceState(url.href);
  } catch {
    // An unusable href (never in a real browser): leave the location untouched.
  }
}
