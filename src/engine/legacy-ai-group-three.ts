import { consumeLegacyAiGroupPrelude, LEGACY_AI_LAYOUT, type LegacyAiOrderState } from "./legacy-ai";

export type LegacyAiGroupThreeState = LegacyAiOrderState & { rngCursor: number };
export type LegacyAiGroupThreeInputs = {
  team: number;
  neighbors: Uint8Array;
  rngTable: readonly number[];
};
export type LegacyAiGroupThreeEvent = { callback: number } | { rngCursor: number } | { packet: Uint8Array };

const callbacks = [0x459f24, 0x44bbdc, 0x44b920, 0x459f80] as const;
const groupBase = 3 * LEGACY_AI_LAYOUT.groupStride;
const data = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function consumeLegacyAiGroupThree(state: LegacyAiGroupThreeState, inputs: LegacyAiGroupThreeInputs) {
  const { width, height, families, nextFamily } = state.navigation;
  if (state.policy.length !== 0x6c40 || state.entities.length !== 800 * 220
    || !Number.isInteger(inputs.team) || inputs.team < 0 || inputs.team > 7
    || !Number.isInteger(width) || width < 1 || width > 256
    || !Number.isInteger(height) || height < 6 || height > 256
    || families.length !== width * height || nextFamily.length !== 65536
    || inputs.neighbors.length !== 8192 || inputs.rngTable.length !== 256
    || inputs.rngTable.some((value) => !Number.isInteger(value) || value < -2147483648 || value > 2147483647)
    || !Number.isInteger(state.rngCursor) || state.rngCursor < 0 || state.rngCursor > 255
    || !Number.isInteger(state.forceOrder) || state.forceOrder < 0 || state.forceOrder > 255) {
    throw new RangeError("Group 3 requires complete native buffers, navigation and RNG state");
  }
  const buffers = [state.policy, state.entities, families, nextFamily, inputs.neighbors];
  for (let first = 0; first < buffers.length; first++) {
    for (let second = first + 1; second < buffers.length; second++) {
      const left = buffers[first], right = buffers[second];
      if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + right.byteLength
        && right.byteOffset < left.byteOffset + left.byteLength) throw new RangeError("Overlapping group-3 buffers");
    }
  }
  for (let region = 0; region < 256; region++) {
    if (inputs.neighbors[region * 32] > 31) throw new RangeError("Invalid native neighbor count");
  }
  const policyBytes = new Uint8Array(state.policy), entityBytes = new Uint8Array(state.entities);
  const policy = data(policyBytes), entities = data(entityBytes);
  if (policy.getUint32(groupBase + 0x316c, true) !== 0x44b920
    || policy.getUint32(groupBase + 0x3170, true) !== 0x459f80
    || policy.getUint32(groupBase + 0x3178, true) !== 0x44b6a4
    || policy.getUint32(groupBase + 0x317c, true) !== 0x45a724) {
    throw new RangeError("Unrecognized native group-3 callbacks");
  }
  const prelude = consumeLegacyAiGroupPrelude(policyBytes, entityBytes, 3);
  const events: LegacyAiGroupThreeEvent[] = callbacks.map((callback) => ({ callback }));
  const packets: Uint8Array[] = [];
  let rngCursor = state.rngCursor, rngDraws = 0, membersVisited = 0;
  const random = () => {
    events.push({ rngCursor });
    rngCursor = (rngCursor + 1) & 255;
    rngDraws++;
    return inputs.rngTable[rngCursor];
  };
  const family = (tileX: number, tileY: number) => {
    if (tileX < 0 || tileY < 0 || tileX >= width || tileY >= height) {
      throw new RangeError("Group-3 native PTH access outside map");
    }
    return families[tileY * width + tileX];
  };
  const neighbors = (region: number) => Array.from({ length: inputs.neighbors[region * 32] },
    (_, index) => inputs.neighbors[region * 32 + inputs.neighbors[region * 32] - index]);
  const hostile = (owner: number) => owner !== inputs.team && owner !== -1;
  const randomTile = (): [number, number] => {
    const seen = new Set<number>();
    while (true) {
      if (seen.has(rngCursor)) throw new RangeError("Native group-3 random tile search does not terminate");
      seen.add(rngCursor);
      const tileX = (random() % width) & 65535, tileY = (random() % (height - 5)) & 65535;
      if (family(tileX, tileY) !== 0) return [tileX, tileY];
    }
  };
  let slot = policy.getInt16(groupBase + 0x1faa, true);
  while (slot !== -1) {
    const offset = slot * 220;
    membersVisited++;
    const mode = entityBytes[offset + 0xcc], task = entityBytes[offset + 0x39];
    let decide = false;
    if (mode === 0 || mode === 4) decide = task === 1;
    else if (mode === 5) {
      if (task === 1) entityBytes[offset + 0xcc] = 6;
    } else {
      const tileY = entities.getUint16(offset + 4, true) >>> 8;
      family(tileY, tileY);
      if (mode !== 6) throw new RangeError("Native group-3 diagnostic: expected actor mode 6");
      decide = (random() & 63) === 0 || entityBytes[offset + 0xc9] !== 0;
    }
    entityBytes[offset + 0xc9] = 0;
    if (decide) {
      let target: [number, number] | undefined;
      if ((random() & 1) === 0) {
        let bestRegion = 0, bestScore = 0;
        for (let region = 1; region < 256; region++) {
          const ring = new Set([region, ...neighbors(region)]);
          let excluded = false;
          for (const near of ring) {
            if (neighbors(near).some((far) => hostile(policy.getInt8(far * 18 + 4)))) {
              excluded = true;
              break;
            }
          }
          if (excluded) continue;
          const base = region * 18;
          let score = hostile(policy.getInt8(base + 8)) ? policy.getUint16(base + 10, true) : 0;
          if (hostile(policy.getInt8(base + 12))) score -= policy.getUint16(base + 14, true);
          if (policy.getUint16(base + 16, true) !== 0) score++;
          if (score > bestScore) { bestRegion = region; bestScore = score; }
        }
        if (bestScore !== 0) {
          target = [policyBytes[bestRegion * 18 + 2], policyBytes[bestRegion * 18 + 3]];
          entityBytes[offset + 0xcc] = 5;
        }
      }
      if (!target) {
        if ((random() & 3) !== 0) {
          target = randomTile();
          entityBytes[offset + 0xcc] = 4;
        } else {
          let resourceCount = 0, tileX = -1, tileY = -1;
          for (let candidate = 0; candidate < 800; candidate++) {
            const candidateOffset = candidate * 220;
            if (entityBytes[candidateOffset + 6] !== 40 || entityBytes[candidateOffset + 0x2c] === 0
              || entityBytes[candidateOffset + 0x2c] === 10) continue;
            resourceCount++;
            if (Math.trunc(256 / resourceCount) > (random() & 255)) {
              tileX = entities.getUint16(candidateOffset, true) >>> 8;
              tileY = entities.getUint16(candidateOffset + 4, true) >>> 8;
            }
          }
          if (resourceCount === 0) target = randomTile();
          else {
            if (tileX === -1) throw new RangeError("Native group-3 resource reservoir diagnostic");
            target = [tileX, tileY];
            entityBytes[offset + 0xcc] = 4;
            const seen = new Set<string>();
            while (true) {
              const region = family(tileX, tileY);
              if (region === 0) break;
              let danger = 0;
              for (const near of [region, ...neighbors(region)]) {
                const owner = policy.getInt8(near * 18 + 12);
                if (hostile(owner)) danger += owner;
              }
              if (danger === 0) { target = [tileX, tileY]; break; }
              const key = `${tileX},${tileY},${rngCursor}`;
              if (seen.has(key)) throw new RangeError("Native group-3 resource displacement does not terminate");
              seen.add(key);
              tileX = Math.max(0, Math.min(width - 1, tileX + (random() & 15) - 8));
              tileY = Math.max(0, Math.min(height - 1, tileY + (random() & 15) - 8));
            }
          }
        }
      }
      const packet = new Uint8Array(17), words = data(packet);
      words.setUint16(0, 17, true);
      packet[2] = 7; packet[3] = 1;
      words.setUint16(4, 1, true);
      words.setUint16(6, target[0] << 8, true);
      words.setUint16(8, target[1] << 8, true);
      words.setUint16(10, slot, true);
      packet[12] = 5;
      words.setUint16(13, slot, true);
      packet[15] = entityBytes[offset + 6] === 5 || entityBytes[offset + 6] === 13 ? 2 : 7;
      packets.push(packet);
      events.push({ callback: 0x40c414 }, { packet });
    }
    slot = entities.getInt16(offset + 0xd2, true);
  }
  state.policy.set(policyBytes);
  state.entities.set(entityBytes);
  state.rngCursor = rngCursor;
  return { completeInvocation: true as const, groupsCompleted: 1 as const, nextGroup: null,
    admitted: false as const, completedCallbacks: callbacks, prelude, membersVisited, rngDraws, packets, events };
}