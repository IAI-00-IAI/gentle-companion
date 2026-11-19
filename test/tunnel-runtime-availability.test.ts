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

test('the boot context request allows a cold tunnel start', () => {
  // A cold tunnel boot loads ~8 MB of runtime through the relay before /api/context can
  // even be sent. Pinning 10s (the LAN default) aborts the request mid-flight, the boot
  // fails, and the 1s retry restarts the whole runtime load — so it never completes.
  const contextCall = bootSource
    .split('\n')
    .find((line) => line.includes("'/api/context'") && line.includes('effectiveTransport'));

  assert.ok(contextCall, 'boot still probes /api/context over the effective transport');
  assert.ok(
    !/,\s*10_000\s*,/.test(contextCall),
    `the tunnel-capable boot probe must not pin the LAN timeout; found: ${contextCall.trim()}`
  );
});

test('the shell cache version is bumped so installed clients pick up new builds', () => {
  // The shell ('/') is served cache-first. Without a version bump an installed client
  // keeps the old HTML, which references chunk hashes the daemon no longer serves: the
  // app silently pins itself to a build that has been fixed several times over.
  const sw = readFileSync(new URL('../ui/static/service-worker.js', import.meta.url), 'utf8');
  const match = sw.match(/const CACHE = 'pi-companion-shell-v(\d+)'/);

  assert.ok(match, 'the cache name stays versioned');
  assert.ok(
    Number(match[1]) >= 8,
    `the shell cache must be v8 or later after the tunnel fixes, found v${match?.[1]}`
  );
});
