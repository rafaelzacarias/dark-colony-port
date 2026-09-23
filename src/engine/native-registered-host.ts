import { parseFin } from "../../tools/extractors/animations/fin";
import { parseDependencies, parseWeaponStats } from "../../tools/extractors/data/tables";
import { parseScenario } from "../../tools/extractors/data/scenario";
import { finSourceDuration } from "../render/fin-animation";
import { advanceLegacyResourceAnimation, advanceLegacyResourceCountdown } from "./legacy-resource";
import { sourceScenarioUpgradeLevels } from "./legacy-scenario-levels";
import { legacyHarvesterTurnDirection, legacyHarvesterMotionTables } from "./legacy-harvester-movement";
import { buildLegacyNativeGroundRoute, legacyNativeGroundRouteLeg, isLegacyNativeGroundRouteSource, rerouteLegacyNativeGroundRoute,
  correctLegacyNativeGroundRouteEndpoint,
  type LegacyNativeGroundRouteSource, type LegacyNativeGroundRouteState } from "./legacy-native-ground-route";
import { reduceLegacyNativeTaskNine, buildLegacyNativeTaskNineRoute, isLegacyNativeTaskNineSource,
  type LegacyNativeTaskNineSource } from "./legacy-native-task-nine";
import { reduceLegacyNativePendingMove, resolveLegacyNativePendingMove } from "./legacy-native-pending-move";

const hashes: Readonly<Record<string, string>> = {
  executable: "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
  gameStat: "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629",
  depend: "5acff29f0ed0f254f6dae17ddfb8fb1f50f6d99e92a5fe363d638f76abe54fd6",
  TRSC: "eb94f6f3fff53b9f46f1540abf5287c11f83a7db7957d6288b2330b13e1f3b2a",
  GRAY: "077887b708009109740a518bf8cff9c547a21145617dbf5dde575342fe5a641a",
  REAP: "44d1e85d5a28bca0ca3e45b5bc8032544f16e1dc04fdfd655c3d70ec15ab540b",
  SCYT: "a07924ca5d72d666ccf9266df0593cb77811f6ac3679a7a19e8a5b804dbd6f55",
  TOWR: "9e5637a26681eca10a02669545d4102f1d8f33e407dfeb7a95ab70d5d50bf9e7",
  VENT: "9f43206aba24f71a4a0cb7df841e09ebde2a243dc20310cd34644fed2c3ea84a",
  BEAC: "034a2fbe82bb7554b74952e735f038b77c2dfda5fc33889367236973cea24dac",
  DISH: "8c6977818f28b55d79b41c583dd47de30c8d80802e26f353dfad2d64507ecaf9",
  CENT: "58cac6fae5085fe6ee203b22eeaa05af9517cb0320267285159e464713288baf",
  TONG: "5c4510ba67675eb958d77d5b6e857b122d57ab8c6294205ace45e5081380902a",
  ALBU: "99c3d4e4fa0badeb2cd68361a6f1b57dcf9dfbdd027f820a68d806aa18773fa1",
  HUBU: "b27b20282999188e37a74872b70a273b370cc1dd219f2f8fa84f5f2f2ca3a5a4",
  TURR: "f0f25f1ae13cfcd6b53e3cdcae2e5efaca09e9e8290eb173bb8ce98a93d3a210",
  RNAT: "07b9fb9e12cf00b57df4d982dbbb7951c29eb65ab1f3981662232c34d387e15a",
  DROP: "66e8da41ff0a47229c1a33db4aae9e7f37307ec943f5bbd860acc832b07fc433",
  SAUC: "e3378e2f627df2550e899844e8e13e4b65c5e3c10db1d792f1479096a6d58dd7",
  SAWS: "7c9b19edfd72193b537e97661884912d593ad21763659ad9133b113b8dfadf27",
};
const missions = {
  HUMAN02: "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab",
  ALIEN02: "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e",
};
const supportedTypes = [0, 2, 8, 10, 16, 17, 25, 28, 29, 40, 41, 81, 84, 86, 89, 91, 92, 93];
const columns = [null, 4, 8, 12, 20, 16, 24, 28, 32, 40, 44, 64, 68, null, 100, 104, 108,
  null, 112, 116, 220, 236, 224, 240, 244, 248, 252, 256, 260, 264, 272, 276, null];
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const actorOffset = (slot: number) => 0x7d28 + slot * 220;
const teamOffset = (team: number) => 0xb98 + team * 0xe30;
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new RangeError(message);
}
const integer = (value: number, maximum: number) => Number.isInteger(value) && value >= 0 && value <= maximum;
function privateState(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  requireValue(typeof SharedArrayBuffer === "undefined" || !(value instanceof SharedArrayBuffer),
    "Unshared native buffers required");
  if (ArrayBuffer.isView(value)) {
    requireValue(typeof SharedArrayBuffer === "undefined" || !(value.buffer instanceof SharedArrayBuffer),
      "Unshared native buffers required");
    return;
  }
  if (value instanceof ArrayBuffer) return;
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null || Array.isArray(value) && prototype === Array.prototype,
    "Plain native state required");
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    requireValue("value" in descriptor, "Native state accessors unsupported");
    privateState(descriptor.value, seen);
  }
}
async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
}

export interface NativeRegisteredAssets {
  readonly executable: Uint8Array;
  readonly gameStat: Uint8Array;
  readonly depend: Uint8Array;
  readonly scenario: Uint8Array;
  readonly animations: Readonly<Record<string, Uint8Array>>;
}
export interface NativeRegisteredConfiguration {
  readonly scope: "source-native-registered-phase";
  readonly mission: "HUMAN02" | "ALIEN02";
  readonly types: readonly number[];
}
interface Profile {
  readonly type: number;
  readonly bytes: Uint8Array;
  readonly stand: number;
  readonly damageStandFallback: boolean;
  readonly directions: readonly (readonly number[])[];
  readonly move?: number;
  readonly moveDirections?: readonly (readonly number[])[];
}
interface Binding {
  profiles: Map<number, Profile>;
  types: Uint8Array;
  dependencies: Uint8Array;
  rng: readonly number[];
  cityGroups: readonly number[];
  groundRoute?: LegacyNativeGroundRouteSource;
  occupiedPath?: boolean;
  randomizedEndpoint?: boolean;
  taskNine?: LegacyNativeTaskNineSource;
  rnatScan?: readonly (readonly [number, number])[];
}
const bindings = new WeakMap<NativeRegisteredConfiguration, Binding>();

export async function createNativeRegisteredConfiguration(input: Readonly<{
  assets: NativeRegisteredAssets;
  standRelocations: readonly { readonly type: number; readonly address: number }[];
  groundRoute?: Readonly<{ source: LegacyNativeGroundRouteSource; rnatMoveBank: number; weaponStat: Uint8Array;
    occupiedPath?: true;
    randomizedEndpoint?: true;
    taskNine?: LegacyNativeTaskNineSource;
    troopMoveBanks?: readonly { readonly type: 0 | 8; readonly address: number }[] }>;
}>): Promise<NativeRegisteredConfiguration> {
  const relocations = structuredClone(input.standRelocations);
  const groundRoute = input.groundRoute && { ...input.groundRoute, weaponStat: Uint8Array.from(input.groundRoute.weaponStat),
    troopMoveBanks: structuredClone(input.groundRoute.troopMoveBanks ?? []) };
  if (groundRoute) requireValue(groundRoute.troopMoveBanks.every(entry => [0, 8].includes(entry.type))
    && new Set(groundRoute.troopMoveBanks.map(entry => entry.type)).size === groundRoute.troopMoveBanks.length
    && new Set([groundRoute.rnatMoveBank, ...groundRoute.troopMoveBanks.map(entry => entry.address)]).size
      === groundRoute.troopMoveBanks.length + 1, "Ambiguous troop MOVE relocation");
  if (groundRoute?.randomizedEndpoint) requireValue(groundRoute.occupiedPath === true,
    "Randomized endpoint requires occupied-path ownership");
  const assets = { ...input.assets, animations: { ...input.assets.animations } };
  for (const key of ["executable", "gameStat", "depend", "scenario"] as const) assets[key] = Uint8Array.from(assets[key]);
  assets.animations = Object.fromEntries(Object.entries(assets.animations).map(([key, bytes]) => [key, Uint8Array.from(bytes)]));
  for (const key of ["executable", "gameStat", "depend"] as const)
    requireValue(await digest(assets[key]) === hashes[key], `Unauthenticated native ${key}`);
  const scenarioDigest = await digest(assets.scenario);
  const mission = (Object.keys(missions) as (keyof typeof missions)[]).find(name => missions[name] === scenarioDigest);
  requireValue(mission, "Unauthenticated fresh SCN");
  if (groundRoute?.taskNine || groundRoute?.troopMoveBanks.length) requireValue(groundRoute.taskNine
    && isLegacyNativeTaskNineSource(groundRoute.taskNine) && groundRoute.taskNine.mission === mission
    && groundRoute.taskNine.width === groundRoute.source.width && groundRoute.taskNine.height === groundRoute.source.height,
    "Authenticated task9 source required for troop MOVE banks");
  const ownedTypes = groundRoute?.taskNine ? [...supportedTypes, 69] : supportedTypes;
  const states = new Map<string, readonly number[]>();
  for (const [name, bytes] of Object.entries(assets.animations)) {
    requireValue(hashes[name] && await digest(bytes) === hashes[name], `Unauthenticated FIN ${name}`);
    const animation = parseFin(bytes);
    for (const state of animation.states) if (state.validRange) {
      const delays = animation.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1).map(frame => finSourceDuration(frame.field2));
      states.set(state.name.toUpperCase(), delays);
    }
  }
  const text = new TextDecoder();
  const rows = text.decode(assets.gameStat).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("%"));
  requireValue(Number(rows.shift()) === 106 && rows.length === 106, "Incomplete native type source");
  const scenario = parseScenario(text.decode(assets.scenario));
  const types = new Uint8Array(110 * 280), typeView = view(types), profiles = new Map<number, Profile>();
  for (const [type, row] of rows.entries()) {
    const tokens = row.split(/\s+/), base = type * 280;
    requireValue(tokens.length === 33, "Invalid native scanner row");
    columns.forEach((offset, token) => { if (offset !== null) typeView.setInt32(base + offset, Number(tokens[token]), true); });
    typeView.setInt32(base, Number(tokens[32]) !== 0 ? 1 : 0, true);
    types[base + 0x60] = Number(tokens[13]);
    for (const team of scenario.teams) {
      const upgrades = sourceScenarioUpgradeLevels(team, type);
      types[base + 0x30 + team.index] = upgrades.weaponLevel;
      types[base + 0x38 + team.index] = upgrades.armorLevel;
    }
    if (!ownedTypes.includes(type)) continue;
    const matches = relocations.filter(binding => binding.type === type);
    requireValue(matches.length === 1 && integer(matches[0].address, 0xffffffff) && matches[0].address > 0,
      `Explicit stand-bank relocation required for type ${type}`);
    const stand = matches[0].address;
    typeView.setUint32(base + 0x80, stand, true);
    const candidates = Array.from({ length: 16 }, (_, index) => states.get(`${tokens[0]}STAND${(12 - index + 16) & 15}`.toUpperCase()));
    const directions = Array.from({ length: 32 }, (_, direction) => {
      const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
      const delays = offsets.map(offset => candidates[((direction + offset + 32) & 31) >> 1]).find(Boolean);
      requireValue(delays?.length, `Missing original FIN stand bank for type ${type}`);
      return delays;
    });
    const damageStandFallback = type === 81 && !states.has("TOWRBURN0") && !states.has("TOWRSCRCH0");
    let move: number | undefined, moveDirections: readonly (readonly number[])[] | undefined;
    const troopMove = groundRoute?.troopMoveBanks.find(entry => entry.type === type);
    if (groundRoute && (type === 25 || troopMove)) {
      requireValue(isLegacyNativeGroundRouteSource(groundRoute.source) && groundRoute.source.mission === mission && integer(groundRoute.rnatMoveBank, 0xffffffff)
        && groundRoute.rnatMoveBank > 0 && !relocations.some(entry => entry.address === groundRoute.rnatMoveBank),
      "Invalid source RNAT movement binding");
      move = troopMove?.address ?? groundRoute.rnatMoveBank;
      requireValue(integer(move, 0xffffffff) && move > 0 && !relocations.some(entry => entry.address === move),
        "Invalid source troop MOVE binding");
      const candidates = Array.from({ length: 16 }, (_, index) => states.get(`${tokens[0]}MOVE${(12 - index + 16) & 15}`.toUpperCase()));
      moveDirections = Array.from({ length: 32 }, (_, direction) => {
        const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
        const delays = offsets.map(offset => candidates[((direction + offset + 32) & 31) >> 1]).find(Boolean);
        requireValue(delays?.length, "Missing original RNAT MOVE FIN");
        return delays;
      });
      typeView.setUint32(base + 0x7c, move, true);
    }
    profiles.set(type, { type, bytes: types.slice(base, base + 280), stand, damageStandFallback, directions, move, moveDirections });
  }
  requireValue(relocations.length === ownedTypes.length && new Set(relocations.map(entry => entry.address)).size === relocations.length,
    "Ambiguous stand-bank relocation");
  const dependencies = new Uint8Array(110 * 52), dependencyView = view(dependencies);
  for (const entry of parseDependencies(text.decode(assets.depend))) {
    const base = entry.id * 52;
    dependencies[base] = 1;
    dependencyView.setInt32(base + 8, entry.cost, true);
    dependencyView.setInt32(base + 12, entry.interfaceId, true);
    entry.rawFields.forEach((value, index) => dependencyView.setInt32(base + 16 + index * 4, value, true));
    [...entry.dependencies, -1].forEach((value, index) => dependencyView.setInt32(base + 32 + index * 4, value, true));
  }
  const executable = view(assets.executable), pe = executable.getUint32(0x3c, true);
  const sectionTable = pe + 24 + executable.getUint16(pe + 20, true);
  const word = (address: number) => {
    for (let index = 0; index < executable.getUint16(pe + 6, true); index++) {
      const header = sectionTable + index * 40, base = 0x400000 + executable.getUint32(header + 12, true);
      if (address >= base && address + 4 <= base + executable.getUint32(header + 16, true))
        return executable.getInt32(executable.getUint32(header + 20, true) + address - base, true);
    }
    throw new RangeError("Unmapped native executable word");
  };
  const configuration = Object.freeze({ scope: "source-native-registered-phase" as const, mission,
    types: Object.freeze([...ownedTypes]) });
  let rnatScan: (readonly [number, number])[] | undefined;
  if (groundRoute) {
    requireValue(await digest(groundRoute.weaponStat) === "391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0",
      "Unauthenticated RNAT weapon source");
    const weapon = parseWeaponStats(text.decode(groundRoute.weaponStat)).find(entry => entry.id === typeView.getInt32(25 * 280 + 0x18, true));
    requireValue(weapon && integer(weapon.range, 15) && types[25 * 280 + 0x30 + 9] === 0, "Unsupported source RNAT acquisition range");
    rnatScan = [];
    let ring = 0;
    for (let index = 0; index < 809; index++) {
      const packed = word(0x434090 + index * 4), column = packed << 16 >> 16, row = packed >> 16;
      if (column === 99) { if (++ring > weapon.range) break; }
      else rnatScan.push([column, row]);
    }
    requireValue(ring > weapon.range, "Incomplete source RNAT scan rings");
  }
  bindings.set(configuration, { profiles, types, dependencies, rng: Array.from({ length: 256 }, (_, index) => word(0x478e04 + index * 4)),
    cityGroups: Array.from({ length: 15 }, (_, index) => word(0x41ae30 + index * 4)), groundRoute: groundRoute?.source,
    taskNine: groundRoute?.taskNine, occupiedPath: groundRoute?.occupiedPath === true,
    randomizedEndpoint: groundRoute?.randomizedEndpoint === true, rnatScan });
  return configuration;
}

export interface NativeRegisteredState {
  readonly game: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly planes: Readonly<{ ground: readonly number[]; air: readonly number[]; extra: readonly number[] }>;
  readonly dependencies: Uint8Array;
  readonly productionDirty: number;
  readonly rngCursor: number;
  readonly crtSeed: number;
  readonly task6Budget: number;
  readonly carrierFin?: Readonly<Record<number, readonly (readonly number[])[]>>;
  readonly groundRoute?: LegacyNativeGroundRouteState;
}
export interface NativeRegisteredCaller {
  readonly boundary: 0x419bb8;
  readonly packetCounter: number;
  readonly resourceCounter: number;
  readonly globalMode: 0;
}
export interface NativeRegisteredReceipt {
  readonly index: number;
  readonly slot: number;
  readonly type: number;
  readonly task: number;
  readonly before: Uint8Array;
  readonly after: Uint8Array;
  readonly rngBefore: number;
  readonly rngAfter: number;
  readonly budgetBefore: 0;
  readonly budgetAfter: number;
  readonly highWaterBefore: number;
  readonly highWaterAfter: number;
  readonly changes: readonly { readonly region: "game" | "dependencies"; readonly offset: number;
    readonly before: number; readonly after: number }[];
  readonly productionDirtyBefore: number;
  readonly productionDirtyAfter: number;
}

export interface NativeRegisteredRouteHandoff {
  readonly boundary: 0x414ce4;
  readonly slot: number;
  readonly raw: Uint8Array;
  readonly routeMode: number;
  readonly flight: number;
  readonly nextConsumers: readonly [0x44492c, 0x44302c, 0x4430b0];
  readonly registeredVisitComplete: false;
}

export function transactNativeRegisteredPhase(configuration: NativeRegisteredConfiguration, current: NativeRegisteredState,
  nativeCaller: NativeRegisteredCaller) {
  let index = -1, slot = -1, type = -1, task = -1;
  const visits: NativeRegisteredReceipt[] = [];
  let handoff: NativeRegisteredRouteHandoff | null = null;
  try {
    const binding = bindings.get(configuration);
    requireValue(binding, "Original authenticated registered configuration required");
    privateState(current);
    requireValue(current.game.length === 0x471b0 && current.dependencies.length === 110 * 52, "Complete native current-world buffers required");
    requireValue(integer(current.width, 256) && current.width > 0 && integer(current.height, 256) && current.height > 0,
      "Invalid native dimensions");
    if (binding.groundRoute) requireValue(current.width === binding.groundRoute.width && current.height === binding.groundRoute.height
      && current.groundRoute && current.groundRoute.address === view(current.game).getUint32(0x46f2c, true) + 0x1404,
    "Native route source/current map mismatch");
    for (const name of ["ground", "air", "extra"] as const) {
      const plane = current.planes[name], count = current.width * current.height;
      requireValue((Array.isArray(plane) || ArrayBuffer.isView(plane)) && plane.length === count, "Invalid current occupancy plane");
      for (let cell = 0; cell < count; cell++) requireValue(Object.hasOwn(plane, cell)
        && integer(plane[cell], name === "ground" ? 0xffffffff : 65535), "Invalid current occupancy plane");
    }
    requireValue(integer(current.rngCursor, 255) && integer(current.crtSeed, 0xffffffff)
      && integer(current.task6Budget, 10) && integer(current.productionDirty, 1), "Invalid shared native globals");
    requireValue(nativeCaller.boundary === 0x419bb8 && nativeCaller.globalMode === 0
      && integer(nativeCaller.packetCounter, 0xffffffff) && integer(nativeCaller.resourceCounter, 0xffffffff)
      && view(current.game).getUint32(0x94c, true) === nativeCaller.packetCounter
      && view(current.game).getUint32(0x530, true) === nativeCaller.resourceCounter, "Explicit actual native caller counters required");
    const staged = structuredClone(current), game = view(staged.game), dependencies = view(staged.dependencies);
    const mutable = { ...staged }, emptyIndices: number[] = [];
    for (let offset = 0; offset < staged.dependencies.length; offset++) if (offset % 52 < 4 || offset % 52 >= 8)
      requireValue(staged.dependencies[offset] === binding.dependencies[offset], "Current dependency source fields differ from DEPEND");
    const refreshDependencies = () => {
      const local = game.getInt32(0x7d1c, true);
      requireValue(integer(local, 7), "Invalid local CITY team");
      const base = teamOffset(local);
      for (let dependency = 0; dependency < 110; dependency++) {
        const offset = dependency * 52;
        if (!staged.dependencies[offset]) continue;
        const kind = dependencies.getInt32(offset + 16, true), target = dependencies.getInt32(offset + 20, true);
        const level = dependencies.getInt32(offset + 24, true), race = dependencies.getInt32(offset + 28, true);
        let satisfied = false;
        if (kind === 0) satisfied = game.getInt32(base + 0x3c + target * 4, true) !== 0
          && game.getInt32(base + 0xc4 + target * 4, true) >= level && game.getInt32(base + 0x20, true) === race;
        else if (kind === 2) {
          requireValue(level === 0 || level === 1, "Unknown source upgrade selector");
          satisfied = binding.types[target * 280 + (level ? 0x38 : 0x30) + local] >= race;
        } else requireValue(kind === 1, "Unknown dependency kind");
        let availability = satisfied ? 0 : 1;
        if (!satisfied) {
          for (let position = 0; position < 5; position++) {
            const prerequisite = dependencies.getInt32(offset + 32 + position * 4, true);
            if (prerequisite === -1) break;
            requireValue(integer(prerequisite, 109), "Invalid source prerequisite");
            const previous = prerequisite * 52;
            if (prerequisite === dependency || dependencies.getInt32(previous + 4, true) !== 0
              || dependencies.getInt32(previous + 16, true) === 0
              && staged.game[base + 0x78 + dependencies.getInt32(previous + 20, true)] !== 0) availability = 2;
          }
          if (kind === 0 && staged.game[base + 0x78 + target] !== 0 || staged.game[base + 0xda4 + dependency] !== 0) availability = 2;
        }
        dependencies.setInt32(offset + 4, availability, true);
      }
      mutable.productionDirty = 1;
    };
    for (index = 0; ; index++) {
      const highWater = game.getInt32(0x7d20, true);
      requireValue(integer(highWater, 799), "Invalid live registry high water");
      if (index > highWater) break;
      mutable.task6Budget = 0;
      slot = game.getInt16(0x468ec + index * 2, true);
      if (slot === -1) { staged.game[actorOffset(index) + 0x12] = 0; emptyIndices.push(index); continue; }
      requireValue(integer(slot, 799), "Invalid live registry value");
      const offset = actorOffset(slot), raw = staged.game.subarray(offset, offset + 220), actor = view(raw);
      type = raw[6];
      requireValue(raw[0x38] < 6, "Invalid native task depth");
      task = raw[0x39 + raw[0x38] * 2];
      const profile = binding.profiles.get(type);
      requireValue(profile, `Missing registered owner for type ${type}`);
      const before = Uint8Array.from(raw), rngBefore = mutable.rngCursor, scalar = view(profile.bytes);
      const gameBefore = Uint8Array.from(staged.game), dependenciesBefore = Uint8Array.from(staged.dependencies);
      const productionDirtyBefore = mutable.productionDirty;
      const hp = actor.getInt32(12, true), team = raw[7];
      const carrier = type === 92 || type === 93;
      const troopRoute = (type === 0 || type === 8) && profile.move !== undefined;
      requireValue(raw[0x2c] === 1 && hp > 0 && (raw[0x36] === 0 || (type === 25 || troopRoute) && raw[0x36] === 1)
        && raw[0xc7] === 0
        && raw[0xd0] === 0 && raw[0xd6] === 0 && (carrier || actor.getUint16(2, true) === 0),
      "Missing live damage, pending-order, or auxiliary consumer");
      requireValue(actor.getUint16(0, true) < staged.width * 256 && actor.getUint16(4, true) < staged.height * 256,
        "Actor lies outside the native map");
      requireValue(team < 8 || (type === 40 || carrier) && team === 8 || type === 25 && team === 9, "Invalid native actor team");
      if (carrier) requireValue(team === 8 && slot < 120 && slot % 15 >= 7
        && staged.game[teamOffset(Math.floor(slot / 15)) + 0xe13 + slot % 15 - 7] === 1,
      "Missing source carrier reservation");
      if (carrier) {
        const bank = staged.carrierFin?.[profile.stand];
        requireValue(bank?.length === 32 && bank.every((direction, index) => direction.length === profile.directions[index].length
          && direction.every((delay, frame) => delay === profile.directions[index][frame])),
        "Current carrier FIN bank differs from authenticated source timeline");
      }
      const reset = (mode: 0 | 2) => {
        if (actor.getUint32(0x14, true) !== profile.stand || raw[0x1a] !== mode) {
          actor.setUint32(0x14, profile.stand, true); raw[0x18] = 0; raw[0x19] = 0; raw[0x1a] = mode;
        }
      };
      const moveBank = () => {
        requireValue(profile.move && profile.moveDirections, "Missing original source MOVE bank");
        if (actor.getUint32(0x14, true) !== profile.move || raw[0x1a] !== 0) {
          actor.setUint32(0x14, profile.move, true); raw[0x18] = 0; raw[0x19] = 0; raw[0x1a] = 0;
        }
      };
      const push = (opcode: number, words: readonly number[]) => {
        requireValue(raw[0x38] < 4 || raw[0x38] === 255, "Native task stack overflow");
        raw[0x38] = (raw[0x38] + 1) & 255;
        const depth = raw[0x38], payload = raw[0x3a + depth * 2];
        requireValue(payload + words.length <= 32, "Native task payload overflow");
        raw[0x39 + depth * 2] = opcode; raw[0x3c + depth * 2] = payload + words.length;
        words.forEach((value, position) => actor.setUint16(0x46 + (payload + position) * 2, value, true));
      };
      if (!(nativeCaller.resourceCounter & 31)) raw[0xa] = Math.min(255, raw[0xa] + scalar.getInt32(0xf8, true));
      for (const animationOffset of [0x14, 0x1c, 0x24]) {
        const bank = actor.getUint32(animationOffset, true);
        const directions = bank === profile.stand ? profile.directions
          : animationOffset === 0x14 && bank === profile.move ? profile.moveDirections : undefined;
        requireValue(directions, "Missing source FIN bank consumer");
        const animation = advanceLegacyResourceAnimation({ profile: "stand", frame: raw[animationOffset + 4],
          delay: raw[animationOffset + 5], mode: raw[animationOffset + 6] as 0 | 1 | 2 | 3 },
        { id: "stand", directions }, raw[9]);
        raw[animationOffset + 4] = animation.frame; raw[animationOffset + 5] = animation.delay; raw[animationOffset + 6] = animation.mode;
      }
      if (raw[0x10] & 31) raw[0x10] = (raw[0x10] & 224) | ((raw[0x10] & 31) - 1);
      let complete = false;
      for (let dispatch = 0; dispatch < 100 && !complete; dispatch++) {
        const opcode = raw[0x39 + raw[0x38] * 2], payload = 0x46 + raw[0x3a + raw[0x38] * 2] * 2;
        requireValue(payload >= 0x46 && payload + 6 <= 0x86, "Invalid native task payload");
        if (carrier) {
          requireValue(opcode === 22 && payload + 12 <= 0x86
            && raw[0x3c + raw[0x38] * 2] - raw[0x3a + raw[0x38] * 2] === 6,
          "Missing native carrier travel/payload consumer");
          const velocity = actor.getInt16(payload, true), acceleration = actor.getInt16(payload + 2, true);
          const base = actor.getInt16(payload + 4, true), direction = actor.getInt16(payload + 6, true);
          const step = actor.getInt16(payload + 8, true), sound = actor.getInt16(payload + 10, true);
          requireValue(velocity === 0 && acceleration === 6 && base === (type === 92 ? 600 : 1200)
            && direction === 0 && step > 0 && step <= 50 && sound === -1,
          "Missing native carrier sound/descent-completion consumer");
          actor.setUint16(payload + 8, step - 1, true);
          actor.setUint16(2, base + velocity * step + Math.trunc(acceleration * step * step / 2), true);
          complete = true; continue;
        }
        if (troopRoute && (opcode === 1 || opcode === 9) && raw[0x36]) {
          requireValue(raw[0xcb] === 0 && raw[0x37] === 9 && raw[0xc6] <= 8 && scalar.getInt32(12, true) !== 0,
            "Missing troop pending-order initializer");
          raw[0x39] = 0; raw[0x3a] = 0; raw[0x38] = 255; raw[0x36] = 0;
          push(9, [0]); raw[0x37] = 255;
          continue;
        }
        if (type === 25 && (opcode === 1 || opcode === 8) && raw[0x36]) {
          requireValue(raw[0xcb] === 0 && [2, 7].includes(raw[0x37]) && raw[0xc6] <= 8,
            "Missing RNAT pending-order initializer");
          const order = raw[0x37];
          raw[0x39] = 0; raw[0x3a] = 0; raw[0x38] = 255; raw[0x36] = 0;
          push(order, []); push(8, [0, Number(order === 7)]); raw[0x37] = 255;
          continue;
        }
        if (type === 25 && opcode === 8 || troopRoute && opcode === 9) {
          let routeMode: number;
          if (opcode === 9) {
            const next = reduceLegacyNativeTaskNine(raw);
            raw.set(next.raw); routeMode = next.routeMode;
          } else {
            const waypoint = actor.getInt16(payload, true);
            requireValue(waypoint >= 0 && waypoint <= 8 && raw[0xc6] <= 8, "Invalid native waypoint cursor");
            if (waypoint >= raw[0xc6]) { raw[0xc6] = 0; raw[0x38]--; continue; }
            actor.setUint16(0x2e, actor.getUint16(0xa6 + waypoint * 4, true), true);
            actor.setUint16(0x30, actor.getUint16(0xa8 + waypoint * 4, true), true);
            actor.setUint16(payload, waypoint + 1, true);
            routeMode = actor.getInt16(payload + 2, true);
          }
          handoff = { boundary: 0x414ce4, slot, raw: Uint8Array.from(raw), routeMode,
            flight: profile.bytes[0x60], nextConsumers: [0x44492c, 0x44302c, 0x4430b0], registeredVisitComplete: false };
          requireValue(binding.groundRoute && mutable.groundRoute,
            "Missing native ground route search/distance/serialization consumers at 0x44492c/0x44302c/0x4430b0");
          requireValue(handoff.routeMode === 0 || handoff.routeMode === 1, "Unowned native route mode");
          const route = opcode === 9
            ? buildLegacyNativeTaskNineRoute(binding.taskNine!, mutable.groundRoute, raw, 0x800000 + offset, staged.planes.ground)
            : buildLegacyNativeGroundRoute(binding.groundRoute, mutable.groundRoute, raw, 0x800000 + offset, staged.planes.ground);
          raw.set(route.raw); mutable.groundRoute = route.state;
          const nextPayload = 0x46 + raw[0x3c + raw[0x38] * 2] * 2;
          const preserved = actor.getUint16(nextPayload + 14, true);
          push(6, [route.count - 1, route.count, ...route.origin, handoff.routeMode, 65535, 65535, preserved]);
          handoff = null;
          continue;
        }
        if ((type === 25 || troopRoute) && opcode === 6 && binding.groundRoute) {
          if (type === 25 && raw[0x36]) {
            const pendingFrame = { boundary: 0x4157ec as const, index, slot,
              registeredSlot: game.getInt16(0x468ec + index * 2, true), raw,
              rngCursor: mutable.rngCursor, task6Budget: mutable.task6Budget };
            const pending = resolveLegacyNativePendingMove(reduceLegacyNativePendingMove(pendingFrame), pendingFrame);
            raw.set(pending.raw); mutable.task6Budget = pending.task6Budget;
            continue;
          }
          requireValue(++mutable.task6Budget <= 10 && raw[0x36] === 0 && payload + 16 <= 0x86,
            "Missing RNAT task6 budget/pending consumer");
          let cursor = actor.getInt16(payload, true);
          const count = actor.getUint16(payload + 2, true);
          requireValue(count <= 32 && cursor >= -1 && cursor < 32, "Invalid native route cursor");
          if (!binding.occupiedPath) requireValue(cursor < count && actor.getUint16(payload + 10, true) === 65535
            && actor.getUint16(payload + 12, true) === 65535, "Missing RNAT dynamic route correction consumer");
          if (cursor === -1) {
            requireValue(actor.getUint16(0, true) >> 8 === actor.getUint16(0x2e, true) >> 8
              && actor.getUint16(4, true) >> 8 === actor.getUint16(0x30, true) >> 8,
            "Missing RNAT route continuation consumer at 0x414ce4");
            raw[0x38]--; complete = true; continue;
          }
          const reroute = (column: number, row: number, start: number) => {
            requireValue(mutable.groundRoute, "Missing occupied route scratch");
            const result = rerouteLegacyNativeGroundRoute(binding.groundRoute!, mutable.groundRoute, raw,
              0x800000 + offset, staged.planes.ground, slot, [column, row], start);
            raw.set(result.raw); mutable.groundRoute = result.state;
            cursor = actor.getInt16(payload, true);
            return result.reachable;
          };
          if (actor.getInt16(payload + 10, true) !== -1) {
            const column = actor.getInt16(payload + 10, true), row = actor.getInt16(payload + 12, true);
            if (column === actor.getInt16(payload + 4, true) && row === actor.getInt16(payload + 6, true)) {
              actor.setUint16(payload + 10, 65535, true); actor.setUint16(payload + 12, 65535, true);
            } else reroute(column, row, actor.getInt16(payload + 14, true));
          } else requireValue(actor.getInt16(payload + 12, true) === -1, "Invalid native route correction pair");
          requireValue(actor.getUint16(payload + 8, true) <= 1 && scalar.getInt32(0x48, true) === 0,
            "Missing RNAT source movement callback");
          if (actor.getUint16(payload + 8, true) === 1) {
            requireValue((team === 9 || troopRoute) && binding.rnatScan, "Missing RNAT source acquisition scan");
            const originColumn = actor.getUint16(0, true) >> 8, originRow = actor.getUint16(4, true) >> 8;
            const scan = troopRoute ? Array.from({ length: staged.width * staged.height }, (_, cell) =>
              [cell % staged.width - originColumn, Math.floor(cell / staged.width) - originRow] as const) : binding.rnatScan;
            const visibilityMask = troopRoute ? game.getUint32(teamOffset(team) + 0xe28, true) : 0x7f800000;
            for (const [deltaColumn, deltaRow] of scan) {
              const column = originColumn + deltaColumn, row = originRow + deltaRow;
              if (column < 0 || row < 0 || column >= staged.width || row >= staged.height) continue;
              const cell = row * staged.width + column;
              if (!(staged.planes.ground[cell] & visibilityMask)) continue;
              for (const plane of [staged.planes.ground, staged.planes.air, staged.planes.extra]) {
                const target = plane[cell] & 1023;
                if (target >= 1022 || target === slot) continue;
                requireValue(target < 800, "Invalid RNAT acquisition occupant");
                const targetOffset = actorOffset(target), targetType = staged.game[targetOffset + 6];
                requireValue(targetType < 106, "Invalid RNAT acquisition type");
                if (staged.game[targetOffset + 7] >= 8 || binding.types[targetType * 280]
                  || view(binding.types).getInt32(targetType * 280 + 0x68, true)) continue;
                if (troopRoute && staged.game[0x46f34 + team * 10 + staged.game[targetOffset + 7]]) continue;
                requireValue(false, "Missing RNAT visible attack acquisition consumer at 0x435570");
              }
            }
          }
          const code = (raw[0x86 + (cursor >> 1)] >> ((cursor & 1) * 4)) & 15;
          const vector = legacyHarvesterMotionTables.vectors[code];
          requireValue(vector, "Invalid native route nibble");
          const oldColumn = actor.getUint16(payload + 4, true), oldRow = actor.getUint16(payload + 6, true);
          const nextColumn = oldColumn + vector[0], nextRow = oldRow + vector[1];
          requireValue(integer(nextColumn, staged.width - 1) && integer(nextRow, staged.height - 1), "Native route step outside map");
          const oldCell = oldRow * staged.width + oldColumn, nextCell = nextRow * staged.width + nextColumn;
          requireValue((staged.planes.ground[oldCell] & 1023) === slot, "Native route lost current reservation");
          if ((staged.planes.ground[nextCell] & 1023) !== 1023) {
            requireValue(binding.occupiedPath, "Missing RNAT occupied-path consumer at 0x415458");
            let column = oldColumn, row = oldRow, remaining = cursor, direction = -1;
            let correctedEndpoint = false;
            do {
              if (remaining < 0) {
                requireValue(binding.randomizedEndpoint && mutable.groundRoute,
                  "Missing occupied endpoint displacement/random correction consumer");
                requireValue(column !== actor.getUint16(0, true) >> 8 || row !== actor.getUint16(4, true) >> 8,
                  "Missing occupied endpoint current-cell completion consumer");
                const correction = correctLegacyNativeGroundRouteEndpoint(binding.groundRoute, mutable.groundRoute,
                  { boundary: 0x4155d5, slot, raw, rawAddress: 0x800000 + offset,
                    ground: staged.planes.ground, rngCursor: mutable.rngCursor });
                raw.set(correction.raw); mutable.groundRoute = correction.state; mutable.rngCursor = correction.rngCursor;
                correctedEndpoint = true;
                break;
              }
              direction = (raw[0x86 + (remaining >> 1)] >> ((remaining & 1) * 4)) & 15;
              const step = legacyHarvesterMotionTables.vectors[direction];
              requireValue(step, "Invalid occupied route nibble");
              column += step[0]; row += step[1]; remaining--;
              requireValue(integer(column, staged.width - 1) && integer(row, staged.height - 1), "Occupied scan outside native map");
            } while ((staged.planes.ground[row * staged.width + column] & 1023) !== 1023);
            if (correctedEndpoint) continue;
            if (!reroute(column, row, remaining + 1)) {
              const blocker = staged.planes.ground[nextCell] & 1023;
              requireValue(blocker < 800, "Missing occupied reservation wait consumer");
              const blockerOffset = actorOffset(blocker), blockerTeam = staged.game[blockerOffset + 7];
              requireValue(blockerTeam < 10, "Invalid occupied blocker team");
              if (staged.game[blockerOffset + 0x35] === 255 && staged.game[0x46f34 + blockerTeam * 10 + team])
                staged.game[blockerOffset + 0x35] = direction;
              reset(0); push(3, [4, hp]);
            }
            continue;
          }
          requireValue(!(staged.planes.air[nextCell] >>> 10), "Missing RNAT source trip callback at 0x43e530");
          const leg = legacyNativeGroundRouteLeg(actor.getUint16(0, true), actor.getUint16(4, true), nextColumn, nextRow, scalar.getInt32(12, true));
          requireValue(leg.count >= 0 && leg.count <= 65535, "Invalid native RNAT leg duration");
          const ground = staged.planes.ground as number[];
          ground[nextCell] = ((ground[nextCell] & ~1023) | slot) >>> 0;
          actor.setUint16(payload + 4, nextColumn, true); actor.setUint16(payload + 6, nextRow, true);
          actor.setUint16(payload, cursor - 1, true); moveBank();
          push(5, [leg.stepX, leg.stepY, leg.count, oldColumn, oldRow]); push(4, [leg.direction]);
          const history = team < 8 ? 0x40000000 >>> team : 0;
          ground[oldCell] = (ground[oldCell] | 1023 | history) >>> 0;
          ground[nextCell] = (ground[nextCell] | history) >>> 0;
          continue;
        }
        if ((type === 25 || troopRoute) && opcode === 5 && binding.groundRoute) {
          requireValue(payload + 10 <= 0x86 && scalar.getInt32(0x48, true) === 0, "Missing RNAT movement callback");
          moveBank();
          const remaining = actor.getUint16(payload + 4, true);
          if (!remaining) { raw[0x35] = 255; raw[0x38]--; }
          else {
            actor.setUint16(0, actor.getUint16(0, true) + actor.getInt16(payload, true), true);
            actor.setUint16(4, actor.getUint16(4, true) + actor.getInt16(payload + 2, true), true);
            actor.setUint16(payload + 4, remaining - 1, true);
          }
          complete = true; continue;
        }
        if (opcode === 3) {
          if (raw[0x36] || actor.getInt16(payload + 2, true) !== hp) { raw[0x38]--; continue; }
          const remaining = actor.getInt16(payload, true);
          if (remaining > 0) actor.setUint16(payload, remaining - 1, true); else raw[0x38]--;
          complete = true; continue;
        }
        if (opcode === 4) {
          requireValue(scalar.getInt32(0xdc, true) === 0, "Missing type-specific turning callback");
          raw[9] = legacyHarvesterTurnDirection(raw[9], actor.getUint16(payload, true), scalar.getInt32(8, true));
          if (raw[9] === actor.getUint16(payload, true)) { raw[0x38]--; continue; }
          complete = true; continue;
        }
        if (opcode === 19) {
          requireValue(slot < 120 && [16, 17, 28, 29, 81].includes(type), "Missing CITY construction owner");
          const base = teamOffset(team), phase = actor.getInt16(payload, true);
          requireValue((phase === 0 && nativeCaller.packetCounter <= 3) || phase === 5, "Missing CITY carrier lifecycle consumer");
          if (phase === 0 && staged.game[base + 0xe12]) { complete = true; continue; }
          if (phase === 5 && raw[0x1a] !== 2) { complete = true; continue; }
          staged.game[base + 0xe12] = 1; reset(2); actor.setUint16(payload, 5, true);
          reset(0); staged.game[base + 0x78 + slot % 15] = 0;
          if (team === game.getInt32(0x7d1c, true)) refreshDependencies();
          staged.game[base + 0xe12] = 0;
          raw[0x38] = 0; raw[0x39] = 1; raw[0x3a] = 0; raw[0x3c] = 3;
          actor.setUint16(0x46, 65535, true); actor.setUint16(0x48, hp, true); actor.setUint16(0x4a, 0, true);
          complete = true; continue;
        }
        requireValue(opcode === 1, `Missing registered task ${opcode} consumer`);
        requireValue(raw[0x35] === 255, "Missing displaced idle consumer");
        if (raw[0xcb]) {
          requireValue(raw[0xcb] === 1, "Missing resource-claim callback");
          if (!(nativeCaller.resourceCounter & 3)) {
            const column = actor.getUint16(0, true) >>> 8, row = actor.getUint16(4, true) >>> 8;
            for (let horizontal = Math.max(0, column - 2); horizontal <= Math.min(staged.width - 1, column + 2); horizontal++)
              for (let vertical = Math.max(0, row - 2); vertical <= Math.min(staged.height - 1, row + 2); vertical++)
                for (const plane of [staged.planes.ground, staged.planes.air]) {
                  const candidate = plane[vertical * staged.width + horizontal] & 1023;
                  if (candidate >= 1022) continue;
                  requireValue(candidate < 800, "Invalid proximity actor");
                  const target = actorOffset(candidate);
                  requireValue(staged.game[target + 0xcb] !== 0 || staged.game[target + 7] !== 0, "Missing proximity capture/sound consumer");
                }
          }
          complete = true; continue;
        }
        if (type === 40) {
          const cell = (actor.getUint16(4, true) >>> 8) * staged.width + (actor.getUint16(0, true) >>> 8);
          const occupant = staged.planes.ground[cell] & 1023;
          requireValue(occupant < 800 || occupant >= 1022, "Invalid resource occupant");
          const next = advanceLegacyResourceCountdown({ rateWord: actor.getUint16(0x32, true),
            countdownWord: actor.getUint16(payload, true), sourceAnimationState: raw[0x1a],
            occupantType: occupant < 800 ? staged.game[actorOffset(occupant) + 6] : null });
          requireValue(next.transition !== "activate", "Missing extractor constructor consumer");
          actor.setUint16(payload, next.countdownWord, true);
          if (next.resetSourceAnimation) reset(next.transition === "dormant" ? 2 : 0);
          if (next.clearSourceDirection) raw[9] = 0;
          complete = true; continue;
        }
        if (slot < 120) {
          requireValue([16, 17, 28, 29, 81].includes(type), "Missing fixed CITY owner");
          requireValue(profile.damageStandFallback || hp > Math.floor(scalar.getInt32(0x44, true) * 11 / 16),
            "Missing damaged CITY FIN consumer");
          if (raw[0x1a] !== 1) reset(0);
          const group = binding.cityGroups[slot - team * 15], base = teamOffset(team);
          if (group !== 4) {
            requireValue(integer(group, 3) && staged.game[base + 0x108 + group] === 1
              && game.getUint16(base + 0x110 + group * 2, true) === 0, "Missing paid CITY production consumer");
            if (staged.game[base + 0x10c + group]) staged.game[base + 0x10c + group]--;
          }
          complete = true; continue;
        }
        const weapon = scalar.getInt32(0x18 + profile.bytes[0x30 + team] * 4, true);
        reset(0);
        if (weapon === -1) { push(3, [7, hp]); complete = true; continue; }
        const mask = game.getUint32(teamOffset(team) + 0xe28, true);
        for (let cell = 0; cell < staged.planes.ground.length; cell++) {
          if (!(staged.planes.ground[cell] & mask)) continue;
          for (const plane of [staged.planes.ground, staged.planes.air, staged.planes.extra]) {
            const candidate = plane[cell] & 1023;
            if (candidate >= 1022 || candidate === slot) continue;
            requireValue(candidate < 800, "Invalid acquisition actor");
            const target = actorOffset(candidate), targetType = staged.game[target + 6], targetTeam = staged.game[target + 7];
            requireValue(targetType < 106 && targetTeam < 10, "Invalid acquisition source type/team");
            if (binding.types[targetType * 280] || targetTeam >= 8
              || staged.game[0x46f34 + team * 10 + targetTeam]) continue;
            requireValue(false, "Missing visible-target acquisition consumer");
          }
        }
        actor.setUint16(payload, 65535, true);
        if (actor.getInt16(payload + 2, true) > hp) actor.setUint16(payload + 4, 0, true);
        actor.setUint16(payload + 2, hp, true);
        const random = () => binding.rng[mutable.rngCursor = (mutable.rngCursor + 1) & 255];
        if (!(random() & 15) && scalar.getInt32(0xdc, true) === 0) push(4, [random() & 255]);
        const waits = actor.getInt16(payload + 4, true);
        if (waits < 3) actor.setUint16(payload + 4, waits + 1, true);
        push(3, [waits < 3 ? 15 : 45, hp]); complete = true;
      }
      requireValue(complete, "Native task redispatch limit");
      const changes: { region: "game" | "dependencies"; offset: number; before: number; after: number }[] = [];
      for (const [region, previous, next] of [["game", gameBefore, staged.game], ["dependencies", dependenciesBefore, staged.dependencies]] as const)
        for (let address = 0; address < previous.length; address++) if (previous[address] !== next[address])
          changes.push({ region, offset: address, before: previous[address], after: next[address] });
      visits.push({ index, slot, type, task, before, after: Uint8Array.from(raw), rngBefore, rngAfter: mutable.rngCursor,
        budgetBefore: 0, budgetAfter: mutable.task6Budget, highWaterBefore: highWater, highWaterAfter: game.getInt32(0x7d20, true),
        changes, productionDirtyBefore, productionDirtyAfter: mutable.productionDirty });
    }
    return { ok: true as const, admitted: false as const, executableWholeGame: false as const,
      scope: configuration.scope, nativeCaller: { ...nativeCaller }, state: mutable, visits, emptyIndices };
  } catch (error) {
    return { ok: false as const, admitted: false as const, executableWholeGame: false as const,
      index, slot, type, task, nativeCaller: { ...nativeCaller }, completedVisits: visits,
      handoff,
      message: error instanceof Error ? error.message : String(error) };
  }
}

export class NativeRegisteredHost {
  readonly configuration: NativeRegisteredConfiguration;
  #current: NativeRegisteredState;
  #completed = false;

  constructor(configuration: NativeRegisteredConfiguration, boundary: NativeRegisteredState) {
    requireValue(bindings.has(configuration), "Original authenticated registered configuration required");
    privateState(boundary);
    this.configuration = configuration;
    this.#current = structuredClone(boundary);
    Object.freeze(this);
  }

  get snapshot(): NativeRegisteredState { return structuredClone(this.#current); }
  get completed(): boolean { return this.#completed; }

  transact(nativeCaller: NativeRegisteredCaller) {
    if (this.#completed) return { ok: false as const, admitted: false as const, executableWholeGame: false as const,
      index: -1, slot: -1, type: -1, task: -1, nativeCaller: { ...nativeCaller },
      completedVisits: [] as NativeRegisteredReceipt[], handoff: null,
      message: "Registered boundary already consumed; explicit next native phase boundary required" };
    const result = transactNativeRegisteredPhase(this.configuration, this.#current, nativeCaller);
    if (result.ok) { this.#current = structuredClone(result.state); this.#completed = true; }
    return result;
  }
}