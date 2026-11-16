/**
 * Loader for the tailcat WASM client runtime (feature tailcat-client T2, spec S1/S2).
 *
 * In tunnel mode the UI needs the same `tailcatDial` capability the bridge page gets
 * from bridge/app.js. app.js itself is a DOM-coupled page script (it drives the
 * bridge page's own controls) and cannot be imported, so the UI loads the same
 * vendored runtime the daemon serves at /bridge/vendor/* (feature tailcat-client S4,
 * commit 5f9cf7f) and drives it exactly like app.js does: wasm_exec.js provides the
 * Go class, main.wasm registers the tailcatDial global, and onTailcatReady signals
 * completion.
 *
 * DERP map note (spec S2): bridge/app.js picks the DERP map URL in pickDERPMapURL,
 * which is not exported and not importable from a module page; tailcat-transport.ts
 * reuses the same policy (explicit ?derpmap= parameter, then a same-origin map, then
 * the canonical public map) because the only way to import the original would be a
 * bridge/app.js refactor outside this task's surfaces.
 *
 * The browser-dependent parts are injectable so ui/tests can cover the dialer logic
 * without a DOM or WebAssembly.
 */

/** The same canonical public DERP map bridge/app.js falls back to. */
export const CANONICAL_DERP_MAP_URL = 'https://tailcat.dev/derpmap.json';

export interface TailcatRuntimeHooks {
  /** Loads the runtime so that globalThis.tailcatDial exists. Defaults to the vendored WASM runtime. */
  load?: () => Promise<void>;
  /** Resolves the DERP map URL to hand to tailcatDial. Defaults to pickDerpMapURL(). */
  pickDerpMap?: () => Promise<string>;
  /** The tailcatDial global; defaults to globalThis.tailcatDial. */
  tailcatDial?: (options: { addr: string; derpMapURL: string; port: number; verbose: boolean }) => Promise<unknown>;
}

type TailcatDial = NonNullable<TailcatRuntimeHooks['tailcatDial']>;

interface TailcatGlobal {
  Go?: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
  tailcatDial?: TailcatDial;
  onTailcatReady?: unknown;
}

function tailcatGlobal(): TailcatGlobal {
  return globalThis as typeof globalThis & TailcatGlobal;
}

/** Injects a classic script tag and resolves when it has executed (or rejects). */
function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}. The daemon may be unreachable or an old version.`));
    document.head.append(script);
  });
}

let runtimePromise: Promise<void> | null = null;

/**
 * Loads the vendored tailcat runtime once; concurrent and repeat callers share the
 * same load. A failed load is retried on the next call (the daemon may come up later).
 */
export function loadTailcatRuntime(): Promise<void> {
  runtimePromise ??= loadVendoredRuntime().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

async function loadVendoredRuntime(): Promise<void> {
  const global = tailcatGlobal();
  if (typeof global.tailcatDial === 'function') return; // already loaded (e.g. the bridge page ran first)
  await injectScript('/bridge/vendor/wasm_exec.js');
  const Go = global.Go;
  if (typeof Go !== 'function') {
    throw new Error('The tailcat client runtime did not load correctly. Reload the page and retry.');
  }
  // main_js.go calls onTailcatReady at startup only when it is already a function,
  // so it must be installed before go.run() (the same pattern bridge/app.js uses).
  const ready = new Promise<void>((resolve) => { global.onTailcatReady = resolve; });
  const go = new Go();
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/bridge/vendor/main.wasm'), go.importObject);
  void go.run(instance);
  await ready;
}

/**
 * Resolves the DERP map URL to hand to tailcatDial: the ?derpmap= query parameter if
 * given, then a same-origin map (the daemon's serving-contract path /bridge/derpmap.json
 * first, then a page-relative derpmap.json for static mirrors of the bridge directory),
 * then the canonical public map.
 */
export async function pickDerpMapURL(options?: {
  params?: URLSearchParams;
  base?: string;
  probe?: (url: string) => Promise<{ ok: boolean }>;
}): Promise<string> {
  const params = options?.params ?? new URLSearchParams(location.search);
  const base = options?.base ?? location.href;
  const probe = options?.probe ?? ((url: string) => fetch(url, { method: 'HEAD' }));
  const explicit = params.get('derpmap');
  if (explicit) return new URL(explicit, base).toString();
  for (const relative of ['bridge/derpmap.json', 'derpmap.json']) {
    const candidate = new URL(relative, base).toString();
    try {
      if ((await probe(candidate)).ok) return candidate;
    } catch { /* fall through to the next candidate */ }
  }
  return CANONICAL_DERP_MAP_URL;
}
