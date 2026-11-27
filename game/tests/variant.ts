// npx tsx tests/variant.ts <level> <partIndex> <dx> <dy> [da]
import { LEVELS, solutionParts } from '../src/core/levels';
import { Sim } from '../src/core/sim';
const [lv, pi, dx, dy, da] = process.argv.slice(2).map(Number);
const L = LEVELS[lv - 1];
const sol = solutionParts(L);
sol[pi].x += dx; sol[pi].y += dy; sol[pi].a += da || 0;
const sim = new Sim([...L.parts, ...sol], L.goal);
const watch = sim.parts.filter((p) => p.moving);
for (let i = 0; i < 60 * 12 && !sim.success; i++) {
  sim.step();
  for (const e of sim.drain()) if (e.t !== 'hit') console.log(sim.time.toFixed(2), JSON.stringify(e));
  if (i % 30 === 0) console.log(sim.time.toFixed(1), watch.map((w) => `${w.inst.id}(${w.x.toFixed(2)},${w.y.toFixed(2)})`).join(' '));
}
console.log('success', sim.success);
