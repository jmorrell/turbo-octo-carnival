#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { call, attributed, connection } from './client.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' }, code: { type: 'string' }, input: { type: 'string' },
    title: { type: 'string' }, after: { type: 'string' }, output: { type: 'string' },
    sample: { type: 'boolean' }, 'idempotency-key': { type: 'string' },
    'custom-attributes': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command = 'help', id] = positionals;
const usage = [
  'Fieldwork — publish evidence from any agent or tool',
  '',
  'Connection: FIELDWORK_URL, FIELDWORK_ROOM, FIELDWORK_KEY',
  'Identity:   FIELDWORK_ACTOR, FIELDWORK_HARNESS, FIELDWORK_BRANCH',
  '',
  'create --title "Investigation" [--sample]    Create a room (returns its invite key)',
  'state                                      Read the room, threads, and evidence metadata',
  'changes --after 0                          Read incremental changes',
  'get <evidence-id>                           Read an immutable saved artifact',
  'query --file query.json                     Execute a source adapter and capture its output',
  'publish --file artifact.json                Import evidence from any tool',
  'finding --file finding.json                 Publish a conclusion with evidence citations',
  'fork --title "Another lead" [evidence-id]    Branch from the current thread',
  'component --code render.js --input <id>      Run an isolated custom renderer',
  'rerun <evidence-id>                         Produce a new revision',
  'sources                                    List configured adapters',
  'datasets [name] [--custom-attributes]       Discover Cloudflare SQL datasets and columns',
  'export --output investigation.json          Export metadata, saved data, and component code',
  '',
  'Writes accept --idempotency-key KEY. New writes get a random key by default.',
  'A renderer function receives an array of full input artifacts and returns a Drawing.',
].join('\n');
try {
  if (values.help || command === 'help') { console.log(usage); process.exit(0); }
  const payload = values.file ? JSON.parse(await readFile(values.file, 'utf8')) : {};
  const options = { idempotencyKey: values['idempotency-key'] };
  let result;
  switch (command) {
    case 'create':
      result = await call('/rooms', { title: values.title || 'New investigation', sample: !!values.sample, actor: connection().actor }, { ...options, global: true }); break;
    case 'state': result = await call(); break;
    case 'changes': result = await call('/changes?after=' + encodeURIComponent(values.after || '0')); break;
    case 'get': if (!id) throw new Error('Supply an evidence ID.'); result = await call('/evidence/' + encodeURIComponent(id)); break;
    case 'sources': result = await call('/sources', undefined, { global: true }); break;
    case 'datasets': {
      const params = new URLSearchParams();
      if (id) { params.set('dataset_name', id); params.set('include_columns', 'true'); }
      if (values['custom-attributes']) params.set('include_custom_attributes', 'true');
      result = await call('/sources/cloudflare/datasets?' + params); break;
    }
    case 'query': result = await call('/query', attributed(payload), options); break;
    case 'publish': result = await call('/evidence', attributed(payload), options); break;
    case 'finding': result = await call('/findings', attributed(payload), options); break;
    case 'fork': result = await call('/branches', { title: values.title || 'Another lead', fromBranchId: connection().branchId, anchorId: id, actor: connection().actor }, options); break;
    case 'component':
      if (values.code) payload.code = await readFile(values.code, 'utf8');
      if (values.input) payload.inputIds = values.input.split(',');
      result = await call('/components', attributed({ title: values.title || 'Custom view', ...payload }), options); break;
    case 'rerun':
      if (!id) throw new Error('Supply an evidence ID.');
      result = await call('/evidence/' + encodeURIComponent(id) + '/rerun', attributed(), options); break;
    case 'export': result = await call('/export'); break;
    default: throw new Error('Unknown command. Run with --help.');
  }
  const text = JSON.stringify(result, null, 2) + '\n';
  if (values.output) { await writeFile(values.output, text); console.log('Saved ' + values.output); }
  else process.stdout.write(text);
} catch (error) {
  process.stderr.write('Fieldwork: ' + error.message + '\n');
  process.exitCode = 1;
}
