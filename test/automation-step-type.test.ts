import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAutomationStep } from '../ui/src/lib/automations.ts';

// The editor writes `gentle-shell` and its error message promises that value, so the
// validator must accept exactly what the editor produces. It previously accepted only
// `pi`, which made an automation authored in the UI fail with a message naming the very
// value it rejected.

test('the editor validator accepts the action type it writes', () => {
  assert.doesNotThrow(() =>
    validateAutomationStep({ type: 'gentle-shell', prompt: 'summarize', cwd: '/tmp' })
  );
});

test('a command step still validates', () => {
  assert.doesNotThrow(() => validateAutomationStep({ type: 'command', command: 'echo', args: [] }));
});

test('the legacy pi type still loads so saved automations keep working', () => {
  assert.doesNotThrow(() =>
    validateAutomationStep({ type: 'pi', prompt: 'summarize', cwd: '/tmp' })
  );
});

test('the gentle-shell step still requires an absolute workdir', () => {
  assert.throws(() => validateAutomationStep({ type: 'gentle-shell', prompt: 'x', cwd: 'relative' }));
  assert.throws(() => validateAutomationStep({ type: 'gentle-shell', prompt: 'x' }));
});

test('an unknown type is still rejected', () => {
  assert.throws(() => validateAutomationStep({ type: 'nope', prompt: 'x', cwd: '/tmp' }), /type must be/);
});
