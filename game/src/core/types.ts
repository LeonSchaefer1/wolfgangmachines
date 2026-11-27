// Shared data types for levels, parts and the simulation.
// Nothing in core/ may import rendering code: the simulation also runs headless in tests.

export const FIELD_W = 12;
export const FIELD_H = 6.75;
export const GRID = 0.25;
export const GRAVITY = 20;

export type PartKind =
  | 'plank'
  | 'ball'
  | 'basketball'
  | 'beachball'
  | 'domino'
  | 'crate'
  | 'trampoline'
  | 'fan'
  | 'balloon'
  | 'cactus'
  | 'button'
  | 'lamp'
  | 'conveyor'
  | 'seesaw'
  | 'bucket'
  | 'rocket'
  | 'bell';

export type Mat = 'wood' | 'metal' | 'rubber' | 'domino' | 'soft' | 'bucket' | 'mat';

export interface PartInst {
  id: string;
  kind: PartKind;
  x: number;
  y: number;
  /** rotation in degrees, counter-clockwise */
  a: number;
  /** true = bolted scenery, false = belongs to the player */
  fixed: boolean;
  /** plank length */
  len?: number;
  /** conveyor: runs to the left; seesaw: right side down */
  flip?: boolean;
  /** button: ids of the devices it switches on */
  targets?: string[];
}

export interface InventoryItem {
  kind: PartKind;
  count: number;
  len?: number;
  targets?: string[];
}

export type Goal =
  | { type: 'inBucket'; ball: string; bucket: string }
  | { type: 'pop'; ids: string[] }
  | { type: 'lamp'; id: string }
  | { type: 'bell'; id: string }
  | { type: 'topple'; ids: string[] }
  | { type: 'firework'; id: string }
  | { type: 'all'; goals: Goal[] };

export interface SolutionPart {
  kind: PartKind;
  x: number;
  y: number;
  a: number;
  len?: number;
  flip?: boolean;
}

export interface Level {
  id: number;
  title: string;
  /** one short sentence: what has to happen */
  task: string;
  /** friendly longer explanation shown before the level starts */
  intro: string;
  /** escalating text hints */
  hints: string[];
  parts: PartInst[];
  inventory: InventoryItem[];
  goal: Goal;
  /** reference solution: used for the "show me" hint and for automated verification */
  solution: SolutionPart[];
  /** ids of things to point at when explaining the goal */
  focus?: string[];
}

export type SimEvent =
  | { t: 'hit'; ma: Mat; mb: Mat; v: number; x: number; y: number }
  | { t: 'pop'; id: string; x: number; y: number }
  | { t: 'button'; id: string; x: number; y: number }
  | { t: 'power'; id: string; kind: PartKind; on: boolean }
  | { t: 'boing'; id: string; x: number; y: number; v: number }
  | { t: 'bell'; id: string; v: number }
  | { t: 'bucket'; id: string }
  | { t: 'fuse'; id: string }
  | { t: 'launch'; id: string }
  | { t: 'firework'; id: string; x: number; y: number }
  | { t: 'seesaw'; id: string; v: number }
  | { t: 'goal' }
  | { t: 'stalled' };
