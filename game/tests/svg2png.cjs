// Renders tests/out/level-N.svg (+ -empty) side by side into tests/out/level-N.png
const { chromium } = require('playwright');
const { readFileSync, existsSync } = require('node:fs');
(async () => {
const ids = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1930, height: 545 }, deviceScaleFactor: 1 });
for (const id of ids) {
  const a = `tests/out/level-${id}.svg`, b = `tests/out/level-${id}-empty.svg`;
  if (!existsSync(a)) continue;
  await page.setContent(`<body style="margin:0;display:flex;gap:10px;background:#fff">${readFileSync(a, 'utf8')}${existsSync(b) ? readFileSync(b, 'utf8') : ''}</body>`);
  await page.screenshot({ path: `tests/out/level-${id}.png` });
}
await browser.close();
})();
