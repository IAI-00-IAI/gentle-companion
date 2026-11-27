// Ricardo, canvas 01-overview: "el ancho del borde tiene que estar todos
// alineados... calcular el borde sin ese mensaje".
//
// Measured in a real browser at 1440px wide, on all six pages:
//
//   main.content   L=244  R=1280   (1036px box, 21px scrollbar inside)
//   .page          L=244  R=1259   (1015px, centred with margin: 0 auto)
//
// `.page` is centred with `margin: 0 auto`, so it centres on the SCROLLABLE
// area, not on the box. Every page scrolls, so every page has its right border
// 21px further in than its left one. A page short enough not to scroll would
// look aligned, which is why the defect looked like it came and went.
//
// The fix reserves the gutter always, so the centring box no longer depends on
// whether the content happens to overflow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = readFileSync(new URL('../ui/src/routes/+layout.svelte', import.meta.url), 'utf8');

test('the scroll container reserves its gutter so centred pages cannot shift', () => {
	// Find the `.content` rule block: the scrolling element that wraps `.page`.
	const block = layout.match(/\.content\s*\{[^}]*\}/);
	assert.ok(block, '.content rule must exist in the layout');
	assert.match(
		block[0],
		/scrollbar-gutter:\s*stable(\s+both-edges)?/,
		'.content must reserve its scrollbar gutter: without it, `margin: 0 auto` on .page centres on the scrollable width and the right border sits one scrollbar inside the left'
	);
	// `both-edges` is the part that makes the column symmetric: with the gutter
	// reserved on one side only, `.page` hugged the left edge and left a
	// scrollbar's worth of dead space on the right (measured: 244..1259 vs
	// main's 244..1280).
	assert.match(
		block[0],
		/scrollbar-gutter:\s*stable\s+both-edges/,
		'.content must reserve the gutter on both edges, or the centred page hugs the left and the right border stays a scrollbar short'
	);
});

test('the page column stays centred without depending on scroll length', () => {
	const pageRule = readFileSync(new URL('../ui/src/app.css', import.meta.url), 'utf8').match(
		/^\.page\s*\{[^}]*\}/m
	);
	assert.ok(pageRule, '.page rule must exist');
	// The invariant that broke: centring. If this changes, the gutter test above
	// stops being the thing that protects alignment.
	assert.match(pageRule[0], /margin:\s*0 auto/);
});
