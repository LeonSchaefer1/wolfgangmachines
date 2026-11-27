// Physical definition of every part: bodies, fixtures and build-mode behaviour.
import { Box, Circle, Polygon, Vec2, type Shape } from 'planck';
import type { Mat, PartInst, PartKind } from './types';

export interface FixSpec {
  shape: Shape;
  density: number;
  friction: number;
  restitution: number;
  mat: Mat;
  /** special role of this fixture */
  tag?: 'sharp' | 'cap' | 'mat' | 'belt' | 'bell' | 'damp';
}

export interface BodySpec {
  type: 'static' | 'dynamic';
  /** pose relative to the part origin */
  lx: number;
  ly: number;
  la: number;
  fixtures: FixSpec[];
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  bullet?: boolean;
  fixedRotation?: boolean;
}

export interface PartDef {
  kind: PartKind;
  /** German display name */
  name: string;
  /** rotation step in degrees, 0 = cannot be rotated */
  rotStep: number;
  rotMin?: number;
  rotMax?: number;
  /** the rotate buttons flip the part instead of rotating it */
  flips?: boolean;
  /** half extents of the visual bounding box (for picking, tray icons, clamping) */
  hw: number;
  hh: number;
  /** how strongly wind pushes this part (force at the fan mouth) */
  wind: number;
  bodies: (inst: PartInst) => BodySpec[];
}

const fx = (shape: Shape, mat: Mat, density: number, friction: number, restitution: number, tag?: FixSpec['tag']): FixSpec => ({
  shape,
  mat,
  density,
  friction,
  restitution,
  tag,
});
const box = (w: number, h: number, cx = 0, cy = 0, a = 0) => new Box(w / 2, h / 2, new Vec2(cx, cy), a);
const stat = (fixtures: FixSpec[]): BodySpec => ({ type: 'static', lx: 0, ly: 0, la: 0, fixtures });
const dyn = (fixtures: FixSpec[], extra: Partial<BodySpec> = {}): BodySpec => ({ type: 'dynamic', lx: 0, ly: 0, la: 0, fixtures, ...extra });

export const PLANK_T = 0.22;
export const BALL_R = 0.3;
export const BASKETBALL_R = 0.4;
export const BEACHBALL_R = 0.46;
export const BALLOON_R = 0.42;
export const DOMINO_W = 0.2;
export const DOMINO_H = 0.9;
export const CRATE_S = 0.7;
export const CONVEYOR_L = 2.6;
export const CONVEYOR_T = 0.44;
export const SEESAW_L = 3.2;
export const SEESAW_TILT = 0.27; // rad
export const SEESAW_PIVOT_H = 0.5;
export const FAN_REACH = 5.0;
export const FAN_WIDTH = 1.3;
export const BELL_R = 0.36;

export const PARTS: Record<PartKind, PartDef> = {
  plank: {
    kind: 'plank',
    name: 'Brett',
    rotStep: 15,
    hw: 1.25,
    hh: 0.11,
    wind: 0,
    bodies: (i) => [stat([fx(box(i.len ?? 2.5, PLANK_T), 'wood', 0, 0.5, 0.1)])],
  },
  ball: {
    kind: 'ball',
    name: 'Stahlkugel',
    rotStep: 0,
    hw: BALL_R,
    hh: BALL_R,
    wind: 0.15,
    bodies: () => [dyn([fx(new Circle(BALL_R), 'metal', 6, 0.5, 0.12)], { angularDamping: 0.15, bullet: true })],
  },
  basketball: {
    kind: 'basketball',
    name: 'Basketball',
    rotStep: 0,
    hw: BASKETBALL_R,
    hh: BASKETBALL_R,
    wind: 0.5,
    bodies: () => [dyn([fx(new Circle(BASKETBALL_R), 'rubber', 0.9, 0.6, 0.72)], { angularDamping: 0.3 })],
  },
  beachball: {
    kind: 'beachball',
    name: 'Wasserball',
    rotStep: 0,
    hw: BEACHBALL_R,
    hh: BEACHBALL_R,
    wind: 3.0,
    bodies: () => [dyn([fx(new Circle(BEACHBALL_R), 'soft', 0.22, 0.5, 0.55)], { linearDamping: 0.35, angularDamping: 0.6 })],
  },
  domino: {
    kind: 'domino',
    name: 'Domino',
    rotStep: 0,
    hw: DOMINO_W / 2,
    hh: DOMINO_H / 2,
    wind: 0.1,
    bodies: () => [dyn([fx(box(DOMINO_W, DOMINO_H), 'domino', 1.6, 0.55, 0.02)])],
  },
  crate: {
    kind: 'crate',
    name: 'Kiste',
    rotStep: 0,
    hw: CRATE_S / 2,
    hh: CRATE_S / 2,
    wind: 0.2,
    bodies: () => [dyn([fx(box(CRATE_S, CRATE_S), 'wood', 0.7, 0.5, 0.08)])],
  },
  trampoline: {
    kind: 'trampoline',
    name: 'Trampolin',
    rotStep: 15,
    rotMin: -45,
    rotMax: 45,
    hw: 0.9,
    hh: 0.28,
    wind: 0,
    bodies: () => [
      stat([
        fx(box(1.8, 0.3, 0, -0.12), 'wood', 0, 0.5, 0.1),
        fx(box(1.56, 0.14, 0, 0.19), 'mat', 0, 0.7, 0.92, 'mat'),
      ]),
    ],
  },
  fan: {
    kind: 'fan',
    name: 'Ventilator',
    rotStep: 45,
    hw: 0.34,
    hh: 0.62,
    wind: 0,
    bodies: () => [stat([fx(box(0.6, 1.24), 'metal', 0, 0.4, 0.1)])],
  },
  balloon: {
    kind: 'balloon',
    name: 'Luftballon',
    rotStep: 0,
    hw: BALLOON_R,
    hh: BALLOON_R * 1.15,
    wind: 1.5,
    bodies: () => [
      dyn([fx(new Circle(BALLOON_R), 'soft', 0.12, 0.01, 0.3)], { gravityScale: -0.42, linearDamping: 1.5, fixedRotation: true }),
    ],
  },
  cactus: {
    kind: 'cactus',
    name: 'Kaktus',
    rotStep: 0,
    hw: 0.35,
    hh: 0.6,
    wind: 0,
    bodies: () => [
      stat([
        fx(box(0.6, 0.45, 0, -0.375), 'wood', 0, 0.5, 0.1),
        fx(box(0.42, 0.62, 0, 0.16), 'soft', 0, 0.5, 0.05, 'sharp'),
        fx(new Circle(new Vec2(0, 0.42), 0.24), 'soft', 0, 0.5, 0.05, 'sharp'),
      ]),
    ],
  },
  button: {
    kind: 'button',
    name: 'Schalter',
    rotStep: 0,
    hw: 0.5,
    hh: 0.2,
    wind: 0,
    bodies: () => [
      stat([
        fx(box(0.9, 0.16, 0, -0.12), 'metal', 0, 0.5, 0.05),
        // the red plate overhangs the base, so anything rolling into the switch from the side presses it too
        fx(box(1.0, 0.2, 0, 0.06), 'wood', 0, 0.5, 0.05, 'cap'),
      ]),
    ],
  },
  lamp: {
    kind: 'lamp',
    name: 'Lampe',
    rotStep: 0,
    hw: 0.4,
    hh: 0.55,
    wind: 0,
    bodies: () => [],
  },
  conveyor: {
    kind: 'conveyor',
    name: 'Förderband',
    rotStep: 0,
    flips: true,
    hw: CONVEYOR_L / 2,
    hh: CONVEYOR_T / 2,
    wind: 0,
    bodies: () => [
      stat([
        fx(box(CONVEYOR_L - CONVEYOR_T, CONVEYOR_T), 'rubber', 0, 0.9, 0.02, 'belt'),
        fx(new Circle(new Vec2(-(CONVEYOR_L - CONVEYOR_T) / 2, 0), CONVEYOR_T / 2), 'rubber', 0, 0.9, 0.02, 'belt'),
        fx(new Circle(new Vec2((CONVEYOR_L - CONVEYOR_T) / 2, 0), CONVEYOR_T / 2), 'rubber', 0, 0.9, 0.02, 'belt'),
      ]),
    ],
  },
  seesaw: {
    kind: 'seesaw',
    name: 'Wippe',
    rotStep: 0,
    flips: true,
    hw: SEESAW_L / 2,
    hh: 0.42,
    wind: 0,
    bodies: (i) => {
      const tilt = i.flip ? -SEESAW_TILT : SEESAW_TILT; // default: left side down
      const hl = SEESAW_L / 2;
      return [
        stat([
          fx(
            new Polygon([new Vec2(-0.34, -SEESAW_PIVOT_H), new Vec2(0.34, -SEESAW_PIVOT_H), new Vec2(0.08, -0.1), new Vec2(-0.08, -0.1)]),
            'wood',
            0,
            0.5,
            0.1,
          ),
        ]),
        {
          type: 'dynamic',
          lx: 0,
          ly: 0,
          la: tilt,
          angularDamping: 0.4,
          fixtures: [
            fx(box(SEESAW_L, 0.14), 'wood', 0.5, 0.7, 0.02, 'damp'),
            fx(box(0.1, 0.26, -hl + 0.05, 0.16), 'wood', 0.5, 0.5, 0.02),
            fx(box(0.1, 0.26, hl - 0.05, 0.16), 'wood', 0.5, 0.5, 0.02),
          ],
        },
      ];
    },
  },
  bucket: {
    kind: 'bucket',
    name: 'Eimer',
    rotStep: 0,
    hw: 0.88,
    hh: 0.55,
    wind: 0,
    bodies: () => [
      stat([
        fx(box(1.3, 0.12, 0, -0.49), 'bucket', 0, 0.6, 0.05),
        fx(box(0.12, 1.1, -0.71, 0, 0.17), 'bucket', 0, 0.4, 0.05),
        fx(box(0.12, 1.1, 0.71, 0, -0.17), 'bucket', 0, 0.4, 0.05),
      ]),
    ],
  },
  rocket: {
    kind: 'rocket',
    name: 'Rakete',
    rotStep: 0,
    hw: 0.3,
    hh: 0.6,
    wind: 0,
    bodies: () => [
      stat([
        fx(box(0.34, 0.8, 0, -0.1), 'wood', 0.4, 0.4, 0.05),
        fx(new Polygon([new Vec2(-0.17, 0.3), new Vec2(0.17, 0.3), new Vec2(0, 0.6)]), 'wood', 0.4, 0.4, 0.05),
        fx(box(0.6, 0.12, 0, -0.54), 'wood', 0.4, 0.5, 0.05),
      ]),
    ],
  },
  bell: {
    kind: 'bell',
    name: 'Glocke',
    rotStep: 0,
    hw: 0.45,
    hh: 0.5,
    wind: 0,
    bodies: () => [stat([fx(new Circle(new Vec2(0, -0.08), BELL_R), 'metal', 0, 0.3, 0.35, 'bell')])],
  },
};

/** German display names incl. length variants */
export function partName(kind: PartKind, len?: number): string {
  if (kind === 'plank' && len) return len <= 2 ? 'Kurzes Brett' : len >= 3.5 ? 'Langes Brett' : 'Brett';
  return PARTS[kind].name;
}

export function halfExtents(inst: { kind: PartKind; len?: number }): { hw: number; hh: number } {
  const d = PARTS[inst.kind];
  if (inst.kind === 'plank') return { hw: (inst.len ?? 2.5) / 2, hh: d.hh };
  return { hw: d.hw, hh: d.hh };
}
