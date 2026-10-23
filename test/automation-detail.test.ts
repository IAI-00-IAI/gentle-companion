import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { automationTriggerState } from '../ui/src/lib/automations.ts';

for (const scenario of [
  { schedule: null, enabled: true, label: 'Manual only', description: /No scheduled trigger is configured/ },
  { schedule: null, enabled: false, label: 'Manual only', description: /Choose Run now/ },
  { schedule: '0 9 * * *', enabled: true, label: 'Schedule active', description: /host daemon is online.*Missed triggers are not replayed/ },
  { schedule: '0 9 * * *', enabled: false, label: 'Schedule paused', description: /Run now is still available.*does not stop an active run/ }
]) {
  test(`automation trigger state: ${scenario.label}, enabled=${scenario.enabled}`, () => {
    const state = automationTriggerState(scenario);
    assert.equal(state.label, scenario.label);
    assert.match(state.description, scenario.description);
    assert.doesNotMatch(state.description, /Ready to run|automation is disabled/i);
  });
}

test('detail copy distinguishes execution outcomes, host permissions and editing access', () => {
  const page = readFileSync(new URL('../ui/src/routes/automations/[id]/+page.svelte', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /Three phases to a finished routine|capture output, a summary|Enable automation|Disable scheduling/);
  assert.match(page, /Only a failed main action is retried/);
  assert.match(page, /retried action may repeat side effects/);
  assert.match(page, /Run after success, failure or a failed precondition/);
  assert.match(page, /not sandboxed/);
  assert.match(page, /Paired devices can start and stop runs/);
  assert.match(page, /desktop-width window/);
});
