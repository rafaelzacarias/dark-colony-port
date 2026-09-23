import { advanceSourceDayNight, sourceDayNightFromHeader, type SourceDayNight } from "./source-day-night";
import type { ResourceHostFrame } from "./transport-host";
import type { TriggerResult } from "./trigger-runtime";

export interface CampaignResourceFrameInput {
  readonly sourceDayNight?: SourceDayNight;
  readonly rawHeader?: readonly string[];
  readonly localTeam: number;
  readonly cancellationGate: number;
  readonly teams: readonly { readonly index: number; readonly ai: number }[];
  readonly aiMultipliers: readonly number[];
  readonly buildingSlots: Readonly<Record<string, number>>;
  readonly orders?: ResourceHostFrame["orders"];
}

export function campaignResourceFrame(input: CampaignResourceFrameInput): TriggerResult<{
  readonly sourceDayNight: SourceDayNight;
  readonly resourceFrame: ResourceHostFrame;
}> {
  try {
    const current = input.sourceDayNight ?? (input.rawHeader ? sourceDayNightFromHeader(input.rawHeader) : undefined);
    if (!current) throw new Error("Unsupported resource frame: source day/night state or initial rawHeader required; trigger cycle is not +0x530");
    if ((current.phase !== 0 && current.phase !== 1) || !Number.isInteger(current.cycleLength) || current.cycleLength <= 0 ||
      current.cycleLength > 0x7fffffff || !Number.isInteger(current.elapsed) || current.elapsed < 0 || current.elapsed > 0x7fffffff ||
      !Number.isInteger(current.transitionTicks) || current.transitionTicks <= 0 || current.transitionTicks > current.cycleLength ||
      !Number.isInteger(current.blend) || current.blend < 0 || current.blend > 256) throw new Error("Unsupported source day/night state");
    if (!Number.isInteger(input.localTeam) || input.localTeam < 0 || input.localTeam > 7 ||
      !Number.isInteger(input.cancellationGate) || input.cancellationGate < 0 || input.cancellationGate > 255)
      throw new Error("Unsupported resource frame: explicit native local team and +0x948 byte required");
    if (input.teams?.length !== 8 || input.aiMultipliers?.length !== 8 || !input.buildingSlots ||
      !input.teams.every((team, index) => team?.index === index))
      throw new Error("Unsupported resource frame: ordered source teams, native multipliers and colony slot-0 HP required");
    const sides = input.teams.map((team) => ({ aiField: team.ai, aiMultiplier: input.aiMultipliers[team.index],
      creditGate: input.buildingSlots[`${team.index},0`] }));
    if (!sides.every((side) => [side.aiField, side.aiMultiplier, side.creditGate].every((value) =>
      Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)))
      throw new Error("Unsupported resource frame: eight explicit full32 AI fields, multipliers and colony slot-0 HP required");
    if (input.orders && (new Set(input.orders.map(({ slot }) => slot)).size !== input.orders.length ||
      !input.orders.every((order) => Number.isInteger(order.slot) && order.slot >= 0 && order.slot < 800 &&
        Number.isSafeInteger(order.generation) && order.generation >= 0 &&
        [order.pendingOrder, order.order].every((value) => Number.isInteger(value) && value >= 0 && value <= 255))))
      throw new Error("Unsupported resource frame: unique slot/generation order bindings and native order bytes required");
    const sourceDayNight = advanceSourceDayNight(current);
    return { ok: true, value: { sourceDayNight, resourceFrame: {
      nativePhaseCounter: sourceDayNight.elapsed, localTeam: input.localTeam, cancellationGate: input.cancellationGate,
      sides,
      ...(input.orders === undefined ? {} : { orders: input.orders.map((order) => ({ ...order })) }),
    } } };
  } catch (error) {
    return { ok: false, diagnostics: [{ code: "invalid-input", message: error instanceof Error ? error.message : String(error) }] };
  }
}