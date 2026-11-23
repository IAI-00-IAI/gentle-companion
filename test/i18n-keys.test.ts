import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { t } from '../ui/src/lib/i18n.svelte.ts';

/**
 * Guards the invariant that made 38 missing keys invisible for so long.
 *
 * `t()` returns the key itself when it is absent from every catalog
 * (`ui/src/lib/i18n.svelte.ts:1849` — `if (message === undefined) return key;`).
 * That fallback is correct at runtime: showing `sessiontable.th.session` beats
 * showing nothing. What was missing is a guard that FAILS when a key the UI
 * references exists in no catalog at all. Without it every future missing key
 * renders as its own name and nobody notices.
 *
 * The assertion goes through `t()`, the public interface, on purpose: the
 * catalog is internal and asserting on it would test storage rather than
 * behaviour. A key that resolves to itself is precisely the symptom a user sees.
 */

const uiSrc = fileURLToPath(new URL('../ui/src/', import.meta.url));

/** Every `t('...')` / `t("...")` key literal used across the Svelte UI. */
function keysUsedInUi(): { key: string; files: string[] }[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(svelte|ts)$/.test(entry)) out.push(full);
    }
    return out;
  };

  const used = new Map<string, string[]>();
  for (const file of walk(uiSrc)) {
    const source = readFileSync(file, 'utf8');
    // Dynamic keys (`t('prefix.' + x)`) are out of scope deliberately: a static
    // check cannot resolve them, and guessing would manufacture false failures.
    for (const match of source.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g)) {
      const key = match[1];
      if (/\.$/.test(key)) continue;
      const list = used.get(key) ?? [];
      const rel = file.slice(uiSrc.length);
      if (!list.includes(rel)) list.push(rel);
      used.set(key, list);
    }
  }
  return [...used].map(([key, files]) => ({ key, files }));
}

test('the scan finds the UI keys it is meant to check', () => {
  const used = keysUsedInUi();
  // A silent scan failure would turn this whole suite into a green no-op.
  assert.ok(
    used.length > 100,
    `suspiciously few keys found (${used.length}); the scan is probably broken`,
  );
});

test('no key used in the UI resolves to itself (i.e. is missing from the catalog)', () => {
  const missing: { key: string; files: string[] }[] = [];
  for (const entry of keysUsedInUi()) {
    if (t(entry.key) === entry.key) missing.push(entry);
  }

  const detail = missing
    .map((m) => `${m.key}  <- ${m.files.slice(0, 2).join(', ')}`)
    .join('\n  ');

  assert.deepEqual(
    missing.map((m) => m.key),
    [],
    `t() renders a key as itself when it is absent from the catalog.\n` +
      `${missing.length} key(s) would appear literally in the UI:\n  ${detail}`,
  );
});

test('every key in the catalog still resolves (nobody emptied a value)', () => {
  // The symmetric guard. Presence-only checks do not catch loss: a catalog that
  // loses entries or blanks a value still "has keys", and everything above keeps
  // passing while the UI degrades. This walks the keys the UI actually uses and
  // asserts each one resolves to real text, not to itself and not to empty.
  const broken: string[] = [];
  for (const entry of keysUsedInUi()) {
    const value = t(entry.key);
    if (value === entry.key) broken.push(`${entry.key}: resolves to its own name`);
    else if (value.trim() === '') broken.push(`${entry.key}: resolves to empty text`);
  }
  assert.deepEqual(broken, [], `catalog entries are missing or blank:\n  ${broken.join('\n  ')}`);
});

test('the two locales define exactly the same keys', () => {
  // A key present in one locale and absent in the other is invisible to every
  // other check here: the UI asks for it, `t()` finds the fallback, and the
  // screen silently renders English inside a Spanish interface. The reverse —
  // a typo that only exists in one locale — is the same defect wearing a hat:
  // `running.empty.norrunning.body` (es) could never resolve, so that paragraph
  // stayed English forever, and nothing failed.
  //
  // Reads the source rather than the runtime export, because `messages` is not
  // exported and should not be exported just to satisfy a test.
  const source = readFileSync(new URL('../ui/src/lib/i18n.svelte.ts', import.meta.url), 'utf8');

  const blockFor = (lang: string): string => {
    const start = source.search(new RegExp(`^  ${lang}: \\{`, 'm'));
    assert.ok(start >= 0, `locale block "${lang}" not found`);
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(start, i);
      }
    }
    throw new Error(`locale block "${lang}" is not closed`);
  };

  // Both quote styles occur in this file; matching only one hides real keys.
  const keysIn = (lang: string): Set<string> => {
    const body = blockFor(lang);
    return new Set([...body.matchAll(/['"]([a-zA-Z0-9_.-]+)['"]\s*:/g)].map((m) => m[1]));
  };

  const en = keysIn('en');
  const es = keysIn('es');
  const onlyEn = [...en].filter((k) => !es.has(k)).sort();
  const onlyEs = [...es].filter((k) => !en.has(k)).sort();

  assert.deepEqual(
    { onlyEn, onlyEs },
    { onlyEn: [], onlyEs: [] },
    `locales are out of sync — only in en: ${onlyEn.join(', ') || 'none'}; ` +
      `only in es: ${onlyEs.join(', ') || 'none'}`,
  );
  assert.ok(en.size > 900, `only ${en.size} keys parsed; the parse is probably broken`);
});
