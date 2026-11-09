import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const template = readFileSync(new URL('../server/src/bridge_shim.js', import.meta.url), 'utf8');
const PREFIX = '/bridge/tok123';
const PORT = 3000;
const PAGE = 'https://companion.example' + PREFIX + '/app/index.html';

/** Run the injected shim against a fake browser and report where each request was sent. */
function browser() {
  const sent: { api: string; url: string }[] = [];
  class FakeRequest {
    url: string;
    constructor(input: string | FakeRequest) {
      this.url = typeof input === 'string' ? new URL(input, PAGE).href : input.url;
    }
  }
  const window: Record<string, unknown> = {};
  window.fetch = function (input: unknown) { sent.push({ api: 'fetch', url: input instanceof FakeRequest ? input.url : String(input) }); return Promise.resolve(); };
  class FakeXhr { open(_method: string, url: string) { sent.push({ api: 'xhr', url: String(url) }); } }
  window.XMLHttpRequest = FakeXhr;
  for (const name of ['EventSource', 'Worker', 'SharedWorker']) {
    window[name] = class { constructor(url: string) { sent.push({ api: name, url: String(url) }); } };
  }
  const navigator = { sendBeacon: (url: string) => { sent.push({ api: 'beacon', url: String(url) }); return true; } };
  const context = { window, Request: FakeRequest, XMLHttpRequest: FakeXhr, URL, location: { href: PAGE }, navigator };
  const script = template.split('__PREFIX__').join(JSON.stringify(PREFIX)).split('__PORT__').join(String(PORT));
  vm.runInNewContext(script, context);
  return { window, sent, FakeRequest, navigator, FakeXhr };
}

const REWRITTEN = [
  ['/api/data', PREFIX + '/api/data'],
  ['/api/data?x=1#top', PREFIX + '/api/data?x=1#top'],
  ['https://companion.example/api/data', PREFIX + '/api/data'],
  ['http://localhost:3000/api/data?x=1', PREFIX + '/api/data?x=1'],
  ['http://127.0.0.1:3000/api/data', PREFIX + '/api/data'],
  ['http://[::1]:3000/api/data', PREFIX + '/api/data'],
  ['http://0.0.0.0:3000/', PREFIX + '/']
] as const;
const UNCHANGED = [
  PREFIX + '/api/data',
  'relative/path.json',
  'http://localhost:4000/api',
  'http://localhost:30001/api',
  'https://example.com/api',
  'data:text/plain,hi',
  'blob:https://companion.example/abc'
] as const;

const pathOf = (url: string) => {
  const parsed = new URL(url, PAGE);
  return parsed.pathname + parsed.search + parsed.hash;
};

for (const [input, expected] of REWRITTEN) {
  test(`shim routes ${input} through the bridge on every API`, async () => {
    const { window, sent, FakeRequest, navigator, FakeXhr } = browser();
    const fetchIt = window.fetch as (input: unknown) => Promise<void>;
    await fetchIt(input);
    await fetchIt(new FakeRequest(input));
    await fetchIt(new URL(input, PAGE));
    new FakeXhr().open('GET', input);
    new (window.EventSource as new (url: string) => unknown)(input);
    new (window.Worker as new (url: string) => unknown)(input);
    new (window.SharedWorker as new (url: string) => unknown)(input);
    navigator.sendBeacon(input);
    assert.deepEqual(sent.map(entry => entry.api), ['fetch', 'fetch', 'fetch', 'xhr', 'EventSource', 'Worker', 'SharedWorker', 'beacon']);
    for (const entry of sent) assert.equal(pathOf(entry.url), expected, `${entry.api}: ${entry.url}`);
  });
}

for (const input of UNCHANGED) {
  test(`shim leaves ${input} alone`, async () => {
    const { window, sent } = browser();
    await (window.fetch as (i: unknown) => Promise<void>)(input);
    new (window.EventSource as new (u: string) => unknown)(input);
    assert.deepEqual(sent.map(entry => entry.url), [input, input]);
  });
}

test('shim does not wrap WebSocket, which the bridge does not proxy', () => {
  assert.doesNotMatch(template, /wrapConstructor\('WebSocket'\)/);
  assert.match(template, /WebSockets are not proxied/);
});
