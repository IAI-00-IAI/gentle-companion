import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'svelte/compiler';

/**
 * Guard for the bug that 500'd the app.
 *
 * `AskSheet.svelte` shipped `{#if !instant}` after `instant` had been removed.
 * Everything that normally catches mistakes passed:
 *
 *   - the Svelte compiler accepted it (it emits valid JS)
 *   - `svelte-check` reported 0 errors — verified by reintroducing the bug
 *   - `npm run ui:build` succeeded
 *
 * The reference only threw when that branch rendered, and SvelteKit turned the
 * exception into an HTTP 500 whose message blamed the workspace server. The real
 * cause was in the client the whole time.
 *
 * HOW THIS CATCHES IT
 * Compile each component and look at the emitted JavaScript. Svelte inlines a
 * template guard as a plain `if (!name)` / `name(...)` expression, so a name that
 * exists in the output but has no `let`/`const`/`var`/parameter binding anywhere
 * in that output is a dangling reference. That is a property of the compiled
 * result, not of Svelte's source syntax, so it does not depend on guessing how
 * props, runes, `{@const}`, snippet params or destructured `{#each}` bindings are
 * written — all of those are resolved by the compiler before we look.
 *
 * Why not render instead: Svelte 5's `mount()` needs a DOM, and neither jsdom nor
 * happy-dom is installed. Rendering is the ideal guard; this is the closest one
 * that runs with what the repo has.
 */

const UI_SRC = new URL('../ui/src/', import.meta.url).pathname;

function components(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...components(full));
    else if (entry.endsWith('.svelte')) out.push(full);
  }
  return out;
}

/** Bindings the compiler considers declared in the emitted module. */
function declaredNames(js: string): Set<string> {
  const names = new Set<string>();
  for (const m of js.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of js.matchAll(/\b(?:let|const|var)\s*[[{]([^\]}]*)[\]}]/g)) {
    m[1].split(',').forEach((part: string) => {
      const name = part.split(/[:=]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    });
  }
  for (const m of js.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
    m[1].split(',').forEach((part: string) => {
      const name = part.split(/[:=]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    });
  }
  for (const m of js.matchAll(/\(([^)]*)\)\s*=>/g)) {
    m[1].split(',').forEach((part: string) => {
      const name = part.split(/[:=]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    });
  }
  for (const m of js.matchAll(/import\s+\{([^}]*)\}/g)) {
    m[1].split(',').forEach((part: string) => {
      const name = (part.split(/\bas\b/).pop() ?? '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    });
  }
  for (const m of js.matchAll(/import\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of js.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*\s*=\s*\{/g)) names.add(m[1]);
  return names;
}

test('no component references a name that is never declared', () => {
  const failures = [];

  for (const file of components(UI_SRC)) {
    let js;
    try {
      js = compile(readFileSync(file, 'utf8'), { generate: 'client', dev: false }).js.code;
    } catch {
      // A component that does not compile is a different failure with its own
      // report; this test is only about references surviving into valid output.
      continue;
    }

    const declared = declaredNames(js);
    // Template guards and simple conditionals the compiler inlines verbatim.
    const used = new Set<string>();
    for (const m of js.matchAll(/\bif\s*\(\s*!\s*([A-Za-z_$][\w$]*)\s*\)/g)) used.add(m[1]);
    for (const m of js.matchAll(/\bif\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) used.add(m[1]);

    const builtins = new Set<string>([
      'window', 'document', 'console', 'Math', 'JSON', 'Object', 'Array',
      'String', 'Number', 'Boolean', 'Date', 'Promise', 'Set', 'Map',
      'RegExp', 'Error', 'undefined', 'null', 'true', 'false', 'globalThis',
      'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
      'fetch', 'localStorage', 'matchMedia', 'performance', 'navigator',
      'location', 'setInterval', 'clearInterval', 'structuredClone', 'Intl', 'URL',
    ]);

    const orphans = [...used].filter((n) => !declared.has(n) && !builtins.has(n));
    if (orphans.length) {
      failures.push(`${file.slice(UI_SRC.length)}: ${orphans.join(', ')}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    'A name is used in a template but never declared, so the branch throws at ' +
      `render time and SvelteKit reports it as a server error:\n  ${failures.join('\n  ')}`,
  );
});
