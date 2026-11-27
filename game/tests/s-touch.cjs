// Touch interaction test with synthetic pointer events (pointerType: touch).
module.exports = async (page, shot, h) => {
  await page.evaluate(() => { localStorage.setItem('wolfgangs-werkstatt-v1', JSON.stringify({ stars: { 1: 3, 2: 3, 3: 3 }, music: true, sound: true, quality: 2, solvedCount: 3, lastLevel: 3 })); });
  await page.reload(); await h.wait(2500);
  await page.evaluate(() => { const g = window.__game; g.loadLevel(3); g.ui.closeDialog(); });
  await h.wait(500);
  const ev = (type, x, y) => page.evaluate(([type, x, y]) => {
    const el = document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
  }, [type, x, y]);
  const drag = async (a, b, mid) => {
    await ev('pointerdown', a.x, a.y);
    for (let i = 1; i <= 10; i++) { await ev('pointermove', a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10); await h.wait(20); if (mid && i === 6) { await h.wait(250); await shot(mid); } }
    await ev('pointerup', b.x, b.y);
  };
  const s = await h.slot(0);
  // 1) tap on the slot -> part appears in the middle
  await ev('pointerdown', s.x, s.y); await ev('pointerup', s.x, s.y);
  await h.wait(600); await shot('touch-1-tap');
  console.log('after tap', JSON.stringify(await h.state()));
  // 2) drag it with a finger to the left bottom
  let st = await h.state();
  let from = await h.scr(st.placed[0].x, st.placed[0].y);
  let to = await h.scr(3.0, 0.5);
  await drag(from, { x: to.x, y: to.y + 40 }, 'touch-2-drag');
  await h.wait(500); await shot('touch-3-dropped');
  console.log('after drag', JSON.stringify(await h.state()));
  // 3) rotate right once via the floating button
  await page.locator('#actions .fab').nth(1).click({ force: true });
  await h.wait(400); await shot('touch-4-rotated');
  console.log('after rotate', JSON.stringify(await h.state()));
  // 4) hint dialog
  await page.locator('#btn-hint').click({ force: true });
  await h.wait(500); await shot('touch-5-hint');
  await h.clickText('Alles klar');
  // 5) drag back to the tray
  st = await h.state();
  from = await h.scr(st.placed[0].x, st.placed[0].y);
  await drag(from, { x: s.x, y: s.y }, 'touch-6-return');
  await h.wait(400);
  console.log('after return', JSON.stringify(await h.state()));
  // 6) pause menu + level select
  await page.locator('.tray-top .btn').first().click({ force: true });
  await h.wait(500); await shot('touch-7-pause');
  await h.clickText('Andere Maschine');
  await h.wait(600); await shot('touch-8-levels');
};
