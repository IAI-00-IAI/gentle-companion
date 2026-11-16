// Ambient type declarations for bridge/ws.js (the WebSocket-over-stream shim).
//
// The Companion UI (ui/, TypeScript) imports the plain-JavaScript shim from
// outside the Vite project root; this declaration file gives it a strict
// surface without duplicating or transpiling the implementation. TS resolves
// the `…/bridge/ws.js` specifier to this sibling `ws.d.ts` under bundler
// module resolution, while Vite and Node load the real `ws.js`.

/** One tunneled TCP stream, as returned by window.bridge.dial / tailcatDial. */
export interface WsBridgeConn {
  /** The device port the stream was dialed for. */
  readonly port: number;
  /** Pull-based read; resolves to null on EOF. */
  read(): Promise<Uint8Array | null>;
  /** Writes bytes onto the stream; await it before closeWrite() (tailcat's WASM conn races them). */
  write(bytes: Uint8Array): Promise<void>;
  /** Half-closes the stream. */
  closeWrite(): Promise<void>;
  /** Closes the stream. */
  close(): void;
}

/**
 * A WebSocket-like client over one tunneled stream: performs the /ws/browser
 * handshake (subprotocol `pi-companion`, optional Origin) and speaks RFC 6455
 * framing. On handshake or stream failure, onerror plus onclose({code: 1006})
 * fire, mirroring the browser WebSocket.
 */
export declare class TunnelWebSocket {
  static readonly CONNECTING: 0;
  static readonly OPEN: 1;
  static readonly CLOSING: 2;
  static readonly CLOSED: 3;

  url: string;
  readyState: number;

  onopen: (() => void) | null;
  onmessage: ((event: { data: string | Uint8Array }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null;

  constructor(conn: WsBridgeConn, path: string, options?: { protocols?: string[]; origin?: string });

  /** Sends one data frame: strings as text, anything else as binary. Throws while not OPEN. */
  send(data: string | Uint8Array): void;

  /** Starts the closing handshake (or drops a CONNECTING stream). */
  close(code?: number, reason?: string): Promise<void> | void;
}

/** base64 encodes bytes (btoa-based). */
export declare function base64(bytes: Uint8Array): string;

/** Pure-JS SHA-1 digest (Web Crypto lacks SHA-1 in every targeted engine). */
export declare function sha1(bytes: Uint8Array): Uint8Array;

/** Sec-WebSocket-Accept value for a handshake key, per RFC 6455 section 4.2.2. */
export declare function computeAccept(key: string): string;

/** Serializes one RFC 6455 frame; client frames are masked by default. */
export declare function encodeFrame(opcode: number, payload: string | Uint8Array, options?: { mask?: boolean; fin?: boolean }): Uint8Array;
