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

// The sequence a revocation actually produces: forget() clears the token and sets the
// connection to 'revoked' in the same tick the layout navigates to /pair. The page must end
// up showing the form, because the device holds no credential — the state it arrives with
// is the only input it gets.
test('the state a revocation hands to the page shows the form', () => {
  // Exactly what forget() leaves behind.
  const afterForget = { hasToken: false, connection: 'revoked', invite: false };
  assert.equal(showsPairingForm(afterForget), true, 'the form must be reachable');
  assert.equal(showsRevokedNotice(afterForget), true, 'and explained');
});

test('a device that only lost its connection keeps the app, not the form', () => {
  // This is the case the rule must NOT break: offline is not unpaired.
  assert.equal(showsPairingForm({ hasToken: true, connection: 'offline', invite: false }), false);
  assert.equal(showsRevokedNotice({ hasToken: true, connection: 'offline', invite: false }), false);
});
