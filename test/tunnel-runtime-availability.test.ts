import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const RUNTIME = new URL('../ui/src/lib/tailcat-runtime.ts', import.meta.url);
const BOOT = new URL('../ui/src/lib/companion.svelte.ts', import.meta.url);

const runtimeSource = readFileSync(RUNTIME, 'utf8');
const bootSource = readFileSync(BOOT, 'utf8');

/**
 * The tunnel needs the vendored runtime (wasm_exec.js + main.wasm) to dial. A phone
 * whose default network is mobile data fails the direct probe, so it can never warm
 * the runtime cache — and then the tunnel cannot load it either. That is a closed
 * circle: the tunnel is unusable off-LAN unless the phone once paired on the LAN.
 */

test('the runtime cache is warmed whenever the tunnel is configured, not only on LAN', () => {
  // The warming call must not be gated behind `directUsable` alone: a phone on mobile
  // data has directUsable === false and still needs the runtime for the tunnel.
  const warmingLine = bootSource
    .split('\n')
    .find((line) => line.includes('warmRuntimeCache()') && line.includes('void'));

  assert.ok(warmingLine, 'boot must warm the runtime cache');
  assert.ok(
    !/if\s*\(\s*this\.directUsable\s*\)\s*void\s+warmRuntimeCache/.test(warmingLine),
    `warming must not be gated on the direct probe alone; found: ${warmingLine.trim()}`
  );
});

test('a missing runtime with no cached copy names the LAN requirement', () => {
  // The raw error leaked an internal asset path and blamed the daemon or an old
  // version, neither of which is actionable for a user off-LAN on mobile data.
  const notAvailable = runtimeSource.includes('The tunnel runtime is not available on this device yet');
  const namesLan = /same local network|local network|LAN/i.test(runtimeSource);

  assert.ok(notAvailable, 'the failure must say the runtime is not available on this device');
  assert.ok(namesLan, 'the failure must name the local-network requirement');
  assert.ok(
    !runtimeSource.includes('The daemon may be unreachable or an old version'),
    'the old non-actionable message must be gone'
  );
});

test('the warming helper tolerates a failed download', () => {
  // Warming is best-effort: a phone already off-LAN must not crash on boot.
  const warmBlock = runtimeSource.slice(runtimeSource.indexOf('export async function warmRuntimeCache'));
  assert.ok(warmBlock.length > 0, 'warmRuntimeCache exists');
  assert.ok(/catch/.test(warmBlock), 'warming must swallow fetch and cache errors');
});

test('runtime assets stay the two vendored files', () => {
  assert.match(runtimeSource, /RUNTIME_ASSETS\s*=\s*\[[^\]]*wasm_exec\.js[^\]]*main\.wasm[^\]]*\]/s);
});
