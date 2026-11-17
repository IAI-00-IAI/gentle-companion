/**
 * Build the link from the current plain-HTTP page to the daemon's HTTPS surface.
 *
 * Returns null when there is nothing honest to link to:
 * - the daemon has no HTTPS surface (`httpsPort` is 0), so a link would point at a closed
 *   port;
 * - the page is already HTTPS, where the link would be a no-op;
 * - the page is not served over http(s) at all (a test harness, a `file://` snapshot).
 *
 * The path, query and hash are preserved: a user reading a session should land on the same
 * session after switching to HTTPS, not on the overview.
 */
export function httpsLinkFor(currentHref: string, httpsPort: number): string | null {
  if (!Number.isInteger(httpsPort) || httpsPort <= 0 || httpsPort > 65535) return null;
  let url: URL;
  try {
    url = new URL(currentHref);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  url.protocol = 'https:';
  url.port = String(httpsPort);
  return url.toString();
}
