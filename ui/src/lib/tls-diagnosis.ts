/**
 * Decide whether a failed request most likely failed because the browser does not trust
 * this origin's certificate, rather than because the network is down.
 *
 * The browser gives no help here: a rejected certificate and an unreachable host both
 * surface as `TypeError: Failed to fetch`, with no status, no code and no message. So the
 * judgement rests on what can be observed:
 *
 * - the page is already on HTTPS, so a certificate is in play;
 * - the failure is a transport error, not an HTTP status the server answered with;
 * - the device reports itself online, so "no network" is not the explanation;
 * - the daemon advertised an HTTPS surface, so this origin is meant to serve one.
 *
 * This is deliberately a likelihood, not a verdict: it must never claim certainty it does
 * not have, because the fix it suggests (install the CA) does nothing for a dropped Wi-Fi.
 */
export type TlsProbe = {
  /** `location.protocol`, e.g. "https:". */
  protocol: string;
  /** True when the failure was a TypeError from fetch rather than an HTTP status. */
  transportFailure: boolean;
  /** `navigator.onLine`; true means the device thinks it has a connection. */
  online: boolean;
  /** The port the daemon advertises for HTTPS, or 0 when it has none. */
  httpsPort: number;
};

export function looksLikeUntrustedCertificate(probe: TlsProbe): boolean {
  if (probe.protocol !== 'https:') return false;
  if (!probe.transportFailure) return false;
  if (!probe.online) return false;
  if (!Number.isInteger(probe.httpsPort) || probe.httpsPort <= 0) return false;
  return true;
}

/** URL a phone can fetch the certificate from, for the same host the page is on. */
export function certificateUrlFor(currentHref: string): string | null {
  let url: URL;
  try {
    url = new URL(currentHref);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  url.pathname = '/cert.pem';
  url.search = '';
  url.hash = '';
  return url.toString();
}
