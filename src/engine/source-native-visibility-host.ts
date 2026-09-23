import type { CampaignWorld } from "./campaign-world";
import type { NativeAiTaskConfiguration, TransportHostState } from "./transport-host";
import { parseScenario } from "../../tools/extractors/data/scenario";
import { reduceLegacyNativeVisibility } from "./legacy-native-visibility";
import { createSourceNativeVisibilityConfiguration, type SourceNativeVisibilityAssets,
  type SourceNativeVisibilityConfiguration } from "./source-native-visibility";
import { retainSourceNativeTaskConfiguration, sourceNativeTaskValue, validateSourceNativeWorld } from "./source-native-task-options";

export interface SourceNativeVisibilityHostConfiguration {
  readonly kind: "source-native-visibility-host-v1";
  readonly source: SourceNativeVisibilityConfiguration;
  readonly taskSourceId: string;
  readonly localTeam: number;
  readonly localMask: number;
  readonly daylight: number;
  readonly crtSeed: number;
}

export interface SourceNativeVisibilityFrame {
  readonly sequence: number;
  readonly counter: number;
  readonly producerSlots: readonly number[];
  readonly excludedProducerSlots: readonly number[];
}

export interface SourceNativeVisibilityEvent {
  readonly sequence: number;
  readonly counter: number;
  readonly executed: boolean;
  readonly phases: readonly ("clear" | "compute")[];
  readonly writes: number;
  readonly rngCursor: number;
  readonly crtSeed: number;
  readonly producerSlots: readonly number[];
  readonly excludedProducerSlots: readonly number[];
}

export interface SourceNativeVisibilityOwner {
  sequence: number;
  journal: SourceNativeVisibilityEvent[];
}

const authenticated = new WeakSet<SourceNativeVisibilityHostConfiguration>();

export function validateSourceNativeVisibilityHostConfiguration(value: SourceNativeVisibilityHostConfiguration): void {
  if (!authenticated.has(value)) throw new Error("Native visibility host requires authenticated configuration identity");
}

export async function createSourceNativeVisibilityHostConfiguration(input: {
  readonly assets: SourceNativeVisibilityAssets;
  readonly tasks: NativeAiTaskConfiguration;
  readonly world: CampaignWorld;
  readonly localTeam: number;
  readonly localMask: number;
  readonly daylight: number;
  readonly crtSeed: number;
}): Promise<SourceNativeVisibilityHostConfiguration> {
  const { localTeam, localMask, daylight, crtSeed } = input;
  const { executable, gameStat, scenario, map, bts, mtg, pth } = input.assets;
  if (![executable, gameStat, scenario, map, bts, mtg, pth].every(bytes => bytes instanceof Uint8Array))
    throw new Error("Native visibility source bytes required");
  const assets: SourceNativeVisibilityAssets = {
    executable: Uint8Array.from(executable), gameStat: Uint8Array.from(gameStat), scenario: Uint8Array.from(scenario),
    map: Uint8Array.from(map), bts: Uint8Array.from(bts), mtg: Uint8Array.from(mtg), pth: Uint8Array.from(pth),
  };
  const tasks = retainSourceNativeTaskConfiguration(input.tasks);
  validateSourceNativeWorld(tasks, input.world);
  if (sourceNativeTaskValue(parseScenario(new TextDecoder().decode(assets.scenario)))
    !== sourceNativeTaskValue(input.world.source)) throw new Error("Visibility/task scenario fingerprint mismatch");
  if (!Number.isInteger(localTeam) || localTeam < 0 || localTeam > 7
    || !Number.isInteger(localMask) || localMask < 0 || localMask > 0x7f800000 || (localMask & 0x7fffff)
    || !Number.isInteger(daylight) || daylight < 0 || daylight > 256
    || !Number.isInteger(crtSeed) || crtSeed < 0 || crtSeed > 0xffffffff)
    throw new Error("Invalid explicit visibility caller options");
  const source = await createSourceNativeVisibilityConfiguration(assets);
  if (source.width !== tasks.profiles[0].width || source.height !== tasks.profiles[0].height
    || sourceNativeTaskValue(source.pathFamilies) !== sourceNativeTaskValue(tasks.profiles[0].families))
    throw new Error("Visibility/task map fingerprint mismatch");
  const configuration: SourceNativeVisibilityHostConfiguration = Object.freeze({ kind: "source-native-visibility-host-v1",
    source, taskSourceId: tasks.sourceId, localTeam, localMask, daylight, crtSeed });
  authenticated.add(configuration);
  return configuration;
}

export function stageSourceNativeVisibility(world: CampaignWorld, host: TransportHostState,
  frame: SourceNativeVisibilityFrame): { world: CampaignWorld; event: SourceNativeVisibilityEvent } {
  const combat = host.nativeCombat, owner = combat?.visibility, configuration = combat?.configuration.visibility;
  if (!configuration || !owner || !host.nativeAiTasks) throw new Error("Native visibility ownership required");
  validateSourceNativeVisibilityHostConfiguration(configuration);
  if (!frame || Object.keys(frame).sort().join() !== "counter,excludedProducerSlots,producerSlots,sequence"
    || !Number.isSafeInteger(frame.sequence) || frame.sequence !== owner.sequence + 1)
    throw new Error("Native visibility requires next caller sequence");
  if (configuration.taskSourceId !== combat.configuration.taskSourceId
    || host.resourceLifecycle || host.productionExits?.length || host.motions.length)
    throw new Error("Unowned shared visibility scheduler");
  const tasks = host.nativeAiTasks, source = configuration.source, profile = tasks.configuration.profiles[0];
  const typeTable = new DataView(Uint8Array.from(combat.configuration.tables.typeTable).buffer);
  const bytes = world.entityBytes!;
  for (let slot = 0; slot < 800; slot++) if (bytes[slot * 220 + 0x2c]) {
    const kind = bytes[slot * 220 + 6];
    if (kind >= source.types.length || typeTable.getInt32(kind * 280 + 0x78, true) !== 0)
      throw new Error("Visibility runtime metadata requires source class zero");
    if (frame.producerSlots.includes(slot) && (typeTable.getInt32(kind * 280 + 16, true) !== source.types[kind].night
      || typeTable.getInt32(kind * 280 + 20, true) !== source.types[kind].day
      || typeTable.getUint8(kind * 280 + 0x60) !== source.types[kind].flight
      || typeTable.getUint8(kind * 280 + 0x6c) !== source.types[kind].detection))
      throw new Error("Unowned visibility source upgrade");
  }
  if (host.resourceTileFlags.length !== source.width * source.height
    || host.resourceTileFlags.some(word => word !== 0 && word !== 0x04000000))
    throw new Error("Unowned visibility terrain mutation");
  const terrain = source.terrain.map((word, cell) => {
    const column = cell % source.width, row = Math.floor(cell / source.width);
    return (word | host.resourceTileFlags[(source.height - 1 - row) * source.width + column]) >>> 0;
  });
  const result = reduceLegacyNativeVisibility({ configuration: source, phase: "caller", counter: frame.counter,
    highWater: host.highWater, actors: [...bytes], registry: host.registry.map((key, slot) => key === null ? -1 : slot),
    ground: tasks.ground, air: profile.air, extra: profile.extra, terrain,
    localTeam: configuration.localTeam, localMask: configuration.localMask, daylight: configuration.daylight,
    revealAll: 0, revealLocal: 0, rngCursor: tasks.rngCursor, crtSeed: combat.soundState?.randomSeed ?? configuration.crtSeed,
    producerSlots: frame.producerSlots, excludedProducerSlots: frame.excludedProducerSlots });
  if (!result.supported) throw new Error(result.diagnostic);
  tasks.ground = [...result.ground];
  const actors = Uint8Array.from(result.actors);
  for (const actor of host.slots) if (actor?.nativeAiTask)
    actor.nativeAiTask.raw = Array.from(actors.subarray(actor.slot * 220, (actor.slot + 1) * 220));
  const event: SourceNativeVisibilityEvent = { ...structuredClone(frame), executed: result.executed,
    phases: result.phases, writes: result.writes.length, rngCursor: result.rngCursor, crtSeed: result.crtSeed };
  owner.sequence = frame.sequence;
  owner.journal.push(event);
  return { world: { ...world, entityBytes: actors }, event };
}