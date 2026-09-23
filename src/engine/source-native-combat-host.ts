import type { LegacyAiRegisteredWorld } from "./legacy-ai-task";
import { validLegacyNativeProjectileState, type LegacyNativeProjectileState, type LegacyNativeFireSpawn } from "./legacy-native-fire";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame, type LegacyNativeProjectileTables } from "./legacy-native-projectiles";
import { isAuthenticatedSourceNativeCombatProof, isAuthenticatedSourceNativeCombatSoundProof,
  type SourceNativeCombatProof, type SourceNativeCombatSoundProof } from "./source-native-combat-options";
import { copySourceNativeConfiguration, sourceNativeCombatInitialRegistry, sourceNativeTaskValue, withSourceNativeCombatTasks } from "./source-native-task-options";
import { reduceLegacyNativeDeathVisit, validLegacyNativeDeathSound, type LegacyNativeDeathState,
  type LegacyNativeDeathSound, type LegacyNativeDeathSoundState, type LegacyNativeDeathSoundRequest } from "./legacy-native-death";
import type { NativeAiTaskConfiguration } from "./transport-host";
import { validateSourceNativeVisibilityHostConfiguration, type SourceNativeVisibilityHostConfiguration,
  type SourceNativeVisibilityOwner } from "./source-native-visibility-host";

export type SourceNativeCombatAudioFrame = Pick<LegacyNativeDeathSound, "initialized" | "disabled" | "listener">;

export interface SourceNativeCombatConfiguration {
  readonly scope: "source-separated-type0-weapon1-nonlethal" | "source-separated-type0-weapon1-bounded-lethal"
    | "source-separated-type8-weapon15-nonlethal";
  readonly runtimeReady: true;
  readonly sourceType: 0 | 8;
  readonly weapon: 1 | 15;
  readonly taskSourceId: string;
  readonly sourceTypeCount: 106;
  readonly geometryTypes: readonly (0 | 8)[];
  readonly tables: LegacyNativeProjectileTables;
  readonly relations: readonly number[];
  readonly scanOffsets: readonly (readonly number[])[];
  readonly policy: 0 | 1;
  readonly death?: { readonly initial: LegacyNativeDeathState; readonly statistics: readonly number[] };
  readonly sound?: SourceNativeCombatSoundProof;
  readonly visibility?: SourceNativeVisibilityHostConfiguration;
}

export interface SourceNativeCombatOwner {
  configuration: SourceNativeCombatConfiguration;
  projectiles: LegacyNativeProjectileState;
  death?: LegacyNativeDeathState;
  soundState?: LegacyNativeDeathSoundState;
  visibility?: SourceNativeVisibilityOwner;
  journal: { counter: number; rngBefore: number; rngAfter: number; spawns: readonly LegacyNativeFireSpawn[];
    impacts: readonly { projectile: number; source: number; target: number; substep: number; damage: number; health: number }[];
    reclaimed: readonly number[];
    sound?: { input: SourceNativeCombatAudioFrame; before: LegacyNativeDeathSoundState; after: LegacyNativeDeathSoundState };
    soundRequests?: readonly LegacyNativeDeathSoundRequest[] }[];
}

const authenticated = new Set<string>();
const immutable = new WeakSet<SourceNativeCombatConfiguration>();
const canonical = new Map<string, SourceNativeCombatConfiguration>();
const requireCombat = (condition: unknown, diagnostic: string): void => {
  if (!condition) throw new Error(`Source native combat host: ${diagnostic}`);
};

export function validateSourceNativeCombatConfiguration(value: SourceNativeCombatConfiguration): void {
  if (immutable.has(value)) return;
  requireCombat(authenticated.has(sourceNativeTaskValue(copySourceNativeConfiguration(value))), "externally authenticated configuration required");
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze); Object.freeze(value);
}

export function retainSourceNativeCombatConfiguration(value: SourceNativeCombatConfiguration): SourceNativeCombatConfiguration {
  if (immutable.has(value)) return value;
  const copy = copySourceNativeConfiguration(value);
  const signature = sourceNativeTaskValue(copy);
  requireCombat(authenticated.has(signature), "externally authenticated configuration required");
  const known = canonical.get(signature);
  if (known) return known;
  freeze(copy); immutable.add(copy);
  return copy;
}

export async function createSourceNativeCombatOptions(input: {
  configuration: NativeAiTaskConfiguration; proof: SourceNativeCombatProof; death?: boolean; sound?: SourceNativeCombatSoundProof;
  visibility?: SourceNativeVisibilityHostConfiguration;
}): Promise<{ nativeAiTasks: NativeAiTaskConfiguration; nativeCombat: SourceNativeCombatConfiguration }> {
  const proof = input.proof, configuration = input.configuration, death = input.death, sound = input.sound, visibility = input.visibility;
  requireCombat(isAuthenticatedSourceNativeCombatProof(proof), "authenticated source assets required");
  requireCombat(!death || proof.sourceType === 0, "type8 death owner is not authenticated");
  requireCombat(sound === undefined || death === true && isAuthenticatedSourceNativeCombatSoundProof(sound),
    "visible death requires authenticated source audio and explicit lethal ownership");
  const nativeAiTasks = await withSourceNativeCombatTasks(configuration, proof);
  if (visibility) {
    validateSourceNativeVisibilityHostConfiguration(visibility);
    requireCombat(visibility.taskSourceId === nativeAiTasks.sourceId, "visibility/combat source mismatch");
    requireCombat(!sound || visibility.crtSeed === sound.initial.randomSeed, "visibility/audio initial CRT mismatch");
  }
  const typeTable = Array<number>(110 * 280).fill(0);
  proof.scalarTypeRows.forEach((row, index) => typeTable.splice(index * 280, 280, ...row));
  const sourceProfile = nativeAiTasks.profiles.find(profile => profile.typeId === proof.sourceType)!;
  typeTable.splice(proof.sourceType * 280, 280, ...sourceProfile.typeBytes);
  const boom = Array<number>(13 * 136).fill(0);
  boom.splice(0, 136, ...proof.ordinaryBoom);
  const nativeCombat: SourceNativeCombatConfiguration = {
    scope: death ? "source-separated-type0-weapon1-bounded-lethal" : proof.sourceType === 8
      ? "source-separated-type8-weapon15-nonlethal" : "source-separated-type0-weapon1-nonlethal", runtimeReady: true,
    sourceType: proof.sourceType, weapon: proof.weapon,
    taskSourceId: nativeAiTasks.sourceId, sourceTypeCount: 106, geometryTypes: [proof.sourceType], policy: proof.policy,
    relations: proof.relations, scanOffsets: proof.scanOffsets,
    tables: { typeTable, weapons: sourceProfile.weapons, boom, damageTable: proof.damageTable,
      fin: death ? { ...proof.projectileFin, ...proof.fin } : proof.projectileFin, randomTable: proof.randomTable },
    ...(death ? { death: { initial: { registry: sourceNativeCombatInitialRegistry(nativeAiTasks),
      typeStatistics: proof.deathInitial.typeStatistics, commanderSlots: proof.deathInitial.commanderSlots, pending: [] },
      statistics: proof.deathInitial.statistics } } : {}),
    ...(sound ? { sound } : {}),
    ...(visibility ? { visibility } : {}),
  };
  const signature = sourceNativeTaskValue(nativeCombat);
  authenticated.add(signature);
  freeze(nativeCombat);
  immutable.add(nativeCombat);
  canonical.set(signature, nativeCombat);
  return { nativeAiTasks, nativeCombat };
}

export function createSourceNativeCombatOwner(configuration: SourceNativeCombatConfiguration): SourceNativeCombatOwner {
  validateSourceNativeCombatConfiguration(configuration);
  if (configuration.visibility) validateSourceNativeVisibilityHostConfiguration(configuration.visibility);
  return { configuration: retainSourceNativeCombatConfiguration(configuration), projectiles: { records: Array<number>(2024 * 40).fill(0),
    highWater: 0, heads: [-1, -1], statistics: configuration.death ? [...configuration.death.statistics] : Array<number>(96).fill(0) },
    ...(configuration.death ? { death: structuredClone(configuration.death.initial) } : {}),
    ...(configuration.sound ? { soundState: structuredClone(configuration.sound.initial) } : {}),
    ...(configuration.visibility ? { visibility: { sequence: 0, journal: [] } } : {}), journal: [] };
}

export function sourceNativeCombatSound(owner: SourceNativeCombatOwner, frame?: SourceNativeCombatAudioFrame): LegacyNativeDeathSound | undefined {
  validateSourceNativeCombatConfiguration(owner.configuration);
  const source = owner.configuration.sound;
  requireCombat(!!source === !!owner.soundState && !!source === !!frame, "owned audio requires an explicit frame and current state");
  if (!source) return undefined;
  requireCombat(Object.keys(frame!).sort().join() === "disabled,initialized,listener"
    && frame!.listener && Object.keys(frame!.listener).sort().join() === "x,y", "invalid audio caller frame");
  const sound = { ...frame!, configuration: source.configuration, state: owner.soundState! };
  requireCombat(validLegacyNativeDeathSound(sound), "invalid current source audio state");
  return sound;
}

export function validateSourceNativeCombatSoundState(owner: SourceNativeCombatOwner): void {
  requireCombat(!!owner.configuration.sound === !!owner.soundState, "source audio state scope mismatch");
  if (owner.configuration.sound) requireCombat(sourceNativeTaskValue(owner.soundState)
    === sourceNativeTaskValue(owner.journal.at(-1)?.sound?.after ?? owner.configuration.sound.initial), "source audio state/journal mismatch");
}

export function sourceNativeCombatVisitWorld(configuration: SourceNativeCombatConfiguration,
  profile: LegacyAiRegisteredWorld, bytes: Uint8Array, ground: readonly number[]): LegacyAiRegisteredWorld {
  const actors: Record<number, number[]> = {};
  for (let slot = 0; slot < 800; slot++) if (bytes[slot * 220 + 0x2c]) {
    requireCombat(bytes[slot * 220 + 6] < configuration.sourceTypeCount, "uncovered source type row");
    actors[slot] = Array.from(bytes.slice(slot * 220, (slot + 1) * 220));
  }
  if (profile.typeId !== configuration.sourceType) return { ...profile, ground };
  for (const [cell, word] of ground.entries()) if (word & profile.enemyMask) {
    for (const plane of [ground, profile.air, profile.extra]) {
      const slot = plane[cell] & 1023;
      requireCombat(slot >= 152, "visible CITY acquisition requires source city flags");
    }
  }
  return { ...profile, ground, combat: { typeTable: configuration.tables.typeTable, relations: configuration.relations,
    damageTable: configuration.tables.damageTable, scanOffsets: configuration.scanOffsets,
    cityFlags: Array<number>(120).fill(0), actors } };
}

export function guardSourceNativeProjectileGeometry(input: LegacyNativeProjectileFrame,
  configuration: SourceNativeCombatConfiguration): void {
  requireCombat(validLegacyNativeProjectileState(input.projectiles), "invalid projectile pool");
  const pool = new DataView(Uint8Array.from(input.projectiles.records).buffer);
  const types = new DataView(Uint8Array.from(configuration.tables.typeTable).buffer);
  const damageClass = new DataView(Uint8Array.from(configuration.tables.weapons).buffer).getInt32(configuration.weapon * 72, true);
  const { world, actors } = input;
  for (let projectile = input.projectiles.heads[1]; projectile !== -1; projectile = pool.getInt16(projectile * 40 + 20, true)) {
    const offset = projectile * 40, source = pool.getInt16(offset + 14, true);
    requireCombat(source >= 152 && source < 800 && actors[source * 220 + 6] === configuration.sourceType
      && pool.getInt16(offset + 12, true) === configuration.weapon, "uncovered projectile source/weapon");
    if (pool.getInt16(offset + 28, true) !== 1) continue;
    let horizontal = pool.getUint16(offset, true), vertical = pool.getUint16(offset + 2, true);
    const owner = actors[source * 220 + 7];
    for (let substep = 0; substep < 4; substep++) {
      horizontal = (horizontal + pool.getInt16(offset + 6, true)) & 65535;
      vertical = (vertical + pool.getInt16(offset + 8, true)) & 65535;
      const column = horizontal >> 8, row = vertical >> 8;
      if (column >= world.width || row >= world.height) continue;
      for (let cellX = Math.max(0, column - 1); cellX <= Math.min(world.width - 1, column + 1); cellX++) {
        for (let cellY = Math.max(0, row - 1); cellY <= Math.min(world.height - 1, row + 1); cellY++) {
          const cell = cellY * world.width + cellX;
          for (const [plane, values] of [world.air, world.ground, world.extra].entries()) {
            if (plane === 0 && configuration.tables.damageTable[damageClass][2] === 0) continue;
            const slot = values[cell] & 1023;
            if (slot >= 1022) continue;
            requireCombat(slot < 800, "invalid collision occupant");
            const team = actors[slot * 220 + 7], type = actors[slot * 220 + 6];
            if (team === owner || team === 8) continue;
            requireCombat(type < configuration.sourceTypeCount, "uncovered collision scalar row");
            if (types.getInt32(type * 280 + 0x68, true) !== 0 && !(actors[slot * 220 + 0xca] & (1 << owner))) continue;
            if (types.getUint8(type * 280) !== 0) continue;
            requireCombat(slot >= 152 && configuration.geometryTypes.includes(type as 0 | 8), "uncovered candidate geometry before alliance filter");
          }
        }
      }
    }
  }
}

export function stepSourceNativeCombatProjectiles(owner: SourceNativeCombatOwner, bytes: Uint8Array,
  profile: LegacyAiRegisteredWorld, ground: readonly number[], rngCursor: number, counter?: number, audioFrame?: SourceNativeCombatAudioFrame) {
  const sound = sourceNativeCombatSound(owner, audioFrame);
  const input: LegacyNativeProjectileFrame = { phase: "after-actor-visits", actors: [...bytes],
    projectiles: owner.projectiles, rngCursor, tables: owner.configuration.tables,
    ...(owner.death ? { death: { counter: counter!, state: owner.death, ...(sound ? { sound } : {}) } } : {}),
    world: { width: profile.width, height: profile.height, ground, air: profile.air, extra: profile.extra,
      families: profile.families, relations: owner.configuration.relations, policy: owner.configuration.policy } };
  guardSourceNativeProjectileGeometry(input, owner.configuration);
  const result = reduceLegacyNativeProjectiles(input);
  if (!result.supported) throw new Error(result.diagnostic);
  return result;
}

export function stepSourceNativeCombatDeath(owner: SourceNativeCombatOwner, bytes: Uint8Array,
  profile: LegacyAiRegisteredWorld, ground: readonly number[], rngCursor: number, counter: number, slot: number,
  audioFrame?: SourceNativeCombatAudioFrame) {
  requireCombat(owner.configuration.death && owner.death, "authenticated death owner required");
  const sound = sourceNativeCombatSound(owner, audioFrame);
  const result = reduceLegacyNativeDeathVisit({ actors: [...bytes], statistics: owner.projectiles.statistics,
    ...(sound ? { sound } : {}),
    state: owner.death!, counter, slot, rngCursor, tables: owner.configuration.tables,
    world: { width: profile.width, height: profile.height, ground, air: profile.air, extra: profile.extra } });
  if (!result.supported) throw new Error(result.diagnostic);
  return result;
}