import { assetUrl } from "../asset-url";
import { initializeCampaignSession } from "./campaign-session";
import type { CampaignWorld } from "./campaign-world";
import { sourceNativeCombatSessionOptions, type SourceNativeCombatMission } from "./source-native-combat-mission";
import { validateSourceNativeWorld, sourceNativeTaskValue } from "./source-native-task-options";
import { loadSourceResourceOptions, selectSourceResourceConfiguration } from "./source-resource-options";
import { transportHostState } from "./transport-host";
import type { FinAnimationData } from "../render/fin-animation";

function requirePresentation(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Source native combat VENT presentation: ${message}`);
}

export async function createSourceNativeCombatPresentation(mission: SourceNativeCombatMission,
  loadBytes?: (url: string) => Promise<Uint8Array>) {
  mission = structuredClone(mission);
  const options = sourceNativeCombatSessionOptions(mission);
  requirePresentation(options, "exclusive authenticated combat session required");
  const fresh = initializeCampaignSession({ ...options, nativeAiTasks: undefined, nativeCombat: undefined });
  requirePresentation(fresh.ok, "fresh source world required");
  validateSourceNativeWorld(options.nativeAiTasks, fresh.value.world);
  const encoded = mission.scenario.rawScenario;
  requirePresentation(typeof encoded === "string", "original SCN bytes required");
  const read = loadBytes ?? (async (url: string) => {
    const response = await fetch(url);
    requirePresentation(response.ok, `cannot load ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  let animationBytes: Uint8Array | undefined;
  const resourceSourceOptions = await loadSourceResourceOptions({ sessionId: options.sessionId, mission,
    world: fresh.value.world, rawScenario: Uint8Array.from(atob(encoded), character => character.charCodeAt(0)),
    configuration: selectSourceResourceConfiguration({ profile: "user-selected-source-campaign-fresh",
      mode: 0, localTeam: 0, race: mission.faction === "human" ? 0 : 1 }, "native-constructor"),
    loadBytes: async url => {
      const bytes = Uint8Array.from(await read(url));
      if (url === assetUrl("/assets/generated/animations/VENT.json")) animationBytes = bytes;
      return bytes;
    } });
  requirePresentation(animationBytes, "authenticated VENT FIN required");
  const fin: FinAnimationData = JSON.parse(new TextDecoder().decode(animationBytes));
  const profile = resourceSourceOptions.resourceLifecycle.types.find(type => type.unitType === 40);
  requirePresentation(profile?.stand === "VENTSTAND" && profile.selectedWeapon === -1 &&
    mission.units.find(unit => unit.index === 40)?.movementSpeed === 0, "immobile source type40 stand field required");
  const initial = fresh.value.world, initialHost = transportHostState(initial);
  const captures = resourceSourceOptions.resourceLifecycle.bindings.map(binding => {
    const actor = initialHost.slots[binding.slot]!;
    const entity = initial.entities.find(entity => entity.rawSlot === binding.slot)!;
    const raw = [...initial.entityBytes!.slice(binding.slot * 220, (binding.slot + 1) * 220)];
    const state = binding.state;
    requirePresentation(state.direction === raw[9] && state.animation.profile === profile.stand &&
      state.animation.frame === 0 && state.animation.delay === 0 && state.animation.mode === 0 &&
      state.order === 0 && state.pendingOrder === 0 && !state.released &&
      sourceNativeTaskValue(state.stack) === sourceNativeTaskValue([{ opcode: 1, words: [65535, 0, 0] }]) &&
      raw.slice(0x14, 0x2c).every(byte => byte === 0), "unproved fresh constructor FIN fields");
    const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
    const timeline = offsets.map(offset => {
      const suffix = (12 - (((offset + 32) & 31) >> 1) + 16) & 15;
      return fin.states.find(entry => entry.name === `${profile.stand}${suffix}` && entry.validRange === true);
    }).find(Boolean);
    requirePresentation(timeline && fin.timeline[timeline.firstTimelineIndex], "missing source direction-zero pose");
    const sample = { timelineIndex: timeline.firstTimelineIndex, finished: false,
      children: fin.timeline[timeline.firstTimelineIndex].children };
    return { slot: actor.slot, actor: sourceNativeTaskValue(actor), entity: sourceNativeTaskValue(entity), raw, sample };
  });
  return (world: CampaignWorld) => {
    const host = transportHostState(world);
    requirePresentation(world.sessionId === initial.sessionId &&
      sourceNativeTaskValue(world.source) === sourceNativeTaskValue(initial.source) &&
      !host.resourceLifecycle && host.nativeCombat?.configuration.taskSourceId === options.nativeAiTasks.sourceId &&
      world.entityBytes?.length === 800 * 220 &&
      world.entities.filter(entity => entity.unitType === 40).length === captures.length &&
      host.slots.filter(actor => actor?.unitType === 40).length === captures.length,
    "source world or resource ownership changed");
    return captures.map(capture => {
      const actor = host.slots[capture.slot];
      const entity = world.entities.find(entity => entity.rawSlot === capture.slot);
      requirePresentation(actor && entity && host.registry[capture.slot] === actor.key &&
        host.generations[capture.slot] === actor.generation && !actor.resourceTask && !actor.nativeAiTask &&
        sourceNativeTaskValue(actor) === capture.actor && sourceNativeTaskValue(entity) === capture.entity &&
        capture.raw.every((byte, offset) => world.entityBytes![capture.slot * 220 + offset] === byte),
      `fresh constructor changed at slot ${capture.slot}; native resource visits are not owned`);
      return { slot: capture.slot, provenance: "source-constructor-type40-stand-field" as const,
        sample: structuredClone(capture.sample) };
    });
  };
}

export type SourceNativeCombatPresentation = Awaited<ReturnType<typeof createSourceNativeCombatPresentation>>;