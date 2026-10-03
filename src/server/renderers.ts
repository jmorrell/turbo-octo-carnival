import { drawingSchema, type Drawing } from '../shared/model';
import { boundedText } from './sources';

// Server-authored allowlist. No URLs, CSS, raw HTML, event handlers, or foreignObject.
const attributes = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy',
  'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'opacity',
  'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight',
  'text-anchor', 'dominant-baseline', 'transform', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'preserveAspectRatio',
]);
export function validateDrawing(value: unknown): Drawing {
  let count = 0;
  function check(node: unknown, depth: number): void {
    if (++count > 2000 || depth > 24) throw new Error('Drawing exceeds the node/depth limit.');
    if (!node || typeof node !== 'object') throw new Error('Expected a drawing node.');
    const n = node as Drawing;
    if (n.attrs) for (const [key, val] of Object.entries(n.attrs)) {
      if (!attributes.has(key) || /url\s*\(|javascript:|data:|https?:|[<>]/i.test(String(val))) {
        throw new Error('Unsafe drawing attribute: ' + key);
      }
    }
    if (n.children) {
      if (!Array.isArray(n.children)) throw new Error('Invalid drawing children.');
      for (const child of n.children) check(child, depth + 1);
    }
  }
  // Bound recursion before schema parsing.
  check(value, 0);
  const drawing = drawingSchema.parse(value);
  if (drawing.tag !== 'svg') throw new Error('The custom renderer must return an svg root.');
  return drawing;
}

export function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
export function drawingSvg(node: Drawing): string {
  return '<' + node.tag + (node.tag === 'svg' ? ' xmlns="http://www.w3.org/2000/svg"' + (!node.attrs?.['font-family'] ? ' font-family="system-ui, sans-serif"' : '') : '') +
    Object.entries(node.attrs ?? {}).map(([k, v]) => ' ' + k + '="' + escapeXml(v) + '"').join('') + '>' +
    escapeXml(node.text ?? '') + (node.children ?? []).map(drawingSvg).join('') + '</' + node.tag + '>';
}
export async function renderCustom(loader: WorkerLoader, code: string, inputs: unknown[], hash: string): Promise<Drawing> {
  const worker = loader.get('renderer-' + hash, async () => ({
    compatibilityDate: '2026-09-01',
    mainModule: 'renderer.js',
    modules: {
      'renderer.js': 'const render = (' + code + ');\nexport default { async fetch(request) {' +
        'const inputs = await request.json(); return Response.json(await render(inputs)); } };',
    },
    globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 0 },
    env: {},
  }));
  const response = await worker.getEntrypoint().fetch('https://renderer.internal/', {
    method: 'POST', body: JSON.stringify(inputs), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Custom renderer failed. Check the function and its input data.');
  return validateDrawing(JSON.parse(await boundedText(response, 256 * 1024)));
}

export const RETRY_RENDERER = '(inputs) => {\n' +
  '  const rows = inputs[0].data;\n' +
  '  const children = [];\n' +
  '  rows.forEach((row, i) => {\n' +
  '    const y = 24 + i * 31;\n' +
  '    children.push({ tag: "text", attrs: { x: 0, y: y + 14, fill: "#9eafb3", "font-size": 12 }, text: row.stage });\n' +
  '    children.push({ tag: "rect", attrs: { x: 188 + row.start * .49, y, width: Math.max(5, row.duration * .49), height: 21, rx: 4, fill: row.type === "wait" ? "#d7a66c" : "#81cbb4" } });\n' +
  '    children.push({ tag: "text", attrs: { x: 194 + (row.start + row.duration) * .49, y: y + 14, fill: "#b7c3c6", "font-size": 10 }, text: row.duration + " ms" });\n' +
  '  });\n' +
  '  return { tag: "svg", attrs: { viewBox: "0 0 640 265", width: "100%", height: "100%" }, children };\n' +
  '}';
