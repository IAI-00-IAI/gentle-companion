import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isManualSshValid,
  validateManualSsh,
} from '../lib/validation.ts';

const base = {
  host: '192.168.1.42',
  port: '22',
  user: 'reaan',
  auth: 'password',
  password: 'correcta',
  keyPath: '',
};

const input = (patch = {}) => ({ ...base, ...patch });

test('valid input produces no errors and enables the CTA', () => {
  assert.deepEqual(validateManualSsh(input()), {});
  assert.equal(isManualSshValid(input()), true);
});

test('host: empty is required with voseo copy', () => {
  const errors = validateManualSsh(input({ host: '   ' }));
  assert.equal(errors.host, 'Escribí la IP o el host de tu computadora.');
  assert.equal(isManualSshValid(input({ host: '   ' })), false);
});

test('host: malformed values are rejected', () => {
  for (const host of ['ssh://192.168.1.42', '999.1.1.1', '192.168.1', 'mi pc', 'host..local']) {
    const errors = validateManualSsh(input({ host }));
    assert.equal(errors.host, 'Formato de host no válido. Revisá la IP o el nombre.', host);
    assert.equal(isManualSshValid(input({ host })), false, host);
  }
});

test('host: IPv4, hostnames, localhost and IPv6 are accepted', () => {
  for (const host of ['192.168.1.42', 'mi-pc.local', 'localhost', 'fe80::1', '10.0.0.7']) {
    assert.deepEqual(validateManualSsh(input({ host })), {}, host);
  }
});

test('port: only 1-65535 is accepted', () => {
  for (const port of ['22', '2222', '65535']) {
    assert.deepEqual(validateManualSsh(input({ port })), {}, port);
  }
  for (const port of ['', '0', '65536', '2a', ' 22 ', '-22']) {
    const errors = validateManualSsh(input({ port }));
    assert.equal(errors.port, 'Puerto 1–65535', port);
    assert.equal(isManualSshValid(input({ port })), false, port);
  }
});

test('user: required and whitespace/at-sign free', () => {
  assert.equal(validateManualSsh(input({ user: '' })).user, 'Escribí el usuario SSH.');
  assert.equal(validateManualSsh(input({ user: 're aan' })).user, 'El usuario no puede tener espacios ni @.');
  assert.equal(validateManualSsh(input({ user: 'yo@pc' })).user, 'El usuario no puede tener espacios ni @.');
});

test('credential: password mode requires a password', () => {
  const errors = validateManualSsh(input({ auth: 'password', password: '', keyPath: '/tmp/id' }));
  assert.equal(errors.credential, 'Escribí la contraseña.');
});

test('credential: key mode requires a key path and ignores the password', () => {
  assert.equal(
    validateManualSsh(input({ auth: 'key', password: '', keyPath: '' })).credential,
    'Elegí la ruta de tu clave SSH.',
  );
  const errors = validateManualSsh(input({ auth: 'key', password: '', keyPath: '~/.ssh/id_ed25519' }));
  assert.deepEqual(errors, {});
});

test('every broken field reports its own error at once', () => {
  const errors = validateManualSsh(input({ host: '', port: '22abc', user: '', password: '' }));
  assert.deepEqual(Object.keys(errors).sort(), ['credential', 'host', 'port', 'user']);
});
