import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewLinks, sharedFileTarget } from '../ui/src/lib/artifact-links.ts';
import type { TempFile } from '../ui/src/lib/types.ts';

const file: TempFile = { id: 'file-1', name: 'report.html', path: '/private/session/report.html', size: 100, mime: 'text/html', createdAt: 1, source: 'agent' };
const origin = 'https://companion.example';
for (const href of [
  'report.html', '/private/session/report.html', 'file:///private/session/report.html',
  '/api/sessions/session-1/files/file-1', origin + '/api/sessions/session-1/files/file-1'
]) {
  test(`registered upload link resolves by opaque id: ${href}`, () => {
    assert.deepEqual(sharedFileTarget(href, 'session-1', [file], origin), { kind: 'file', sessionId: 'session-1', file });
  });
}
for (const href of [
  '/etc/passwd', 'file:///etc/passwd', 'file://other-host/private/session/report.html',
  '/api/sessions/another-session/files/file-1',
  'https://other.example/api/sessions/session-1/files/file-1',
  'https://user:password@companion.example/api/sessions/session-1/files/file-1',
  '/private/session/%ZZ', 'javascript:alert(1)'
]) {
  test(`unshared or unrelated link cannot grant file access: ${href}`, () => {
    assert.equal(sharedFileTarget(href, 'session-1', [file], origin), undefined);
  });
}
for (const path of [String.raw`C:\Users\demo\report.html`, 'C:/Users/demo/report.html']) {
  test(`registered Windows path is an opaque file reference: ${path}`, () => {
    const windowsFile = { ...file, path };
    assert.deepEqual(sharedFileTarget(path, 'session-1', [windowsFile], origin), { kind: 'file', sessionId: 'session-1', file: windowsFile });
  });
}

test('ambiguous filenames do not choose an arbitrary upload', () => {
  assert.equal(sharedFileTarget('report.html', 'session-1', [file, { ...file, id: 'file-2', path: '/elsewhere/report.html' }], origin), undefined);
});

function actionFixture(href: string, options: Parameters<typeof previewLinks>[1]) {
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const oldObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin } });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  const link = { getAttribute: () => href, target: '', rel: '', referrerPolicy: '' };
  let handler: (event: MouseEvent) => void = () => {};
  const node = {
    querySelectorAll: () => [link], contains: () => true,
    addEventListener: (_name: string, listener: typeof handler) => { handler = listener; }, removeEventListener() {}
  } as unknown as HTMLElement;
  const action = previewLinks(node, options);
  return {
    action, link,
    click() {
      let prevented = false;
      handler({ button: 0, target: { closest: () => link }, preventDefault() { prevented = true; } } as unknown as MouseEvent);
      return prevented;
    },
    close() {
      action.destroy();
      if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation);
      else Reflect.deleteProperty(globalThis, 'location');
      if (oldObserver) Object.defineProperty(globalThis, 'MutationObserver', oldObserver);
      else Reflect.deleteProperty(globalThis, 'MutationObserver');
    }
  };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

for (const outcome of ['open', 'destroy', 'navigate', 'navigate-back', 'fail']) {
  test(`late shared-file registry response: ${outcome}`, async () => {
    const pending = Promise.withResolvers<TempFile[]>();
    const targets: unknown[] = [];
    const errors: string[] = [];
    let loads = 0;
    const options = {
      sessionId: 'session-1', files: [],
      loadFiles: () => { loads++; return pending.promise; },
      onpreview: (target: unknown) => targets.push(target), onerror: (message: string) => errors.push(message)
    };
    const fixture = actionFixture('report.html', options);
    try {
      assert.equal(fixture.click(), true);
      assert.equal(loads, 1, 'refreshes the authenticated registry, not the agent URL');
      assert.deepEqual(targets, []);
      if (outcome === 'destroy') fixture.action.destroy();
      if (outcome === 'navigate' || outcome === 'navigate-back') fixture.action.update({ ...options, sessionId: 'another-session' });
      if (outcome === 'navigate-back') fixture.action.update(options);
      if (outcome === 'fail') pending.reject(new Error('Workspace offline'));
      else pending.resolve([file]);
      await nextTurn();
      if (outcome === 'open') assert.deepEqual(targets, [{ kind: 'file', sessionId: 'session-1', file }]);
      else assert.deepEqual(targets, []);
      if (outcome === 'fail') assert.match(errors[0], /Could not check.*Workspace offline/);
      else assert.deepEqual(errors, []);
    } finally { fixture.close(); }
  });
}

test('fragment links retain in-document navigation instead of a blank target', () => {
  const fixture = actionFixture('#section', { onpreview() { assert.fail('fragment is not a preview'); }, onerror() { assert.fail('fragment is valid'); } });
  try {
    assert.equal(fixture.link.target, '');
    assert.equal(fixture.click(), false);
  } finally { fixture.close(); }
});
