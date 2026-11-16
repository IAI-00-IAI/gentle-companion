// Unit tests for the phone-side tunnel QR pairing (feature tailcat-client T3, spec S3).
// Run: node --test --experimental-strip-types --no-warnings ui/tests/tailcat-pairing.test.ts
//
// The daemon's tunnel pairing QR encodes the pairing URL with the tunnel address and
// device port in the URL fragment (`#tunnel=<addr>&port=<port>`): fragments are never
// sent to the server, so neither value can end up in daemon logs. On boot the UI
// consumes the fragment into the same localStorage keys the tunnel mode reads (one
// source of truth with the bridge page, spec S2) and strips it from the address bar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TUNNEL_PORT, TUNNEL_ADDR_KEY, TUNNEL_PORT_KEY } from '../src/lib/tailcat-tunnel.ts';
import { parseTunnelPairing, storeTunnelPairing } from '../src/lib/tailcat-pairing.ts';

// mapStorage adapts a plain object to the Storage surface storeTunnelPairing needs.
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

test('parses the pairing fragment the tunnel QR encodes', () => {
  assert.deepEqual(parseTunnelPairing('#tunnel=tc-abc123&port=12345'), { addr: 'tc-abc123', port: 12345 });
});

test('a fragment without the tunnel parameter parses to null', () => {
  assert.equal(parseTunnelPairing(''), null);
  assert.equal(parseTunnelPairing('#'), null);
  assert.equal(parseTunnelPairing('#other=1'), null);
  assert.equal(parseTunnelPairing('#tunnel='), null);
  assert.equal(parseTunnelPairing('#tunnel=%20%20'), null);
});

test('a missing or invalid port falls back to the daemon device port', () => {
  assert.deepEqual(parseTunnelPairing('#tunnel=tc-abc123'), { addr: 'tc-abc123', port: DEFAULT_TUNNEL_PORT });
  for (const port of ['0', '70000', 'abc', '-1', '43722.5']) {
    assert.equal(parseTunnelPairing(`#tunnel=tc-abc123&port=${port}`)?.port, DEFAULT_TUNNEL_PORT, `port ${port}`);
  }
  assert.equal(DEFAULT_TUNNEL_PORT, 43722);
});

test('the tunnel address is trimmed', () => {
  assert.deepEqual(parseTunnelPairing('#tunnel=%20tc-abc123%20&port=12345'), { addr: 'tc-abc123', port: 12345 });
});

test('storing writes the tunnel-mode localStorage keys (S2, one source of truth)', () => {
  const storage = mapStorage({ [TUNNEL_ADDR_KEY]: 'stale', [TUNNEL_PORT_KEY]: '999' });
  assert.equal(storeTunnelPairing({ addr: 'tc-abc123', port: 12345 }, storage), true);
  assert.equal(storage.getItem(TUNNEL_ADDR_KEY), 'tc-abc123');
  assert.equal(storage.getItem(TUNNEL_PORT_KEY), '12345');
  // The stored port is overwritten even when the QR encodes the default port.
  assert.equal(storeTunnelPairing({ addr: 'tc-def456', port: DEFAULT_TUNNEL_PORT }, storage), true);
  assert.equal(storage.getItem(TUNNEL_ADDR_KEY), 'tc-def456');
  assert.equal(storage.getItem(TUNNEL_PORT_KEY), String(DEFAULT_TUNNEL_PORT));
});

test('a rejected pairing (no fragment) and blocked storage store nothing', () => {
  const storage = mapStorage();
  assert.equal(storeTunnelPairing(null, storage), false);
  assert.equal(storage.getItem(TUNNEL_ADDR_KEY), null);
  assert.equal(storage.getItem(TUNNEL_PORT_KEY), null);
  const blocked = {
    setItem: () => { throw new Error('blocked'); }
  } as Pick<Storage, 'setItem'>;
  assert.equal(storeTunnelPairing({ addr: 'tc-abc123', port: 1 }, blocked), false);
});
