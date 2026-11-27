module.exports = async (page, shot, h) => {
  await page.evaluate(() => { localStorage.setItem('wolfgangs-werkstatt-v1', JSON.stringify({ stars: { 1: 3 }, music: true, sound: true, quality: 2, solvedCount: 1, lastLevel: 2 })); });
  await page.reload(); await h.wait(2500);
  await h.clickText('Spielen'); await h.wait(600);
  await h.clickText("Los geht's"); await h.wait(500);
  await page.locator('#btn-start').click({ force: true }); await h.wait(3000);
  await page.locator('#btn-start').click({ force: true }); await h.wait(500);
  await page.locator('.tray-top .btn').first().click({ force: true }); await h.wait(700);
  await shot('pause');
};
