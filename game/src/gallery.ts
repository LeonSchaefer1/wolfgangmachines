// Dev-only page: shows every part type on the wall, optionally running the simulation.
import { Sim } from './core/sim';
import type { PartInst } from './core/types';
import { FIELD_H, FIELD_W } from './core/types';
import { LEVELS, solutionParts } from './core/levels';
import { Cable, Fx } from './render/fx';
import { createPartView, type PartView } from './render/partViews';
import { Stage } from './render/stage';

const q = new URLSearchParams(location.search);
const stage = new Stage(document.getElementById('c') as HTMLCanvasElement, 2);
const vw = innerWidth, vh = innerHeight;
const tray = +(q.get('tray') ?? 0);
const s = Math.min((vw - tray) / (FIELD_W + 0.8), vh / (FIELD_H + 0.8));
stage.layout({ x: (vw - tray - FIELD_W * s) / 2, y: (vh - FIELD_H * s) / 2, width: FIELD_W * s, height: FIELD_H * s }, vw, vh);

let parts: PartInst[];
const lv = q.get('level');
if (lv) {
  const L = LEVELS[+lv - 1];
  parts = [...L.parts, ...(q.get('sol') ? solutionParts(L) : [])];
} else {
  const P = (id: string, kind: any, x: number, y: number, a = 0, fixed = true, extra: any = {}): PartInst => ({ id, kind, x, y, a, fixed, ...extra });
  parts = [
    P('p1', 'plank', 1.6, 6.0, 0), P('p2', 'plank', 4.6, 6.0, -15, false, { len: 2 }), P('p3', 'plank', 8, 6.1, 15, false, { len: 3.5 }),
    P('b1', 'ball', 1, 4.8), P('b2', 'basketball', 2, 4.8), P('b3', 'beachball', 3.2, 4.8), P('c1', 'crate', 4.4, 4.8),
    P('d1', 'domino', 5.3, 4.8), P('d2', 'domino', 5.8, 4.8), P('d3', 'domino', 6.5, 4.6, -70),
    P('ba1', 'balloon', 7.6, 4.9), P('ba2', 'balloon', 8.6, 4.9, 0, false), P('ca', 'cactus', 9.8, 4.7), P('ca2', 'cactus', 11, 6.13, 180),
    P('t1', 'trampoline', 1.2, 3.2), P('t2', 'trampoline', 3.4, 3.2, -15, false), P('f1', 'fan', 5.2, 3.2), 
    P('bu', 'button', 1, 1.8, 0, true, { targets: ['la'] }), P('la', 'lamp', 2.6, 2.0), P('co', 'conveyor', 5, 1.7), P('be', 'bell', 7.4, 1.9),
    P('se', 'seesaw', 2, 0.5), P('bk', 'bucket', 5, 0.55), P('ro', 'rocket', 7, 0.6), P('f2', 'fan', 8.6, 0.8, 90, false), P('se2', 'seesaw', 10.2, 1.5, 0, false, { flip: true }),
  ];
}
const views: PartView[] = parts.map((p) => { const v = createPartView(p); stage.world.add(v.root); return v; });
const fx = new Fx(stage.scene);
const cables: { c: Cable; from: PartInst; to: PartInst }[] = [];
for (const p of parts) for (const t of p.targets ?? []) { const to = parts.find((x) => x.id === t); if (to) cables.push({ c: new Cable(stage.world), from: p, to }); }
let sim: Sim | null = null;
if (q.get('run')) {
  sim = new Sim(parts, lv ? LEVELS[+lv - 1].goal : { type: 'pop', ids: ['none'] });
  for (const v of views) v.rt = sim.byId.get(v.inst.id) ?? null;
}
const pre = +(q.get('t') ?? 0);
if (sim) for (let i = 0; i < pre * 60; i++) sim.step();
let last = performance.now();
let frames = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (sim && !q.get('freeze')) sim.step();
  const f = { t: now / 1000, dt, alpha: 1, running: !!sim, simTime: sim ? sim.time : 0 };
  for (const v of views) v.update(f);
  for (const c of cables) c.c.update(c.from.x, c.from.y, c.to.x, c.to.y, !!sim?.byId.get(c.to.id)?.on, dt);
  fx.update(dt);
  stage.shadowsDirty = true;
  stage.render();
  frames++;
  (window as any).__frames = frames;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as any).__fx = fx;
