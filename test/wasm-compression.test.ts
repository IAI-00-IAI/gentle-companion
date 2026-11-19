import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync } from 'node:fs';

const ASSETS = new URL('../server/src/assets.rs', import.meta.url);
const source = readFileSync(ASSETS, 'utf8');

const WASM = new URL('../bridge/vendor/main.wasm', import.meta.url);
const WASM_GZ = new URL('../bridge/vendor/main.wasm.gz', import.meta.url);

/**
 * The vendored Go runtime is ~34 MB raw. A precompressed copy already sits next to it,
 * so a client that accepts gzip can receive ~8 MB instead. Serving the raw bytes to
 * every client is the difference between a tunnel that starts and one that times out
 * on mobile data.
 */

test('the precompressed runtime is embedded, not excluded', () => {
  const vendorBlock = source.slice(source.indexOf('#[folder = "../bridge/vendor/"]'));
  const embedAttrs = vendorBlock.slice(0, vendorBlock.indexOf('struct'));

  assert.ok(
    embedAttrs.includes('main.wasm.gz'),
    'the .gz must be embedded so the daemon can serve it'
  );
});

test('a client that accepts gzip gets the compressed runtime', () => {
  assert.ok(
    /accept.?encoding/i.test(source),
    'the vendor handler must look at Accept-Encoding'
  );
  assert.ok(
    /content.?encoding["']?,\s*["']gzip|CONTENT_ENCODING/.test(source),
    'the response must be labelled as gzip when it is compressed'
  );
});

test('the compressed copy is actually smaller than the raw binary', () => {
  const raw = statSync(WASM).size;
  const gz = statSync(WASM_GZ).size;

  assert.ok(raw > 30_000_000, `raw wasm should be ~34 MB, got ${raw}`);
  assert.ok(gz < raw / 3, `the .gz should be under a third of the raw size (${gz} vs ${raw})`);
});
