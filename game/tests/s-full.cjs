// Plays all ten levels in sequence through the real game flow (solution placed via API, buttons clicked in the DOM).
module.exports = async (page, shot, h) => {
  await h.clickText('Spielen');
  await h.wait(600);
  for (let id = 1; id <= 10; id++) {
    const title = await page.locator('.card h2').first().textContent();
    await h.clickText("Los geht's");
    await h.wait(300);
    await page.evaluate(async (id) => {
      const g = window.__game;
      const m = await import('/src/core/levels.ts');
      const L = m.LEVELS[id - 1];
      if (g.level.id !== id) throw new Error('wrong level loaded: ' + g.level.id);
      for (const p of m.solutionParts(L)) {
        const si = g.slots.findIndex((s) => s.item.kind === p.kind && (s.item.len ?? 0) === (p.len ?? 0) && s.used.some((u) => u === null));
        const inst = g.takeFromSlot(si, p.x, p.y); inst.a = p.a; inst.flip = p.flip; g.views.get(inst.id).snapPose();
      }
    }, id);
    await page.locator('#btn-start').click({ force: true });
    await h.wait(200);
    await page.evaluate(() => window.__game.debugAdvance(9));
    const st = await h.state();
    await h.wait(3600);
    const dlg = await page.locator('.card h2').first().textContent().catch(() => null);
    const stars = await page.locator('.card .stars svg.on').count();
    console.log(`L${id} "${title}" success=${st.success} dialog="${dlg}" stars=${stars}`);
    if (id === 5 || id === 10) await shot('full-win-' + id);
    if (id < 10) await h.clickText('Nächste Maschine');
    await h.wait(700);
  }
  await h.clickText('Alle Maschinen');
  await h.wait(600);
  await shot('full-levels-done');
  console.log('saved', await page.evaluate(() => localStorage.getItem('wolfgangs-werkstatt-v1')));
};
