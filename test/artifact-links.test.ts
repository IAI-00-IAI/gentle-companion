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
    querySelectorAll: (selector: string) => selector === 'a[href]' ? [link] : [], contains: () => true,
    addEventListener: (name: string, listener: typeof handler) => { if (name === 'click') handler = listener; }, removeEventListener() {}
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

for (const [href, expected] of [
  ['http://localhost:3000/dashboard', { kind: 'bridge-endpoint', sessionId: 'session-1', url: 'http://localhost:3000/dashboard' }],
  ['http://127.0.0.1:8080', { kind: 'bridge-endpoint', sessionId: 'session-1', url: 'http://127.0.0.1:8080' }],
  ['https://example.com/docs', { kind: 'link', url: 'https://example.com/docs' }],
  ['/tmp/out/report.html', { kind: 'bridge-file', sessionId: 'session-1', reference: '/tmp/out/report.html' }],
  ['docs/guide.md', { kind: 'bridge-file', sessionId: 'session-1', reference: 'docs/guide.md' }],
  ['file:///work/app/report.html', { kind: 'bridge-file', sessionId: 'session-1', reference: 'file:///work/app/report.html' }]
] as const) {
  test(`agent link is routed to the right preview: ${href}`, async () => {
    const targets: unknown[] = [];
    let loads = 0;
    const fixture = actionFixture(href, {
      sessionId: 'session-1', files: [], loadFiles: async () => { loads++; return []; },
      onpreview: (target) => targets.push(target), onerror: (message) => assert.fail(message)
    });
    try {
      assert.equal(fixture.click(), true);
      await nextTurn();
      assert.deepEqual(targets, [expected]);
      // Local servers never need the upload registry; files check it first.
      assert.equal(loads, expected.kind === 'bridge-file' ? 1 : 0);
    } finally { fixture.close(); }
  });
}

for (const [href, sessionId] of [['mailto:someone@example.com', 'session-1'], ['javascript:alert(1)', 'session-1'], ['http://example.com', 'session-1'], ['http://localhost:3000', undefined], ['/tmp/report.html', undefined]] as const) {
  test(`agent link that is not previewable reports an error: ${href} (session: ${sessionId})`, async () => {
    const errors: string[] = [];
    const fixture = actionFixture(href, { sessionId, files: [], onpreview: () => assert.fail('must not preview'), onerror: (message) => errors.push(message) });
    try {
      assert.equal(fixture.click(), true);
      await nextTurn();
      assert.equal(errors.length, 1);
      assert.match(errors[0], /public HTTPS links, localhost servers and files/);
    } finally { fixture.close(); }
  });
}
