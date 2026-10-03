import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
try { await access('dist/index.html'); }
catch { await writeFile('dist/index.html', 'Use the development UI at http://localhost:5173'); }
const children = [
  spawn('node_modules/.bin/wrangler', ['dev', '--port', '8787', '--ip', '127.0.0.1'], {
    stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  }),
  spawn('node_modules/.bin/vite', [], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 200).unref();
}
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
