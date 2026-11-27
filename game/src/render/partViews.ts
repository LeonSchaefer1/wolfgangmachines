// 3D look of every part. Each view is a THREE.Group that follows a PartInst (build mode)
// or a simulated body (run mode) and animates itself.
import * as THREE from 'three';
import { CONVEYOR_L, CONVEYOR_T, FAN_REACH, FAN_WIDTH, SEESAW_L, SEESAW_PIVOT_H, SEESAW_TILT, halfExtents } from '../core/parts';
import type { PartRT } from '../core/sim';
import type { PartInst } from '../core/types';
import { Builder, getAssets, hash, rbox, scaleU, type Assets } from './assets';

export const PLANE_Z = 0.42;
export const DZ = 0.6;
const DEG = Math.PI / 180;
const HP = Math.PI / 2;

export interface Frame {
  /** wall clock seconds */
  t: number;
  dt: number;
  /** interpolation factor between the previous and the current physics tick */
  alpha: number;
  running: boolean;
  simTime: number;
}

const cyl = (rt: number, rb: number, h: number, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const sph = (r: number, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);

export class PartView {
  root = new THREE.Group();
  inst: PartInst;
  rt: PartRT | null = null;
  halo: THREE.Mesh | null = null;
  /** 0..1 – picked up by the finger */
  lift = 0;
  liftTarget = 0;
  selected = false;
  invalid = false;
  isGhost = false;
  /** displayed pose (smoothed towards the instance pose while building) */
  dx: number;
  dy: number;
  da: number;
  /** root follows the simulated body */
  follow = false;
  anim: ((f: Frame, v: PartView) => void) | null = null;
  /** materials/textures owned by this view only */
  owned: { dispose(): void }[] = [];
  pop = 0;

  constructor(inst: PartInst) {
    this.inst = inst;
    this.dx = inst.x;
    this.dy = inst.y;
    this.da = inst.a * DEG;
  }

  snapPose() {
    this.dx = this.inst.x;
    this.dy = this.inst.y;
    this.da = this.inst.a * DEG;
  }

  update(f: Frame) {
    const rt = this.rt;
    if (rt && f.running) {
      if (this.follow) {
        if (rt.dead) this.root.visible = false;
        else {
          this.root.visible = true;
          this.dx = rt.px + (rt.x - rt.px) * f.alpha;
          this.dy = rt.py + (rt.y - rt.py) * f.alpha;
          this.da = rt.pa + (rt.a - rt.pa) * f.alpha;
        }
      }
    } else {
      this.root.visible = true;
      const k = 1 - Math.exp(-f.dt * 24);
      this.dx += (this.inst.x - this.dx) * k;
      this.dy += (this.inst.y - this.dy) * k;
      let d = this.inst.a * DEG - this.da;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.da += d * k;
    }
    this.lift += (this.liftTarget - this.lift) * (1 - Math.exp(-f.dt * 16));
    this.pop = Math.max(0, this.pop - f.dt * 4);
    const s = 1 + this.lift * 0.07 + Math.sin(this.pop * Math.PI) * 0.12;
    this.root.position.set(this.dx, this.dy, PLANE_Z + this.lift * 0.55);
    this.root.rotation.z = this.da;
    this.root.scale.set(s, s, s);
    if (this.halo) {
      const show = !f.running && !this.inst.fixed && !this.isGhost;
      this.halo.visible = show;
      if (show) {
        const m = this.halo.material as THREE.MeshBasicMaterial;
        if (this.invalid) {
          m.color.setHex(0xff3b20);
          m.opacity = 0.85;
        } else if (this.selected) {
          m.color.setHex(0x38c6ff);
          m.opacity = 0.75 + Math.sin(f.t * 5) * 0.12;
        } else {
          m.color.setHex(0xfff0a0);
          m.opacity = 0.42 + Math.sin(f.t * 2.4 + this.dx) * 0.1;
        }
      }
    }
    if (this.anim) this.anim(f, this);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

// ------------------------------------------------------------------ builders

type Make = (v: PartView, inst: PartInst, A: Assets) => void;

const BALLOON_COLORS = [0xe5393b, 0x2f8de0, 0xf5b81c, 0x3fae52, 0xa24bd6];

function own<T extends { dispose(): void }>(v: PartView, o: T): T {
  v.owned.push(o);
  return o;
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

/** brass screw head facing the camera */
function screw(b: Builder, x: number, y: number, z = DZ / 2) {
  b.add('metal', cyl(0.055, 0.055, 0.04, 12), 0xd8a53c, [x, y, z], [HP, 0, 0]);
  b.add('matte', new THREE.BoxGeometry(0.075, 0.014, 0.012), 0x5a3d10, [x, y, z + 0.022], [0, 0, 0.6]);
}

const MAKERS: Record<string, Make> = {
  plank(v, inst, A) {
    const len = inst.len ?? 2.5;
    const b = new Builder();
    const h = hash(inst.id);
    const geo = scaleU(rbox(len, 0.22, DZ, 0.04), len / 2.6, (h % 97) / 97, 0);
    b.add(inst.fixed ? 'wood' : 'woodLight', geo, 0xffffff);
    if (inst.fixed) {
      screw(b, -len / 2 + 0.2, 0);
      screw(b, len / 2 - 0.2, 0);
    } else {
      // player boards carry blue end caps so they are easy to tell apart
      b.add('gloss', rbox(0.14, 0.24, DZ + 0.02, 0.04), 0x2f7fd6, [-len / 2 + 0.06, 0, 0]);
      b.add('gloss', rbox(0.14, 0.24, DZ + 0.02, 0.04), 0x2f7fd6, [len / 2 - 0.06, 0, 0]);
    }
    b.build(v.root);
  },

  ball(v, _i, A) {
    mesh(v.root, sph(0.3, 28, 18), A.steel);
    v.follow = true;
  },

  basketball(v, _i, A) {
    mesh(v.root, sph(0.4, 28, 18), A.basketball);
    v.follow = true;
  },

  beachball(v, _i, A) {
    const m = mesh(v.root, sph(0.46, 28, 18), A.beachball);
    m.rotation.set(0.5, 0, 0.3);
    v.follow = true;
  },

  domino(v, inst) {
    const b = new Builder();
    const w = 0.2;
    const hgt = 0.9;
    const d = 0.5;
    b.add('gloss', rbox(w, hgt, d, 0.03), 0x23262d);
    const h = hash(inst.id);
    const pips = (n: number, cy: number, side: number) => {
      const P: [number, number][][] = [[], [[0, 0]], [[-1, -1], [1, 1]], [[-1, -1], [0, 0], [1, 1]], [[-1, -1], [1, -1], [-1, 1], [1, 1]], [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]];
      for (const [px, py] of P[n]) b.add('matte', cyl(0.04, 0.04, 0.012, 10), 0xf6f1e4, [side * (w / 2 + 0.002), cy + py * 0.11, px * 0.13], [0, 0, HP]);
    };
    for (const side of [-1, 1]) {
      pips(1 + (h % 6), 0.22, side);
      pips(1 + ((h >>> 4) % 6), -0.22, side);
      b.add('matte', new THREE.BoxGeometry(0.012, 0.016, d * 0.8), 0xf6f1e4, [side * (w / 2 + 0.002), 0, 0]);
    }
    // thin ivory rim on the edge that faces the player, for contrast against the wall
    b.add('matte', new THREE.BoxGeometry(w * 0.5, hgt * 0.86, 0.01), 0x454b57, [0, 0, d / 2 + 0.001]);
    b.build(v.root);
    v.follow = true;
  },

  crate(v, _i, A) {
    mesh(v.root, new THREE.BoxGeometry(0.7, 0.7, DZ), A.crate);
    v.follow = true;
  },

  trampoline(v) {
    const b = new Builder();
    const blue = 0x2b6fd0;
    b.add('gloss', rbox(1.8, 0.1, DZ, 0.04), blue, [0, 0.0, 0]);
    for (const x of [-0.78, 0.78]) b.add('gloss', rbox(0.1, 0.3, DZ, 0.03), blue, [x, -0.12, 0]);
    for (const x of [-0.82, 0.82]) b.add('matte', rbox(0.2, 0.06, DZ + 0.04, 0.02), 0x1b1d22, [x * 0.99, -0.27, 0]);
    // springs
    for (let i = 0; i < 7; i++) b.add('metal', cyl(0.025, 0.025, 0.12, 6), 0xcfd6dc, [-0.66 + i * 0.22, 0.08, DZ / 2 - 0.04]);
    b.build(v.root);
    const matGroup = new THREE.Group();
    v.root.add(matGroup);
    const mb = new Builder();
    mb.add('matte', rbox(1.56, 0.12, DZ - 0.06, 0.05), 0x20242c, [0, 0, 0]);
    mb.add('gloss', rbox(1.6, 0.06, DZ - 0.02, 0.03), 0xf4c21e, [0, -0.04, 0]);
    mb.build(matGroup);
    matGroup.position.y = 0.2;
    v.anim = (f, view) => {
      const rt = view.rt;
      let k = 0;
      if (rt && f.running) {
        const age = f.simTime - rt.t0;
        if (age >= 0 && age < 0.5) k = Math.exp(-age * 9) * Math.cos(age * 38);
      }
      matGroup.position.y = 0.2 - k * 0.07;
      matGroup.scale.y = 1 - k * 0.35;
    };
  },

  fan(v, _inst, A) {
    const b = new Builder();
    const steel = 0x8fa0b1;
    // wall mount
    b.add('metal', cyl(0.3, 0.3, 0.05, 20), 0x6d7b89, [-0.05, 0, -PLANE_Z + 0.03], [HP, 0, 0]);
    b.add('metal', cyl(0.07, 0.07, PLANE_Z, 10), 0x6d7b89, [-0.05, 0, -PLANE_Z / 2], [HP, 0, 0]);
    b.build(v.root);
    // the head is turned towards the player so the blades are visible (2.5D cheat)
    const head = new THREE.Group();
    head.rotation.y = -0.62;
    v.root.add(head);
    const hb = new Builder();
    hb.add('gloss', cyl(0.2, 0.24, 0.34, 18), 0xe0483a, [-0.2, 0, 0], [0, 0, HP]);
    hb.add('gloss', sph(0.2, 16, 10), 0xe0483a, [-0.37, 0, 0], [0, 0, 0], [0.6, 1, 1]);
    for (const [x, r] of [
      [0.12, 0.58],
      [-0.02, 0.58],
    ] as const)
      hb.add('metal', new THREE.TorusGeometry(r, 0.028, 6, 30), steel, [x, 0, 0], [0, HP, 0]);
    hb.add('metal', new THREE.TorusGeometry(0.3, 0.018, 6, 24), steel, [0.14, 0, 0], [0, HP, 0]);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      hb.add('metal', cyl(0.012, 0.012, 0.5, 5), steel, [0.14, Math.cos(a) * 0.33, Math.sin(a) * 0.33], [a, 0, 0]);
      hb.add('metal', cyl(0.014, 0.014, 0.14, 5), steel, [0.05, Math.cos(a) * 0.58, Math.sin(a) * 0.58], [0, 0, HP]);
    }
    hb.add('gloss', cyl(0.09, 0.09, 0.05, 14), 0xf4c21e, [0.15, 0, 0], [0, 0, HP]);
    hb.build(head);
    const rotor = new THREE.Group();
    rotor.position.x = 0.05;
    head.add(rotor);
    const rb = new Builder();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      rb.add('gloss', sph(0.26, 12, 8), 0x2e3540, [0, Math.cos(a) * 0.3, Math.sin(a) * 0.3], [a, 0.5, 0], [0.08, 1, 0.5]);
    }
    rb.add('metal', cyl(0.08, 0.08, 0.1, 12), 0x39414d, [0, 0, 0], [0, 0, HP]);
    rb.build(rotor);
    // wind zone
    const tex = own(v, A.wind.clone());
    tex.needsUpdate = true;
    tex.repeat.set(FAN_REACH / 3.2, 1);
    const geo = new THREE.PlaneGeometry(FAN_REACH - 0.4, FAN_WIDTH, 8, 1);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const u = geo.attributes.uv.getX(i);
      col.set([1, 1, 1, Math.min(1, u * 6) * (1 - u) ** 0.8], i * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const wm = own(v, new THREE.MeshBasicMaterial({ map: tex, transparent: true, vertexColors: true, depthWrite: false, opacity: 0.5 }));
    const wind = new THREE.Mesh(geo, wm);
    wind.position.set(0.4 + (FAN_REACH - 0.4) / 2, 0, 0.1);
    wind.renderOrder = 5;
    wind.userData.fx = true;
    v.root.add(wind);
    let spin = 0;
    let speed = 0;
    v.anim = (f, view) => {
      const rt = view.rt;
      const on = f.running ? !!rt?.on : false;
      speed += ((on ? 26 : 0) - speed) * (1 - Math.exp(-f.dt * 3));
      spin += speed * f.dt;
      rotor.rotation.x = spin;
      wm.opacity += ((f.running ? (on ? 0.6 : 0) : view.isGhost ? 0 : 0.3) - wm.opacity) * (1 - Math.exp(-f.dt * 6));
      wind.visible = wm.opacity > 0.01;
      tex.offset.x -= f.dt * (f.running ? 1.6 : 0.35);
    };
  },

  balloon(v, inst) {
    const color = BALLOON_COLORS[hash(inst.id) % BALLOON_COLORS.length];
    const b = new Builder();
    const g = sph(0.42, 24, 18);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = y < 0 ? 1 - 0.3 * (y / 0.42) ** 2 : 1;
      p.setXYZ(i, p.getX(i) * k, y * (y < 0 ? 1.18 : 1.05), p.getZ(i) * k * 0.92);
    }
    g.computeVertexNormals();
    b.add('gloss', g, color);
    b.add('gloss', cyl(0.02, 0.07, 0.09, 10), color, [0, -0.53, 0]);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.56, 0), new THREE.Vector3(0.05, -0.8, 0), new THREE.Vector3(-0.05, -1.05, 0), new THREE.Vector3(0.03, -1.3, 0)]);
    b.add('matte', new THREE.TubeGeometry(curve, 10, 0.012, 5), 0xf4f1ea);
    // a little highlight sticker makes it read as shiny even in flat light
    b.add('matte', sph(0.07, 8, 6), 0xffffff, [-0.17, 0.2, 0.31], [0, 0, 0.5], [1, 1.7, 0.25]);
    const inner = new THREE.Group();
    v.root.add(inner);
    b.build(inner);
    v.follow = true;
    const ph = (hash(inst.id) % 100) / 10;
    v.anim = (f) => {
      inner.position.y = f.running ? 0 : Math.sin(f.t * 1.7 + ph) * 0.035;
      inner.rotation.z = Math.sin(f.t * 1.1 + ph) * 0.05;
    };
  },

  cactus(v) {
    const b = new Builder();
    b.add('matte', cyl(0.3, 0.22, 0.4, 18), 0xc8693c, [0, -0.4, 0]);
    b.add('matte', cyl(0.33, 0.33, 0.09, 18), 0xd67a48, [0, -0.2, 0]);
    b.add('matte', cyl(0.27, 0.27, 0.02, 18), 0x4a3524, [0, -0.15, 0]);
    const green = 0x3f9c4d;
    b.add('matte', new THREE.CapsuleGeometry(0.2, 0.42, 6, 14), green, [0, 0.2, 0]);
    b.add('matte', new THREE.CapsuleGeometry(0.085, 0.14, 4, 10), green, [0.25, 0.22, 0.02], [0, 0, -1.0]);
    b.add('matte', new THREE.CapsuleGeometry(0.075, 0.1, 4, 10), green, [0.31, 0.33, 0.02]);
    b.add('matte', sph(0.08, 10, 8), 0xff7fb0, [0, 0.62, 0], [0, 0, 0], [1, 0.7, 1]);
    b.add('matte', sph(0.035, 8, 6), 0xffe36b, [0, 0.66, 0]);
    // spikes
    for (let ring = 0; ring < 4; ring++) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + ring * 0.45;
        const y = 0.0 + ring * 0.15;
        b.add('matte', cyl(0, 0.012, 0.12, 4), 0xfaf6e4, [Math.cos(a) * 0.23, y, Math.sin(a) * 0.23], [0, -a, -HP]);
      }
    }
    b.build(v.root);
  },

  button(v) {
    const b = new Builder();
    b.add('metal', rbox(1.0, 0.2, DZ, 0.04), 0x56616f, [0, -0.1, 0]);
    b.add('gloss', new THREE.BoxGeometry(0.9, 0.05, 0.02), 0xf4c21e, [0, -0.1, DZ / 2 + 0.005]);
    b.add('metal', cyl(0.36, 0.36, 0.04, 22), 0x2c333c, [0, 0.01, 0]);
    b.build(v.root);
    const cap = new THREE.Group();
    v.root.add(cap);
    const cb = new Builder();
    cb.add('gloss', cyl(0.3, 0.31, 0.12, 22), 0xd9272e, [0, 0, 0]);
    cb.add('gloss', sph(0.3, 22, 10), 0xe5393b, [0, 0.05, 0], [0, 0, 0], [1, 0.22, 1]);
    cb.build(cap);
    v.anim = (f, view) => {
      const down = f.running && view.rt?.pressed;
      const target = down ? 0.0 : 0.09;
      cap.position.y += (target - cap.position.y) * (1 - Math.exp(-f.dt * 30));
    };
    cap.position.y = 0.09;
  },

  lamp(v, _i, A) {
    const b = new Builder();
    const brass = 0xd8a53c;
    b.add('metal', cyl(0.17, 0.17, 0.05, 18), brass, [0, 0.58, -PLANE_Z + 0.03], [HP, 0, 0]);
    b.add('metal', cyl(0.03, 0.03, PLANE_Z, 8), brass, [0, 0.58, -PLANE_Z / 2], [HP, 0, 0]);
    b.add('metal', cyl(0.03, 0.03, 0.2, 8), brass, [0, 0.49, 0]);
    b.add('metal', cyl(0.1, 0.12, 0.14, 14), brass, [0, 0.34, 0]);
    b.build(v.root);
    const shadeMat = own(v, new THREE.MeshStandardMaterial({ color: 0x1f6b4a, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }));
    mesh(v.root, cyl(0.12, 0.5, 0.3, 28, true), shadeMat).position.y = 0.2;
    const bulbMat = own(v, new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.15, emissive: 0xffc247, emissiveIntensity: 0 }));
    mesh(v.root, sph(0.19, 18, 14), bulbMat, false).position.y = 0.06;
    const glowMat = own(v, new THREE.MeshBasicMaterial({ map: A.glow, color: 0xffd36b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
    glow.position.set(0, 0, 0.35);
    glow.userData.fx = true;
    glow.renderOrder = 6;
    v.root.add(glow);
    const poolMat = own(v, new THREE.MeshBasicMaterial({ map: A.glow, color: 0xffc860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat);
    pool.position.set(0, -0.4, -PLANE_Z + 0.02);
    pool.scale.set(7, 6, 1);
    pool.userData.fx = true;
    v.root.add(pool);
    let k = 0;
    v.anim = (f, view) => {
      const on = f.running && !!view.rt?.on;
      const target = on ? 1 : 0;
      k += (target - k) * (1 - Math.exp(-f.dt * (on ? 9 : 20)));
      const flick = on ? 1 + Math.sin(f.t * 31) * 0.02 : 1;
      bulbMat.emissiveIntensity = k * 3.2 * flick;
      glowMat.opacity = k * 0.95;
      const gs = 1.6 + k * 1.6 + Math.sin(f.t * 3) * 0.06 * k;
      glow.scale.set(gs, gs, 1);
      poolMat.opacity = k * 0.42;
      glow.visible = pool.visible = k > 0.01;
    };
  },

  conveyor(v, inst, A) {
    const L = CONVEYOR_L;
    const R = CONVEYOR_T / 2;
    const half = (L - CONVEYOR_T) / 2;
    const depth = DZ - 0.04;
    // belt surface following the stadium outline
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const ring: { x: number; y: number; nx: number; ny: number; s: number }[] = [];
    let s = 0;
    const push = (x: number, y: number, nx: number, ny: number, ds: number) => {
      s += ds;
      ring.push({ x, y, nx, ny, s });
    };
    const arcN = 10;
    push(-half, R, 0, 1, 0);
    push(half, R, 0, 1, 2 * half);
    for (let i = 1; i <= arcN; i++) {
      const a = HP - (i / arcN) * Math.PI;
      push(half + Math.cos(a) * R, Math.sin(a) * R, Math.cos(a), Math.sin(a), (Math.PI * R) / arcN);
    }
    push(-half, -R, 0, -1, 2 * half);
    for (let i = 1; i <= arcN; i++) {
      const a = -HP - (i / arcN) * Math.PI;
      push(-half + Math.cos(a) * R, Math.sin(a) * R, Math.cos(a), Math.sin(a), (Math.PI * R) / arcN);
    }
    const total = s;
    const reps = Math.round(total / 1.1);
    ring.forEach((p, i) => {
      for (const z of [depth / 2, -depth / 2]) {
        pos.push(p.x, p.y, z);
        nor.push(p.nx, p.ny, 0);
        uv.push((p.s / total) * reps, z > 0 ? 0 : 1);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    bg.setIndex(idx);
    const tex = own(v, A.belt.clone());
    tex.needsUpdate = true;
    const beltMat = own(v, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    mesh(v.root, bg, beltMat);
    // frame, rollers and a direction arrow plate
    const b = new Builder();
    b.add('metal', rbox(2 * half + 0.1, CONVEYOR_T * 0.5, 0.05, 0.02), 0x6f7d8c, [0, 0, DZ / 2 - 0.01]);
    b.add('matte', rbox(2 * half + R * 2 - 0.03, CONVEYOR_T - 0.03, depth - 0.06, 0.1), 0x23272d, [0, 0, 0]);
    for (const x of [-half, 0, half]) {
      b.add('metal', cyl(0.11, 0.11, DZ + 0.04, 14), 0xc9d2da, [x, 0, 0], [HP, 0, 0]);
      b.add('metal', cyl(0.05, 0.05, DZ + 0.08, 8), 0x39414d, [x, 0, 0], [HP, 0, 0]);
    }
    b.build(v.root);
    const wheels: THREE.Mesh[] = [];
    const wb = new Builder();
    wb.add('matte', new THREE.BoxGeometry(0.16, 0.03, 0.02), 0x39414d, [0, 0, 0]);
    const wheelGeo = new THREE.BoxGeometry(0.17, 0.035, 0.02);
    for (const x of [-half, 0, half]) {
      const w = mesh(v.root, wheelGeo, A.mats.matte, false);
      w.position.set(x, 0, DZ / 2 + 0.03);
      wheels.push(w);
    }
    let speed = 0;
    v.anim = (f, view) => {
      const dir = view.inst.flip ? -1 : 1;
      const on = f.running ? !!view.rt?.on : false;
      const target = on ? dir * 2.4 : !f.running && !view.isGhost ? dir * 0.5 : 0;
      speed += (target - speed) * (1 - Math.exp(-f.dt * 5));
      tex.offset.x -= (speed * f.dt * reps) / total;
      for (const w of wheels) w.rotation.z -= (speed * f.dt) / 0.11;
    };
  },

  seesaw(v, inst) {
    const b = new Builder();
    const shape = new THREE.Shape();
    shape.moveTo(-0.34, -SEESAW_PIVOT_H);
    shape.lineTo(0.34, -SEESAW_PIVOT_H);
    shape.lineTo(0.1, 0.04);
    shape.lineTo(-0.1, 0.04);
    shape.closePath();
    const eg = new THREE.ExtrudeGeometry(shape, { depth: DZ - 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
    eg.translate(0, 0, -(DZ - 0.1) / 2);
    b.add('gloss', eg, 0xd9482e);
    b.add('metal', cyl(0.07, 0.07, DZ + 0.06, 12), 0xd8a53c, [0, 0, 0], [HP, 0, 0]);
    b.build(v.root);
    const plank = new THREE.Group();
    v.root.add(plank);
    const pb = new Builder();
    pb.add(inst.fixed ? 'wood' : 'woodLight', scaleU(rbox(SEESAW_L, 0.14, DZ - 0.04, 0.035), 1.2), 0xffffff);
    for (const s of [-1, 1]) pb.add('gloss', rbox(0.1, 0.26, DZ - 0.04, 0.03), inst.fixed ? 0x8a4b22 : 0x2f7fd6, [s * (SEESAW_L / 2 - 0.05), 0.16, 0]);
    pb.build(plank);
    let shown = inst.flip ? -SEESAW_TILT : SEESAW_TILT;
    v.anim = (f, view) => {
      const rt = view.rt;
      if (rt && f.running) shown = rt.pa + (rt.a - rt.pa) * f.alpha - view.inst.a * DEG;
      else shown += ((view.inst.flip ? -SEESAW_TILT : SEESAW_TILT) - shown) * (1 - Math.exp(-f.dt * 14));
      plank.rotation.z = shown;
    };
  },

  bucket(v, _i, A) {
    // half-open oval bucket: the player can look inside
    const pts = [new THREE.Vector2(0.0, -0.55), new THREE.Vector2(0.62, -0.55), new THREE.Vector2(0.66, -0.5), new THREE.Vector2(0.83, 0.5), new THREE.Vector2(0.86, 0.55)];
    const back = new THREE.LatheGeometry(pts, 28, Math.PI / 2, Math.PI);
    back.scale(1, 1, 0.42);
    mesh(v.root, back, A.bucket);
    const rim = new THREE.TorusGeometry(0.85, 0.035, 8, 40);
    rim.rotateX(HP);
    rim.scale(1, 1, 0.42);
    rim.translate(0, 0.55, 0);
    mesh(v.root, rim, A.bucket);
    const band = new THREE.TorusGeometry(0.73, 0.02, 6, 40, Math.PI);
    band.rotateX(HP);
    band.rotateY(Math.PI);
    band.scale(1, 1, 0.42);
    band.translate(0, -0.1, 0);
    mesh(v.root, band, A.bucket);
    const b = new Builder();
    for (const s of [-1, 1]) b.add('metal', cyl(0.05, 0.05, 0.05, 10), 0x7b8792, [s * 0.86, 0.42, 0], [0, 0, HP]);
    b.build(v.root);
  },

  rocket(v, inst, A) {
    // launch stand stays, the rocket itself flies away
    const sb = new Builder();
    sb.add('wood', rbox(0.7, 0.12, DZ - 0.1, 0.03), 0xffffff, [0, -0.54, 0]);
    sb.add('metal', cyl(0.025, 0.025, 0.5, 6), 0x8fa0b1, [-0.24, -0.26, -0.1]);
    sb.add('metal', new THREE.TorusGeometry(0.2, 0.02, 6, 16, Math.PI), 0x8fa0b1, [-0.04, -0.05, -0.1], [HP, 0, 0]);
    sb.build(v.root);
    const fly = new THREE.Group();
    v.root.add(fly);
    const b = new Builder();
    b.add('gloss', cyl(0.16, 0.16, 0.66, 18), 0xe5393b, [0, -0.03, 0]);
    b.add('gloss', cyl(0.165, 0.165, 0.1, 18), 0xf6f1e4, [0, 0.1, 0]);
    b.add('gloss', cyl(0.165, 0.165, 0.1, 18), 0xf6f1e4, [0, -0.18, 0]);
    b.add('gloss', new THREE.ConeGeometry(0.17, 0.32, 18), 0xf4c21e, [0, 0.46, 0]);
    b.add('matte', cyl(0.1, 0.13, 0.08, 12), 0x39414d, [0, -0.4, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      b.add('gloss', rbox(0.2, 0.26, 0.03, 0.01), 0x2f7fd6, [Math.cos(a) * 0.22, -0.3, Math.sin(a) * 0.22], [0, -a, 0]);
    }
    b.build(fly);
    const sparkMat = own(v, new THREE.MeshBasicMaterial({ map: A.glow, color: 0xffb040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const spark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sparkMat);
    spark.position.set(0, -0.5, 0.2);
    spark.userData.fx = true;
    fly.add(spark);
    v.anim = (f, view) => {
      const rt = view.rt;
      if (rt && f.running) {
        if (rt.phase === 3) fly.visible = false;
        else {
          fly.visible = true;
          const x = rt.px + (rt.x - rt.px) * f.alpha - view.inst.x;
          const y = rt.py + (rt.y - rt.py) * f.alpha - view.inst.y;
          const c = Math.cos(-view.da);
          const s = Math.sin(-view.da);
          fly.position.set(x * c - y * s, x * s + y * c, 0);
          if (rt.phase === 1) fly.position.x += Math.sin(f.t * 70) * 0.012;
        }
        const burning = rt.phase === 1 || rt.phase === 2;
        sparkMat.opacity = burning ? 0.9 : 0;
        const ss = rt.phase === 2 ? 1.1 + Math.sin(f.t * 50) * 0.2 : 0.45 + Math.sin(f.t * 40) * 0.12;
        spark.scale.set(ss, ss * (rt.phase === 2 ? 1.6 : 1), 1);
        spark.position.y = rt.phase === 2 ? -0.7 : -0.5;
      } else {
        fly.visible = true;
        fly.position.set(0, 0, 0);
        sparkMat.opacity = 0;
      }
      spark.visible = sparkMat.opacity > 0;
    };
  },

  bell(v) {
    const b = new Builder();
    const iron = 0x4b535e;
    b.add('metal', cyl(0.16, 0.16, 0.05, 16), iron, [0, 0.42, -PLANE_Z + 0.03], [HP, 0, 0]);
    b.add('metal', cyl(0.035, 0.035, PLANE_Z + 0.05, 8), iron, [0, 0.42, -PLANE_Z / 2 + 0.02], [HP, 0, 0]);
    b.build(v.root);
    const swing = new THREE.Group();
    swing.position.y = 0.42;
    v.root.add(swing);
    const sb = new Builder();
    const pts = [new THREE.Vector2(0.0, -0.1), new THREE.Vector2(0.09, -0.11), new THREE.Vector2(0.17, -0.18), new THREE.Vector2(0.22, -0.34), new THREE.Vector2(0.25, -0.56), new THREE.Vector2(0.31, -0.72), new THREE.Vector2(0.39, -0.83), new THREE.Vector2(0.41, -0.87)];
    sb.add('metal', new THREE.LatheGeometry(pts, 26), 0xe9b53a);
    sb.add('metal', new THREE.TorusGeometry(0.05, 0.02, 6, 12), 0xe9b53a, [0, -0.06, 0]);
    sb.add('metal', sph(0.07, 10, 8), 0x8a6a1e, [0, -0.86, 0]);
    sb.build(swing);
    v.anim = (f, view) => {
      const rt = view.rt;
      let a = 0;
      if (rt && f.running && rt.rung) {
        const age = f.simTime - rt.t0;
        a = Math.exp(-age * 1.6) * Math.sin(age * 13) * 0.42;
      }
      swing.rotation.z = a;
    };
  },
};

export function createPartView(inst: PartInst, ghost = false): PartView {
  const A = getAssets();
  const v = new PartView(inst);
  v.isGhost = ghost;
  MAKERS[inst.kind](v, inst, A);
  if (ghost) {
    const kill: THREE.Object3D[] = [];
    v.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (o.userData.fx) kill.push(o);
      else if (m.isMesh) {
        m.material = A.ghost;
        m.castShadow = false;
        m.renderOrder = 8;
      }
    });
    for (const o of kill) o.removeFromParent();
  } else if (!inst.fixed) {
    const { hw, hh } = halfExtents(inst);
    const hm = own(v, new THREE.MeshBasicMaterial({ map: A.halo, color: 0xfff0a0, transparent: true, opacity: 0.4, depthWrite: false }));
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hm);
    halo.scale.set((hw * 2 + 0.75) * 1.45, (hh * 2 + 0.75) * 1.45, 1);
    halo.position.z = -PLANE_Z + 0.03;
    halo.userData.fx = true;
    halo.renderOrder = 1;
    v.root.add(halo);
    v.halo = halo;
  }
  v.update({ t: 0, dt: 1, alpha: 1, running: false, simTime: 0 });
  return v;
}
