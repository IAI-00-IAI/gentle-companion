/**
 * Tunnel transports for the Companion UI (feature tailcat-client T2, spec S1/S2).
 *
 * In tunnel mode the UI reaches the daemon through a tailcat tunnel instead of
 * same-origin HTTP/WS:
 * - HTTP rides bridgeFetch (bridge/http.js, the existing shim — no copy) and is
 *   mapped onto a Response so workspaceRequest's error classification (ApiError /
 *   WorkspaceConnectionError) applies unchanged.
 * - The live WebSocket is a TunnelWebSocket (bridge/ws.js) over a dialed stream,
 *   wrapped in DeferredTunnelSocket because LiveConnection's create hook is
 *   synchronous while tailcatDial is async.
 *
 * Injectable module: dialing, runtime loading and DERP-map picking can be replaced,
 * so ui/tests/tailcat-tunnel.test.ts runs everything under plain Node.
 */

import { bridgeFetch, setBridgeDialer, TunnelWebSocket, type BridgeConn } from './bridge.ts';
import { WorkspaceConnectionError, type RequestTransport } from './workspace-connection.ts';
import type { TunnelConfig } from './tailcat-tunnel.ts';
import { loadTailcatRuntime, pickDerpMapURL, type TailcatRuntimeHooks } from './tailcat-runtime.ts';

export type TunnelDial = () => Promise<BridgeConn>;

function pageParams(): URLSearchParams {
  return typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
}

/** Creates the dialer: runtime + DERP map, then one tailcatDial stream to the device port. */
export function createTunnelDialer(config: TunnelConfig, hooks: TailcatRuntimeHooks = {}): TunnelDial {
  return async () => {
    const load = hooks.load ?? loadTailcatRuntime;
    const pickDerpMap = hooks.pickDerpMap ?? (() => pickDerpMapURL());
    await load();
    const dial = hooks.tailcatDial ?? (globalThis as { tailcatDial?: TailcatRuntimeHooks['tailcatDial'] }).tailcatDial;
    if (typeof dial !== 'function') {
      throw new Error('The tailcat client runtime is not available. Reload the page and retry.');
    }
    // Same capability as window.bridge.dial (bridge/app.js), called directly: the
    // bridge page's wrapper is not importable, and tailcatDial takes one options
    // object carrying the tunnel address, DERP map and device port.
    return (await dial({ addr: config.addr, derpMapURL: await pickDerpMap(), port: config.port, verbose: pageParams().has('verbose') })) as BridgeConn;
  };
}

/**
 * The RequestTransport for tunnel mode: every request is one HTTP/1.1 exchange over
 * a freshly dialed tunnel stream (Connection: close, so the daemon ends the stream
 * after the response). Results are mapped onto a real Response, so workspaceRequest
 * keeps classifying errors exactly as it does for plain fetch. Headers set by the
 * caller (including the device token's Authorization line) ride the tunnel request.
 *
 * Known limitations, each surfaced as a clear error instead of corrupt data:
 * - File uploads (FormData bodies) and binary downloads (responseType 'blob') are
 *   not supported by the shim yet.
 */
export function createTunnelTransport(config: TunnelConfig, hooks: TailcatRuntimeHooks & { dial?: TunnelDial } = {}): RequestTransport {
  const dial = hooks.dial ?? createTunnelDialer(config, hooks);
  return async (path, init, responseType) => {
    if (responseType === 'blob') {
      throw new Error('File downloads are not supported over the tailcat tunnel yet.');
    }
    if (init.body instanceof FormData || init.body instanceof Blob || init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) {
      throw new Error('File uploads are not supported over the tailcat tunnel yet.');
    }
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : init.body ? JSON.parse(String(init.body)) : undefined;
    const headers: Record<string, string> = {};
    for (const [name, value] of new Headers(init.headers).entries()) headers[name] = value;
    // bridgeFetch dials by itself through the injected dialer; scope it to this
    // request so concurrent transports (tests, multiple configs) cannot cross wires.
    setBridgeDialer(dial);
    try {
      const result = await raceDeadline(bridgeFetch(config.addr, config.port, method, path, body, headers), init.signal ?? undefined);
      // Null-body statuses (204, 304) reject a non-null body in the Response constructor.
      const nullBody = result.status === 204 || result.status === 205 || result.status === 304;
      return new Response(nullBody ? null : result.bodyText, { status: result.status, statusText: result.statusText, headers: result.headers });
    } finally {
      setBridgeDialer(null);
    }
  };
}

/**
 * Races the tunnel request against the workspaceRequest deadline (the composed
 * init.signal), so a hung tunnel surfaces as the same timeout
 * WorkspaceConnectionError a hung fetch would produce. Caller cancellation keeps
 * its semantics too: the composed signal aborts, the race rejects with an
 * AbortError, and workspaceRequest rethrows it because the caller's signal aborted.
 */
async function raceDeadline<T>(request: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return request;
  return Promise.race([
    request,
    new Promise<never>((_, reject) => {
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    })
  ]);
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;

/** Wraps a shim message in the browser MessageEvent shape LiveConnection reads. */
function toMessageEvent(data: string | Uint8Array): MessageEvent {
  return { data, lastEventId: '', origin: '', ports: [], source: null } as unknown as MessageEvent;
}

/** Wraps a shim close event in the browser CloseEvent shape LiveConnection reads. */
function toCloseEvent(event: { code: number; reason: string; wasClean: boolean }): CloseEvent {
  return { code: event.code, reason: event.reason, wasClean: event.wasClean } as unknown as CloseEvent;
}

/**
 * A WebSocket-like socket LiveConnection can create synchronously while the tunnel
 * dial resolves in the background. It mirrors the browser WebSocket semantics the
 * connection state machine relies on: readyState transitions, send() throwing while
 * not open, close() while connecting firing onclose(1006), and dial/handshake
 * failures surfacing as onerror + onclose(1006) so LiveConnection schedules a retry.
 */
export class DeferredTunnelSocket {
  static CONNECTING = SOCKET_CONNECTING;
  static OPEN = SOCKET_OPEN;
  static CLOSING = SOCKET_CLOSING;
  static CLOSED = SOCKET_CLOSED;

  readyState: number = SOCKET_CONNECTING;

  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;

  #cancelled = false;
  #settled = false;
  #underlying: TunnelWebSocket | null = null;
  readonly #dial: TunnelDial;
  readonly #path: string;
  readonly #origin: string;
  readonly #protocols: string[];

  constructor(dial: TunnelDial, options: { path: string; protocols: string[]; origin: string }) {
    this.#dial = dial;
    this.#path = options.path;
    this.#protocols = options.protocols;
    this.#origin = options.origin;
    void this.#start();
  }

  async #start() {
    let conn: BridgeConn;
    try {
      conn = await this.#dial();
    } catch (error) {
      this.#fail(error);
      return;
    }
    if (this.#cancelled) {
      conn.close();
      return;
    }
    // The shim performs the /ws/browser handshake and framing; failures surface
    // through onerror/onclose exactly like a browser WebSocket's would.
    const socket = new TunnelWebSocket(conn, this.#path, { protocols: this.#protocols, origin: this.#origin });
    this.#underlying = socket;
    socket.onopen = () => {
      if (this.#settled) return;
      this.readyState = SOCKET_OPEN;
      this.onopen?.(new Event('open'));
    };
    socket.onmessage = (event) => { this.onmessage?.(toMessageEvent(event.data)); };
    socket.onerror = (event) => { this.onerror?.(new Event('error')); };
    socket.onclose = (event) => {
      this.readyState = SOCKET_CLOSED;
      this.#settled = true;
      this.onclose?.(toCloseEvent(event));
    };
  }

  #fail(error: unknown) {
    this.readyState = SOCKET_CLOSED;
    this.#settled = true;
    this.onerror?.(new Event('error'));
    this.onclose?.(toCloseEvent({ code: 1006, reason: '', wasClean: false }));
  }

  send(data: string) {
    // Matches browser WebSocket semantics: sending while not open throws.
    // LiveConnection checks readyState first, so this only fires on misuse.
    if (this.readyState !== SOCKET_OPEN || !this.#underlying) throw new Error('WebSocket is not open');
    this.#underlying.send(data);
  }

  close() {
    if (this.#cancelled || this.readyState === SOCKET_CLOSED) return;
    if (this.readyState === SOCKET_CONNECTING || !this.#underlying) {
      // Browser WebSocket: close() while connecting fires onclose(1006) once the
      // attempt settles. LiveConnection.retire() ignores late events, but tests and
      // future callers rely on the observable state; the dialed conn, once it
      // arrives, is closed without ever opening.
      this.#cancelled = true;
      this.readyState = SOCKET_CLOSED;
      this.#settled = true;
      this.onclose?.(toCloseEvent({ code: 1006, reason: '', wasClean: false }));
      return;
    }
    void this.#underlying.close();
  }
}

/** Creates the LiveConnection socket for tunnel mode: a deferred TunnelWebSocket to /ws/browser. */
export function createTunnelSocket(
  config: TunnelConfig,
  options: { token: string; dial?: TunnelDial } & TailcatRuntimeHooks
): DeferredTunnelSocket {
  const dial = options.dial ?? createTunnelDialer(config, options);
  const protocols = options.token ? ['pi-companion', 'token.' + options.token] : ['pi-companion'];
  // The daemon's device surface only accepts allowed origins (its public URL origin,
  // loopback, PI_COMPANION_ALLOWED_ORIGINS); a daemon-served UI's own origin is one.
  return new DeferredTunnelSocket(dial, { path: '/ws/browser', protocols, origin: pageOrigin() });
}

function pageOrigin(): string {
  return typeof location === 'undefined' ? '' : location.origin;
}
