import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BridgeLease, RevocationQueue } from '../ui/src/lib/bridge-lease.ts';

const LINK = { path: '/bridge/abc/', origin: 'http://localhost:3000', leaseSeconds: 300 };
const offline = () => Object.assign(new Error('offline'), { status: 0 });
const gone = () => Object.assign(new Error('gone'), { status: 404 });

/** A timer the test advances by hand. */
function manualTimer() {
  const queue: { run: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    queue,
    timer: (run: () => void, ms: number) => {
      const entry = { run, ms, cancelled: false };
      queue.push(entry);
      return () => { entry.cancelled = true; };
    },
    fire() {
      const due = queue.splice(0).filter((entry) => !entry.cancelled);
      for (const entry of due) entry.run();
    },
    get waiting() { return queue.filter((entry) => !entry.cancelled).length; }
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup(options: { failRevoke?: () => Error | undefined; renew?: () => Promise<void> } = {}) {
  const clock = manualTimer();
  const revoked: string[] = [];
  const unconfirmed: number[] = [];
  let now = 0;
  const revocations = new RevocationQueue(async (_session, path) => {
    const failure = options.failRevoke?.();
    if (failure) throw failure;
    revoked.push(path);
  }, { timer: clock.timer, now: () => now, onUnconfirmed: () => unconfirmed.push(now) });
  const renewals: string[] = [];
  const lost: string[] = [];
  const lease = new BridgeLease({
    sessionId: () => 's1',
    revocations,
    renew: async (_session, path) => { renewals.push(path); await options.renew?.(); },
    onLost: () => lost.push('lost'),
    timer: clock.timer
  });
  return { clock, revoked, unconfirmed, revocations, renewals, lost, lease, advance: (ms: number) => { now += ms; } };
}

test('an open preview keeps its link and revokes it once when it ends', async () => {
  const { revoked, lease } = setup();
  assert.deepEqual(lease.accept(LINK), LINK);
  lease.end();
  lease.end();
  await settle();
  assert.deepEqual(revoked, [LINK.path]);
});

test('a link that arrives after the preview closed is revoked at once and never shown', async () => {
  const { revoked, lease } = setup();
  lease.end();
  assert.equal(lease.accept(LINK), undefined);
  await settle();
  assert.deepEqual(revoked, [LINK.path]);
});

test('ending a preview that never got a link revokes nothing', async () => {
  const { revoked, lease } = setup();
  lease.end();
  await settle();
  assert.deepEqual(revoked, []);
});

test('a failed revoke is kept, reported once, and retried until the daemon confirms', async () => {
  let failing = true;
  const { revoked, unconfirmed, revocations, clock, lease } = setup({ failRevoke: () => (failing ? offline() : undefined) });
  lease.accept(LINK);
  lease.end();
  await settle();
  assert.deepEqual(revoked, []);
  assert.equal(revocations.unconfirmed, 1, 'the shutdown is not confirmed');
  assert.equal(unconfirmed.length, 1, 'the user is told');

  clock.fire(); // retry while still offline
  await settle();
  assert.equal(revocations.unconfirmed, 1);
  assert.equal(unconfirmed.length, 1, 'only told once per link');

  failing = false;
  clock.fire(); // back online
  await settle();
  assert.deepEqual(revoked, [LINK.path]);
  assert.equal(revocations.unconfirmed, 0);
  assert.equal(clock.waiting, 0, 'nothing left to retry');
});

test('flush retries immediately, for example when the device comes back online', async () => {
  let failing = true;
  const { revoked, revocations, lease } = setup({ failRevoke: () => (failing ? offline() : undefined) });
  lease.accept(LINK);
  lease.end();
  await settle();
  failing = false;
  await revocations.flush();
  assert.deepEqual(revoked, [LINK.path]);
  assert.equal(revocations.unconfirmed, 0);
});

test('retrying stops when the daemon says the link is already gone, or its lease would have ended anyway', async () => {
  const definitive = setup({ failRevoke: () => gone() });
  definitive.lease.accept(LINK);
  definitive.lease.end();
  await settle();
  assert.equal(definitive.revocations.unconfirmed, 0, 'a 404 means there is nothing left to revoke');

  const stale = setup({ failRevoke: () => offline() });
  stale.lease.accept(LINK);
  stale.lease.end();
  await settle();
  stale.advance(7 * 60_000);
  await stale.revocations.flush();
  assert.equal(stale.revocations.unconfirmed, 0, 'after the 5 minute lease the daemon has dropped it');
});

test('an open preview renews its lease several times per lease period and stops when it ends', async () => {
  const { clock, renewals, lease } = setup();
  lease.accept(LINK);
  assert.equal(clock.queue[0]?.ms, 60_000, 'five renewals per 300 s lease');
  clock.fire();
  await settle();
  clock.fire();
  await settle();
  assert.equal(renewals.length, 2);
  lease.end();
  clock.fire();
  await settle();
  assert.equal(renewals.length, 2, 'no renewals once the preview has ended');
});

test('a transient renewal failure keeps the preview open; a definitive one reports the link lost', async () => {
  let failure: Error | undefined = offline();
  const { clock, lost, renewals, lease } = setup({ renew: async () => { if (failure) throw failure; } });
  lease.accept(LINK);
  clock.fire();
  await settle();
  assert.deepEqual(lost, [], 'a dropped connection is not the end of the link');
  assert.equal(clock.waiting, 1, 'it keeps trying');

  failure = gone();
  clock.fire();
  await settle();
  assert.deepEqual(lost, ['lost']);
  assert.equal(clock.waiting, 0);
  assert.equal(renewals.length, 2);
});
