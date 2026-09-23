import { advanceLegacyResourceAnimation, resetLegacyResourceAnimation,
  type LegacyResourceAnimation, type LegacyResourceAnimationProfile } from "./legacy-resource";

export const NATIVE_CONSTRUCTION_SOURCE = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b";

export interface NativeConstructionProfile extends LegacyResourceAnimationProfile {
  readonly source: string;
  readonly sha256: string;
  readonly first: number;
  readonly last: number;
}

export interface NativeConstructionConfiguration {
  readonly sourceSha256: string;
  readonly team: number;
  readonly race: 0 | 1;
  readonly base: { readonly x: number; readonly y: number };
  readonly map: { readonly width: number; readonly height: number };
  readonly fixedSlots: readonly (null | { readonly nativeId: number; readonly unitType: number;
    readonly health: number })[];
  readonly footprint: readonly { readonly x: number; readonly y: number; readonly occupant: number }[];
  readonly profiles: { readonly stand: NativeConstructionProfile; readonly build: NativeConstructionProfile;
    readonly auxiliary: NativeConstructionProfile };
}

export interface NativeConstructionActor {
  nativeId: number;
  unitType: number;
  team: number;
  health: number;
  status: number;
  registered: boolean;
  position: { x: number; y: number; height: number };
  task: 1 | 19 | 20 | 22;
  phase: number | null;
  movementCounter: number | null;
  departing: boolean;
  animation: LegacyResourceAnimation;
}

export interface NativeConstructionHost {
  readonly kind: "native-construction-host-v1";
  readonly configuration: NativeConstructionConfiguration;
  readonly receiptId: string | null;
  readonly visits: number;
  readonly busy: 0 | 1;
  readonly latch: 0 | 1;
  readonly ready: boolean;
  readonly actors: readonly (NativeConstructionActor | null)[];
  readonly footprint: readonly { readonly x: number; readonly y: number; readonly occupant: number }[];
  readonly reservedAuxiliary: number | null;
}

function requireHost(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native construction: ${message}`);
}

const pins = [
  [
    ["SCNCPODSTAND0", "HUBU.FIN", "b27b20282999188e37a74872b70a273b370cc1dd219f2f8fa84f5f2f2ca3a5a4", 22, 1, 2],
    ["SCNCPODBUILD0", "DROP.FIN", "66e8da41ff0a47229c1a33db4aae9e7f37307ec943f5bbd860acc832b07fc433", 94, 42, 2],
    ["DROPSTAND0", "DROP.FIN", "66e8da41ff0a47229c1a33db4aae9e7f37307ec943f5bbd860acc832b07fc433", 72, 10, 2],
  ],
  [
    ["MINDHIVSTAND0", "ALBU.FIN", "99c3d4e4fa0badeb2cd68361a6f1b57dcf9dfbdd027f820a68d806aa18773fa1", 3, 2, 4],
    ["MINDHIVBUILD0", "SAUC2.FIN", "33fea87c7688d98a5832e8ad01c6cf4a41ae9511e039ab94ef0eef4e7b5160ef", 0, 72, 2],
    ["SAUCSTAND0", "SAWS.FIN", "7c9b19edfd72193b537e97661884912d593ad21763659ad9133b113b8dfadf27", 475, 4, 2],
  ],
] as const;

function validateConfiguration(config: NativeConstructionConfiguration): void {
  requireHost(config.sourceSha256 === NATIVE_CONSTRUCTION_SOURCE && (config.race === 0 || config.race === 1), "source identity/race");
  requireHost(Number.isInteger(config.team) && config.team >= 0 && config.team < 8
    && Number.isInteger(config.base.x) && Number.isInteger(config.base.y)
    && config.base.x > 0 && config.base.y > 0 && config.base.x < 253 && config.base.y < 254, "team/base bounds");
  requireHost(Number.isInteger(config.map.width) && Number.isInteger(config.map.height)
    && config.map.width > 0 && config.map.width <= 256 && config.map.height > 0 && config.map.height <= 256,
  "static map bounds");
  for (const [index, profile] of [config.profiles.stand, config.profiles.build, config.profiles.auxiliary].entries()) {
    const [id, file, hash, first, count, delay] = pins[config.race][index];
    requireHost(profile.id === id && profile.source === `raw_cd/DC/ANIMATE/${file}` && profile.sha256 === hash
      && profile.first === first && profile.last === first + count - 1 && profile.directions.length === 32
      && profile.directions.every(timeline => timeline.length === count && timeline.every(value => value === delay)), "unverified FIN profile");
  }
  requireHost(config.fixedSlots.length === 15 && config.fixedSlots.every((actor, slot) => actor === null
    || (actor.nativeId === config.team * 15 + slot && (slot === 5 ? actor.unitType === 81 && actor.health === 1
      : actor.unitType === 16 + config.race * 12 + slot && (slot === 0 || slot === 1)
        && actor.health > 0 && Number.isInteger(actor.health)))), "fixed 15-slot ownership");
  requireHost(config.fixedSlots[0] && config.fixedSlots[1] && config.fixedSlots.every((actor, slot) => slot < 2 || slot === 5 || actor === null),
    "requires initialized Exo/base and empty remaining fixed slots");
  const cells = [[1, 0], [2, 0], [1, 1], [2, 1]];
  requireHost(config.footprint.length === 4 && config.footprint.every((cell, index) =>
    cell.x === config.base.x + cells[index][0] && cell.y === config.base.y + cells[index][1]
    && cell.x < config.map.width && cell.y < config.map.height && cell.occupant === 1023),
  "requires original static slot-3 footprint with clear in-bounds occupancy");
}

export function createNativeConstructionHost(configuration: NativeConstructionConfiguration): NativeConstructionHost {
  validateConfiguration(configuration);
  const config = structuredClone(configuration);
  return { kind: "native-construction-host-v1", configuration: config, receiptId: null, visits: 0,
    busy: 0, latch: 0, ready: false, reservedAuxiliary: null, footprint: structuredClone(config.footprint),
    actors: Array(15).fill(null) };
}

export function receiveNativeConstruction(previous: NativeConstructionHost, receiptId: string): NativeConstructionHost {
  restoreNativeConstructionHost(previous, previous.configuration);
  requireHost(receiptId.length > 0 && !previous.receiptId && !previous.actors[3] && !previous.actors[6]
    && !previous.busy && !previous.latch, "occupied building/auxiliary or active construction");
  return initializeReceipt(previous, receiptId);
}

function initializeReceipt(previous: NativeConstructionHost, receiptId: string): NativeConstructionHost {
  const config = previous.configuration, nativeId = config.team * 15 + 3;
  const actors = structuredClone(previous.actors) as (NativeConstructionActor | null)[];
  actors[3] = { nativeId, unitType: config.race === 0 ? 20 : 32, team: config.team, health: 2400,
    status: 1, registered: true, position: { x: config.base.x * 256 + 512, y: config.base.y * 256 + 80, height: 0 },
    task: 19, phase: 0, movementCounter: null, departing: false,
    animation: { profile: config.profiles.stand.id, frame: 0, delay: 0, mode: 2 } };
  return { ...structuredClone(previous), receiptId, actors, busy: 1, reservedAuxiliary: config.team * 15 + 6,
    footprint: previous.footprint.map(cell => ({ ...cell, occupant: nativeId })) };
}

function advance(previous: NativeConstructionHost): NativeConstructionHost {
  const next = structuredClone(previous);
  const actors = next.actors as (NativeConstructionActor | null)[];
  const main = actors[3]!, config = next.configuration;
  let busy = next.busy, latch = next.latch, ready = next.ready;
  const spawn = (departing: boolean) => {
    actors[6] = { nativeId: config.team * 15 + 6, unitType: 92 + config.race, team: 8, health: 800,
      status: 1, registered: true, position: { x: main.position.x, y: config.base.y * 256 + 256,
        height: 900 + config.race * 512 }, task: 22, phase: null, movementCounter: departing ? 0 : 50,
      departing, animation: { profile: config.profiles.auxiliary.id, frame: 0, delay: 0, mode: 0 } };
  };
  main.animation = advanceLegacyResourceAnimation(main.animation,
    main.animation.profile === config.profiles.build.id ? config.profiles.build : config.profiles.stand, 0);
  if (main.phase === 0) {
    requireHost(latch === 0, "unowned latch holder");
    latch = 1;
    main.phase = 1;
    main.animation = resetLegacyResourceAnimation(main.animation, config.profiles.build.id, 2);
    spawn(false);
  } else if (main.phase === 2 && main.animation.mode === 2) {
    busy = 0;
    main.phase = 3;
    main.animation = resetLegacyResourceAnimation(main.animation, config.profiles.stand.id, 0);
    spawn(true);
  } else if (main.phase === 4) {
    latch = 0;
    main.task = 1;
    main.phase = null;
    ready = true;
  }
  const auxiliary = actors[6];
  if (auxiliary?.registered) {
    auxiliary.animation = advanceLegacyResourceAnimation(auxiliary.animation, config.profiles.auxiliary, 0);
    if (auxiliary.task === 22) {
      const counter = auxiliary.movementCounter!;
      if (!auxiliary.departing && counter === 0) {
        auxiliary.task = 20;
        auxiliary.phase = 0;
        auxiliary.movementCounter = null;
      } else {
        auxiliary.position.height = 900 + config.race * 512 + 3 * counter * counter;
        auxiliary.movementCounter = counter + (auxiliary.departing ? 1 : -1);
        if (auxiliary.departing && auxiliary.movementCounter === 50) {
          auxiliary.task = 20;
          auxiliary.phase = 0;
          auxiliary.movementCounter = null;
        }
      }
    } else {
      requireHost(auxiliary.task === 20, "unowned auxiliary task");
      if (!auxiliary.departing) {
        auxiliary.phase = 1;
        main.phase = 2;
        main.animation = resetLegacyResourceAnimation(main.animation, config.profiles.build.id, 1);
      } else main.phase = 4;
      auxiliary.registered = false;
      auxiliary.animation = resetLegacyResourceAnimation(auxiliary.animation, config.profiles.auxiliary.id, 2);
    }
  }
  return { ...next, actors, busy, latch, ready, visits: next.visits + 1,
    reservedAuxiliary: ready ? null : next.reservedAuxiliary };
}

export interface NativeConstructionVisit {
  readonly sequence: number;
  readonly counter: number;
  readonly mainHealth: number;
  readonly auxiliaryHealth: number;
  readonly registeredSlots: readonly number[];
}

export function nativeConstructionRegisteredSlots(host: NativeConstructionHost): readonly number[] {
  return host.actors.flatMap((actor, slot) => {
    const fixed = host.configuration.fixedSlots[slot];
    return fixed ? [fixed.nativeId] : actor?.registered ? [actor.nativeId] : [];
  });
}

export function nativeConstructionRaw(host: NativeConstructionHost, slot: 3 | 6): Uint8Array {
  const raw = new Uint8Array(220), bytes = new DataView(raw.buffer), actor = host.actors[slot];
  if (!actor) return raw;
  const auxiliary = slot === 6, config = host.configuration;
  const stand = actor.unitType * 280 + 0x90;
  const bank = actor.animation.profile === config.profiles.build.id ? actor.unitType * 280 + 0x98 : stand;
  bytes.setUint16(0, actor.position.x, true);
  bytes.setUint16(2, actor.position.height, true);
  bytes.setUint16(4, actor.position.y, true);
  raw[6] = actor.unitType; raw[7] = actor.team;
  bytes.setUint32(8, auxiliary ? 0x40d800 : 0, true);
  bytes.setUint32(12, actor.health, true);
  for (const offset of [0x14, 0x1c, 0x24]) {
    bytes.setUint32(offset, offset === 0x14 ? bank : stand, true);
    raw[offset + 6] = 2;
  }
  raw[0x18] = actor.animation.frame; raw[0x19] = actor.animation.delay; raw[0x1a] = actor.animation.mode;
  raw[0x2c] = actor.status; raw[0x35] = 255;
  raw[0x38] = auxiliary ? (actor.task === 22 ? 2 : 1) : (actor.task === 1 ? 0 : 1);
  raw[0x39] = 1; raw[0x3b] = auxiliary ? 20 : 19; raw[0x3c] = 3;
  raw[0x3d] = auxiliary ? 22 : 0; raw[0x3e] = auxiliary ? 8 : 4;
  bytes.setUint16(0x46, 65535, true);
  bytes.setUint32(0x48, auxiliary ? (actor.departing ? 800 : 0) : 2400, true);
  if (auxiliary) {
    raw[0x40] = 14;
    bytes.setUint16(0x4c, config.team * 15 + 3, true);
    bytes.setUint16(0x4e, actor.phase ?? 0, true);
    bytes.setUint16(0x50, actor.position.x, true);
    bytes.setUint16(0x52, actor.position.y, true);
    bytes.setUint16(0x54, 65535, true);
    bytes.setUint16(0x58, 6, true);
    bytes.setUint16(0x5a, 900 + config.race * 512, true);
    bytes.setUint16(0x5c, Number(actor.departing), true);
    bytes.setUint16(0x5e, actor.movementCounter ?? (actor.departing ? 50 : 0), true);
    bytes.setUint16(0x60, 65535, true);
    raw[0xd1] = 255;
    bytes.setInt16(0xd2, -2, true); bytes.setInt16(0xd4, -2, true);
  } else bytes.setUint16(0x4c, actor.phase ?? 4, true);
  return raw;
}

export function visitNativeConstruction(previous: NativeConstructionHost, visit: NativeConstructionVisit): NativeConstructionHost {
  restoreNativeConstructionHost(previous, previous.configuration);
  requireHost(previous.receiptId && !previous.ready && visit.sequence === previous.visits
    && Number.isInteger(visit.counter) && visit.counter > 3 && visit.counter <= 0xffffffff, "stale visit or unsupported initialization counter");
  requireHost(visit.mainHealth === 2400 && visit.auxiliaryHealth === (previous.actors[6]?.health ?? 0),
    "external damage/death owner unsupported; reject before mutation");
  const registered = nativeConstructionRegisteredSlots(previous);
  requireHost(JSON.stringify(visit.registeredSlots) === JSON.stringify(registered), "registered fixed-slot order mismatch");
  return advance(previous);
}

export function restoreNativeConstructionHost(value: NativeConstructionHost,
  expected: NativeConstructionConfiguration): NativeConstructionHost {
  requireHost(JSON.stringify(value.configuration) === JSON.stringify(expected), "checkpoint source configuration mismatch");
  let replay = createNativeConstructionHost(expected);
  requireHost(Number.isSafeInteger(value.visits) && value.visits >= 0 && value.visits <= (expected.race === 0 ? 186 : 246), "checkpoint visit bounds");
  if (value.receiptId !== null) {
    requireHost(typeof value.receiptId === "string" && value.receiptId.length > 0, "checkpoint receipt identity");
    replay = initializeReceipt(replay, value.receiptId);
    for (let index = 0; index < value.visits; index++) replay = advance(replay);
  }
  requireHost(JSON.stringify(value) === JSON.stringify(replay), "checkpoint actor/registry/FIN/footprint replay mismatch");
  return replay;
}