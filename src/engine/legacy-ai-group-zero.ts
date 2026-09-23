import { consumeLegacyAiGroupPrelude, LEGACY_AI_LAYOUT, type LegacyAiOrderState } from "./legacy-ai";

export type LegacyAiGroupZeroState = LegacyAiOrderState & { rngCursor: number };

export type LegacyAiGroupZeroInputs = {
  groundCells: Uint32Array;
  neighbors: Uint8Array;
};

export type LegacyAiGroupZeroEvent = { callback: number } | { packet: Uint8Array };

function data(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function consumeLegacyAiGroupZero(state: LegacyAiGroupZeroState, inputs: LegacyAiGroupZeroInputs) {
  const { width, height, families, nextFamily } = state.navigation;
  if (state.policy.length !== LEGACY_AI_LAYOUT.policyBytes || state.entities.length !== 800 * 220
    || !Number.isInteger(width) || width < 1 || width > 256
    || !Number.isInteger(height) || height < 1 || height > 256
    || families.length !== width * height || nextFamily.length !== 65536
    || !(inputs.groundCells instanceof Uint32Array) || inputs.groundCells.length !== width * height
    || inputs.neighbors.length !== 256 * 32
    || !Number.isInteger(state.rngCursor) || state.rngCursor < 0 || state.rngCursor > 255
    || !Number.isInteger(state.forceOrder) || state.forceOrder < 0 || state.forceOrder > 255) {
    throw new RangeError("Group 0 requires complete native policy, 800 entities, PTH, ground and counted graph");
  }
  const buffers = [state.policy, state.entities, families, nextFamily, inputs.groundCells, inputs.neighbors];
  for (let first = 0; first < buffers.length; first++) {
    for (let second = first + 1; second < buffers.length; second++) {
      const left = buffers[first], right = buffers[second];
      if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + right.byteLength
        && right.byteOffset < left.byteOffset + left.byteLength) throw new RangeError("Overlapping group-0 inputs");
    }
  }
  for (let region = 0; region < 256; region++) {
    if (inputs.neighbors[region * 32] > 31) throw new RangeError("Invalid native adjacency count");
  }
  const policyBytes = new Uint8Array(state.policy), entityBytes = new Uint8Array(state.entities);
  const policy = data(policyBytes), entities = data(entityBytes);
  if (policy.getUint32(0x316c, true) !== 0x44b920 || policy.getUint32(0x3170, true) !== 0x4598b0) {
    throw new RangeError("Unknown group-0 callbacks");
  }
  const prelude = consumeLegacyAiGroupPrelude(policyBytes, entityBytes, 0);
  const events: LegacyAiGroupZeroEvent[] = [...prelude.completedCallbacks, 0x44b920, 0x4598b0]
    .map((callback) => ({ callback }));
  const packets: Uint8Array[] = [];
  const members: number[] = [];
  for (let slot = policy.getInt16(0x1faa, true); slot !== -1; slot = entities.getInt16(slot * 220 + 0xd2, true)) {
    members.push(slot);
  }
  const cell = (offset: number) => {
    const tileX = entities.getUint16(offset, true) >>> 8;
    const tileY = entities.getUint16(offset + 4, true) >>> 8;
    if (tileX >= width || tileY >= height) throw new RangeError("Group-0 entity outside native map");
    return { tileX, tileY, index: tileY * width + tileX };
  };
  const markNeighbors = (region: number, mask: Uint8Array) => {
    const base = region * 32;
    for (let index = inputs.neighbors[base]; index > 0; index--) mask[inputs.neighbors[base + index]] = 1;
  };
  const routeScore = (origin: number, target: number, owner: number) => {
    events.push({ callback: 0x45817c });
    if (origin === 0) return -1;
    const nearby = new Uint8Array(256), expanded = new Uint8Array(256), seen = new Uint8Array(256);
    let current = origin;
    while (true) {
      if (seen[current]) throw new RangeError("Cyclic native group-0 next-family route");
      seen[current] = 1;
      nearby[current] = 1;
      markNeighbors(current, nearby);
      if (current === target) break;
      current = nextFamily[current * 256 + target];
      if (current === 0) return -1;
    }
    expanded.set(nearby);
    for (let region = 1; region < 256; region++) if (nearby[region]) markNeighbors(region, expanded);
    let score = 0;
    for (let region = 0; region < 256; region++) {
      const regionOwner = policy.getInt8(region * 18 + 8);
      if (expanded[region] && regionOwner !== -1 && regionOwner !== owner) {
        score = (score + policy.getUint16(region * 18 + 10, true)) | 0;
      }
    }
    return score;
  };
  const move = (slot: number, fixedX: number, fixedY: number) => {
    const packet = new Uint8Array(17), words = data(packet);
    words.setUint16(0, 17, true);
    packet[2] = 7;
    packet[3] = 1;
    words.setUint16(4, 1, true);
    words.setUint16(6, fixedX, true);
    words.setUint16(8, fixedY, true);
    words.setUint16(10, slot, true);
    packet[12] = 5;
    words.setUint16(13, slot, true);
    packet[15] = 2;
    packets.push(packet);
    events.push({ packet });
  };
  for (const slot of members) {
    const offset = slot * 220;
    const { tileX, tileY, index } = cell(offset);
    if (entityBytes[offset + 0xcd] === tileX && entityBytes[offset + 0xce] === tileY) {
      entityBytes[offset + 0xcf]++;
    } else {
      entityBytes[offset + 0xcf] = 0;
      entityBytes[offset + 0xcd] = tileX;
      entityBytes[offset + 0xce] = tileY;
    }
    const kind = entityBytes[offset + 6];
    if (kind !== 6 && kind !== 14) continue;
    if (entityBytes[offset + 0xcf] > 10) {
      entityBytes[offset + 0x11] = 0;
    } else if (entityBytes[offset + 0x11] !== 0
      && routeScore(families[index], entityBytes[offset + 0x11], entityBytes[offset + 7]) !== 0) {
      const fallback = policy.getInt32(0x319c, true);
      if (fallback < 0 || fallback > 255) throw new RangeError("Invalid group-0 fallback region");
      move(slot, policyBytes[fallback * 18 + 2] << 8, policyBytes[fallback * 18 + 3] << 8);
      entityBytes[offset + 0x11] = 0;
    }
  }
  let selectedMember = -1;
  const assigned = new Uint8Array(256);
  for (const slot of members) {
    const objective = entityBytes[slot * 220 + 0x11];
    if (objective === 0) selectedMember = slot;
    assigned[objective] = 1;
  }
  let selectedResource = -1, selectedRegion = -1, bestRank = 256;
  if (selectedMember !== -1) {
    const offset = selectedMember * 220;
    const origin = families[cell(offset).index], owner = entityBytes[offset + 7];
    for (let slot = 0; slot < 800; slot++) {
      const resource = slot * 220;
      if (entityBytes[resource + 6] !== 40 || entities.getUint16(resource + 0x32, true) === 0
        || entityBytes[resource + 0x2c] === 0 || entityBytes[resource + 0x2c] === 10) continue;
      const index = cell(resource).index;
      if ((inputs.groundCells[index] & 1023) !== 1023) continue;
      const region = families[index], rank = policyBytes[region * 18 + 13];
      if (assigned[region] || rank >= bestRank || routeScore(origin, region, owner) !== 0) continue;
      selectedResource = slot;
      selectedRegion = region;
      bestRank = rank;
    }
    if (selectedResource !== -1) {
      entityBytes[offset + 0x11] = selectedRegion;
      move(selectedMember, entities.getUint16(selectedResource * 220, true), entities.getUint16(selectedResource * 220 + 4, true));
    }
  }
  state.policy.set(policyBytes);
  state.entities.set(entityBytes);
  return {
    completeInvocation: true as const, ready: true as const, fullPolicy: false as const,
    groupsCompleted: 1 as const, nextGroup: 1 as const,
    completedCallbacks: [0x4578a0, 0x44bbdc, 0x44b920, 0x4598b0] as const,
    removedSlots: prelude.removedSlots, selectedMember, selectedResource, selectedRegion,
    packets, events, rngDraws: 0 as const,
  };
}