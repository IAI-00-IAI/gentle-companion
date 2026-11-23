import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * Message queue — step 1: one held message, recalled with Alt+ArrowLeft.
 *
 * Ricardo: "Yo pensaba como en la TUI, que si se escribe mientras respondéis se
 * queda en cola y si pulsas Alt+flecha lo recuperas y vuelve al cuadro de texto,
 * donde lo puedes reeditar, borrar… como si no lo hubieras enviado."
 *
 * This behaviour did not exist. The product said so itself:
 * `shell.connection.error.note: 'Messages are not queued or sent while
 * disconnected.'` So this is new functionality, not a repair, and its risk is
 * the same one that made point 28 a bug: two actors on one moment.
 *
 * The properties that must hold, in Ricardo's words:
 *   - a message typed while the agent answers is HELD, not lost
 *   - Alt+ArrowLeft returns it to the composer, editable, "as if never sent"
 *   - it cannot be delivered twice, and cannot be silently dropped
 */

const page = readFileSync(
  new URL('../ui/src/routes/sessions/[id]/+page.svelte', import.meta.url),
  'utf8',
);

test('a message typed while the agent is busy is held, not sent', () => {
  // The hold must happen before the send path, and must clear the composer so
  // the text does not look unsent while a copy also sits in the queue.
  assert.match(page, /let queued = \$state<\{ text: string \} \| null>\(null\)/, 'no single-slot queue');
  assert.match(page, /const agentBusy = \$derived\(/, 'no busy predicate');
  assert.match(
    page,
    /if \(agentBusy\) \{\s*queued = \{ text \};/,
    'a busy agent does not hold the message',
  );
});

test('a second message cannot silently overwrite a held one', () => {
  // One slot means the second message must be refused with feedback. Silently
  // replacing would destroy text the user still believes is queued.
  assert.match(
    page,
    /if \(agentBusy && queued\) \{\s*toasts\.show\(t\('session\.detail\.queue\.full'\)/,
    'a full queue does not refuse the second message',
  );
});

test('Alt+ArrowLeft returns the held message to the composer', () => {
  assert.match(page, /function recallQueued\(/, 'no recall path');
  assert.match(page, /event\.altKey[\s\S]{0,30}ArrowLeft/, 'wrong gesture');
  assert.match(page, /prompt = queued\.text;\s*queued = null;/, 'recall does not restore and clear');
  // It must work from the window too: a user who clicked the activity list is
  // still looking at a queued message and expects the shortcut.
  assert.match(page, /<svelte:window onkeydown=\{[^}]*recallQueued\(event\)/, 'shortcut only works inside the textarea');
});

test('the held message is sent once the turn ends, and only once', () => {
  // Clearing before sending is what makes double-delivery impossible: if the
  // send throws, the text is restored rather than left in both places.
  const effect = page.match(/let wasBusy = false;[\s\S]{0,700}?\n  \}\);/);
  assert.ok(effect, 'no transition effect for the busy -> idle edge');
  assert.match(effect[0], /if \(wasBusy && !busy && queued\)/, 'fires on the wrong edge');
  assert.match(effect[0], /const text = queued\.text;\s*queued = null;/, 'clears after sending: double-send risk');
  assert.match(effect[0], /if \(!companion\.prompt\(id, text, false\)\) \{\s*queued = \{ text \};/, 'a failed send loses the text');
});

test('a held message is visible, so it cannot become a silent trash can', () => {
  assert.match(page, /class="composer-notice queued-note"/, 'no visible indicator');
  assert.match(page, /session\.detail\.queue\.held/, 'the indicator does not show the text');
  // Discard must be an explicit action, not a side effect of anything else.
  assert.match(page, /session\.detail\.queue\.drop/, 'no explicit discard');
});
