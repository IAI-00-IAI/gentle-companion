import test from 'node:test';
import assert from 'node:assert/strict';

import { qrParseCopy, parsePairUri } from '../lib/qr-parse.ts';

/**
 * Contract of `parsePairUri` (`docs/mobile-protocol-spec.md` §1, mirrored from
 * the Rust core in `mobile-core/src/qr.rs`). The tests go through the public
 * function only: they pin what the QR scanner is allowed to accept, the
 * normalized `PairInfo` it hands to the screen, and the copy of every
 * rejection.
 */

const FP = '66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020';

const uri = (query) => `gc://pair?${query}`;

const valid = (patch = {}) => {
  const params = {
    v: '1',
    host: '192.168.1.42',
    port: '2222',
    user: 'reaan',
    token: 'inv_7Qp2',
    fp: FP,
    proto: '3',
    ...patch,
  };
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return uri(query);
};

const rejected = (input) => {
  const result = parsePairUri(input);
  assert.equal(result.ok, false, `expected a rejection for ${input}`);
  assert.equal('value' in result, false, 'a rejection never carries a PairInfo');
  return result.error;
};

test('a complete invitation parses into the PairInfo the screen shows', () => {
  const result = parsePairUri(valid());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    host: '192.168.1.42',
    port: 2222,
    user: 'reaan',
    token: 'inv_7Qp2',
    fp: FP,
    proto: '3',
  });
});

test('port defaults to 22 and proto stays unknown when the QR omits them', () => {
  const result = parsePairUri(valid({ port: undefined, proto: undefined }));
  assert.equal(result.ok, true);
  assert.equal(result.value.port, 22);
  assert.equal(result.value.proto, '', 'an omitted proto is never invented');
});

test('scheme is case-insensitive and surrounding whitespace or a trailing slash is tolerated', () => {
  const query = `v=1&host=gentle.local&user=reaan&token=t&fp=${FP}`;
  for (const input of [`  GC://PAIR?${query}  `, `gc://pair/?${query}`, `\ngc://pair?${query}\t`]) {
    const result = parsePairUri(input);
    assert.equal(result.ok, true, input);
    assert.equal(result.value.host, 'gentle.local', input);
  }
});

test('the fingerprint is accepted in any separator style and normalized to compact lowercase hex', () => {
  const colon = FP.toUpperCase().match(/.{2}/g).join(':');
  const dash = FP.match(/.{2}/g).join('-');
  for (const fp of [FP.toUpperCase(), colon, dash]) {
    const result = parsePairUri(valid({ fp }));
    assert.equal(result.ok, true, fp);
    assert.equal(result.value.fp, FP, fp);
  }
});

test('unknown parameters are ignored so a newer host does not break this build', () => {
  const result = parsePairUri(valid({ future: '1' }));
  assert.equal(result.ok, true);
  assert.equal(result.value.host, '192.168.1.42');
});

test('anything that is not a gc://pair URI is rejected with the "not ours" copy', () => {
  for (const input of [
    '',
    'hola',
    `pair?v=1&host=h&user=u&token=t&fp=${FP}`,
    `https://pair?v=1&host=h&user=u&token=t&fp=${FP}`,
    `gc://connect?v=1&host=h&user=u&token=t&fp=${FP}`,
    'gc://pair',
  ]) {
    const error = rejected(input);
    assert.equal(error.code, 'not-pair-uri', input);
    assert.equal(error.message, qrParseCopy.notPairUri, input);
  }
});

test('the major version is required, numeric, and must be 1', () => {
  for (const [v, code, field] of [
    [undefined, 'missing-field', 'v'],
    ['', 'missing-field', 'v'],
    ['one', 'invalid-version', 'v'],
    ['-1', 'invalid-version', 'v'],
    ['1.5', 'invalid-version', 'v'],
  ]) {
    const error = rejected(valid({ v }));
    assert.equal(error.code, code, `v=${v}`);
    assert.equal(error.field, field, `v=${v}`);
    assert.equal(error.message, qrParseCopy.incomplete, `v=${v}`);
  }
});

test('a newer major version gets its own copy instead of "incomplete"', () => {
  const error = rejected(valid({ v: '2' }));
  assert.equal(error.code, 'unsupported-version');
  assert.equal(error.message, qrParseCopy.unsupportedVersion);
});

test('host, user and token are required and must not be empty', () => {
  for (const field of ['host', 'user', 'token']) {
    for (const value of [undefined, '']) {
      const error = rejected(valid({ [field]: value }));
      assert.equal(error.code, 'missing-field', `${field}=${value}`);
      assert.equal(error.field, field, `${field}=${value}`);
      assert.equal(error.message, qrParseCopy.incomplete, `${field}=${value}`);
    }
  }
});

test('the port must be a u16 between 1 and 65535 when present', () => {
  for (const port of ['65535', '1']) {
    const result = parsePairUri(valid({ port }));
    assert.equal(result.ok, true, `port=${port}`);
    assert.equal(result.value.port, Number(port), `port=${port}`);
  }
  for (const port of ['0', '65536', '-1', '22a', '', 'ssh', ' 22']) {
    const error = rejected(valid({ port }));
    assert.equal(error.code, 'invalid-port', `port=${port}`);
    assert.equal(error.field, 'port', `port=${port}`);
  }
});

test('the fingerprint must be exactly 64 hex characters after normalization', () => {
  for (const fp of ['abc', FP.slice(0, 63), `${FP}0`, 'z'.repeat(64)]) {
    const error = rejected(valid({ fp }));
    assert.equal(error.code, 'invalid-fp', fp);
    assert.equal(error.field, 'fp', fp);
  }
  for (const fp of [undefined, '']) {
    const error = rejected(valid({ fp }));
    assert.equal(error.code, 'missing-field', `fp=${fp}`);
    assert.equal(error.field, 'fp', `fp=${fp}`);
  }
});

test('proto must be an unsigned integer when present', () => {
  for (const proto of ['three', '-3', '1.2']) {
    const error = rejected(valid({ proto }));
    assert.equal(error.code, 'invalid-proto', proto);
    assert.equal(error.field, 'proto', proto);
  }
});

test('malformed query parameters are rejected instead of guessed', () => {
  const cases = [
    [`v=1&host=h&host=h2&user=u&token=t&fp=${FP}`, 'duplicate'],
    [`v=1&host&user=u&token=t&fp=${FP}`, 'no value'],
    [`v=1&=x&host=h&user=u&token=t&fp=${FP}`, 'empty name'],
  ];
  for (const [query, name] of cases) {
    const error = rejected(uri(query));
    assert.equal(error.code, 'malformed-params', name);
    assert.equal(error.message, qrParseCopy.incomplete, name);
  }
});
