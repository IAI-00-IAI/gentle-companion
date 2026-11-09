import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BridgeLease } from '../ui/src/lib/bridge-lease.ts';

const LINK = { path: '/bridge/abc/', origin: 'http://localhost:3000' };

function lease() {
  const revoked: string[] = [];
  return { revoked, lease: new BridgeLease(async (path) => { revoked.push(path); }) };
}

test('an open preview keeps its link and revokes it once when it ends', () => {
  const { revoked, lease: held } = lease();
  assert.deepEqual(held.accept(LINK), LINK);
  assert.deepEqual(revoked, []);
  held.end();
  held.end();
  assert.deepEqual(revoked, [LINK.path]);
});

test('a link that arrives after the preview closed is revoked at once and never shown', () => {
  const { revoked, lease: held } = lease();
  held.end(); // Escape or navigation while the mint request is still pending
  assert.equal(held.accept(LINK), undefined);
  assert.deepEqual(revoked, [LINK.path]);
});

test('ending a preview that never got a link revokes nothing', () => {
  const { revoked, lease: held } = lease();
  held.end();
  assert.deepEqual(revoked, []);
});

test('a failing revoke does not surface as an unhandled rejection', async () => {
  const held = new BridgeLease(async () => { throw new Error('offline'); });
  held.accept(LINK);
  held.end();
  await new Promise((resolve) => setImmediate(resolve));
});
