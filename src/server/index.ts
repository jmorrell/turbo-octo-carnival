import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import {
  actorSchema, querySchema, importSchema, DEMO_FROM, DEMO_TO,
  type Actor, type Artifact, type Branch, type Evidence, type RoomEvent, type RoomState,
} from '../shared/model';
import { boundedText, capture, deploymentData, retryData, type SourceEnv } from './sources';
import { drawingSvg, renderCustom, RETRY_RENDERER } from './renderers';

interface Env extends SourceEnv {
  ROOMS: DurableObjectNamespace<InvestigationRoom>;
  EVIDENCE: R2Bucket;
  ASSETS: Fetcher;
  RENDERERS: WorkerLoader;
  WORKSPACE_KEY?: string;
}
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function token(request: Request): string {
  return request.headers.get('Authorization')?.replace(/^Bearer /i, '') ??
    (request.headers.get('Sec-WebSocket-Protocol')?.split(',')[1]?.trim() ?? '');
}
async function body(request: Request): Promise<unknown> {
  const raw = await boundedText(new Response(request.body), 1024 * 1024);
  try { return JSON.parse(raw); } catch { throw new Error('Expected a JSON request body.'); }
}
function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return json({ error: 'Invalid input', details: error.issues }, 400);
  return json({ error: error instanceof Error ? error.message.slice(0, 500) : 'Request failed' }, 400);
}
const roomInput = z.object({
  title: z.string().trim().min(1).max(160).default('Untitled investigation'),
  sample: z.boolean().default(false),
  actor: actorSchema.default({ name: 'You', harness: 'human' }),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, version: '0.1.0' });
      if (url.pathname === '/api/sources') return json({
        sources: [
          { id: 'demo-telemetry', name: 'Telemetry fixture', ready: true, description: 'Synthetic checkout incident · 03 Oct 2026, 10:00–11:00 UTC' },
          { id: 'cloudflare', name: 'Cloudflare O11y', ready: !!(env.CF_OBSERVABILITY_ACCOUNT_ID && env.CF_OBSERVABILITY_API_TOKEN), description: 'Native Workers telemetry queries' },
          { id: 'import', name: 'Anything your agent can reach', ready: true, description: 'JSON, tool output, scripts, files, and optional rerun instructions' },
        ],
      });
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (env.WORKSPACE_KEY ? await hash(token(request)) !== await hash(env.WORKSPACE_KEY) : !local) {
          return json({ error: 'Creating a hosted investigation requires the workspace key. Existing invite links still work.' }, 401);
        }
        const input = roomInput.parse(await body(request));
        const id = uid(), key = uid().replaceAll('-', '') + uid().replaceAll('-', '');
        const stub = env.ROOMS.get(env.ROOMS.idFromName(id));
        const response = await stub.fetch('https://room.internal/_init', {
          method: 'POST', body: JSON.stringify({ ...input, id, keyHash: await hash(key) }),
        });
        if (!response.ok) return response;
        return json({ id, token: key, url: '/r/' + id + '#key=' + key }, 201);
      }
      const match = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})(\/.*)?$/);
      if (match) {
        const path = match[2] ?? '/';
        // Initialization is reachable only through the trusted creation path above.
        if (path.startsWith('/_')) return json({ error: 'Not found' }, 404);
        url.pathname = path;
        return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(new Request(url, request));
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      return response;
    } catch (error) { return errorResponse(error); }
  },
} satisfies ExportedHandler<Env>;

type Row = { body: string };
export class InvestigationRoom extends DurableObject<Env> {
  private pendingWrites: (() => void)[] | null = null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, body TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, body TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS operations (key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL);',
    );
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  private get(key: string): string | undefined {
    return this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value;
  }
  private set(key: string, value: string) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta VALUES (?, ?)', key, value); }
  private rows<T>(table: 'evidence' | 'branches'): T[] {
    return this.ctx.storage.sql.exec<Row>('SELECT body FROM ' + table + ' ORDER BY rowid').toArray().map(r => JSON.parse(r.body));
  }
  private record(id: string): Evidence {
    const row = this.ctx.storage.sql.exec<Row>('SELECT body FROM evidence WHERE id = ?', id).toArray()[0];
    if (!row) throw new Error('Evidence does not exist in this investigation.');
    return JSON.parse(row.body);
  }
  private branch(id: string): Branch {
    const branch = this.rows<Branch>('branches').find(b => b.id === id);
    if (!branch) throw new Error('Unknown investigation thread.');
    return branch;
  }
  private validateParents(ids: string[]) { for (const id of ids) this.record(id); }
  private stage(write: () => void) {
    if (this.pendingWrites) this.pendingWrites.push(write); else write();
  }
  private event(type: string, actor: Actor, targetId?: string) {
    this.ctx.storage.sql.exec('INSERT INTO events(body) VALUES (?)', JSON.stringify({ type, actor, targetId, at: now() }));
  }
  private broadcast() {
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify({ type: 'changed', cursor: this.cursor() })); } catch { /* disconnected */ }
    }
  }
  private cursor(): number {
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(MAX(seq), 0) AS n FROM events').one().n;
  }
  private events(after = 0): RoomEvent[] {
    return this.ctx.storage.sql.exec<{ seq: number; body: string }>(
      'SELECT seq, body FROM events WHERE seq > ? ORDER BY seq LIMIT 200', after,
    ).toArray().map(r => ({ ...JSON.parse(r.body), seq: r.seq }));
  }
  private state(): RoomState & { peers: Actor[]; sample: boolean } {
    const cursor = this.cursor();
    return {
      id: this.get('id')!, title: this.get('title')!, createdAt: this.get('createdAt')!,
      branches: this.rows<Branch>('branches'), evidence: this.rows<Evidence>('evidence'),
      events: this.events(Math.max(0, cursor - 40)), cursor,
      peers: this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()?.actor).filter(Boolean),
      sample: this.get('sample') === 'true',
    };
  }
  private async artifact(id: string): Promise<Artifact> {
    this.record(id);
    const saved = await this.env.EVIDENCE.get(this.get('id') + '/' + id + '.json');
    if (!saved) throw new Error('The archived artifact is missing.');
    return saved.json<Artifact>();
  }
  private async save(input: Omit<Evidence, 'id' | 'sha256' | 'bytes' | 'createdAt' | 'rendererVersion'>, data: unknown, fallbackSvg?: string): Promise<Evidence> {
    this.branch(input.branchId);
    this.validateParents(input.parentIds);
    const text = JSON.stringify(data);
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > 1024 * 1024) throw new Error('Evidence exceeds the 1 MiB limit.');
    if (this.rows('evidence').length >= 1000) throw new Error('This PoC supports up to 1,000 artifacts per investigation.');
    const evidence: Evidence = { ...input, id: uid(), createdAt: now(), sha256: await hash(text), bytes, rendererVersion: 'fieldwork/1' };
    // Publish metadata only after the immutable R2 archive exists.
    await this.env.EVIDENCE.put(this.get('id') + '/' + evidence.id + '.json',
      JSON.stringify({ ...evidence, data, fallbackSvg }), { httpMetadata: { contentType: 'application/json' } });
    this.stage(() => {
      this.ctx.storage.sql.exec('INSERT INTO evidence VALUES (?, ?)', evidence.id, JSON.stringify(evidence));
      this.event(input.kind === 'finding' ? 'published a finding' : 'added evidence', input.actor, evidence.id);
    });
    return evidence;
  }
  private async query(input: z.infer<typeof querySchema>): Promise<Evidence> {
    this.branch(input.branchId);
    this.validateParents(input.parentIds);
    const result = await capture(input.source, input.query, this.env);
    return this.save({
      title: input.title, description: '', branchId: input.branchId, parentIds: input.parentIds,
      actor: input.actor, source: result.source, kind: 'observation', origin: 'captured', view: input.view,
      recipe: { source: input.source, query: result.query },
    }, result.data);
  }
  private async imported(input: z.infer<typeof importSchema>): Promise<Evidence> {
    return this.save({
      title: input.title, description: input.description, branchId: input.branchId,
      parentIds: input.parentIds, actor: input.actor, source: input.source,
      kind: 'observation', origin: 'imported', view: input.view,
      recipe: input.recipe ? { source: 'external', instructions: input.recipe } : undefined,
    }, input.data);
  }
  private async component(input: z.infer<typeof componentInput>, previousId?: string): Promise<Evidence> {
    this.branch(input.branchId);
    this.validateParents(input.inputIds);
    const artifacts = await Promise.all(input.inputIds.map(id => this.artifact(id)));
    const codeHash = await hash(input.code);
    const drawing = await renderCustom(this.env.RENDERERS, input.code, artifacts, codeHash);
    return this.save({
      title: input.title, description: input.description, branchId: input.branchId,
      parentIds: previousId ? [...input.inputIds, previousId] : input.inputIds, actor: input.actor,
      source: { name: 'Custom renderer', collectedAt: now() },
      kind: 'observation', origin: 'derived', view: 'custom',
      component: { code: input.code, hash: codeHash, inputIds: input.inputIds },
    }, drawing, drawingSvg(drawing));
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path === '/_init' && request.method === 'POST') {
        return this.ctx.blockConcurrencyWhile(async () => {
          if (this.get('id')) return json({ error: 'Already initialized' }, 409);
          const input = await request.json<{ id: string; keyHash: string; title: string; sample: boolean; actor: Actor }>();
          this.set('id', input.id); this.set('keyHash', input.keyHash);
          this.set('title', input.title); this.set('createdAt', now()); this.set('sample', String(input.sample));
          this.ctx.storage.sql.exec('INSERT INTO branches VALUES (?, ?)', 'main', JSON.stringify({
            id: 'main', title: 'Shared investigation', inheritedIds: [], actor: input.actor, createdAt: now(),
          } satisfies Branch));
          this.event('opened the investigation', input.actor, 'main');
          try { if (input.sample) await this.seed(); }
          catch (error) { return errorResponse(error); }
          return json({ ok: true });
        });
      }
      if (!this.get('id') || await hash(token(request)) !== this.get('keyHash')) return json({ error: 'This investigation requires a valid invite key.' }, 401);
      if (path === '/live' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        const { 0: client, 1: server } = new WebSocketPair();
        const actor = actorSchema.parse({ name: url.searchParams.get('name') || 'Viewer', harness: url.searchParams.get('harness') || 'human' });
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ actor });
        this.broadcast();
        return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'fieldwork' } });
      }
      if (request.method === 'GET') {
        if (path === '/' || path === '/state') return json(this.state());
        if (path === '/changes') {
          const after = Math.max(0, Number(url.searchParams.get('after') ?? 0));
          if (!Number.isSafeInteger(after)) throw new Error('Invalid change cursor.');
          const events = this.events(after), cursor = events.at(-1)?.seq ?? after;
          return json({ events, cursor, hasMore: cursor < this.cursor() });
        }
        const artifactMatch = path.match(/^\/evidence\/([a-f0-9-]{36})$/);
        if (artifactMatch) return json(await this.artifact(artifactMatch[1]));
        if (path === '/export') return json({
          format: 'fieldwork-investigation', version: 1, exportedAt: now(), room: this.state(),
          artifacts: await Promise.all(this.rows<Evidence>('evidence').map(e => this.artifact(e.id))),
        });
      }
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
      const raw = await body(request);
      const operation = request.headers.get('Idempotency-Key');
      if (operation && !/^[a-zA-Z0-9_-]{1,100}$/.test(operation)) throw new Error('Invalid idempotency key.');
      const fingerprint = await hash(path + JSON.stringify(raw));
      // Serialize mutations; bounded query timeouts stay below the DO's 30s gate limit.
      return await this.ctx.blockConcurrencyWhile(async () => {
        try {
          if (operation) {
            const previous = this.ctx.storage.sql.exec<{ request_hash: string; response: string }>(
              'SELECT request_hash, response FROM operations WHERE key = ?', operation,
            ).toArray()[0];
            if (previous) return previous.request_hash === fingerprint
              ? json(JSON.parse(previous.response))
              : json({ error: 'This idempotency key was used for a different request.' }, 409);
          }
          this.pendingWrites = [];
          const result = await this.mutate(path, raw);
          const writes = this.pendingWrites;
          this.ctx.storage.transactionSync(() => {
            for (const write of writes) write();
            if (operation) this.ctx.storage.sql.exec('INSERT INTO operations VALUES (?, ?, ?)', operation, fingerprint, JSON.stringify(result));
          });
          this.pendingWrites = null;
          this.broadcast();
          return json(result, 201);
        } catch (error) { this.pendingWrites = null; return errorResponse(error); }
      });
    } catch (error) { return errorResponse(error); }
  }
  private async mutate(path: string, raw: unknown): Promise<unknown> {
    if (path === '/query') return this.query(querySchema.parse(raw));
    if (path === '/evidence') return this.imported(importSchema.parse(raw));
    if (path === '/components') return this.component(componentInput.parse(raw));
    if (path === '/findings') {
      const input = z.object({
        title: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(12000),
        branchId: z.string().default('main'), parentIds: z.array(z.string()).max(20).default([]),
        status: z.enum(['open', 'supported', 'disproven']).default('open'), actor: actorSchema,
      }).parse(raw);
      if (input.status === 'supported' && !input.parentIds.length) throw new Error('A supported finding must cite evidence.');
      return this.save({
        title: input.title, description: input.text, branchId: input.branchId, parentIds: input.parentIds,
        actor: input.actor, kind: 'finding', origin: 'inference', view: 'json',
        source: { name: 'Investigator interpretation' }, status: input.status,
      }, { text: input.text, status: input.status });
    }
    if (path === '/branches') {
      const input = z.object({
        title: z.string().trim().min(1).max(80), fromBranchId: z.string().default('main'),
        anchorId: z.string().optional(), actor: actorSchema,
      }).parse(raw);
      const parent = this.branch(input.fromBranchId);
      const ids = [...parent.inheritedIds, ...this.rows<Evidence>('evidence').filter(e => e.branchId === parent.id).map(e => e.id)];
      if (input.anchorId && !ids.includes(input.anchorId)) throw new Error('Fork evidence must belong to the selected thread.');
      const branch: Branch = {
        id: uid(), title: input.title, parentId: parent.id, anchorId: input.anchorId, actor: input.actor,
        createdAt: now(), inheritedIds: input.anchorId ? ids.slice(0, ids.indexOf(input.anchorId) + 1) : ids,
      };
      this.stage(() => {
        this.ctx.storage.sql.exec('INSERT INTO branches VALUES (?, ?)', branch.id, JSON.stringify(branch));
        this.event('forked a thread', input.actor, branch.id);
      });
      return branch;
    }
    const rerun = path.match(/^\/evidence\/([a-f0-9-]{36})\/rerun$/);
    if (rerun) {
      const input = z.object({ actor: actorSchema, branchId: z.string().default('main') }).parse(raw);
      const evidence = this.record(rerun[1]);
      if (evidence.component) return this.component({
        ...input, title: evidence.title.slice(0, 147) + ' · new render', description: evidence.description,
        code: evidence.component.code, inputIds: evidence.component.inputIds,
      }, evidence.id);
      if (!evidence.recipe?.query || !['demo-telemetry', 'cloudflare'].includes(evidence.recipe.source)) {
        throw new Error('This artifact has no executable adapter recipe. An agent can use its instructions and publish a new result.');
      }
      return this.query(querySchema.parse({
        ...input, title: evidence.title.slice(0, 152) + ' · rerun', source: evidence.recipe.source,
        query: evidence.recipe.query, view: evidence.view, parentIds: [evidence.id],
      }));
    }
    throw new Error('Unknown operation.');
  }
  private async seed() {
    const actor = { name: 'Mara', harness: 'Codex' };
    const common = { source: 'demo-telemetry' as const, branchId: 'main', parentIds: [], actor };
    const latency = await this.query({ ...common, title: 'Latency diverges in eu-west', query: { metric: 'latency', from: DEMO_FROM, to: DEMO_TO }, view: 'line' });
    const heatmap = await this.query({ ...common, title: 'A second latency band appears', query: { metric: 'heatmap', from: DEMO_FROM, to: DEMO_TO }, view: 'heatmap' });
    const deploys = await this.imported(importSchema.parse({
      title: 'The rollout reached eu-west at 10:24', description: 'Imported from a deployment tool. Fixture data; the origin is supplied by the investigator.',
      source: { name: 'Deployment events', uri: 'fixture://deployments/v1' }, actor: { name: 'Eli', harness: 'pi' },
      data: deploymentData, view: 'table', recipe: 'Fetch deployment events for checkout-api, 2026-10-03 10:00–11:00 UTC.',
    }));
    const retry = await this.imported(importSchema.parse({
      title: 'One checkout spends 400 ms waiting to retry', description: 'A representative request, assembled by an external script. Synthetic example.',
      source: { name: 'Trace analysis script', uri: 'fixture://trace-analysis/v1' }, actor,
      data: retryData, view: 'table', parentIds: [latency.id], recipe: 'Analyze spans for a slow checkout and emit stages with start, duration, and type.',
    }));
    await this.component({
      title: 'Where the time goes', description: 'Agent-authored view over the imported trace stages. Amber marks waiting, green marks work.',
      branchId: 'main', actor, inputIds: [retry.id], code: RETRY_RENDERER,
    });
    await this.mutate('/findings', {
      title: 'Synchronous retries are a candidate cause',
      text: 'The new latency band begins alongside the eu-west rollout. A sample request spends 400 ms in retry backoff. Compare a wider set of traces, then test whether disabling the retry change restores latency.',
      branchId: 'main', parentIds: [latency.id, heatmap.id, deploys.id, retry.id], status: 'open', actor,
    });
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === 'resync') socket.send(JSON.stringify({ type: 'changed', cursor: this.cursor() }));
  }
  webSocketClose(socket: WebSocket, code: number) { socket.close(code); this.broadcast(); }
  webSocketError(socket: WebSocket) { socket.close(1011); }
}

const componentInput = z.object({
  title: z.string().trim().min(1).max(160), description: z.string().max(4000).default(''),
  branchId: z.string().default('main'), actor: actorSchema,
  inputIds: z.array(z.string()).min(1).max(8),
  code: z.string().min(1).max(20000),
});
