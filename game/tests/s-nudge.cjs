module.exports = async (page, shot, h) => {
  await page.evaluate(() => { localStorage.setItem('wolfgangs-werkstatt-v1', JSON.stringify({ stars: { 1: 3 }, music: true, sound: true, quality: 2, solvedCount: 1, lastLevel: 2 })); });
  await page.reload(); await h.wait(2500);
  await h.clickText('Spielen'); await h.wait(600);
  await h.clickText("Los geht's"); await h.wait(14500);
  await shot('nudge');
};
