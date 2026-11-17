/**
 * Client-side diagnostic log (feature tailcat-client debugging aid).
 *
 * A bounded ring buffer of tagged boot/connection events, exposed as
 * `__companionDiag` for support and wired to a "Copy diagnostics" action in the
 * connection-error notice. Console.debug keeps the events visible in devtools;
 * the buffer keeps them retrievable on devices without devtools (a phone).
 */

export type DiagEntry = { at: number; tag: string; message: string };

const CAP = 200;
const entries: DiagEntry[] = [];
let seq = 0;

/** Records one diagnostic event; never throws. */
export function diag(tag: string, message: string): void {
  try {
    entries.push({ at: Date.now(), tag, message });
    if (entries.length > CAP) entries.splice(0, entries.length - CAP);
    console.debug(`[companion:${tag}] ${message}`);
  } catch { /* logging must never break the app */ }
}

/** Serializes the buffer oldest-first, one line per event. */
export function diagDump(): string {
  return entries
    .map((e) => `${new Date(e.at).toISOString()} [${e.tag}] ${e.message}`)
    .join('\n');
}

/** Test hook: clears the buffer. */
export function diagReset(): void {
  entries.length = 0;
  seq = 0;
}

/** Monotonic id for correlating retries in the dump. */
export function diagSeq(): number {
  return ++seq;
}

const global = globalThis as typeof globalThis & { __companionDiag?: { log: typeof diag; dump: typeof diagDump; reset: typeof diagReset } };
global.__companionDiag = { log: diag, dump: diagDump, reset: diagReset };
