// The game controller: level loading, build-mode interaction, running the machine, rewards.
import { audio, haptic, type Sfx } from './audio';
import { DEMO, LEVELS, makeUserPart } from './core/levels';
import { PARTS, halfExtents, partName } from './core/parts';
import { aabbHalf, clampToField, isFree, settle, snap } from './core/placement';
import { DT, Sim } from './core/sim';
import { FIELD_H, FIELD_W, type InventoryItem, type Level, type Mat, type PartInst, type SimEvent } from './core/types';
import { Cable, Fx } from './render/fx';
import { partIcon } from './render/icons';
import { createPartView, type Frame, type PartView } from './render/partViews';
import type { Quality, Stage } from './render/stage';
import { highestUnlocked, persist, save } from './save';
import { UI } from './ui/ui';

interface Drag {
  inst: PartInst;
  view: PartView;
  pointerId: number;
  touch: boolean;
  fromTray: boolean;
  slot: number;
  startX: number;
  startY: number;
  moved: boolean;
  grabX: number;
  grabY: number;
  origin: { x: number; y: number } | null;
  overTray: boolean;
}

interface Slot {
  item: InventoryItem;
  used: (PartInst | null)[];
}

const PRAISE = ['Prima gemacht, Wolfgang!', 'Die Maschine läuft wie geschmiert!', 'Ein echter Tüftler!', 'Genau so war es gedacht!', 'Großartig – das hat geklappt!', 'Meisterlich gelöst!'];
const BALLOON_HEX = [0xe5393b, 0x2f8de0, 0xf5b81c, 0x3fae52, 0xa24bd6];

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Game {
  stage: Stage;
  ui: UI;
  fx: Fx;
  level: Level = LEVELS[0];
  views = new Map<string, PartView>();
  placed: PartInst[] = [];
  slots: Slot[] = [];
  cables: { cable: Cable; from: string; to: string }[] = [];
  ghosts: PartView[] = [];
  sim: Sim | null = null;
  mode: 'menu' | 'build' | 'run' = 'menu';
  selected: PartInst | null = null;
  drag: Drag | null = null;

  private hintStep = 0;
  private solutionShown = false;
  private fails = 0;
  private acc = 0;
  private last = 0;
  private lastRender = 0;
  private wonAt = -1;
  private winShown = false;
  private lastFixedToast = 0;
  private frameEma = 1 / 60;
  private slowFrames = 0;
  private runFrames = 0;
  private trailT = 0;
  private fanOn = false;
  private beltOn = false;
  paused = false;
  /** bumped whenever the tutorial hints need to be re-evaluated */
  private coachDirty = true;
  private frame: Frame = { t: 0, dt: 0, alpha: 1, running: false, simTime: 0 };

  constructor(stage: Stage, root: HTMLElement) {
    this.stage = stage;
    this.fx = new Fx(stage.scene);
    this.ui = new UI(root, {
      onPlay: () => this.play(),
      onLevel: (id) => this.loadLevel(id),
      onStartStop: () => (this.mode === 'run' ? this.stop() : this.start()),
      onHint: () => this.hint(),
      onMenu: () => this.pauseMenu(),
      onRotate: (d) => this.rotateSelected(d),
      onRemove: () => this.removeSelected(),
      onSlotDown: (i, e) => this.slotDown(i, e),
      onSettings: () => {
        audio.applySettings();
        persist();
      },
    });
    window.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    this.startDemo();
    this.ui.showMenu();
    void audio.playMusic('music_menu');
  }

  // --------------------------------------------------------------- layout

  layout() {
    const area = this.ui.fieldArea();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const frame = 0.2;
    const s = Math.min(area.width / (FIELD_W + 2 * frame), area.height / (FIELD_H + 2 * frame));
    const w = FIELD_W * s;
    const h = FIELD_H * s;
    this.stage.layout({ x: area.x + (area.width - w) / 2, y: area.y + (area.height - h) / 2, width: w, height: h }, vw, vh);
    this.coachDirty = true;
  }

  // ---------------------------------------------------------------- levels

  /** a small machine that runs by itself behind the title screen */
  private startDemo() {
    if (this.level !== DEMO || this.views.size === 0) this.buildScene(DEMO);
    this.sim = new Sim(DEMO.parts, DEMO.goal);
    for (const v of this.views.values()) v.rt = this.sim.byId.get(v.inst.id) ?? null;
    this.acc = 0;
  }

  play() {
    const next = highestUnlocked(LEVELS.length);
    const firstOpen = LEVELS.find((l) => !save.stars[l.id]);
    this.loadLevel(firstOpen ? Math.min(firstOpen.id, next) : save.lastLevel || 1);
  }

  private clearScene() {
    this.stopSim();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    for (const c of this.cables) c.cable.dispose();
    this.cables = [];
    this.clearGhosts();
    this.placed = [];
    this.slots = [];
    this.selected = null;
    this.drag = null;
    this.fx.clear();
  }

  private addView(inst: PartInst): PartView {
    const v = createPartView(inst);
    this.stage.world.add(v.root);
    this.views.set(inst.id, v);
    return v;
  }

  private buildScene(level: Level) {
    this.clearScene();
    this.level = level;
    for (const p of level.parts) this.addView(p);
    this.slots = level.inventory.map((item) => ({ item, used: new Array(item.count).fill(null) }));
    const wire = (from: string, targets?: string[]) => {
      for (const to of targets ?? []) this.cables.push({ cable: new Cable(this.stage.world), from, to });
    };
    for (const p of level.parts) if (p.kind === 'button') wire(p.id, p.targets);
    this.slots.forEach((s) => {
      if (s.item.kind === 'button') for (let i = 0; i < s.item.count; i++) wire(makeUserPart(s.item, i, 0, 0).id, s.item.targets);
    });
  }

  loadLevel(id: number) {
    const level = LEVELS[id - 1];
    if (!level) return;
    this.buildScene(level);
    this.mode = 'build';
    this.hintStep = 0;
    this.solutionShown = false;
    this.fails = 0;
    this.wonAt = -1;
    this.winShown = false;
    save.lastLevel = id;
    persist();
    this.ui.showGame();
    this.layout();
    this.ui.setLevel(
      id,
      level.task,
      this.slots.map((s) => ({ icon: partIcon(this.stage, s.item.kind, s.item.len), name: partName(s.item.kind, s.item.len), count: s.item.count })),
    );
    this.ui.setRunning(false);
    this.ui.pulseStart(false);
    this.ui.pulseHint(false);
    this.ui.toast('');
    void audio.playMusic('music_workshop');
    if (id === 1 && !save.stars[1]) this.showGhosts();
    this.ui.dialog({
      sub: `Maschine ${id} von ${LEVELS.length}`,
      title: level.title,
      text: level.intro,
      buttons: [{ label: "Los geht's!", kind: 'green', icon: 'play', onClick: () => (this.ui.closeDialog(), this.showFocus()) }],
    });
    // compile all shaders now, so nothing stutters when the machine starts
    this.stage.renderer.compile(this.stage.scene, this.stage.camera);
    this.coachDirty = true;
  }

  /** a little sparkle on the things the task is about, so the eye finds them */
  private showFocus() {
    (this.level.focus ?? []).forEach((id, i) => {
      window.setTimeout(() => {
        const v = this.views.get(id);
        if (!v || this.mode !== 'build') return;
        v.pop = 1;
        this.fx.sparkle(v.inst.x, v.inst.y, 14, 0xffe07a, 3.2);
        audio.play('star', 0.25, 1.2 + i * 0.15, 0);
      }, 250 + i * 450);
    });
  }

  // --------------------------------------------------------------- run / stop

  start() {
    if (this.mode !== 'build' || this.ui.dialogOpen) return;
    this.dropDrag();
    this.select(null);
    const insts = [...this.level.parts, ...this.placed];
    this.sim = new Sim(insts, this.level.goal);
    for (const v of this.views.values()) v.rt = this.sim.byId.get(v.inst.id) ?? null;
    this.mode = 'run';
    this.acc = 0;
    this.wonAt = -1;
    this.winShown = false;
    this.runFrames = 0;
    this.ui.setRunning(true);
    this.ui.pulseStart(false);
    this.ui.pulseHint(false);
    this.ui.toast('');
    for (const g of this.ghosts) g.root.visible = false;
    audio.play('ui_start', 0.8);
    haptic(15);
    this.coachDirty = true;
  }

  private stopSim() {
    this.sim = null;
    for (const v of this.views.values()) v.rt = null;
    audio.stopLoops();
    this.fanOn = this.beltOn = false;
  }

  stop() {
    if (this.mode !== 'run') return;
    this.stopSim();
    this.mode = 'build';
    this.ui.setRunning(false);
    this.ui.pulseStart(false);
    this.ui.toast('');
    this.ui.closeDialog();
    for (const g of this.ghosts) g.root.visible = true;
    audio.play('ui_stop', 0.7);
    if (this.fails >= 2 && !this.solutionShown) this.ui.pulseHint(true);
    this.coachDirty = true;
  }

  // ------------------------------------------------------------------ hints

  private hint() {
    if (this.mode !== 'build') return;
    audio.play('ui_hint', 0.8);
    this.ui.pulseHint(false);
    const hints = this.level.hints;
    if (this.hintStep < hints.length) {
      const text = hints[this.hintStep++];
      this.ui.dialog({
        sub: `Tipp ${this.hintStep} von ${hints.length}`,
        title: 'Ein kleiner Tipp',
        text,
        fieldOnly: true,
        light: true,
        buttons: [{ label: 'Alles klar', kind: 'green', onClick: () => this.ui.closeDialog() }],
      });
    } else if (!this.solutionShown) {
      this.ui.dialog({
        title: 'Soll ich es dir zeigen?',
        text: 'Ich kann dir zeigen, wo die Teile hingehören. Du musst sie dann nur noch dorthin legen.',
        fieldOnly: true,
        light: true,
        buttons: [
          { label: 'Ja, bitte zeigen', kind: 'green', onClick: () => (this.ui.closeDialog(), this.showGhosts(), (this.solutionShown = true)) },
          { label: 'Nein, ich probiere weiter', onClick: () => this.ui.closeDialog() },
        ],
      });
    } else {
      this.ui.toast('Lege die Teile auf die hellblauen Umrisse.');
    }
  }

  private showGhosts() {
    this.clearGhosts();
    this.level.solution.forEach((s, i) => {
      const v = createPartView({ id: 'ghost' + i, kind: s.kind, x: s.x, y: s.y, a: s.a, fixed: false, len: s.len, flip: s.flip }, true);
      this.stage.world.add(v.root);
      this.ghosts.push(v);
    });
  }

  private clearGhosts() {
    for (const g of this.ghosts) g.dispose();
    this.ghosts = [];
  }

  /** when the solution is shown, a part dropped near its outline snaps exactly into it */
  private snapToGhost(inst: PartInst): boolean {
    let best: PartView | null = null;
    let bd = 0.9;
    for (const g of this.ghosts) {
      const gi = g.inst;
      if (gi.kind !== inst.kind || (gi.len ?? 0) !== (inst.len ?? 0)) continue;
      if (this.placed.some((p) => p !== inst && p.kind === gi.kind && Math.abs(p.x - gi.x) < 0.01 && Math.abs(p.y - gi.y) < 0.01)) continue;
      const d = Math.hypot(gi.x - inst.x, gi.y - inst.y);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    if (!best) return false;
    const keep = { x: inst.x, y: inst.y, a: inst.a, flip: inst.flip };
    inst.x = best.inst.x;
    inst.y = best.inst.y;
    inst.a = best.inst.a;
    inst.flip = best.inst.flip;
    if (isFree(inst, this.allInsts())) return true;
    Object.assign(inst, keep);
    return false;
  }

  // ------------------------------------------------------------ build input

  private allInsts(): PartInst[] {
    return [...this.level.parts, ...this.placed];
  }

  private select(inst: PartInst | null) {
    if (this.selected) {
      const v = this.views.get(this.selected.id);
      if (v) v.selected = false;
    }
    this.selected = inst;
    if (inst) {
      const v = this.views.get(inst.id);
      if (v) v.selected = true;
    }
  }

  private pick(wx: number, wy: number, pool: PartInst[], margin: number): PartInst | null {
    let best: PartInst | null = null;
    let bd = Infinity;
    for (const p of pool) {
      const { hw, hh } = halfExtents(p);
      const a = (-p.a * Math.PI) / 180;
      const dx = wx - p.x;
      const dy = wy - p.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const ox = Math.max(0, Math.abs(lx) - hw);
      const oy = Math.max(0, Math.abs(ly) - hh);
      const d = Math.hypot(ox, oy);
      if (d > margin) continue;
      const score = d + Math.hypot(lx, ly) * 0.01;
      if (score < bd) {
        bd = score;
        best = p;
      }
    }
    return best;
  }

  private takeFromSlot(i: number, x: number, y: number): PartInst | null {
    const s = this.slots[i];
    if (!s) return null;
    const idx = s.used.findIndex((u) => u === null);
    if (idx < 0) return null;
    const inst = makeUserPart(s.item, idx, x, y, 0, false);
    s.used[idx] = inst;
    this.placed.push(inst);
    this.addView(inst);
    this.ui.setSlotCount(i, s.used.filter((u) => u === null).length);
    return inst;
  }

  private returnToTray(inst: PartInst) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const idx = s.used.indexOf(inst);
      if (idx >= 0) {
        s.used[idx] = null;
        this.ui.setSlotCount(i, s.used.filter((u) => u === null).length);
      }
    }
    this.placed = this.placed.filter((p) => p !== inst);
    this.views.get(inst.id)?.dispose();
    this.views.delete(inst.id);
    if (this.selected === inst) this.select(null);
    audio.play('ui_return', 0.7);
    this.coachDirty = true;
  }

  private slotDown(i: number, e: PointerEvent) {
    if (this.mode !== 'build' || this.drag || this.ui.dialogOpen) return;
    const w = this.stage.toWorld(e.clientX, e.clientY);
    const inst = this.takeFromSlot(i, w.x, w.y);
    if (!inst) return;
    const view = this.views.get(inst.id)!;
    clampToField(inst);
    view.snapPose();
    view.liftTarget = 1;
    this.select(inst);
    this.drag = { inst, view, pointerId: e.pointerId, touch: e.pointerType !== 'mouse', fromTray: true, slot: i, startX: e.clientX, startY: e.clientY, moved: false, grabX: 0, grabY: 0, origin: null, overTray: true };
    audio.play('ui_pick', 0.7);
    this.coachDirty = true;
  }

  private pointerDown(e: PointerEvent) {
    audio.unlock();
    if (this.mode !== 'build' || this.drag || this.ui.dialogOpen || !this.ui.inGame) return;
    const target = e.target as HTMLElement;
    if (target.closest('#tray') || target.closest('#actions')) return;
    const w = this.stage.toWorld(e.clientX, e.clientY);
    const touch = e.pointerType !== 'mouse';
    const inst = this.pick(w.x, w.y, this.placed, touch ? 0.34 : 0.12);
    if (inst) {
      const view = this.views.get(inst.id)!;
      this.select(inst);
      this.drag = { inst, view, pointerId: e.pointerId, touch, fromTray: false, slot: -1, startX: e.clientX, startY: e.clientY, moved: false, grabX: inst.x - w.x, grabY: inst.y - w.y, origin: { x: inst.x, y: inst.y }, overTray: false };
      return;
    }
    this.select(null);
    const fixed = this.pick(w.x, w.y, this.level.parts, 0.05);
    if (fixed) {
      const v = this.views.get(fixed.id);
      if (v) v.pop = 1;
      const now = performance.now();
      if (now - this.lastFixedToast > 6000) {
        this.lastFixedToast = now;
        this.ui.toast('Dieses Teil ist fest angeschraubt. Deine Teile liegen rechts in der Kiste.', 3500);
      }
      audio.play('ui_error', 0.35);
    }
  }

  private pointerMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const distPx = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (!d.moved) {
      if (distPx < (d.touch ? 9 : 4)) return;
      d.moved = true;
      d.view.liftTarget = 1;
      if (!d.fromTray) audio.play('ui_pick', 0.6);
      this.coachDirty = true;
    }
    const w = this.stage.toWorld(e.clientX, e.clientY);
    // on touch screens the part floats above the finger so it stays visible
    const liftY = d.touch ? (d.fromTray ? 1 : Math.min(1, distPx / 50)) * (0.75 + halfExtents(d.inst).hh * 0.6) : 0;
    d.inst.x = snap(w.x + d.grabX);
    d.inst.y = snap(w.y + d.grabY + liftY);
    clampToField(d.inst);
    d.overTray = e.clientX >= this.ui.trayLeft();
    d.view.invalid = !d.overTray && !isFree(d.inst, this.allInsts());
    this.ui.setDropTarget(d.overTray && !d.fromTray);
  }

  private pointerUp(e: PointerEvent, cancelled = false) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    d.view.liftTarget = 0;
    d.view.invalid = false;
    this.ui.setDropTarget(false);
    if (!d.moved && d.fromTray) {
      // a simple tap on the toolbox: put the part in the middle of the wall
      d.inst.x = snap(FIELD_W / 2);
      d.inst.y = snap(FIELD_H / 2 + 0.5);
      if (!settle(d.inst, this.allInsts(), 3)) return this.returnToTray(d.inst);
      d.view.pop = 1;
      audio.play('ui_place', 0.7);
      this.ui.toast('Ziehe das Teil mit dem Finger an die richtige Stelle.', 3000);
      this.coachDirty = true;
      return;
    }
    if (!d.moved) return;
    if (d.overTray || cancelled) {
      if (d.fromTray || d.overTray) return this.returnToTray(d.inst);
      if (d.origin) Object.assign(d.inst, d.origin);
      return;
    }
    const snapped = this.ghosts.length > 0 && this.snapToGhost(d.inst);
    if (!snapped && !settle(d.inst, this.allInsts(), 1.5)) {
      audio.play('ui_error', 0.6);
      this.ui.toast('Hier ist kein Platz für das Teil.', 2200);
      if (d.origin) Object.assign(d.inst, d.origin);
      else return this.returnToTray(d.inst);
      return;
    }
    audio.play('ui_place', 0.8);
    haptic(10);
    const { hy } = aabbHalf(d.inst);
    this.fx.dust(d.inst.x, d.inst.y - hy, 2);
    if (snapped) {
      d.view.pop = 1;
      this.fx.sparkle(d.inst.x, d.inst.y, 12, 0x9fe0ff, 3);
    }
    this.coachDirty = true;
  }

  private dropDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.view.liftTarget = 0;
    d.view.invalid = false;
    this.ui.setDropTarget(false);
    if (!settle(d.inst, this.allInsts(), 2)) this.returnToTray(d.inst);
  }

  private rotateSelected(dir: 1 | -1) {
    const inst = this.selected;
    if (!inst || this.mode !== 'build') return;
    const def = PARTS[inst.kind];
    const before = { a: inst.a, flip: inst.flip, x: inst.x, y: inst.y };
    if (def.flips) inst.flip = !inst.flip;
    else if (def.rotStep) {
      let a = inst.a + dir * def.rotStep;
      if (def.rotMin !== undefined) a = Math.max(def.rotMin, Math.min(def.rotMax!, a));
      else {
        if (a > 180) a -= 360;
        if (a <= -180) a += 360;
      }
      inst.a = a;
    } else return;
    if (inst.a === before.a && inst.flip === before.flip) {
      audio.play('ui_error', 0.4);
      return;
    }
    if (!settle(inst, this.allInsts(), 1.0)) {
      Object.assign(inst, before);
      audio.play('ui_error', 0.6);
      this.ui.toast('So herum passt es hier nicht hin.', 2200);
      return;
    }
    audio.play('ui_rotate', 0.8);
    haptic(8);
  }

  private removeSelected() {
    if (this.selected && this.mode === 'build') this.returnToTray(this.selected);
  }

  // ------------------------------------------------------------------ menus

  private pauseMenu() {
    if (this.ui.dialogOpen) return;
    this.ui.dialog({
      title: 'Pause',
      column: true,
      buttons: [
        { label: 'Weiterspielen', kind: 'green', icon: 'play', onClick: () => this.ui.closeDialog() },
        { label: 'Alle Teile zurück in die Kiste', icon: 'replay', onClick: () => this.loadLevel(this.level.id) },
        { label: 'Andere Maschine wählen', icon: 'grid', onClick: () => this.toMenu(true) },
      ],
      extra: this.ui.settingsRow(),
    });
  }

  toMenu(levels = false) {
    this.stop();
    this.stopSim();
    this.mode = 'menu';
    this.select(null);
    this.startDemo();
    this.ui.coach(null);
    this.ui.hand(null);
    this.ui.showMenu();
    this.layout();
    if (levels) this.ui.showLevels();
    void audio.playMusic('music_menu');
  }

  /** Android back button. Returns false when the app may close. */
  back(): boolean {
    if (this.ui.dialogOpen) {
      if (!this.winShown) this.ui.closeDialog();
      return true;
    }
    if (this.mode === 'run') {
      this.stop();
      return true;
    }
    if (this.mode === 'build') {
      this.pauseMenu();
      return true;
    }
    if (!document.getElementById('levels')!.classList.contains('hidden')) {
      this.ui.showMenu();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- sim events

  private hitSound(ma: Mat, mb: Mat, v: number) {
    const vol = Math.min(1, Math.max(0.06, (v - 0.9) / 11));
    const has = (m: Mat) => ma === m || mb === m;
    if (has('mat')) return;
    if (has('domino')) audio.playVar('domino', 3, vol * 0.9 + 0.1);
    else if (has('soft')) audio.playVar('rubber_bounce', 2, vol * 0.45);
    else if (has('rubber')) audio.playVar('rubber_bounce', 2, vol);
    else if (has('bucket')) audio.playVar('metal_hit', 2, vol * 0.8);
    else if (has('metal')) audio.playVar('metal_hit', 2, vol * 0.85);
    else audio.playVar('wood_hit', 3, vol);
  }

  private onEvent(e: SimEvent) {
    if (this.mode === 'menu') {
      // the title-screen machine is silent, it only shows its effects
      if (e.t === 'hit' && e.v > 4) this.fx.dust(e.x, e.y, e.v);
      else if (e.t === 'button') this.fx.sparkle(e.x, e.y + 0.3, 8, 0xffe07a, 2.5);
      else if (e.t === 'goal') this.fx.sparkle(DEMO.parts.find((p) => p.kind === 'bucket')!.x, 1.3, 16, 0xffe07a, 4);
      return;
    }
    switch (e.t) {
      case 'hit':
        this.hitSound(e.ma, e.mb, e.v);
        if (e.v > 4) this.fx.dust(e.x, e.y, e.v);
        break;
      case 'pop': {
        audio.play('pop', 0.9);
        haptic(25);
        this.fx.pop(e.x, e.y, BALLOON_HEX[hashId(e.id) % BALLOON_HEX.length]);
        break;
      }
      case 'button':
        audio.play('button_click', 0.9);
        this.fx.sparkle(e.x, e.y + 0.3, 8, 0xffe07a, 2.5);
        haptic(15);
        break;
      case 'power':
        if (e.kind === 'lamp') audio.play('lamp_on', 0.9);
        break;
      case 'boing':
        audio.play('boing', Math.min(1, 0.35 + e.v / 16), 0.95 + Math.random() * 0.1);
        break;
      case 'bell':
        audio.play('bell', Math.min(1, 0.5 + e.v / 12));
        {
          const rt = this.sim?.byId.get(e.id);
          if (rt) this.fx.sparkle(rt.inst.x, rt.inst.y, 14, 0xffe07a, 4);
        }
        break;
      case 'bucket':
        audio.play('basket_land', 0.9);
        break;
      case 'fuse':
        audio.play('fuse', 0.8);
        break;
      case 'launch':
        audio.play('rocket_launch', 0.9);
        break;
      case 'firework':
        audio.play('firework', 1);
        haptic(40);
        this.fx.firework(e.x, e.y, true);
        break;
      case 'goal':
        this.wonAt = this.frame.t;
        break;
      case 'stalled':
        this.fails++;
        this.ui.toast('Noch nicht ganz! Tippe auf „Stopp“ und probiere etwas anderes.', 6000);
        this.ui.pulseStart(true);
        break;
    }
  }

  private win() {
    this.winShown = true;
    const id = this.level.id;
    const stars = this.solutionShown && !(id === 1) ? 1 : this.hintStep > 0 ? 2 : 3;
    const first = !save.stars[id];
    save.stars[id] = Math.max(save.stars[id] ?? 0, stars);
    save.solvedCount++;
    persist();
    const last = id >= LEVELS.length;
    const allDone = LEVELS.every((l) => save.stars[l.id]);
    this.fx.celebrate();
    haptic(60);
    this.ui.toast('');
    this.ui.pulseStart(false);
    if (last && allDone) {
      audio.duck(9);
      audio.play('game_complete', 1);
    } else {
      audio.duck(4);
      audio.play('win_fanfare', 1);
    }
    audio.play('confetti', 0.6);
    window.setTimeout(() => {
      if (!this.winShown || this.level.id !== id) return;
      for (let i = 0; i < stars; i++) window.setTimeout(() => audio.play('star', 0.7, 1 + i * 0.12, 0), 150 + i * 350);
      if (last && allDone) {
        this.ui.dialog({
          sub: 'Alle Maschinen laufen!',
          stars,
          title: 'Meisterstück, Wolfgang!',
          text: 'Du hast alle zehn Maschinen zum Laufen gebracht. Die Werkstatt ist stolz auf dich! Du kannst jede Maschine jederzeit noch einmal bauen.',
          light: true,
          fieldOnly: true,
          buttons: [
            { label: 'Alle Maschinen', kind: 'green', icon: 'grid', onClick: () => this.toMenu(true) },
            { label: 'Nochmal ansehen', icon: 'replay', onClick: () => this.ui.closeDialog() },
          ],
        });
        return;
      }
      this.ui.dialog({
        sub: `Maschine ${id} geschafft`,
        stars,
        title: PRAISE[(id + save.solvedCount) % PRAISE.length],
        text: stars === 3 ? 'Ganz ohne Hilfe gelöst – drei Sterne!' : stars === 2 ? 'Mit einem kleinen Tipp gelöst – zwei Sterne!' : 'Geschafft! Beim nächsten Mal klappt es bestimmt auch ohne Hilfe.',
        light: true,
        fieldOnly: true,
        buttons: [
          last
            ? { label: 'Alle Maschinen', kind: 'green', icon: 'grid', onClick: () => this.toMenu(true) }
            : { label: 'Nächste Maschine', kind: 'green', icon: 'next', onClick: () => this.loadLevel(id + 1) },
          { label: 'Nochmal bauen', icon: 'replay', onClick: () => (this.ui.closeDialog(), this.stop()) },
        ],
      });
      if (first && !last) audio.play('unlock', 0.6);
    }, 1500);
  }

  // ------------------------------------------------------------------ frame

  /** returns true when a frame was rendered */
  tick(nowMs: number): boolean {
    const now = nowMs / 1000;
    if (this.paused) {
      this.last = now;
      return false;
    }
    // cap at 60 fps on 120 Hz screens; idle build mode runs at 30 fps to keep the phone cool
    const idle = this.mode !== 'run' && !this.drag && !this.fx.busy && this.mode !== 'menu';
    const minGap = idle ? 0.03 : 0.0155;
    if (now - this.lastRender < minGap) return false;
    this.lastRender = now;
    let dt = now - this.last;
    this.last = now;
    if (dt > 0.1 || dt <= 0) dt = 1 / 60;

    const f = this.frame;
    f.t = now;
    f.dt = dt;
    f.running = !!this.sim && (this.mode === 'run' || this.mode === 'menu');
    if (f.running && this.sim) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 3) {
        this.sim.step();
        this.acc -= DT;
        n++;
        for (const e of this.sim.drain()) this.onEvent(e);
      }
      if (this.acc > DT) this.acc = 0;
      f.alpha = this.acc / DT;
      f.simTime = this.sim.time - (1 - f.alpha) * DT;
      if (this.mode === 'menu') {
        if (this.sim.time > (this.sim.success ? this.sim.successTime + 3.5 : 16)) this.startDemo();
      } else {
        this.runEffects(dt);
        if (this.wonAt > 0 && !this.winShown && now - this.wonAt > 0.9) this.win();
        this.guardPerformance(dt);
      }
    } else {
      f.alpha = 1;
      f.simTime = 0;
    }

    for (const v of this.views.values()) v.update(f);
    for (const g of this.ghosts) {
      g.update(f);
      const s = 1 + Math.sin(now * 3.5) * 0.03;
      g.root.scale.set(s, s, s);
    }
    for (const c of this.cables) {
      const a = this.views.get(c.from);
      const b = this.views.get(c.to);
      c.cable.mesh.visible = !!a && !!b;
      if (a && b) c.cable.update(a.dx, a.dy - 0.1, b.dx, b.dy + (b.inst.kind === 'lamp' ? 0.55 : 0), !!(f.running && this.sim?.byId.get(c.to)?.on), dt);
    }
    this.fx.update(dt);
    this.updateOverlay();
    this.stage.shadowsDirty = true;
    this.stage.render();
    return true;
  }

  /** test hook: advance the running machine without waiting for real time */
  debugAdvance(seconds: number) {
    if (!this.sim) return;
    for (let i = 0; i < seconds * 60; i++) {
      this.sim.step();
      for (const e of this.sim.drain()) this.onEvent(e);
    }
  }

  /** continuous effects while the machine runs: loops, rocket exhaust */
  private runEffects(dt: number) {
    const sim = this.sim!;
    let fan = false;
    let belt = false;
    this.trailT += dt;
    const emit = this.trailT > 0.03;
    if (emit) this.trailT = 0;
    for (const rt of sim.parts) {
      if (rt.inst.kind === 'fan' && rt.on) fan = true;
      else if (rt.inst.kind === 'conveyor' && rt.on) belt = true;
      else if (rt.inst.kind === 'rocket' && emit) {
        const a = rt.a0 + Math.PI / 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        if (rt.phase === 1) this.fx.fuse(rt.x - dx * 0.55, rt.y - dy * 0.55);
        else if (rt.phase === 2) this.fx.exhaust(rt.x - dx * 0.6, rt.y - dy * 0.6, dx, dy);
      }
    }
    if (fan !== this.fanOn) audio.loop('fan_loop', (this.fanOn = fan), 0.4);
    if (belt !== this.beltOn) audio.loop('conveyor_loop', (this.beltOn = belt), 0.4);
  }

  /** if the phone cannot hold the frame rate, quietly lower the render quality */
  private guardPerformance(dt: number) {
    this.runFrames++;
    if (this.runFrames < 45) return;
    this.frameEma += (dt - this.frameEma) * 0.05;
    if (this.frameEma > 1 / 48) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.stage.quality > 0) {
      this.stage.setQuality((this.stage.quality - 1) as Quality);
      save.quality = this.stage.quality;
      persist();
      this.slowFrames = 0;
      this.runFrames = 0;
      this.frameEma = 1 / 60;
    }
  }

  private updateOverlay() {
    // action buttons beside the selected part
    const sel = this.selected;
    if (sel && this.mode === 'build' && !this.drag?.moved && !this.ui.dialogOpen) {
      const def = PARTS[sel.kind];
      const p = this.stage.toScreen(sel.x, sel.y);
      const { hy } = aabbHalf(sel);
      const size = this.ui.actionsSize();
      const gap = 12;
      let y = p.y + hy * this.stage.scale + gap;
      if (y + size.h > window.innerHeight - 6) y = p.y - hy * this.stage.scale - gap - size.h;
      const area = this.ui.fieldArea();
      const x = Math.max(area.x + size.w / 2 + 6, Math.min(this.ui.trayLeft() - size.w / 2 - 6, p.x));
      this.ui.showActions(x, y, def.flips ? 'flip' : def.rotStep ? 'rotate' : 'none');
    } else this.ui.showActions(0, 0, null);

    if (this.coachDirty) {
      this.coachDirty = false;
      this.updateCoach();
    }
  }

  /** hand-holding for the very first level */
  private updateCoach() {
    const ui = this.ui;
    const tutorial = this.level.id === 1 && !save.stars[1] && this.mode !== 'menu';
    if (!tutorial || ui.dialogOpen || this.drag?.moved) {
      ui.coach(null);
      ui.hand(null);
      if (tutorial && ui.dialogOpen) this.coachDirty = true;
      return;
    }
    if (this.mode === 'run') {
      ui.coach(null);
      ui.hand(null);
      return;
    }
    const sol = this.level.solution[0];
    const target = this.stage.toScreen(sol.x, sol.y);
    const done = this.placed.some((p) => Math.abs(p.x - sol.x) < 0.01 && Math.abs(p.y - sol.y) < 0.01 && p.a === sol.a);
    if (done) {
      ui.hand(null);
      const s = ui.startCenter();
      ui.coach('Jetzt auf „Start“ tippen!', ui.trayLeft() - 14, s.y, 'left');
      ui.pulseStart(true);
    } else if (this.placed.length === 0) {
      ui.pulseStart(false);
      ui.hand(ui.slotCenter(0), target);
      ui.coach('Ziehe das Brett aus der Kiste hierher', target.x, target.y - 34, 'above');
    } else {
      ui.pulseStart(false);
      const p = this.stage.toScreen(this.placed[0].x, this.placed[0].y);
      ui.hand(p, target);
      ui.coach('Schiebe das Brett auf den hellblauen Umriss', target.x, target.y - 34, 'above');
    }
  }
}
