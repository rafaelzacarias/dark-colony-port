import type { CampaignSessionInput, CampaignSessionOptions } from "./campaign-session";
import type { SourceConstructionMission } from "./source-construction-options";
import { sourceNativeTaskValue } from "./source-native-task-options";
import { sourceNativeCombatBankFields } from "./source-native-combat-options";
import type { HostSlot, NativeAiTaskConfiguration } from "./transport-host";
import { finSourceDuration, type FinAnimationData } from "../render/fin-animation";
import type { SourceNativePlayerBinding, SourceNativePlayerOrder } from "./source-native-player-orders";
import type { NativeViewProjection } from "./native-view-projection";

export interface SourceNativeQueuedPlayerCommand {
  readonly sourceId: string;
  readonly id: string;
  readonly localTeam: 0;
  readonly selected: SourceNativePlayerBinding;
  readonly command: SourceNativePlayerOrder;
}

export type SourceNativeCombatMission = SourceConstructionMission & {
  readonly sourceNativeCombat?: {
    readonly scope: "source-separated-type0-weapon1-nonlethal" | "source-separated-type0-weapon1-bounded-lethal"
      | "source-separated-type8-weapon15-nonlethal";
    readonly playerCommands?: { readonly scope: "bounded-semantic-queue"; readonly localTeam: 0 };
    readonly options: CampaignSessionOptions & {
      readonly nativeAiTasks: NonNullable<CampaignSessionOptions["nativeAiTasks"]>;
      readonly nativeCombat: NonNullable<CampaignSessionOptions["nativeCombat"]>;
    };
  };
};

export type SourceNativeCombatFrame = Pick<CampaignSessionInput, "clockMilliseconds" | "nativeAiReceipt"> & {
  readonly nativeAiFrame: NonNullable<CampaignSessionInput["nativeAiFrame"]>;
};

export function sourceNativeCombatSessionOptions(mission: SourceNativeCombatMission) {
  const override = mission.sourceNativeCombat;
  if (!override) return undefined;
  if (!["source-separated-type0-weapon1-nonlethal", "source-separated-type0-weapon1-bounded-lethal",
    "source-separated-type8-weapon15-nonlethal"].includes(override.scope) || !override.options.nativeAiTasks ||
    !override.options.nativeCombat || mission.sourceConstruction || mission.sourceProduction || mission.sourceResource) {
    throw new TypeError("Native combat view requires an exclusive source-separated bounded session");
  }
  const options = override.options;
  if (options.nativeCombat.visibility) {
    if (options.nativeCombat.visibility.localTeam !== 0 ||
      mission.faction !== (mission.scenario.teams[0]?.race === 1 ? "alien" : "human")) {
      throw new TypeError("Native visibility requires view local team 0 and matching player faction");
    }
  }
  if (override.playerCommands && (override.playerCommands.scope !== "bounded-semantic-queue" || override.playerCommands.localTeam !== 0 ||
    Object.keys(override.playerCommands).sort().join() !== "localTeam,scope")) {
    throw new TypeError("Native player commands require explicit bounded scope and view local team 0");
  }
  if (options.nativeCombat.scope !== override.scope ||
    Boolean(options.nativeCombat.death) !== (override.scope === "source-separated-type0-weapon1-bounded-lethal")) {
    throw new TypeError("Native combat view scope does not match authenticated combat owner");
  }
  const { rawScenario: _rawScenario, schemaVersion: _schemaVersion, source: _metadata, outcomes: _outcomes, ...scenario } = mission.scenario;
  const source = options.source;
  for (const [actual, expected] of [[source, scenario], [options.units, mission.units], [options.weapons, mission.weapons],
    [options.triggers, mission.triggers], [options.messages, mission.messages],
    [options.map.width, mission.map.width], [options.map.height, mission.map.height],
    [Array.from(options.pathGrid), Array.from(mission.pathGrid)], [Array.from(options.tags), Array.from(mission.tags)]]) {
    if (sourceNativeTaskValue(actual) !== sourceNativeTaskValue(expected)) {
      throw new TypeError("Native combat view/session source mismatch");
    }
  }
  if (options.production || options.campaignAi || options.resourceLifecycle) {
    throw new TypeError("Native combat view excludes other schedulers");
  }
  return options;
}

export function sourceNativeCombatFrame(input: SourceNativeCombatFrame): SourceNativeCombatFrame {
  if (!input?.nativeAiFrame || Object.keys(input).some(key => !["clockMilliseconds", "nativeAiFrame", "nativeAiReceipt"].includes(key))) {
    throw new TypeError("Native combat requires explicit visits and native receipts only");
  }
  return structuredClone(input);
}

export function sourceNativeVisibilityPlane(visibility: NativeViewProjection["visibility"],
  dimensions: { readonly width: number; readonly height: number }, mask: number): Uint8Array {
  if (visibility.width !== dimensions.width || visibility.height !== dimensions.height ||
    visibility.groundWords.length !== dimensions.width * dimensions.height) {
    throw new TypeError("Native visibility projection dimensions mismatch");
  }
  return Uint8Array.from(visibility.groundWords, word => Number(Boolean(word & mask)));
}

export function sourceNativeCombatActorSample(animation: FinAnimationData, actor: HostSlot,
  profile: NativeAiTaskConfiguration["profiles"][number], sprite: string) {
  const raw = actor.nativeAiTask?.raw;
  if (!raw || raw.length !== 220 || profile.typeId !== actor.unitType || actor.status === 0) {
    throw new TypeError("Native combat FIN requires a registered source actor");
  }
  const words = new DataView(Uint8Array.from(raw).buffer);
  const direction = (((raw[9] + 8) & 255) >> 4) * 2;
  const fields = actor.unitType === 0 || actor.unitType === 8 ? sourceNativeCombatBankFields(actor.unitType) : [
    { id: actor.unitType * 2 + 1, name: `${sprite}STAND` },
    { id: actor.unitType * 2 + 2, name: `${sprite}MOVE` },
  ];
  const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
  const sampleBank = (offset: number) => {
    const bank = words.getUint32(offset, true), frame = raw[offset + 4], delay = raw[offset + 5], mode = raw[offset + 6];
    const field = fields.find(field => field.id === bank);
    const state = field && offsets.map(turn => {
      const suffix = (12 - (((direction + turn + 32) & 31) >> 1) + 16) & 15;
      return animation.states.find(state => state.name === `${field.name}${suffix}` && state.validRange !== false);
    }).find(Boolean);
    const durations = profile.fin[bank]?.[direction];
    if (!state || !durations || ![0, 1, 2, 3].includes(mode) ||
      durations.length !== state.lastTimelineIndex - state.firstTimelineIndex + 1 ||
      durations.some((duration, index) => finSourceDuration(animation.timeline[state.firstTimelineIndex + index]?.field2 ?? -1) !== duration)) {
      throw new TypeError(`Unsupported source native combat FIN bank/direction: ${bank}:${direction}`);
    }
    const timelineIndex = state.firstTimelineIndex + frame;
    if (timelineIndex > state.lastTimelineIndex || !animation.timeline[timelineIndex]) {
      throw new TypeError(`Unsupported source native combat FIN frame: ${bank}:${frame}`);
    }
    return { bank, frame, delay, mode, direction, state: state.name,
      sample: { timelineIndex, finished: mode === 2, children: animation.timeline[timelineIndex].children } };
  };
  if (raw[0x2a] !== 2) throw new TypeError("Unsupported source native combat third FIN layer");
  const primary = sampleBank(0x14), secondary = raw[0x22] === 2 ? undefined : sampleBank(0x1c);
  return { primary, secondary, sample: { ...primary.sample,
    children: [...primary.sample.children, ...(secondary?.sample.children ?? [])] } };
}