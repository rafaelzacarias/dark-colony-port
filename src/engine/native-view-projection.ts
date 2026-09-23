import type { CampaignSessionState, CampaignSessionJournalEntry } from "./campaign-session";
import type { CampaignWorld } from "./campaign-world";
import type { TransportHostState } from "./transport-host";
import { sourceNativeTaskValue } from "./source-native-task-options";

export interface NativeViewTransport {
  readonly slots: TransportHostState["slots"];
  readonly registry: TransportHostState["registry"];
  readonly generations: TransportHostState["generations"];
  readonly reducer: Pick<TransportHostState["reducer"], "carriers">;
  readonly nativeCombat: { readonly death: boolean };
}

export interface NativeViewProjection {
  readonly cycleCounter: number;
  readonly sourceDayNight: CampaignSessionState["sourceDayNight"];
  readonly world: Pick<CampaignWorld, "entities" | "messages" | "exomoney">;
  readonly controller: { readonly runtime: Pick<CampaignSessionState["controller"]["runtime"], "bail" | "statistics"> };
  readonly transport: NativeViewTransport;
  readonly visibility: { readonly width: number; readonly height: number; readonly groundWords: Uint32Array };
  readonly resources: readonly {
    readonly slot: number;
    readonly raw: readonly number[];
  }[];
}

export interface NativeViewFrame extends NativeViewProjection {
  readonly entry: Pick<CampaignSessionJournalEntry, "requests" | "commands">;
  readonly bailExpired: boolean;
}

export function nativeViewResourceIdentity(projection: NativeViewProjection): string {
  const { transport, world } = projection;
  const entities = world.entities.filter(entity => entity.unitType === 40);
  if (entities.length !== projection.resources.length) throw new TypeError("Native view resource count changed");
  return sourceNativeTaskValue(projection.resources.map(({ slot, raw }) => {
    const actor = transport.slots[slot], entity = entities.find(entity => entity.rawSlot === slot);
    if (!actor || !entity || actor.resourceTask || actor.nativeAiTask ||
      transport.registry[slot] !== actor.key || transport.generations[slot] !== actor.generation) {
      throw new TypeError("Native view fresh resource ownership changed");
    }
    return { actor, entity, raw };
  }));
}

export function projectNativeView(state: CampaignSessionState, host: TransportHostState): NativeViewProjection {
  if (!host.nativeCombat || !host.nativeAiTasks || host.resourceLifecycle || state.production || state.campaignAi) {
    throw new TypeError("Native view projection requires exclusive native combat ownership");
  }
  return structuredClone({ cycleCounter: state.cycleCounter, sourceDayNight: state.sourceDayNight,
    world: { entities: state.world.entities, messages: state.world.messages.slice(-1), exomoney: state.world.exomoney },
    controller: { runtime: { bail: state.controller.runtime.bail, statistics: state.controller.runtime.statistics } },
    transport: { slots: host.slots, registry: host.registry, generations: host.generations,
      reducer: { carriers: host.reducer.carriers }, nativeCombat: { death: Boolean(host.nativeCombat.death) } },
    visibility: { width: host.width, height: host.height, groundWords: Uint32Array.from(host.nativeAiTasks.ground) },
    resources: host.slots.flatMap(actor => actor?.unitType === 40 ? [{ slot: actor.slot,
      raw: Array.from(state.world.entityBytes!.subarray(actor.slot * 220, (actor.slot + 1) * 220)) }] : []),
  });
}