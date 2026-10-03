import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { call, attributed, connection } from './client.mjs';

const server = new McpServer({ name: 'fieldwork', version: '0.1.0' }, {
  instructions: 'Fieldwork is a shared investigation workspace. Read its state and incremental changes. Use your existing tools freely; publish useful results with known provenance. Cite evidence IDs in findings. Imported origins are self-reported. Native queries capture their request and output together. Reruns make new revisions. Never include the room key in artifacts.',
});
function register(name, description, inputSchema, fn, readOnly = false) {
  server.registerTool(name, {
    description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: name === 'run_query' },
  }, async args => {
    try {
      const result = await fn(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}
register('get_investigation', 'Read the room, branches, findings, and artifact metadata. Fetch individual artifacts for full data.', {}, () => call(), true);
register('get_changes', 'Read events since a cursor. Continue while hasMore is true; store the returned cursor for your next turn.', { after: z.number().int().min(0).default(0) }, ({ after }) => call('/changes?after=' + after), true);
register('get_evidence', 'Read an immutable artifact, including its saved data, known provenance, recipe, and component code.', { id: z.string() }, ({ id }) => call('/evidence/' + encodeURIComponent(id)), true);
register('list_sources', 'List source adapters. Imported evidence can come from any external tool, without an adapter.', {}, () => call('/sources', undefined, { global: true }), true);
const branchId = z.string().optional();
register('run_query', 'Capture a native source query and its output. The demo has latency, heatmap, errors metrics for 2026-10-03 10:00–11:00 UTC. Cloudflare requires server configuration.', {
  title: z.string(), source: z.enum(['demo-telemetry', 'cloudflare']),
  query: z.record(z.string(), z.unknown()), view: z.enum(['line', 'heatmap', 'table', 'json']).default('json'),
  parentIds: z.array(z.string()).default([]), branchId,
}, args => call('/query', attributed({ ...args, branchId: args.branchId || connection().branchId })));
register('publish_evidence', 'Publish output from any tool. Preserve the actual data; identify known sources honestly. Recipe is optional and is never executed on import.', {
  title: z.string(), description: z.string().optional(),
  source: z.object({ name: z.string(), uri: z.string().optional(), collectedAt: z.string().optional() }),
  data: z.unknown(), recipe: z.string().optional(),
  view: z.enum(['line', 'heatmap', 'table', 'json']).default('json'),
  parentIds: z.array(z.string()).default([]), branchId,
}, args => call('/evidence', attributed({ ...args, branchId: args.branchId || connection().branchId })));
register('publish_finding', 'Publish a hypothesis or conclusion citing evidence IDs. A supported finding must cite at least one artifact.', {
  title: z.string(), text: z.string(), parentIds: z.array(z.string()), status: z.enum(['open', 'supported', 'disproven']).default('open'), branchId,
}, args => call('/findings', attributed({ ...args, branchId: args.branchId || connection().branchId })));
register('fork_thread', 'Create an independent investigation thread. It inherits a frozen list of evidence IDs, optionally only through the anchor.', {
  title: z.string(), fromBranchId: z.string().optional(), anchorId: z.string().optional(),
}, args => call('/branches', { ...args, fromBranchId: args.fromBranchId || connection().branchId, actor: connection().actor }));
register('publish_component', 'Run a JavaScript function over saved artifacts in a network-disabled Dynamic Worker. inputs is an array of full artifacts. Return {tag:"svg",attrs:{viewBox:"0 0 640 300"},children:[...]}. Allowed tags: svg,g,rect,circle,ellipse,line,polyline,polygon,path,text,tspan,title,desc. No URLs, CSS, event handlers, or raw HTML. 50 ms CPU limit. Both code and validated output are archived.', {
  title: z.string(), description: z.string().optional(), inputIds: z.array(z.string()).min(1).max(8), code: z.string(), branchId,
}, args => call('/components', attributed({ ...args, branchId: args.branchId || connection().branchId })));
register('rerun_evidence', 'Rerun an adapter query or custom renderer as a new immutable revision. External instructions must be executed with your own tools.', {
  id: z.string(), branchId,
}, args => call('/evidence/' + encodeURIComponent(args.id) + '/rerun', attributed({ branchId: args.branchId || connection().branchId })));

await server.connect(new StdioServerTransport());
