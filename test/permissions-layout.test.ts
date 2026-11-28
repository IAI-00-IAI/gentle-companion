// Ricardo, on the Notifications/Settings panel: "el texto está descuadrado y en
// el checkbox aparece sombra arriba y abajo".
//
// Two separate faults, both measured in a real browser, neither one a shadow:
//
// 1. THE CHECKBOX WAS A RECTANGLE, NOT A SQUARE.
//    `width: 18px; height: 18px` was declared, but the box is a flex child and
//    `width` alone does not stop flex-shrink. Measured: 13x18. The extra height
//    around a squeezed box is what reads as a shadow above and below.
//    Its background was also `rgb(247,243,245)` - the LIGHT surface - because the
//    global input rule paints it, so in the dark theme the box drew a pale block.
//
// 2. THE ACTIONS COLUMN COLLAPSED TO ZERO.
//    `grid-template-columns: auto minmax(0,1fr) auto` resolved to
//    `36px 708px 0px` at 1440px: a wrapping flex container reports a near-zero
//    min-content width, so the trailing `auto` became 0 and the buttons
//    overflowed onto the copy. That is the skewed text.
//
// Both are pinned here as source assertions, because neither is reachable from a
// unit test without a browser, and a regression in either is invisible in code
// review - it only shows up as a pixel measurement.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../ui/src/routes/settings/+page.svelte', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../ui/src/lib/DevicePermissions.svelte', import.meta.url), 'utf8');

test('the settings checkbox cannot be squeezed by its flex parent', () => {
	const rule = settings.match(/\.check-field input \{[^}]*\}/);
	assert.ok(rule, '.check-field input rule must exist');
	assert.match(
		rule[0],
		/flex:\s*none/,
		'without `flex: none` the 18px width is only a preference: the box is a flex child and shrinks to 13px, which reads as a shadow above and below'
	);
	assert.match(rule[0], /background:\s*transparent/, 'the global input background is the light surface and paints a pale block in the dark theme');
	assert.match(rule[0], /width:\s*18px/);
	assert.match(rule[0], /height:\s*18px/);
});

test('the permissions row reserves real width for its action buttons', () => {
	const rule = permissions.match(/\.permissions li \{[^}]*\}/);
	assert.ok(rule, '.permissions li rule must exist');
	assert.doesNotMatch(
		rule[0],
		/grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/,
		'a trailing `auto` resolves to 0px here (measured 36px 708px 0px), so the buttons overflow onto the copy - that is the skewed text'
	);
	assert.match(
		rule[0],
		/grid-template-columns:\s*auto minmax\(0,\s*1fr\) min-content/,
		'the actions column must be min-content so the buttons keep their real width and the copy wraps instead'
	);
});

test('the permission row aligns from the top so tall rows do not stretch the icon', () => {
	const rule = permissions.match(/\.permissions li \{[^}]*\}/);
	assert.ok(rule);
	assert.match(
		rule[0],
		/align-items:\s*start/,
		'baseline alignment against a tall action row pushed the icon and copy apart'
	);
});
