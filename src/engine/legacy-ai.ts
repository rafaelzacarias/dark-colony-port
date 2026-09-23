export const LEGACY_AI_LAYOUT = {
  policyBytes: 0x6c40,
  groupStride: 0x12fc,
  bucketStride: 300,
  accumulator: 0x1e8c,
  bucketEnabled: 0x1e95,
  head: 0x1faa,
  tail: 0x1fac,
  entityStride: 220,
  entitySlots: 800,
  state: 0x2c,
  next: 0xd2,
  previous: 0xd4,
  accumulatorCallback: 0x3168,
  cleanupCallback: 0x3174,
} as const;

export { initializeLegacyAiPolicy, consumeLegacyAiPreparation, consumeLegacyAiAssignment,
  consumeLegacyAiObservation, consumeLegacyAiGroupOne, consumeLegacyAiGroupTwo, consumeLegacyAiDemand, consumeLegacyAiPolicyPipeline,
  evaluateLegacyAiRulePredicate, LEGACY_AI_RULES, LEGACY_AI_DEMAND_CAPS } from "./legacy-ai-active";
export type { LegacyAiPolicyInputs, LegacyAiAssignmentInputs, LegacyAiActiveState,
  LegacyAiDemandInputs, LegacyAiProductionIntent, LegacyAiGroupTwoInputs } from "./legacy-ai-active";
export type { LegacyAiFullPolicyInputs, LegacyAiPolicyPacket, LegacyAiActorOrder } from "./legacy-ai-policy";

export type LegacyAiGroup = 0 | 1 | 2 | 3;

export type LegacyAiPreludeResult = {
  group: LegacyAiGroup;
  accumulator: number;
  removedSlots: number[];
  completedCallbacks: readonly [number, number];
  nextCallback: number;
};

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function consumeLegacyAiGroupPrelude(
  policyBytes: Uint8Array,
  entityBytes: Uint8Array,
  group: LegacyAiGroup,
): LegacyAiPreludeResult {
  const layout = LEGACY_AI_LAYOUT;
  if (!Number.isInteger(group) || group < 0 || group > 3) throw new RangeError("Invalid AI group");
  if (policyBytes.length !== layout.policyBytes || entityBytes.length !== layout.entitySlots * layout.entityStride) {
    throw new RangeError("AI prelude requires the complete native policy and entity buffers");
  }
  if (policyBytes.buffer === entityBytes.buffer
    && policyBytes.byteOffset < entityBytes.byteOffset + entityBytes.byteLength
    && entityBytes.byteOffset < policyBytes.byteOffset + policyBytes.byteLength) {
    throw new RangeError("AI policy and entity buffers must not overlap");
  }
  const policy = view(policyBytes);
  const entities = view(entityBytes);
  const base = group * layout.groupStride;
  const completedCallbacks = [group === 3 ? 0x459f24 : 0x4578a0,
    group === 0 || group === 3 ? 0x44bbdc : 0x44bbec] as const;
  if (policy.getUint32(base + layout.accumulatorCallback, true) !== completedCallbacks[0]
    || policy.getUint32(base + layout.cleanupCallback, true) !== completedCallbacks[1]) {
    throw new RangeError("Unrecognized native AI prelude callbacks");
  }
  const buckets = group === 0 || group === 3 ? [0]
    : Array.from({ length: 16 }, (_, index) => index)
      .filter((bucket) => policy.getUint8(base + bucket * layout.bucketStride + layout.bucketEnabled) !== 0);
  const seen = new Set<number>();
  const lists = buckets.map((bucket) => {
    const listBase = base + bucket * layout.bucketStride;
    const slots: number[] = [];
    let previous = -1;
    let slot = policy.getInt16(listBase + layout.head, true);
    while (slot !== -1) {
      if (slot < 0 || slot >= layout.entitySlots || seen.has(slot)) {
        throw new RangeError("Invalid or cyclic AI member list");
      }
      const offset = slot * layout.entityStride;
      if (entities.getInt16(offset + layout.previous, true) !== previous) {
        throw new RangeError("Inconsistent AI member predecessor");
      }
      if (entities.getUint8(offset + layout.state) === 0) {
        throw new RangeError("Native AI cleanup rejects state-0 members");
      }
      seen.add(slot);
      slots.push(slot);
      previous = slot;
      slot = entities.getInt16(offset + layout.next, true);
    }
    if (policy.getInt16(listBase + layout.tail, true) !== previous) {
      throw new RangeError("Inconsistent AI member tail");
    }
    return { listBase, slots };
  });
  const accumulator = group === 3
    ? (policy.getUint32(base + layout.accumulator, true) + (lists[0].slots.length === 0 ? 1000 : 0)) >>> 0
    : 0;
  policy.setUint32(base + layout.accumulator, accumulator, true);
  const removedSlots: number[] = [];
  for (const { listBase, slots } of lists) {
    for (const slot of slots) {
      const offset = slot * layout.entityStride;
      if (entities.getUint8(offset + layout.state) !== 10) continue;
      const next = entities.getInt16(offset + layout.next, true);
      const previous = entities.getInt16(offset + layout.previous, true);
      if (next === -1) policy.setInt16(listBase + layout.tail, previous, true);
      else entities.setInt16(next * layout.entityStride + layout.previous, previous, true);
      if (previous === -1) policy.setInt16(listBase + layout.head, next, true);
      else entities.setInt16(previous * layout.entityStride + layout.next, next, true);
      entities.setInt16(offset + layout.next, -2, true);
      entities.setInt16(offset + layout.previous, -2, true);
      removedSlots.push(slot);
    }
  }
  return {
    group, accumulator, removedSlots,
    completedCallbacks,
    nextCallback: [0x44b920, 0x4593a8, 0x458b44, 0x44b920][group],
  };
}

export type LegacyAiNavigation = {
  width: number;
  height: number;
  families: Uint8Array;
  nextFamily: Uint8Array;
};

export type LegacyAiOrderState = {
  policy: Uint8Array;
  entities: Uint8Array;
  navigation: LegacyAiNavigation;
  forceOrder: number;
};

export type LegacyAiGroupOrders = {
  completedCallback: 0x463e78;
  packets: Uint8Array[];
  rngDraws: 0;
  admitted: false;
};

export function consumeLegacyAiGroupOrders(state: LegacyAiOrderState, group: 1 | 2): LegacyAiGroupOrders {
  const layout = LEGACY_AI_LAYOUT;
  const { navigation } = state;
  if ((group !== 1 && group !== 2)
    || state.policy.length !== layout.policyBytes
    || state.entities.length !== layout.entitySlots * layout.entityStride
    || !Number.isInteger(state.forceOrder) || state.forceOrder < 0 || state.forceOrder > 255
    || !Number.isInteger(navigation.width) || navigation.width < 1 || navigation.width > 256
    || !Number.isInteger(navigation.height) || navigation.height < 1 || navigation.height > 256
    || navigation.families.length !== navigation.width * navigation.height
    || navigation.nextFamily.length !== 65536) {
    throw new RangeError("Group orders require complete native state and PTH navigation");
  }
  const buffers = [state.policy, state.entities, navigation.families, navigation.nextFamily];
  for (let first = 0; first < buffers.length; first++) {
    for (let second = first + 1; second < buffers.length; second++) {
      const left = buffers[first], right = buffers[second];
      if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + right.byteLength
        && right.byteOffset < left.byteOffset + left.byteLength) {
        throw new RangeError("Native AI state buffers must not overlap");
      }
    }
  }
  const policyBytes = new Uint8Array(state.policy);
  const entityBytes = new Uint8Array(state.entities);
  const policy = view(policyBytes), entities = view(entityBytes);
  const groupBase = group * layout.groupStride;
  if (policy.getUint32(groupBase + 0x3170, true) !== 0x463e78) {
    throw new RangeError("Unrecognized native AI group-order callback");
  }
  const packets: Uint8Array[] = [];
  let forceOrder = state.forceOrder;
  const region = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError("Invalid AI region");
    return value;
  };
  const distance = (origin: number, target: number) => {
    if (origin === 0 || target === 0) return 255;
    let hops = 0;
    while (origin !== target && hops < 256) {
      if (origin === 0) return 255;
      origin = navigation.nextFamily[origin * 256 + target];
      hops++;
    }
    return hops;
  };
  const move = (slots: number[], target: number, mode: 2 | 7) => {
    const packet = new Uint8Array(11 + slots.length * 6);
    const words = view(packet);
    words.setUint16(0, packet.length, true);
    packet[2] = 7;
    packet[3] = 1;
    words.setUint16(4, slots.length, true);
    words.setUint16(6, policyBytes[target * 18 + 2] << 8, true);
    words.setUint16(8, policyBytes[target * 18 + 3] << 8, true);
    slots.forEach((slot, index) => {
      words.setUint16(10 + index * 2, slot, true);
      const command = 10 + slots.length * 2 + index * 4;
      packet[command] = 5;
      words.setUint16(command + 1, slot, true);
      packet[command + 3] = mode;
    });
    packets.push(packet);
  };
  const seen = new Set<number>();
  for (let bucket = 0; bucket < 16; bucket++) {
    const base = groupBase + bucket * layout.bucketStride;
    if (policyBytes[base + layout.bucketEnabled] === 0) continue;
    const forced = forceOrder !== 0;
    forceOrder = 0;
    const target = region(policy.getInt32(base + 0x1e9c, true));
    const slots: number[] = [];
    let previous = -1;
    let slot = policy.getInt16(base + layout.head, true);
    let holdRoute = false;
    while (slot !== -1) {
      if (slot < 0 || slot >= layout.entitySlots || seen.has(slot)) throw new RangeError("Invalid AI member list");
      seen.add(slot);
      slots.push(slot);
      const offset = slot * layout.entityStride;
      if (entities.getInt16(offset + layout.previous, true) !== previous || entityBytes[offset + layout.state] === 0) {
        throw new RangeError("Invalid AI member state or predecessor");
      }
      const tileX = entities.getUint16(offset, true) >>> 8;
      const tileY = entities.getUint16(offset + 4, true) >>> 8;
      if (tileX >= navigation.width || tileY >= navigation.height) throw new RangeError("AI member outside PTH");
      if (entityBytes[offset + 0xcc] === 0) entityBytes[offset + 0xcc] = 2;
      if (entityBytes[offset + 0xcd] === tileX && entityBytes[offset + 0xce] === tileY) {
        if (entityBytes[offset + 0xcf] < 60) entityBytes[offset + 0xcf]++;
      } else {
        entityBytes[offset + 0xcf] = 0;
        entityBytes[offset + 0xcd] = tileX;
        entityBytes[offset + 0xce] = tileY;
      }
      const hops = distance(navigation.families[tileY * navigation.width + tileX], target);
      const type = entityBytes[offset + 6];
      if ((type === 1 || type === 9) && hops < 3 && entityBytes[offset + 0xcf] > 3) {
        const packet = new Uint8Array([7, 0, 5, slot & 255, slot >>> 8, 13, 0]);
        packets.push(packet);
        entityBytes[offset + 0xcf] = 0;
      } else if (hops > 3 || forced) {
        if (entityBytes[offset + 0xcf] < 60 && entityBytes[offset + 0xcc] !== 2) holdRoute = true;
        if (entityBytes[offset + 0x11] !== target) {
          entityBytes[offset + 0x11] = target;
          move([slot], target, entityBytes[offset + 0xcc] === 2 ? 7 : 2);
        }
      } else if (entityBytes[offset + 0xcc] === 2) {
        entityBytes[offset + 0xcc] = 1;
      }
      previous = slot;
      slot = entities.getInt16(offset + layout.next, true);
    }
    if (policy.getInt16(base + layout.tail, true) !== previous) throw new RangeError("Invalid AI member tail");
    if (holdRoute) continue;
    const cursor = policy.getInt16(base + 0x1ea6, true);
    if (cursor < 0 || cursor >= 256) throw new RangeError("Invalid AI route cursor");
    const next = policyBytes[base + 0x1ea8 + cursor];
    if (next !== region(policy.getInt32(base + 0x1ea0, true))) policy.setInt16(base + 0x1ea6, cursor + 1, true);
    policy.setInt32(base + 0x1e9c, next, true);
    const reassigned = slots.filter((member) => {
      const offset = member * layout.entityStride + 0x11;
      if (entityBytes[offset] === next) return false;
      entityBytes[offset] = next;
      return true;
    });
    move(reassigned, next, 7);
  }
  state.policy.set(policyBytes);
  state.entities.set(entityBytes);
  state.forceOrder = forceOrder;
  return { completedCallback: 0x463e78, packets, rngDraws: 0, admitted: false };
}

export type LegacyAiSelectorResult =
  | { kind: "disabled"; rngCursor: number }
  | { kind: "no-action"; rngCursor: number; weight: 0; rngDraws: 1 }
  | { kind: "blocked"; rngCursor: number; requiredAction: 0x44be40; reason: string };

export function consumeLegacyAiInactiveSelector(mode: number, rngCursor: number): LegacyAiSelectorResult {
  if (!Number.isInteger(rngCursor) || rngCursor < 0 || rngCursor > 255) {
    throw new RangeError("Expected native RNG cursor 0..255");
  }
  if (mode === 0) return { kind: "disabled", rngCursor };
  if (mode === 4) return { kind: "no-action", rngCursor: (rngCursor + 1) & 255, weight: 0, rngDraws: 1 };
  if (mode === 3) return {
    kind: "blocked", rngCursor, requiredAction: 0x44be40,
    reason: "Mode 3 still requires group-0/3 consumers, group-1 retarget/release/create and order feedback; demand and complete group-2 emission do not consume a mission tick",
  };
  throw new RangeError("Unverified AI selector");
}