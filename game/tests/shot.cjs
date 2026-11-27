// node tests/shot.cjs <url> <out.png> [width] [height] [waitMs] [dpr]
const { chromium } = require('playwright');
(async () => {
  const [url, out, w = 891, h = 411, wait = 1500, dpr = 2] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console.' + m.type() + ']', m.text().slice(0, 400)); });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)));
  await page.goto(url);
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: out });
  await browser.close();
})();
