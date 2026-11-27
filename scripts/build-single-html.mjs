// Packs game/dist into ONE self-contained HTML file (JS, CSS, fonts and sounds inline).
// Used for the browser preview that can be shared as a single page.
//   node scripts/build-single-html.mjs [out.html]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'game', 'dist');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const out = resolve(outArg ?? join(root, 'release', 'web', 'wolfgangs-tueftelwerkstatt.html'));
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const b64 = (file) => readFileSync(file).toString('base64');
const cssFile = html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1];
const jsFile = html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1];
let css = readFileSync(join(dist, cssFile), 'utf8');
// keep only woff2 and inline it
css = css.replace(/url\(\.?\/?(?:assets\/)?([^)]+?\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${b64(join(dist, 'assets', f.replace(/^.*\//, '')))})`);
css = css.replace(/,\s*url\([^)]+\.woff\)\s*format\(["']woff["']\)/g, '');
const js = readFileSync(join(dist, jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');
const audio = {};
for (const f of readdirSync(join(dist, 'audio'))) if (f.endsWith('.ogg')) audio[f.replace('.ogg', '')] = b64(join(dist, 'audio', f));

html = html
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .replace('</body>', () => `<script>window.__AUDIO_B64=${JSON.stringify(audio)};</script>\n<script type="module">${js}</script>\n</body>`);
// --fragment: no doctype/html/head/body wrapper (for hosts that wrap the page themselves)
if (process.argv.includes('--fragment')) {
  const title = html.match(/<title>[^<]*<\/title>/)[0];
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  html = `${title}\n<style>:root{color-scheme:dark}</style>\n${style}\n${body}`;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1048576).toFixed(2)} MB)`);
