// Ambient type declarations for bridge/http.js (the HTTP-over-stream shim).
//
// The Companion UI (ui/, TypeScript) imports the plain-JavaScript shim from
// outside the Vite project root; this declaration file gives it a strict
// surface without duplicating or transpiling the implementation. TS resolves
// the `…/bridge/http.js` specifier to this sibling `http.d.ts` under bundler
// module resolution, while Vite and Node load the real `http.js`.

/** One tunneled TCP stream, as returned by window.bridge.dial / tailcatDial. */
export interface BridgeConn {
  /** The device port the stream was dialed for. */
  readonly port: number;
  /** Pull-based read; resolves to null on EOF. */
  read(): Promise<Uint8Array | null>;
  /** Writes bytes onto the stream; await it before closeWrite() (tailcat's WASM conn races them). */
  write(bytes: Uint8Array): Promise<void>;
  /** Half-closes the stream: the request is complete, the response may still arrive. */
  closeWrite(): Promise<void>;
  /** Closes the stream. */
  close(): void;
}

/** The dial function bridgeFetch uses; `setBridgeDialer` replaces it (tests, embedding pages). */
export type BridgeDialer = (addr: string, port: number) => Promise<BridgeConn>;

/** Result of one bridgeFetch request: a parsed HTTP/1.1 response over the tunnel. */
export interface BridgeFetchResponse {
  readonly status: number;
  readonly statusText: string;
  /** Lowercased header names. */
  readonly headers: Record<string, string>;
  readonly bodyText: string;
  /** Parses bodyText as JSON (throws when it is not JSON). */
  bodyJson(): unknown;
}

/**
 * Sends one HTTP/1.1 request (Connection: close) through the tailcat tunnel and
 * resolves to the parsed response. A plain string body is sent as-is; any other
 * non-null body is JSON-encoded. headers adds extra request headers (e.g. the
 * device token's Authorization line). The stream is always closed before returning.
 */
export declare function bridgeFetch(addr: string, port: number, method: string, path: string, body?: string | object | null, headers?: Record<string, string>): Promise<BridgeFetchResponse>;

/** Injects the dialer used by bridgeFetch; pass null to restore the default lookup. */
export declare function setBridgeDialer(fn: BridgeDialer | null): void;

/** Serializes a request method + path + optional body + optional extra headers into HTTP/1.1 bytes. */
export declare function encodeRequest(method: string, path: string, body?: string | object | null, headers?: Record<string, string>): Uint8Array;

/** Incremental HTTP/1.1 response parser (see http.js for the full contract). */
export interface BridgeResponseParserResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array;
}

export declare function createResponseParser(): {
  push(chunk: Uint8Array): boolean;
  finish(): void;
  result(): BridgeResponseParserResult;
};
