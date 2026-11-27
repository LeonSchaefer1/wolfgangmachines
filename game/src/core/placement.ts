// Build-mode geometry helpers: snapping, field bounds and overlap tests.
import { Transform, Vec2, testOverlap } from 'planck';
import { PARTS, halfExtents } from './parts';
import { FIELD_H, FIELD_W, GRID, type PartInst } from './types';

const DEG = Math.PI / 180;

export const snap = (v: number) => Math.round(v / GRID) * GRID;

interface WorldShape {
  shape: import('planck').Shape;
  xf: Transform;
}

function worldShapes(inst: PartInst): WorldShape[] {
  const out: WorldShape[] = [];
  const pa = inst.a * DEG;
  const c = Math.cos(pa);
  const s = Math.sin(pa);
  for (const b of PARTS[inst.kind].bodies(inst)) {
    const xf = new Transform(new Vec2(inst.x + c * b.lx - s * b.ly, inst.y + s * b.lx + c * b.ly), pa + b.la);
    for (const f of b.fixtures) out.push({ shape: f.shape, xf });
  }
  return out;
}

export function overlaps(a: PartInst, b: PartInst): boolean {
  // cheap reject
  const ea = halfExtents(a);
  const eb = halfExtents(b);
  const ra = Math.hypot(ea.hw, ea.hh) + 0.3;
  const rb = Math.hypot(eb.hw, eb.hh) + 0.3;
  if (Math.hypot(a.x - b.x, a.y - b.y) > ra + rb) return false;
  const sa = worldShapes(a);
  const sb = worldShapes(b);
  for (const p of sa) for (const q of sb) if (testOverlap(p.shape, 0, q.shape, 0, p.xf, q.xf)) return true;
  return false;
}

/** axis-aligned half extents of the rotated bounding box */
export function aabbHalf(inst: PartInst): { hx: number; hy: number } {
  const { hw, hh } = halfExtents(inst);
  const a = inst.a * DEG;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { hx: hw * c + hh * s, hy: hw * s + hh * c };
}

export function clampToField(inst: PartInst): void {
  const { hx, hy } = aabbHalf(inst);
  const m = 0.02;
  // parts may not poke out of the field; keep the grid alignment while clamping
  const minX = Math.ceil((hx + m) / GRID) * GRID;
  const maxX = Math.floor((FIELD_W - hx - m) / GRID) * GRID;
  const minY = Math.ceil((hy + m) / GRID) * GRID;
  const maxY = Math.floor((FIELD_H - hy - m) / GRID) * GRID;
  inst.x = Math.min(Math.max(inst.x, minX), maxX);
  inst.y = Math.min(Math.max(inst.y, minY), maxY);
}

export function isFree(inst: PartInst, others: PartInst[]): boolean {
  for (const o of others) if (o !== inst && o.id !== inst.id && overlaps(inst, o)) return false;
  return true;
}

/**
 * Finds the closest free grid position to the wanted one (spiral search).
 * Returns false when there is none within `maxR`.
 */
export function settle(inst: PartInst, others: PartInst[], maxR = 1.5): boolean {
  inst.x = snap(inst.x);
  inst.y = snap(inst.y);
  clampToField(inst);
  if (isFree(inst, others)) return true;
  const ox = inst.x;
  const oy = inst.y;
  const cands: { dx: number; dy: number; d: number }[] = [];
  const n = Math.round(maxR / GRID);
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const d = Math.hypot(i, j) * GRID;
      if (d > 0 && d <= maxR) cands.push({ dx: i * GRID, dy: j * GRID, d: d - (j > 0 ? 0.01 : 0) });
    }
  cands.sort((p, q) => p.d - q.d);
  for (const c of cands) {
    inst.x = ox + c.dx;
    inst.y = oy + c.dy;
    const bx = inst.x;
    const by = inst.y;
    clampToField(inst);
    if (inst.x !== bx || inst.y !== by) continue;
    if (isFree(inst, others)) return true;
  }
  inst.x = ox;
  inst.y = oy;
  return false;
}
