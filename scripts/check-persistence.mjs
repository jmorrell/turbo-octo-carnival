import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

// An independent runtime and storage directory: never touches the developer's rooms.
const directory = await mkdtemp(join(tmpdir(), 'fieldwork-persistence-'));
const base = 'http://127.0.0.1:8791';
let runtime, closed, browser, log = '';
const pause = ms => new Promise(done => setTimeout(done, ms));
async function stop() {
  if (!runtime) return;
  const child = runtime;
  runtime = undefined;
  const signal = name => {
    try { process.platform === 'win32' ? child.kill(name) : process.kill(-child.pid, name); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), 4000);
  try { await closed; } finally { clearTimeout(timer); }
}
async function start() {
  log = '';
  runtime = spawn(process.execPath, [
    resolve('node_modules/wrangler/bin/wrangler.js'), 'dev',
    '--ip', '127.0.0.1', '--port', '8791', '--inspector-port', '0', '--persist-to', directory,
  ], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  closed = new Promise(done => runtime.once('exit', done));
  for (const stream of [runtime.stdout, runtime.stderr]) stream.on('data', data => { log = (log + data).slice(-10000); });
  for (let i = 0; i < 150; i++) {
    if (runtime.exitCode !== null) throw new Error('Runtime exited: ' + log);
    try {
      if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(300) })).ok) return;
    } catch { /* starting */ }
    await pause(100);
  }
  throw new Error('Runtime did not start: ' + log);
}
try {
  await start();
  const created = await fetch(base + '/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Checkout latency regression', sample: true }),
  });
  assert.equal(created.status, 201, 'Creating a sample investigation should succeed');
  const room = await created.json();
  const headers = { Authorization: 'Bearer ' + room.token, 'Content-Type': 'application/json' };
  const url = base + '/api/rooms/' + room.id;
  const forkBody = JSON.stringify({
    title: 'Check the retry policy', fromBranchId: 'main',
    actor: { name: 'Eli', harness: 'pi' },
  });
  const fork = async () => {
    const response = await fetch(url + '/branches', {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': 'persistent-operation' }, body: forkBody,
    });
    assert.ok([200, 201].includes(response.status));
    return response.json();
  };
  const branch = await fork();
  const before = await (await fetch(url + '/export', { headers })).json();
  assert.equal(before.artifacts.length, 6);
  const html = await fetch(base);
  assert.match(html.headers.get('Content-Security-Policy'), /script-src 'self'/);
  await stop();
  await start();
  const after = await (await fetch(url + '/export', { headers })).json();
  const { exportedAt: _beforeTime, ...savedBefore } = before;
  const { exportedAt: _afterTime, ...savedAfter } = after;
  assert.deepEqual(savedAfter, savedBefore, 'Metadata, query results, renderer source, and SVG must survive a full runtime restart');
  assert.equal((await fork()).id, branch.id, 'The same idempotency key must survive a restart');
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /content security policy|violates/i.test(message.text())) failures.push(message.text());
  });
  await page.goto(base + room.url);
  await page.getByText('Live workspace', { exact: true }).waitFor();
  await page.locator('.chart svg').first().waitFor();
  await page.getByAltText('Where the time goes').waitFor();
  assert.equal(await page.getByTestId('evidence-card').count(), 6);
  assert.equal(new URL(page.url()).hash, '', 'The invite key should leave the address bar');
  assert.ok(await page.getByAltText('Where the time goes').evaluate(image => image.complete && image.naturalWidth > 0));
  await mkdir('docs', { recursive: true });
  await page.screenshot({ path: 'docs/workspace.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/fieldwork-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(failures, [], 'The production application must work under its CSP');
  console.log('Passed: runtime restart preserves 6 complete artifacts, branches, and idempotency; production charts, custom SVG, CSP, and mobile layout verified.');
} finally {
  await browser?.close();
  await stop();
  await rm(directory, { recursive: true, force: true });
}
