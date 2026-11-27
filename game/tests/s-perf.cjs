// Measures per-frame workload of every level with the reference solution running:
// draw calls, triangles, and CPU time of physics + scene update under 4x CPU throttling
// (rough stand-in for a mid-range phone CPU). GPU time cannot be measured here (no GPU).
module.exports = async (page, shot, h) => {
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => { localStorage.setItem('wolfgangs-werkstatt-v1', JSON.stringify({ stars: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3 }, music: false, sound: false, quality: 2, solvedCount: 3, lastLevel: 1 })); });
  await page.reload(); await h.wait(2500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const rows = [];
  for (let id = 1; id <= 10; id++) {
    const r = await page.evaluate(async (id) => {
      const g = window.__game;
      g.loadLevel(id); g.ui.closeDialog();
      const m = await import('/src/core/levels.ts');
      const L = m.LEVELS[id - 1];
      for (const p of m.solutionParts(L)) {
        const si = g.slots.findIndex((s) => s.item.kind === p.kind && (s.item.len ?? 0) === (p.len ?? 0) && s.used.some((u) => u === null));
        const inst = g.takeFromSlot(si, p.x, p.y); inst.a = p.a; inst.flip = p.flip; g.views.get(inst.id).snapPose();
      }
      g.start();
      g.paused = true; // drive frames by hand
      const sim = g.sim;
      let stepMs = 0, updMs = 0, maxStep = 0, n = 0;
      const f = { t: 0, dt: 1 / 60, alpha: 1, running: true, simTime: 0 };
      for (let i = 0; i < 360; i++) {
        let t0 = performance.now();
        sim.step(); for (const e of sim.drain()) g.onEvent(e);
        let t1 = performance.now();
        f.t += 1 / 60; f.simTime = sim.time;
        for (const v of g.views.values()) v.update(f);
        g.fx.update(1 / 60);
        let t2 = performance.now();
        stepMs += t1 - t0; updMs += t2 - t1; maxStep = Math.max(maxStep, t2 - t0); n++;
      }
      const info = g.stage.renderer.info;
      g.stage.shadowsDirty = true; g.stage.render();
      const res = { id, bodies: sim.world.getBodyCount(), stepMs: stepMs / n, updMs: updMs / n, maxMs: maxStep, calls: info.render.calls, tris: info.render.triangles, geoms: info.memory.geometries, textures: info.memory.textures, programs: info.programs.length };
      g.paused = false; g.stop();
      return res;
    }, id);
    rows.push(r);
    console.log(`L${r.id}: bodies ${r.bodies}, physics ${r.stepMs.toFixed(2)} ms, scene update ${r.updMs.toFixed(2)} ms, worst tick ${r.maxMs.toFixed(1)} ms | draw calls ${r.calls}, triangles ${r.tris}, textures ${r.textures}, shader programs ${r.programs}`);
  }
  require('node:fs').writeFileSync('tests/out/perf.json', JSON.stringify(rows, null, 1));
};
