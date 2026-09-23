import { parseDamageMatrix, parseUnitStats, parseWeaponStats } from "../../tools/extractors/data/tables";
import { parseFin, type FinAnimation, type FinTimelineEntry } from "../../tools/extractors/animations/fin";
import { parseSprite } from "../../tools/extractors/sprites/spr";
import { parseScenario, type ScenarioDefinition } from "../../tools/extractors/data/scenario";
import { finSourceDuration } from "../render/fin-animation";
import { sourceScenarioUpgradeLevels } from "./legacy-scenario-levels";
import { isAuthenticatedSourceNativeTaskConfiguration, sourceNativeTaskMatchesScenario } from "./source-native-task-options";
import type { NativeAiTaskConfiguration } from "./transport-host";
import type { LegacyNativeFireTables } from "./legacy-native-fire";
import { createCueCatalog } from "../audio/cues";
import { validLegacyNativeDeathSound, type LegacyNativeDeathSound, type LegacyNativeDeathSoundState } from "./legacy-native-death";
import { copySourceNativeConfiguration } from "./source-native-task-options";

export interface SourceNativeCombatSoundProof {
  readonly policy: "explicit-caller-boundary";
  readonly configuration: LegacyNativeDeathSound["configuration"];
  readonly initial: LegacyNativeDeathSoundState;
}

const authenticatedSound = new WeakSet<object>();

export function isAuthenticatedSourceNativeCombatSoundProof(value: unknown): value is SourceNativeCombatSoundProof {
  return !!value && typeof value === "object" && authenticatedSound.has(value);
}

export async function createSourceNativeCombatSoundProof(assets: {
  executable: Uint8Array; soundTable: Uint8Array; bindings: Uint8Array;
}, boundary: Omit<LegacyNativeDeathSound, "configuration"> & { policy: "explicit-caller-boundary" }): Promise<SourceNativeCombatSoundProof> {
  const source = { executable: Uint8Array.from(assets.executable), soundTable: Uint8Array.from(assets.soundTable),
    bindings: Uint8Array.from(assets.bindings) };
  const caller = copySourceNativeConfiguration(boundary);
  requireSource(caller.policy === "explicit-caller-boundary", "explicit current audio boundary required; mission startup is unproved");
  const executableSha256 = await hash(source.executable), soundTableSha256 = await hash(source.soundTable), bindingsSha256 = await hash(source.bindings);
  requireSource(executableSha256 === SOURCE_HASHES.executable
    && soundTableSha256 === "03b820482ca43f79dda0db4702c1db5dae333b0ca423bd8dd211607a60fe5922"
    && bindingsSha256 === "8edca1e2e26e741a8d73a4e7987d51569d62a75d90038e59e19b155d240ec0cc", "death sound source hash mismatch");
  const catalog = createCueCatalog(new TextDecoder().decode(source.soundTable), new TextDecoder().decode(source.bindings));
  const binding = catalog.bindings.find(row => row.id === 0 && row.group === "DEA");
  requireSource(binding && JSON.stringify(binding.soundIds) === "[28,90,153,154]", "source DEA binding required");
  const configuration: LegacyNativeDeathSound["configuration"] = { executableSha256, soundTableSha256, bindingsSha256,
    categoryCount: 106, sounds: binding.soundIds.map(id => catalog.sounds.find(row => row.id === id)!) };
  requireSource(validLegacyNativeDeathSound({ ...caller, configuration }), "valid explicit current audio state required");
  const proof: SourceNativeCombatSoundProof = freeze({ policy: caller.policy, configuration, initial: caller.state });
  authenticatedSound.add(proof);
  return proof;
}

const SOURCE_HASHES = {
  executable: "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
  gameStat: "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629",
  weaponStat: "391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0",
  boomStat: "b80addf8e43bacc66c0ab63f4852f0ef13341f3a914d7305743557968baac33a",
  damageMatrix: "2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22",
  scenario: "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab",
  troopFin: "eb94f6f3fff53b9f46f1540abf5287c11f83a7db7957d6288b2330b13e1f3b2a",
  troopSprite: "51092690d9700cecdcac5e7c53b7cffbd09cedcc582b509a9e16adc9f740d117",
  animationRegistry: "20e9cf988ed833236ca0687601ab32a2adeaae0d885b39a7507321166bdba3d0",
} as const;

const REGISTRY_FIN_HASH = "a493030cf9233546fed0d2d1dcd6e25dec50394961d3fea656cdb0c5aec9c433";

export const SOURCE_NATIVE_COMBAT_BANK_FIELDS = Object.freeze([
  Object.freeze({ offset: 0x80, id: 1, name: "TRSCSTAND" }),
  Object.freeze({ offset: 0x7c, id: 2, name: "TRSCMOVE" }),
  Object.freeze({ offset: 0xa0, id: 0x100a0, name: "TRSCFIREA" }),
  Object.freeze({ offset: 0xa4, id: 0x100a4, name: "TRSCFIREB" }),
]);

export const SOURCE_NATIVE_COMBAT_REACTION_FIELDS = Object.freeze(Array.from({ length: 7 }, (_, index) =>
  Object.freeze({ offset: 0xbc + index * 4, id: 0x100bc + index * 4, name: `TRSCBLOOD${String.fromCharCode(65 + index)}` })));

export const SOURCE_NATIVE_COMBAT_DEATH_FIELDS = Object.freeze(Array.from({ length: 3 }, (_, index) =>
  Object.freeze({ offset: 0xac + index * 4, id: 0x100ac + index * 4, name: `TRSCDIE${String.fromCharCode(65 + index)}` })));

const ALIEN_HASHES = Object.freeze({ ...SOURCE_HASHES,
  scenario: "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e",
  troopFin: "077887b708009109740a518bf8cff9c547a21145617dbf5dde575342fe5a641a",
  troopSprite: "95e71a6b19ecca1b77a9cba3b69b68f7b07b8fb927f99bcafdeba33030ebd620",
});

interface SourceCombatBankField { readonly offset: number; readonly id: number; readonly name: string }

const SOURCE_PROFILES = freeze([
  { sourceType: 0 as const, weapon: 1 as const, sprite: "TRSC", hashes: SOURCE_HASHES,
    scanPointCount: 809, scanRingCount: 16,
    bankFields: SOURCE_NATIVE_COMBAT_BANK_FIELDS, reactionFields: SOURCE_NATIVE_COMBAT_REACTION_FIELDS,
    deathFields: SOURCE_NATIVE_COMBAT_DEATH_FIELDS },
  { sourceType: 8 as const, weapon: 15 as const, sprite: "GRAY", hashes: ALIEN_HASHES,
    scanPointCount: 814, scanRingCount: 17,
    bankFields: SOURCE_NATIVE_COMBAT_BANK_FIELDS.map(field => ({ ...field,
      id: field.id <= 2 ? field.id + 16 : field.id, name: field.name.replace("TRSC", "GRAY") })),
    reactionFields: [..."ABCDEG"].map((letter, index) =>
      ({ offset: 0xbc + index * 4, id: 0x100bc + index * 4, name: `GRAYBLOOD${letter}` })),
    deathFields: [] },
]);

export function sourceNativeCombatBankFields(sourceType: 0 | 8): readonly SourceCombatBankField[] {
  const profile = SOURCE_PROFILES.find(profile => profile.sourceType === sourceType);
  if (!profile) throw new TypeError("Unsupported source combat FIN type");
  return [...profile.bankFields, ...profile.reactionFields, ...profile.deathFields];
}

export interface SourceNativeCombatAssets {
  readonly executable: Uint8Array;
  readonly gameStat: Uint8Array;
  readonly weaponStat: Uint8Array;
  readonly boomStat: Uint8Array;
  readonly damageMatrix: Uint8Array;
  readonly scenario: Uint8Array;
  readonly troopFin: Uint8Array;
  readonly troopSprite: Uint8Array;
  readonly animationRegistry: Uint8Array;
  readonly registryFins: Readonly<Record<string, Uint8Array>>;
}

interface SourceFinLocation {
  readonly file: string;
  readonly first: number;
  readonly last: number;
}

export interface SourceNativeCombatProof {
  readonly kind: "source-native-combat-proof-v1";
  readonly sourceType: 0 | 8;
  readonly weapon: 1 | 15;
  readonly localTeam: 0;
  readonly policy: 0 | 1;
  readonly runtimeReady: false;
  readonly hashes: { readonly [Field in keyof typeof SOURCE_HASHES]: string };
  readonly bankFields: readonly SourceCombatBankField[];
  readonly reactionFields: readonly SourceCombatBankField[];
  readonly deathFields: readonly SourceCombatBankField[];
  readonly scenario: ScenarioDefinition;
  readonly typeFields: Readonly<Record<number, number>>;
  readonly weaponFields: Readonly<Record<number, number>>;
  readonly weaponBytes: readonly number[];
  readonly weaponFin: {
    readonly visualPrefix: string;
    readonly registryHash: typeof REGISTRY_FIN_HASH;
    readonly registryFiles: readonly string[];
    readonly registryStateCount: number;
    readonly sourceFinMapping: Readonly<Record<string, SourceFinLocation | null>>;
    readonly travelBank: number;
    readonly impactBanks: readonly [];
    readonly impactVariantCount: 0;
  };
  readonly projectileFin: Readonly<Record<number, readonly (readonly number[])[]>>;
  readonly armorCoefficients: readonly number[];
  readonly collisionFields: Readonly<Record<number, number>>;
  readonly weaponLevels: readonly number[];
  readonly armorLevels: readonly number[];
  readonly ordinaryBoom: readonly number[];
  readonly damageTable: readonly (readonly number[])[];
  readonly randomTable: readonly number[];
  readonly scalarTypeRows: readonly (readonly number[])[];
  readonly relations: readonly number[];
  readonly scanOffsets: readonly (readonly number[])[];
  readonly fireFrames: LegacyNativeFireTables["frames"];
  readonly unboundFinEvents: readonly string[];
  readonly deathInitial: {
    readonly statistics: readonly number[];
    readonly typeStatistics: readonly number[];
    readonly commanderSlots: readonly number[];
  };
  readonly fin: Readonly<Record<number, readonly (readonly number[])[]>>;
  readonly unresolved: readonly ["complete-projectile-type-table", "host-session-admission"];
}

const authenticated = new WeakSet<object>();

function requireSource(value: unknown, diagnostic: string): asserts value {
  if (!value) throw new Error(`Source native combat: ${diagnostic}`);
}

function freeze<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function executableRandomTable(bytes: Uint8Array, address = 0x478e04, count = 256): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pe = view.getUint32(0x3c, true), sections = view.getUint16(pe + 6, true);
  const table = pe + 24 + view.getUint16(pe + 20, true);
  for (let index = 0; index < sections; index++) {
    const section = table + index * 40, base = 0x400000 + view.getUint32(section + 12, true);
    const size = view.getUint32(section + 16, true);
    if (address >= base && address + count * 4 <= base + size) {
      const start = view.getUint32(section + 20, true) + address - base;
      return Array.from({ length: count }, (_, word) => view.getInt32(start + word * 4, true));
    }
  }
  throw new Error("Source native combat: unmapped executable RNG table");
}

function executableString(bytes: Uint8Array, address: number): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pe = view.getUint32(0x3c, true), table = pe + 24 + view.getUint16(pe + 20, true);
  for (let index = 0; index < view.getUint16(pe + 6, true); index++) {
    const section = table + index * 40, base = 0x400000 + view.getUint32(section + 12, true);
    const size = view.getUint32(section + 16, true);
    if (address < base || address >= base + size) continue;
    const start = view.getUint32(section + 20, true) + address - base;
    const end = bytes.indexOf(0, start);
    requireSource(end >= start && end < start + size - (address - base), "unterminated executable FIN suffix");
    return new TextDecoder().decode(bytes.subarray(start, end));
  }
  throw new Error("Source native combat: unmapped executable FIN suffix");
}

function initialWeaponRecord(bytes: Uint8Array, address = 0x4f0200 + 72, length = 72): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pe = view.getUint32(0x3c, true), table = pe + 24 + view.getUint16(pe + 20, true);
  for (let index = 0; index < view.getUint16(pe + 6, true); index++) {
    const section = table + index * 40, base = 0x400000 + view.getUint32(section + 12, true);
    const size = Math.max(view.getUint32(section + 8, true), view.getUint32(section + 16, true));
    if (address < base || address + length > base + size) continue;
    requireSource((view.getUint32(section + 36, true) & 0x80) !== 0
      && view.getUint32(section + 20, true) === 0, "unsupported initialized weapon image section");
    return new Uint8Array(length);
  }
  throw new Error("Source native combat: unmapped initial weapon record");
}

async function weaponFinRegistry(source: SourceNativeCombatAssets, visualPrefix: string, weapon: number): Promise<SourceNativeCombatProof["weaponFin"]> {
  const files = new TextDecoder().decode(source.animationRegistry).trim().split(/\s+/).map(name => name.toUpperCase());
  requireSource(source.registryFins && typeof source.registryFins === "object", "complete registry FIN sources required");
  requireSource(Object.keys(source.registryFins).length === files.length
    && Object.keys(source.registryFins).every(name => files.includes(name)), "exact ANIM.DAT FIN source set required");
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    const bytes = source.registryFins[file];
    requireSource(bytes instanceof Uint8Array && bytes.length > 0, `missing registry FIN source ${file}`);
    chunks.push(new TextEncoder().encode(`${file}\0${bytes.length}\0`), bytes);
  }
  const packed = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) { packed.set(chunk, cursor); cursor += chunk.length; }
  requireSource(await hash(packed) === REGISTRY_FIN_HASH, "registry FIN hash mismatch");
  const states = new Map<string, SourceFinLocation>();
  const invalidStates = new Set<string>();
  for (const file of files) {
    const animation = parseFin(source.registryFins[file]);
    for (const state of animation.states) {
      if (!state.validRange) invalidStates.add(state.name.toUpperCase());
      if (state.validRange) states.set(state.name.toUpperCase(), {
        file, first: state.firstTimelineIndex, last: state.lastTimelineIndex,
      });
    }
  }
  const sourceFinMapping: Record<string, SourceFinLocation | null> = {};
  for (const address of [0x47667c, 0x47668c, 0x4766a0]) {
    const name = (visualPrefix + executableString(source.executable, address)).toUpperCase();
    requireSource(!invalidStates.has(name), `unsupported weapon FIN range ${name}`);
    const location = states.get(name) ?? null;
    sourceFinMapping[name] = location;
    requireSource(location === null || weapon === 15 && name === "GRAYBULLET0"
      && location.file === "GRAY.FIN", `unsupported present weapon FIN ${name}`);
  }
  requireSource(weapon !== 15 || sourceFinMapping.GRAYBULLET0 !== null, "source weapon15 travel FIN required");
  return { visualPrefix, registryHash: REGISTRY_FIN_HASH, registryFiles: files,
    registryStateCount: states.size, sourceFinMapping, travelBank: weapon === 15 ? 0x2000f : 0,
    impactBanks: [], impactVariantCount: 0 };
}

function directionFrames(animation: FinAnimation, name: string): FinTimelineEntry[][] {
  const candidates = Array.from({ length: 16 }, (_, index) =>
    animation.states.find(state => state.name.toUpperCase() === `${name}${(12 - index + 16) & 15}`));
  const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
  return Array.from({ length: 32 }, (_, direction) => {
    const state = offsets.map(offset => candidates[((direction + offset + 32) & 31) >> 1]).find(Boolean);
    requireSource(state?.validRange, `missing FIN bank ${name}`);
    return animation.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1);
  });
}

function rawCombatFrame(frame: FinTimelineEntry, effectNames: ReadonlySet<string>): number[] {
  const bytes = new Uint8Array(72), view = new DataView(bytes.buffer);
  view.setUint16(0, frame.children.length, true);
  view.setUint16(2, finSourceDuration(frame.field2), true);
  for (const event of frame.events) {
    requireSource(event.slot === 0 && (event.name === "" || event.name === "NONAME") && !effectNames.has(event.name),
      "FIN event dependency outside bounded no-muzzle proof");
    view.setInt16(12, event.valueA, true);
    view.setInt16(14, event.valueB, true);
  }
  return [...bytes];
}

function boomEffectNames(bytes: Uint8Array): ReadonlySet<string> {
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("%"));
  const names = new Set<string>();
  let cursor = 1;
  requireSource(Number(lines[0]) === 13, "complete BOOM effect classification required");
  for (let index = 0; index < 13; index++) {
    const [id, width] = lines[cursor++].split(/\s+/).map(Number);
    requireSource(id === index && Number.isInteger(width) && width > 0 && width <= 9, "invalid BOOM classification row");
    while (cursor < lines.length && lines[cursor] !== "NONE") names.add(lines[cursor++]);
    requireSource(lines[cursor++] === "NONE", "unterminated BOOM effect names");
    cursor += width + 3;
  }
  requireSource(cursor === lines.length, "incomplete BOOM effect classification");
  return names;
}

function collisionFields(animation: FinAnimation, spriteBytes: Uint8Array, spriteName: string): Record<number, number> {
  const sprite = parseSprite(spriteBytes);
  let left = 10000, top = 10000, right = -10000, bottom = -10000;
  for (const frames of directionFrames(animation, `${spriteName}STAND`)) {
    let directionLeft = 10000, directionTop = 10000, directionRight = -10000, directionBottom = -10000;
    for (const frame of frames) for (const child of frame.children) {
      requireSource(child.sprite.toUpperCase() === spriteName, "unverified collision SPR dependency");
      const image = sprite.frames[child.frame];
      requireSource(image && image.width > 0 && image.height > 0, "missing collision SPR frame");
      directionLeft = Math.min(directionLeft, (child.x + image.anchorX) * 8);
      directionTop = Math.min(directionTop, child.y * 8);
      directionRight = (child.x + image.anchorX + image.width) * 8;
      directionBottom = Math.max(directionBottom, (child.y + image.height) * 8);
    }
    left = Math.min(left, directionLeft); top = Math.min(top, directionTop);
    right = directionRight; bottom = Math.max(bottom, directionBottom);
  }
  requireSource(left < right && top < bottom, "unproved source collision rectangle");
  return { 0x48: Math.min(left, -96), 0x4c: Math.min(top, -96),
    0x50: Math.max(right, 96), 0x54: Math.max(bottom, 96), 0x58: 0, 0x5c: -(bottom >> 3) };
}

function ordinaryBoom(bytes: Uint8Array): number[] {
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("%"));
  requireSource(lines[0] === "13" && lines[1] === "0 1" && lines[2] === "NONE", "unowned ordinary BOOM profile");
  const record = new Uint8Array(136), view = new DataView(record.buffer);
  record[16] = 1;
  view.setInt16(18, Math.trunc(Number(lines[3]) * 256 / 100), true);
  const spread = lines.slice(4, 7).flatMap(line => line.split(/\s+/).map(Number));
  requireSource(spread.length === 9 && spread.every(Number.isInteger), "invalid ordinary BOOM spread");
  spread.forEach((value, index) => view.setInt16(116 + index * 2, Math.trunc(value * 256 / 100), true));
  return [...record];
}

async function hash(bytes: Uint8Array): Promise<string> {
  requireSource(bytes instanceof Uint8Array, "source bytes required");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)),
    value => value.toString(16).padStart(2, "0")).join("");
}

export function isAuthenticatedSourceNativeCombatProof(value: unknown): value is SourceNativeCombatProof {
  return !!value && typeof value === "object" && authenticated.has(value);
}

export async function createSourceNativeCombatProof(assets: SourceNativeCombatAssets): Promise<SourceNativeCombatProof> {
  const source = structuredClone(assets);
  for (const field of Object.keys(SOURCE_HASHES) as (keyof typeof SOURCE_HASHES)[]) {
    if (source[field] instanceof Uint8Array) Object.assign(source, { [field]: Uint8Array.from(source[field]) });
  }
  if (source.registryFins && typeof source.registryFins === "object") {
    Object.assign(source, { registryFins: Object.fromEntries(Object.entries(source.registryFins)
      .map(([name, bytes]) => [name, bytes instanceof Uint8Array ? Uint8Array.from(bytes) : bytes])) });
  }
  const scenarioHash = await hash(source.scenario);
  const profile = SOURCE_PROFILES.find(profile => profile.hashes.scenario === scenarioHash);
  requireSource(profile, "scenario hash mismatch");
  for (const field of Object.keys(SOURCE_HASHES) as (keyof typeof SOURCE_HASHES)[]) {
    requireSource(await hash(source[field]) === profile.hashes[field], `${field} hash mismatch`);
  }
  const text = new TextDecoder();
  const units = parseUnitStats(text.decode(source.gameStat)), unit = units[profile.sourceType];
  const scenario = parseScenario(text.decode(source.scenario));
  const policy = scenario.teams[0].race;
  requireSource(policy === 0 || policy === 1, "unowned selected team0 source policy");
  const columns = [null, 4, 8, 12, 20, 16, 24, 28, 32, 40, 44, 64, 68, null, 100, 104, 108,
    null, 112, 116, 220, 236, 224, 240, 244, 248, 252, 256, 260, 264, 272, 276, null];
  const rows = text.decode(source.gameStat).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("%")).slice(1).map(line => line.split(/\s+/));
  requireSource(units.length === 106, "expected all 106 source type rows");
  const scalarTypeRows = units.map(unit => {
    const bytes = new Uint8Array(280), view = new DataView(bytes.buffer);
    columns.forEach((offset, token) => { if (offset !== null) view.setInt32(offset, Number(rows[unit.index][token]), true); });
    bytes[0] = Number(Number(rows[unit.index][32]) !== 0);
    bytes[0x60] = Number(rows[unit.index][13]);
    [256, ...unit.armorUpgradePercentages.map(value => Math.trunc(25600 / value))]
      .forEach((value, index) => view.setInt32(0x24 + index * 4, value, true));
    for (const team of scenario.teams) {
      const levels = sourceScenarioUpgradeLevels(team, unit.index);
      bytes[0x30 + team.index] = levels.weaponLevel; bytes[0x38 + team.index] = levels.armorLevel;
    }
    return [...bytes];
  });
  const scanOffsets: number[][] = [];
  let rings = 0;
  for (const word of executableRandomTable(source.executable, 0x434090, profile.scanPointCount)) {
    const point = [word << 16 >> 16, word >> 16];
    scanOffsets.push(point);
    if (point[0] === 99) {
      requireSource(point[1] === 99, "invalid executable acquisition sentinel");
      rings++;
    }
  }
  requireSource(rings === profile.scanRingCount && scanOffsets.at(-1)?.[0] === 99,
    "incomplete bounded executable acquisition rings");
  const weapon = parseWeaponStats(text.decode(source.weaponStat)).find(entry => entry.id === profile.weapon)!;
  requireSource(unit.weapons[0] === weapon.id, "source base weapon binding required");
  requireSource(weapon.shots === 0, "unsupported weapon BOOM FIN override");
  const weaponFin = await weaponFinRegistry(source, weapon.visualClass, weapon.id);
  const weaponBytes = initialWeaponRecord(source.executable, 0x4f0200 + weapon.id * 72), weaponView = new DataView(weaponBytes.buffer);
  const weaponFields = { 0: weapon.rawPrefix, 4: weapon.soundId, 8: weapon.rateOfFire,
    12: weapon.damage, 16: weapon.speed, 20: weapon.range,
    24: Math.trunc(((weapon.range * 256 + 1024) * 2 + 1) / (weapon.speed * 2)) + 1,
    28: weapon.shots, 32: weapon.reload, 36: weapon.magicChewing,
    40: weapon.rawTail[1], 44: weaponFin.travelBank,
    48: weaponView.getInt32(48, true), 52: weaponView.getInt32(52, true),
    56: weaponView.getInt32(56, true), 60: weaponView.getInt32(60, true),
    64: weaponFin.impactVariantCount, 68: weapon.rawTail[0] };
  for (const [offset, value] of Object.entries(weaponFields)) {
    if (Number(offset) === 40 || Number(offset) === 68) weaponView.setUint8(Number(offset), value);
    else weaponView.setInt32(Number(offset), value, true);
  }
  const animation = parseFin(source.troopFin);
  const effectNames = boomEffectNames(source.boomStat), unboundFinEvents = new Set<string>();
  const combatFrame = (frame: FinTimelineEntry) => {
    const bytes = rawCombatFrame(frame, effectNames);
    frame.events.forEach(event => unboundFinEvents.add(event.name));
    return bytes;
  };
  const fireFrames = Object.fromEntries([...profile.bankFields, ...profile.reactionFields,
    ...profile.deathFields].map(field =>
    [field.id, directionFrames(animation, field.name).map(frames => frames.map(combatFrame))]));
  const fin = Object.fromEntries(Object.entries(fireFrames).map(([bank, directions]) =>
    [bank, directions.map(frames => frames.map(frame => frame[2]))]));
  const projectileFin = weaponFin.travelBank ? { [weaponFin.travelBank]: directionFrames(animation, "GRAYBULLET")
    .map(frames => frames.map(frame => combatFrame(frame)[2])) } : {};
  const levels = scenario.teams.map(team => sourceScenarioUpgradeLevels(team, profile.sourceType));
  requireSource(levels.length === 8, "complete original scenario upgrades required");
  const statisticsClearBytes = executableRandomTable(source.executable, 0x419d66, 1)[0];
  const typeClearBytes = executableRandomTable(source.executable, 0x419d77, 1)[0];
  requireSource(statisticsClearBytes === 384 && typeClearBytes === 0x3700, "unverified native statistics initializer");
  const typeStatisticsBytes = initialWeaponRecord(source.executable, 0x495860, 4400 * 4);
  typeStatisticsBytes.fill(0, 0, typeClearBytes);
  const statistics = Array<number>(statisticsClearBytes / 4).fill(0);
  const scale = executableRandomTable(source.executable, 0x4012b5, 1)[0] << 6;
  requireSource(scale === 256, "unverified startup statistics scale");
  for (const address of [0x40183c, 0x40184e]) statistics[executableRandomTable(source.executable, address, 1)[0] * 12] = scale;
  const proof: SourceNativeCombatProof = freeze({
    kind: "source-native-combat-proof-v1", sourceType: profile.sourceType, weapon: profile.weapon, runtimeReady: false,
    localTeam: 0, policy,
    hashes: { ...profile.hashes }, scenario, bankFields: profile.bankFields,
    reactionFields: profile.reactionFields, deathFields: profile.deathFields,
    typeFields: Object.freeze({ 4: unit.faction, 8: unit.turnSpeed, 12: unit.movementSpeed,
      16: unit.observationNight, 20: unit.observationDay, 24: unit.weapons[0],
      28: unit.weapons[1], 32: unit.weapons[2], 64: unit.targetClass, 68: unit.health }),
    weaponFields, weaponBytes: [...weaponBytes], weaponFin, projectileFin,
    armorCoefficients: [256, ...unit.armorUpgradePercentages.map(value => Math.trunc(25600 / value))],
    collisionFields: collisionFields(animation, source.troopSprite, profile.sprite),
    weaponLevels: levels.map(level => level.weaponLevel), armorLevels: levels.map(level => level.armorLevel),
    ordinaryBoom: ordinaryBoom(source.boomStat), damageTable: parseDamageMatrix(text.decode(source.damageMatrix)).coefficients,
    randomTable: executableRandomTable(source.executable), scalarTypeRows, scanOffsets,
    relations: Array.from({ length: 100 }, (_, index) => {
      const observer = Math.floor(index / 10), target = index % 10;
      return Number(observer === target || (observer < 8 && target < 8 && scenario.teams[observer].allies[target] !== 0));
    }), fireFrames, fin, unboundFinEvents: [...unboundFinEvents].sort(),
    deathInitial: {
      statistics,
      typeStatistics: Array.from({ length: 4400 }, (_, index) => new DataView(typeStatisticsBytes.buffer).getInt32(index * 4, true)),
      commanderSlots: Array<number>(8).fill(-1),
    },
    unresolved: ["complete-projectile-type-table", "host-session-admission"],
  });
  authenticated.add(proof);
  return proof;
}

export function composeSourceNativeCombatProof(input: {
  readonly configuration: NativeAiTaskConfiguration;
  readonly proof: SourceNativeCombatProof;
  readonly team: number;
}) {
  const { configuration, proof, team } = input;
  requireSource(isAuthenticatedSourceNativeCombatProof(proof), "authenticated combat proof required");
  requireSource(isAuthenticatedSourceNativeTaskConfiguration(configuration), "authenticated task configuration required");
  requireSource(sourceNativeTaskMatchesScenario(configuration, proof.scenario), "task/source complete SCN mismatch");
  requireSource(Number.isInteger(team) && team >= 0 && team < 8 && proof.weaponLevels[team] === 0,
    "only source base weapon team selection is proved");
  const profile = configuration.profiles.filter(profile => profile.typeId === proof.sourceType)[team];
  requireSource(profile && profile.typeBytes.length === 280, "source type task profile required");
  const typeBytes = Uint8Array.from(profile.typeBytes), view = new DataView(typeBytes.buffer);
  for (const [offset, value] of Object.entries(proof.typeFields)) {
    requireSource(view.getInt32(Number(offset), true) === value, "task/source type field mismatch");
  }
  requireSource(proof.weaponLevels.every((level, index) => typeBytes[0x30 + index] === level)
    && proof.armorLevels.every((level, index) => typeBytes[0x38 + index] === level), "task/source original upgrades mismatch");
  requireSource(JSON.stringify(profile.randomTable) === JSON.stringify(proof.randomTable), "task/source RNG mismatch");
  for (const field of proof.bankFields.slice(0, 2)) {
    requireSource(view.getUint32(field.offset, true) === field.id
      && JSON.stringify(profile.fin[field.id]) === JSON.stringify(proof.fin[field.id]), "task/source FIN field mismatch");
  }
  proof.armorCoefficients.forEach((value, index) => view.setInt32(0x24 + index * 4, value, true));
  for (const [offset, value] of Object.entries(proof.collisionFields)) view.setInt32(Number(offset), value, true);
  for (const field of [...proof.bankFields, ...proof.reactionFields, ...proof.deathFields]) view.setUint32(field.offset, field.id, true);
  if (proof.deathFields.length) view.setInt32(0xe8, proof.deathFields.length, true);
  view.setInt32(0x100, new DataView(Uint8Array.from(proof.scalarTypeRows[proof.sourceType]).buffer).getInt32(0x100, true), true);
  view.setUint8(0x60, proof.scalarTypeRows[proof.sourceType][0x60]);
  view.setInt32(0xd8, proof.reactionFields.length, true);
  view.setInt32(0xe4, proof.bankFields.filter(field => field.offset >= 0xa0).length, true);
  return freeze({ kind: "source-native-combat-fragment-v1" as const, runtimeReady: false as const,
    sourceId: configuration.sourceId, team, typeBytes: [...typeBytes], proof });
}