// Unit tests for the UI boot hook that consumes the tunnel pairing fragment
// (feature tailcat-client T3, spec S3). Run:
//   node --test --experimental-strip-types --no-warnings ui/tests/tailcat-boot.test.ts
//
// The hook runs once before companion.boot(): it parses the fragment the tunnel QR
// encoded (#tunnel=<addr>&port=<port>), stores it into the tunnel-mode localStorage
// keys (one source of truth with the bridge page, spec S2) and strips the fragment
// from the address bar so a reload or a shared URL never re-carries the address.

import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeTunnelPairingFragment } from '../src/lib/tailcat-boot.ts';
import { TUNNEL_ADDR_KEY, TUNNEL_PORT_KEY } from '../src/lib/tailcat-tunnel.ts';

// mapStorage adapts a plain object to the Storage surface the hook writes.
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

// fakeLocation stubs the page URL the hook reads; replace() records its argument.
function fakeLocation(href: string) {
  const calls: string[] = [];
  return {
    href,
    hash: new URL(href).hash,
    replaceState(url: string) { calls.push(url); },
    replaced: () => calls
  };
}

test('a pairing fragment is stored into the tunnel-mode keys and stripped', () => {
  const storage = mapStorage();
  const location = fakeLocation('https://tc.example/pair?invite=tok#tunnel=tc-abc123&port=12345');
  const pairing = consumeTunnelPairingFragment(location, storage);
  assert.deepEqual(pairing, { addr: 'tc-abc123', port: 12345 });
  assert.equal(storage.getItem(TUNNEL_ADDR_KEY), 'tc-abc123');
  assert.equal(storage.getItem(TUNNEL_PORT_KEY), '12345');
  assert.deepEqual(location.replaced(), ['https://tc.example/pair?invite=tok']);
});

test('a fragment without tunnel parameters is stripped but stores nothing', () => {
  const storage = mapStorage();
  const location = fakeLocation('https://tc.example/pair#other=1');
  assert.equal(consumeTunnelPairingFragment(location, storage), null);
  assert.equal(storage.getItem(TUNNEL_ADDR_KEY), null);
  assert.deepEqual(location.replaced(), ['https://tc.example/pair']);
});

test('no fragment means no storage write and no history change', () => {
  const storage = mapStorage();
  const location = fakeLocation('https://tc.example/pair?invite=tok');
  assert.equal(consumeTunnelPairingFragment(location, storage), null);
  assert.equal(storage.getItem(TUNNEL_ADDR_KEY), null);
  assert.deepEqual(location.replaced(), []);
});

test('stale saved tunnel values are overwritten by the fragment, even defaults', () => {
  const storage = mapStorage({ [TUNNEL_ADDR_KEY]: 'stale', [TUNNEL_PORT_KEY]: '999' });
  const location = fakeLocation('https://tc.example/pair?invite=tok#tunnel=tc-new&port=43722');
  const pairing = consumeTunnelPairingFragment(location, storage);
  assert.deepEqual(pairing, { addr: 'tc-new', port: 43722 });
  assert.equal(storage.getItem(TUNNEL_ADDR_KEY), 'tc-new');
  assert.equal(storage.getItem(TUNNEL_PORT_KEY), '43722');
});

test('blocked storage strips the fragment but keeps tunnel mode off', () => {
  const storage = { setItem: () => { throw new Error('blocked'); } } as Pick<Storage, 'setItem'>;
  const location = fakeLocation('https://tc.example/pair?invite=tok#tunnel=tc-abc123');
  assert.equal(consumeTunnelPairingFragment(location, storage), null);
  assert.deepEqual(location.replaced(), ['https://tc.example/pair?invite=tok']);
});
