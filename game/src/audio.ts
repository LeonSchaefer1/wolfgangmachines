// Web Audio playback: decoded one-shots, seamless loops and cross-faded music.
import { save } from './save';

const FILES = [
  'ui_tap', 'ui_pick', 'ui_place', 'ui_rotate', 'ui_return', 'ui_error', 'ui_start', 'ui_stop', 'ui_hint', 'ui_panel',
  'wood_hit_1', 'wood_hit_2', 'wood_hit_3', 'metal_hit_1', 'metal_hit_2', 'rubber_bounce_1', 'rubber_bounce_2',
  'domino_1', 'domino_2', 'domino_3', 'boing', 'pop', 'basket_land', 'seesaw',
  'button_click', 'lamp_on', 'fan_loop', 'conveyor_loop', 'fuse', 'rocket_launch', 'firework', 'bell',
  'win_fanfare', 'star', 'unlock', 'confetti', 'game_complete',
] as const;
const MUSIC = ['music_menu', 'music_workshop'] as const;

export type Sfx = (typeof FILES)[number];
export type Music = (typeof MUSIC)[number];

interface Loop {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private loops = new Map<string, Loop>();
  private music: { name: Music; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantMusic: Music | null = null;
  private lastPlayed = new Map<string, number>();
  private base = './audio/';
  private suspended = false;

  /** must be called from a user gesture at least once (browsers); harmless otherwise */
  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended' && !this.suspended) void this.ctx.resume();
  }

  private init() {
    const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    // gentle limiter so stacked impacts never get harsh
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = save.sound ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = save.music ? 1 : 0;
    this.musicBus.connect(this.master);
    for (const f of FILES) void this.load(f);
    if (this.wantMusic) void this.playMusic(this.wantMusic);
  }

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.loading.get(name);
    if (!p) {
      p = fetch(this.base + name + '.ogg')
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .then((buf) => {
          this.buffers.set(name, buf);
          return buf;
        })
        .catch(() => null);
      this.loading.set(name, p);
    }
    return p;
  }

  play(name: Sfx, volume = 1, rate = 1, minGap = 0.03) {
    const c = this.ctx;
    if (!c || !save.sound || c.state !== 'running') return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = c.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < minGap) return;
    this.lastPlayed.set(name, now);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxBus);
    src.start();
  }

  /** one of several variations, slightly detuned so repeated hits sound natural */
  playVar(base: string, count: number, volume: number) {
    const i = 1 + Math.floor(Math.random() * count);
    this.play(`${base}_${i}` as Sfx, volume, 0.93 + Math.random() * 0.14, 0.045);
  }

  loop(name: Sfx, on: boolean, volume = 0.5) {
    const c = this.ctx;
    if (!c) return;
    const cur = this.loops.get(name);
    if (on && !cur) {
      const buf = this.buffers.get(name);
      if (!buf) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(volume, c.currentTime + 0.35);
      src.connect(gain).connect(this.sfxBus);
      src.start();
      this.loops.set(name, { src, gain });
    } else if (!on && cur) {
      cur.gain.gain.cancelScheduledValues(c.currentTime);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, c.currentTime);
      cur.gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
      cur.src.stop(c.currentTime + 0.35);
      this.loops.delete(name);
    }
  }

  stopLoops() {
    for (const name of [...this.loops.keys()]) this.loop(name as Sfx, false);
  }

  async playMusic(name: Music) {
    this.wantMusic = name;
    const c = this.ctx;
    if (!c) return;
    if (this.music?.name === name) return;
    const buf = await this.load(name);
    if (!buf || this.wantMusic !== name || this.music?.name === name) return;
    const t = c.currentTime;
    if (this.music) {
      const old = this.music;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 1.2);
      old.src.stop(t + 1.3);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.8, t + 1.5);
    src.connect(gain).connect(this.musicBus);
    src.start();
    this.music = { name, src, gain };
  }

  /** lowers the music while a fanfare plays */
  duck(seconds: number) {
    const c = this.ctx;
    if (!c || !this.music) return;
    const g = this.music.gain.gain;
    const t = c.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.18, t + 0.15);
    g.setValueAtTime(0.18, t + seconds);
    g.linearRampToValueAtTime(0.8, t + seconds + 1.2);
  }

  applySettings() {
    const c = this.ctx;
    if (!c) return;
    this.sfxBus.gain.setTargetAtTime(save.sound ? 1 : 0, c.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(save.music ? 1 : 0, c.currentTime, 0.2);
  }

  /** app went to the background / came back */
  setSuspended(s: boolean) {
    this.suspended = s;
    if (!this.ctx) return;
    if (s) void this.ctx.suspend();
    else void this.ctx.resume();
  }
}

export const audio = new AudioManager();

export function haptic(ms: number) {
  try {
    const bridge = (window as any).AndroidBridge;
    if (bridge?.vibrate) bridge.vibrate(ms);
    else if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* no haptics */
  }
}
