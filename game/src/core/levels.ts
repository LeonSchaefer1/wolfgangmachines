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
    parts: [fx('regal', 'plank', 1.4, 5.0, -6, { len: 2 }), fx('kugel', 'ball', 0.9, 5.5), fx('eimer', 'bucket', 8.4, 0.55)],
    inventory: [{ kind: 'plank', len: 3.5, count: 1 }],
    goal: { type: 'inBucket', ball: 'kugel', bucket: 'eimer' },
    solution: [{ kind: 'plank', len: 3.5, x: 4.5, y: 2.75, a: -15 }],
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
      fx('ball', 'basketball', 0.8, 4.8),
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
  {
    id: 6,
    title: 'Die Wippe',
    task: 'Läute die Glocke.',
    intro: 'Wenn die schwere Kugel auf die Wippe fällt, schleudert sie alles in die Luft, was auf der anderen Seite liegt. Vielleicht einen Ball?',
    hints: ['Stelle die Wippe so auf, dass die Stahlkugel auf das hochstehende Ende fällt.', 'Lege den Basketball auf das untere Ende der Wippe. Er fliegt dann im Bogen nach oben zur Glocke.'],
    parts: [fx('regal', 'plank', 10.3, 5.8, 6, { len: 2 }), fx('kugel', 'ball', 10.8, 6.28), fx('glocke', 'bell', 6.9, 3.5)],
    inventory: [
      { kind: 'seesaw', count: 1 },
      { kind: 'basketball', count: 1 },
    ],
    goal: { type: 'bell', id: 'glocke' },
    solution: [
      { kind: 'seesaw', x: 6.75, y: 0.5, a: 0 },
      { kind: 'basketball', x: 5.5, y: 0.75, a: 0 },
    ],
    focus: ['kugel', 'glocke'],
  },
  {
    id: 7,
    title: 'Auf Knopfdruck',
    task: 'Bringe den Basketball in den Eimer.',
    intro: 'Das Förderband steht still. Erst wenn etwas auf den roten Schalter fällt, läuft es los und nimmt den Ball mit.',
    hints: ['Die Stahlkugel muss auf dem roten Schalter landen – aber die kleine Sperre ist im Weg.', 'Lege das Brett als Rutsche unter die Kugel, sodass sie über die Sperre hinweg zum Schalter rollt.'],
    parts: [
      fx('rampe', 'plank', 1.3, 4.6, -8, { len: 2 }),
      fx('kugel', 'ball', 0.8, 5.1),
      fx('sperre', 'plank', 5.0, 0.5, 90, { len: 1 }),
      fx('schalter', 'button', 6.5, 0.2, 0, { targets: ['band'] }),
      fx('pfosten', 'plank', 7.45, 1.39, 90, { len: 2.75 }),
      fx('band', 'conveyor', 8.6, 3.0),
      fx('ball', 'basketball', 7.9, 3.65),
      fx('eimer', 'bucket', 11.0, 0.55),
    ],
    inventory: [{ kind: 'plank', len: 3.5, count: 1 }],
    goal: { type: 'inBucket', ball: 'ball', bucket: 'eimer' },
    solution: [{ kind: 'plank', len: 3.5, x: 3.75, y: 1.75, a: -15 }],
    focus: ['schalter', 'band'],
  },
  {
    id: 8,
    title: 'Frischer Wind',
    task: 'Lass den Luftballon platzen.',
    intro: 'Der Ballon klemmt unter dem Brett fest. Der Ventilator könnte ihn herauspusten – aber er läuft erst, wenn der Schalter gedrückt wird.',
    hints: ['Zuerst muss die Kugel den Schalter treffen: Lege das Brett als Rutsche hin.', 'Stelle den Ventilator links neben den Ballon. Er pustet ihn nach rechts unter dem Brett hervor – dann steigt er zum Kaktus auf.'],
    parts: [
      fx('rampe', 'plank', 1.3, 5.3, -8, { len: 2 }),
      fx('kugel', 'ball', 0.8, 5.8),
      fx('schalter', 'button', 6.25, 0.2, 0, { targets: ['u:fan:0'] }),
      fx('dach', 'plank', 9.75, 3.25, 0, { len: 2 }),
      fx('ballon', 'balloon', 9.75, 2.65),
      fx('kaktus', 'cactus', 11.4, 6.13, 180),
    ],
    inventory: [
      { kind: 'plank', count: 1 },
      { kind: 'fan', count: 1 },
    ],
    goal: { type: 'pop', ids: ['ballon'] },
    solution: [
      { kind: 'plank', x: 3.25, y: 1.5, a: -15 },
      { kind: 'fan', x: 7.75, y: 2.75, a: 0 },
    ],
    focus: ['ballon', 'kaktus'],
  },
  {
    id: 9,
    title: 'Kettenreaktion',
    task: 'Schalte die Lampe ein.',
    intro: 'Jetzt kommt alles zusammen: Der Ball muss über die Wand springen und oben die Dominosteine anstoßen. Aber ein Stein fehlt noch!',
    hints: ['Das Trampolin gehört unter den Ball – leicht nach rechts gedreht.', 'Stelle den Dominostein in die Lücke auf dem oberen Regal.'],
    parts: [
      fx('regal', 'plank', 1.3, 4.2, -6, { len: 2 }),
      fx('ball', 'basketball', 0.8, 4.8),
      fx('boden1', 'plank', 7.75, 2.0),
      fx('boden2', 'plank', 10.25, 2.0),
      fx('d1', 'domino', 8.0, 2.57),
      fx('d2', 'domino', 8.55, 2.57),
      fx('d3', 'domino', 9.65, 2.57),
      fx('d4', 'domino', 10.2, 2.57),
      fx('schalter', 'button', 11.1, 2.31, 0, { targets: ['lampe'] }),
      fx('lampe', 'lamp', 10.5, 5.2),
    ],
    inventory: [
      { kind: 'trampoline', count: 1 },
      { kind: 'domino', count: 1 },
    ],
    goal: { type: 'lamp', id: 'lampe' },
    solution: [
      { kind: 'trampoline', x: 3.0, y: 0.5, a: -15 },
      { kind: 'domino', x: 9.0, y: 2.75, a: 0 },
    ],
    focus: ['schalter', 'lampe'],
  },
  {
    id: 10,
    title: 'Das große Feuerwerk',
    task: 'Zünde die Rakete.',
    intro: 'Dein Meisterstück! Kugel, Dominosteine, Förderband und Kiste müssen zusammenspielen, damit die Rakete in den Himmel steigt.',
    hints: [
      'Die Kugel muss über die kleine Sperre zu den Dominosteinen rollen – lege das Brett als Rutsche hin. In der Dominoreihe fehlen zwei Steine.',
      'Der erste Schalter startet das Förderband. Stelle es unter die Kiste – es muss die Kiste nach rechts tragen.',
      'Die Kiste soll vom Band auf den zweiten Schalter fallen. Der zündet die Rakete!',
    ],
    parts: [
      fx('rampe', 'plank', 1.3, 5.2, -8, { len: 2 }),
      fx('kugel', 'ball', 0.8, 5.7),
      fx('sperre', 'plank', 4.4, 0.375, 90, { len: 0.75 }),
      fx('d1', 'domino', 5.7, 0.45),
      fx('d2', 'domino', 7.25, 0.45),
      fx('schalter1', 'button', 8.15, 0.2, 0, { targets: ['u:conveyor:0'] }),
      fx('kiste', 'crate', 6.6, 3.6),
      fx('schalter2', 'button', 10.0, 0.2, 0, { targets: ['rakete'] }),
      fx('rakete', 'rocket', 11.5, 0.6),
      fx('ballon1', 'balloon', 10.6, 6.2),
      fx('ballon2', 'balloon', 11.5, 6.2),
    ],
    inventory: [
      { kind: 'plank', len: 2, count: 1 },
      { kind: 'domino', count: 2 },
      { kind: 'conveyor', count: 1 },
    ],
    goal: { type: 'firework', id: 'rakete' },
    solution: [
      { kind: 'plank', len: 2, x: 3.25, y: 1.75, a: -15 },
      { kind: 'domino', x: 6.25, y: 0.5, a: 0 },
      { kind: 'domino', x: 6.75, y: 0.5, a: 0 },
      { kind: 'conveyor', x: 7.25, y: 2.25, a: 0 },
    ],
    focus: ['rakete'],
  },
];
