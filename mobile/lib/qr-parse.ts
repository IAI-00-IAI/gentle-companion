/**
 * Pairing-QR parsing (`docs/mobile-protocol-spec.md` §1).
 *
 * ```text
 * gc://pair?v=1&host=<ip|hostname>&port=<ssh-port>&user=<u>&token=<one-time>&fp=<hex>&proto=<minor>
 * ```
 *
 * Why this exists next to `core.pairFromQr`: the scanner must answer "is this
 * code ours?" locally, before any native call, so an unrelated QR does not
 * freeze the preview or touch the core. The rules below mirror the Rust
 * implementation in `mobile-core/src/qr.rs` (the same messages, the same
 * rejections), and the accepted result is a `PairInfo` from `lib/core.ts` — the
 * swapped native binding returns the same shape once T14 lands.
 *
 * Pure and framework-free on purpose: the rules and copy are pinned by
 * `mobile/test/qr-parse.test.mjs`, so they can be verified without a React
 * Native runtime. Copy is Spanish rioplatense (voseo), matching the artboard
 * `design/mobile-app-onboarding/01-qr-scan.html` and the V1 states in
 * `docs/mobile-views-plan.md`.
 */

import type { PairInfo } from './core';

/** Minimal result type shared by the pure helpers in this app. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Query parameters this version understands (unknown keys are ignored). */
export type QrParam = 'v' | 'host' | 'port' | 'user' | 'token' | 'fp' | 'proto';

/** Why a scanned string was not accepted. */
export type QrParseErrorCode =
  /** Not a `gc://pair?…` URI at all (foreign scheme, action or missing query). */
  | 'not-pair-uri'
  /** A major version this build does not speak. */
  | 'unsupported-version'
  /** `v` is present but not a number. */
  | 'invalid-version'
  /** A required parameter is absent or empty. */
  | 'missing-field'
  /** `port` is present but not a u16 in 1..=65535. */
  | 'invalid-port'
  /** `fp` is not the 64-hex SHA-256 host key fingerprint. */
  | 'invalid-fp'
  /** `proto` is present but not an unsigned integer. */
  | 'invalid-proto'
  /** Broken query string: duplicate keys, segments without `=`, empty names. */
  | 'malformed-params';

/** The only copy the V1 screen shows for a rejected code. */
export const qrParseCopy = {
  /** Toasts for a code that is not a Gentle Movil invitation (views plan V1). */
  notPairUri: 'Ese código no es de Gentle Movil.',
  /** Every other parse failure: the QR itself is broken. */
  incomplete: 'QR incompleto. Pedí uno nuevo.',
  /** A well-formed QR from a newer protocol major. */
  unsupportedVersion:
    'Este QR usa una versión de Gentle Movil que no reconocemos. Actualizá la app.',
} as const;

/** A rejection carries the reason, the offending parameter and the user copy. */
export interface QrParseError {
  code: QrParseErrorCode;
  /** Parameter the rejection refers to, when it names one. */
  field?: QrParam;
  /** Copy ready for the screen toast; never a raw parser message. */
  message: string;
}

/** The only major version this build speaks (spec §1). */
export const SUPPORTED_VERSION = 1;

/** SSH port assumed when the QR omits `port` (spec §1). */
export const DEFAULT_PORT = 22;

/** Length in hex characters of a SHA-256 fingerprint (32 bytes × 2). */
export const FINGERPRINT_HEX_LEN = 64;

const SCHEME = 'gc';
const ACTION = 'pair';
const U32_MAX = 4294967295;
const U16_MAX = 65535;

const DIGITS = /^\d+$/;

function fail(
  code: QrParseErrorCode,
  message: string,
  field?: QrParam,
): { ok: false; error: QrParseError } {
  return { ok: false, error: field === undefined ? { code, message } : { code, message, field } };
}

const incomplete = (code: QrParseErrorCode, field?: QrParam) =>
  fail(code, qrParseCopy.incomplete, field);

/**
 * Validate and normalize a fingerprint to the compact lowercase form.
 *
 * Separators already present in the QR (`:` or `-`) are dropped and the digits
 * lowercased, exactly like `mobile-core/src/fingerprint.rs`.
 */
export function normalizeFingerprint(value: string): string | null {
  const compact = value
    .split('')
    .filter((char) => char !== ':' && char !== '-')
    .join('')
    .toLowerCase();
  if (compact.length !== FINGERPRINT_HEX_LEN || !/^[0-9a-f]+$/.test(compact)) {
    return null;
  }
  return compact;
}

/** Split a query string, rejecting duplicates and malformed segments. */
function parseQuery(query: string): Result<Map<string, string>, QrParseError> {
  const params = new Map<string, string>();
  for (const segment of query.split('&')) {
    if (segment === '') {
      continue;
    }
    const separator = segment.indexOf('=');
    if (separator === -1) {
      return fail('malformed-params', qrParseCopy.incomplete);
    }
    const key = segment.slice(0, separator);
    if (key === '') {
      return fail('malformed-params', qrParseCopy.incomplete);
    }
    if (params.has(key)) {
      return fail('malformed-params', qrParseCopy.incomplete);
    }
    // Values stay verbatim: a QR generator emits URL-safe tokens and plain
    // host/user values, so no percent-decoding happens on either side.
    params.set(key, segment.slice(separator + 1));
  }
  return { ok: true, value: params };
}

/** A required, non-empty parameter. */
function required(
  params: Map<string, string>,
  key: QrParam,
): Result<string, QrParseError> {
  const value = params.get(key);
  if (value === undefined || value === '') {
    return incomplete('missing-field', key);
  }
  return { ok: true, value };
}

/**
 * Parse and validate a scanned pairing URI.
 *
 * Pure: no I/O, no global state. Rejections are `QrParseError`s with copy that
 * is safe to show to the user.
 */
export function parsePairUri(uri: string): Result<PairInfo, QrParseError> {
  const trimmed = uri.trim();

  const schemeEnd = trimmed.indexOf('://');
  if (schemeEnd === -1) {
    return fail('not-pair-uri', qrParseCopy.notPairUri);
  }
  if (trimmed.slice(0, schemeEnd).toLowerCase() !== SCHEME) {
    return fail('not-pair-uri', qrParseCopy.notPairUri);
  }

  const rest = trimmed.slice(schemeEnd + 3);
  const queryStart = rest.indexOf('?');
  if (queryStart === -1) {
    return fail('not-pair-uri', qrParseCopy.notPairUri);
  }
  const action = rest.slice(0, queryStart).replace(/\/+$/, '');
  if (action.toLowerCase() !== ACTION) {
    return fail('not-pair-uri', qrParseCopy.notPairUri);
  }

  const parsedQuery = parseQuery(rest.slice(queryStart + 1));
  if (!parsedQuery.ok) {
    return parsedQuery;
  }
  const params = parsedQuery.value;

  const versionRaw = required(params, 'v');
  if (!versionRaw.ok) {
    return versionRaw;
  }
  if (!DIGITS.test(versionRaw.value) || Number(versionRaw.value) > U32_MAX) {
    return incomplete('invalid-version', 'v');
  }
  const version = Number(versionRaw.value);
  if (version !== SUPPORTED_VERSION) {
    return fail('unsupported-version', qrParseCopy.unsupportedVersion);
  }

  const host = required(params, 'host');
  if (!host.ok) {
    return host;
  }
  const user = required(params, 'user');
  if (!user.ok) {
    return user;
  }
  const token = required(params, 'token');
  if (!token.ok) {
    return token;
  }

  let port = DEFAULT_PORT;
  const portRaw = params.get('port');
  if (portRaw !== undefined) {
    if (!DIGITS.test(portRaw)) {
      return incomplete('invalid-port', 'port');
    }
    const parsedPort = Number(portRaw);
    if (parsedPort === 0 || parsedPort > U16_MAX) {
      return incomplete('invalid-port', 'port');
    }
    port = parsedPort;
  }

  const fingerprintRaw = required(params, 'fp');
  if (!fingerprintRaw.ok) {
    return fingerprintRaw;
  }
  const fp = normalizeFingerprint(fingerprintRaw.value);
  if (fp === null) {
    return incomplete('invalid-fp', 'fp');
  }

  const protoRaw = params.get('proto');
  let proto = '';
  if (protoRaw !== undefined) {
    if (!DIGITS.test(protoRaw) || Number(protoRaw) > U32_MAX) {
      return incomplete('invalid-proto', 'proto');
    }
    proto = protoRaw;
  }

  return {
    ok: true,
    value: {
      host: host.value,
      port,
      user: user.value,
      token: token.value,
      fp,
      // `PairInfo.proto` is a non-optional string in the frozen TS contract, but
      // the QR may omit the daemon minor. An empty string records "the host did
      // not advertise one" without inventing a version; the core reports the
      // concrete minor once the tunnel negotiates (spec §4).
      proto,
    },
  };
}
