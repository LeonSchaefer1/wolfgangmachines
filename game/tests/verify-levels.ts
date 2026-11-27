// Headless verification of all levels:
//  1. without any player parts the goal must NOT be reached,
//  2. with the reference solution it MUST be reached,
//  3. robustness: nudging each solution part by one grid step should mostly still work.
// Also writes an SVG trace per level (tests/out/level-N.svg) for visual inspection.
//
//   npx tsx tests/verify-levels.ts [levelId] [--svg]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, solutionParts } from '../src/core/levels';
import { PARTS } from '../src/core/parts';
import { isFree } from '../src/core/placement';
import { Sim } from '../src/core/sim';
import { FIELD_H, FIELD_W, GRID, type Level, type PartInst } from '../src/core/types';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const only = args.find((a) => /^\d+$/.test(a));
const wantSvg = args.includes('--svg');

interface RunResult {
  success: boolean;
  time: number;
  sim: Sim;
  traces: Map<string, number[]>;
  log: string[];
}

function run(level: Level, placed: PartInst[], maxT = 40, trace = false): RunResult {
  const sim = new Sim([...level.parts, ...placed], level.goal);
  const traces = new Map<string, number[]>();
  const log: string[] = [];
  const maxTicks = maxT * 60;
  let after = 0;
  while (sim.ticks < maxTicks) {
    sim.step();
    for (const e of sim.drain()) {
      if (e.t !== 'hit') log.push(`${sim.time.toFixed(2)} ${JSON.stringify(e)}`);
    }
    if (trace && sim.ticks % 2 === 0) {
      for (const rt of sim.parts) {
        if (!rt.moving || rt.dead) continue;
        let arr = traces.get(rt.inst.id);
        if (!arr) traces.set(rt.inst.id, (arr = []));
        arr.push(rt.x, rt.y);
      }
    }
    if (sim.success && ++after > 60) break;
    if (sim.stalled) break;
  }
  return { success: sim.success, time: sim.successTime, sim, traces, log };
}

const COLORS: Record<string, string> = {
  plank: '#b07a3b',
  ball: '#7d8894',
  basketball: '#e2762b',
  beachball: '#3fa7d6',
  domino: '#222',
  crate: '#c79a52',
  trampoline: '#2f6fde',
  fan: '#5b6b7a',
  balloon: '#e23c3c',
  cactus: '#3c9a4a',
  button: '#c22',
  lamp: '#e8c500',
  conveyor: '#444',
  seesaw: '#8a5a2b',
  bucket: '#8899aa',
  rocket: '#d33',
  bell: '#c9a227',
};

function svg(level: Level, placed: PartInst[], res: RunResult): string {
  const S = 80;
  const X = (x: number) => (x * S).toFixed(1);
  const Y = (y: number) => ((FIELD_H - y) * S).toFixed(1);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${FIELD_W * S}" height="${FIELD_H * S}" viewBox="0 0 ${FIELD_W * S} ${FIELD_H * S}">`;
  out += `<rect width="100%" height="100%" fill="#f3ead8"/>`;
  for (let gx = 0; gx <= FIELD_W; gx++) out += `<line x1="${X(gx)}" y1="0" x2="${X(gx)}" y2="${FIELD_H * S}" stroke="#0001"/><text x="${+X(gx) + 2}" y="${FIELD_H * S - 3}" font-size="10" fill="#0006">${gx}</text>`;
  for (let gy = 0; gy <= FIELD_H; gy++) out += `<line x1="0" y1="${Y(gy)}" x2="${FIELD_W * S}" y2="${Y(gy)}" stroke="#0001"/><text x="2" y="${+Y(gy) - 2}" font-size="10" fill="#0006">${gy}</text>`;
  const drawInst = (inst: PartInst, opacity: number, dash: boolean) => {
    const col = COLORS[inst.kind] ?? '#555';
    const pa = (inst.a * Math.PI) / 180;
    for (const b of PARTS[inst.kind].bodies(inst)) {
      const c0 = Math.cos(pa);
      const s0 = Math.sin(pa);
      const bx = inst.x + c0 * b.lx - s0 * b.ly;
      const by = inst.y + s0 * b.lx + c0 * b.ly;
      const ba = pa + b.la;
      const c = Math.cos(ba);
      const s = Math.sin(ba);
      for (const f of b.fixtures) {
        const sh = f.shape as any;
        const style = `fill="${col}" fill-opacity="${opacity * 0.6}" stroke="${inst.fixed ? '#333' : '#06c'}" stroke-width="${inst.fixed ? 1 : 2}" ${dash ? 'stroke-dasharray="4 3"' : ''}`;
        if (sh.getType() === 'circle') {
          const p = sh.getCenter();
          out += `<circle cx="${X(bx + c * p.x - s * p.y)}" cy="${Y(by + s * p.x + c * p.y)}" r="${sh.getRadius() * S}" ${style}/>`;
        } else if (sh.getType() === 'polygon') {
          const pts = sh.m_vertices.map((v: any) => `${X(bx + c * v.x - s * v.y)},${Y(by + s * v.x + c * v.y)}`).join(' ');
          out += `<polygon points="${pts}" ${style}/>`;
        }
      }
    }
    if (PARTS[inst.kind].bodies(inst).length === 0) out += `<circle cx="${X(inst.x)}" cy="${Y(inst.y)}" r="${0.3 * S}" fill="${col}" fill-opacity="0.5" stroke="#333"/>`;
    out += `<text x="${X(inst.x)}" y="${+Y(inst.y) - 4}" font-size="11" text-anchor="middle" fill="#000a">${inst.id}</text>`;
  };
  for (const p of level.parts) drawInst(p, 1, false);
  for (const p of placed) drawInst(p, 1, false);
  for (const [id, arr] of res.traces) {
    const rt = res.sim.byId.get(id)!;
    const col = COLORS[rt.inst.kind] ?? '#f0f';
    let d = '';
    for (let i = 0; i < arr.length; i += 2) d += `${i ? 'L' : 'M'}${X(arr[i])} ${Y(arr[i + 1])}`;
    out += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-opacity="0.85"/>`;
    for (let i = 0; i < arr.length; i += 30) out += `<circle cx="${X(arr[i])}" cy="${Y(arr[i + 1])}" r="3" fill="${col}"/>`;
  }
  out += `<text x="8" y="16" font-size="14" fill="#000">L${level.id} ${level.title} — ${res.success ? 'OK t=' + res.time.toFixed(2) : 'FAIL'}</text>`;
  out += '</svg>';
  return out;
}

let allOk = true;
for (const level of LEVELS) {
  if (only && level.id !== +only) continue;
  const problems: string[] = [];
  // static sanity: fixed parts must not overlap each other, solution parts must be placeable
  const sol = solutionParts(level);
  const everything = [...level.parts, ...sol];
  for (const p of sol) if (!isFree(p, everything)) problems.push(`solution part ${p.id} overlaps something`);
  for (let i = 0; i < level.parts.length; i++)
    for (let j = i + 1; j < level.parts.length; j++) {
      const a = level.parts[i];
      const b = level.parts[j];
      const dynA = PARTS[a.kind].bodies(a).some((x) => x.type === 'dynamic');
      const dynB = PARTS[b.kind].bodies(b).some((x) => x.type === 'dynamic');
      if (!dynA && !dynB) continue; // static scenery may touch
      if (a.kind === 'domino' || b.kind === 'domino') { if (!isFree({ ...(a.kind === 'domino' ? a : b), y: (a.kind === 'domino' ? a : b).y + 0.03 }, [a.kind === 'domino' ? b : a])) problems.push(`fixed parts ${a.id} and ${b.id} overlap`); continue; }
      if (!isFree(a, [b])) problems.push(`fixed parts ${a.id} and ${b.id} overlap`);
    }
  const invCount = level.inventory.reduce((s, i) => s + i.count, 0);
  if (sol.length > invCount) problems.push('solution uses more parts than the inventory offers');

  const empty = run(level, [], 30);
  if (empty.success) problems.push('solved WITHOUT placing anything');
  const solved = run(level, sol, 40, true);
  if (!solved.success) problems.push('reference solution does NOT work');
  // determinism
  const again = run(level, sol, 40);
  if (again.success !== solved.success || Math.abs(again.time - solved.time) > 1e-9) problems.push('simulation is not deterministic');

  // robustness
  let tries = 0;
  let good = 0;
  const bad: string[] = [];
  for (let k = 0; k < sol.length; k++) {
    for (const [dx, dy] of [
      [GRID, 0],
      [-GRID, 0],
      [0, GRID],
      [0, -GRID],
    ]) {
      const variant = sol.map((p, i) => (i === k ? { ...p, x: p.x + dx, y: p.y + dy } : { ...p }));
      if (!isFree(variant[k], [...level.parts, ...variant])) continue;
      tries++;
      if (run(level, variant, 40).success) good++;
      else bad.push(`${variant[k].id}${dx ? (dx > 0 ? '→' : '←') : dy > 0 ? '↑' : '↓'}`);
    }
  }
  const ok = problems.length === 0;
  allOk &&= ok;
  console.log(
    `${ok ? '✔' : '✘'} Level ${level.id} "${level.title}": solution ${solved.success ? 'OK in ' + solved.time.toFixed(1) + 's' : 'FAIL'}, empty ${empty.success ? 'SOLVED(!)' : 'fails as intended'}, robust ${good}/${tries}${bad.length ? ' (fails: ' + bad.join(' ') + ')' : ''}`,
  );
  for (const p of problems) console.log('    PROBLEM: ' + p);
  if (wantSvg || !ok) {
    writeFileSync(join(outDir, `level-${level.id}.svg`), svg(level, sol, solved));
    writeFileSync(join(outDir, `level-${level.id}-empty.svg`), svg(level, [], run(level, [], 30, true)));
    if (only) console.log(solved.log.join('\n'));
  }
}
process.exit(allOk ? 0 : 1);
