import { consumeLegacyAiGroupOne, consumeLegacyAiGroupTwo, consumeLegacyAiPolicyPipeline,
  initializeLegacyAiPolicy, type LegacyAiActiveState, type LegacyAiDemandInputs,
  type LegacyAiProductionIntent } from "./legacy-ai-active";
import { consumeLegacyAiGroupZero } from "./legacy-ai-group-zero";
import { consumeLegacyAiGroupThree } from "./legacy-ai-group-three";

export type LegacyAiActorOrder =
  | { mode: 5; slot: number; order: number }
  | { mode: 7; slots: number[]; points: { fixedX: number; fixedY: number }[] };

export type LegacyAiPolicyPacket = {
  sequence: number;
  packet: Uint8Array;
  receipt: "pending-owner";
} & ({ kind: "production"; stage: "demand"; intent: LegacyAiProductionIntent }
  | { kind: "actor-order"; stage: 0 | 1 | 2 | 3; orders: LegacyAiActorOrder[] });

export type LegacyAiFullPolicyInputs = LegacyAiDemandInputs & {
  neighbors: Uint8Array;
  groundCells: Uint32Array;
  rngTable: readonly number[];
  initialization: { needed: false } | { needed: true; ruleTable: Uint8Array; policyAddress: number };
  actorTransport: "deferred" | "synchronous";
};

const data = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function decodeLegacyAiActorPacket(packet: Uint8Array): LegacyAiActorOrder[] {
  if (packet.length < 3 || data(packet).getUint16(0, true) !== packet.length || packet.length > 1024) {
    throw new RangeError("AI actor packet requires an unsequenced native length header");
  }
  const words = data(packet), orders: LegacyAiActorOrder[] = [];
  let cursor = 2;
  const requireBytes = (count: number) => {
    if (cursor + count > packet.length) throw new RangeError("Truncated AI actor packet");
  };
  const readSlot = () => {
    requireBytes(2);
    const slot = words.getInt16(cursor, true);
    cursor += 2;
    if (slot < 0 || slot >= 800) throw new RangeError("Invalid AI actor packet slot");
    return slot;
  };
  while (cursor < packet.length) {
    const mode = packet[cursor++];
    if (mode === 0) {
      if (cursor !== packet.length) throw new RangeError("Trailing AI actor packet bytes");
      return orders;
    }
    if (mode === 5) {
      const slot = readSlot();
      requireBytes(1);
      orders.push({ mode, slot, order: packet[cursor++] });
    } else if (mode === 7) {
      requireBytes(3);
      const pointCount = packet[cursor++], slotCount = words.getInt16(cursor, true);
      cursor += 2;
      if (pointCount > 8 || slotCount < 0 || slotCount > 800) throw new RangeError("Invalid AI actor route counts");
      requireBytes(pointCount * 4 + slotCount * 2);
      const points = Array.from({ length: pointCount }, () => {
        const point = { fixedX: words.getUint16(cursor, true), fixedY: words.getUint16(cursor + 2, true) };
        cursor += 4;
        return point;
      });
      orders.push({ mode, points, slots: Array.from({ length: slotCount }, readSlot) });
    } else throw new RangeError(`AI actor decoder does not own native packet mode ${mode}`);
  }
  throw new RangeError("Missing AI actor packet terminator");
}

export function applyLegacyAiActorPacket(entities: Uint8Array, packet: Uint8Array) {
  if (entities.length !== 800 * 220) throw new RangeError("AI actor receipt requires the complete native pool");
  const orders = decodeLegacyAiActorPacket(packet), words = data(entities);
  for (const order of orders) {
    if (order.mode === 5) {
      entities[order.slot * 220 + 0x36] = 1;
      entities[order.slot * 220 + 0x37] = order.order;
    } else {
      for (const slot of order.slots) {
        order.points.forEach((point, index) => {
          words.setUint16(slot * 220 + 0xa6 + index * 4, point.fixedX, true);
          words.setUint16(slot * 220 + 0xa8 + index * 4, point.fixedY, true);
        });
        entities[slot * 220 + 0xc6] = order.points.length;
      }
    }
  }
  return { completedCallback: 0x41defc as const, orders, lifecycleExecuted: false as const };
}

export function computeLegacyAiFullPolicy(state: LegacyAiActiveState, inputs: LegacyAiFullPolicyInputs) {
  if (inputs.actorTransport !== "deferred" && inputs.actorTransport !== "synchronous") {
    throw new RangeError("Full AI policy requires explicit actor transport timing");
  }
  if (inputs.initialization.needed && (!Number.isInteger(inputs.initialization.policyAddress)
    || inputs.initialization.policyAddress <= 0 || inputs.initialization.policyAddress > 0xffffffff)) {
    throw new RangeError("AI initialization requires the owner's native policy allocation address");
  }
  const candidate = { ...state, policy: new Uint8Array(state.policy), entities: new Uint8Array(state.entities) };
  const stagedInputs = { ...inputs, teamBytes: new Uint8Array(inputs.teamBytes) };
  const initialization = inputs.initialization.needed
    ? initializeLegacyAiPolicy(candidate, stagedInputs, inputs.initialization.ruleTable) : null;
  if (inputs.initialization.needed) data(stagedInputs.teamBytes).setUint32(0x28, inputs.initialization.policyAddress, true);
  const pipeline = consumeLegacyAiPolicyPipeline(candidate, stagedInputs);
  const packets: LegacyAiPolicyPacket[] = pipeline.productionRequests.map((intent, sequence) => ({
    sequence, kind: "production", stage: "demand", intent, packet: intent.packet, receipt: "pending-owner",
  }));
  const record = (stage: 0 | 1 | 2 | 3, emitted: readonly Uint8Array[]) => {
    for (const packet of emitted) {
      const orders = decodeLegacyAiActorPacket(packet);
      packets.push({ sequence: packets.length, kind: "actor-order", stage, packet, orders, receipt: "pending-owner" });
      if (inputs.actorTransport === "synchronous") applyLegacyAiActorPacket(candidate.entities, packet);
    }
  };
  const groupZero = consumeLegacyAiGroupZero(candidate, stagedInputs);
  record(0, groupZero.packets);
  const groupOne = consumeLegacyAiGroupOne(candidate, inputs.rngTable);
  record(1, groupOne.packets);
  const groupTwo = consumeLegacyAiGroupTwo(candidate, stagedInputs);
  record(2, groupTwo.packets);
  const groupThree = consumeLegacyAiGroupThree(candidate, stagedInputs);
  record(3, groupThree.packets);
  const groupPackets = (stage: 0 | 1 | 2 | 3) => packets.filter(
    (packet): packet is Extract<LegacyAiPolicyPacket, { kind: "actor-order" }> => packet.kind === "actor-order" && packet.stage === stage);
  return {
    candidate, teamBytes: stagedInputs.teamBytes, initialization, pipeline,
    groups: [{ ...groupZero, group: 0, packets: groupPackets(0) },
      { ...groupOne, group: 1, packets: groupPackets(1) },
      { ...groupTwo, group: 2, packets: groupPackets(2) },
      { ...groupThree, group: 3, packets: groupPackets(3) }] as const,
    packets, completedCallback: 0x44be40 as const, groupOrder: [0, 1, 2, 3] as const,
    rngDraws: groupZero.rngDraws + groupOne.rngDraws + groupTwo.rngDraws + groupThree.rngDraws,
    computationCompleted: true as const, readyWholeCall: true as const,
    admitted: false as const, runtimeReady: false as const, receipts: "pending-owner" as const,
    productionLifecycleExecuted: false as const, actorTransport: inputs.actorTransport,
  };
}