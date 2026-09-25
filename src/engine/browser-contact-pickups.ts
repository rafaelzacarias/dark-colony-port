import type { CampaignEntity, CampaignWorld } from "./campaign-world";
import type { TransportHostState } from "./transport-host";

/**
 * DC.EXE 4148b0 dispatches actors whose +0xcb byte is 1 or 2 to 4140dc instead of their ordinary update.
 * Every fourth game cycle (game+0x530 & 3) 4140dc scans the 5x5 tiles around the object, x-major then y, ground plane then air,
 * skipping neighbours whose own +0xcb is nonzero.
 * State 1 (SCN sixth field 1): the first team-0 neighbour makes the object team 0 and clears the byte (414203..414226).
 * State 2 (SCN sixth field 2, e.g. FILL/FUEL stores): the first team 0..7 neighbour's team money gains the object's +0xc
 * health dword without the central-building income gate (414283..414296); the object is removed (416308).
 */
export const CONTACT_PICKUP_STATE_OFFSET = 0xcb;
export const CONTACT_JOIN = 1;
export const CONTACT_PICKUP_MONEY = 2;
const RADIUS = 2;

export interface BrowserContactPickup {
  readonly kind: "join" | "money";
  readonly slot: number;
  readonly generation: number;
  readonly key: string;
  readonly unitType: number;
  readonly amount: number;
  readonly collector: { readonly slot: number; readonly generation: number; readonly team: number };
}

function live(bytes: Uint8Array, host: TransportHostState, staticSlots: ReadonlySet<number>, entity: CampaignEntity): boolean {
  const slot = entity.rawSlot;
  if (slot === null) return false;
  const status = bytes[slot * 220 + 0x2c];
  if (status === 0 || status === 10) return false;
  if (staticSlots.has(slot)) return true;
  const record = host.slots[slot];
  return !!record && host.registry[slot] === entity.key && record.task !== "transport" && record.task !== "removal";
}

function tileOf(host: TransportHostState, entity: CampaignEntity): { x: number; y: number } {
  const record = host.slots[entity.rawSlot!];
  return record ? { x: record.position.x >>> 8, y: record.position.y >>> 8 } : { x: entity.tileX, y: entity.tileY };
}

/** Returns this cycle's contact events in native actor order; later objects observe earlier joins and removals. */
export function scanBrowserContactPickups(world: CampaignWorld, host: TransportHostState, staticSlots: readonly number[],
  cycleCounter: number): BrowserContactPickup[] {
  if ((cycleCounter & 3) !== 0) return [];
  const bytes = world.entityBytes;
  if (!bytes) return [];
  const statics = new Set(staticSlots);
  const planes = new Map(host.definitions.map(definition => [definition.unitType, definition.plane]));
  const alive = world.entities.filter(entity => live(bytes, host, statics, entity)).sort((left, right) => left.rawSlot! - right.rawSlot!);
  const state = new Map(alive.map(entity => [entity.rawSlot!, bytes[entity.rawSlot! * 220 + CONTACT_PICKUP_STATE_OFFSET]]));
  if (![...state.values()].some(value => value === CONTACT_JOIN || value === CONTACT_PICKUP_MONEY)) return [];
  const teams = new Map(alive.map(entity => [entity.rawSlot!, entity.team]));
  const removed = new Set<number>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const events: BrowserContactPickup[] = [];
  for (const object of alive) {
    const kind = state.get(object.rawSlot!);
    if (kind !== CONTACT_JOIN && kind !== CONTACT_PICKUP_MONEY) continue;
    const origin = tileOf(host, object);
    let best: { entity: CampaignEntity; order: number } | undefined;
    for (const candidate of alive) {
      const slot = candidate.rawSlot!;
      if (slot === object.rawSlot || removed.has(slot) || state.get(slot) !== 0) continue;
      const team = teams.get(slot)!;
      if (kind === CONTACT_JOIN ? team !== 0 : team < 0 || team >= 8) continue;
      const tile = tileOf(host, candidate);
      const dx = tile.x - origin.x, dy = tile.y - origin.y;
      if (Math.abs(dx) > RADIUS || Math.abs(dy) > RADIUS) continue;
      const plane = statics.has(slot) || planes.get(candidate.unitType) !== "flying" ? 0 : 1;
      const order = ((dx + RADIUS) * (2 * RADIUS + 1) + (dy + RADIUS)) * 2 + plane;
      if (!best || order < best.order || (order === best.order && slot < best.entity.rawSlot!)) best = { entity: candidate, order };
    }
    if (!best) continue;
    const collector = { slot: best.entity.rawSlot!, generation: best.entity.generation, team: teams.get(best.entity.rawSlot!)! };
    state.set(object.rawSlot!, 0);
    if (kind === CONTACT_JOIN) teams.set(object.rawSlot!, 0);
    else removed.add(object.rawSlot!);
    events.push({ kind: kind === CONTACT_JOIN ? "join" : "money", slot: object.rawSlot!, generation: object.generation, key: object.key,
      unitType: object.unitType, amount: kind === CONTACT_JOIN ? 0 : view.getInt32(object.rawSlot! * 220 + 0xc, true), collector });
  }
  return events;
}
