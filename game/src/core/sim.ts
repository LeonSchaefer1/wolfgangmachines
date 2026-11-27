// Deterministic fixed-step physics simulation of one machine run.
import { Body, Box, Contact, RevoluteJoint, Vec2, World, type Fixture } from 'planck';
import { FAN_REACH, FAN_WIDTH, PARTS, SEESAW_TILT, type FixSpec, type PartDef } from './parts';
import { FIELD_H, FIELD_W, GRAVITY, type Goal, type Mat, type PartInst, type SimEvent } from './types';

export const DT = 1 / 60;
const SUBSTEPS = 2;
const DEG = Math.PI / 180;
const BELT_SPEED = 2.4;
const WIND_K = 0.62;
const FUSE_TIME = 1.0;

export interface PartRT {
  inst: PartInst;
  def: PartDef;
  bodies: Body[];
  /** the body whose pose the view follows (null for purely static parts) */
  moving: Body | null;
  // previous / current pose of the moving body, for render interpolation
  px: number;
  py: number;
  pa: number;
  x: number;
  y: number;
  a: number;
  /** powered devices: fan, conveyor, lamp, rocket */
  on: boolean;
  pressed: boolean;
  popped: boolean;
  /** removed from the world */
  dead: boolean;
  rung: boolean;
  /** rocket: 0 idle, 1 fuse burning, 2 flying, 3 exploded */
  phase: number;
  /** sim time of the last state change (press, bounce, ring, power, phase) */
  t0: number;
  /** initial angle of the moving body */
  a0: number;
  lastHit: number;
}

interface FixData {
  rt: PartRT | null;
  mat: Mat;
  tag?: FixSpec['tag'];
}

export class Sim {
  world: World;
  parts: PartRT[] = [];
  byId = new Map<string, PartRT>();
  events: SimEvent[] = [];
  time = 0;
  ticks = 0;
  success = false;
  successTime = -1;
  stalled = false;
  private goal: Goal;
  private goalHold = 0;
  private bucketHold = new Map<string, number>();
  private quietTime = 0;
  private toPop: PartRT[] = [];
  private toExplode: PartRT[] = [];

  constructor(insts: PartInst[], goal: Goal) {
    this.goal = goal;
    this.world = new World({ gravity: new Vec2(0, -GRAVITY), allowSleep: true });
    this.buildWalls();
    const sorted = [...insts].sort(
      (p, q) => (p.kind < q.kind ? -1 : p.kind > q.kind ? 1 : 0) || p.x - q.x || p.y - q.y || p.a - q.a || (p.id < q.id ? -1 : 1),
    );
    const switched = new Set<string>();
    for (const i of sorted) if (i.kind === 'button') for (const t of i.targets ?? []) switched.add(t);
    for (const inst of sorted) this.addPart(inst, !switched.has(inst.id));
    this.world.on('begin-contact', (c) => this.onBegin(c));
    this.world.on('pre-solve', (c) => this.onPreSolve(c));
  }

  private buildWalls() {
    const b = this.world.createBody({ type: 'static' });
    const data: FixData = { rt: null, mat: 'wood' };
    const t = 1;
    const mk = (cx: number, cy: number, hw: number, hh: number) =>
      b.createFixture({ shape: new Box(hw, hh, new Vec2(cx, cy)), friction: 0.5, restitution: 0.1, userData: data });
    mk(FIELD_W / 2, -t, FIELD_W / 2 + t, t);
    mk(FIELD_W / 2, FIELD_H + t, FIELD_W / 2 + t, t);
    mk(-t, FIELD_H / 2, t, FIELD_H / 2 + t);
    mk(FIELD_W + t, FIELD_H / 2, t, FIELD_H / 2 + t);
  }

  private addPart(inst: PartInst, defaultOn: boolean) {
    const def = PARTS[inst.kind];
    const rt: PartRT = {
      inst,
      def,
      bodies: [],
      moving: null,
      px: inst.x,
      py: inst.y,
      pa: inst.a * DEG,
      x: inst.x,
      y: inst.y,
      a: inst.a * DEG,
      on: false,
      pressed: false,
      popped: false,
      dead: false,
      rung: false,
      phase: 0,
      t0: -10,
      a0: inst.a * DEG,
      lastHit: -1,
    };
    if (inst.kind === 'fan' || inst.kind === 'conveyor') rt.on = defaultOn;
    const pa = inst.a * DEG;
    const c = Math.cos(pa);
    const s = Math.sin(pa);
    for (const spec of def.bodies(inst)) {
      const body = this.world.createBody({
        type: spec.type,
        position: new Vec2(inst.x + c * spec.lx - s * spec.ly, inst.y + s * spec.lx + c * spec.ly),
        angle: pa + spec.la,
        gravityScale: spec.gravityScale ?? 1,
        linearDamping: spec.linearDamping ?? 0,
        angularDamping: spec.angularDamping ?? 0.05,
        bullet: !!spec.bullet,
        fixedRotation: !!spec.fixedRotation,
      });
      for (const f of spec.fixtures) {
        const data: FixData = { rt, mat: f.mat, tag: f.tag };
        body.createFixture({ shape: f.shape, density: f.density, friction: f.friction, restitution: f.restitution, userData: data });
      }
      rt.bodies.push(body);
      if (spec.type === 'dynamic') rt.moving = body;
    }
    if (inst.kind === 'seesaw') {
      const [base, plank] = rt.bodies;
      this.world.createJoint(
        new RevoluteJoint(
          { enableLimit: true, lowerAngle: -SEESAW_TILT - plank.getAngle() + pa, upperAngle: SEESAW_TILT - plank.getAngle() + pa },
          base,
          plank,
          new Vec2(inst.x, inst.y),
        ),
      );
    }
    if (rt.moving) {
      rt.a = rt.pa = rt.a0 = rt.moving.getAngle();
    }
    this.parts.push(rt);
    this.byId.set(inst.id, rt);
  }

  // ---------------------------------------------------------------- contacts

  private onBegin(c: Contact) {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const da = fa.getUserData() as FixData;
    const db = fb.getUserData() as FixData;
    const ba = fa.getBody();
    const bb = fb.getBody();
    let vn = 0;
    let px = 0;
    let py = 0;
    const wm = c.getWorldManifold(null);
    if (wm && wm.points.length > 0) {
      const p = wm.points[0];
      px = p.x;
      py = p.y;
      const va = ba.getLinearVelocityFromWorldPoint(p as Vec2);
      const vb = bb.getLinearVelocityFromWorldPoint(p as Vec2);
      vn = Math.abs((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y);
    }
    // a bucket swallows the bounce of whatever falls into it
    if (da.mat === 'bucket' || db.mat === 'bucket') c.setRestitution(0.05);
    // things laid on a seesaw stay put instead of dribbling
    if (da.tag === 'damp' || db.tag === 'damp') c.setRestitution(0);
    this.special(da, db, bb, vn, px, py);
    this.special(db, da, ba, vn, px, py);
    if (vn > 0.9) {
      const ra = da.rt;
      const rb = db.rt;
      // rate limit so stacks and rolling contacts do not machine-gun
      if ((!ra || this.time - ra.lastHit > 0.05) && (!rb || this.time - rb.lastHit > 0.05)) {
        if (ra) ra.lastHit = this.time;
        if (rb) rb.lastHit = this.time;
        this.events.push({ t: 'hit', ma: da.mat, mb: db.mat, v: vn, x: px, y: py });
      }
    }
  }

  /** reactions of fixture `me` being touched by `other` */
  private special(me: FixData, other: FixData, otherBody: Body, vn: number, x: number, y: number) {
    const rt = me.rt;
    if (!rt) return;
    const ort = other.rt;
    if (me.tag === 'sharp' && ort && ort.inst.kind === 'balloon' && !ort.popped) {
      ort.popped = true;
      this.toPop.push(ort);
    }
    if (me.tag === 'cap' && !rt.pressed && otherBody.isDynamic()) {
      rt.pressed = true;
      rt.t0 = this.time;
      this.events.push({ t: 'button', id: rt.inst.id, x: rt.inst.x, y: rt.inst.y });
      for (const id of rt.inst.targets ?? []) this.power(id);
    }
    if (me.tag === 'mat' && vn > 1.5) {
      rt.t0 = this.time;
      this.events.push({ t: 'boing', id: rt.inst.id, x, y, v: vn });
    }
    if (me.tag === 'bell' && vn > 1.0 && otherBody.isDynamic()) this.ring(rt, vn);
    if (rt.inst.kind === 'rocket' && rt.phase === 2 && this.time - rt.t0 > 0.3 && !this.toExplode.includes(rt)) this.toExplode.push(rt);
  }

  private ring(rt: PartRT, v: number) {
    rt.rung = true;
    rt.t0 = this.time;
    this.events.push({ t: 'bell', id: rt.inst.id, v });
  }

  private power(id: string) {
    const rt = this.byId.get(id);
    if (!rt || rt.on) return;
    rt.on = true;
    rt.t0 = this.time;
    this.events.push({ t: 'power', id, kind: rt.inst.kind, on: true });
    if (rt.inst.kind === 'rocket' && rt.phase === 0) {
      rt.phase = 1;
      this.events.push({ t: 'fuse', id });
    }
    if (rt.inst.kind === 'conveyor' || rt.inst.kind === 'fan') {
      for (let b = this.world.getBodyList(); b; b = b.getNext()) if (b.isDynamic()) b.setAwake(true);
    }
  }

  private onPreSolve(c: Contact) {
    const da = c.getFixtureA().getUserData() as FixData;
    const db = c.getFixtureB().getUserData() as FixData;
    const belt = da.tag === 'belt' ? da : db.tag === 'belt' ? db : null;
    if (belt && belt.rt) c.setTangentSpeed(belt.rt.on ? (belt.rt.inst.flip ? -BELT_SPEED : BELT_SPEED) : 0);
  }

  // -------------------------------------------------------------------- step

  step() {
    for (const rt of this.parts) {
      rt.px = rt.x;
      rt.py = rt.y;
      rt.pa = rt.a;
    }
    // two physics sub-steps per tick: fast impacts (seesaw, dominoes) transfer their energy much more faithfully
    for (let i = 0; i < SUBSTEPS; i++) {
      this.applyForces();
      this.world.step(DT / SUBSTEPS, 8, 3);
    }
    this.time += DT;
    this.ticks++;

    for (const rt of this.toPop) this.pop(rt);
    this.toPop.length = 0;
    for (const rt of this.toExplode) this.explode(rt);
    this.toExplode.length = 0;

    let active = false;
    for (const rt of this.parts) {
      const b = rt.moving;
      if (!b || rt.dead) continue;
      const p = b.getPosition();
      rt.x = p.x;
      rt.y = p.y;
      rt.a = b.getAngle();
      if (b.isAwake() && b.isDynamic()) {
        const v = b.getLinearVelocity();
        if (v.x * v.x + v.y * v.y > 0.03 || Math.abs(b.getAngularVelocity()) > 0.3) active = true;
      }
      if (rt.phase === 1 || rt.phase === 2) active = true;
    }
    for (const rt of this.parts) if (rt.phase === 1 || rt.phase === 2) active = true;

    if (!this.success) {
      if (this.check(this.goal)) {
        this.goalHold += DT;
        if (this.goalHold >= 0.25) {
          this.success = true;
          this.successTime = this.time;
          this.events.push({ t: 'goal' });
        }
      } else this.goalHold = 0;
      this.quietTime = active ? 0 : this.quietTime + DT;
      if (!this.stalled && !this.success && (this.quietTime > 2.5 || this.time > 60)) {
        this.stalled = true;
        this.events.push({ t: 'stalled' });
      }
    }
  }

  private applyForces() {
    for (const rt of this.parts) {
      if (rt.inst.kind === 'fan' && rt.on) this.blow(rt);
      else if (rt.inst.kind === 'rocket') this.rocket(rt);
    }
  }

  private blow(fan: PartRT) {
    const a = fan.inst.a * DEG;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const hw = FAN_WIDTH / 2;
    for (const rt of this.parts) {
      const b = rt.moving;
      if (!b || rt.dead || rt.def.wind <= 0) continue;
      const p = b.getPosition();
      const rx = p.x - fan.inst.x;
      const ry = p.y - fan.inst.y;
      const along = rx * dx + ry * dy;
      if (along < 0.2 || along > FAN_REACH) continue;
      const side = Math.abs(-rx * dy + ry * dx) / hw;
      if (side >= 1) continue;
      const f = WIND_K * rt.def.wind * (1 - along / FAN_REACH) * (1 - side * side);
      b.applyForceToCenter(new Vec2(dx * f, dy * f), true);
    }
  }

  private rocket(rt: PartRT) {
    if (rt.phase === 1 && this.time - rt.t0 >= FUSE_TIME) {
      rt.phase = 2;
      rt.t0 = this.time;
      const b = rt.bodies[0];
      b.setType('dynamic');
      b.setGravityScale(0);
      b.setFixedRotation(true);
      b.setBullet(true);
      rt.moving = b;
      this.events.push({ t: 'launch', id: rt.inst.id });
    }
    if (rt.phase === 2) {
      const t = this.time - rt.t0;
      const sp = Math.min(2 + 26 * t, 15);
      const a = rt.a0 + Math.PI / 2;
      rt.bodies[0].setLinearVelocity(new Vec2(Math.cos(a) * sp, Math.sin(a) * sp));
      rt.bodies[0].setAwake(true);
      if (t > 2.5 && !this.toExplode.includes(rt)) this.toExplode.push(rt);
    }
  }

  private pop(rt: PartRT) {
    if (rt.dead) return;
    rt.dead = true;
    rt.popped = true;
    rt.t0 = this.time;
    if (rt.moving) {
      const p = rt.moving.getPosition();
      rt.x = p.x;
      rt.y = p.y;
    }
    for (const b of rt.bodies) this.world.destroyBody(b);
    rt.bodies = [];
    rt.moving = null;
    this.events.push({ t: 'pop', id: rt.inst.id, x: rt.x, y: rt.y });
  }

  private explode(rt: PartRT) {
    if (rt.phase === 3) return;
    const p = rt.bodies[0].getPosition();
    const a = rt.a0 + Math.PI / 2;
    const ex = p.x + Math.cos(a) * 0.5;
    const ey = p.y + Math.sin(a) * 0.5;
    rt.x = p.x;
    rt.y = p.y;
    rt.phase = 3;
    rt.dead = true;
    rt.t0 = this.time;
    for (const b of rt.bodies) this.world.destroyBody(b);
    rt.bodies = [];
    rt.moving = null;
    this.events.push({ t: 'firework', id: rt.inst.id, x: ex, y: ey });
    for (const o of this.parts) {
      if (o === rt || o.dead) continue;
      const ox = (o.moving ? o.moving.getPosition().x : o.inst.x) - ex;
      const oy = (o.moving ? o.moving.getPosition().y : o.inst.y) - ey;
      const d = Math.hypot(ox, oy);
      if (o.inst.kind === 'balloon' && d < 1.6) this.pop(o);
      else if (o.inst.kind === 'bell' && d < 1.3 && !o.rung) this.ring(o, 6);
      else if (o.moving && d < 2.2 && d > 0.01) {
        const k = ((2.2 - d) / 2.2) * 2.5 * Math.min(o.moving.getMass(), 0.6);
        o.moving.applyLinearImpulse(new Vec2((ox / d) * k, (oy / d) * k), o.moving.getPosition(), true);
      }
    }
  }

  // ------------------------------------------------------------------- goals

  private check(g: Goal): boolean {
    switch (g.type) {
      case 'all':
        return g.goals.every((x) => this.check(x));
      case 'pop':
        return g.ids.every((id) => this.byId.get(id)?.popped);
      case 'lamp': {
        const rt = this.byId.get(g.id);
        return !!rt && rt.on;
      }
      case 'bell':
        return !!this.byId.get(g.id)?.rung;
      case 'firework':
        return this.byId.get(g.id)?.phase === 3;
      case 'topple':
        return g.ids.every((id) => {
          const rt = this.byId.get(id);
          return !!rt && (rt.dead || Math.abs(rt.a - rt.a0) > 1.0);
        });
      case 'inBucket': {
        const ball = this.byId.get(g.ball);
        const bucket = this.byId.get(g.bucket);
        if (!ball || !bucket || ball.dead) return false;
        const key = g.ball + '>' + g.bucket;
        const inside = Math.abs(ball.x - bucket.inst.x) < 0.62 && ball.y - bucket.inst.y > -0.5 && ball.y - bucket.inst.y < 0.42;
        const held = inside ? (this.bucketHold.get(key) ?? 0) + DT : 0;
        if (inside && held >= DT && held < DT * 1.5) this.events.push({ t: 'bucket', id: g.bucket });
        this.bucketHold.set(key, held);
        return held > 0.5;
      }
    }
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export type { Fixture };
