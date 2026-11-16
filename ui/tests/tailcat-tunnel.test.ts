// Unit tests for the Companion UI's tailcat tunnel mode (feature tailcat-client T1+T2).
// Run: node --test --experimental-strip-types --no-warnings ui/tests/tailcat-tunnel.test.ts
//
// Covers mode detection (localStorage keys shared with bridge/app.js), the tunnel HTTP
// transport (bridgeFetch mapped through workspaceRequest's error classification), the
// deferred tunnel socket (sync LiveConnection.create over an async dial), and the T1
// bridge shim re-export wrapper.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TUNNEL_PORT, readTunnelConfig, TUNNEL_ADDR_KEY, TUNNEL_PORT_KEY } from '../src/lib/tailcat-tunnel.ts';
import { createTunnelDialer, createTunnelSocket, createTunnelTransport } from '../src/lib/tailcat-transport.ts';
import { pickDerpMapURL } from '../src/lib/tailcat-runtime.ts';
import { ApiError, WorkspaceConnectionError, unreachableMessage, workspaceRequest } from '../src/lib/workspace-connection.ts';
import { bridgeFetch, setBridgeDialer, TunnelWebSocket } from '../src/lib/bridge.ts';
import { computeAccept, encodeFrame } from '../../bridge/ws.js';

// mapStorage adapts a plain object to the Storage surface readTunnelConfig needs.
function mapStorage(entries: Record<string, string> = {}): Storage {
  return {
    getLength: () => Object.keys(entries).length,
    key: () => null,
    clear: () => {},
    removeItem: (key: string) => { delete entries[key]; },
    setItem: (key: string, value: string) => { entries[key] = value; },
    getItem: (key: string) => entries[key] ?? null
  } as Storage;
}

// waitFor polls until fn() is true or the timeout elapses.
async function waitFor(fn: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !fn()) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(fn(), 'condition not met within timeout');
}

// fakeConn returns a programmable tailcat conn: reads are served from a queue,
// writes are recorded, closeWrite/close are tracked.
function fakeConn() {
  const state = {
    written: [] as Uint8Array[],
    closeWriteCalled: false,
    closed: false,
    queue: [] as (Uint8Array | null)[],
    pending: [] as ((chunk: Uint8Array | null) => void)[]
  };
  const conn = {
    port: 1,
    read: () => new Promise<Uint8Array | null>((resolve) => {
      if (state.queue.length) resolve(state.queue.shift()!);
      else state.pending.push(resolve);
    }),
    write: async (bytes: Uint8Array) => { state.written.push(bytes); },
    closeWrite: async () => { state.closeWriteCalled = true; },
    close: () => { state.closed = true; }
  };
  return { conn, state,
    push(chunk: Uint8Array | null) {
      const pending = state.pending.shift();
      if (pending) pending(chunk);
      else state.queue.push(chunk);
    } };
}

// httpResponseConn adapts fakeConn into a one-shot HTTP server: when the client
// half-closes (request complete), it answers with the given response and EOF.
function httpResponseConn(status: number, headers: Record<string, string>, body: string) {
  const fake = fakeConn();
  const plainCloseWrite = fake.conn.closeWrite;
  fake.conn.closeWrite = async () => {
    await plainCloseWrite();
    const head = Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n');
    fake.push(new TextEncoder().encode(`HTTP/1.1 ${status} Test\r\n${head}\r\n\r\n${body}`));
    fake.push(null);
  };
  return fake;
}

// wsHandshakeConn adapts fakeConn into a minimal RFC 6455 server: it answers the
// client handshake with a valid 101 (accept computed from the offered key), then one
// unmasked text frame, and echoes the client's close frame back (like the daemon's
// /ws/browser) before EOF so the closing handshake completes.
function wsHandshakeConn(frameText: string) {
  const fake = fakeConn();
  const plainWrite = fake.conn.write;
  fake.conn.write = async (bytes: Uint8Array) => {
    await plainWrite(bytes);
    if (bytes.length >= 2 && (bytes[0] & 0x0f) === 0x8) {
      fake.push(bytes.subarray(0, 2)); // echo the close frame
      fake.push(null);
      return;
    }
    const request = new TextDecoder().decode(bytes);
    const key = /Sec-WebSocket-Key: (.+)/.exec(request)?.[1]?.trim();
    if (key === undefined) return;
    fake.push(new TextEncoder().encode(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      `Sec-WebSocket-Accept: ${computeAccept(key)}\r\n` +
      'Sec-WebSocket-Protocol: pi-companion\r\n\r\n'
    ));
    fake.push(encodeFrame(0x1, frameText, { mask: false }));
  };
  return fake;
}

test('no tunnel keys in storage means local/remote mode (null config)', () => {
  assert.equal(readTunnelConfig(mapStorage()), null);
});

test('tunnel address with a saved device port yields the config', () => {
  const config = readTunnelConfig(mapStorage({ [TUNNEL_ADDR_KEY]: 'tc:abcd1234', [TUNNEL_PORT_KEY]: '12345' }));
  assert.deepEqual(config, { addr: 'tc:abcd1234', port: 12345 });
});

test('tunnel address without a saved port falls back to the daemon device port', () => {
  const config = readTunnelConfig(mapStorage({ [TUNNEL_ADDR_KEY]: 'tc:abcd1234' }));
  assert.deepEqual(config, { addr: 'tc:abcd1234', port: DEFAULT_TUNNEL_PORT });
  assert.equal(DEFAULT_TUNNEL_PORT, 43722);
});

test('invalid saved ports (0, out of range, garbage) fall back to the device port', () => {
  for (const port of ['0', '70000', 'abc', '-1', '43722.5']) {
    const config = readTunnelConfig(mapStorage({ [TUNNEL_ADDR_KEY]: 'tc:abcd1234', [TUNNEL_PORT_KEY]: port }));
    assert.equal(config?.port, DEFAULT_TUNNEL_PORT, `port ${port}`);
  }
});

test('a blank address means no tunnel mode, even with a port saved', () => {
  assert.equal(readTunnelConfig(mapStorage({ [TUNNEL_ADDR_KEY]: '   ', [TUNNEL_PORT_KEY]: '43722' })), null);
});

test('the tunnel address is trimmed', () => {
  const config = readTunnelConfig(mapStorage({ [TUNNEL_ADDR_KEY]: '  tc:abcd1234  ' }));
  assert.equal(config?.addr, 'tc:abcd1234');
});

test('null storage (SSR) means no tunnel mode', () => {
  assert.equal(readTunnelConfig(null), null);
});

test('the bridge wrapper re-exports the real shims (T1, no copies)', async () => {
  assert.equal(typeof bridgeFetch, 'function');
  assert.equal(typeof setBridgeDialer, 'function');
  assert.equal(TunnelWebSocket.CONNECTING, 0);
  assert.equal(TunnelWebSocket.OPEN, 1);
  // Drive one request through the re-exported shim to prove it is the real code path.
  const fake = httpResponseConn(200, { 'content-type': 'application/json' }, '{"ok":true}');
  setBridgeDialer(async () => fake.conn);
  try {
    const response = await bridgeFetch('tc:x', 1, 'GET', '/api/probe', undefined);
    assert.equal(response.status, 200);
    assert.deepEqual(response.bodyJson(), { ok: true });
    assert.equal(fake.state.closeWriteCalled, true);
  } finally {
    setBridgeDialer(null);
  }
});

test('tunnel transport carries the request through bridgeFetch and parses JSON', async () => {
  const fake = httpResponseConn(200, { 'content-type': 'application/json' }, '{"version":"0.4.3"}');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  const result = await workspaceRequest<{ version: string }>('/api/context', {}, 10_000, 'json', transport);
  assert.deepEqual(result, { version: '0.4.3' });
  const request = new TextDecoder().decode(fake.state.written[0]);
  assert.match(request, /^GET \/api\/context HTTP\/1\.1/);
  assert.match(request, /Connection: close/);
  assert.equal(fake.state.closeWriteCalled, true);
});

test('tunnel transport sends POST bodies as JSON strings', async () => {
  const fake = httpResponseConn(200, { 'content-type': 'application/json' }, '{}');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  await workspaceRequest('/api/pairing/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '1234', deviceName: 'phone' }) }, 10_000, 'json', transport);
  const request = new TextDecoder().decode(fake.state.written[0]);
  assert.match(request, /^POST \/api\/pairing\/claim HTTP\/1\.1/);
  assert.match(request, /Content-Length: \d+/);
  assert.match(request, /"code":"1234"/);
});

test('tunnel transport maps HTTP 502 to WorkspaceConnectionError', async () => {
  const fake = httpResponseConn(502, { 'content-type': 'text/plain' }, 'Bad gateway');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  await assert.rejects(
    workspaceRequest('/api/sessions', {}, 10_000, 'json', transport),
    (error: unknown) => error instanceof WorkspaceConnectionError &&
      error.message === 'Workspace unavailable (HTTP 502). The tunnel or its connection to your workspace may be down.'
  );
});

test('tunnel transport maps HTTP 401 to ApiError with the body text', async () => {
  const fake = httpResponseConn(401, { 'content-type': 'text/plain' }, 'Invalid device token.');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  await assert.rejects(
    workspaceRequest('/api/sessions', {}, 10_000, 'json', transport),
    (error: unknown) => error instanceof ApiError && error.status === 401 && error.message === 'Invalid device token.'
  );
});

test('tunnel transport maps an HTML 200 to WorkspaceConnectionError', async () => {
  const fake = httpResponseConn(200, { 'content-type': 'text/html' }, '<!doctype html><html></html>');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  await assert.rejects(
    workspaceRequest('/api/settings', {}, 10_000, 'json', transport),
    (error: unknown) => error instanceof WorkspaceConnectionError &&
      error.message === 'This address did not return a workspace response. Check that the tunnel is running and you opened the current Gentle Companion URL.'
  );
});

test('tunnel transport maps a dial failure to WorkspaceConnectionError', async () => {
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => { throw new Error('ping: no route'); } });
  await assert.rejects(
    workspaceRequest('/api/context', {}, 10_000, 'json', transport),
    (error: unknown) => error instanceof WorkspaceConnectionError && error.message !== 'ping: no route'
  );
});

test('tunnel transport honors the workspaceRequest timeout', async () => {
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: () => new Promise(() => {}) });
  await assert.rejects(
    workspaceRequest('/api/context', {}, 20, 'json', transport),
    (error: unknown) => error instanceof WorkspaceConnectionError && error.message.includes('did not respond in time')
  );
});

test('tunnel transport rethrows caller cancellation as-is', async () => {
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: () => new Promise(() => {}) });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    workspaceRequest('/api/context', { signal: controller.signal }, 10_000, 'json', transport),
    (error: unknown) => error instanceof Error && error.name === 'AbortError'
  );
});

test('tunnel transport maps HTTP 204 to undefined', async () => {
  const fake = httpResponseConn(204, {}, '');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  const result = await workspaceRequest('/api/sessions/x', { method: 'DELETE' }, 10_000, 'json', transport);
  assert.equal(result, undefined);
});

test('tunnel transport sends the Authorization header through to the tunnel request', async () => {
  const fake = httpResponseConn(200, { 'content-type': 'application/json' }, '{"sessions":[]}');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  const result = await workspaceRequest('/api/sessions', { headers: { authorization: 'Bearer dev-token' } }, 10_000, 'json', transport);
  assert.deepEqual(result, { sessions: [] });
  const request = new TextDecoder().decode(fake.state.written[0]);
  assert.match(request, /Authorization: Bearer dev-token\r\n/);
  assert.match(request, /Connection: close\r\n/);
});

test('tunnel transport forwards all caller headers to the shim', async () => {
  const fake = httpResponseConn(200, { 'content-type': 'application/json' }, '{}');
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fake.conn });
  await transport('/api/settings', { headers: new Headers({ 'content-type': 'application/json', 'x-trace': 'abc' }) }, 'json');
  const request = new TextDecoder().decode(fake.state.written[0]);
  assert.match(request, /Content-Type: application\/json\r\n/);
  assert.match(request, /X-Trace: abc\r\n/);
});

test('tunnel transport refuses file uploads with a clear error', async () => {
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fakeConn().conn });
  await assert.rejects(
    transport('/api/sessions/x/files', { method: 'POST', body: new FormData() }, 'json'),
    /uploads are not supported/i
  );
});

test('tunnel transport refuses file downloads with a clear error', async () => {
  const transport = createTunnelTransport({ addr: 'tc:x', port: 5 }, { dial: async () => fakeConn().conn });
  await assert.rejects(
    transport('/api/sessions/x/files/y', {}, 'blob'),
    /downloads are not supported/i
  );
});

test('workspaceRequest without a transport still uses fetch (existing modes preserved)', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await workspaceRequest<{ ok: number }>('/api/context');
    assert.deepEqual(result, { ok: 1 });
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  await assert.rejects(
    workspaceRequest('/api/context', {}, 10_000, 'json'),
    (error: unknown) => error instanceof WorkspaceConnectionError && error.message === unreachableMessage()
  );
});

test('tunnel dialer loads the runtime, picks the DERP map and dials with the config', async () => {
  const fake = fakeConn();
  let loads = 0;
  let captured: { addr: string; derpMapURL: string; port: number } | null = null;
  const dialer = createTunnelDialer({ addr: 'tc:x', port: 43722 }, {
    load: async () => { loads++; },
    pickDerpMap: async () => 'https://derp.test/map.json',
    tailcatDial: async (options) => { captured = options as typeof captured; return fake.conn; }
  });
  const conn = await dialer();
  assert.equal(conn, fake.conn);
  assert.equal(loads, 1);
  assert.deepEqual(captured, { addr: 'tc:x', derpMapURL: 'https://derp.test/map.json', port: 43722, verbose: false });
});

test('tunnel dialer reports a missing tailcat runtime clearly', async () => {
  const dialer = createTunnelDialer({ addr: 'tc:x', port: 43722 }, {
    load: async () => {},
    pickDerpMap: async () => 'https://derp.test/map.json'
  });
  await assert.rejects(dialer(), /tailcat client runtime is not available/);
});

test('pickDerpMapURL prefers the explicit ?derpmap= parameter', async () => {
  const url = await pickDerpMapURL({
    params: new URLSearchParams('derpmap=https://elsewhere.test/map.json'),
    base: 'https://companion.test/sessions',
    probe: async () => { throw new Error('must not probe'); }
  });
  assert.equal(url, 'https://elsewhere.test/map.json');
});

test('pickDerpMapURL probes the serving-contract path, then the page-relative path, then the canonical map', async () => {
  const probed: string[] = [];
  const probe = async (url: string) => { probed.push(url); return { ok: false }; };
  const url = await pickDerpMapURL({ params: new URLSearchParams(), base: 'https://companion.test/', probe });
  assert.equal(url, 'https://tailcat.dev/derpmap.json');
  assert.deepEqual(probed, ['https://companion.test/bridge/derpmap.json', 'https://companion.test/derpmap.json']);

  probed.length = 0;
  const url2 = await pickDerpMapURL({
    params: new URLSearchParams(),
    base: 'https://companion.test/',
    probe: async (candidate) => { probed.push(candidate); return { ok: candidate.endsWith('/bridge/derpmap.json') }; }
  });
  assert.equal(url2, 'https://companion.test/bridge/derpmap.json');

  const url3 = await pickDerpMapURL({
    params: new URLSearchParams(),
    base: 'https://static.test/bridge/',
    probe: async (candidate) => ({ ok: candidate === 'https://static.test/bridge/derpmap.json' })
  });
  assert.equal(url3, 'https://static.test/bridge/derpmap.json');
});

test('deferred tunnel socket opens, delivers frames and sends over the tunneled conn', async () => {
  const fake = wsHandshakeConn('hello');
  const socket = createTunnelSocket({ addr: 'tc:x', port: 5 }, { token: 'sekrit', dial: async () => fake.conn });
  const events = { open: 0, messages: [] as string[], closed: [] as number[] };
  socket.onopen = () => events.open++;
  socket.onmessage = (event) => events.messages.push(String(event.data));
  socket.onclose = (event) => events.closed.push(event.code);
  assert.equal(socket.readyState, 0); // connecting until the dial resolves
  await waitFor(() => events.open === 1);
  assert.equal(socket.readyState, 1);
  await waitFor(() => events.messages.length === 1);
  assert.equal(events.messages[0], 'hello');
  socket.send('ping');
  assert.equal(fake.state.written.length, 2); // handshake + data frame
  const handshake = new TextDecoder().decode(fake.state.written[0]);
  assert.match(handshake, /^GET \/ws\/browser HTTP\/1\.1/);
  assert.match(handshake, /Sec-WebSocket-Protocol: pi-companion, token\.sekrit/);
  socket.close();
  await waitFor(() => events.closed.length === 1);
  assert.equal(socket.readyState, 3);
});

test('deferred tunnel socket forwards the tunnel handshake to the daemon surface', async () => {
  const fake = wsHandshakeConn('{}');
  const socket = createTunnelSocket({ addr: 'tc:x', port: 5 }, { token: 't', dial: async () => fake.conn });
  socket.onopen = () => {};
  await waitFor(() => socket.readyState === 1);
  const handshake = new TextDecoder().decode(fake.state.written[0]);
  assert.match(handshake, /Sec-WebSocket-Protocol: pi-companion, token\.t/);
});

test('deferred tunnel socket reports a dial failure as onerror + onclose(1006)', async () => {
  const socket = createTunnelSocket({ addr: 'tc:x', port: 5 }, { token: '', dial: async () => { throw new Error('ping: timeout'); } });
  const events = { errors: 0, closed: [] as number[], open: 0 };
  socket.onopen = () => events.open++;
  socket.onerror = () => events.errors++;
  socket.onclose = (event) => events.closed.push(event.code);
  await waitFor(() => events.closed.length === 1);
  assert.equal(events.errors, 1);
  assert.deepEqual(events.closed, [1006]);
  assert.equal(events.open, 0);
  assert.equal(socket.readyState, 3);
});

test('deferred tunnel socket closed while dialing cancels the conn and fires close(1006)', async () => {
  let releaseDial: ((conn: ReturnType<typeof fakeConn>['conn']) => void) | null = null;
  const fake = fakeConn();
  const socket = createTunnelSocket({ addr: 'tc:x', port: 5 }, {
    token: '',
    dial: () => new Promise((resolve) => { releaseDial = resolve; })
  });
  const events = { open: 0, closed: [] as number[] };
  socket.onopen = () => events.open++;
  socket.onclose = (event) => events.closed.push(event.code);
  socket.close();
  assert.equal(socket.readyState, 3);
  await waitFor(() => events.closed.length === 1);
  assert.deepEqual(events.closed, [1006]);
  releaseDial!(fake.conn);
  await waitFor(() => fake.state.closed);
  assert.equal(events.open, 0); // a retired socket must not look open to LiveConnection
});

test('deferred tunnel socket rejects sends before the tunnel is open', async () => {
  const socket = createTunnelSocket({ addr: 'tc:x', port: 5 }, { token: '', dial: () => new Promise(() => {}) });
  assert.throws(() => socket.send('too early'), /not open/i);
});
