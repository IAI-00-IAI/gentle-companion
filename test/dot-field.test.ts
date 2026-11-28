import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * The dot field must not rebuild while the container is still moving.
 *
 * A rebuild assigns `canvas.width/height`, and the canvas lives inside the
 * watched host — so rebuilding during the sidebar's 220ms slide fed the
 * ResizeObserver on every frame. On a 2K screen each of those rebuilds costs
 * ~5.3M operations (95k cells x boxBlur passes), which is where the 500ms+
 * rAF stalls came from.
 *
 * Ricardo chose the option with no visual change: freeze the background while
 * the panel animates. Density reduction is deferred until he can judge the
 * grain on the monitor he actually uses.
 */

const source = readFileSync(
  new URL('../ui/src/lib/DotField.svelte', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../ui/src/routes/+layout.svelte', import.meta.url),
  'utf8',
);

test('the rebuild waits longer than the sidebar transition', () => {
  const settle = source.match(/REBUILD_SETTLE_MS\s*=\s*(\d+)/);
  assert.ok(settle, 'no named settle constant: a magic number will drift');

  // The transition duration lives in the layout; read it rather than restating it.
  const slide = layout.match(/transition:\s*grid-template-columns\s+(\d+)ms/);
  assert.ok(slide, 'sidebar transition duration not found');

  assert.ok(
    Number(settle[1]) > Number(slide[1]),
    `settle (${settle[1]}ms) must exceed the sidebar transition (${slide[1]}ms), ` +
      'or a rebuild lands mid-slide and the observer fires again',
  );
});

test('queueRebuild is debounced, not immediate', () => {
  // If this regresses to a bare requestAnimationFrame, every frame of the
  // animation pays for a full grid reconstruction again.
  assert.match(source, /const queueRebuild = \(\) => \{[\s\S]{0,400}setTimeout\(/, 'queueRebuild is not debounced');
  assert.match(source, /clearTimeout\(rebuildTimer\)/, 'pending rebuild is not cancelled on a new size');
});

test('the rebuild still happens eventually', () => {
  // A debounce that never fires leaves the background blank at its old size.
  const flush = source.match(/const flushRebuild = \(\) => \{[\s\S]{0,400}\};/);
  assert.ok(flush, 'no way to force the pending rebuild');
  assert.match(flush[0], /requestAnimationFrame\(rebuild\)/, 'flush does not rebuild');
  assert.ok(
    /flushRebuild\(\)/.test(source.replace(/const flushRebuild[\s\S]{0,400}?;/, '')),
    'flushRebuild is defined but never called',
  );
});
