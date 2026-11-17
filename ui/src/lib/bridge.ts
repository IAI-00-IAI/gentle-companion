/**
 * Typed access to the Companion bridge shims (feature tailcat-client T1, spec S2).
 *
 * The shims live in plain JavaScript outside this Vite project (bridge/http.js,
 * bridge/ws.js) and are consumed here by re-export — never copied — so the
 * bridge test page and the real UI exercise exactly one implementation. The
 * ambient declarations in bridge/http.d.ts and bridge/ws.d.ts give the imports
 * their strict TypeScript surface; Vite bundles the real modules and Node loads
 * them directly.
 */
export { bridgeFetch, setBridgeDialer, encodeRequest, createResponseParser } from '../../../bridge/http.js';
export type { BridgeConn, BridgeDialer, BridgeFetchResponse } from '../../../bridge/http.js';
export { TunnelWebSocket, encodeFrame, computeAccept } from '../../../bridge/ws.js';
export type { WsBridgeConn } from '../../../bridge/ws.js';
