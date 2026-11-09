import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { codeBridgeReference, filePreviewKind, HTML_PREVIEW_CSP, imagePreviewMime, isBridgeTarget, linkBridgeReference, MAX_PREVIEW_BYTES, previewLink } from '../ui/src/lib/artifact-preview.ts';

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

for (const [href, expected] of [
  ['http://localhost:3000', { kind: 'endpoint', url: 'http://localhost:3000' }],
  ['http://LOCALHOST/app?x=1#top', { kind: 'endpoint', url: 'http://LOCALHOST/app?x=1#top' }],
  ['http://127.0.0.1:5173/', { kind: 'endpoint', url: 'http://127.0.0.1:5173/' }],
  ['http://0.0.0.0:8000', { kind: 'endpoint', url: 'http://0.0.0.0:8000' }],
  ['http://[::1]:8080/x', { kind: 'endpoint', url: 'http://[::1]:8080/x' }],
  ['/tmp/report.html', { kind: 'file', reference: '/tmp/report.html' }],
  ['~/notes.md', { kind: 'file', reference: '~/notes.md' }],
  ['docs/guide.md', { kind: 'file', reference: 'docs/guide.md' }],
  ['file:///work/app/report.html', { kind: 'file', reference: 'file:///work/app/report.html' }],
  ['C:\\work\\report.html', { kind: 'file', reference: 'C:\\work\\report.html' }],
  ['/Users/me/My Documents/report.pdf', { kind: 'file', reference: '/Users/me/My Documents/report.pdf' }],
  ['/Users/me/My%20Documents/r%C3%A9sum%C3%A9.pdf', { kind: 'file', reference: '/Users/me/My Documents/résumé.pdf' }],
  ['docs/my%20guide.md', { kind: 'file', reference: 'docs/my guide.md' }],
  ['file:///Users/me/My%20Documents/a.pdf', { kind: 'file', reference: 'file:///Users/me/My%20Documents/a.pdf' }],
  ['/tmp/100%.txt', { kind: 'file', reference: '/tmp/100%.txt' }],
  ['/tmp/bad%E0%A4%A.txt', { kind: 'file', reference: '/tmp/bad%E0%A4%A.txt' }]
] as const) {
  test(`link reference is classified: ${href}`, () => {
    assert.deepEqual(linkBridgeReference(href), expected);
  });
}

for (const href of [
  '', '#section', '?q=1', '//cdn.example/x.js', 'mailto:a@b.c', 'javascript:alert(1)', 'data:text/html,hi',
  'https://example.com', 'http://example.com', 'http://localhost.evil.com', 'http://localhost@evil.com',
  'http://192.168.1.5:3000', 'a\u0000b.html', 'a\tb.html', 'a\nb.html', '/' + 'a'.repeat(1100)
]) {
  test(`link reference is not classified: ${JSON.stringify(href.slice(0, 40))}`, () => {
    assert.equal(linkBridgeReference(href), undefined);
  });
}

for (const [text, expected] of [
  ['/tmp/out/report.html', { kind: 'file', reference: '/tmp/out/report.html' }],
  ['./dist/index.html', { kind: 'file', reference: './dist/index.html' }],
  ['~/Documents/plan.pdf', { kind: 'file', reference: '~/Documents/plan.pdf' }],
  ['/Users/me/My Documents/report.pdf', { kind: 'file', reference: '/Users/me/My Documents/report.pdf' }],
  ['C:\\Users\\me\\My Documents\\plan.docx', { kind: 'file', reference: 'C:\\Users\\me\\My Documents\\plan.docx' }],
  ['./notes (final).md', { kind: 'file', reference: './notes (final).md' }],
  ['http://localhost:3000', { kind: 'endpoint', url: 'http://localhost:3000' }]
] as const) {
  test(`inline code reference is classified: ${text}`, () => {
    assert.deepEqual(codeBridgeReference(text), expected);
  });
}

for (const text of [
  'npm run dev', '/usr/bin', 'src/app.ts', 'app.ts', 'const x = 1', '/tmp/*.html', 'file.ts:42', 'rm -rf /tmp/x.txt', 'cd /tmp/some dir', ' /tmp/a.html and more', '/tmp/a.html\nb',
  'https://example.com/a.html', '/tmp/', 'http://example.com'
]) {
  test(`inline code is not mistaken for a reference: ${JSON.stringify(text)}`, () => {
    assert.equal(codeBridgeReference(text), undefined);
  });
}

test('bridge targets are recognised separately from artifact targets', () => {
  assert.equal(isBridgeTarget({ kind: 'bridge-file', sessionId: 's', reference: '/tmp/a.html' }), true);
  assert.equal(isBridgeTarget({ kind: 'bridge-endpoint', sessionId: 's', url: 'http://localhost:3000' }), true);
  assert.equal(isBridgeTarget({ kind: 'link', url: 'https://example.com' }), false);
  assert.equal(isBridgeTarget(null), false);
});

test('bridge modal asks before anything is fetched or relayed and keeps the frame opaque', () => {
  const source = readFileSync(new URL('../ui/src/lib/BridgePreview.svelte', import.meta.url), 'utf8');
  assert.match(source, /sandbox="allow-scripts allow-forms allow-modals"/);
  assert.doesNotMatch(source, /allow-same-origin|allow-popups|allow-top-navigation|allow-downloads/);
  assert.match(source, /Fetch this file from the computer running Pi\?/);
  assert.match(source, /Open this local server through Companion\?/);
  // Network calls happen only from the explicit confirm actions.
  assert.equal(source.match(/companion\.bridge(?:File|Endpoint)\(/g)?.length, 2);
  assert.match(source, /onclick=\{\(\) => fetchFile\(true\)\}/);
  assert.match(source, /onclick=\{openEndpoint\}/);
  // Closing the dialog, or leaving the page, ends the relay link once.
  assert.match(source, /companion\.bridgeRevoke\(target\.sessionId, frame\.path\)/);
  assert.equal(source.match(/releaseLink\(\);/g)?.length, 2);
  assert.doesNotMatch(source, /\{@html/);
});
