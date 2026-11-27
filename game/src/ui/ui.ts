// DOM interface: tray, dialogs, title screen, level select, coach marks.
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import './styles.css';
import { audio } from '../audio';
import { LEVELS } from '../core/levels';
import { highestUnlocked, save } from '../save';

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M12 3.2 2.8 11a1 1 0 0 0 .65 1.76H5V19a1.5 1.5 0 0 0 1.5 1.5h3.2v-5.2h4.6v5.2h3.2A1.5 1.5 0 0 0 19 19v-6.24h1.55A1 1 0 0 0 21.2 11z"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M12 2.5a6.8 6.8 0 0 0-4 12.3c.6.5 1 1.2 1 2V17h6v-.2c0-.8.4-1.500 1-2A6.8 6.8 0 0 0 12 2.500zM9.300 18.500v.700c0 1.300 1.200 2.300 2.700 2.300s2.700-1 2.700-2.300v-.7z"/></svg>',
  rotL: '<svg viewBox="0 0 24 24"><path d="M5.500 12a6.500 6.500 0 1 0 2.300-4.950"/><path d="M4.500 3.800v4.400h4.400"/></svg>',
  rotR: '<svg viewBox="0 0 24 24"><path d="M18.500 12a6.500 6.500 0 1 1-2.300-4.950"/><path d="M19.500 3.800v4.400h-4.400"/></svg>',
  flip: '<svg viewBox="0 0 24 24"><path d="M4 8.500h15M15.500 4.500l4 4-4 4M20 15.500H5M8.500 11.500l-4 4 4 4"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M6.500 6.500l11 11M17.500 6.500l-11 11"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.300l2.900 6.200 6.800.800-5 4.700 1.300 6.700L12 17.400l-6 3.300 1.300-6.700-5-4.700 6.800-.8z"/></svg>',
  lock: '<svg class="lock" viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-2.800 5a2.800 2.800 0 0 1 5.600 0v3H9.200z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 3.500v11.200a3.300 3.300 0 1 0 2 3V8.300l7-1.500v6.400a3.300 3.300 0 1 0 2 3V2.500z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M3 9.500v5h3.500L12 19V5L6.500 9.500zM15 8.200a5 5 0 0 1 0 7.600l1.300 1.500a7 7 0 0 0 0-10.600zM17.800 5l-1.300 1.500a8.500 8.500 0 0 1 0 11L17.800 19a10.500 10.500 0 0 0 0-14z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 11h10.200l-3.600-3.600L13 6l6 6-6 6-1.400-1.400 3.600-3.600H5z"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7.500 6 12 10V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3.500" y="3.500" width="7" height="7" rx="1.500"/><rect x="13.500" y="3.500" width="7" height="7" rx="1.500"/><rect x="3.500" y="13.500" width="7" height="7" rx="1.500"/><rect x="13.500" y="13.500" width="7" height="7" rx="1.500"/></svg>',
  hand: '<svg viewBox="0 0 48 48"><path d="M17 4.500c-2 0-3.500 1.600-3.500 3.500v17.200l-2.900-2.700c-1.500-1.400-3.900-1.300-5.200.3-1.200 1.400-1.100 3.500.2 4.900l9.800 11.300c1.800 2.300 4.600 3.500 7.500 3.500h7.600c5 0 9-4 9-9V23.300c0-1.900-1.500-3.500-3.500-3.500-.900 0-1.700.300-2.300.900-.300-1.700-1.700-2.900-3.400-2.900-1 0-1.900.400-2.500 1.100-.5-1.500-1.800-2.600-3.400-2.600-.700 0-1.300.200-1.900.500V8c0-1.900-1.600-3.500-3.500-3.500z" fill="#fff" stroke="#3a2412" stroke-width="2.200" stroke-linejoin="round"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h10V5z"/></svg>',
};

export interface SlotInfo {
  icon: string;
  name: string;
  count: number;
}

export interface DialogButton {
  label: string;
  icon?: keyof typeof ICON;
  kind?: 'green' | 'blue' | 'paper' | 'red';
  onClick: () => void;
}

export interface UICallbacks {
  onPlay(): void;
  onLevel(id: number): void;
  onStartStop(): void;
  onHint(): void;
  onMenu(): void;
  onRotate(dir: 1 | -1): void;
  onRemove(): void;
  onSlotDown(index: number, e: PointerEvent): void;
  onSettings(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class UI {
  root: HTMLElement;
  game!: HTMLElement;
  tray!: HTMLElement;
  private slots!: HTMLElement;
  private task!: HTMLElement;
  private btnStart!: HTMLButtonElement;
  btnHint!: HTMLButtonElement;
  private actions!: HTMLElement;
  private toastEl!: HTMLElement;
  private coachEl!: HTMLElement;
  private handEl!: HTMLElement;
  private menu!: HTMLElement;
  private levels!: HTMLElement;
  private dialogEl: HTMLElement | null = null;
  private toastTimer = 0;
  private cb: UICallbacks;
  slotEls: HTMLElement[] = [];
  dialogOpen = false;

  constructor(root: HTMLElement, cb: UICallbacks) {
    this.root = root;
    this.cb = cb;
    this.build();
  }

  private click(b: HTMLElement, fn: () => void, sound = true) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.unlock();
      if (sound) audio.play('ui_tap', 0.7);
      fn();
    });
  }

  private build() {
    const cb = this.cb;
    // ---------- game screen
    const game = (this.game = el('div', 'hidden'));
    game.id = 'game';
    const tray = (this.tray = el('aside'));
    tray.id = 'tray';
    const top = el('div', 'tray-top');
    const bMenu = el('button', 'btn small paper', `${ICON.home}`);
    bMenu.setAttribute('aria-label', 'Menü');
    this.click(bMenu, () => cb.onMenu());
    const bHint = (this.btnHint = el('button', 'btn small blue', `${ICON.bulb}Tipp`));
    bHint.id = 'btn-hint';
    this.click(bHint, () => cb.onHint(), false);
    top.append(bMenu, bHint);
    this.task = el('div');
    this.task.id = 'task';
    this.slots = el('div');
    this.slots.id = 'slots';
    const bStart = (this.btnStart = el('button', 'btn green'));
    bStart.id = 'btn-start';
    this.click(bStart, () => cb.onStartStop(), false);
    tray.append(top, this.task, this.slots, bStart);

    const actions = (this.actions = el('div', 'off'));
    actions.id = 'actions';
    this.toastEl = el('div');
    this.toastEl.id = 'toast';
    this.coachEl = el('div', 'hidden');
    this.coachEl.id = 'coach';
    this.handEl = el('div', 'hidden', ICON.hand);
    this.handEl.id = 'hand';
    game.append(tray, actions, this.toastEl, this.coachEl, this.handEl);

    // ---------- title
    const menu = (this.menu = el('div', 'overlay hidden'));
    menu.id = 'menu';
    menu.innerHTML = `<div class="logo"><small>Wolfgangs</small><b>Tüftelwerkstatt</b></div>`;
    const play = el('button', 'btn green main', `${ICON.play}Spielen`);
    this.click(play, () => cb.onPlay());
    const row = el('div', 'row');
    const lv = el('button', 'btn paper', `${ICON.grid}Alle Maschinen`);
    this.click(lv, () => this.showLevels());
    row.append(lv);
    const foot = el('div', 'menu-foot');
    const tg = el('div', 'toggles');
    tg.append(this.toggle('music'), this.toggle('sound'));
    foot.append(el('span', '', ''), tg);
    menu.append(play, row, foot);

    // ---------- level select
    const levels = (this.levels = el('div', 'overlay hidden'));
    levels.id = 'levels';

    const rotate = el('div', '', `${ICON.phone}<div>Bitte das Telefon quer halten.</div>`);
    rotate.id = 'rotate';

    this.root.append(game, menu, levels, rotate);
    this.setRunning(false);
  }

  private toggle(kind: 'music' | 'sound'): HTMLElement {
    const b = el('button', 'btn small paper');
    const render = () => {
      const on = save[kind];
      b.innerHTML = `${kind === 'music' ? ICON.note : ICON.sound}${kind === 'music' ? 'Musik' : 'Töne'}: ${on ? 'An' : 'Aus'}`;
      b.style.opacity = on ? '1' : '0.7';
    };
    render();
    this.click(b, () => {
      save[kind] = !save[kind];
      render();
      this.cb.onSettings();
    });
    return b;
  }

  // ------------------------------------------------------------- screens

  showMenu() {
    this.closeDialog();
    this.levels.classList.add('hidden');
    this.menu.classList.remove('hidden');
    this.game.classList.add('hidden');
  }

  showLevels() {
    const unlocked = highestUnlocked(LEVELS.length);
    this.levels.innerHTML = '';
    const h = el('h2', '', 'Welche Maschine möchtest du bauen?');
    const grid = el('div', 'level-grid');
    for (const L of LEVELS) {
      const stars = save.stars[L.id] ?? 0;
      const locked = L.id > unlocked;
      const t = el('button', 'tile' + (locked ? ' locked' : '') + (!locked && !stars ? ' next' : ''));
      t.innerHTML = locked
        ? `<span class="num">${L.id}</span>${ICON.lock}`
        : `<span class="num">${L.id}</span><span class="ttl">${L.title}</span><span class="mini">${[1, 2, 3].map((i) => ICON.star.replace('<svg', `<svg class="${i <= stars ? 'on' : ''}"`)).join('')}</span>`;
      if (!locked) this.click(t, () => this.cb.onLevel(L.id));
      grid.append(t);
    }
    const back = el('button', 'btn paper', `${ICON.home}Zurück`);
    this.click(back, () => this.showMenu());
    this.levels.append(h, grid, back);
    this.menu.classList.add('hidden');
    this.levels.classList.remove('hidden');
  }

  showGame() {
    this.menu.classList.add('hidden');
    this.levels.classList.add('hidden');
    this.game.classList.remove('hidden');
  }

  get inGame() {
    return !this.game.classList.contains('hidden') && this.menu.classList.contains('hidden') && this.levels.classList.contains('hidden');
  }

  // ---------------------------------------------------------------- tray

  setLevel(levelId: number, task: string, slots: SlotInfo[]) {
    this.task.innerHTML = `<span class="lvl">Maschine ${levelId} von ${LEVELS.length}</span><p>${task}</p>`;
    this.slots.innerHTML = '';
    this.slotEls = [];
    slots.forEach((s, i) => {
      const d = el('div', 'slot' + (slots.length === 1 || (slots.length === 3 && i === 2) ? ' wide' : ''));
      d.innerHTML = `<img alt="" draggable="false" src="${s.icon}"><span class="name">${s.name}</span><span class="count">${s.count}</span>`;
      d.addEventListener('pointerdown', (e) => {
        if (d.classList.contains('empty')) return;
        e.preventDefault();
        audio.unlock();
        this.cb.onSlotDown(i, e);
      });
      this.slots.append(d);
      this.slotEls.push(d);
      this.setSlotCount(i, s.count);
    });
  }

  setSlotCount(i: number, n: number) {
    const d = this.slotEls[i];
    if (!d) return;
    d.classList.toggle('empty', n <= 0);
    d.querySelector('.count')!.textContent = String(n);
  }

  setRunning(r: boolean) {
    this.game.classList.toggle('running', r);
    this.btnStart.className = 'btn ' + (r ? 'red' : 'green');
    this.btnStart.innerHTML = r ? `${ICON.stop}Stopp` : `${ICON.play}Start`;
  }

  pulseStart(on: boolean) {
    this.btnStart.classList.toggle('pulse', on);
  }

  pulseHint(on: boolean) {
    this.btnHint.classList.toggle('pulse', on);
  }

  setDropTarget(on: boolean) {
    this.tray.classList.toggle('drop-target', on);
  }

  trayLeft(): number {
    return this.tray.getBoundingClientRect().left;
  }

  /** screen area the play field may use */
  fieldArea(): { x: number; y: number; width: number; height: number } {
    const r = this.root.getBoundingClientRect();
    const cs = getComputedStyle(this.root);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const trayW = this.tray.getBoundingClientRect().width || parseFloat(getComputedStyle(document.documentElement).fontSize) * 10.6;
    const pr = parseFloat(cs.paddingRight) || 0;
    return { x: r.left + pl, y: r.top, width: r.width - pl - pr - trayW, height: r.height };
  }

  // ------------------------------------------------------- part actions

  private actionsKey = '';
  showActions(x: number, y: number, mode: 'rotate' | 'flip' | 'none' | null) {
    const a = this.actions;
    if (!mode) {
      a.classList.add('off');
      return;
    }
    if (mode !== this.actionsKey) {
      this.actionsKey = mode;
      a.innerHTML = '';
      const mk = (cls: string, icon: string, label: string, fn: () => void) => {
        const b = el('button', 'fab ' + cls, icon);
        b.setAttribute('aria-label', label);
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.click(b, fn, false);
        a.append(b);
      };
      if (mode === 'rotate') {
        mk('', ICON.rotL, 'Nach links drehen', () => this.cb.onRotate(1));
        mk('', ICON.rotR, 'Nach rechts drehen', () => this.cb.onRotate(-1));
      } else if (mode === 'flip') mk('', ICON.flip, 'Umdrehen', () => this.cb.onRotate(1));
      mk('remove', ICON.remove, 'Zurück in die Kiste', () => this.cb.onRemove());
    }
    a.classList.remove('off');
    a.style.left = x + 'px';
    a.style.top = y + 'px';
  }

  actionsSize(): { w: number; h: number } {
    const r = this.actions.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  // ------------------------------------------------------ toast / coach

  toast(text: string, ms = 3200) {
    this.toastEl.innerHTML = '';
    if (!text) return;
    this.toastEl.append(el('span', '', text));
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.innerHTML = ''), ms);
  }

  coach(text: string | null, x = 0, y = 0, side: 'above' | 'below' | 'left' = 'above') {
    const c = this.coachEl;
    if (!text) {
      c.classList.add('hidden');
      return;
    }
    c.textContent = text;
    c.className = side === 'above' ? '' : side;
    c.style.left = x + 'px';
    c.style.top = y + 'px';
  }

  hand(from: { x: number; y: number } | null, to?: { x: number; y: number }) {
    const h = this.handEl;
    if (!from || !to) {
      h.classList.add('hidden');
      return;
    }
    h.style.setProperty('--x0', from.x + 'px');
    h.style.setProperty('--y0', from.y + 'px');
    h.style.setProperty('--x1', to.x + 'px');
    h.style.setProperty('--y1', to.y + 'px');
    h.classList.remove('hidden');
  }

  slotCenter(i: number): { x: number; y: number } {
    const r = this.slotEls[i]?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 };
  }

  startCenter(): { x: number; y: number } {
    const r = this.btnStart.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ------------------------------------------------------------- dialogs

  dialog(opts: { sub?: string; title: string; text?: string; stars?: number; buttons: DialogButton[]; column?: boolean; extra?: HTMLElement; light?: boolean; fieldOnly?: boolean }) {
    this.closeDialog();
    const ov = el('div', 'overlay' + (opts.light ? ' light' : ''));
    if (opts.fieldOnly) ov.style.right = 'calc(var(--tray-w) + env(safe-area-inset-right, 0px))';
    const card = el('div', 'card');
    if (opts.sub) card.append(el('div', 'sub', opts.sub));
    if (opts.stars !== undefined) {
      const s = el('div', 'stars');
      s.innerHTML = [1, 2, 3].map((i) => ICON.star.replace('<svg', `<svg class="${i <= opts.stars! ? 'on' : ''}"`)).join('');
      card.append(s);
    }
    card.append(el('h2', '', opts.title));
    if (opts.text) card.append(el('p', '', opts.text));
    const row = el('div', opts.column ? 'col' : 'row');
    for (const b of opts.buttons) {
      const btn = el('button', 'btn ' + (b.kind ?? 'paper'), `${b.icon ? ICON[b.icon] : ''}${b.label}`);
      this.click(btn, b.onClick);
      row.append(btn);
    }
    card.append(row);
    if (opts.extra) card.append(opts.extra);
    ov.append(card);
    ov.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.append(ov);
    this.dialogEl = ov;
    this.dialogOpen = true;
    audio.play('ui_panel', 0.5);
  }

  settingsRow(): HTMLElement {
    const tg = el('div', 'toggles');
    tg.append(this.toggle('music'), this.toggle('sound'));
    return tg;
  }

  closeDialog() {
    this.dialogEl?.remove();
    this.dialogEl = null;
    this.dialogOpen = false;
  }
}
