import { sqlQuerySchema, datasetOptionsSchema, type SQLTransport, type DatasetOptions } from '../shared/sql';
import { boundedText } from './http';

export type CloudflareSQLEnv = {
  CF_OBSERVABILITY_ACCOUNT_ID?: string;
  CF_OBSERVABILITY_API_TOKEN?: string;
  ANALYTICS_SQL?: AnalyticsSQLBinding;
};
export const SQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/analytics/sql';
const LIMIT = 1024 * 1024;
export function sqlConnection(env: CloudflareSQLEnv) {
  return {
    binding: !!env.ANALYTICS_SQL,
    http: !!(env.CF_OBSERVABILITY_ACCOUNT_ID && env.CF_OBSERVABILITY_API_TOKEN),
  };
}
async function sqlResponse(response: Response, token: string): Promise<unknown> {
  const text = await boundedText(response, LIMIT);
  if (!response.ok) {
    let detail = text;
    try {
      const body = JSON.parse(text);
      detail = body.errors?.map((error: { message?: string }) => error.message).filter(Boolean).join('; ') || 'Request rejected.';
    } catch { /* SQL service errors are normally customer-safe plain text. */ }
    const retryAfter = response.headers.get('Retry-After');
    throw new Error('Cloudflare SQL (HTTP ' + response.status + '): ' +
      detail.replaceAll(token, '[redacted]').slice(0, 350) +
      (retryAfter ? ' Retry-After: ' + retryAfter : ''));
  }
  try { return JSON.parse(text); }
  catch { throw new Error('Cloudflare SQL returned a non-JSON result. Omit FORMAT or use FORMAT JSON with the HTTP connection.'); }
}
export async function captureSQL(input: Record<string, unknown>, env: CloudflareSQLEnv, requested?: SQLTransport) {
  if (typeof input.query !== 'string') throw new Error('Cloudflare now uses the unified SQL API. Supply query: { query: "SELECT ...", params: { ... } }.');
  const parsed = sqlQuerySchema.parse(input);
  const available = sqlConnection(env);
  const transport = requested ?? (available.binding && !parsed.scope && !parsed.time_range ? 'binding' : 'http');
  let query: typeof parsed = parsed;
  let data: unknown;
  let uri = SQL_ENDPOINT;
  if (transport === 'binding') {
    if (!env.ANALYTICS_SQL) throw new Error('The ANALYTICS_SQL Workers binding is not configured.');
    if (parsed.scope || parsed.time_range) throw new Error('The SQL binding supplies account scope and requires time predicates in SQL. Use the HTTP SQL connection for scope or time_range.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      data = await Promise.race([
        env.ANALYTICS_SQL.query(parsed),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Cloudflare SQL timed out after 15 seconds. Narrow the query.')), 15000); }),
      ]);
    } catch (error) {
      if (error instanceof Error && 'retryable' in error) {
        throw new Error('Cloudflare SQL binding: ' + error.message.slice(0, 350) +
          (error.retryable ? ' This failure is retryable.' : ' Correct the query or permissions before retrying.'));
      }
      throw error;
    } finally { clearTimeout(timer); }
    uri = 'cloudflare-binding://ANALYTICS_SQL';
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > LIMIT) throw new Error('Response exceeds the 1 MiB capture limit. Narrow the query.');
  } else {
    if (!available.http) throw new Error('Cloudflare SQL is not connected. Configure an account ID and Analytics Read token, or the ANALYTICS_SQL binding.');
    // Request-level scope is explicit in the archived recipe, including the configured default.
    query = sqlQuerySchema.parse({ ...parsed, scope: parsed.scope ?? { accountTag: env.CF_OBSERVABILITY_ACCOUNT_ID } });
    data = await sqlResponse(await fetch(SQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.CF_OBSERVABILITY_API_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(query), signal: AbortSignal.timeout(15000),
    }), env.CF_OBSERVABILITY_API_TOKEN!);
  }
  if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data) || !('rows' in data) || typeof data.rows !== 'number') {
    throw new Error('Cloudflare SQL returned an unexpected result. Use the default JSON response or FORMAT JSON over HTTP.');
  }
  return { query, data, transport, source: { name: 'Cloudflare O11y SQL', uri, collectedAt: new Date().toISOString() } };
}
export async function discoverDatasets(options: DatasetOptions, env: CloudflareSQLEnv) {
  const parsed = datasetOptionsSchema.parse(options);
  if (!sqlConnection(env).http) throw new Error('Dataset discovery requires an account ID and Analytics Read API token. The SQL binding currently exposes queries only.');
  const url = new URL(SQL_ENDPOINT + '/introspection');
  url.searchParams.set('account_tag', env.CF_OBSERVABILITY_ACCOUNT_ID!);
  for (const [key, value] of Object.entries(parsed)) if (value !== undefined) url.searchParams.set(key, String(value));
  return sqlResponse(await fetch(url, {
    headers: { Authorization: 'Bearer ' + env.CF_OBSERVABILITY_API_TOKEN, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  }), env.CF_OBSERVABILITY_API_TOKEN!);
}
