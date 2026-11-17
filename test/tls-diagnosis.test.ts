import assert from 'node:assert/strict';
import { test } from 'node:test';
import { certificateUrlFor, looksLikeUntrustedCertificate } from '../ui/src/lib/tls-diagnosis.ts';

const base = { protocol: 'https:', transportFailure: true, online: true, httpsPort: 43723 };

test('an HTTPS transport failure on an online device with an HTTPS surface looks like a trust problem', () => {
  assert.equal(looksLikeUntrustedCertificate(base), true);
});

test('a plain-HTTP page never suggests a certificate problem', () => {
  // The LAN page has no certificate at all, so blaming one would send the user in circles.
  assert.equal(looksLikeUntrustedCertificate({ ...base, protocol: 'http:' }), false);
});

test('an HTTP status (the server answered) is not a trust problem', () => {
  // A 403 or a 500 proves TLS completed: the certificate was accepted.
  assert.equal(looksLikeUntrustedCertificate({ ...base, transportFailure: false }), false);
});

test('an offline device is offline, not mistrusting a certificate', () => {
  assert.equal(looksLikeUntrustedCertificate({ ...base, online: false }), false);
});

test('a daemon without an HTTPS surface cannot have a certificate problem', () => {
  assert.equal(looksLikeUntrustedCertificate({ ...base, httpsPort: 0 }), false);
});

test('the certificate URL points at this origin root', () => {
  assert.equal(
    certificateUrlFor('https://192.168.43.73:43723/sessions/abc?x=1#top'),
    'https://192.168.43.73:43723/cert.pem'
  );
});

test('no certificate URL on a plain-HTTP page', () => {
  assert.equal(certificateUrlFor('http://192.168.43.73:43722/'), null);
});
