import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { filePreviewKind, HTML_PREVIEW_CSP, imagePreviewMime, MAX_PREVIEW_BYTES, previewLink } from '../ui/src/lib/artifact-preview.ts';

for (const value of [
  'https://example.com/report?view=1#details',
  'https://docs.example.com:8443/report',
  ' HTTPS://EXAMPLE.COM/report '
]) {
  test(`website preview accepts a normalized HTTPS domain URL: ${value}`, () => {
    assert.equal(previewLink(value), new URL(value.trim()).href);
  });
}

for (const value of [
  'http://example.com', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/report.html',
  '//example.com/report', '/api/settings', 'https://name:secret@example.com',
  'https://localhost', 'https://localhost.', 'https://sub.localhost', 'https://printer.local',
  'https://host.internal', 'https://router.lan', 'https://dev.home', 'https://device.home.arpa',
  'https://workspace', 'https://demo.test', 'https://host.invalid', 'https://host.onion',
  'https://example..com', 'https://bad_name.example.com', 'https://-host.example.com',
  'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1',
  'https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.0.1', 'https://169.254.169.254',
  'https://8.8.8.8', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[2606:4700:4700::1111]',
  'https://example.com\\@localhost', 'https://exam\nple.com', 'https://example.com/with space'
]) {
  test(`website preview rejects an unsupported or local target: ${JSON.stringify(value)}`, () => {
    assert.equal(previewLink(value), undefined);
  });
}

test('website preview excludes the Companion origin without excluding other HTTPS domains', () => {
  assert.equal(previewLink('https://companion.example.com/api/settings', 'https://companion.example.com'), undefined);
  assert.equal(previewLink('https://companion.example.com./api/settings', 'https://companion.example.com'), undefined);
  assert.equal(previewLink('https://docs.example.com/report', 'https://companion.example.com'), 'https://docs.example.com/report');
  assert.equal(previewLink('https://example.com', 'invalid-origin'), undefined);
});

for (const entry of [
  { name: 'report.html', mime: 'text/html', expected: 'html' },
  { name: 'report.HTM', mime: 'text/html; charset=utf-8', expected: 'html' },
  { name: 'report.html', mime: 'application/octet-stream', expected: 'html' },
  { name: 'image.png', mime: 'image/png', expected: 'image' },
  { name: 'image.JPG', mime: 'image/jpeg', expected: 'image' },
  { name: 'image.avif', mime: undefined, expected: 'image' },
  { name: 'diagram.svg', mime: 'image/svg+xml', expected: 'text' },
  { name: 'report.md', mime: 'text/markdown', expected: 'text' },
  { name: 'data.json', mime: 'application/json', expected: 'text' },
  { name: 'script.ts', mime: 'text/plain', expected: 'text' },
  { name: 'data.xml', mime: 'application/xml', expected: 'text' },
  { name: 'report.pdf', mime: 'application/pdf', expected: undefined },
  { name: 'archive.zip', mime: 'application/zip', expected: undefined },
  { name: 'report.png', mime: 'text/html', expected: undefined },
  { name: 'report.html', mime: 'image/png', expected: undefined },
  { name: 'report.txt', mime: 'application/zip', expected: undefined },
  { name: 'report.constructor', mime: undefined, expected: undefined },
  { name: 'report.__proto__', mime: undefined, expected: undefined }
]) {
  test(`file preview classification for ${entry.name} (${entry.mime})`, () => {
    assert.equal(filePreviewKind({ name: entry.name, mime: entry.mime, size: 100 }), entry.expected);
  });
}

for (const size of [-1, NaN, Infinity, 1.5, MAX_PREVIEW_BYTES + 1]) {
  test(`file preview refuses an invalid or oversized file: ${size}`, () => {
    assert.equal(filePreviewKind({ name: 'report.html', mime: 'text/html', size }), undefined);
  });
}

test('file preview size boundary and image MIME are explicit', () => {
  assert.equal(filePreviewKind({ name: 'report.txt', mime: 'text/plain', size: MAX_PREVIEW_BYTES }), 'text');
  assert.equal(filePreviewKind({ name: 'empty.txt', mime: 'text/plain', size: 0 }), 'text');
  assert.equal(imagePreviewMime({ name: 'photo.JPG' }), 'image/jpeg');
  assert.equal(imagePreviewMime({ name: 'diagram.svg' }), undefined);
});

test('local HTML policy disallows scripts, network, forms, and nested frames', () => {
  for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(HTML_PREVIEW_CSP.includes(directive), directive);
  }
  assert.doesNotMatch(HTML_PREVIEW_CSP, /https?:|\bself\b/);
  const helper = readFileSync(new URL('../ui/src/lib/artifact-preview.ts', import.meta.url), 'utf8');
  assert.match(helper, /WHOLE_DOCUMENT: true/);
  assert.match(helper, /USE_PROFILES: \{ html: true \}/);
  assert.match(helper, /FORBID_TAGS: \['script', 'base', 'meta', 'link', 'iframe', 'object', 'embed', 'form'\]/);
  assert.match(helper, /FORBID_ATTR: \['href', 'xlink:href', 'srcset', 'action', 'formaction', 'target', 'ping', 'srcdoc'\]/);
});

test('preview modal separates external consent from authenticated file loading and preserves isolation', () => {
  const source = readFileSync(new URL('../ui/src/lib/ArtifactPreview.svelte', import.meta.url), 'utf8');
  assert.match(source, /if websiteRequested/);
  assert.match(source, /Load website preview/);
  assert.match(source, /src=\{safeUrl\} sandbox="allow-scripts" referrerpolicy="no-referrer"/);
  assert.match(source, /srcdoc=\{content\} sandbox="" referrerpolicy="no-referrer"/);
  assert.doesNotMatch(source, /allow-same-origin|allow-forms|allow-popups|allow-top-navigation|allow-downloads/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /companion\.request<Blob>\(path, \{ signal: controller\.signal \}, 60_000, 'blob'\)/);
  assert.match(source, /blob\.size > MAX_PREVIEW_BYTES/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(source, /<pre class="preview-text">\{content\}<\/pre>/);
  assert.doesNotMatch(source, /\{@html/);
});
