import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpsLinkFor } from '../ui/src/lib/https-link.ts';

test('rewrites the port and keeps the path, query and hash', () => {
  assert.equal(
    httpsLinkFor('http://192.168.2.20:43722/sessions/abc?tab=diff#top', 43723),
    'https://192.168.2.20:43723/sessions/abc?tab=diff#top'
  );
});

test('the root page becomes the root page', () => {
  assert.equal(httpsLinkFor('http://192.168.2.20:43722/', 43723), 'https://192.168.2.20:43723/');
});

test('no HTTPS surface means no link', () => {
  assert.equal(httpsLinkFor('http://192.168.2.20:43722/', 0), null);
});

test('a page already on HTTPS gets no link', () => {
  assert.equal(httpsLinkFor('https://192.168.2.20:43723/', 43723), null);
});

test('a non-http page gets no link', () => {
  assert.equal(httpsLinkFor('file:///tmp/snapshot.html', 43723), null);
});

test('an impossible port gets no link', () => {
  assert.equal(httpsLinkFor('http://192.168.2.20:43722/', 70000), null);
  assert.equal(httpsLinkFor('http://192.168.2.20:43722/', -1), null);
  assert.equal(httpsLinkFor('http://192.168.2.20:43722/', 1.5), null);
});

test('a hostname without an explicit port still gets the HTTPS port', () => {
  assert.equal(httpsLinkFor('http://companion.local/', 43723), 'https://companion.local:43723/');
});
