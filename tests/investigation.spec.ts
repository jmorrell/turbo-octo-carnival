import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DEMO_FROM, DEMO_TO } from '../src/shared/model';

const actor = { name: 'Test investigator', harness: 'codex' };
const imported = {
  title: 'An independent observation', source: { name: 'External script', uri: 'https://source-no-longer-exists.invalid/output' },
  data: [{ attempt: 1, duration: 83 }, { attempt: 2, duration: 205 }],
  view: 'table', actor,
};
async function room(request: APIRequestContext, sample = false) {
  const response = await request.post('/api/rooms', { data: { title: 'Investigation test', sample, actor } });
  expect(response.status(), await response.text()).toBe(201);
  const value = await response.json() as { id: string; token: string; url: string };
  const base = '/api/rooms/' + value.id;
  const headers = { Authorization: 'Bearer ' + value.token };
  return {
    ...value, base, headers,
    post: (path: string, data: unknown, extra: Record<string, string> = {}) => request.post(base + path, { data, headers: { ...headers, ...extra } }),
    get: (path = '') => request.get(base + path, { headers }),
  };
}

test('imports preserve data and honest provenance; retries are idempotent and room access is scoped', async ({ request }) => {
  const r = await room(request);
  const response = await r.post('/evidence', { ...imported, origin: 'captured' }, { 'Idempotency-Key': 'same-publication' });
  expect(response.status()).toBe(201);
  const evidence = await response.json();
  expect(evidence.origin).toBe('imported');
  expect(evidence.recipe).toBeUndefined();
  const retry = await r.post('/evidence', { ...imported, origin: 'captured' }, { 'Idempotency-Key': 'same-publication' });
  expect((await retry.json()).id).toBe(evidence.id);
  const conflict = await r.post('/evidence', { ...imported, title: 'Different' }, { 'Idempotency-Key': 'same-publication' });
  expect(conflict.status()).toBe(409);
  const saved = await (await r.get('/evidence/' + evidence.id)).json();
  expect(saved.data).toEqual(imported.data);
  expect(saved.sha256).toBe(createHash('sha256').update(JSON.stringify(imported.data)).digest('hex'));
  expect((await (await r.get()).json()).evidence).toHaveLength(1);
  expect((await request.get(r.base)).status()).toBe(401);
  expect((await request.post(r.base + '/_init', { data: {} })).status()).toBe(404);
  const other = await room(request);
  expect((await request.get(r.base + '/evidence/' + evidence.id, { headers: other.headers })).status()).toBe(401);
});

test('query reruns append revisions; forks retain a fixed evidence set; exports preserve original results', async ({ request }) => {
  const r = await room(request);
  const q = await r.post('/query', { title: 'Latency', source: 'demo-telemetry', query: { metric: 'latency' }, view: 'line', actor });
  expect(q.status()).toBe(201);
  const original = await q.json();
  expect(original.recipe.query.from).toBe(DEMO_FROM);
  expect(original.recipe.query.to).toBe(DEMO_TO);
  const branch = await (await r.post('/branches', { title: 'Retry hypothesis', fromBranchId: 'main', anchorId: original.id, actor })).json();
  expect(branch.inheritedIds).toEqual([original.id]);
  const rerun = await (await r.post('/evidence/' + original.id + '/rerun', { actor, branchId: branch.id })).json();
  expect(rerun.id).not.toBe(original.id);
  expect(rerun.parentIds).toContain(original.id);
  await r.post('/evidence', imported);
  const state = await (await r.get()).json();
  expect(state.branches.find((b: { id: string }) => b.id === branch.id).inheritedIds).toEqual([original.id]);
  const artifact = await (await r.get('/evidence/' + original.id)).json();
  expect(artifact.data.series[0].points).toHaveLength(61);
  expect(artifact.recipe).toEqual(original.recipe);
  const changes = await (await r.get('/changes?after=1')).json();
  expect(changes.events[0].seq).toBe(2);
  expect(changes.cursor).toBe(state.cursor);
  const exported = await (await r.get('/export')).json();
  expect(exported.artifacts).toHaveLength(3);
  expect(JSON.stringify(exported)).not.toContain(r.token);
  expect(exported.artifacts.find((a: { id: string }) => a.id === original.id).data).toEqual(artifact.data);
});

test('custom renderers execute with archived inputs and reject network access and active content', async ({ request }) => {
  const r = await room(request);
  const source = await (await r.post('/evidence', imported)).json();
  const payload = {
    title: 'Custom duration view', actor, inputIds: [source.id],
    code: '(inputs) => ({ tag: "svg", attrs: { viewBox: "0 0 200 60" }, children: [{ tag: "text", attrs: { x: 10, y: 30, fill: "#ffffff" }, text: String(inputs[0].data[1].duration) }] })',
  };
  const rendered = await r.post('/components', payload);
  expect(rendered.status(), await rendered.text()).toBe(201);
  const info = await rendered.json();
  const snapshot = await (await r.get('/evidence/' + info.id)).json();
  expect(snapshot.data.children[0].text).toBe('205');
  expect(snapshot.fallbackSvg).toContain('205');
  expect(snapshot.component.code).toBe(payload.code);
  expect(snapshot.parentIds).toEqual([source.id]);
  const rerendered = await (await r.post('/evidence/' + info.id + '/rerun', { actor })).json();
  expect(rerendered.id).not.toBe(info.id);
  expect(rerendered.parentIds).toEqual([source.id, info.id]);
  expect(rerendered.component.inputIds).toEqual([source.id]);
  for (const code of [
    'async () => { await fetch("https://example.com"); return { tag: "svg" }; }',
    '() => ({ tag: "svg", children: [{ tag: "script", text: "alert(1)" }] })',
    '() => ({ tag: "svg", attrs: { onload: "alert(1)" } })',
    '() => ({ tag: "svg", attrs: { fill: "url(https://example.com)" } })',
  ]) {
    expect((await r.post('/components', { ...payload, code })).status()).toBe(400);
  }
  expect((await (await r.get()).json()).evidence).toHaveLength(3);
});

test('invalid lineage and unsupported findings are refused without changing the room', async ({ request }) => {
  const r = await room(request);
  expect((await r.post('/evidence', { ...imported, parentIds: ['missing'] })).status()).toBe(400);
  expect((await r.post('/branches', { title: 'Invalid', anchorId: 'missing', actor })).status()).toBe(400);
  expect((await r.post('/findings', { title: 'Certain!', text: 'No supporting evidence', status: 'supported', parentIds: [], actor })).status()).toBe(400);
  expect((await r.post('/query', { title: 'Unavailable', source: 'cloudflare', query: {}, actor })).status()).toBe(400);
  expect((await (await r.get()).json()).evidence).toEqual([]);
});

test('two independent browsers receive new evidence, inspect it, and fork without copying the chat', async ({ request, browser }) => {
  const r = await room(request);
  const left = await browser.newContext(), right = await browser.newContext();
  const a = await left.newPage(), b = await right.newPage();
  const failures: string[] = [];
  a.on('pageerror', error => failures.push(error.message)); b.on('pageerror', error => failures.push(error.message));
  await Promise.all([a.goto(r.url), b.goto(r.url)]);
  await expect(a.getByText('Live workspace')).toBeVisible();
  await expect(b.getByText('Live workspace')).toBeVisible();
  await a.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await a.getByLabel('What did you find?').fill('Rollout event from another system');
  await a.getByLabel('Evidence JSON').fill(JSON.stringify(imported.data));
  await a.getByRole('button', { name: 'Publish evidence' }).click();
  await expect(b.getByRole('button', { name: 'Rollout event from another system', exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'Rollout event from another system', exact: true }).click();
  await expect(b.getByText('Agent-supplied origin', { exact: true })).toBeVisible();
  await b.locator('.inspector').getByRole('button', { name: 'Fork', exact: true }).click();
  await b.getByLabel('Thread name').fill('Independent check');
  await b.getByRole('button', { name: 'Create thread' }).click();
  await expect(a.locator('.sidebar').getByRole('button', { name: /^Independent check / })).toBeVisible();
  await b.reload();
  await expect(b.getByRole('button', { name: 'Rollout event from another system', exact: true })).toBeVisible();
  expect(failures).toEqual([]);
  await left.close(); await right.close();
});

test('sample charts, structured selection, reruns, custom view, and mobile layout work', async ({ request, page }) => {
  const r = await room(request, true);
  const failures: string[] = []; page.on('pageerror', e => failures.push(e.message));
  await page.goto(r.url);
  await expect(page.getByTestId('evidence-card')).toHaveCount(6);
  await expect(page.locator('.chart svg').first()).toBeVisible();
  await expect(page.getByAltText('Where the time goes')).toBeVisible();
  const chart = page.locator('.chart').first();
  const rect = await chart.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + rect!.width * .35, rect!.y + 110);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * .65, rect!.y + 110, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Investigate this range' })).toBeVisible();
  await page.getByRole('button', { name: 'Investigate this range' }).click();
  await page.getByRole('button', { name: 'Run & capture' }).click();
  await expect(page.getByRole('button', { name: 'Closer look at the selected window', exact: true })).toBeVisible();
  await page.locator('.inspector-tabs').getByRole('button', { name: 'Recipe' }).click();
  await page.getByRole('button', { name: 'Run again as a new revision' }).click();
  await expect(page.getByTestId('evidence-card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Close evidence details' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Investigation thread', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(failures).toEqual([]);
});

test('malformed chart data remains inspectable rather than breaking the workspace', async ({ request, page }) => {
  const r = await room(request);
  await r.post('/evidence', { ...imported, view: 'line', data: { arbitrary: 'native response' } });
  await page.goto(r.url);
  await expect(page.getByText('This output needs a chart transform. The saved JSON is shown below.')).toBeVisible();
  await expect(page.locator('.json-preview')).toContainText('native response');
});

test('CLI and MCP clients can contribute to the same investigation with their own identities', async ({ request }) => {
  const r = await room(request);
  const directory = await mkdtemp(join(tmpdir(), 'fieldwork-agent-test-'));
  const env = {
    ...process.env, FIELDWORK_URL: 'http://127.0.0.1:5173', FIELDWORK_ROOM: r.id, FIELDWORK_KEY: r.token,
    FIELDWORK_ACTOR: 'CLI investigator', FIELDWORK_HARNESS: 'pi',
  } as Record<string, string>;
  let transport: StdioClientTransport | undefined;
  try {
    const file = join(directory, 'evidence.json');
    const { actor: _ignored, ...payload } = imported;
    await writeFile(file, JSON.stringify(payload));
    const result = await promisify(execFile)(process.execPath, ['scripts/fieldwork.mjs', 'publish', '--file', file], { env });
    expect(JSON.parse(result.stdout).actor.harness).toBe('pi');
    transport = new StdioClientTransport({
      command: process.execPath, args: ['scripts/mcp.mjs'],
      env: { ...env, FIELDWORK_ACTOR: 'MCP investigator', FIELDWORK_HARNESS: 'codex' },
    });
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(transport);
    expect((await client.listTools()).tools.map(t => t.name)).toContain('publish_component');
    const posted = await client.callTool({ name: 'publish_evidence', arguments: { ...payload, title: 'MCP observation', view: 'table' } });
    expect(posted.isError).not.toBe(true);
    const state = await (await r.get()).json();
    expect(state.evidence.map((e: { actor: { harness: string } }) => e.actor.harness)).toEqual(['pi', 'codex']);
    await client.close();
  } finally {
    await transport?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
