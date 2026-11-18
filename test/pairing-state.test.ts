import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showsPairingForm, showsRevokedNotice } from '../ui/src/lib/pairing-state.ts';

const revoked = { hasToken: false, connection: 'revoked', invite: false };

test('a revoked device can pair again: the form is shown, not hidden', () => {
  assert.equal(showsPairingForm(revoked), true);
});

test('the revoked explainer is shown alongside the form', () => {
  assert.equal(showsRevokedNotice(revoked), true);
});

test('a paired device is not shown the pairing form', () => {
  assert.equal(showsPairingForm({ ...revoked, hasToken: true, connection: 'online' }), false);
});

test('an offline but still-paired device keeps its app instead of a pairing form', () => {
  // A dropped connection must not look like a lost credential; re-pairing would be wrong.
  assert.equal(showsPairingForm({ hasToken: true, connection: 'offline', invite: false }), false);
});

test('an invite always shows the pairing form', () => {
  assert.equal(showsPairingForm({ hasToken: true, connection: 'online', invite: true }), true);
});

test('the revoked explainer is not shown when an invite is present', () => {
  assert.equal(showsRevokedNotice({ hasToken: false, connection: 'revoked', invite: true }), false);
});
