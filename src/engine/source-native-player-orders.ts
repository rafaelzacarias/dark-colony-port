import type { CampaignWorld } from "./campaign-world";
import type { CampaignSessionInput } from "./campaign-session";
import { sourceNativeCombatFrame, type SourceNativeCombatFrame } from "./source-native-combat-mission";
import { isAuthenticatedSourceNativeTaskConfiguration } from "./source-native-task-options";
import { cloneTransportHostWorld, receiveTransportHostAiPolicy, stepTransportHost,
  validateNativeAiTaskAlignment, type HostSlot, type TransportHostState } from "./transport-host";
import { sourceNativeCombatVisitWorld } from "./source-native-combat-host";
import { acquireLegacySourceCombatTarget } from "./legacy-source-combat-acquisition";

export interface SourceNativePlayerBinding {
  readonly slot: number;
  readonly generation: number;
  readonly key: string;
  readonly raw: readonly number[];
}

export type SourceNativePlayerOrder =
  | { readonly type: "Stop" }
  | { readonly type: "MoveOnly"; readonly destination: { readonly column: number; readonly row: number } }
  | { readonly type: "Attack"; readonly destination: { readonly column: number; readonly row: number };
      readonly target: SourceNativePlayerBinding };

export interface SourceNativePlayerCommandContext {
  readonly world: CampaignWorld;
  readonly localTeam: number;
  readonly selected: readonly SourceNativePlayerBinding[];
  readonly id: string;
  readonly frame: Omit<SourceNativeCombatFrame, "nativeAiReceipt">;
}

type Receipt = NonNullable<CampaignSessionInput["nativeAiReceipt"]>;
export type SourceNativePlayerOrderResult =
  | { readonly ok: false; readonly kind: "UnsupportedPath"; readonly diagnostic: string }
  | { readonly ok: true; readonly scope: "typed-native-command-api-not-ui-parity";
      readonly input: SourceNativeCombatFrame & { readonly nativeAiReceipt: Receipt } };

const integer = (value: number, maximum: number) => Number.isInteger(value) && value >= 0 && value <= maximum;
const requireOrder: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new TypeError(message);
};
function freeze<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function prepareSourceNativePlayerOrder(context: Omit<SourceNativePlayerCommandContext, "frame"> &
  { readonly frame?: SourceNativePlayerCommandContext["frame"] }, command: SourceNativePlayerOrder) {
    const host = cloneTransportHostWorld(context.world).transportState as TransportHostState;
    const owner = host.nativeAiTasks, combat = host.nativeCombat;
    requireOrder(owner && combat && isAuthenticatedSourceNativeTaskConfiguration(owner.configuration),
      "Authenticated source native task/combat ownership required");
    validateNativeAiTaskAlignment(context.world, host);
    requireOrder(integer(context.localTeam, 7) && typeof context.id === "string" && context.id.length > 0,
      "Explicit local team and unique command id required");
    requireOrder(context.selected.length === 1, "Only one selected native binding is proved");
    const frame = context.frame;
    const resolve = (binding: SourceNativePlayerBinding): HostSlot => {
      requireOrder(binding && integer(binding.slot, 799) && integer(binding.generation, Number.MAX_SAFE_INTEGER),
        "Invalid native identity");
      const actor = host.slots[binding.slot];
      requireOrder(actor?.nativeAiTask && actor.status === 1 && actor.health > 0 && host.registry[binding.slot] === actor.key
        && actor.generation === binding.generation && actor.key === binding.key && actor.unitType === 0
        && Array.isArray(binding.raw) && binding.raw.length === 220
        && Array.from({ length: 220 }, (_, index) => index).every(index =>
          Object.hasOwn(binding.raw, index) && integer(binding.raw[index], 255)
          && binding.raw[index] === actor.nativeAiTask!.raw[index]),
      "Stale, unregistered or unowned type/raw binding");
      requireOrder(!frame?.nativeAiFrame.registeredSlots || frame.nativeAiFrame.registeredSlots.includes(actor.slot),
        "Selected/target actor missing from explicit registered visits");
      return actor;
    };
    const actor = resolve(context.selected[0]), raw = actor.nativeAiTask!.raw;
    requireOrder(actor.team === context.localTeam, "Enemy selection is unsupported");
    requireOrder(!actor.pendingNativeAi && raw[0x36] === 0, "Pending native order cannot be overwritten");
    requireOrder(command && ["MoveOnly", "Attack", "Stop"].includes(command.type), "Unproved command kind");
    requireOrder(Object.keys(command).sort().join() === (command.type === "Stop" ? "type"
      : command.type === "Attack" ? "destination,target,type" : "destination,type"), "Unproved command fields");
    const profile = owner.configuration.profiles[actor.nativeAiTask!.profile];
    let fixedX = 0, fixedY = 0;
    if (command.type !== "Stop") {
      const { column, row } = command.destination;
      requireOrder(Object.keys(command.destination).sort().join() === "column,row"
        && integer(column, Math.min(255, host.width - 1)) && integer(row, Math.min(255, host.height - 1)),
      "Destination requires in-bounds native cells, not browser subcells");
      const originX = actor.position.x >>> 8, originY = actor.position.y >>> 8;
      const distance = Math.abs(column - originX), direction = Math.sign(column - originX);
      requireOrder(row === originY && distance >= 1 && distance <= 3, "General route/assault pursuit is unproved");
      const origin = originY * host.width + originX, family = profile.families[origin];
      requireOrder(family && (owner.ground[origin] & 1023) === actor.slot, "Native origin occupancy mismatch");
      for (let step = 1; step <= distance; step++) {
        const cell = origin + direction * step;
        requireOrder(profile.families[cell] === family && (owner.ground[cell] & 1023) === 1023
          && profile.air[cell] >>> 10 === 0, "Obstructed or unowned native route");
      }
      fixedX = column * 256 + 128;
      fixedY = row * 256 + 128;
      if (command.type === "Attack") {
        const target = resolve(command.target), cell = (target.position.y >>> 8) * host.width + (target.position.x >>> 8);
        requireOrder(target.team !== actor.team && target.team < 8
          && combat.configuration.relations[actor.team * 10 + target.team] === 0,
        "Attack requires a hostile native identity");
        requireOrder((owner.ground[cell] & profile.enemyMask) !== 0, "Hidden target is unsupported");
        const world = sourceNativeCombatVisitWorld(combat.configuration, profile, context.world.entityBytes!, owner.ground);
        const acquired = acquireLegacySourceCombatTarget(actor.slot, raw, { ...world, ...world.combat! });
        requireOrder(acquired.supported && acquired.target === target.slot,
          "Requested target is not the current native acquisition; pursuit/target locking is unproved");
      }
    }
    return { host, owner, actor, fixedX, fixedY };
}

export type SourceNativePlayerOrderPreview =
  | { readonly ok: true; readonly scope: "typed-native-command-api-not-ui-parity" }
  | Extract<SourceNativePlayerOrderResult, { ok: false }>;

export function previewSourceNativePlayerOrder(context: Omit<SourceNativePlayerCommandContext, "frame">,
  command: SourceNativePlayerOrder): SourceNativePlayerOrderPreview {
  try {
    prepareSourceNativePlayerOrder(context, command);
    return { ok: true, scope: "typed-native-command-api-not-ui-parity" };
  } catch (error) {
    return { ok: false, kind: "UnsupportedPath", diagnostic: error instanceof Error ? error.message : String(error) };
  }
}

export function sourceNativePlayerAcquiredTarget(context: Omit<SourceNativePlayerCommandContext, "frame">): SourceNativePlayerBinding | undefined {
  const { host, owner, actor } = prepareSourceNativePlayerOrder(context, { type: "Stop" });
  const profile = owner.configuration.profiles[actor.nativeAiTask!.profile];
  const world = sourceNativeCombatVisitWorld(host.nativeCombat!.configuration, profile, context.world.entityBytes!, owner.ground);
  const acquired = acquireLegacySourceCombatTarget(actor.slot, actor.nativeAiTask!.raw, { ...world, ...world.combat! });
  const target = acquired.supported && acquired.target !== null ? host.slots[acquired.target] : undefined;
  return target?.nativeAiTask ? { slot: target.slot, generation: target.generation, key: target.key, raw: [...target.nativeAiTask.raw] } : undefined;
}

export function createSourceNativePlayerOrder(context: SourceNativePlayerCommandContext,
  command: SourceNativePlayerOrder): SourceNativePlayerOrderResult {
  try {
    requireOrder(!("nativeAiReceipt" in context.frame), "One packet per frame; existing receipt cannot be overwritten");
    const frame = sourceNativeCombatFrame(context.frame);
    requireOrder(Number.isSafeInteger(frame.clockMilliseconds) && frame.clockMilliseconds >= context.world.clockMilliseconds,
      "Explicit nondecreasing caller clock required");
    const { host, owner, actor, fixedX, fixedY } = prepareSourceNativePlayerOrder({ ...context, frame }, command);
    const packet = new Uint8Array(command.type === "Stop" ? 7 : 17), words = new DataView(packet.buffer);
    words.setUint16(0, packet.length, true);
    packet[2] = 5;
    words.setInt16(3, actor.slot, true);
    packet[5] = command.type === "Stop" ? 13 : command.type === "MoveOnly" ? 2 : 7;
    if (command.type !== "Stop") {
      packet[6] = 7; packet[7] = 1;
      words.setInt16(8, 1, true);
      words.setUint16(10, fixedX, true); words.setUint16(12, fixedY, true);
      words.setInt16(14, actor.slot, true);
    }
    const receipt: Receipt = { id: context.id, packets: [[...packet]], expected: owner.configuration.bindings.map(binding => {
      const current = host.slots[binding.slot]!;
      return { slot: current.slot, generation: current.generation, key: current.key, raw: [...current.nativeAiTask!.raw] };
    }) };
    const candidate = receiveTransportHostAiPolicy(cloneTransportHostWorld(context.world), context.world.entityBytes!,
      [packet], context.id, "deferred");
    const consumed = stepTransportHost(candidate, undefined, frame.nativeAiFrame);
    requireOrder(consumed.ok, consumed.ok ? "" : JSON.stringify(consumed.diagnostics));
    return freeze({ ok: true, scope: "typed-native-command-api-not-ui-parity", input: { ...frame, nativeAiReceipt: receipt } });
  } catch (error) {
    return Object.freeze({ ok: false, kind: "UnsupportedPath", diagnostic: error instanceof Error ? error.message : String(error) });
  }
}