import { test, expect } from '@playwright/test';
import { captureSQL, discoverDatasets, SQL_ENDPOINT } from '../src/server/cloudflare-sql';
import { capture } from '../src/server/sources';
import { DEFAULT_SQL } from '../src/shared/sql';

const account = 'a'.repeat(32), zone = 'b'.repeat(32);
const env = { CF_OBSERVABILITY_ACCOUNT_ID: account, CF_OBSERVABILITY_API_TOKEN: 'test-credential' };
const params = { start: '2026-10-03T10:00:00Z', end: '2026-10-03T11:00:00Z' };
const output = {
  data: [{ status: 200, requests: 125430 }, { status: 500, requests: 82 }],
  rows: 2, statistics: { elapsed_ms: 42, rows_read: 250000, bytes_read: 18000000 },
};
const actor = { name: 'SQL investigator', harness: 'codex' };
async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('unified SQL capture preserves the exact parameterized request and complete JSON response', async () => {
  const query = { query: DEFAULT_SQL, params };
  let calls = 0;
  await withFetch(async (url, options) => {
    calls++;
    expect(String(url)).toBe(SQL_ENDPOINT);
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-credential');
    expect(JSON.parse(options?.body as string)).toEqual({ ...query, scope: { accountTag: account } });
    return Response.json({ ...output, meta: [{ name: 'requests', type: 'UInt64' }] });
  }, async () => {
    const saved = await capture('cloudflare', query, env);
    expect(saved.query).toEqual({ ...query, scope: { accountTag: account } });
    expect(saved.data).toEqual({ ...output, meta: [{ name: 'requests', type: 'UInt64' }] });
    expect(saved.transport).toBe('http');
    expect(saved.source.uri).toBe(SQL_ENDPOINT);
    expect(Date.parse(saved.source.collectedAt)).toBeGreaterThan(0);
    expect(JSON.stringify(saved)).not.toContain(env.CF_OBSERVABILITY_API_TOKEN);
  });
  expect(calls).toBe(1);
});

test('HTTP SQL supports explicit zone scope, request time ranges, and Log Explorer responses without statistics', async () => {
  const query = {
    query: 'SELECT timestamp FROM logs.workersLogs LIMIT $1',
    params: [10], scope: { zoneTag: zone },
    time_range: { start: params.start, end: params.end },
  };
  const lex = { data: [{ timestamp: params.start }], rows: 1 };
  const binding = { query: async () => { throw new Error('Do not silently use the account binding for zone queries.'); } } as AnalyticsSQLBinding;
  await withFetch(async (_url, options) => {
    expect(JSON.parse(options?.body as string)).toEqual(query);
    return Response.json(lex);
  }, async () => {
    const saved = await captureSQL(query, { ...env, ANALYTICS_SQL: binding });
    expect(saved.transport).toBe('http');
    expect(saved.data).toEqual(lex);
    expect(saved.query).toEqual(query);
  });
});

test('the Workers binding receives SQL and parameters directly, without credentials or HTTP', async () => {
  const queries: unknown[] = [];
  const binding = { query: async (query: unknown) => { queries.push(query); return output; } } as unknown as AnalyticsSQLBinding;
  const query = { query: DEFAULT_SQL, params };
  await withFetch(async () => { throw new Error('HTTP must not be used.'); }, async () => {
    const saved = await captureSQL(query, { ANALYTICS_SQL: binding });
    expect(queries).toEqual([query]);
    expect(saved.query).toEqual(query);
    expect(saved.data).toEqual(output);
    expect(saved.transport).toBe('binding');
    expect(saved.source.uri).toBe('cloudflare-binding://ANALYTICS_SQL');
    await expect(captureSQL({ ...query, scope: { accountTag: account } }, { ANALYTICS_SQL: binding }, 'binding')).rejects.toThrow('supplies account scope');
    await expect(captureSQL({ ...query, time_range: { start: params.start } }, { ANALYTICS_SQL: binding }, 'binding')).rejects.toThrow('time predicates');
    // A saved HTTP recipe cannot silently rerun through a newly available binding.
    await expect(captureSQL(query, { ANALYTICS_SQL: binding }, 'http')).rejects.toThrow('not connected');
  });
});

test('SQL preserves relative windows and arbitrary parameter values without interpolation; invalid contracts fail before I/O', async () => {
  const query = {
    query: 'SELECT timestamp FROM logs.workersLogs WHERE timestamp >= NOW() - INTERVAL \'1\' HOUR AND scriptName = $script LIMIT 10',
    params: { script: "'; DROP TABLE users; --", another: null, numeric: 3, flag: true },
  };
  let calls = 0;
  await withFetch(async (_url, options) => {
    calls++;
    const body = JSON.parse(options?.body as string);
    expect(body.query).toBe(query.query);
    expect(body.params).toEqual(query.params);
    return Response.json(output);
  }, async () => {
    await captureSQL(query, env);
    await expect(captureSQL({ ...query, params: { invalid: {} } }, env)).rejects.toThrow();
    await expect(captureSQL({ ...query, scope: { accountTag: account, zoneTag: zone } }, env)).rejects.toThrow();
    await expect(captureSQL({ view: 'events', timeframe: { from: 1, to: 2 } }, env)).rejects.toThrow('unified SQL API');
    await expect(captureSQL(query, {})).rejects.toThrow('not connected');
  });
  expect(calls).toBe(1);
});

test('SQL errors remain actionable, non-JSON formats and oversized outputs fail, and no implicit retries occur', async () => {
  for (const [response, message] of [
    [new Response('Input was invalid: unknown column', { status: 422 }), 'HTTP 422): Input was invalid: unknown column'],
    [new Response('Too many queries', { status: 429, headers: { 'Retry-After': '3' } }), 'Retry-After: 3'],
    [Response.json({ errors: [{ message: 'Invalid token: test-credential' }] }, { status: 403 }), 'Invalid token: [redacted]'],
    [new Response('{"status":200}\n{"status":500}'), 'non-JSON result'],
    [Response.json({ data: [], rows: 0, extra: 'x'.repeat(1024 * 1024) }), '1 MiB capture limit'],
  ] as [Response, string][]) {
    let calls = 0;
    await withFetch(async () => { calls++; return response; }, async () => {
      await expect(captureSQL({ query: DEFAULT_SQL, params }, env)).rejects.toThrow(message);
    });
    expect(calls).toBe(1);
  }
  const binding = { query: async () => { throw Object.assign(new Error('Service unavailable'), { retryable: true }); } } as AnalyticsSQLBinding;
  await expect(captureSQL({ query: DEFAULT_SQL, params }, { ANALYTICS_SQL: binding })).rejects.toThrow('This failure is retryable');
});

test('dataset discovery preserves metadata and encodes the documented account, column, and custom-attribute options', async () => {
  const catalog = { datasets: [{
    name: 'events.httpRequests', title: 'HTTP requests', kind: { events: { sampling: 'adaptive' } },
    columns: [{ name: 'timestamp', data_type: 'DateTime' }],
  }] };
  let calls = 0;
  await withFetch(async (input, options) => {
    calls++;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(SQL_ENDPOINT + '/introspection');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      account_tag: account, dataset_name: 'events.httpRequests', include_columns: 'true',
      include_custom_attributes: 'true', include_wae: 'false', include_lex: 'true',
    });
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-credential');
    return Response.json(catalog);
  }, async () => {
    expect(await discoverDatasets({ dataset_name: 'events.httpRequests', include_columns: true, include_custom_attributes: true, include_wae: false }, env)).toEqual(catalog);
    await expect(discoverDatasets({ include_custom_attributes: true }, env)).rejects.toThrow();
    await expect(discoverDatasets({}, {})).rejects.toThrow('queries only');
  });
  expect(calls).toBe(1);
});

test('SQL editor and dataset browser use the room capability; SQL envelopes render rows while retaining statistics', async ({ request, page }) => {
  const created = await request.post('/api/rooms', { data: { title: 'SQL investigation', actor } });
  const room = await created.json();
  const base = '/api/rooms/' + room.id;
  const headers = { Authorization: 'Bearer ' + room.token };
  expect((await request.get(base + '/sources/cloudflare/datasets')).status()).toBe(401);
  expect((await request.get(base + '/sources/cloudflare/datasets?include_columns=maybe', { headers })).status()).toBe(400);
  await request.post(base + '/evidence', { headers, data: {
    title: 'SQL output from an external agent', source: { name: 'Cloudflare SQL via cf CLI' }, data: output, view: 'table', actor,
  } });
  await page.goto(room.url);
  await expect(page.getByRole('cell', { name: '125430', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SQL output from an external agent', exact: true }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.locator('.data-code')).toContainText('"rows_read": 250000');
  await page.getByRole('button', { name: 'Close evidence details' }).click();
  await page.route('**/sources/cloudflare/datasets?*', async route => {
    expect(route.request().headers().authorization).toBe('Bearer ' + room.token);
    const selected = new URL(route.request().url()).searchParams.get('dataset_name');
    await route.fulfill({ json: { datasets: [{ name: 'events.httpRequests', ...(selected ? { columns: [{ name: 'edgeResponseStatus', data_type: 'UInt16' }] } : {}) }] } });
  });
  await page.getByRole('button', { name: 'Query', exact: true }).click();
  await page.getByLabel('Data source', { exact: true }).selectOption('cloudflare');
  await expect(page.getByRole('textbox', { name: 'SQL query', exact: true })).toHaveValue(DEFAULT_SQL);
  await page.getByLabel('SQL parameters · JSON object or array').fill(JSON.stringify(params));
  await page.getByText('Explore datasets and columns', { exact: true }).click();
  await page.getByRole('button', { name: 'Load dataset catalog' }).click();
  await page.getByLabel('Dataset', { exact: true }).selectOption('events.httpRequests');
  await expect(page.locator('.sql-catalog .data-code')).toContainText('edgeResponseStatus');
  const posted = page.waitForRequest(req => req.url().endsWith(base + '/query') && req.method() === 'POST');
  await page.getByRole('button', { name: 'Run & capture' }).click();
  const payload = (await posted).postDataJSON();
  expect(payload.query).toEqual({ query: DEFAULT_SQL, params });
  expect(payload.view).toBe('table');
  expect(payload.source).toBe('cloudflare');
  await expect(page.getByRole('dialog').getByText('Cloudflare SQL is not connected.', { exact: false })).toBeVisible();
});
