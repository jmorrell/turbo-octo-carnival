// Optional documentation tooling; see docs/rendering.md for temporary dependencies.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
if (!process.argv[2]) throw new Error('Usage: node scripts/render-overview.mjs /path/to/temporary/dependencies');
const vendor = resolve(process.argv[2], 'node_modules');
const { Marked } = await import(pathToFileURL(resolve(vendor, 'marked/lib/marked.esm.js')));
const source = await readFile(resolve(docs, 'overview.md'), 'utf8');
const template = await readFile(resolve(docs, 'overview-template.html'), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const repository = 'https://github.com/jmorrell/turbo-octo-carnival';
const toc = [];
function link(href) {
  if (/^(?:[a-z]+:|#)/i.test(href)) return href;
  const [name, fragment] = href.split('#');
  if (name === 'overview.html') return '#top';
  if (name === 'overview.md' && fragment) return '#' + fragment;
  const path = resolve(docs, name);
  const kind = statSync(path).isDirectory() ? 'tree' : 'blob';
  return repository + '/' + kind + '/main/' + relative(root, path).split(sep).join('/') + (fragment ? '#' + fragment : '');
}
const marked = new Marked({
  renderer: {
    heading({ depth, tokens }) {
      const html = this.parser.parseInline(tokens);
      const title = html.replace(/<[^>]*>/g, '');
      const id = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      if (depth === 2) toc.push({ id, title });
      return '<h' + depth + ' id="' + id + '">' + html + '</h' + depth + '>\n';
    },
    link({ href, tokens }) {
      return '<a href="' + escape(link(href)) + '">' + this.parser.parseInline(tokens) + '</a>';
    },
  },
});
const tokens = marked.lexer(source);
const diagrams = tokens.filter(token => token.type === 'code' && token.lang === 'mermaid');

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      return;
    }
    const path = resolve(vendor, '.' + pathname);
    if (!path.startsWith(vendor + sep)) throw new Error('Outside documentation dependencies');
    const content = await readFile(path);
    response.writeHead(200, { 'Content-Type': /\.m?js$/.test(path) ? 'text/javascript' : 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.evaluate(async () => {
    window.mermaid = (await import('/mermaid/dist/mermaid.esm.min.mjs')).default;
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Arial, sans-serif',
      themeVariables: {
        fontSize: '17px',
        primaryColor: '#e9f4f0',
        primaryTextColor: '#173e36',
        primaryBorderColor: '#609387',
        secondaryColor: '#eef2f8',
        tertiaryColor: '#fbf7ef',
        lineColor: '#627775',
        textColor: '#173e36',
        clusterBkg: '#f5f8f7',
        clusterBorder: '#afc8bf',
        edgeLabelBackground: '#ffffff',
        actorBkg: '#e9f4f0',
        actorBorder: '#609387',
        actorTextColor: '#173e36',
        signalColor: '#496460',
        signalTextColor: '#173e36',
        noteBkgColor: '#fff3d9',
        noteTextColor: '#634b21',
      },
      flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis', padding: 14, nodeSpacing: 30, rankSpacing: 40, wrappingWidth: 240 },
      sequence: { useMaxWidth: false, mirrorActors: false, wrap: true, actorMargin: 34, messageMargin: 32 },
    });
  });
  for (const [index, token] of diagrams.entries()) {
    const title = token.text.match(/accTitle:\s*(.+)/)?.[1] || 'Architecture diagram ' + (index + 1);
    const svg = await page.evaluate(async ({ index, definition }) => {
      const result = await window.mermaid.render('fieldwork-diagram-' + index, definition);
      return result.svg;
    }, { index, definition: token.text });
    if (!svg.includes('<svg') || /Syntax error in text/.test(svg)) throw new Error('Invalid diagram: ' + title);
    token.type = 'html';
    token.text = '<figure class="diagram" data-diagram="' + (index + 1) + '" data-title="' + escape(title) +
      '"><div class="diagram-surface">' + svg + '</div><figcaption><span>' + escape(title) +
      '</span><span class="diagram-actions"><button type="button" data-enlarge>Enlarge</button>' +
      '<button type="button" data-save>Save SVG</button></span></figcaption></figure>\n';
    console.log('Rendered ' + (index + 1) + '/' + diagrams.length + ': ' + title);
  }
} finally {
  await browser?.close();
  await new Promise(accept => server.close(accept));
}
const body = marked.parser(tokens).replaceAll('<table>', '<div class="table-scroll"><table>').replaceAll('</table>', '</table></div>');
const contents = toc.map(({ id, title }) => '<a href="#' + id + '">' + escape(title) + '</a>').join('\n');
await writeFile(resolve(docs, 'overview.html'), template.replace('@@CONTENTS@@', () => contents).replace('@@BODY@@', () => body));
console.log('Wrote docs/overview.html with ' + diagrams.length + ' inline diagrams.');
