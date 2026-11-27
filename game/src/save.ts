// Progress and settings, kept in localStorage (persisted by the Android WebView).
const KEY = 'wolfgangs-werkstatt-v1';

export interface SaveData {
  /** level id -> stars (1..3) */
  stars: Record<number, number>;
  music: boolean;
  sound: boolean;
  /** render quality chosen by the automatic performance guard: 0..2 */
  quality: number;
  /** how often a level was solved in total (for the little statistics on the title screen) */
  solvedCount: number;
  lastLevel: number;
}

const defaults: SaveData = { stars: {}, music: true, sound: true, quality: 2, solvedCount: 0, lastLevel: 1 };

export const save: SaveData = load();

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* private mode or blocked storage: play without saving */
  }
  return { ...defaults, stars: {} };
}

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* ignore */
  }
}

export function highestUnlocked(total: number): number {
  let n = 1;
  for (let i = 1; i <= total; i++) if (save.stars[i]) n = Math.min(total, i + 1);
  return n;
}
