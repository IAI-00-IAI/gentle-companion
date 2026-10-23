import DOMPurify from 'dompurify';
import type { TempFile } from './types.ts';

export type PreviewTarget =
  | { kind: 'link'; url: string }
  | { kind: 'file'; sessionId: string; file: TempFile };

export type FilePreviewKind = 'html' | 'image' | 'text';
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home', 'home.arpa', 'test', 'invalid', 'example', 'onion'];
const RASTER_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'],
  ['webp', 'image/webp'], ['bmp', 'image/bmp'], ['avif', 'image/avif']
]);
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml',
  'xml', 'svg', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'py', 'rs', 'sh',
  'toml', 'ini', 'conf', 'diff', 'patch', 'sql'
]);
const TEXT_MIMES = new Set([
  'application/json', 'application/ld+json', 'application/x-ndjson', 'application/javascript',
  'application/x-javascript', 'application/xml', 'application/yaml', 'application/toml',
  'application/x-sh', 'image/svg+xml'
]);

function normalizedHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/\.+$/, '');
}

/** Browser-only navigation: reject obvious local targets, without claiming to validate DNS. */
export function previewLink(value: string, baseOrigin?: string): string | undefined {
  const input = value.trim();
  if (!/^https:\/\//i.test(input) || /[\u0000-\u0020\u007f\\]/.test(input)) return undefined;
  let url: URL;
  try {
    url = new URL(input);
    if (baseOrigin) {
      const base = new URL(baseOrigin);
      if (url.protocol === base.protocol && url.port === base.port && normalizedHostname(url) === normalizedHostname(base)) return undefined;
    }
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  const hostname = normalizedHostname(url);
  // Reject every IP literal, including alternate IPv4 spellings normalized by URL.
  if (hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(hostname)) return undefined;
  if (!hostname.includes('.') || LOCAL_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith('.' + suffix))) return undefined;
  const validLabels = hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!validLabels) return undefined;
  return url.href;
}

function extension(name: string) {
  return name.split('.').at(-1)?.toLowerCase() ?? '';
}

function normalizedMime(file: Pick<TempFile, 'mime'>) {
  return file.mime?.split(';')[0].trim().toLowerCase() ?? '';
}

export function imagePreviewMime(file: Pick<TempFile, 'name'>): string | undefined {
  return RASTER_TYPES.get(extension(file.name));
}

/** Filename and declared MIME must agree; an SVG is source text, never an image document. */
export function filePreviewKind(file: Pick<TempFile, 'name' | 'mime' | 'size'>): FilePreviewKind | undefined {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_PREVIEW_BYTES) return undefined;
  const suffix = extension(file.name);
  const mime = normalizedMime(file);
  const unspecified = !mime || mime === 'application/octet-stream';
  if (suffix === 'html' || suffix === 'htm') {
    if (unspecified || mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
    return undefined;
  }
  const imageMime = imagePreviewMime(file);
  if (imageMime) {
    if (unspecified || mime === imageMime) return 'image';
    return undefined;
  }
  if (TEXT_EXTENSIONS.has(suffix) && (unspecified || mime.startsWith('text/') || TEXT_MIMES.has(mime))) return 'text';
  return undefined;
}

export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Call only in the browser; the result belongs in a scriptless sandboxed srcdoc, never the app DOM. */
export function htmlSnapshot(source: string): string {
  const clean = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'base', 'meta', 'link', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['href', 'xlink:href', 'srcset', 'action', 'formaction', 'target', 'ping', 'srcdoc']
  });
  // The policy precedes every sanitized element, including styles and images.
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + HTML_PREVIEW_CSP + '">' + clean;
}
