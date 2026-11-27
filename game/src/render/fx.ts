// Pooled particle effects (dust, sparks, confetti, fireworks) and the cables between switches and devices.
import * as THREE from 'three';
import { FIELD_H, FIELD_W } from '../core/types';
import { getAssets } from './assets';
import { PLANE_Z } from './partViews';

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  g: number;
  drag: number;
  rot: number;
  vr: number;
  r: number;
  gc: number;
  b: number;
  tumble: number;
  delay: number;
}

const dummy = new THREE.Object3D();
const col = new THREE.Color();

class Pool {
  mesh: THREE.InstancedMesh;
  items: P[] = [];
  private additive: boolean;
  private tumble: boolean;

  constructor(max: number, mat: THREE.Material, additive: boolean, tumble: boolean, geo: THREE.BufferGeometry = new THREE.PlaneGeometry(1, 1)) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, col.set(0xffffff));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.additive = additive;
    this.tumble = tumble;
    this.max = max;
  }
  max: number;

  spawn(p: Partial<P> & { x: number; y: number }) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ z: PLANE_Z + 0.5, vx: 0, vy: 0, life: 0, max: 1, size: 0.2, grow: 0, g: 0, drag: 0, rot: Math.random() * 6.28, vr: 0, r: 1, gc: 1, b: 1, tumble: Math.random() * 6.28, delay: 0, ...p });
  }

  update(dt: number) {
    const items = this.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (p.delay > 0) {
        p.delay -= dt;
        items[n++] = p;
        continue;
      }
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k - p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      items[n++] = p;
    }
    items.length = n;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const p = items[i];
      if (p.delay > 0) continue;
      const t = p.life / p.max;
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const s = (p.size + p.grow * t) * (this.additive ? 1 : 0.35 + 0.65 * fade);
      dummy.position.set(p.x, p.y, p.z);
      if (this.tumble) dummy.rotation.set(p.tumble + p.life * p.vr * 1.3, p.tumble * 2 + p.life * p.vr, p.rot);
      else dummy.rotation.set(0, 0, p.rot);
      dummy.scale.set(s, this.tumble ? s * 0.6 : s, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(c, dummy.matrix);
      const f = this.additive ? fade : 1;
      this.mesh.setColorAt(c, col.setRGB(p.r * f, p.gc * f, p.b * f));
      c++;
    }
    this.mesh.count = c;
    if (c > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
    this.mesh.visible = c > 0;
  }

  clear() {
    this.items.length = 0;
    this.mesh.count = 0;
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const CONFETTI = [0xe5393b, 0x2f8de0, 0xf5b81c, 0x3fae52, 0xa24bd6, 0xff7fb0, 0xffffff];
const FIRE = [0xffd24a, 0xff5a3c, 0x62d0ff, 0x8dff7a, 0xff8de0, 0xffffff];

export class Fx {
  puffs: Pool;
  sparks: Pool;
  confetti: Pool;
  stars: Pool;
  /** true while any particle is alive (the renderer needs to keep drawing) */
  get busy() {
    return this.puffs.items.length + this.sparks.items.length + this.confetti.items.length + this.stars.items.length > 0;
  }

  constructor(scene: THREE.Scene) {
    const A = getAssets();
    this.puffs = new Pool(90, new THREE.MeshBasicMaterial({ map: A.puff, transparent: true, depthWrite: false, opacity: 0.55 }), false, false);
    this.sparks = new Pool(420, new THREE.MeshBasicMaterial({ map: A.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), true, false);
    this.stars = new Pool(60, new THREE.MeshBasicMaterial({ map: A.star, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), true, false);
    this.confetti = new Pool(260, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), false, true);
    scene.add(this.puffs.mesh, this.sparks.mesh, this.stars.mesh, this.confetti.mesh);
  }

  update(dt: number) {
    this.puffs.update(dt);
    this.sparks.update(dt);
    this.stars.update(dt);
    this.confetti.update(dt);
  }

  clear() {
    this.puffs.clear();
    this.sparks.clear();
    this.stars.clear();
    this.confetti.clear();
  }

  private rgb(hex: number) {
    col.set(hex);
    return { r: col.r, gc: col.g, b: col.b };
  }

  dust(x: number, y: number, strength: number) {
    const n = Math.min(6, 2 + Math.floor(strength / 3));
    for (let i = 0; i < n; i++)
      this.puffs.spawn({ x: x + rnd(-0.08, 0.08), y: y + rnd(-0.05, 0.05), vx: rnd(-1, 1) * (0.5 + strength * 0.06), vy: rnd(0.1, 0.9), max: rnd(0.35, 0.6), size: rnd(0.12, 0.2), grow: rnd(0.25, 0.5), drag: 3, ...this.rgb(0xf3e3c8) });
  }

  sparkle(x: number, y: number, n = 10, hex = 0xffd24a, speed = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const v = rnd(0.4, 1) * speed;
      this.sparks.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rnd(0.3, 0.7), size: rnd(0.12, 0.26), g: 5, drag: 2, ...this.rgb(hex) });
    }
  }

  pop(x: number, y: number, hex: number) {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28;
      const v = rnd(2, 7);
      this.confetti.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, max: rnd(0.6, 1.1), size: rnd(0.1, 0.2), g: 14, drag: 2.5, vr: rnd(-12, 12), ...this.rgb(hex) });
    }
    this.puffs.spawn({ x, y, max: 0.25, size: 0.5, grow: 1.4, ...this.rgb(0xffffff) });
    this.sparkle(x, y, 8, 0xffffff, 5);
  }

  flash(x: number, y: number, size = 2.5, hex = 0xfff3c0) {
    this.sparks.spawn({ x, y, max: 0.28, size, grow: size * 0.6, ...this.rgb(hex) });
  }

  exhaust(x: number, y: number, dx: number, dy: number) {
    for (let i = 0; i < 3; i++) this.sparks.spawn({ x: x + rnd(-0.06, 0.06), y: y + rnd(-0.06, 0.06), vx: -dx * rnd(2, 5) + rnd(-0.8, 0.8), vy: -dy * rnd(2, 5) + rnd(-0.8, 0.8), max: rnd(0.25, 0.5), size: rnd(0.14, 0.3), drag: 2, g: 2, ...this.rgb(i ? 0xffa030 : 0xfff0a0) });
    this.puffs.spawn({ x, y, vx: -dx * 1.5 + rnd(-0.4, 0.4), vy: -dy * 1.5 + rnd(-0.4, 0.4), max: rnd(0.6, 1.0), size: 0.18, grow: 0.7, drag: 1.5, ...this.rgb(0xd9d2c8) });
  }

  fuse(x: number, y: number) {
    this.sparks.spawn({ x, y, vx: rnd(-1.5, 1.5), vy: rnd(0, 2.5), max: rnd(0.15, 0.35), size: rnd(0.06, 0.14), g: 8, ...this.rgb(Math.random() < 0.5 ? 0xffd24a : 0xfff6d0) });
  }

  firework(x: number, y: number, big = true) {
    this.flash(x, y, big ? 4 : 2.5);
    const shells = big ? 3 : 1;
    for (let s = 0; s < shells; s++) {
      const hex = FIRE[Math.floor(Math.random() * FIRE.length)];
      const n = big ? 46 : 30;
      const sp = big ? 5 + s * 2.5 : 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + rnd(-0.08, 0.08);
        const v = sp * rnd(0.82, 1.08);
        this.sparks.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rnd(0.9, 1.5), size: rnd(0.14, 0.26), g: 3.2, drag: 1.7, delay: s * 0.07, ...this.rgb(hex) });
      }
    }
    for (let i = 0; i < (big ? 12 : 6); i++) {
      const a = Math.random() * 6.28;
      const v = rnd(2, 6);
      this.stars.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rnd(0.8, 1.3), size: rnd(0.25, 0.45), g: 3, drag: 1.5, vr: rnd(-4, 4), ...this.rgb(0xfff2a0) });
    }
  }

  /** the big celebration when a level is solved */
  celebrate() {
    for (let i = 0; i < 150; i++) {
      this.confetti.spawn({
        x: rnd(0, FIELD_W),
        y: FIELD_H + rnd(0.2, 3.5),
        z: PLANE_Z + rnd(0.5, 1.4),
        vx: rnd(-0.8, 0.8),
        vy: rnd(-1.5, -0.2),
        max: rnd(2.6, 4.2),
        size: rnd(0.14, 0.26),
        g: 2.6,
        drag: 0.9,
        vr: rnd(-7, 7),
        delay: rnd(0, 0.7),
        ...this.rgb(CONFETTI[i % CONFETTI.length]),
      });
    }
    for (const [fx, fy, d] of [
      [FIELD_W * 0.22, FIELD_H * 0.7, 0.15],
      [FIELD_W * 0.78, FIELD_H * 0.72, 0.45],
      [FIELD_W * 0.5, FIELD_H * 0.8, 0.8],
    ]) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * 6.28;
        const v = rnd(3.5, 4.6);
        this.sparks.spawn({ x: fx, y: fy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rnd(0.8, 1.2), size: rnd(0.14, 0.24), g: 3, drag: 1.8, delay: d, ...this.rgb(FIRE[(i + Math.floor(fx)) % 3]) });
      }
    }
  }

  starBurst(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.28;
      this.stars.spawn({ x, y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, max: 0.8, size: 0.4, drag: 2.5, vr: 3, ...this.rgb(0xffe27a) });
    }
    this.flash(x, y, 2.2);
  }
}

/** A sagging cable on the wall from a switch to the device it powers. */
export class Cable {
  mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private key = '';
  private glow = 0;

  constructor(parent: THREE.Object3D) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, emissive: 0xffb020, emissiveIntensity: 0 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.castShadow = true;
    parent.add(this.mesh);
  }

  update(ax: number, ay: number, bx: number, by: number, on: boolean, dt: number) {
    const key = `${ax.toFixed(2)},${ay.toFixed(2)},${bx.toFixed(2)},${by.toFixed(2)}`;
    if (key !== this.key) {
      this.key = key;
      const dist = Math.hypot(bx - ax, by - ay);
      const sag = 0.25 + dist * 0.12;
      const z = 0.07;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ax, ay, PLANE_Z - 0.1),
        new THREE.Vector3(ax, ay - 0.05, z),
        new THREE.Vector3(ax + (bx - ax) * 0.3, ay + (by - ay) * 0.3 - sag, z),
        new THREE.Vector3(ax + (bx - ax) * 0.7, ay + (by - ay) * 0.7 - sag, z),
        new THREE.Vector3(bx, by - 0.05, z),
        new THREE.Vector3(bx, by, PLANE_Z - 0.1),
      ]);
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.TubeGeometry(curve, 28, 0.04, 6);
    }
    this.glow += ((on ? 1 : 0) - this.glow) * (1 - Math.exp(-dt * 8));
    this.mat.emissiveIntensity = this.glow * 1.6;
    this.mat.color.setHex(on ? 0x6b4a10 : 0x2b2f36);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}
