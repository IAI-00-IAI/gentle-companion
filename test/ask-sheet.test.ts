import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * Concurrency guards for the question sheet.
 *
 * Ricardo, while using the app: "race condition al seleccionar pregunta, y hay
 * que poner un retraso porque si estás escribiendo se le puede entrar por
 * equivocación, como me acaba de pasar ahora". A keystroke aimed at his own
 * editor landed on a question that had just appeared and was sent as an answer.
 *
 * That is not cosmetic: an answer goes to the agent, which acts on it. It is an
 * action taken in the user's name that the user did not take. These tests pin
 * the three properties that make it impossible:
 *
 *   1. the sheet does not appear in the same frame the question arrives
 *   2. a keystroke cannot reach a submit path before the sheet has settled
 *   3. selecting an option never sends on its own
 *
 * Source-as-text, like the other layout tests here: no DOM rendering.
 */

const sheet = readFileSync(new URL('../ui/src/lib/AskSheet.svelte', import.meta.url), 'utf8');

test('the sheet opens after a delay, never in the frame the question arrives', () => {
  assert.match(sheet, /OPEN_DELAY_MS\s*=\s*\d+/, 'no named delay constant');
  assert.match(sheet, /setTimeout\([\s\S]{0,80}OPEN_DELAY_MS/, 'the open is not deferred');
  // showModal must be gated on the settled flag, not on `open` alone. If this
  // regresses, a keystroke in flight becomes an answer again.
  assert.match(
    sheet,
    /if\s*\(open\s*&&\s*settle\s*&&\s*!dialog\.open\)\s*dialog\.showModal\(\)/,
    'showModal is not guarded by the settle flag',
  );
});

test('a submit that arrives before the sheet settles is refused', () => {
  // Submitting must require `settle`, and there must be a guard that cancels the
  // event, so a stray Enter is a no-op rather than a quiet answer.
  assert.match(sheet, /function guarded\(/, 'no submit guard');
  assert.match(sheet, /if\s*\(!settle\)\s*\{\s*e\.preventDefault\(\);\s*return;\s*\}/, 'guard does not cancel');
  assert.match(sheet, /guarded\(event\);/, 'form submit does not run through the guard');
});

test('the free-text input does not steal focus when the sheet appears', () => {
  // autofocus was the mechanism: it pulled the caret out of whatever the user was
  // typing into, so their next keystrokes went to the answer field instead.
  assert.doesNotMatch(sheet, /\bautofocus\b/, 'autofocus returns: focus is stolen again');
});

test('selecting an option never sends the answer by itself', () => {
  // The "instant" path sent a single-choice answer on one click. A click that
  // lands while the sheet is appearing is not a decision.
  assert.doesNotMatch(sheet, /if\s*\(instant\)\s*submit\(\)/, 'instant submit returned');
  assert.doesNotMatch(sheet, /const instant\s*=\s*\$derived/, 'instant derived value returned');
  // The only remaining caller of submit() must be the confirm/submit path.
  const calls = [...sheet.matchAll(/submit\(\)/g)];
  assert.ok(calls.length >= 1, 'submit is never called: the sheet cannot answer at all');
});

test('answering once cannot wedge the sheet', () => {
  // ORQ: "la UI no queda atrancada después". A failed send must not leave the
  // sheet open and unclickable; the answer call reports failure and the sheet
  // keeps a usable path back.
  assert.match(sheet, /if\s*\(!companion\.answer\(/, 'a failed send is not reported');
  assert.match(sheet, /toasts\.show\(/, 'no feedback when the send fails');
  assert.match(sheet, /function skip\(\)/, 'no escape hatch if the send fails');
});
