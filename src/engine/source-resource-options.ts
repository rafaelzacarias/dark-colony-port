import { assetUrl } from "../asset-url";
import { sha256Hex as sha256 } from "../sha256";
import { loadSourceProductionOptions, type SourceProductionBootConfiguration } from "./source-production-options";
import { campaignResourceFrame, type CampaignResourceFrameInput } from "./campaign-resource-frame";
import type { CampaignWorld } from "./campaign-world";
import { transportHostState, type ResourceHostBinding, type ResourceHostOptions } from "./transport-host";
import { finSourceDuration, type FinAnimationData } from "../render/fin-animation";
import { tileToNative256 } from "./legacy-transport";
import { sourceLegacyHarvesterMovementWorld } from "./legacy-harvester-movement";
import type { NativeHarvestConfiguration } from "./transport-host";
import type { LegacyUnitStat } from "./legacy-balance";

export interface SourceResourceConfiguration extends SourceProductionBootConfiguration {
  readonly resourceConfiguration: "native-constructor";
  readonly aiPercentages: readonly number[];
}

const FIN = {
  VENT: ["9ced90e6312ebfb2cf8e083c0ba48c418351c89f559329bed7fbdd1f8fbb5604", "9f43206aba24f71a4a0cb7df841e09ebde2a243dc20310cd34644fed2c3ea84a"],
  EXPL: ["9d1026f9746fbaa394773e9e40263206138c067b751b21b464f8b1517dbdcde1", "6cd02d2153bf692155aaf31d73015eb7de89902ecccdc9a079af5a8a6ed2812c"],
  SLUG: ["c241dab9216fb211bbadf677f818f9906fd9c5a1aea0d0df7a007181c0bb2de1", "f1b813f0607aab425b57011f19f16110d8c5b33179691d08dd4b9558afb87d6b"],
} as const;

const MISSIONS = {
  bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab: [
    [15, 166, 88, 72, 0, 3500], [16, 167, 11, 68, 0, 3500],
    [17, 168, 69, 48, 22, 12000], [18, 169, 53, 27, 15, 7000],
  ],
  d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e: [
    [38, 190, 4, 80, 25, 9500], [41, 191, 65, 54, 12, 3500], [42, 192, 13, 51, 0, 5000],
  ],
} as const;

function requireSource(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Source resource: ${message}`);
}

export function selectSourceResourceConfiguration(profile: SourceProductionBootConfiguration,
  selection: "native-constructor"): SourceResourceConfiguration {
  requireSource(profile?.profile === "user-selected-source-campaign-fresh" && profile.mode === 0
    && profile.localTeam === 0 && (profile.race === 0 || profile.race === 1), "explicit fresh source campaign profile required");
  requireSource(selection === "native-constructor", "unproved difficulty selection; require native-constructor");
  return { ...profile, resourceConfiguration: selection, aiPercentages: Array<number>(8).fill(100) };
}

export function sourceResourceMultipliers(configuration: SourceResourceConfiguration): readonly number[] {
  selectSourceResourceConfiguration(configuration, configuration?.resourceConfiguration);
  requireSource(configuration.aiPercentages?.length === 8 && configuration.aiPercentages.every((value) => value === 100),
    "percentages differ from the selected native constructor");
  return configuration.aiPercentages.map((percent) => Math.trunc((percent << 8) / 100));
}

type Metadata = FinAnimationData & { readonly schemaVersion: number; readonly formatTag: number;
  readonly source: { readonly path: string; readonly sha256: string } };

export async function sourceBoundedHarvestConfiguration(input: {
  readonly scope: "source-separated-bounded";
  readonly evidence: string;
  readonly pth: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly tags: Uint8Array;
  readonly fin: Record<keyof typeof FIN, Metadata>;
  readonly units: readonly (LegacyUnitStat & { readonly turnSpeed: number })[];
  readonly bindings: NativeHarvestConfiguration["bindings"];
  readonly banks: readonly { readonly typeId: 6 | 14; readonly stand: number; readonly move: number; readonly preservedIdle: number }[];
}): Promise<NativeHarvestConfiguration> {
  requireSource(input.scope === "source-separated-bounded" && input.evidence.trim().length > 0,
    "explicit isolated scope required; this is not native global mission RNG ownership");
  requireSource(input.tags.length === input.width * input.height && input.bindings.length > 0, "complete MTG and native bindings required");
  const profiles = await Promise.all(input.banks.map(async ({ typeId, ...banks }) => {
    const stat = input.units.find(stat => stat.index === typeId);
    requireSource(stat?.movementSpeed === 40 && stat.turnSpeed === 10 && stat.health === 800
      && stat.weapons.every(weapon => weapon === -1), "unverified nonweapon harvester census");
    const cells = Array.from({ length: input.width * input.height }, (_, index) => index);
    return sourceLegacyHarvesterMovementWorld({ typeId, banks, pth: input.pth, fin: input.fin,
      width: input.width, height: input.height, plane: { cells, tripWords: cells.map(cell => input.tags[cell] === 0 ? 1023 : 2047) },
      census: { speedQ8: stat.movementSpeed, turnStep: stat.turnSpeed!, ground: true } });
  }));
  requireSource(profiles.length > 0, "source native movement profiles required");
  return { scope: input.scope, evidence: input.evidence, profiles, bindings: structuredClone(input.bindings),
    sourceMetadata: { executableSha256: "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
      pthSha256: profiles[0].pthSha256, finSha256: { VENT: input.fin.VENT.source.sha256,
        EXPL: input.fin.EXPL.source.sha256, SLUG: input.fin.SLUG.source.sha256 },
      randomScope: "isolated-index-no-draws", sharedRandomDraws: 0 } };
}

export function sourceResourceProfiles(metadata: Readonly<Record<keyof typeof FIN, Metadata>>): ResourceHostOptions {
  for (const stem of Object.keys(FIN) as (keyof typeof FIN)[]) {
    const data = metadata[stem];
    requireSource(data?.schemaVersion === 1 && data.formatTag === 29 && data.source.path === `${stem}.FIN`
      && data.source.sha256 === FIN[stem][1], `unverified ${stem} FIN metadata`);
  }
  const banks = [
    ["VENT", "VENTSTAND"], ["EXPL", "EXPLSTAND"], ["EXPL", "EXPLDEPLOY"], ["EXPL", "EXPLDIE"],
    ["SLUG", "SLUGSTAND"], ["SLUG", "SLUGDEPLOY"], ["SLUG", "SLUGDIE"],
    ["EXPL", "EXPLFUNK"], ["EXPL", "SLUGFUNK"],
    ["EXPL", "EDPLYSTAND"], ["EXPL", "EDPLYDIE"], ["SLUG", "SDPLSTAND"], ["SLUG", "SDPLDIE"],
  ] as const;
  const animations = banks.map(([stem, id]) => {
    const data = metadata[stem];
    const candidates = Array.from({ length: 16 }, (_, index) => data.states.find((state) => state.name === `${id}${(12 - index + 16) & 15}`));
    const directions = Array.from({ length: 32 }, (_, direction) => {
      const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
      const state = offsets.map((offset) => candidates[((direction + offset + 32) & 31) >> 1]).find(Boolean);
      requireSource(state?.validRange === true && state.firstTimelineIndex <= state.lastTimelineIndex, `missing ${id} direction ${direction}`);
      const frames = data.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1);
      requireSource(frames.length === state.lastTimelineIndex - state.firstTimelineIndex + 1
        && frames.every((frame) => Number.isInteger(frame.field2) && frame.field2! >= 0 && frame.field2! <= 65535), `invalid ${id} timeline`);
      return frames.map((frame) => finSourceDuration(frame.field2!));
    });
    return { id, directions };
  });
  const types = [
    [40, "VENTSTAND", "VENTSTAND", "VENTSTAND"], [6, "EXPLSTAND", "EXPLDEPLOY", "EXPLDIE"],
    [14, "SLUGSTAND", "SLUGDEPLOY", "SLUGDIE"], [47, "EDPLYSTAND", "EDPLYSTAND", "EDPLYDIE"],
    [48, "SDPLSTAND", "SDPLSTAND", "SDPLDIE"],
  ] as const;
  return { animations, types: types.map(([unitType, stand, deploy, death]) => ({ unitType, stand, deploy, death,
    deathVariants: 1, removalHoldField: 0, selectedWeapon: -1,
    ...(unitType === 6 ? { preservedIdle: "EXPLFUNK" } : unitType === 14 ? { preservedIdle: "SLUGFUNK" } : {}) })), bindings: [] };
}

export function sourceResourceFrame(input: Omit<CampaignResourceFrameInput, "buildingSlots"> & { readonly world: CampaignWorld }) {
  return campaignResourceFrame({ ...input, buildingSlots: input.world.buildingSlots });
}

export function sourceHarvesterConstructorBinding(world: CampaignWorld, snapshot: ResourceHostBinding): ResourceHostBinding {
  const host = transportHostState(world);
  const entity = host.slots[snapshot.slot];
  requireSource(entity && host.registry[snapshot.slot] === entity.key && entity.generation === snapshot.generation
    && entity.status === 1 && !entity.resourceTask && entity.task === "unit"
    && (entity.unitType === 6 || entity.unitType === 14), "harvester host identity mismatch");
  const state = snapshot.state;
  requireSource(state.direction === (entity.unitType === 6 ? 160 : 128)
    && state.animation.profile === (entity.unitType === 6 ? "EXPLSTAND" : "SLUGSTAND")
    && state.animation.frame === 0 && state.animation.delay === 0 && state.animation.mode === 0
    && state.pendingOrder === 0 && state.order === 0 && !state.released
    && state.stack.length === 1 && state.stack[0].opcode === 1
    && JSON.stringify(state.stack[0].words) === "[65535,0,0]", "actual fresh harvester constructor snapshot required");
  return structuredClone(snapshot);
}

export async function loadSourceResourceOptions(input: Parameters<typeof loadSourceProductionOptions>[0] & {
  readonly configuration: SourceResourceConfiguration;
  readonly world: CampaignWorld;
}) {
  const aiMultipliers = sourceResourceMultipliers(input.configuration);
  const verified = await loadSourceProductionOptions(input);
  const hash = await sha256(input.rawScenario);
  requireSource(Object.hasOwn(MISSIONS, hash), "unproved SCN resource mapping");
  const rows = MISSIONS[hash as keyof typeof MISSIONS];
  const world = input.world;
  requireSource(world.sessionId === input.sessionId && world.clockMilliseconds === 0, "fresh world/session required");
  requireSource("rawHeader" in world.source && JSON.stringify(world.source.rawHeader) === JSON.stringify(verified.source.rawHeader),
    "world rawHeader differs from raw SCN");
  for (const field of ["id", "teams", "placementRows"] as const) {
    requireSource(JSON.stringify(world.source[field]) === JSON.stringify(verified.source[field]), `world ${field} differs from raw SCN`);
  }
  const host = transportHostState(world);
  requireSource(host.slots.length === 800 && host.registry.length === 800 && !host.resourceLifecycle,
    "fresh complete native host required");
  requireSource(world.entityBytes?.length === 800 * 220, "complete raw native entity records required");
  const raw = new DataView(world.entityBytes.buffer, world.entityBytes.byteOffset, world.entityBytes.byteLength);
  requireSource(world.entities.filter((entity) => entity.unitType === 40).length === rows.length
    && host.slots.filter((entity) => entity?.resource && entity.status !== 0).length === rows.length, "resource count differs from SCN");
  const bindings: ResourceHostBinding[] = rows.map(([sourceRow, slot, tileX, tileY, rateWord, reserve]) => {
    const entity = world.entities.find((entry) => entry.sourceRow === sourceRow);
    const actual = host.slots[slot];
    const position = tileToNative256({ x: tileX, y: tileY });
    requireSource(entity && entity.rawSlot === slot && entity.generation === 0 && entity.unitType === 40 && entity.team === 8
      && entity.tileX === tileX && entity.tileY === tileY && entity.health === reserve
      && entity.resource?.rateWord === rateWord && entity.resource.countdownWord === 65535,
    `SCN resource row ${sourceRow} differs from source world`);
    requireSource(actual && host.registry[slot] === entity.key && actual.key === entity.key && actual.slot === slot
      && actual.generation === entity.generation && actual.unitType === 40 && actual.team === 8 && actual.status === 1
      && actual.health === reserve && actual.position.x === position.x && actual.position.y === position.y
      && actual.resource?.rateWord === rateWord && actual.resource.countdownWord === 65535 && !actual.resourceTask,
    `SCN resource row ${sourceRow} differs from native host`);
    const offset = slot * 220;
    requireSource(raw.getUint16(offset, true) === position.x && raw.getUint16(offset + 4, true) === position.y
      && raw.getUint8(offset + 6) === 40 && raw.getUint8(offset + 7) === 8 && raw.getUint8(offset + 9) === 0
      && raw.getInt32(offset + 12, true) === reserve && raw.getUint8(offset + 0x2c) === 1
      && raw.getUint16(offset + 0x32, true) === rateWord && raw.getUint16(offset + 0x46, true) === 65535,
    `SCN resource row ${sourceRow} differs from raw native record`);
    return { slot, generation: 0, state: { direction: 0, animation: { profile: "VENTSTAND", frame: 0, delay: 0, mode: 0 },
      pendingOrder: 0, order: 0, released: false, stack: [{ opcode: 1, words: [65535, 0, 0] }] } };
  });
  const metadata = {} as Record<keyof typeof FIN, Metadata>;
  for (const stem of Object.keys(FIN) as (keyof typeof FIN)[]) {
    const url = assetUrl(`/assets/generated/animations/${stem}.json`);
    let bytes: Uint8Array;
    if (input.loadBytes) bytes = await input.loadBytes(url);
    else {
      const response = await fetch(url);
      requireSource(response.ok, `cannot load ${url}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    requireSource(await sha256(bytes) === FIN[stem][0], `${stem} generated FIN hash mismatch`);
    metadata[stem] = JSON.parse(new TextDecoder().decode(bytes)) as Metadata;
  }
  const resourceLifecycle = { ...sourceResourceProfiles(metadata), bindings };
  const resourceFrameSource = { teams: verified.source.teams.map(({ index, ai }) => ({ index, ai })),
    aiMultipliers, localTeam: input.configuration.localTeam, cancellationGate: 0 };
  return { source: verified.source, configuration: structuredClone(input.configuration),
    evidence: { executableSha256: "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
      scenarioSha256: hash, profile: "bounded-native-constructor-scn" as const },
    resourceLifecycle, resourceFrameSource, resourceInitialIncome: Array<number>(8).fill(0),
    resourceScales: { rateScale: 256, reserveScale: 256 },
    missionAdmission: "not-evaluated" as const,
    prerequisites: ["generic-mobile-idle-owner", "incoming-harvester-task-handoff", "mission-admission"] as const,
    eruption: { category: 1, event: 7, soundId: 183, source: "SOUND/ERUPT.WAV", spatial: false } as const };
}