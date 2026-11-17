/**
 * Tunnel mode configuration for the Companion UI (feature tailcat-client T2, spec S1).
 *
 * Mode source (documented decision): the UI reuses the bridge page's localStorage
 * keys — `companion-bridge.tunnel-addr` / `companion-bridge.device-port`
 * (bridge/app.js STORAGE_KEY / PORT_STORAGE_KEY) — so the bridge page, the future QR
 * pairing flow and the UI share one source of truth, and no new storage schema is
 * introduced. Tunnel mode is active only when a non-empty tunnel address is stored;
 * the port falls back to the daemon's default device port when absent or invalid
 * (a tunnel port of 0 means the daemon device port, so 43722 is the equivalent default).
 *
 * Pure module: no DOM access, unit-tested by ui/tests/tailcat-tunnel.test.ts.
 */

export const TUNNEL_ADDR_KEY = 'companion-bridge.tunnel-addr';
export const TUNNEL_PORT_KEY = 'companion-bridge.device-port';

/** The daemon device port (server/src/main.rs device_port()); a tunnel port of 0 means this. */
export const DEFAULT_TUNNEL_PORT = 43722;

export type TunnelConfig = { addr: string; port: number };

/** True when the value is a valid device/tunnel port (integer 1-65535). */
export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Reads the tunnel mode configuration from a Storage (or null under SSR / when
 * storage is blocked). Returns null when tunnel mode is off — the UI then uses its
 * existing local/remote behavior untouched.
 */
export function readTunnelConfig(storage: Pick<Storage, 'getItem'> | null): TunnelConfig | null {
  if (!storage) return null;
  let addr: string | null = null;
  let portValue: string | null = null;
  try {
    addr = storage.getItem(TUNNEL_ADDR_KEY);
    portValue = storage.getItem(TUNNEL_PORT_KEY);
  } catch {
    return null; // storage blocked: tunnel mode cannot be configured
  }
  const trimmed = addr?.trim();
  if (!trimmed) return null;
  const parsed = portValue === null ? NaN : Number(portValue);
  return { addr: trimmed, port: isValidPort(parsed) ? parsed : DEFAULT_TUNNEL_PORT };
}
