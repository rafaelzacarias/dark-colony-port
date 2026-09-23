import type { CampaignSessionOptions } from "../../../src/engine/campaign-session";
import type { SourceNativeCombatFrame, SourceNativeCombatMission } from "../../../src/engine/source-native-combat-mission";
import type { MissionView } from "../../../src/mission-view";
import type { SourceNativePlayerOrder } from "../../../src/engine/source-native-player-orders";
import type { CampaignVisibilityInput } from "../../../src/engine/campaign-session";
import type { SourceNativeVisibilityHostConfiguration } from "../../../src/engine/source-native-visibility-host";

export type NativeCombatBrowserVisibilityOptions = Pick<SourceNativeVisibilityHostConfiguration, "localTeam" | "localMask" | "daylight" | "crtSeed">;

export const nativeCombatBrowserLabel = "Original HUMAN02 world (21 actors) + separate bounded QA combat caller (2 dynamic actors); not original mission/TRO admission";

export async function bootstrapNativeCombatBrowser() {
  const { Buffer } = await import("buffer/index.js");
  if (!("Buffer" in globalThis)) Object.defineProperty(globalThis, "Buffer", { value: Buffer, writable: true, configurable: true });
}

export async function createNativeCombatBrowserFixture(fetchBytes: typeof fetch = globalThis.fetch.bind(globalThis),
  visibilityOptions?: NativeCombatBrowserVisibilityOptions) {
  const visibilityCaller = visibilityOptions && Object.freeze({ ...visibilityOptions });
  await bootstrapNativeCombatBrowser();
  const [{ initializeCampaignSession }, { createSourceNativeCombatOptions }, { createSourceNativeCombatProof },
    { createSourceNativeTaskOptions, withSourceNativeCombatTasks }, { transportHostState }, { parseScenario }, { parseUnitStats, parseWeaponStats },
    { parseTriggerScript }, { parseMapBundle }, { createSourceNativeVisibilityHostConfiguration }] = await Promise.all([
    import("../../../src/engine/campaign-session"), import("../../../src/engine/source-native-combat-host"),
    import("../../../src/engine/source-native-combat-options"), import("../../../src/engine/source-native-task-options"),
    import("../../../src/engine/transport-host"), import("../../extractors/data/scenario"),
    import("../../extractors/data/tables"), import("../../extractors/data/triggers"), import("../../extractors/maps/map"),
    import("../../../src/engine/source-native-visibility-host"),
  ]);
  const sourceHashes: Record<string, string> = {};
  const read = async (url: string) => {
    const response = await fetchBytes(url);
    if (!response.ok) throw new Error(`QA source fetch ${response.status}: ${url}; original raw_cd files require the local Vite dev server`);
    const bytes = Uint8Array.from(new Uint8Array(await response.arrayBuffer()));
    sourceHashes[url] = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer)),
      value => value.toString(16).padStart(2, "0")).join("");
    return bytes;
  };
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const raw = (path: string) => read(`/raw_cd/DC/${path}`);
  const generated = (path: string) => read(`/assets/generated/${path}`);
  const json = async <Value>(path: string): Promise<Value> => JSON.parse(text(await generated(path)));
  const animationRegistry = await raw("ANIM.DAT");
  const [executable, gameStat, weaponStat, boomStat, damageMatrix, scenarioBytes, troopFin, troopSprite, mapBytes, mtg, pth,
    registryFins, animations] = await Promise.all([
    raw("DC.EXE"), raw("GAMESTAT/GAMESTAT.TXT"), raw("GAMESTAT/WEAPSTAT.TXT"), raw("GAMESTAT/BOOMSTAT.TXT"),
    raw("GAMESTAT/MBULLET.TXT"), raw("SCENARIO/HUMAN/HUMAN02.SCN"), raw("ANIMATE/TRSC.FIN"), raw("SPRITES/TRSC.SPR"),
    raw("SCENARIO/HUMAN/HUMAN02.MAP"), raw("SCENARIO/HUMAN/HUMAN02.MTG"), raw("SCENARIO/HUMAN/HUMAN02.PTH"),
    Promise.all(text(animationRegistry).trim().split(/\s+/).map(async name =>
      [name.toUpperCase(), await raw(`ANIMATE/${name.toUpperCase()}`)] as const)).then(Object.fromEntries),
    Promise.all(["TRSC", "GRAY", "REAP", "BARR"].map(async stem =>
      [stem, await generated(`animations/${stem}.json`)] as const)).then(Object.fromEntries),
  ]);
  const assets = { executable, gameStat, weaponStat, boomStat, damageMatrix, scenario: scenarioBytes, troopFin, troopSprite,
    animationRegistry, registryFins, map: mapBytes, mtg, pth, animations };
  const map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const source = parseScenario(text(assets.scenario));
  const scenario = { ...await json<SourceNativeCombatMission["scenario"]>("data/scenarios/HUMAN/HUMAN02.json"), ...source };
  const options: CampaignSessionOptions = { sessionId: "source-separated-combat-view", source,
    units: parseUnitStats(text(assets.gameStat)), weapons: parseWeaponStats(text(assets.weaponStat)), triggers: [], messages: [],
    map: { width: map.width, height: map.height }, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }], directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1,
    resourceScales: "configured-startup" };
  const fresh = initializeCampaignSession(options);
  if (!fresh.ok) throw new Error(JSON.stringify(fresh.diagnostics));
  const configuration = await createSourceNativeTaskOptions({ assets, world: fresh.value.world });
  const host = transportHostState(fresh.value.world), profile = configuration.profiles[0];
  const cell = host.ground.findIndex((slot, index) => {
    const column = index % host.width, row = Math.floor(index / host.width);
    if (slot !== -1 || column < 12 || column > host.width - 12 || row < 12 || row > host.height - 12) return false;
    for (let offsetY = -8; offsetY <= 8; offsetY++) for (let offsetX = -8; offsetX <= 8; offsetX++) {
      const nearby = index + offsetY * host.width + offsetX;
      if ((profile.ground[nearby] & 1023) !== 1023 || (profile.air[nearby] & 1023) !== 1023) return false;
    }
    return [-2, -1, 0, 1, 2, 3].every(offset => host.groundEligible[index + offset] && profile.families[index] !== 0 &&
      profile.families[index + offset] === profile.families[index] && profile.air[index + offset] >>> 10 === 0);
  });
  if (cell < 0) throw new Error("No real clear source PTH corridor");
  const column = cell % host.width, row = Math.floor(cell / host.width);
  const triggers = parseTriggerScript(`1 norm 1 (c>0)
reinforce2 0 ${column} ${row} 0 1 0 0 0 0 0 0 0 0
reinforce2 5 ${column - 2} ${row} 0 1 0 0 0 0 0 0 0 0
end
2 norm 1 (c>5)
reinforce2 0 ${column + 3} ${row} 92 1 0 0 0 0 0 0 0 0
end
`);
  const boundedOptions = { ...options, triggers };
  const visibilityAssets = visibilityCaller ? { ...assets, bts: await raw("SCENARIO/DESERT.BTS") } : undefined;
  const recreateProviders = async () => {
    const initial = initializeCampaignSession(boundedOptions);
    if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
    const configuration = await createSourceNativeTaskOptions({ assets, world: initial.value.world });
    const proof = await createSourceNativeCombatProof(assets);
    const visibility = visibilityCaller && await createSourceNativeVisibilityHostConfiguration({ ...visibilityCaller,
      assets: visibilityAssets!, tasks: await withSourceNativeCombatTasks(configuration, proof), world: initial.value.world });
    return createSourceNativeCombatOptions({ configuration, proof, ...(visibility ? { visibility } : {}) });
  };
  const providers = await recreateProviders();
  const tileRecords = await generated("maps/HUMAN/HUMAN02.tile-records.u16");
  const tileWords = new DataView(tileRecords.buffer, tileRecords.byteOffset, tileRecords.byteLength);
  const mission: SourceNativeCombatMission = {
    faction: "human", scenario, triggers, messages: [], units: options.units, weapons: options.weapons,
    briefing: await json("data/briefings/HUMAN/HUMAN01.json"), map: await json("maps/HUMAN/HUMAN02.json"),
    tileReferences: map.tileReferences, attributes: map.attributes, pathGrid: map.pathGrid, tags: map.tagGrid,
    tileRecordIndices: Uint16Array.from({ length: tileRecords.length / 2 }, (_, index) => tileWords.getUint16(index * 2, true)),
    terrain: await json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    sourceNativeCombat: { scope: "source-separated-type0-weapon1-nonlethal", options: { ...boundedOptions, ...providers } },
  };
  const frameInput = (state: NonNullable<MissionView["campaignSnapshot"]>): SourceNativeCombatFrame => {
    const counter = state.cycleCounter + 1, current = transportHostState(state.world);
    let packets: number[][] | undefined;
    if (counter === 17 || counter === 58) {
      const team = counter === 17 ? 0 : 5;
      const actor = current.slots.find(entry => entry?.key.startsWith("transport:") && entry.team === team);
      if (!actor) throw new Error(`Missing real dynamic combat actor for team ${team}`);
      packets = [nativeCombatBrowserPacket(actor.slot, counter === 17 ? column + 2 : column, row, counter === 17 ? 7 : 2)];
    }
    return { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0 },
      ...(packets ? { nativeAiReceipt: { id: `combat-view:${counter}`, packets,
        expected: current.slots.flatMap(actor => actor?.nativeAiTask ? [{ slot: actor.slot, generation: actor.generation,
          key: actor.key, raw: actor.nativeAiTask.raw }] : []) } } : {}) };
  };
  return { label: nativeCombatBrowserLabel, mission, column, row, recreateProviders, initial: fresh.value.world,
    sourceHashes: Object.freeze(sourceHashes), frameInput };
}

export function nativeCombatBrowserPacket(slot: number, column: number, row: number, order: 2 | 7 = 2): number[] {
  const bytes = new Uint8Array(17), words = new DataView(bytes.buffer);
  words.setUint16(0, 17, true);
  bytes[2] = 5; words.setInt16(3, slot, true); bytes[5] = order;
  bytes[6] = 7; bytes[7] = 1; words.setInt16(8, 1, true);
  words.setUint16(10, column * 256 + 128, true); words.setUint16(12, row * 256 + 128, true);
  words.setInt16(14, slot, true);
  return [...bytes];
}

export async function createNativeCombatBrowserHarness(canvas: HTMLCanvasElement, stage: HTMLElement,
  callbacks: ConstructorParameters<typeof MissionView>[2] = { onStats() {}, onUnitsChanged() {} },
  inputMode: "scripted-receipts" | "queued-player-input" = "scripted-receipts",
  visibilityOptions?: NativeCombatBrowserVisibilityOptions) {
  const fixture = await createNativeCombatBrowserFixture(undefined, visibilityOptions);
  if (inputMode === "queued-player-input") fixture.mission = { ...fixture.mission, sourceNativeCombat: {
    ...fixture.mission.sourceNativeCombat!, playerCommands: { scope: "bounded-semantic-queue", localTeam: 0 },
  } };
  const { MissionView } = await import("../../../src/mission-view");
  let view = new MissionView(canvas, stage, callbacks, fixture.mission);
  if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
  return {
    ...fixture,
    get view() { return view; },
    get commandStatus() { return view.nativeCommandStatus; },
    queueNativePlayerOrder: (command: SourceNativePlayerOrder) => view.queueNativePlayerOrder(command),
    advanceNativeVisibility: (input: CampaignVisibilityInput) => view.advanceNativeVisibility(input),
    advancePlayerFrame(input: SourceNativeCombatFrame) {
      view.advanceNativeCombat(input);
      return view.nativeCombatFrameState;
    },
    async initialize() {
      await view.initialize();
      if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
    },
    advanceTo(counter: number) {
      if (!Number.isSafeInteger(counter) || counter < view.campaignSnapshot!.cycleCounter || counter > 95) {
        throw new RangeError("Bounded caller requires a forward counter through 95; frame 96 is a deliberate rejection probe");
      }
      if (inputMode === "queued-player-input") throw new TypeError("Player input requires advancePlayerFrame with explicit clock/counter/task budget");
      while (view.campaignSnapshot!.cycleCounter < counter) view.advanceNativeCombat(fixture.frameInput(view.campaignSnapshot!));
      return view.campaignSnapshot!;
    },
    focusOwnedTroop(dynamic = false) {
      const actor = view.simulation.snapshot.units.find(unit => view.isOwnedUnit(unit.id) &&
        (!dynamic || view.nativeBindings.some(binding => binding.simulationId === unit.id && binding.key.startsWith("transport:"))));
      if (!actor) throw new Error("No matching team 0 troop; dynamic troop appears at frame 16");
      view.setCameraCenter(actor.cellX, actor.cellY);
      return actor.id;
    },
    checkpoint: () => view.checkpoint(),
    async restore(saved: ReturnType<MissionView["checkpoint"]>, initialize = false) {
      const providers = await fixture.recreateProviders();
      const mission: SourceNativeCombatMission = { ...fixture.mission, sourceNativeCombat: {
        ...fixture.mission.sourceNativeCombat!, options: { ...fixture.mission.sourceNativeCombat!.options, ...providers },
      } };
      const restored = MissionView.restore(canvas, stage, callbacks, mission, saved);
      try {
        if (initialize) await restored.initialize();
        if (restored.missionDiagnostic) throw new Error(restored.missionDiagnostic);
      } catch (error) { restored.dispose(); throw error; }
      view.dispose();
      view = restored;
      return view;
    },
    dispose: () => view.dispose(),
  };
}