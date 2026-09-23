import { legacyHarvesterTurnDirection } from "./legacy-harvester-movement";
import { advanceLegacyResourceAnimation } from "./legacy-resource";
import { acquireLegacySourceCombatTarget, stageLegacySourceCombatFire, type LegacySourceCombatTables } from "./legacy-source-combat-acquisition";
import { isLegacyNativeFireWeapon, launchLegacyNativeFire, validLegacyNativeProjectileState, type LegacyNativeFireTables, type LegacyNativeProjectileState, type LegacyNativeFireSpawn } from "./legacy-native-fire";

export interface LegacyAiTaskWorld {
  readonly typeId: number;
  readonly width: number;
  readonly height: number;
  readonly families: readonly number[];
  readonly ground: readonly number[];
  readonly pthSha256: string;
  readonly typeBytes: readonly number[];
}

export interface LegacyAiTaskFrame {
  readonly slot: number;
  readonly raw: readonly number[];
  readonly boundary: "initializer-entry" | "task-handler-entry";
  readonly world: LegacyAiTaskWorld;
}

export interface LegacyAiTaskSpan {
  readonly task: number;
  readonly offset: number;
  readonly words: readonly number[];
}

export type LegacyAiTaskResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly raw: readonly number[]; readonly stack: readonly LegacyAiTaskSpan[];
      readonly completedHandler: 0x412014 | 0x416104; readonly redispatch: boolean;
      readonly nextOwner: "native-task8" | "native-task6-movement" | "native-base-task";
      readonly registeredVisitComplete: false; readonly randomAdvances: readonly never[];
      readonly groundWrites: readonly never[] };

const integer = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
const SPANS: Readonly<Record<number, number>> = { 1: 3, 2: 0, 3: 2, 4: 1, 5: 5, 6: 8, 7: 0, 8: 2, 11: 1 };

export function decodeLegacyAiTaskStack(raw: readonly number[]): readonly LegacyAiTaskSpan[] {
  if (raw.length !== 220 || raw.some(value => !integer(value, 0, 255))) throw new RangeError("invalid-native-actor");
  if (raw[0x38] === 255) return [];
  if (raw[0x38] > 5) throw new RangeError("invalid-native-task-depth");
  const view = new DataView(Uint8Array.from(raw).buffer);
  return Array.from({ length: raw[0x38] + 1 }, (_, level) => {
    const task = raw[0x39 + level * 2], offset = raw[0x3a + level * 2], end = raw[0x3c + level * 2];
    if (!(task in SPANS) || end - offset !== SPANS[task] || end > 32 || (!level && offset !== 0)) {
      throw new RangeError("unowned-native-task-span");
    }
    return { task, offset, words: Array.from({ length: end - offset }, (_, index) => view.getUint16(0x46 + (offset + index) * 2, true)) };
  });
}

export function reduceLegacyAiTask(frame: LegacyAiTaskFrame): LegacyAiTaskResult {
  const reject = (diagnostic: string): LegacyAiTaskResult => ({ supported: false, diagnostic });
  let stack: readonly LegacyAiTaskSpan[];
  try { stack = decodeLegacyAiTaskStack(frame.raw); } catch (error) {
    return reject(error instanceof Error ? error.message : "invalid-native-task-stack");
  }
  const { raw, world } = frame;
  if (!integer(frame.slot, 152, 799) || raw[0x2c] !== 1 || raw[7] > 8 || raw[6] >= 110
    || raw[0xc6] > 8 || raw[0x36] > 1) return reject("unowned-native-actor-state");
  if (world.typeId !== raw[6] || world.typeBytes.length !== 280 || world.typeBytes.some(value => !integer(value, 0, 255))) return reject("invalid-source-type-record");
  const census = new DataView(Uint8Array.from(world.typeBytes).buffer);
  if (census.getInt32(12, true) <= 0 || world.typeBytes[0x60] !== 0) return reject("unowned-native-movement-class");
  const bytes = Uint8Array.from(raw), view = new DataView(bytes.buffer);
  const word = (offset: number) => view.getUint16(offset, true);
  const put = (offset: number, value: number) => view.setUint16(offset, value, true);
  const push = (task: number, words: readonly number[]) => {
    bytes[0x38]++;
    const level = bytes[0x38], offset = bytes[0x3a + level * 2];
    bytes[0x39 + level * 2] = task;
    bytes[0x3c + level * 2] = offset + words.length;
    words.forEach((value, index) => put(0x46 + (offset + index) * 2, value));
  };
  const result = (completedHandler: 0x412014 | 0x416104, nextOwner: "native-task8" | "native-task6-movement" | "native-base-task"): LegacyAiTaskResult => ({
    supported: true, raw: [...bytes], stack: decodeLegacyAiTaskStack([...bytes]), completedHandler,
    redispatch: completedHandler === 0x416104, nextOwner, registeredVisitComplete: false,
    randomAdvances: [], groundWrites: [],
  });
  if (frame.boundary === "initializer-entry") {
    if (raw[0x36] !== 1 || (raw[0x37] !== 2 && raw[0x37] !== 7)) return reject("unowned-native-order-initializer");
    bytes[0x39] = 0; bytes[0x3a] = 0; bytes[0x38] = 255; bytes[0x36] = 0;
    push(raw[0x37], []); push(8, [0, Number(raw[0x37] === 7)]);
    bytes[0x37] = 255;
    return result(0x412014, "native-task8");
  }
  if (frame.boundary !== "task-handler-entry") return reject("invalid-native-task-boundary");
  const top = stack.at(-1);
  if (top?.task === 6) return reject("native-task6-movement-owner-required");
  if (stack.length !== 2 || ![2, 7].includes(stack[0].task) || top?.task !== 8
    || top.words[1] !== Number(stack[0].task === 7)) return reject("unowned-native-task-visit");
  if (raw[0x36]) return reject("pending-order-requires-initializer-owner");
  const waypoint = top.words[0];
  if (waypoint > 8) return reject("invalid-native-waypoint-cursor");
  if (waypoint >= raw[0xc6]) {
    bytes[0xc6] = 0; bytes[0x38]--;
    return result(0x416104, "native-base-task");
  }
  if (!integer(world.width, 1, 256) || !integer(world.height, 1, 256)
    || world.families.length !== world.width * world.height || world.ground.length !== world.families.length
    || !/^[a-f0-9]{64}$/.test(world.pthSha256)
    || world.families.some(value => !integer(value, 0, 255))
    || world.ground.some(value => !integer(value, 0, 0xffffffff))) return reject("invalid-source-path-world");
  const originX = word(0) >> 8, originY = word(4) >> 8;
  const targetX = word(0xa6 + waypoint * 4) >> 8, targetY = word(0xa8 + waypoint * 4) >> 8;
  const count = Math.abs(targetX - originX), step = Math.sign(targetX - originX);
  if (originX >= world.width || originY >= world.height || targetX >= world.width || targetY !== originY
    || count < 1 || count > 3) return reject("native-general-path-owner-required");
  const family = world.families[originY * world.width + originX];
  if (!family || (world.ground[originY * world.width + originX] & 1023) !== frame.slot) return reject("native-origin-occupancy-mismatch");
  for (let index = 1; index <= count; index++) {
    const cell = originY * world.width + originX + index * step;
    if (world.families[cell] !== family || (world.ground[cell] & 1023) !== 1023) return reject("native-obstructed-path-owner-required");
  }
  put(0x2e, targetX * 256 + 128); put(0x30, targetY * 256 + 128);
  put(0x46 + top.offset * 2, waypoint + 1);
  const direction = step > 0 ? 4 : 3;
  for (let index = 0; index < count; index++) {
    const offset = 0x86 + (index >> 1), shift = (index & 1) * 4;
    bytes[offset] = (bytes[offset] & ~(15 << shift)) | (direction << shift);
  }
  push(6, [count - 1, count, originX, originY, top.words[1], 65535, 65535, word(0x46 + (top.offset + 9) * 2)]);
  return result(0x416104, "native-task6-movement");
}

export interface LegacyAiRegisteredWorld extends LegacyAiTaskWorld {
  readonly combat?: LegacySourceCombatTables;
  readonly nativeFire?: LegacyNativeFireTables;
  readonly air: readonly number[];
  readonly extra: readonly number[];
  readonly enemyMask: number;
  readonly teamControl: number;
  readonly weapons: readonly number[];
  readonly randomTable: readonly number[];
  readonly fin: Readonly<Record<number, readonly (readonly number[])[]>>;
}

export interface LegacyAiRegisteredFrame {
  readonly projectiles?: LegacyNativeProjectileState;
  readonly slot: number;
  readonly raw: readonly number[];
  readonly world: LegacyAiRegisteredWorld;
  readonly counter: number;
  readonly rngCursor: number;
  readonly task6Budget: number;
}

export interface LegacyAiGroundWrite {
  readonly eip: string;
  readonly cell: number;
  readonly size: 2 | 4;
  readonly before: number;
  readonly after: number;
}

export type LegacyAiRegisteredResult =
  | { readonly supported: false; readonly diagnostic: string; readonly combatHandoff?: LegacyAiCombatHandoff }
  | { readonly supported: true; readonly registeredVisitComplete: true; readonly raw: readonly number[];
      readonly stack: readonly LegacyAiTaskSpan[]; readonly ground: readonly number[];
      readonly groundWrites: readonly LegacyAiGroundWrite[]; readonly randomAdvances: readonly number[];
      readonly rngCursor: number; readonly task6Budget: number;
      readonly projectiles?: LegacyNativeProjectileState;
      readonly spawns: readonly LegacyNativeFireSpawn[];
      readonly combatGate: { readonly readyAttackVisit: boolean; readonly readyEndToEndCombat: false;
        readonly requiredOwners: readonly ["projectile-travel-collision-damage", "session-atomic-projectile-commit"] };
      readonly sourceEnvelope: { readonly boundary: 0x419248; readonly pthSha256: string;
        readonly typeId: number; readonly slot: number; readonly team: number; readonly counter: number };
      readonly pendingHandoff: { readonly slot: number; readonly team: number;
        readonly expectedRaw: readonly number[]; readonly pendingNativeTask: boolean } };

export interface LegacyAiCombatHandoff {
  readonly registeredVisitComplete: false;
  readonly boundary: 0x412e13 | 0x4131ae | 0x414ce4;
  readonly nextOwner: "native-projectile-launch-owner" | "native-registered-return-owner" | "native-acquisition-path-owner";
  readonly slot: number;
  readonly target: number;
  readonly targetRaw: readonly number[];
  readonly expectedRaw: readonly number[];
  readonly entryRaw: readonly number[];
  readonly raw: readonly number[];
  readonly stack: readonly LegacyAiTaskSpan[];
  readonly ground: readonly number[];
  readonly groundWrites: readonly LegacyAiGroundWrite[];
  readonly randomAdvances: readonly number[];
  readonly rngCursor: number;
  readonly task6Budget: number;
}

export function reduceLegacyAiRegisteredVisit(frame: LegacyAiRegisteredFrame): LegacyAiRegisteredResult {
  const reject = (diagnostic: string): LegacyAiRegisteredResult => ({ supported: false, diagnostic });
  const { world, raw } = frame;
  let initial: readonly LegacyAiTaskSpan[];
  try { initial = decodeLegacyAiTaskStack(raw); } catch { return reject("invalid-native-task-stack"); }
  if (!integer(frame.slot, 152, 799) || ![0, 8, 69, 73, 2, 3].includes(raw[6]) || raw[7] > 7
    || raw[0x2c] !== 1 || raw[0x35] !== 255 || raw[0x36] > 1
    || (raw[0x36] ? ![2, 7, 13].includes(raw[0x37]) : ![0, 255].includes(raw[0x37]))) return reject("unowned-native-actor-state");
  if (world.typeId !== raw[6] || world.typeBytes.length !== 280
    || world.typeBytes.some(value => !integer(value, 0, 255))) return reject("invalid-source-type-record");
  if (world.combat && (world.combat.typeTable.length !== 110 * 280
    || world.typeBytes.some((value, offset) => value !== world.combat!.typeTable[raw[6] * 280 + offset]))) {
    return reject("source-combat-type-record-mismatch");
  }
  const census = new DataView(Uint8Array.from(world.typeBytes).buffer);
  const speed = census.getInt32(12, true), turn = census.getInt32(8, true);
  if (!integer(speed, 1, 256) || !integer(turn, 1, 128) || world.typeBytes[0x60] !== 0) return reject("unowned-native-movement-class");
  const size = world.width * world.height;
  if (!integer(world.width, 1, 256) || !integer(world.height, 1, 256) || !/^[a-f0-9]{64}$/.test(world.pthSha256)
    || world.families.length !== size || world.families.some(value => !integer(value, 0, 255))
    || world.ground.length !== size || world.ground.some(value => !integer(value, 0, 0xffffffff))
    || [world.air, world.extra].some(plane => plane.length !== size || plane.some(value => !integer(value, 0, 65535)))) {
    return reject("invalid-source-guard-planes");
  }
  if (!integer(frame.counter, 0, 0xffffffff) || !integer(frame.rngCursor, 0, 255)
    || !integer(frame.task6Budget, 0, 9) || !integer(world.enemyMask, 0, 0xffffffff)
    || !integer(world.teamControl, 0, 0xffffffff) || world.randomTable.length !== 256
    || world.randomTable.some(value => !integer(value, -2147483648, 2147483647))
    || world.weapons.length % 72 || world.weapons.some(value => !integer(value, 0, 255))) return reject("invalid-native-host-guards");
  const bytes = Uint8Array.from(raw), view = new DataView(bytes.buffer), ground = [...world.ground];
  const word = (offset: number) => view.getUint16(offset, true);
  const put = (offset: number, value: number) => view.setUint16(offset, value, true);
  const hp = view.getInt32(12, true), stand = census.getUint32(0x80, true), move = census.getUint32(0x7c, true);
  const fireOwned = Boolean(world.nativeFire && frame.projectiles);
  if (frame.projectiles && !validLegacyNativeProjectileState(frame.projectiles)) return reject("invalid-native-projectile-pool");
  const fireBanks = fireOwned ? Array.from({ length: Math.min(4, Math.max(0, census.getInt32(0xe4, true))) },
    (_, index) => census.getUint32(0xa0 + index * 4, true)) : [];
  const damageFeedback = raw[0xc7] !== 0 || raw[0xc8] !== 0 || raw[0xc9] !== 0;
  const reactionCount = census.getInt32(0xd8, true);
  if (damageFeedback && (![0, 8].includes(raw[6]) || raw[0xc8] !== 1 || raw[0xc9] !== 1
    || reactionCount !== (raw[6] === 0 ? 7 : 6))) return reject("unowned-native-damage-feedback");
  const reactionBanks = damageFeedback ? Array.from({ length: reactionCount },
    (_, index) => census.getUint32(0xbc + index * 4, true)) : [];
  const reactionBank = view.getUint32(0x1c, true);
  if (damageFeedback && (!(reactionBank === stand && raw[0x22] === 2)
    && !(reactionBanks.includes(reactionBank) && [1, 2].includes(raw[0x22])))) return reject("unowned-native-damage-animation");
  const zeroRanges = [[2, 4], [0xb, 0xc], [0x1b, 0x1c], [0x20, 0x22], [0x23, 0x24], [0x28, 0x2a],
    [0x2b, 0x2c], [0x2d, 0x2e], [0x32, 0x35], [0x96, 0xa6], [0xca, 0xcd], [0xcf, 0xd1], [0xd6, 0xdc]];
  if (!integer(hp, 1, 32767) || word(0) >= world.width * 256 || word(4) >= world.height * 256
    || !(fireOwned ? [0, 65536].includes(view.getUint32(0x10, true) & 0xffffff00) : [0, 65536].includes(view.getUint32(0x10, true))) || (!damageFeedback && raw[0x22] !== 2) || raw[0x2a] !== 2
    || (!damageFeedback && reactionBank !== stand) || view.getUint32(0x24, true) !== stand
    || !(fireOwned ? [0, 1, 2] : [0]).includes(raw[0x1a]) || ![stand, move, ...fireBanks].includes(view.getUint32(0x14, true))
    || zeroRanges.some(([start, end]) => !(damageFeedback && start === 0x20) && raw.slice(start, end).some(value => value !== 0))
    || raw.slice(0xd1, 0xd6).join() !== "255,254,255,254,255"
    || raw[0xcd] >= world.width || raw[0xce] >= world.height || raw[0xc6] > 8) return reject("unowned-native-auxiliary-work");
  for (const bank of [stand, move, ...fireBanks, ...reactionBanks]) {
    const directions = world.fin[bank];
    if (!bank || !directions || directions.length !== 32 || directions.some(delays => !delays.length
      || delays.length > 255 || delays.some(delay => !integer(delay, 0, 255)))) return reject("invalid-source-fin-profile");
  }
  if (damageFeedback && raw[0x20] >= world.fin[reactionBank][(((raw[9] + 8) & 255) >>> 4) * 2].length) {
    return reject("unowned-native-damage-animation");
  }
  const taskShape = initial.map(span => span.task).join();
  const idleTurn = /^1,4(,3)?$/.test(taskShape);
  if (idleTurn) {
    const [idle, turning, waiting] = initial;
    if (![0, 8, 2].includes(raw[6]) || census.getInt32(0xdc, true) !== 0
      || idle.words[0] !== 65535 || !integer(idle.words[1], 1, 32767)
      || !integer(idle.words[2], 1, 3) || turning.words[0] > 255
      || (waiting && (waiting.words[1] !== idle.words[1]
        || waiting.words[0] > (idle.words[2] < 3 ? 15 : 45)))) return reject("unowned-native-idle-turn-payload");
  }
  if ((!idleTurn && !/^(1(,3|,11)?|[27](,8(,6(,11|,5(,4)?)?)?)?)$/.test(taskShape))
    || (initial.some(span => span.task === 11) && (!fireOwned || initial.at(-1)!.words[0] > 15))) return reject("unowned-native-task-visit");
  const path = initial.find(span => span.task === 6), step = initial.find(span => span.task === 5);
  const reservationX = path ? path.words[2] : word(0) >> 8, reservationY = path ? path.words[3] : word(4) >> 8;
  if (reservationX >= world.width || reservationY >= world.height
    || (ground[reservationY * world.width + reservationX] & 1023) !== frame.slot) return reject("native-origin-occupancy-mismatch");
  if (path) {
    const [cursor, count, column, row, guard, oldX, oldY] = path.words;
    if (!integer(count, 1, 3) || (cursor !== 65535 && !integer(cursor, 0, count - 1))
      || guard !== Number(initial[0].task === 7) || oldX !== 65535 || oldY !== 65535
      || row !== word(4) >> 8 || (word(0x30) >> 8) !== row) return reject("unowned-native-path-payload");
    const codes = Array.from({ length: count }, (_, index) => (raw[0x86 + (index >> 1)] >> ((index & 1) * 4)) & 15);
    if (![3, 4].includes(codes[0]) || codes.some(code => code !== codes[0])) return reject("native-general-path-owner-required");
    if (step && (Math.abs((step.words[0] << 16) >> 16) !== speed || step.words[1] !== 0
      || step.words[2] > Math.ceil(256 / speed) || step.words[4] !== row
      || step.words[3] + (codes[0] === 4 ? 1 : -1) !== column)) return reject("unowned-native-step-payload");
    const turning = initial.find(span => span.task === 4);
    if (turning && turning.words[0] !== (codes[0] === 4 ? 0 : 128)) return reject("unowned-native-turn-payload");
  }
  const selected = world.typeBytes[0x30 + raw[7]];
  if (selected > 5) return reject("invalid-source-weapon-selection");
  const weapon = census.getInt32(0x18 + selected * 4, true);
  const weapons = new DataView(Uint8Array.from(world.weapons).buffer);
  if (weapon < -1 || weapon * 72 + 24 > world.weapons.length) return reject("invalid-source-weapon-record");
  const weaponRange = weapon === -1 ? 0 : weapons.getInt32(weapon * 72 + 20, true);
  if (!integer(weaponRange, 0, 32)) return reject("unowned-native-acquisition-range");
  const scanClear = (radius: number) => {
    const originX = word(0) >> 8, originY = word(4) >> 8;
    for (let row = Math.max(0, originY - radius); row <= Math.min(world.height - 1, originY + radius); row++) {
      for (let column = Math.max(0, originX - radius); column <= Math.min(world.width - 1, originX + radius); column++) {
        const cell = row * world.width + column;
        if (!(ground[cell] & world.enemyMask)) continue;
        if ([ground[cell], world.air[cell], world.extra[cell]].some(value => ![1023, 1022, frame.slot].includes(value & 1023))) return false;
      }
    }
    return true;
  };
  const groundWrites: LegacyAiGroundWrite[] = [], randomAdvances: number[] = [];
  let rngCursor = frame.rngCursor, task6Budget = frame.task6Budget;
  let projectiles = frame.projectiles;
  const spawns: LegacyNativeFireSpawn[] = [];
  let attackVisitComplete = false;
  const finish = (): LegacyAiRegisteredResult => ({ supported: true, registeredVisitComplete: true,
    raw: [...bytes], stack: decodeLegacyAiTaskStack([...bytes]), ground, groundWrites, randomAdvances, rngCursor, task6Budget,
    projectiles, spawns,
    combatGate: { readyAttackVisit: attackVisitComplete, readyEndToEndCombat: false,
      requiredOwners: ["projectile-travel-collision-damage", "session-atomic-projectile-commit"] },
    sourceEnvelope: { boundary: 0x419248, pthSha256: world.pthSha256, typeId: world.typeId, slot: frame.slot, team: raw[7], counter: frame.counter },
    pendingHandoff: { slot: frame.slot, team: raw[7], expectedRaw: [...raw], pendingNativeTask: bytes[0x36] !== 0 } });
  const acquire = (radius?: number) => world.combat
    ? acquireLegacySourceCombatTarget(frame.slot, [...bytes], { ...world, ...world.combat, ground }, radius)
    : { supported: false as const, diagnostic: "missing-source-combat-tables" };
  const combatHandoff = (target: number, chase = false): LegacyAiRegisteredResult => {
    const targetRaw = world.combat!.actors[target], entryRaw = [...bytes];
    const prefix = chase ? undefined : stageLegacySourceCombatFire(entryRaw, targetRaw, world.combat!.typeTable);
    if (prefix && !prefix.supported) return prefix;
    if (prefix?.supported) bytes.set(prefix.raw);
    const boundary = prefix?.supported ? prefix.boundary : 0x414ce4;
    if (!chase && fireOwned && [0, 8, 69, 73].includes(raw[6])) {
      if (selected > 2 || !isLegacyNativeFireWeapon(raw[6], weapon)) return reject("unverified-native-fire-weapon");
      attackVisitComplete = true;
      if (boundary === 0x4131ae) return finish();
      const launched = launchLegacyNativeFire({ slot: frame.slot, raw: [...bytes], target: targetRaw,
        typeBytes: world.typeBytes, weapons: world.weapons, tables: world.nativeFire!, projectiles: projectiles!,
        rngCursor, randomTable: world.randomTable });
      if (!launched.supported) return launched;
      bytes.set(launched.raw); projectiles = launched.projectiles; spawns.push(...launched.spawns);
      rngCursor = launched.rngCursor; randomAdvances.push(...launched.randomAdvances);
      push(11, [launched.reload]);
      return finish();
    }
    return { supported: false, diagnostic: chase ? "native-acquisition-path-owner-required" : "native-fire-owner-required",
      combatHandoff: { registeredVisitComplete: false, boundary,
        nextOwner: chase ? "native-acquisition-path-owner" : boundary === 0x412e13 ? "native-projectile-launch-owner" : "native-registered-return-owner",
        slot: frame.slot, target, targetRaw: [...targetRaw], expectedRaw: [...raw], entryRaw, raw: [...bytes],
        stack: decodeLegacyAiTaskStack([...bytes]), ground, groundWrites, randomAdvances, rngCursor, task6Budget } };
  };
  const random = () => { rngCursor = (rngCursor + 1) & 255; randomAdvances.push(rngCursor); return world.randomTable[rngCursor]; };
  const write = (eip: string, cell: number, width: 2 | 4, value: number) => {
    const mask = width === 2 ? 65535 : 0xffffffff;
    groundWrites.push({ eip, cell, size: width, before: (ground[cell] & mask) >>> 0, after: (value & mask) >>> 0 });
    ground[cell] = ((ground[cell] & ~mask) | (value & mask)) >>> 0;
  };
  const push = (task: number, words: readonly number[]) => {
    bytes[0x38]++;
    const level = bytes[0x38], offset = bytes[0x3a + level * 2];
    bytes[0x39 + level * 2] = task; bytes[0x3c + level * 2] = offset + words.length;
    words.forEach((value, index) => put(0x46 + (offset + index) * 2, value));
  };
  const bank = (next: number) => {
    if (view.getUint32(0x14, true) !== next || bytes[0x1a] !== 0) {
      view.setUint32(0x14, next, true); bytes[0x18] = 0; bytes[0x19] = 0; bytes[0x1a] = 0;
    }
  };
  if (!(frame.counter & 31)) bytes[0xa] = Math.min(255, bytes[0xa] + census.getInt32(0xf8, true));
  if (damageFeedback && bytes[0x22] === 2 && bytes[0xc7]) {
    if (reactionCount > 0) {
      const variant = random() % reactionCount;
      if (variant < 0) return reject("unowned-native-damage-random-value");
      view.setUint32(0x1c, reactionBanks[variant], true);
      bytes[0x20] = 0; bytes[0x21] = 0; bytes[0x22] = 1;
    }
    bytes[0xc7] = 0;
  }
  const currentBank = view.getUint32(0x14, true);
  const animation = advanceLegacyResourceAnimation({ profile: String(currentBank), frame: bytes[0x18], delay: bytes[0x19], mode: bytes[0x1a] as 0 | 1 | 2 },
    { id: String(currentBank), directions: world.fin[currentBank] }, bytes[9]);
  bytes[0x18] = animation.frame; bytes[0x19] = animation.delay; bytes[0x1a] = animation.mode;
  if (damageFeedback) {
    const secondaryBank = view.getUint32(0x1c, true);
    const reaction = advanceLegacyResourceAnimation({ profile: String(secondaryBank), frame: bytes[0x20], delay: bytes[0x21], mode: bytes[0x22] as 1 | 2 },
      { id: String(secondaryBank), directions: world.fin[secondaryBank] }, bytes[9]);
    bytes[0x20] = reaction.frame; bytes[0x21] = reaction.delay; bytes[0x22] = reaction.mode;
  }
  if (bytes[0x10] & 31) bytes[0x10] = (bytes[0x10] & 224) | ((bytes[0x10] & 31) - 1);
  let complete = false;
  for (let dispatch = 0; dispatch < 100; dispatch++) {
    const stack = decodeLegacyAiTaskStack([...bytes]), top = stack[stack.length - 1];
    const payload = 0x46 + top.offset * 2;
    if (top.task === 11) {
      if (bytes[0x1a] === 2) bank(stand);
      if (top.words[0]) put(payload, top.words[0] - 1); else bytes[0x38]--;
      complete = true; break;
    }
    if (top.task === 4) {
      bytes[9] = legacyHarvesterTurnDirection(bytes[9], top.words[0], turn);
      if (bytes[9] !== top.words[0]) { complete = true; break; }
      bytes[0x38]--; continue;
    }
    if (top.task === 5) {
      bank(move);
      if (!word(payload + 4)) { bytes[0x35] = 255; bytes[0x38]--; }
      else { put(0, word(0) + view.getInt16(payload, true)); put(4, word(4) + view.getInt16(payload + 2, true)); put(payload + 4, word(payload + 4) - 1); }
      complete = true; break;
    }
    if (top.task === 6 && ++task6Budget > 10) return reject("native-task6-budget-owner-required");
    if (top.task === 3) {
      if (bytes[0x36] || top.words[1] !== hp) { bytes[0x38]--; continue; }
      if (top.words[0]) put(payload, top.words[0] - 1); else bytes[0x38]--;
      complete = true; break;
    }
    if (bytes[0x36] || top.task === 2 || top.task === 7) {
      const order = bytes[0x36] ? bytes[0x37] : 13;
      if (bytes[0x36] && order === 13 && census.getInt32(0xfc, true) !== 0 && bytes[0xa] >= 32) {
        return reject("native-special-stop-owner-required");
      }
      bytes[0x39] = 0; bytes[0x3a] = 0; bytes[0x38] = 255; bytes[0x36] = 0;
      if (order === 2 || order === 7) { push(order, []); push(8, [0, Number(order === 7)]); }
      else push(1, [65535, hp, 0]);
      bytes[0x37] = 255; continue;
    }
    if (top.task === 8) {
      const projected = reduceLegacyAiTask({ slot: frame.slot, raw: [...bytes], world: { ...world, ground }, boundary: "task-handler-entry" });
      if (!projected.supported) return projected;
      bytes.set(projected.raw); continue;
    }
    if (top.task === 6) {
      const index = view.getInt16(payload, true);
      if (index === -1) {
        if ((word(0) >> 8) !== (word(0x2e) >> 8) || (word(4) >> 8) !== (word(0x30) >> 8)) return reject("native-path-continuation-owner-required");
        bytes[0x38]--; complete = true; break;
      }
      if (word(payload + 8) === 1) {
        if (world.combat) {
          const acquisition = acquire();
          if (!acquisition.supported) return acquisition;
          if (acquisition.target !== -1) return combatHandoff(acquisition.target);
        } else if (!scanClear(weaponRange)) return reject("native-attack-acquisition-owner-required");
      }
      const code = (bytes[0x86 + (index >> 1)] >> ((index & 1) * 4)) & 15;
      if (![3, 4].includes(code)) return reject("native-general-path-owner-required");
      const oldX = word(payload + 4), oldY = word(payload + 6), nextX = oldX + (code === 4 ? 1 : -1);
      const oldCell = oldY * world.width + oldX, nextCell = oldY * world.width + nextX;
      if (nextX < 0 || nextX >= world.width || (ground[oldCell] & 1023) !== frame.slot
        || (ground[nextCell] & 1023) !== 1023 || !world.families[oldCell]
        || world.families[nextCell] !== world.families[oldCell]) return reject("native-obstructed-path-owner-required");
      if (world.air[nextCell] >>> 10) return reject("native-trip-owner-required");
      const delta = nextX * 256 + 128 - word(0), direction = delta >= 0 ? 0 : 128;
      if (word(4) !== oldY * 256 + 128) return reject("native-nonhorizontal-step-owner-required");
      const count = Math.trunc(Math.abs(delta) / speed), stepX = Math.sign(delta) * speed;
      if (!count || ((word(0) + count * stepX) >> 8) !== nextX) return reject("native-step-arrival-owner-required");
      write("0x415e30", nextCell, 2, ground[nextCell] & ~1023);
      write("0x415e43", nextCell, 4, ground[nextCell] | frame.slot);
      put(payload + 4, nextX); put(payload, index - 1); bank(move);
      push(5, [stepX, 0, count, oldX, oldY]); push(4, [direction]);
      const history = 0x40000000 >>> raw[7];
      write("0x41253b", oldCell, 2, ground[oldCell] | 1023);
      write("0x412580", oldCell, 4, ground[oldCell] | history);
      write("0x4125af", nextCell, 4, ground[nextCell] | history);
      continue;
    }
    if (top.task !== 1 || (top.words[0] !== 65535 && (!fireOwned || top.words[0] >= 800)) || top.words[1] > 32767 || top.words[2] > 3) return reject("native-idle-owner-required");
    if (world.combat) {
      const acquisition = acquire();
      if (!acquisition.supported) return acquisition;
      put(payload, acquisition.target);
      if (acquisition.target !== -1) { put(payload + 4, 0); return combatHandoff(acquisition.target); }
    } else if (!scanClear(Math.max(weaponRange, world.teamControl ? 16 : top.words[1] > hp ? 9 : 4))) return reject("native-idle-acquisition-owner-required");
    bank(stand); put(payload, 65535);
    if (top.words[1] > hp) put(payload + 4, 0);
    put(payload + 2, hp);
    if (world.combat && (world.teamControl || !world.typeBytes[0x60])) {
      const acquisition = acquire(world.teamControl ? 16 : top.words[1] > hp ? 9 : 4);
      if (!acquisition.supported) return acquisition;
      if (acquisition.target !== -1) {
        const target = world.combat.actors[acquisition.target];
        put(payload + 4, 0); put(0x2e, target[0] | target[1] << 8); put(0x30, target[4] | target[5] << 8);
        return combatHandoff(acquisition.target, true);
      }
    }
    if (!(random() & 15) && census.getInt32(0xdc, true) === 0) push(4, [random() & 255]);
    const waits = word(payload + 4);
    if (waits < 3) put(payload + 4, waits + 1);
    push(3, [waits < 3 ? 15 : 45, hp]);
    complete = true; break;
  }
  if (!complete) return reject("native-dispatch-limit");
  return finish();
}

export function stageLegacyAiTaskPendingVisit(frame: LegacyAiRegisteredFrame, pending: {
  readonly slot: number; readonly team: number; readonly expectedRaw: readonly number[];
  readonly pendingNativeTask: boolean;
}): LegacyAiRegisteredResult {
  if (pending.slot !== frame.slot || pending.team !== frame.raw[7] || pending.expectedRaw.length !== 220
    || pending.expectedRaw.some((value, offset) => value !== frame.raw[offset])
    || (pending.pendingNativeTask && frame.raw[0x36] !== 1)) {
    return { supported: false, diagnostic: "native-pending-entity-owner-mismatch" };
  }
  return reduceLegacyAiRegisteredVisit(frame);
}