// Opens the online-emulator link like a visitor would, clicks "Spielen" and saves two screenshots.
//   node tests/online-check.cjs <link> <outDir>
const { chromium } = require('playwright');
(async () => {
  const [link, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.goto(link, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${out}/visitor-1.png` });
  // "Spielen" sits at about 47% / 46% of the remote screen
  await page.mouse.click(600, 296);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/visitor-2.png` });
  await browser.close();
})().catch((e) => { console.log('ERROR', String(e).slice(0, 300)); process.exit(1); });
