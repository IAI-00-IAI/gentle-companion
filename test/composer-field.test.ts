// Ricardo: "ahora no se distingue el cuadro de entrada y el cursor solo se hace
// visible al pulsar, por lo menos que se vea el cuadro y el cursor parpadee al
// tener foco".
//
// Measured cause, not a guess. The composer PANEL was fine. The TEXT FIELD was
// `background: transparent`, so it and the white panel were one continuous
// shape: 1.00:1 field-against-panel in both themes. There was no box to see and
// nothing to mark where the caret would appear, which is why it felt like the
// cursor only existed after clicking.
//
// The fix gives the field its own surface (`--field-bg`), chosen by Ricardo
// from captured variants as "C y C": rose in light, near-black in dark.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sessionPage = readFileSync(
	new URL('../ui/src/routes/sessions/[id]/+page.svelte', import.meta.url),
	'utf8'
);
const appCss = readFileSync(new URL('../ui/src/app.css', import.meta.url), 'utf8');

test('the message field is not transparent, so it reads as a box at rest', () => {
	// The textarea rule inside .prompt-row.
	const rule = sessionPage.match(/\.prompt-row textarea \{[^}]*\}/);
	assert.ok(rule, '.prompt-row textarea rule must exist');
	assert.doesNotMatch(
		rule[0],
		/background:\s*transparent/,
		'the field must not be transparent: against the panel it becomes invisible, which is exactly the reported defect'
	);
	assert.match(
		rule[0],
		/background:\s*var\(--field-bg\)/,
		'the field must take its own surface token so it is distinguishable from the composer panel'
	);
});

test('the field surface is defined for both themes', () => {
	// One declaration under :root/[data-theme='dark'] and one under light.
	// A token defined in only one theme leaves the other rendering transparent.
	const decls = appCss.match(/--field-bg:\s*#[0-9a-fA-F]{3,8}/g) ?? [];
	assert.equal(
		decls.length,
		2,
		'--field-bg needs a value in both the dark and the light theme, or one theme falls back to nothing'
	);
	const darkBlock = appCss.slice(0, appCss.indexOf("[data-theme='light']"));
	const lightBlock = appCss.slice(appCss.indexOf("[data-theme='light']"));
	assert.match(darkBlock, /--field-bg:\s*#000000/, 'dark field is near-black, so there is a well to type into');
	assert.match(lightBlock, /--field-bg:\s*#f2dbe9/, 'light field is the rose Ricardo chose, not white on white');
});

test('the caret colour is never made transparent', () => {
	// The second half of Ricardo's report: "el cursor solo se hace visible al
	// pulsar". A hidden caret would be a separate, worse defect.
	const caret = sessionPage.match(/caret-color:\s*[^;]+;/);
	assert.ok(caret, 'the composer must declare a caret colour');
	assert.doesNotMatch(caret[0], /transparent/, 'a transparent caret would hide the text cursor entirely');
});

test('every composer custom property is actually defined', () => {
	// Caught a real regression: the panel was left pointing at `--composer-bg`
	// after that token was removed, so the panel rendered BLACK in both themes.
	// An undefined var() in `background` is not an error the compiler reports -
	// it silently becomes the initial value, which for background is transparent
	// and here painted over a dark ancestor.
	// The layout rule, not the first `.composer {` (which only carries the
	// --term-* custom properties). Anchor on its first declaration.
	const start = sessionPage.search(/\.composer \{\s*\n\s*flex: none;/);
	assert.ok(start > -1, 'the composer layout rule must exist');
	const composerBlock = sessionPage.slice(start, sessionPage.indexOf('.composer:focus-within', start));
	const used = [...composerBlock.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]);
	// Every token the composer references, not just the ones this change
	// introduced: the regression was a token this file never defined.
	// A token satisfies the check if it is declared either in app.css or
	// locally in this component (`--term-*` are set on `.composer` itself).
	for (const name of [...new Set(used)]) {
		const inAppCss = new RegExp(`${name}:\\s*[^;]+;`).test(appCss);
		const inComponent = new RegExp(`${name}:\\s*[^;]+;`).test(sessionPage);
		assert.ok(
			inAppCss || inComponent,
			`${name} is used by the composer but defined in neither app.css nor this component, so it resolves to nothing`
		);
	}
});
