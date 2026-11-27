// Screenshots every level in build mode (after intro) and mid-run with the solution placed via the debug API.
module.exports = async (page, shot, h) => {
  const ids = (process.env.LEVELS || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
  await page.evaluate(() => { localStorage.setItem('wolfgangs-werkstatt-v1', JSON.stringify({ stars: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3 }, music: true, sound: true, quality: 2, solvedCount: 3, lastLevel: 1 })); });
  await page.reload(); await h.wait(2500);
  for (const id of ids) {
    await page.evaluate((id) => { const g = window.__game; g.loadLevel(id); g.ui.closeDialog(); }, id);
    await h.wait(700);
    await shot(`lv${id}-a`);
    const t = +(process.env.T || 0);
    await page.evaluate(async ([id, t]) => {
      const g = window.__game;
      const m = await import('/src/core/levels.ts');
      const L = m.LEVELS[id - 1];
      for (const p of m.solutionParts(L)) {
        const si = g.slots.findIndex((s) => s.item.kind === p.kind && (s.item.len ?? 0) === (p.len ?? 0) && s.used.some((u) => u === null));
        const inst = g.takeFromSlot(si, p.x, p.y); inst.a = p.a; inst.flip = p.flip; g.views.get(inst.id).snapPose();
      }
      g.start();
      g.debugAdvance(t || 1.6);
    }, [id, t]);
    await h.wait(900);
    await shot(`lv${id}-b`);
    await page.evaluate(() => { window.__game.stop(); });
  }
};
