module.exports = async (page, shot, h) => {
  await h.clickText('Spielen');
  await h.wait(800);
  await shot('l1-intro');
  await h.clickText("Los geht's");
  await h.wait(1200);
  await shot('l1-build');
  const s = await h.slot(0);
  const t = await h.scr(5.0, 2.75);
  // drag half way and take a picture mid-drag
  await page.mouse.move(s.x, s.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + (t.x + 60 - s.x) * i / 10, s.y + (t.y - 40 - s.y) * i / 10); await h.wait(16); }
  await h.wait(300);
  await shot('l1-drag');
  await page.mouse.move(t.x, t.y); await h.wait(50);
  await page.mouse.up();
  await h.wait(700);
  await shot('l1-placed');
  console.log(JSON.stringify(await h.state()));
  await h.clickText('Start');
  await page.evaluate(() => window.__game.debugAdvance(2.2));
  await h.wait(600);
  await shot('l1-run');
  await page.evaluate(() => window.__game.debugAdvance(3));
  console.log(JSON.stringify(await h.state()));
  await h.wait(1600);
  await shot('l1-celebrate');
  await h.wait(2500);
  await shot('l1-win');
  console.log(JSON.stringify(await h.state()));
};
