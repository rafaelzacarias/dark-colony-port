import { legacyHarvesterIdleDiagnostic, reduceLegacyHarvesterIdle, type LegacyHarvesterIdleState } from "./legacy-harvester-idle";
import { sha256Hex } from "../sha256";
import { advanceLegacyResourceAnimation } from "./legacy-resource";
import { sourceResourceProfiles } from "./source-resource-options";
import { finSourceDuration } from "../render/fin-animation";

export interface LegacyHarvesterMovementState extends LegacyHarvesterIdleState {
  readonly raw: readonly number[];
  readonly targetXQ8: number;
  readonly targetYQ8: number;
  readonly pathBytes: readonly number[];
  readonly ground: readonly number[];
}

export interface LegacyHarvesterMovementWorld {
  readonly profile: "source-native-short-route";
  readonly typeId: 6 | 14;
  readonly pthSha256: string;
  readonly width: number;
  readonly height: number;
  readonly selectedWeapon: -1;
  readonly commandTarget: readonly [number, number];
  readonly route: LegacyHarvesterMovementRoute;
  readonly families: readonly number[];
  readonly groundCells: readonly number[];
  readonly tripWords: readonly number[];
  readonly census: Readonly<{ speedQ8: number; turnStep: number; ground: true }>;
  readonly standBank: number;
  readonly moveBank: number;
  readonly preservedIdleBank: number;
  readonly animations: Readonly<Record<number, readonly (readonly number[])[]>>;
  readonly finBindings: Readonly<Record<number, readonly LegacyHarvesterFinBinding[]>>;
}

export interface LegacyHarvesterFinBinding {
  readonly source: "EXPL" | "SLUG";
  readonly name: string;
  readonly firstTimelineIndex: number;
  readonly lastTimelineIndex: number;
}

export interface LegacyHarvesterMovementRoute {
  readonly policy: "external-direct-straight";
  readonly originQ8: readonly [number, number];
  readonly cells: readonly (readonly [number, number])[];
}

export type LegacyHarvesterMovementResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly state: LegacyHarvesterMovementState; readonly randomAdvances: readonly never[];
    readonly visits: readonly { readonly boundary: "0x419458" | "0x419576"; readonly state: LegacyHarvesterMovementState }[];
    readonly groundWrites: readonly { readonly eip: string; readonly cell: number; readonly size: number;
      readonly before: number; readonly after: number }[];
      readonly idleEvent: null | { readonly kind: "native-harvester-idle"; readonly boundary: "after-mobile-entity-update";
        readonly state: LegacyHarvesterIdleState; readonly raw: readonly number[]; readonly groundWord: number;
        readonly groundCell: number; readonly arrived: boolean } };

export type LegacyHarvesterMovementAdmission =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly state: LegacyHarvesterMovementState; readonly randomAdvances: readonly never[] };

const SPANS: Readonly<Record<number, number>> = { 1: 3, 2: 0, 3: 2, 4: 1, 5: 5, 6: 8, 7: 0, 8: 2 };
const integer = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export const legacyHarvesterMotionTables = Object.freeze({
  vectors: Object.freeze([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(vector => Object.freeze(vector))),
  sineQuarterQ11: Object.freeze([0,50,100,150,200,250,300,350,399,448,497,546,594,642,689,737,783,829,875,920,965,1009,1052,1095,1137,1179,1219,1259,1299,1337,1375,1412,1448,1483,1517,1550,1583,1614,1644,1674,1702,1730,1756,1781,1806,1829,1851,1872,1892,1910,1928,1944,1959,1973,1986,1998,2008,2017,2025,2032,2038,2042,2045,2047,2048]),
  atanQ13: Object.freeze([0,5,10,15,20,25,30,35,40,45,50,55,61,66,71,76,81,86,91,96,101,106,111,116,121,126,131,137,142,147,152,157,162,167,172,177,182,187,192,197,202,207,212,216,221,226,231,236,241,246,251,256,261,266,271,275,280,285,290,295,300,304,309,314,319,324,328,333,338,343,348,352,357,362,366,371,376,380,385,390,394,399,404,408,413,417,422,427,431,436,440,445,449,454,458,463,467,472,476,481,485,489,494,498,503,507,511,516,520,524,529,533,537,541,546,550,554,558,563,567,571,575,579,583,588,592,596,600,604,608,612,616,620,624,628,632,636,640,644,648,652,656,660,664,668,671,675,679,683,687,691,694,698,702,706,709,713,717,720,724,728,731,735,739,742,746,750,753,757,760,764,767,771,774,778,781,785,788,792,795,798,802,805,809,812,815,819,822,825,829,832,835,838,842,845,848,851,855,858,861,864,867,870,874,877,880,883,886,889,892,895,898,901,904,907,910,913,916,919,922,925,928,931,934,937,940,942,945,948,951,954,957,959,962,965,968,971,973,976,979,981,984,987,990,992,995,998,1000,1003,1005,1008,1011,1013,1016,1018,1021,0]),
});

function nativeDirection(deltaX: number, deltaY: number): number {
  const absoluteX = Math.abs(deltaX), absoluteY = Math.abs(deltaY);
  if (!absoluteX && !absoluteY) return 0;
  let angle: number;
  if (absoluteX === absoluteY) angle = deltaX > 0 ? (deltaY > 0 ? 1024 : 7168) : (deltaY > 0 ? 3072 : 5120);
  else {
    const base = legacyHarvesterMotionTables.atanQ13[Math.trunc(Math.min(absoluteX, absoluteY) * 256 / Math.max(absoluteX, absoluteY))];
    if (absoluteY > absoluteX) angle = deltaX < 0 ? (deltaY >= 0 ? 2048 + base : 6144 - base)
      : (deltaY < 0 ? 6144 + base : 2048 - base);
    else angle = deltaX < 0 ? (deltaY >= 0 ? 4096 - base : 4096 + base)
      : (deltaY < 0 && base !== 0 ? 8192 - base : base);
  }
  return Math.trunc(angle / 32) & 255;
}

function nativeSine(direction: number): number {
  const angle = direction & 255, quarter = angle >> 6, offset = angle & 63;
  return legacyHarvesterMotionTables.sineQuarterQ11[quarter & 1 ? 64 - offset : offset] * (quarter >= 2 ? -1 : 1);
}

export function legacyHarvesterTurnDirection(direction: number, target: number, turnStep: number): number {
  let delta = target - direction;
  if (delta > 128) delta -= 256;
  if (delta < -128) delta += 256;
  return (direction + Math.sign(delta) * Math.min(Math.abs(delta), turnStep)) & 255;
}

function movementLegs(world: LegacyHarvesterMovementWorld) {
  let [xQ8, yQ8] = world.route.originQ8;
  return world.route.cells.map(([column, row], index) => {
    const deltaX = column * 256 + 128 - xQ8, deltaY = row * 256 + 128 - yQ8;
    const direction = nativeDirection(deltaX, deltaY), cosine = nativeSine(direction + 64), sine = nativeSine(direction);
    const count = Math.trunc(Math.trunc((cosine * deltaX + sine * deltaY) / 2048) / world.census.speedQ8);
    const stepX = Math.trunc(cosine * world.census.speedQ8 / 2048), stepY = Math.trunc(sine * world.census.speedQ8 / 2048);
    const start = [xQ8, yQ8] as const;
    const previous = index ? world.route.cells[index - 1] : world.route.originQ8.map(value => value >> 8);
    xQ8 += count * stepX; yQ8 += count * stepY;
    const code = legacyHarvesterMotionTables.vectors.findIndex(vector => vector[0] === column - previous[0] && vector[1] === row - previous[1]);
    return { start, end: [xQ8, yQ8] as const, direction, count, stepX, stepY, previous, code };
  });
}

export async function sourceLegacyHarvesterMovementWorld(input: {
  readonly typeId: 6 | 14;
  readonly pth: Uint8Array;
  readonly fin: Parameters<typeof sourceResourceProfiles>[0];
  readonly banks: { readonly stand: number; readonly move: number; readonly preservedIdle: number };
  readonly route?: LegacyHarvesterMovementRoute;
  readonly width?: number;
  readonly height?: number;
  readonly plane?: { readonly cells: readonly number[]; readonly tripWords: readonly number[] };
  readonly census?: LegacyHarvesterMovementWorld["census"];
}): Promise<LegacyHarvesterMovementWorld> {
  const hash = await sha256Hex(input.pth);
  if (input.typeId !== 6 && input.typeId !== 14) throw new Error("unverified-source-type");
  const width = input.width ?? 96, height = input.height ?? 84;
  if (!integer(width, 1, 256) || !integer(height, 1, 256) || input.pth.length !== 65536 + width * height) throw new Error("invalid-source-PTH");
  if (input.route && !input.plane) throw new Error("explicit-ground-and-trip-plane-required");
  const source = sourceResourceProfiles(input.fin), stem = input.typeId === 6 ? "EXPL" : "SLUG";
  const bind = (source: "EXPL" | "SLUG", family: string): readonly LegacyHarvesterFinBinding[] => {
    const metadata = input.fin[source];
    const candidates = Array.from({ length: 16 }, (_, index) => metadata.states.find(state => state.name === `${family}${(12 - index + 16) & 15}`));
    return Object.freeze(Array.from({ length: 32 }, (_, direction) => {
      const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
      const state = offsets.map(offset => candidates[((direction + offset + 32) & 31) >> 1]).find(Boolean);
      if (!state?.validRange || !integer(state.firstTimelineIndex, 0, metadata.timeline.length - 1)
        || !integer(state.lastTimelineIndex, state.firstTimelineIndex, metadata.timeline.length - 1)) throw new Error("missing-source-movement-FIN");
      return Object.freeze({ source, name: state.name, firstTimelineIndex: state.firstTimelineIndex, lastTimelineIndex: state.lastTimelineIndex });
    }));
  };
  const finBindings = Object.freeze({ [input.banks.stand]: bind(stem, `${stem}STAND`),
    [input.banks.move]: bind(stem, `${stem}MOVE`), [input.banks.preservedIdle]: bind("EXPL", `${stem}FUNK`) });
  const move = finBindings[input.banks.move].map(binding => input.fin[binding.source].timeline
    .slice(binding.firstTimelineIndex, binding.lastTimelineIndex + 1).map(frame => finSourceDuration(frame.field2!)));
  const animations = {
    [input.banks.stand]: source.animations.find(bank => bank.id === `${stem}STAND`)!.directions,
    [input.banks.move]: move,
    [input.banks.preservedIdle]: source.animations.find(bank => bank.id === `${stem}FUNK`)!.directions,
  };
  const bindings = [input.banks.stand, input.banks.move, input.banks.preservedIdle];
  if (new Set(bindings).size !== 3 || bindings.some(bank => !integer(bank, 1, 0xffffffff))) {
    throw new Error("invalid-native-bank-bindings");
  }
  for (const directions of Object.values(animations)) {
    directions.forEach(Object.freeze); Object.freeze(directions);
  }
  const route = input.route ?? { policy: "external-direct-straight", originQ8: [17280, 12416], cells: [[68, 48], [69, 48]] };
  const destination = route.cells.at(-1);
  if (!destination) throw new Error("empty-native-route");
  return Object.freeze({ profile: "source-native-short-route", typeId: input.typeId, pthSha256: hash,
    width, height, selectedWeapon: -1, commandTarget: Object.freeze(destination.map(value => value * 256 + 128)) as readonly [number, number],
    route: Object.freeze({ policy: route.policy, originQ8: Object.freeze([...route.originQ8]) as readonly [number, number],
      cells: Object.freeze(route.cells.map(cell => Object.freeze([...cell]) as readonly [number, number])) }),
    families: Object.freeze(Array.from(input.pth.slice(65536))),
    groundCells: Object.freeze([...(input.plane?.cells ?? [4675, 4676, 4677])]),
    tripWords: Object.freeze([...(input.plane?.tripWords ?? [1023, 1023, 1023])]),
    census: Object.freeze({ ...(input.census ?? { speedQ8: 40, turnStep: 10, ground: true }) }),
    standBank: input.banks.stand, moveBank: input.banks.move, preservedIdleBank: input.banks.preservedIdle, animations: Object.freeze(animations), finBindings });
}

export function decodeLegacyHarvesterMovement(raw: readonly number[], slot: number, randomIndex: number,
  ground: readonly number[]): LegacyHarvesterMovementState {
  if (raw.length !== 220 || raw.some(value => !integer(value, 0, 255))) throw new Error("invalid-native-actor-bytes");
  const view = new DataView(Uint8Array.from(raw).buffer);
  const word = (offset: number) => view.getUint16(offset, true);
  if (raw[0x38] > 5) throw new Error("invalid-native-stack-depth");
  const stack = Array.from({ length: raw[0x38] + 1 }, (_, level) => {
    const task = raw[0x39 + level * 2], start = raw[0x3a + level * 2], end = raw[0x3c + level * 2];
    if (!(task in SPANS) || end - start !== SPANS[task] || end > 32 || (level === 0 && start !== 0)) {
      throw new Error("noncanonical-native-task-span");
    }
    return { task, words: Array.from({ length: end - start }, (_, index) => word(0x46 + (start + index) * 2)) };
  });
  return { raw: [...raw], slot, randomIndex, ground: [...ground], stack,
    typeId: raw[6], team: raw[7], status: raw[0x2c], hp: view.getInt32(12, true),
    xQ8: word(0), yQ8: word(4), direction: raw[9], pending: raw[0x36], order: raw[0x37],
    observer: raw[0x35], specialOrder: raw[0xcb], confusion: raw[0xd0], secondaryAnimationPending: raw[0xc7],
    secondaryAnimationsInactive: raw[0x22] === 2 && raw[0x2a] === 2,
    animation: { bank: view.getUint32(0x14, true), frame: raw[0x18], delay: raw[0x19], mode: raw[0x1a] },
    targetXQ8: word(0x2e), targetYQ8: word(0x30), pathBytes: raw.slice(0x86, 0x96) };
}

function movementAliasDiagnostic(state: LegacyHarvesterMovementState): string | null {
  let decoded: LegacyHarvesterMovementState;
  try { decoded = decodeLegacyHarvesterMovement(state.raw, state.slot, state.randomIndex, state.ground); }
  catch (error) { return (error as Error).message; }
  for (const key of Object.keys(decoded) as (keyof LegacyHarvesterMovementState)[]) {
    if (!same(state[key], decoded[key])) return "native-state-alias-mismatch";
  }
  return null;
}

export function legacyHarvesterMovementDiagnostic(state: LegacyHarvesterMovementState,
  world: LegacyHarvesterMovementWorld): string | null {
  const alias = movementAliasDiagnostic(state);
  if (alias) return alias;
  if (![6, 14].includes(state.typeId) || !integer(state.slot, 152, 799) || !integer(state.team, 0, 7)
    || state.status !== 1 || !integer(state.hp, 1, 32767) || world.selectedWeapon !== -1
    || state.observer !== 255 || state.specialOrder !== 0 || state.confusion !== 0
    || state.secondaryAnimationPending !== 0 || !state.secondaryAnimationsInactive) return "unowned-actor-branch";
  if (world.profile !== "source-native-short-route" || world.typeId !== state.typeId
    || !integer(world.width, 1, 256) || !integer(world.height, 1, 256)
    || world.families.length !== world.width * world.height
    || world.route.policy !== "external-direct-straight" || !integer(world.route.cells.length, 1, 3)
    || world.census.ground !== true || world.census.speedQ8 !== 40 || world.census.turnStep !== 10
    || !integer(world.route.originQ8[0], 0, world.width * 256 - 1)
    || !integer(world.route.originQ8[1], 0, world.height * 256 - 1)) return "unverified-route";
  const origin = world.route.originQ8.map(value => value >> 8);
  const vector = world.route.cells[0].map((value, axis) => value - origin[axis]);
  if (!legacyHarvesterMotionTables.vectors.some(candidate => same(candidate, vector))
    || world.route.cells.some((cell, index) => !integer(cell[0], 0, world.width - 1) || !integer(cell[1], 0, world.height - 1)
      || cell.some((value, axis) => value !== origin[axis] + vector[axis] * (index + 1)))
    || !same(world.commandTarget, world.route.cells.at(-1)!.map(value => value * 256 + 128))) return "unsupported-route-policy";
  if (world.groundCells.length !== state.ground.length || world.tripWords.length !== state.ground.length
    || new Set(world.groundCells).size !== world.groundCells.length
    || world.groundCells.some(cell => !integer(cell, 0, world.width * world.height - 1))
    || state.ground.some(word => !integer(word, 0, 0xffffffff) || (word & 0x807ffc00) !== 0
      || ![1023, state.slot].includes(word & 1023))
    || state.ground.filter(word => (word & 1023) === state.slot).length !== 1) return "unowned-ground-occupancy";
  const required = [origin, ...world.route.cells];
  if (vector[0] && vector[1]) world.route.cells.forEach((cell, index) => {
    const previous = index ? world.route.cells[index - 1] : origin;
    required.push([previous[0], cell[1]], [cell[0], previous[1]]);
  });
  for (const [column, row] of required) {
    const cell = row * world.width + column, index = world.groundCells.indexOf(cell);
    if (index < 0 || !integer(world.families[cell], 1, 254)) return "blocked-or-missing-PTH-cell";
    if (world.tripWords[index] !== 1023) return "trip-or-secondary-plane-not-owned";
  }
  const legs = movementLegs(world);
  if (legs.some((leg, index) => !integer(leg.count, 1, 65535)
    || leg.end.some((value, axis) => (value >> 8) !== world.route.cells[index][axis]))) return "unsupported-leg-arrival";
  if (!integer(state.randomIndex, 0, 255) || ![0, 1].includes(state.pending)
    || (state.pending === 1 ? ![2, 7, 13].includes(state.order) : state.order !== 255)) return "unowned-pending-order";
  if (new Set([world.standBank, world.moveBank, world.preservedIdleBank]).size !== 3) return "invalid-native-bank-bindings";
  for (const bank of [world.standBank, world.moveBank, world.preservedIdleBank]) {
    const directions = world.animations[bank];
    if (!integer(bank, 1, 0xffffffff) || !directions || directions.length !== 32
      || directions.some(delays => !delays.length || delays.length > 256
        || delays.some(delay => !integer(delay, 0, 255)))) return "invalid-source-fin-profile";
  }
  if (![world.standBank, world.moveBank].includes(state.animation.bank) || state.animation.mode !== 0
    || state.animation.frame >= Math.max(...world.animations[state.animation.bank].map(delays => delays.length))) return "unowned-fin-state";
  const tasks = state.stack.map(task => task.task).join(",");
  if (!/^(1(,3)?|[27],8(,6(,5(,4)?)?)?)$/.test(tasks)) return "unowned-task-stack";
  const root = state.stack[0].task;
  const rawView = new DataView(Uint8Array.from(state.raw).buffer);
  if (rawView.getUint32(0x1c, true) !== world.standBank || rawView.getUint32(0x24, true) !== world.standBank
    || rawView.getUint16(0xa, true) !== 64 || rawView.getUint32(0x10, true) !== 65536
    || rawView.getUint16(0xa6, true) !== world.commandTarget[0] || rawView.getUint16(0xa8, true) !== world.commandTarget[1]
    || state.raw[0xcd] >= world.width || state.raw[0xce] >= world.height || !same(state.raw.slice(0xd1, 0xd6), [255, 254, 255, 254, 255])
    || ![0, 1].includes(state.raw[0xc6]) || (root !== 1 && state.raw[0xc6] !== 1)) return "unverified-native-auxiliary-state";
  const occupied = [[0, 2], [4, 8], [9, 16], [0x10, 0x27], [0x2a, 0x2d], [0x2e, 0x32], [0x35, 0x96],
    [0xa6, 0xaa], [0xc6, 0xc7], [0xcd, 0xcf], [0xd1, 0xd6]];
  if (state.raw.some((value, offset) => value !== 0 && !occupied.some(([start, end]) => offset >= start && offset < end))
    || state.raw[0x1b] || state.raw[0x20] || state.raw[0x21] || state.raw[0x23]) return "unowned-native-auxiliary-work";
  let reservation = [state.xQ8 >> 8, state.yQ8 >> 8];
  const position = [state.xQ8, state.yQ8];
  if (root === 1) {
    const idle = state.stack[0].words, wait = state.stack[1];
    if (idle[0] !== 65535 || !integer(idle[1], 0, 32767) || idle[2] !== 0
      || ![world.route.originQ8, ...legs.map(leg => leg.end)].some(point => same(point, position))) return "unverified-idle-handoff";
    if (state.pending && [2, 7].includes(state.order) && (!same(position, world.route.originQ8) || state.raw[0xc6] !== 1)) return "unverified-order-origin";
    if (wait && (!integer(wait.words[0], 0, 7) || !integer(wait.words[1], 0, 32767))) return "unowned-wait-payload";
  } else {
    if (state.animation.bank !== world.moveBank) return "unowned-movement-fin-bank";
    if (state.pending && state.order !== 13) return "movement-retarget-not-owned";
    const backing = Array<number>(16).fill(0);
    [...legs].reverse().forEach((leg, index) => { backing[index >> 1] |= leg.code << ((index & 1) * 4); });
    if (!same([state.targetXQ8, state.targetYQ8], world.commandTarget) || !same(state.pathBytes, backing)
      || !same(state.stack[1].words, [1, Number(root === 7)])) return "unverified-native-path";
    const path = state.stack[2], step = state.stack[3], turn = state.stack[4];
    const consumed = path ? world.route.cells.length - 1 - (path.words[0] === 65535 ? -1 : path.words[0]) : legs.length;
    if (!integer(consumed, 0, legs.length)) return "unowned-path-cursor";
    reservation = [...(consumed ? world.route.cells[consumed - 1] : origin)];
    if (path && !same(path.words.slice(1), [legs.length, ...reservation, Number(root === 7), 65535, 65535, 0])) return "unowned-path-payload";
    const leg = legs[consumed - 1];
    if (step) {
      if (!leg || !same(step.words, [leg.stepX & 65535, leg.stepY & 65535, step.words[2], ...leg.previous])
        || !integer(step.words[2], 0, leg.count)
        || !same(position, [leg.start[0] + (leg.count - step.words[2]) * leg.stepX,
          leg.start[1] + (leg.count - step.words[2]) * leg.stepY])) return "unowned-step-payload";
      if (turn ? !same(turn.words, [leg.direction]) || step.words[2] !== leg.count : state.direction !== leg.direction) return "unowned-turn-payload";
    } else if (!same(position, leg?.end ?? world.route.originQ8)) return "unowned-path-position";
  }
  const reservedIndex = world.groundCells.indexOf(reservation[1] * world.width + reservation[0]);
  if (reservedIndex < 0 || (state.ground[reservedIndex] & 1023) !== state.slot) return "inconsistent-ground-reservation";
  return null;
}

export function beginLegacyHarvesterMovement(input: LegacyHarvesterMovementState,
  world: LegacyHarvesterMovementWorld, order: 2 | 7): LegacyHarvesterMovementAdmission {
  const alias = movementAliasDiagnostic(input);
  if (alias) return { supported: false, diagnostic: alias };
  const groundCell = (input.yQ8 >> 8) * world.width + (input.xQ8 >> 8);
  const diagnostic = legacyHarvesterIdleDiagnostic(input, { ...world, groundCell,
    groundWord: input.ground[world.groundCells.indexOf(groundCell)] });
  if (diagnostic) return { supported: false, diagnostic };
  if (![2, 7].includes(order)) return { supported: false, diagnostic: "unsupported-movement-order" };
  const bytes = Uint8Array.from(input.raw), view = new DataView(bytes.buffer);
  view.setUint32(0x10, view.getUint32(0x10, true) | 65536, true);
  view.setUint16(0xa6, world.commandTarget[0], true); view.setUint16(0xa8, world.commandTarget[1], true);
  bytes[0x36] = 1; bytes[0x37] = order; bytes[0xc6] = 1;
  const state = decodeLegacyHarvesterMovement([...bytes], input.slot, input.randomIndex, input.ground);
  const admission = legacyHarvesterMovementDiagnostic(state, world);
  return admission ? { supported: false, diagnostic: admission } : { supported: true, state, randomAdvances: [] };
}

export function queueLegacyHarvesterMovementStop(input: LegacyHarvesterMovementState,
  world: LegacyHarvesterMovementWorld): LegacyHarvesterMovementAdmission {
  const diagnostic = legacyHarvesterMovementDiagnostic(input, world);
  if (diagnostic) return { supported: false, diagnostic };
  const raw = [...input.raw]; raw[0x36] = 1; raw[0x37] = 13;
  return { supported: true, state: decodeLegacyHarvesterMovement(raw, input.slot, input.randomIndex, input.ground), randomAdvances: [] };
}

export function reduceLegacyHarvesterMovement(input: LegacyHarvesterMovementState,
  world: LegacyHarvesterMovementWorld): LegacyHarvesterMovementResult {
  const diagnostic = legacyHarvesterMovementDiagnostic(input, world);
  if (diagnostic) return { supported: false, diagnostic };
  const bytes = Uint8Array.from(input.raw), view = new DataView(bytes.buffer), ground = [...input.ground];
  const visits: { boundary: "0x419458" | "0x419576"; state: LegacyHarvesterMovementState }[] = [];
  const groundWrites: { eip: string; cell: number; size: number; before: number; after: number }[] = [];
  const groundWrite = (eip: string, cell: number, size: 2 | 4, value: number) => {
    const index = world.groundCells.indexOf(cell), mask = size === 2 ? 65535 : 0xffffffff;
    groundWrites.push({ eip, cell, size, before: (ground[index] & mask) >>> 0, after: (value & mask) >>> 0 });
    ground[index] = ((ground[index] & ~mask) | (value & mask)) >>> 0;
  };
  const groundAt = (cell: number) => ground[world.groundCells.indexOf(cell)];
  const legs = movementLegs(world);
  const word = (offset: number) => view.getUint16(offset, true);
  const put = (offset: number, value: number) => view.setUint16(offset, value, true);
  const push = (task: number, words: readonly number[]) => {
    bytes[0x38]++;
    const level = bytes[0x38], start = bytes[0x3a + level * 2];
    bytes[0x39 + level * 2] = task;
    bytes[0x3c + level * 2] = start + words.length;
    words.forEach((value, index) => put(0x46 + (start + index) * 2, value));
  };
  const reset = () => { bytes[0x39] = 0; bytes[0x3a] = 0; bytes[0x38] = 255; };
  const bank = (next: number) => {
    if (view.getUint32(0x14, true) !== next || bytes[0x1a] !== 0) {
      view.setUint32(0x14, next, true); bytes[0x18] = 0; bytes[0x19] = 0; bytes[0x1a] = 0;
    }
  };
  const advanced = advanceLegacyResourceAnimation({ ...input.animation, mode: 0, profile: String(input.animation.bank) },
    { id: String(input.animation.bank), directions: world.animations[input.animation.bank] }, input.direction);
  bytes[0x18] = advanced.frame; bytes[0x19] = advanced.delay;
  let becameIdle = false;
  for (let dispatch = 0; dispatch < 12; dispatch++) {
    visits.push({ boundary: "0x419458", state: decodeLegacyHarvesterMovement([...bytes], input.slot, input.randomIndex, ground) });
    const depth = bytes[0x38], task = bytes[0x39 + depth * 2], payload = 0x46 + bytes[0x3a + depth * 2] * 2;
    if (task === 4) {
      bytes[9] = legacyHarvesterTurnDirection(bytes[9], word(payload), world.census.turnStep);
      if (bytes[9] !== word(payload)) break;
      bytes[0x38]--; continue;
    }
    if (task === 5) {
      bank(world.moveBank);
      if (word(payload + 4) === 0) { bytes[0x35] = 255; bytes[0x38]--; }
      else { put(0, word(0) + view.getInt16(payload, true)); put(4, word(4) + view.getInt16(payload + 2, true));
        put(payload + 4, word(payload + 4) - 1); }
      break;
    }
    if (task === 3 && bytes[0x36]) { bytes[0x38]--; continue; }
    if (bytes[0x36] || task === 2 || task === 7) {
      const order = bytes[0x36] ? bytes[0x37] : 13;
      reset(); bytes[0x36] = 0; bytes[0x37] = 255;
      if (order === 2 || order === 7) { push(order, []); push(8, [0, Number(order === 7)]); }
      else { push(1, [65535, input.hp, 0]); becameIdle = true; }
      continue;
    }
    if (task === 8) {
      if (word(payload) !== 0) { bytes[0x38]--; bytes[0xc6] = 0; continue; }
      put(0x2e, world.commandTarget[0]); put(0x30, world.commandTarget[1]);
      put(payload, 1);
      const count = world.route.cells.length;
      bytes.fill(0, 0x86, 0x96);
      for (let index = 0; index < count; index++) {
        const offset = 0x86 + (index >> 1), shift = (index & 1) * 4;
        bytes[offset] |= legs[count - 1 - index].code << shift;
      }
      push(6, [count - 1, count, word(0) >> 8, word(4) >> 8, word(payload + 2), 65535, 65535, 0]);
      continue;
    }
    if (task === 6) {
      const index = view.getInt16(payload, true);
      if (index === -1) { bytes[0x38]--; break; }
      const code = (bytes[0x86 + (index >> 1)] >> ((index & 1) * 4)) & 15;
      const vector = legacyHarvesterMotionTables.vectors[code];
      const oldX = word(payload + 4), oldY = word(payload + 6), nextX = oldX + vector[0], nextY = oldY + vector[1];
      const oldCell = oldY * world.width + oldX, nextCell = nextY * world.width + nextX;
      groundWrite("0x415e30", nextCell, 2, groundAt(nextCell) & ~1023);
      groundWrite("0x415e43", nextCell, 4, groundAt(nextCell) | input.slot);
      put(payload + 4, nextX); put(payload + 6, nextY); put(payload, index - 1);
      bank(world.moveBank);
      const leg = legs[legs.length - 1 - index], history = 0x40000000 >> input.team;
      push(5, [leg.stepX, leg.stepY, leg.count, oldX, oldY]);
      push(4, [leg.direction]);
      groundWrite("0x41253b", oldCell, 2, groundAt(oldCell) | 1023);
      groundWrite("0x412580", oldCell, 4, groundAt(oldCell) | history);
      groundWrite("0x4125af", nextCell, 4, groundAt(nextCell) | history);
      continue;
    }
    const current = decodeLegacyHarvesterMovement([...bytes], input.slot, input.randomIndex, ground);
    const idle = reduceLegacyHarvesterIdle(current, { ...world, groundCell: (current.yQ8 >> 8) * world.width + (current.xQ8 >> 8),
      groundWord: groundAt((current.yQ8 >> 8) * world.width + (current.xQ8 >> 8)) });
    if (!idle.supported) return idle;
    bank(idle.state.animation.bank);
    if (idle.state.stack.length < current.stack.length) bytes[0x38]--;
    else if (idle.state.stack.length > current.stack.length) push(3, idle.state.stack[1].words);
    else if (task === 3) put(payload, idle.state.stack[1].words[0]);
    break;
  }
  const state = decodeLegacyHarvesterMovement([...bytes], input.slot, input.randomIndex, ground);
  visits.push({ boundary: "0x419576", state });
  const groundCell = (state.yQ8 >> 8) * world.width + (state.xQ8 >> 8);
  return { supported: true, state, visits, groundWrites, randomAdvances: [], idleEvent: becameIdle ? { kind: "native-harvester-idle",
    boundary: "after-mobile-entity-update", state, raw: state.raw, groundCell,
    groundWord: groundAt(groundCell), arrived: (state.xQ8 >> 8) === (world.commandTarget[0] >> 8)
      && (state.yQ8 >> 8) === (world.commandTarget[1] >> 8) } : null };
}