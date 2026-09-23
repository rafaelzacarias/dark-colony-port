import type { LegacyAiRegisteredWorld } from "./legacy-ai-task";
import type { NativeAiTaskConfiguration, TransportHostState, HostSlot } from "./transport-host";
import type { CampaignWorld } from "./campaign-world";
import { parseScenario, type ScenarioDefinition } from "../../tools/extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../../tools/extractors/data/tables";
import { sourceScenarioUpgradeLevels } from "./legacy-scenario-levels";
import { projectLegacyColony } from "./legacy-colony";
import { createLegacyInfantryFamilyMask } from "./legacy-navigation";
import { finSourceDuration, type FinAnimationData } from "../render/fin-animation";
import { composeSourceNativeCombatProof, isAuthenticatedSourceNativeCombatProof, type SourceNativeCombatProof } from "./source-native-combat-options";

const EXECUTABLE = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b";
const GAMESTAT = "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629";
const WEAPSTAT = "391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0";
const FIN: Readonly<Record<string, string>> = {
  TRSC: "6417e52fbd04403061059d64e6f12998bc43f3d19402fe7c513068dbb79596d6",
  GRAY: "ecd8a279876b883519eecf7c7e7e6d2a37e1d39cad72bb526f66d8b08abacc05",
  REAP: "f50a1ed25500378190ee387de70a47e38a1ccd8d7c96377957da253ccf862808",
  BARR: "f3164ffe7fe3b7331bb78c9db068c0a6432911a8b2b4e146c81c968f9eb861b0",
};
const MISSIONS: Readonly<Record<string, readonly string[]>> = {
  HUMAN01: ["af82c538181ca182481562dfa75ff1f39038a58445b019cd6a52426b33e968e7", "09d712271c8deca56521a82988e75e44caa6c04dcff83e7e581bae61511f09f9", "8d88fb9419b1d10448eef67e08b430409b917a2d85aee6a21e6b1b825981a55c", "681198c4ac5fba41d18e4eee5a25e8dc16a8c0f6a0eaf287706b13f7fd65f415"],
  ALIEN01: ["3a971792a6661c6595ea22a5fa071abe12d03392ab3d8ec40c212328c1298b1e", "df03f260fdf832a9c2f7b76309a18f4a54dc729dd7f06115b7a90fc9ae4ee3d0", "6d79d94cb5608eb8b96dbac7ce27f346621eb0a378a339c66e95ae14002ea07d", "94629c5e73d5bfe0beedde237f22077fafa1a0e7729609e32837264d101fb2fd"],
  HUMAN02: ["bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab", "ea7377f73ad1d02974d8b2c04d929d3805f591a12b870254a8d466b65685f3c5", "615e95f568d1c83d750f63255b12de32db470a45017f4fe5fa02ed1336f0cc49", "623c4e65f710527bc27f02f99644eb13828a3f4aaf533a1fd4f4accc8d3ba2df"],
  ALIEN02: ["d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e", "d5ab938493b41614ef12f2640b152970e5aad8668a15e4709d6db3df80c18bae", "615e95f568d1c83d750f63255b12de32db470a45017f4fe5fa02ed1336f0cc49", "1e6633ca04693915fb2187d06fa16f4a52c973c5eb6617e73afd7797a0850155"],
};
const TYPES = [0, 8, 69, 73, 2, 3];
const COLUMNS = [null, 4, 8, 12, 20, 16, 24, 28, 32, 40, 44, 64, 68, null, 100, 104, 108,
  null, 112, 116, 220, 236, 224, 240, 244, 248, 252, 256, 260, 264, 272, 276, null];
const authenticated = new Set<string>();
const immutableConfigurations = new WeakMap<NativeAiTaskConfiguration, string>();
const frozenValues = new WeakSet<object>();
const profiles = new Map<string, { source: ScenarioDefinition; templates: LegacyAiRegisteredWorld[]; health: number[] }>();
const sourceWorlds = new Map<string, { world: string; configuration: string }>();

export function sourceNativeTaskValue(value: unknown): string {
  const cached = value !== null && typeof value === "object"
    ? immutableConfigurations.get(value as NativeAiTaskConfiguration) : undefined;
  if (cached) return cached;
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}

export function isAuthenticatedSourceNativeTaskConfiguration(configuration: NativeAiTaskConfiguration): boolean {
  if (isImmutableSourceNativeTaskConfiguration(configuration)) return true;
  try { return authenticated.has(sourceNativeTaskValue(copyConfiguration(configuration))); }
  catch { return false; }
}

export function isImmutableSourceNativeTaskConfiguration(configuration: NativeAiTaskConfiguration): boolean {
  return immutableConfigurations.has(configuration);
}

export function sourceNativeTaskMatchesScenario(configuration: NativeAiTaskConfiguration, scenario: ScenarioDefinition): boolean {
  const parent = profiles.get(configuration.sourceId);
  return !!parent && isAuthenticatedSourceNativeTaskConfiguration(configuration)
    && sourceNativeTaskValue(parent.source) === sourceNativeTaskValue(scenario);
}

export function retainSourceNativeTaskConfiguration(configuration: NativeAiTaskConfiguration): NativeAiTaskConfiguration {
  if (isImmutableSourceNativeTaskConfiguration(configuration)) return configuration;
  const candidate = copyConfiguration(configuration), value = sourceNativeTaskValue(candidate);
  requireSource(authenticated.has(value), "source authentication required for authenticated immutable configuration");
  return rememberConfiguration(candidate, value);
}

export function snapshotNativeTaskConfiguration(configuration: NativeAiTaskConfiguration): NativeAiTaskConfiguration {
  return isImmutableSourceNativeTaskConfiguration(configuration) ? configuration : copyConfiguration(configuration);
}

export function copySourceNativeConfiguration<Value>(value: Value): Value {
  return copyConfiguration(value);
}

function copyConfiguration<Value>(value: Value, copies = new WeakMap<object, object>(), active = new WeakSet<object>()): Value {
  if (value === null || typeof value === "string" || typeof value === "boolean"
    || typeof value === "number" && Number.isFinite(value)) return value;
  requireSource(typeof value === "object", "configuration must contain plain data");
  const prototype = Object.getPrototypeOf(value), array = Array.isArray(value);
  requireSource(prototype === (array ? Array.prototype : Object.prototype) || !array && prototype === null,
    "configuration must contain plain records and arrays");
  requireSource(!active.has(value), "configuration must be acyclic");
  const existing = copies.get(value);
  if (existing) return existing as Value;
  const copy: Record<string, unknown> | unknown[] = array ? [] : {};
  copies.set(value, copy);
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireSource(typeof key === "string" && "value" in descriptor && (descriptor.enumerable || array && key === "length"),
      "configuration accessors and hidden properties are unsupported");
    if (array && key === "length") continue;
    requireSource(!array || /^(0|[1-9][0-9]*)$/.test(key), "configuration array properties are unsupported");
    Object.defineProperty(copy, key, { value: copyConfiguration(descriptor.value, copies, active),
      enumerable: true, configurable: true, writable: true });
  }
  requireSource(!array || Object.keys(copy).length === (value as unknown[]).length, "configuration arrays must be dense");
  active.delete(value);
  return copy as Value;
}

function rememberConfiguration(configuration: NativeAiTaskConfiguration, value: string): NativeAiTaskConfiguration {
  freeze(configuration);
  immutableConfigurations.set(configuration, value);
  return configuration;
}

function sourceWorldValue(world: CampaignWorld): string {
  return sourceNativeTaskValue({ ...world, entityBytes: world.entityBytes && [...world.entityBytes],
    typeMovementClasses: world.typeMovementClasses && [...world.typeMovementClasses],
    placementState: { ...world.placementState, renatBytes: [...world.placementState.renatBytes] } });
}

export function validateSourceNativeWorld(configuration: NativeAiTaskConfiguration, world: CampaignWorld): void {
  requireSource(isAuthenticatedSourceNativeTaskConfiguration(configuration), "source authentication required for installation");
  const attestation = sourceWorlds.get(configuration.sourceId);
  requireSource(attestation && attestation.configuration === sourceNativeTaskValue(configuration)
    && attestation.world === sourceWorldValue(world), "source world attestation mismatch");
}

export function sourceNativeCombatInitialRegistry(configuration: NativeAiTaskConfiguration): readonly number[] {
  configuration = retainSourceNativeTaskConfiguration(configuration);
  const attestation = sourceWorlds.get(configuration.sourceId);
  requireSource(attestation?.configuration === sourceNativeTaskValue(configuration), "fresh source world required for death registry");
  const world = JSON.parse(attestation!.world) as CampaignWorld;
  requireSource(world.entities.every(actor => actor.unitType !== 69 && actor.unitType !== 73),
    "source commander initialization outside bounded death profile");
  return (world.transportState as TransportHostState).registry.map((key, slot) => key === null ? -1 : slot);
}

async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)),
    value => value.toString(16).padStart(2, "0")).join("");
}

function freeze<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    if (frozenValues.has(value)) return value;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
    frozenValues.add(value);
  }
  return value;
}

export interface SourceNativeTaskAssets {
  readonly executable: Uint8Array;
  readonly gameStat: Uint8Array;
  readonly weaponStat: Uint8Array;
  readonly scenario: Uint8Array;
  readonly map: Uint8Array;
  readonly mtg: Uint8Array;
  readonly pth: Uint8Array;
  readonly animations: Readonly<Record<string, Uint8Array>>;
}

function executableWords(bytes: Uint8Array, address: number, count: number): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pe = view.getUint32(0x3c, true), sections = view.getUint16(pe + 6, true);
  const table = pe + 24 + view.getUint16(pe + 20, true);
  for (let index = 0; index < sections; index++) {
    const offset = table + index * 40, base = 0x400000 + view.getUint32(offset + 12, true);
    const size = view.getUint32(offset + 16, true);
    if (address >= base && address + count * 4 <= base + size) {
      const start = view.getUint32(offset + 20, true) + address - base;
      return Array.from({ length: count }, (_, word) => view.getInt32(start + word * 4, true));
    }
  }
  throw new Error("Source native task: executable table is unmapped");
}

function directions(metadata: FinAnimationData, name: string): number[][] {
  const candidates = Array.from({ length: 16 }, (_, index) =>
    metadata.states.find(state => state.name === `${name}${(12 - index + 16) & 15}`));
  return Array.from({ length: 32 }, (_, direction) => {
    const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
    const state = offsets.map(offset => candidates[((direction + offset + 32) & 31) >> 1]).find(Boolean);
    requireSource(state?.validRange, `missing FIN bank ${name}`);
    return metadata.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1).map(frame => finSourceDuration(frame.field2!));
  });
}

export async function createSourceNativeTaskOptions(input: {
  readonly assets: SourceNativeTaskAssets;
  readonly world: CampaignWorld;
}): Promise<NativeAiTaskConfiguration> {
  const assets = structuredClone(input.assets), world = structuredClone(input.world);
  if (world.entityBytes) Object.assign(world, { entityBytes: Uint8Array.from(world.entityBytes) });
  if (world.typeMovementClasses) Object.assign(world, { typeMovementClasses: Uint8Array.from(world.typeMovementClasses) });
  Object.assign(world.placementState, { renatBytes: Uint8Array.from(world.placementState.renatBytes) });
  for (const field of ["executable", "gameStat", "weaponStat", "scenario", "map", "mtg", "pth"] as const)
    Object.assign(assets, { [field]: Uint8Array.from(assets[field]) });
  Object.assign(assets, { animations: Object.fromEntries(Object.entries(assets.animations)
    .map(([name, bytes]) => [name, Uint8Array.from(bytes)])) });
  const actualHashes = await Promise.all([assets.executable, assets.gameStat, assets.weaponStat,
    assets.scenario, assets.map, assets.mtg, assets.pth].map(hash));
  requireSource(actualHashes[0] === EXECUTABLE && actualHashes[1] === GAMESTAT && actualHashes[2] === WEAPSTAT,
    "executable/GAMESTAT/WEAPSTAT hash mismatch");
  const mission = Object.keys(MISSIONS).find(name => MISSIONS[name].every((digest, index) => digest === actualHashes[index + 3]));
  requireSource(mission, "unverified original SCN/MAP/MTG/PTH bundle");
  const text = new TextDecoder(), source = parseScenario(text.decode(assets.scenario));
  requireSource(sourceNativeTaskValue(world.source) === sourceNativeTaskValue(source), "world differs from parsed actual SCN");
  const state = world.transportState as TransportHostState;
  requireSource(state?.kind === "transport-host-v1" && state.tick === 0 && state.remainderMilliseconds === 0
    && !state.nativeAiTasks && world.clockMilliseconds === 0 && world.entityBytes?.length === 800 * 220,
    "fresh complete transport world required");
  const map = new DataView(assets.map.buffer, assets.map.byteOffset, assets.map.byteLength);
  const width = map.getUint32(0, true), height = map.getUint32(4, true), area = width * height;
  requireSource(state.width === width && state.height === height && assets.pth.length === 65536 + area
    && assets.mtg.length === 2 + area, "map dimensions mismatch");
  const units = parseUnitStats(text.decode(assets.gameStat)), weapons = new Uint8Array(80 * 72);
  const weaponView = new DataView(weapons.buffer);
  for (const weapon of parseWeaponStats(text.decode(assets.weaponStat))) {
    for (const [index, value] of [weapon.rawPrefix, weapon.soundId, weapon.rateOfFire, weapon.damage,
      weapon.speed, weapon.range].entries()) weaponView.setInt32(weapon.id * 72 + index * 4, value, true);
  }
  const rows = text.decode(assets.gameStat).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("%")).slice(1).map(line => line.split(/\s+/));
  const metadata: Record<string, FinAnimationData> = {};
  for (const [stem, digest] of Object.entries(FIN)) {
    requireSource(assets.animations[stem] && await hash(assets.animations[stem]) === digest, `unverified ${stem} FIN metadata`);
    metadata[stem] = JSON.parse(text.decode(assets.animations[stem]));
  }
  const randomTable = executableWords(assets.executable, 0x478e04, 256);
  const ground = Array<number>(area).fill(1023), extra = Array<number>(area).fill(1023);
  const hostGround = Array<number>(area).fill(-1), hostFlying = Array<number>(area).fill(-1);
  const air = Array.from({ length: area }, (_, cell) =>
    ((assets.mtg[2 + (height - 1 - Math.floor(cell / width)) * width + cell % width] << 10) | 1023) & 65535);
  requireSource(state.slots.length === 800 && state.registry.length === 800 && state.generations.length === 800
    && state.ground.length === area && state.flying.length === area && state.groundEligible.length === area,
    "incomplete host identity or spatial tables");
  const seen = new Set<number>(), seenRows = new Set<number>(), colony = projectLegacyColony(source.teams, units);
  const sourceSlots = new Map<number, number>();
  for (const [sourceRow, row] of source.placementRows.entries()) {
    if (row[3] !== -1) sourceSlots.set(sourceRow, 152 + sourceSlots.size);
  }
  requireSource(world.placementState.firstSlot === 152 && world.placementState.nextSlot === 152 + sourceSlots.size
    && world.placementState.highWater === 152 + sourceSlots.size && state.highWater === 152 + sourceSlots.size,
    "native SCN slot allocation counters mismatch");
  const renatSources = source.placementRows.flatMap((row, sourceRow) => row[3] === -1
    ? [{ sourceRow, tileX: row[0], tileY: row[1], unitType: row[2], count: row[4] }] : []);
  const renatBytes = new Uint8Array(25 * 40), renatView = new DataView(renatBytes.buffer);
  for (const [index, entry] of renatSources.entries()) {
    for (const [field, value] of [entry.tileX, entry.tileY, entry.unitType, entry.count].entries()) {
      renatView.setInt32(index * 40 + 4 + field * 4, value, true);
    }
  }
  requireSource(sourceNativeTaskValue(world.placementState.renatSources) === sourceNativeTaskValue(renatSources)
    && world.placementState.renatBytes.length === renatBytes.length
    && world.placementState.renatBytes.every((value, index) => value === renatBytes[index]), "native SCN RENAT mapping mismatch");
  requireSource(sourceNativeTaskValue(world.buildingSlots) === sourceNativeTaskValue(colony.buildingSlots),
    "reserved city mapping mismatch");
  const eligible = Array.from(createLegacyInfantryFamilyMask({ width, height, pathGrid: assets.pth.slice(65536) }), Boolean);
  for (const building of colony.buildings) for (const point of building.footprint) eligible[point.y * width + point.x] = false;
  requireSource(state.groundEligible.every((value, cell) => value === eligible[cell]), "source path eligibility mismatch");
  requireSource(sourceNativeTaskValue(state.sides) === sourceNativeTaskValue(source.teams.map(team => team.race)), "source team race mismatch");
  for (const unit of units.filter(unit => unit.rawTail[2] <= 1)) {
    const definition = state.definitions.find(definition => definition.unitType === unit.index);
    requireSource(definition?.health === unit.health && definition.movementSpeed === unit.movementSpeed
      && definition.plane === (unit.rawTail[2] === 0 ? "ground" : "flying"), "host definition differs from GAMESTAT");
  }
  for (const entity of world.entities) {
    const slot = entity.rawSlot, actor = slot === null ? null : state.slots[slot];
    requireSource(slot !== null && !seen.has(slot) && actor && actor.key === entity.key && actor.generation === entity.generation
      && state.generations[slot] === actor.generation && state.registry[slot] === actor.key && actor.slot === slot
      && actor.status === 1 && actor.unitType === entity.unitType && actor.team === entity.team
      && actor.health === entity.health && Number.isSafeInteger(actor.generation) && actor.generation >= 0,
      "unproved actor identity/allocation");
    seen.add(slot);
    const raw = new DataView(world.entityBytes!.buffer, world.entityBytes!.byteOffset + slot * 220, 220);
    requireSource(raw.getUint16(0, true) === actor.position.x && raw.getUint16(4, true) === actor.position.y
      && raw.getUint16(2, true) === actor.height && actor.height === 0
      && raw.getInt32(12, true) === actor.health && raw.getUint8(6) === actor.unitType
      && raw.getUint8(7) === actor.team && raw.getUint8(0x2c) === 1, "raw/host actor disagreement");
    if (entity.sourceRow === null) {
      const building = colony.buildings.find(building => building.nativeId === slot);
      requireSource(building && entity.key === `colony:${slot}` && entity.maxHealth === building.maxHealth
        && entity.rawTail.length === 0 && actor.unitType === building.unitType && actor.team === building.team
        && actor.health === building.health && actor.position.x === building.nativePosition.x
        && actor.position.y === building.nativePosition.y && entity.tileX === Math.floor(building.position.x)
        && entity.tileY === Math.floor(building.position.y), "unproved reserved city actor");
      for (const point of building.footprint) {
        const cell = point.y * width + point.x;
        requireSource(ground[cell] === 1023 && !state.groundEligible[cell], "city footprint mismatch");
        ground[cell] = slot;
      }
      continue;
    }
    requireSource(Number.isInteger(entity.sourceRow) && !seenRows.has(entity.sourceRow), "duplicate SCN actor identity");
    seenRows.add(entity.sourceRow);
    requireSource(sourceSlots.get(entity.sourceRow) === slot && entity.key === `placement:${entity.sourceRow}`,
      "actor differs from native SCN slot allocation");
    const row = source.placementRows[entity.sourceRow], stat = units[row?.[2]], team = source.teams[row?.[3]];
    const actualType = team && team.race !== stat?.faction && stat?.rawTail[20] !== -1 ? stat?.rawTail[20] : stat?.index;
    requireSource(row && row[3] !== -1 && actualType !== 37 && actualType === actor.unitType
      && actor.team === (actualType === 40 ? 8 : row[3]) && actor.position.x === row[0] * 256 + 128
      && actor.position.y === row[1] * 256 + 128 && entity.tileX === row[0] && entity.tileY === row[1]
      && entity.maxHealth === units[actualType].health
      && sourceNativeTaskValue(entity.rawTail) === sourceNativeTaskValue(row.slice(4))
      && raw.getUint8(0xcb) === (actualType === 40 ? 0 : (row[5] ?? 0) & 255),
      "actor differs from native SCN placement");
    if (actor.unitType === 40) continue;
    const definition = state.definitions.find(entry => entry.unitType === actor.unitType), unit = units[actor.unitType];
    requireSource(definition?.health === unit.health && definition.movementSpeed === unit.movementSpeed,
      "host definition differs from GAMESTAT");
    const cell = row[1] * width + row[0];
    requireSource(row[0] >= 0 && row[0] < width && row[1] >= 0 && row[1] < height, "actor outside source map");
    if (unit.movementSpeed > 0) (definition.plane === "flying" ? hostFlying : hostGround)[cell] = slot;
    const plane = definition.plane === "flying" ? air : ground;
    requireSource((plane[cell] & 1023) === 1023, "overlapping source actor");
    plane[cell] = ((plane[cell] & ~1023) | slot) >>> 0;
  }
  requireSource(state.slots.every((actor, slot) => actor ? seen.has(slot) : state.registry[slot] === null), "unregistered host actor");
  requireSource(source.placementRows.filter(row => row[3] !== -1).length + colony.buildings.length === seen.size, "incomplete source actors");
  for (let slot = 0; slot < 800; slot++) requireSource(world.entityBytes![slot * 220 + 0x2c] === 0 || seen.has(slot), "unregistered raw actor");
  requireSource(state.ground.every((value, cell) => value === hostGround[cell])
    && state.flying.every((value, cell) => value === hostFlying[cell]), "source host occupancy mismatch");
  const templates: LegacyAiRegisteredWorld[] = [];
  for (const typeId of TYPES) {
    const unit = units[typeId], typeBytes = new Uint8Array(280), view = new DataView(typeBytes.buffer);
    COLUMNS.forEach((offset, token) => { if (offset !== null) view.setInt32(offset, Number(rows[typeId][token]), true); });
    typeBytes[0x60] = Number(rows[typeId][13]);
    const stand = typeId * 2 + 1, move = stand + 1;
    view.setUint32(0x80, stand, true);
    view.setUint32(0x7c, move, true);
    for (const team of source.teams) {
      const levels = sourceScenarioUpgradeLevels(team, typeId);
      typeBytes[0x30 + team.index] = levels.weaponLevel;
      typeBytes[0x38 + team.index] = levels.armorLevel;
    }
    const fin = { [stand]: directions(metadata[unit.sprite], `${unit.sprite}STAND`),
      [move]: directions(metadata[unit.sprite], `${unit.sprite}MOVE`) };
    for (const team of source.teams) templates.push({ typeId, width, height, typeBytes: [...typeBytes],
      families: [...assets.pth.slice(65536)], pthSha256: actualHashes[6], ground, air, extra,
      enemyMask: 0x40000000 >>> team.index, teamControl: team.ai, weapons: [...weapons], randomTable, fin });
  }
  const expectedWorld = sourceWorldValue(world);
  const sourceWorldDigest = await hash(new TextEncoder().encode(expectedWorld));
  const sourceId = `nativeactor-source-v2:${await hash(new TextEncoder().encode(sourceNativeTaskValue({
    actualHashes, fin: FIN, columns: COLUMNS, templates, sourceWorldDigest,
    constructor: "41af14/412014/42630c:stand-move-field-identity-v1" })))}`;
  const bindings = state.slots.flatMap(actor => {
    if (!actor || actor.slot < 152 || !TYPES.includes(actor.unitType)) return [];
    const profile = TYPES.indexOf(actor.unitType) * 8 + actor.team;
    const expectedRaw = [...world.entityBytes!.slice(actor.slot * 220, (actor.slot + 1) * 220)];
    return [{ slot: actor.slot, generation: actor.generation, key: actor.key, profile, expectedRaw,
      raw: constructSourceNativeTaskActor(expectedRaw, templates[profile]) }];
  });
  requireSource(bindings.length > 0, "no supported source mobile actors");
  const configuration: NativeAiTaskConfiguration = { scope: "source-separated-bounded", sourceId,
    profiles: templates, bindings, counter: 0, rngCursor: 0, task6Budget: 0 };
  profiles.set(sourceId, freeze({ source, templates, health: units.map(unit => unit.health) }));
  const configurationValue = sourceNativeTaskValue(configuration);
  sourceWorlds.set(sourceId, { world: expectedWorld, configuration: configurationValue });
  authenticated.add(configurationValue);
  return rememberConfiguration(configuration, configurationValue);
}

export function extendSourceNativeTaskConfiguration(configuration: NativeAiTaskConfiguration, actor: HostSlot): NativeAiTaskConfiguration {
  configuration = retainSourceNativeTaskConfiguration(configuration);
  const profile = profiles.get(configuration.sourceId);
  requireSource(profile && TYPES.includes(actor.unitType) && actor.team >= 0 && actor.team < 8
    && Number.isInteger(actor.slot) && actor.slot >= 152 && actor.slot < 800
    && Number.isSafeInteger(actor.generation) && actor.generation >= 0 && actor.key.length > 0 && actor.status === 1
    && actor.health === profile.health[actor.unitType], "unowned dynamic constructor");
  const profileIndex = TYPES.indexOf(actor.unitType) * 8 + actor.team;
  const primitive = new Uint8Array(220), view = new DataView(primitive.buffer);
  view.setUint16(0, actor.position.x, true); view.setUint16(4, actor.position.y, true);
  view.setInt32(12, actor.health, true); primitive[6] = actor.unitType; primitive[7] = actor.team; primitive[0x2c] = 1;
  primitive[0x38] = 255; view.setInt16(0xd2, -2, true); view.setInt16(0xd4, -2, true);
  const raw = constructSourceNativeTaskActor([...primitive], profile.templates[profileIndex]);
  const next = { ...configuration, bindings: [...configuration.bindings.filter(binding => binding.slot !== actor.slot),
    { slot: actor.slot, generation: actor.generation, key: actor.key, profile: profileIndex, expectedRaw: [...primitive], raw }] };
  const value = sourceNativeTaskValue(next);
  authenticated.add(value);
  return rememberConfiguration(next, value);
}

export async function withSourceNativeCombatTasks(configuration: NativeAiTaskConfiguration,
  proof: SourceNativeCombatProof): Promise<NativeAiTaskConfiguration> {
  configuration = retainSourceNativeTaskConfiguration(configuration);
  requireSource(isAuthenticatedSourceNativeCombatProof(proof),
    "authenticated task and combat sources required");
  const parent = profiles.get(configuration.sourceId), attestation = sourceWorlds.get(configuration.sourceId);
  requireSource(parent && attestation && attestation.configuration === sourceNativeTaskValue(configuration),
    "fresh source world required for combat configuration");
  requireSource(sourceNativeTaskValue(parent.source) === sourceNativeTaskValue(proof.scenario),
    "combat proof and task world must retain the same complete SCN");
  const templates = configuration.profiles.map((profile, index) => {
    if (profile.typeId !== proof.sourceType) return profile;
    const fragment = composeSourceNativeCombatProof({ configuration, proof, team: index % 8 });
    const weapons = [...profile.weapons];
    weapons.splice(proof.weapon * 72, 72, ...proof.weaponBytes);
    return { ...profile, typeBytes: fragment.typeBytes, weapons, fin: proof.fin,
      nativeFire: { spread: proof.ordinaryBoom, frames: proof.fireFrames } };
  });
  const sourceId = `nativeactor-source-v2:${await hash(new TextEncoder().encode(sourceNativeTaskValue({
    parent: configuration.sourceId, templates, scope: `type${proof.sourceType}-weapon${proof.weapon}-nonlethal-v1` })))}`;
  const next = freeze({ ...configuration, sourceId, profiles: templates });
  profiles.set(sourceId, freeze({ ...parent, templates }));
  const value = sourceNativeTaskValue(next);
  sourceWorlds.set(sourceId, { world: attestation.world, configuration: value });
  authenticated.add(value);
  return rememberConfiguration(next, value);
}

function requireSource(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Source native task: ${message}`);
}

export function constructSourceNativeTaskActor(raw: readonly number[], profile: LegacyAiRegisteredWorld): number[] {
  requireSource(raw.length === 220 && raw.every(value => Number.isInteger(value) && value >= 0 && value <= 255),
    "invalid actor bytes");
  requireSource(profile.typeBytes.length === 280 && profile.typeId === raw[6] && raw[7] < 8 && raw[0x2c] === 1,
    "constructor identity mismatch");
  const source = new DataView(Uint8Array.from(profile.typeBytes).buffer);
  const before = new DataView(Uint8Array.from(raw).buffer);
  requireSource(profile.typeBytes[0x60] === 0 && source.getInt32(12, true) > 0 && before.getUint16(2, true) === 0,
    "unowned constructor movement class");
  requireSource(before.getUint16(0, true) < profile.width * 256 && before.getUint16(4, true) < profile.height * 256
    && before.getInt32(12, true) > 0 && before.getInt32(12, true) <= 32767, "constructor pose or health outside envelope");
  const bytes = new Uint8Array(220), view = new DataView(bytes.buffer);
  for (const offset of [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 0x2c, 0xcb]) bytes[offset] = raw[offset];
  bytes[8] = 8;
  bytes[9] = source.getInt32(0xe0, true) & 255;
  bytes[0xa] = 64;
  const stand = source.getUint32(0x80, true);
  requireSource(stand !== 0 && profile.fin[stand]?.length === 32, "missing source stand bank");
  for (const offset of [0x14, 0x1c, 0x24]) view.setUint32(offset, stand, true);
  bytes[0x22] = bytes[0x2a] = 2;
  bytes[0x35] = bytes[0xd1] = 255;
  bytes[0x39] = 1;
  bytes[0x3c] = 3;
  view.setUint16(0x46, 65535, true);
  bytes[0xcd] = before.getUint16(0, true) >>> 8;
  bytes[0xce] = before.getUint16(4, true) >>> 8;
  view.setInt16(0xd2, -2, true);
  view.setInt16(0xd4, -2, true);
  return [...bytes];
}