// The ten machines. Coordinates are in field units (12 x 6.75, origin bottom-left).
// Every level is checked by tests/verify-levels.ts: unsolvable when empty, solvable with `solution`.
import type { InventoryItem, Level, PartInst, PartKind } from './types';

type Extra = Partial<Pick<PartInst, 'len' | 'flip' | 'targets'>>;
const fx = (id: string, kind: PartKind, x: number, y: number, a = 0, extra: Extra = {}): PartInst => ({ id, kind, x, y, a, fixed: true, ...extra });

/** id of the n-th player part of one inventory slot */
export const userPartId = (kind: PartKind, len: number | undefined, index: number) => `u:${kind}${len ?? ''}:${index}`;

export function makeUserPart(item: InventoryItem, index: number, x: number, y: number, a = 0, flip = false): PartInst {
  return { id: userPartId(item.kind, item.len, index), kind: item.kind, x, y, a, fixed: false, len: item.len, flip, targets: item.targets };
}

/** the reference solution as real part instances */
export function solutionParts(level: Level): PartInst[] {
  const used = new Map<InventoryItem, number>();
  return level.solution.map((s) => {
    const item = level.inventory.find((i) => i.kind === s.kind && (i.len ?? 0) === (s.len ?? 0) && (used.get(i) ?? 0) < i.count);
    if (!item) throw new Error(`Level ${level.id}: solution part ${s.kind} is not in the inventory`);
    const n = used.get(item) ?? 0;
    used.set(item, n + 1);
    return makeUserPart(item, n, s.x, s.y, s.a, !!s.flip);
  });
}

export const LEVELS: Level[] = [
  {
    id: 1,
    title: 'Die erste Rampe',
    task: 'Bringe die Kugel in den Eimer.',
    intro: 'Willkommen in der Werkstatt! Die Stahlkugel soll in den Eimer rollen. Lege das Brett so hin, dass die Kugel darüber rollt.',
    hints: [
      'Ziehe das Brett mit dem Finger aus der Kiste rechts auf die Wand.',
      'Das Brett muss schräg liegen – wie eine Rutsche von der Kugel zum Eimer. Mit den runden Pfeilen kannst du es drehen.',
    ],
    parts: [fx('regal', 'plank', 1.4, 5.0, -6, { len: 2 }), fx('kugel', 'ball', 0.9, 5.5), fx('eimer', 'bucket', 8.75, 0.55)],
    inventory: [{ kind: 'plank', len: 3.5, count: 1 }],
    goal: { type: 'inBucket', ball: 'kugel', bucket: 'eimer' },
    solution: [{ kind: 'plank', len: 3.5, x: 5.0, y: 2.75, a: -15 }],
    focus: ['kugel', 'eimer'],
  },
  {
    id: 2,
    title: 'Dominoeffekt',
    task: 'Schalte die Lampe ein.',
    intro: 'Der letzte Dominostein soll auf den roten Schalter fallen – dann geht die Lampe an. In der Reihe fehlen aber noch Steine!',
    hints: ['Stelle die Dominosteine in die Lücke.', 'Die Steine dürfen nicht zu weit auseinander stehen, sonst erreichen sie sich nicht.'],
    parts: [
      fx('rampe', 'plank', 1.6, 1.7, -20),
      fx('kugel', 'ball', 0.8, 2.45),
      fx('d1', 'domino', 4.0, 0.45),
      fx('d2', 'domino', 4.55, 0.45),
      fx('d3', 'domino', 5.1, 0.45),
      fx('d4', 'domino', 7.3, 0.45),
      fx('d5', 'domino', 7.85, 0.45),
      fx('d6', 'domino', 8.4, 0.45),
      fx('schalter', 'button', 9.4, 0.2, 0, { targets: ['lampe'] }),
      fx('lampe', 'lamp', 9.4, 3.4),
    ],
    inventory: [{ kind: 'domino', count: 3 }],
    goal: { type: 'lamp', id: 'lampe' },
    solution: [
      { kind: 'domino', x: 5.75, y: 0.5, a: 0 },
      { kind: 'domino', x: 6.25, y: 0.5, a: 0 },
      { kind: 'domino', x: 6.75, y: 0.5, a: 0 },
    ],
    focus: ['schalter', 'lampe'],
  },
  {
    id: 3,
    title: 'Hoch hinaus',
    task: 'Bringe den Basketball in den Eimer.',
    intro: 'Eine Wand versperrt den Weg! Mit dem Trampolin springt der Ball darüber. Probiere aus, wo es stehen muss.',
    hints: ['Stelle das Trampolin dorthin, wo der Ball herunterfällt.', 'Drehe das Trampolin ein wenig nach rechts, dann springt der Ball schräg über die Wand.'],
    parts: [
      fx('regal', 'plank', 1.3, 4.2, -6, { len: 2 }),
      fx('ball', 'basketball', 0.8, 4.77),
      fx('wand', 'plank', 6.0, 1.0, 90, { len: 2 }),
      fx('eimer', 'bucket', 9.0, 0.55),
    ],
    inventory: [{ kind: 'trampoline', count: 1 }],
    goal: { type: 'inBucket', ball: 'ball', bucket: 'eimer' },
    solution: [{ kind: 'trampoline', x: 3.0, y: 0.5, a: -15 }],
    focus: ['ball', 'eimer'],
  },
  {
    id: 4,
    title: 'Der Luftballon',
    task: 'Lass den Luftballon platzen.',
    intro: 'Luftballons steigen nach oben. Der Kaktus an der Decke ist schön spitz – lenke den Ballon mit dem Brett zu ihm hin.',
    hints: ['Der Ballon rutscht an der Unterseite eines schrägen Bretts entlang.', 'Lege das Brett schräg über den Ballon, sodass das obere Ende zum Kaktus zeigt.'],
    parts: [fx('ballon', 'balloon', 3.0, 0.8), fx('kaktus', 'cactus', 6.75, 6.13, 180), fx('regal', 'plank', 10.0, 2.5, 0, { len: 2 })],
    inventory: [{ kind: 'plank', len: 3.5, count: 1 }],
    goal: { type: 'pop', ids: ['ballon'] },
    solution: [{ kind: 'plank', len: 3.5, x: 4.5, y: 3.5, a: 15 }],
    focus: ['ballon', 'kaktus'],
  },
  {
    id: 5,
    title: 'Rückenwind',
    task: 'Bringe den Wasserball in den Eimer.',
    intro: 'Der Wasserball ist federleicht. Ein kräftiger Luftstoß vom Ventilator bringt ihn ins Rollen.',
    hints: ['Stelle den Ventilator links neben den Wasserball.', 'Der Ventilator bläst in Richtung der Öffnung. Er muss nach rechts zeigen.'],
    parts: [fx('regal', 'plank', 3.5, 3.0, 0, { len: 3.5 }), fx('ball', 'beachball', 3.0, 3.6), fx('eimer', 'bucket', 7.25, 0.55)],
    inventory: [{ kind: 'fan', count: 1 }],
    goal: { type: 'inBucket', ball: 'ball', bucket: 'eimer' },
    solution: [{ kind: 'fan', x: 1.0, y: 3.75, a: 0 }],
    focus: ['ball', 'eimer'],
  },
];
