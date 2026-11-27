// Scripted play-through helper.  node tests/drive.cjs <script.js> [url]
// The script file exports async (page, shot, h) => {...}
const { chromium } = require('playwright');
const path = require('node:path');
(async () => {
  const script = require(path.resolve(process.argv[2]));
  const url = process.argv[3] || 'http://127.0.0.1:5173/';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 891, height: 411 }, deviceScaleFactor: +(process.env.DPR || 1), hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('GPU stall')) console.log('[console.' + m.type() + ']', t.slice(0, 400)); });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 800)));
  await page.goto(url);
  await page.waitForTimeout(2500);
  const shot = (name) => page.screenshot({ path: `tests/out/${name}.png` });
  const h = {
    // world -> screen
    scr: (x, y) => page.evaluate(([x, y]) => window.__game.stage.toScreen(x, y), [x, y]),
    async tap(x, y) { await page.touchscreen.tap(x, y); },
    async tapWorld(x, y) { const p = await h.scr(x, y); await page.touchscreen.tap(p.x, p.y); },
    async clickText(t) { await page.getByText(t, { exact: false }).first().click({ force: true }); },
    // drag with a mouse (simple & deterministic); from/to in screen px
    async drag(a, b, steps = 12) {
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await page.waitForTimeout(16); }
      await page.mouse.up();
    },
    async slot(i) { return page.evaluate((i) => window.__game.ui.slotCenter(i), i); },
    wait: (ms) => page.waitForTimeout(ms),
    state: () => page.evaluate(() => { const g = window.__game; return { mode: g.mode, placed: g.placed.map((p) => ({ id: p.id, x: p.x, y: p.y, a: p.a })), success: g.sim ? g.sim.success : null, time: g.sim ? g.sim.time : null, q: g.stage.quality }; }),
  };
  try { await script(page, shot, h); } catch (e) { console.log('SCRIPT ERROR', e); await shot('error'); }
  await browser.close();
})();
