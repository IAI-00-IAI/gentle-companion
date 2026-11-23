import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setLang, t } from '../ui/src/lib/i18n.svelte.ts';

/**
 * Guards the same invariant as `i18n-keys.test.ts`, but for the text a screen
 * reader announces and a pointer user sees on hover: `aria-label`, `title` and
 * `placeholder`. Those attributes are easy to forget because they are invisible
 * in most screenshots, so hardcoded English survived the earlier text-node
 * passes while the rest of the screen was already translated.
 *
 * The assertion is on rendered text, not on the catalog: whatever `t()` returns
 * for the key an attribute uses is what the user hears. A literal attribute is
 * by definition untranslated, and a key that resolves to itself is a typo.
 */

const uiSrc = fileURLToPath(new URL('../ui/src/', import.meta.url));

/** Attributes whose value is read as prose. */
const PROSE_ATTRS = ['aria-label', 'title', 'placeholder'];

/**
 * Values that are not prose and must stay byte-identical in every locale:
 * an example bind address, and the shape of a pairing code.
 */
const NOT_PROSE = ['0.0.0.0:43722', 'XXXX-XXXX'];

/**
 * ODD point 17 is blocked pending a decision: `Pi` may be a live extension name
 * rather than the old product name, so these stay English on purpose. When that
 * decision lands, delete this list and the guard starts covering them.
 */
const BLOCKED_POINT_17 = [
  'Send a normal prompt; does not change Pi permissions',
  'Send into the turn Pi is working on instead of queueing a new prompt',
  'Started by an automation. You can answer Pi’s questions, but cannot steer, plan, or upload files.',
];

function uiFiles(): string[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (full.endsWith('.svelte')) out.push(full);
    }
    return out;
  };
  return walk(uiSrc);
}

type Literal = { attribute: string; value: string; file: string };

/** Hardcoded attribute values: `attr="text"`, no expression, no interpolation. */
function literalProseAttributes(): Literal[] {
  const pattern = new RegExp(`(${PROSE_ATTRS.join('|')})="([^"]+)"`, 'g');
  const found: Literal[] = [];
  for (const file of uiFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const value = match[2];
      if (value.includes('{')) continue; // bound to an expression, not a literal
      if (value.trim().length < 3) continue;
      found.push({ attribute: match[1], value, file: file.slice(uiSrc.length) });
    }
  }
  return found;
}

/** Every `t('...')` key rendered into one of those attributes. */
function keysInProseAttributes(): { key: string; file: string }[] {
  const attribute = new RegExp(`\\b(?:${PROSE_ATTRS.join('|')})=\\{([^}]*)\\}`, 'g');
  const found = new Map<string, string>();
  for (const file of uiFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(attribute)) {
      for (const key of match[1].matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g)) {
        const rel = file.slice(uiSrc.length);
        if (!found.has(key[1])) found.set(key[1], rel);
      }
    }
  }
  return [...found].map(([key, file]) => ({ key, file }));
}

test('no prose attribute is hardcoded English', () => {
  const untranslated = literalProseAttributes().filter(
    (item) => !NOT_PROSE.includes(item.value) && !BLOCKED_POINT_17.includes(item.value),
  );

  const detail = untranslated
    .map((item) => `${item.attribute}="${item.value}"  <- ${item.file}`)
    .join('\n  ');

  assert.deepEqual(
    [...new Set(untranslated.map((item) => item.value))],
    [],
    `${untranslated.length} hardcoded attribute value(s) never reach the catalog:\n  ${detail}`,
  );
});

test('the two non-prose attribute values are still literal', () => {
  // The inverse guard: these must NOT be translated, because a localised bind
  // address or code mask would break the copy-paste the field is for.
  const values = literalProseAttributes().map((item) => item.value);
  for (const value of NOT_PROSE) {
    assert.ok(values.includes(value), `${value} must stay a literal attribute value`);
  }
});

test('every key rendered into a prose attribute resolves in both locales', () => {
  const keys = keysInProseAttributes();
  assert.ok(keys.length > 20, `suspiciously few attribute keys found (${keys.length})`);

  const broken: string[] = [];
  try {
    for (const locale of ['en', 'es'] as const) {
      setLang(locale);
      for (const entry of keys) {
        const rendered = t(entry.key);
        if (rendered === entry.key) broken.push(`${locale} ${entry.key}: renders its own name`);
        else if (rendered.trim() === '') broken.push(`${locale} ${entry.key}: renders empty`);
      }
    }
  } finally {
    setLang('en');
  }

  assert.deepEqual(broken, [], `attribute keys are missing or blank:\n  ${broken.join('\n  ')}`);
});
