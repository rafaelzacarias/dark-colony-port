import { consumeLegacyAiGroupOrders, consumeLegacyAiGroupPrelude, LEGACY_AI_LAYOUT,
  type LegacyAiOrderState } from "./legacy-ai";

export type LegacyAiPolicyInputs = {
  team: number;
  types: Uint8Array;
  weapons: Uint8Array;
  matrix: readonly (readonly number[])[];
  relations: Uint8Array;
  visibilityMasks: readonly number[];
  occupancy: readonly number[];
};

function data(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function checkState(state: LegacyAiOrderState, inputs: LegacyAiPolicyInputs): void {
  const { width, height, families, nextFamily } = state.navigation;
  if (state.policy.length !== LEGACY_AI_LAYOUT.policyBytes || state.entities.length !== 800 * 220
    || !Number.isInteger(inputs.team) || inputs.team < 0 || inputs.team > 7
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 256 || height > 256 || families.length !== width * height || nextFamily.length !== 65536
    || inputs.occupancy.length !== width * height || inputs.visibilityMasks.length !== 8
    || inputs.relations.length !== 100 || inputs.types.length !== 110 * 280) {
    throw new RangeError("AI policy requires complete source tables, native occupancy and entity pool");
  }
  const buffers = [state.policy, state.entities, families, nextFamily, inputs.types, inputs.weapons, inputs.relations];
  for (let first = 0; first < buffers.length; first++) {
    for (let second = first + 1; second < buffers.length; second++) {
      const left = buffers[first], right = buffers[second];
      if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + right.byteLength
        && right.byteOffset < left.byteOffset + left.byteLength) throw new RangeError("Overlapping AI inputs");
    }
  }
}

function freeCell(state: LegacyAiOrderState, inputs: LegacyAiPolicyInputs, originX: number, originY: number) {
  const { width, height, families } = state.navigation;
  for (let radius = 0; radius < Math.max(width, height); radius++) {
    for (let tileX = originX - radius; tileX <= originX + radius; tileX++) {
      if (tileX < 0 || tileX >= width) continue;
      for (let tileY = originY - radius; tileY <= originY + radius; tileY++) {
        if (tileY < 0 || tileY >= height) continue;
        const index = tileY * width + tileX;
        if (families[index] !== 0 && (inputs.occupancy[index] & 1023) === 1023) return { tileX, tileY };
      }
    }
  }
  throw new RangeError("Native 0x41b4a0 found no free PTH cell");
}

export function initializeLegacyAiPolicy(state: LegacyAiOrderState, inputs: LegacyAiAssignmentInputs,
  ruleTable: Uint8Array) {
  checkState(state, inputs);
  if (inputs.teamBytes.length !== 0xe30 || ruleTable.length !== 216) throw new RangeError("Incomplete AI initialization inputs");
  const bytes = new Uint8Array(state.policy), policy = data(bytes), team = data(inputs.teamBytes);
  const { width, height, families, nextFamily } = state.navigation;
  for (let slot = 1; slot <= 800; slot++) bytes[0x1200 + slot * 4] = 255;
  bytes.fill(0, 0x6c38, 0x6c40);
  bytes[0x6c38 + inputs.team] = 1;
  for (let region = 0; region < 256; region++) {
    bytes[region * 18 + 13] = 255;
    bytes[region * 18 + 18] = 0;
  }
  let originX = team.getInt32(0x2c, true), originY = team.getInt32(0x30, true);
  if (originX === 0 || originY === 0) {
    originX = team.getInt32(0x34, true); originY = team.getInt32(0x38, true);
  }
  const origin = freeCell(state, inputs, originX, originY);
  const distances = new Uint16Array(256).fill(256);
  distances[families[origin.tileY * width + origin.tileX]] = 0;
  while (true) {
    let selected = -1, distance = 256;
    for (let region = 1; region < 255; region++) {
      if (distances[region] < distance) { selected = region; distance = distances[region]; }
    }
    if (selected === -1) break;
    bytes[selected * 18 + 13] = distance;
    distances[selected] = 257;
    for (let target = 1; target < 255; target++) {
      const next = nextFamily[selected * 256 + target];
      if (next !== 0 && distances[next] !== 257 && distances[next] > distance + 1) distances[next] = distance + 1;
    }
  }
  const counts = new Uint16Array(256), sumX = new Uint32Array(256), sumY = new Uint32Array(256);
  for (let tileY = 0; tileY < height; tileY++) {
    for (let tileX = 0; tileX < width; tileX++) {
      const region = families[tileY * width + tileX];
      counts[region]++; sumX[region] += tileX; sumY[region] += tileY;
    }
  }
  for (let region = 1; region < 255; region++) {
    if (counts[region] === 0) continue;
    const centerX = Math.floor(sumX[region] / counts[region]), centerY = Math.floor(sumY[region] / counts[region]);
    let found = false;
    for (let radius = 0; radius < 100 && !found; radius++) {
      for (let tileY = centerY - radius; tileY <= centerY + radius && !found; tileY++) {
        if (tileY < 0 || tileY >= height) continue;
        for (let tileX = centerX - radius; tileX <= centerX + radius; tileX++) {
          if (tileX < 0 || tileX >= width || families[tileY * width + tileX] !== region) continue;
          bytes[region * 18 + 2] = tileX; bytes[region * 18 + 3] = tileY;
          found = true;
          break;
        }
      }
    }
    if (!found) throw new RangeError("Native region center search exhausted");
  }
  const callbacks = [
    [0x4578a0, 0x44b920, 0x4598b0, 0x44bbdc, 0x459d98, 0x459e40],
    [0x4578a0, 0x4593a8, 0x463e78, 0x44bbec, 0x44b6a4, 0x459660],
    [0x4578a0, 0x458b44, 0x463e78, 0x44bbec, 0x44b6a4, 0x458f3c],
    [0x459f24, 0x44b920, 0x459f80, 0x44bbdc, 0x44b6a4, 0x45a724],
  ];
  let target = 1;
  while (target < 255 && bytes[target * 18 + 13] >= 3) target++;
  for (const group of [2, 1, 0, 3]) {
    const base = group * 0x12fc;
    callbacks[group].forEach((callback, index) => policy.setUint32(base + 0x3168 + index * 4, callback, true));
    if (group === 0 || group === 3) bytes.fill(0, base + 0x1e84, base + 0x1e94);
    for (let bucket = 0; bucket < 16; bucket++) {
      const bucketBase = base + bucket * 300;
      bytes[bucketBase + 0x1e95] = bucket === 0 || (group === 2 && bucket === 1) ? 1 : 0;
      if (bytes[bucketBase + 0x1e95] === 0) continue;
      policy.setInt16(bucketBase + 0x1faa, -1, true);
      policy.setInt16(bucketBase + 0x1fac, -1, true);
      if (group === 1 || group === 2) {
        policy.setUint16(bucketBase + 0x1ea6, 0, true);
        policy.setInt32(bucketBase + 0x1e9c, target, true);
        policy.setInt32(bucketBase + 0x1ea0, target, true);
        bytes[bucketBase + 0x1ea8] = target;
        if (group === 2) bytes[bucketBase + 0x1ea4] = 2;
      }
    }
  }
  [192, 1, 1, 2, 4, 2, 4, 2].forEach((value, index) => policy.setInt32(0x6c14 + index * 4, value, true));
  bytes[0] = 1;
  bytes.set(ruleTable, 0x6a94);
  state.policy.set(bytes);
  return { completedCallback: 0x44bd2c as const, nextCallback: 0x457568 as const, admitted: false as const };
}

export function consumeLegacyAiObservation(state: LegacyAiOrderState, inputs: LegacyAiPolicyInputs) {
  checkState(state, inputs);
  const bytes = new Uint8Array(state.policy), policy = data(bytes);
  const entities = data(state.entities), types = data(inputs.types), weapons = data(inputs.weapons);
  const cell = (tileX: number, tileY: number) => {
    if (tileX >= state.navigation.width || tileY >= state.navigation.height) {
      throw new RangeError("Observation outside native map bounds");
    }
    return tileY * state.navigation.width + tileX;
  };
  const visible = (owner: number, tileX: number, tileY: number) =>
    (inputs.occupancy[cell(tileX, tileY)] & inputs.visibilityMasks[owner]) !== 0;
  for (let region = 0; region < 256; region++) {
    const base = region * 18;
    for (const offset of [4, 8, 12]) {
      bytes[base + offset] = 255;
      policy.setUint16(base + offset + 2, 0, true);
    }
    policy.setUint16(base + 16, 0, true);
    bytes[base + 18] &= 254;
    if ((bytes[base + 18] & 4) !== 0) {
      for (let owner = 0; owner < 8; owner++) {
        if (bytes[0x6c38 + owner] !== 0 && visible(inputs.team, bytes[base + 2], bytes[base + 3])) {
          bytes[base + 18] &= 251;
        }
      }
      policy.setUint16(base + 16, 1, true);
    }
  }
  const score = (base: number, offset: number, owner: number, amount: number) => {
    if (amount <= 0) return;
    const previous = policy.getUint16(base + offset + 2, true);
    if (bytes[base + offset] === owner) {
      policy.setUint16(base + offset + 2, previous + amount, true);
    } else {
      if (bytes[base + offset] !== 255) bytes[base + 18] |= 1;
      policy.setUint16(base + offset + 2, Math.abs(previous - amount), true);
      if (amount >= previous) bytes[base + offset] = owner;
    }
  };
  for (let slot = 0; slot < 800; slot++) {
    const offset = slot * 220, memory = 0x1202 + slot * 4;
    const liveOwner = state.entities[offset + 7];
    if (liveOwner >= 8) continue;
    let unitType = state.entities[offset + 6], owner = liveOwner;
    if (unitType >= 110) throw new RangeError("Unknown source unit type");
    let tileX = entities.getUint16(offset, true) >>> 8, tileY = entities.getUint16(offset + 4, true) >>> 8;
    let observed = false;
    for (let observer = 0; observer < 8; observer++) {
      if (bytes[0x6c38 + observer] === 0 || !visible(observer, tileX, tileY)) continue;
      const detectable = types.getInt32(unitType * 280 + 0x68, true) === 0 || owner === observer
        || (state.entities[offset + 0xca] & (1 << observer)) !== 0;
      if (!detectable) continue;
      if (state.entities[offset + 0x2c] === 0) bytes[memory + 2] = 255;
      else observed = true;
    }
    if (observed) {
      if (owner !== inputs.team) bytes.set([tileX, tileY, unitType, owner], memory);
    } else {
      unitType = bytes[memory + 2];
      if (unitType === 255) continue;
      tileX = bytes[memory];
      tileY = bytes[memory + 1];
      if (visible(inputs.team, tileX, tileY)) {
        bytes[memory + 2] = 255;
        continue;
      }
      owner = bytes[memory + 3];
    }
    if (owner > 9 || unitType >= 110) throw new RangeError("Invalid remembered source actor");
    if (inputs.relations[inputs.team * 10 + owner] !== 0 && owner !== inputs.team) continue;
    let region = state.navigation.families[cell(tileX, tileY)];
    if (region === 0) {
      const relocated = freeCell(state, inputs, tileX, tileY);
      region = state.navigation.families[cell(relocated.tileX, relocated.tileY)];
    }
    const base = region * 18, typeOffset = unitType * 280;
    const weapon = types.getInt32(typeOffset + 0x18, true);
    const category = types.getInt32(typeOffset + 0x40, true);
    if (weapon === -1) {
      if (liveOwner !== inputs.team && liveOwner < 8 && category !== 8) {
        policy.setUint16(base + 16, policy.getUint16(base + 16, true) + 1, true);
      }
      continue;
    }
    const bullet = weapons.getInt32(weapon * 72, true);
    const row = inputs.matrix[bullet];
    const divisor = category === 2 ? 50 : inputs.matrix[1]?.[category];
    if (!row || row.length < 3 || !Number.isInteger(divisor) || divisor === 0) {
      throw new RangeError("Missing native MBULLET scoring data");
    }
    const strength = Math.trunc((Math.imul(row[1], 25)) / divisor);
    if (inputs.types[typeOffset + 0x60] !== 0) score(base, 12, owner, strength);
    score(base, 8, owner, strength);
    score(base, 4, owner, row[2]);
  }
  for (let region = 0; region < 256; region++) {
    const base = region * 18;
    const owners = [bytes[base + 4], bytes[base + 8], bytes[base + 12]].filter((owner) => owner !== 255);
    if (new Set(owners).size > 1) bytes[base + 18] |= 1;
  }
  state.policy.set(bytes);
  return { completedCallback: 0x456ad0 as const, rngDraws: 0 as const, packets: [] as Uint8Array[] };
}

export type LegacyAiAssignmentInputs = LegacyAiPolicyInputs & {
  teamBytes: Uint8Array;
  dependencies: Uint8Array;
};

function category(unitType: number): number {
  return unitType < 16 ? unitType % 8 : unitType === 49 || unitType === 50 ? 7
    : unitType === 41 || unitType === 42 ? 1 : 8;
}

export function consumeLegacyAiAssignment(state: LegacyAiOrderState, inputs: LegacyAiAssignmentInputs) {
  checkState(state, inputs);
  if (inputs.teamBytes.length !== 0xe30 || inputs.dependencies.length !== 110 * 52) {
    throw new RangeError("Assignment requires complete source dependencies and team state");
  }
  const policyBytes = new Uint8Array(state.policy), entityBytes = new Uint8Array(state.entities);
  const policy = data(policyBytes), entities = data(entityBytes), types = data(inputs.types);
  const team = data(inputs.teamBytes), dependencies = data(inputs.dependencies);
  const increment = (offset: number) => policy.setUint16(offset, policy.getUint16(offset, true) + 1, true);
  const available = (source: number) => {
    const base = source * 52;
    if (inputs.dependencies[base] === 0 || inputs.teamBytes[0xda4 + source] !== 0
      || dependencies.getInt32(base + 16, true) !== 1) return false;
    const unitType = dependencies.getInt32(base + 20, true);
    if (types.getInt32(unitType * 280 + 4, true) !== team.getInt32(0x20, true)) return false;
    for (let index = 0; index < 5; index++) {
      const prerequisite = dependencies.getInt32(base + 32 + index * 4, true);
      if (prerequisite < 0) break;
      if (prerequisite >= 110) throw new RangeError("Invalid source dependency");
      const record = prerequisite * 52;
      const city = dependencies.getInt32(record + 20, true);
      if (city < 0 || city >= 15) throw new RangeError("Invalid dependency city");
      if (inputs.dependencies[record] === 0 || inputs.teamBytes[0x78 + city] !== 0
        || inputs.teamBytes[0xda4 + prerequisite] !== 0 || dependencies.getInt32(record + 16, true) !== 0
        || dependencies.getInt32(record + 28, true) !== team.getInt32(0x20, true)
        || team.getInt32(0x3c + city * 4, true) === 0
        || dependencies.getInt32(record + 24, true) > team.getInt32(0xc4 + city * 4, true)) return false;
    }
    return true;
  };
  const eligible = (slot: number) => entityBytes[slot * 220 + 7] === inputs.team
    && entities.getInt16(slot * 220 + 0xd2, true) === -2
    && entityBytes[slot * 220 + 0x2c] !== 0 && entityBytes[slot * 220 + 0x2c] !== 10;
  const counts = Array<number>(9).fill(0);
  const quotas = Array.from({ length: 4 }, () => Array<number>(9).fill(0));
  for (let slot = 120; slot < 800; slot++) {
    const unitType = entityBytes[slot * 220 + 6];
    if (eligible(slot) && unitType !== 41 && unitType !== 42) counts[category(unitType)]++;
  }
  quotas[0][6] = counts[6]; counts[6] = 0;
  quotas[1][1] = counts[1]; counts[1] = 0;
  if (available(10) || available(24) || counts[5] > 0) {
    quotas[3][5] = counts[5]; counts[5] = 0;
  } else if (counts[0] > 0 && policy.getUint16(0x6a48, true) * 4
    <= policy.getUint16(0x4450, true) + policy.getUint16(0x574c, true)) {
    quotas[3][0] = counts[0]; counts[0] = 0;
  }
  const ratio = policy.getInt32(0x6c14, true);
  for (let kind = 0; kind < 9; kind++) {
    while (counts[kind]-- > 0) {
      const selected = ratio !== 256 && Math.imul(policy.getUint16(0x4450 + kind * 2, true), ratio)
        <= Math.imul(policy.getUint16(0x574c + kind * 2, true), 256 - ratio) ? 1 : 2;
      quotas[selected][kind]++;
      increment(selected * 0x12fc + 0x3154 + kind * 2);
    }
  }
  const assigned: { slot: number; group: number; bucket: number }[] = [];
  for (let slot = 120; slot < 800; slot++) {
    if (!eligible(slot)) continue;
    const kind = category(entityBytes[slot * 220 + 6]);
    const group = quotas.findIndex((quota) => quota[kind] > 0);
    if (group === -1) continue;
    const groupBase = group * 0x12fc;
    const callback = [0x459e40, 0x459660, 0x458f3c, 0x45a724][group];
    if (policy.getUint32(groupBase + 0x317c, true) !== callback) throw new RangeError("Unknown assignment callback");
    let bucket = 0;
    if (group === 1 || group === 2) {
      bucket = -1;
      let best = 10000, bestTotal = 0;
      for (let candidate = 0; candidate < 16; candidate++) {
        const base = groupBase + candidate * 300;
        if (policyBytes[base + 0x1e95] === 0) continue;
        let weight = policy.getUint16(base + 0x1fae + kind * 2, true);
        weight *= group === 1 ? (candidate === 0 ? 1 : 2)
          : (policyBytes[base + 0x1ea4] === 1 ? 1 : 4) * (candidate + 1);
        let total = 0;
        for (let index = 0; index < 9; index++) total += policy.getUint16(base + 0x1fae + index * 2, true);
        if (weight < best || (weight === best && bucket !== -1 && total < bestTotal)) {
          best = weight; bestTotal = total; bucket = candidate;
        }
      }
      if (bucket === -1) throw new RangeError("Assignment requires an enabled native bucket");
      increment(groupBase + 0x3154 + kind * 2);
      increment(groupBase + bucket * 300 + 0x1fae + kind * 2);
    }
    quotas[group][kind]--;
    const base = groupBase + bucket * 300;
    const head = policy.getInt16(base + 0x1faa, true);
    if (head < -1 || head >= 800 || (head !== -1 && entities.getInt16(head * 220 + 0xd4, true) !== -1)) {
      throw new RangeError("Invalid assignment list head");
    }
    entities.setInt16(slot * 220 + 0xd2, head, true);
    entities.setInt16(slot * 220 + 0xd4, -1, true);
    if (head === -1) policy.setInt16(base + 0x1fac, slot, true);
    else entities.setInt16(head * 220 + 0xd4, slot, true);
    policy.setInt16(base + 0x1faa, slot, true);
    assigned.push({ slot, group, bucket });
  }
  state.policy.set(policyBytes);
  state.entities.set(entityBytes);
  return { completedCallback: 0x457568 as const, assigned, rngDraws: 0 as const, packets: [] as Uint8Array[] };
}

export type LegacyAiActiveState = LegacyAiOrderState & { rngCursor: number };

export type LegacyAiGroupTwoInputs = Pick<LegacyAiPolicyInputs, "team" | "types" | "weapons" | "matrix"> & {
  neighbors: Uint8Array;
};

export function consumeLegacyAiGroupTwo(state: LegacyAiActiveState, inputs: LegacyAiGroupTwoInputs) {
  if (!Number.isInteger(inputs.team) || inputs.team < 0 || inputs.team > 7
    || inputs.types.length !== 110 * 280 || inputs.weapons.length % 72 !== 0
    || inputs.neighbors.length !== 256 * 32 || state.navigation.nextFamily.length !== 65536
    || !Number.isInteger(state.rngCursor) || state.rngCursor < 0 || state.rngCursor > 255) {
    throw new RangeError("Group 2 requires complete native scoring, graph and RNG inputs");
  }
  const buffers = [state.policy, state.entities, state.navigation.families, state.navigation.nextFamily,
    inputs.types, inputs.weapons, inputs.neighbors];
  for (let first = 0; first < buffers.length; first++) {
    for (let second = first + 1; second < buffers.length; second++) {
      const left = buffers[first], right = buffers[second];
      if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + right.byteLength
        && right.byteOffset < left.byteOffset + left.byteLength) throw new RangeError("Overlapping group-2 inputs");
    }
  }
  const staged = { ...state, policy: new Uint8Array(state.policy), entities: new Uint8Array(state.entities) };
  const policy = data(staged.policy), entities = data(staged.entities), types = data(inputs.types), weapons = data(inputs.weapons);
  const groupBase = 2 * 0x12fc;
  if (policy.getUint32(groupBase + 0x316c, true) !== 0x458b44) throw new RangeError("Unknown group-2 decision callback");
  const events: ({ callback: number } | { packet: Uint8Array })[] = [];
  const enter = (callback: number) => { events.push({ callback }); };
  const region = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError("Invalid group-2 region");
    return value;
  };
  const neighbors = Array.from({ length: 256 }, (_, source) => {
    const count = inputs.neighbors[source * 32];
    if (count > 31) throw new RangeError("Invalid native region adjacency count");
    return Array.from(inputs.neighbors.subarray(source * 32 + 1, source * 32 + count + 1)).reverse();
  });
  const route = (origin: number, target: number): number[] => {
    region(origin); region(target);
    const path: number[] = [], seen = new Set<number>();
    while (true) {
      if (seen.has(origin) || path.length === 256) throw new RangeError("Cyclic native group-2 route");
      seen.add(origin); path.push(origin);
      if (origin === target) return path;
      origin = staged.navigation.nextFamily[origin * 256 + target];
      if (origin === 0) throw new RangeError("Unreachable native group-2 route");
    }
  };
  const distance = (origin: number, target: number) => {
    if (origin === 0 || target === 0) return 255;
    let hops = 0;
    while (origin !== target && hops < 256) {
      if (origin === 0) return 255;
      origin = staged.navigation.nextFamily[origin * 256 + target]; hops++;
    }
    return hops;
  };
  const enemyStrength = (source: number) => {
    const owner = policy.getInt8(source * 18 + 8);
    return owner === -1 || owner === inputs.team ? 0 : policy.getUint16(source * 18 + 10, true);
  };
  const threat = (origin: number, target: number, supplied?: readonly number[]) => {
    enter(0x45817c);
    let path: readonly number[];
    if (supplied) {
      const end = supplied.indexOf(target);
      if (end < 0 || end >= 256) throw new RangeError("Unterminated group-2 route");
      path = supplied.slice(0, end + 1);
    } else {
      if (origin === 0) return -1;
      if (distance(origin, target) === 255 && origin !== target) return -1;
      path = route(origin, target);
    }
    const nearby = new Uint8Array(256);
    for (const source of path) {
      nearby[source] = 1;
      for (const adjacent of neighbors[source]) nearby[adjacent] = 1;
    }
    const expanded = new Uint8Array(nearby);
    for (let source = 1; source < 256; source++) {
      if (nearby[source]) for (const adjacent of neighbors[source]) expanded[adjacent] = 1;
    }
    let total = 0;
    for (let source = 0; source < 256; source++) if (expanded[source]) total = (total + enemyStrength(source)) | 0;
    return total;
  };
  const strength = (base: number) => {
    enter(0x458680);
    const counts = Array<number>(9).fill(0);
    let slot = policy.getInt16(base + 0x1faa, true);
    while (slot !== -1) {
      if (staged.entities[slot * 220 + 0xcc] === 1) counts[category(staged.entities[slot * 220 + 6])]++;
      slot = entities.getInt16(slot * 220 + 0xd2, true);
    }
    let total = 0;
    for (let kind = 0; kind < 9; kind++) {
      const weapon = types.getInt32(kind * 280 + 0x18, true);
      if (weapon === -1) continue;
      if (weapon < 0 || weapon * 72 + 4 > inputs.weapons.length) throw new RangeError("Invalid group-2 weapon");
      const bullet = weapons.getInt32(weapon * 72, true), row = inputs.matrix[bullet];
      const divisor = types.getInt32(kind * 280 + 0x40, true) === 2 ? 50
        : inputs.matrix[1]?.[types.getInt32(kind * 280 + 0x40, true)];
      if (!row || !Number.isInteger(row[1]) || !Number.isInteger(divisor) || divisor === 0) {
        throw new RangeError("Missing group-2 native matrix divisor");
      }
      total = (total + Math.trunc(Math.imul(Math.imul(counts[kind], row[1]), 25) / divisor)) | 0;
    }
    return total;
  };
  const alternateRoute = (origin: number, target: number, power: number) => {
    enter(0x457cc0);
    const costs = new Uint16Array(256), distances = new Uint16Array(256).fill(65534);
    const predecessors = new Uint8Array(256), links = new Uint8Array(256);
    for (let source = 0; source < 256; source++) {
      let sum = 0;
      for (const adjacent of neighbors[source]) sum = (sum + enemyStrength(adjacent)) & 65535;
      costs[source] = Math.trunc(sum * 10 / (power || 1)) + 1;
    }
    distances[origin] = costs[origin];
    let head = origin;
    while (head !== 0) {
      let selected = -1, best = 65534, previous = 0, selectedPrevious = 0;
      const seen = new Set<number>();
      for (let source = head; source !== 0; source = links[source]) {
        if (seen.has(source)) throw new RangeError("Cyclic native weighted frontier");
        seen.add(source);
        if (distances[source] !== 65535) {
          if (distances[source] < best) { best = distances[source]; selected = source; selectedPrevious = previous; }
          previous = source;
        }
      }
      if (selected < 0) throw new RangeError("Native weighted route exhausted");
      if (selectedPrevious === 0) head = links[selected];
      else links[selectedPrevious] = links[selected];
      if (selected === target) {
        const path = [target];
        while (path[path.length - 1] !== origin) {
          if (path.length >= 256) throw new RangeError("Invalid native weighted predecessor route");
          path.push(predecessors[path[path.length - 1]]);
        }
        return path.reverse();
      }
      distances[selected] = 65535;
      for (const adjacent of neighbors[selected]) {
        if (distances[adjacent] === 65535 || distances[adjacent] <= best + costs[adjacent]) continue;
        if (distances[adjacent] === 65534) { links[adjacent] = head; head = adjacent; }
        distances[adjacent] = best + costs[adjacent]; predecessors[adjacent] = selected;
      }
    }
    throw new RangeError("Unreachable native weighted route");
  };
  const retarget = (base: number, target: number, path?: readonly number[]) => {
    enter(0x463840);
    const origin = region(policy.getInt32(base + 0x1e9c, true));
    const selected = path ?? route(origin, target);
    const end = selected.indexOf(target);
    if (end < 0 || end >= 256) throw new RangeError("Invalid group-2 target path");
    staged.policy.set(selected.slice(0, end + 1), base + 0x1ea8);
    policy.setUint16(base + 0x1ea6, origin === target ? 0 : 1, true);
    policy.setInt32(base + 0x1ea0, target, true);
  };
  enter(0x4578a0); enter(0x44bbec);
  const prelude = consumeLegacyAiGroupPrelude(staged.policy, staged.entities, 2);
  enter(0x458b44);
  const defensive = new Uint8Array(256), excluded = new Uint8Array(256), fallbackCounts = new Uint8Array(256);
  let rankLimit = 0, enabledBuckets = 0;
  for (let bucket = 0; bucket < 16; bucket++) {
    const base = 0x12fc + bucket * 300;
    if (staged.policy[base + 0x1e95] === 0) continue;
    const target = region(policy.getInt32(base + 0x1ea0, true));
    defensive[target] = bucket === 0 ? 1 : 2;
    rankLimit = Math.max(rankLimit, staged.policy[target * 18 + 13]);
  }
  rankLimit += 3;
  for (let bucket = 0; bucket < 16; bucket++) {
    const base = groupBase + bucket * 300;
    if (staged.policy[base + 0x1e95] === 0) continue;
    enabledBuckets++;
    const mode = staged.policy[base + 0x1ea4];
    if (mode === 0) excluded[bucket] = 1;
    if (mode === 1 || mode === 3) fallbackCounts[bucket]++;
  }
  for (let bucket = 0; bucket < 16; bucket++) {
    const base = groupBase + bucket * 300;
    if (staged.policy[base + 0x1e95] === 0) continue;
    const mode = staged.policy[base + 0x1ea4];
    const origin = region(policy.getInt32(base + 0x1e9c, true)), target = region(policy.getInt32(base + 0x1ea0, true));
    if (mode === 2 || mode === 3) {
      const power = strength(base);
      enter(0x458814);
      let selected = -1, bestScore = 0, selectedPath: number[] = [];
      for (let candidate = 0; candidate < 256; candidate++) {
        if (excluded[candidate]) continue;
        const localThreat = threat(candidate, candidate), offset = candidate * 18;
        let priority = 0;
        if (staged.policy[offset + 13] <= rankLimit && (localThreat !== 0 || (staged.policy[offset + 18] & 1) !== 0)) {
          priority = (staged.policy[offset + 18] & 2) !== 0 ? Math.trunc(rankLimit / 2)
            : rankLimit + 1 - staged.policy[offset + 13];
        }
        if (policy.getUint16(offset + 16, true) > 0) priority += Math.trunc(rankLimit / 2);
        if (priority === 0) continue;
        let danger = threat(origin, candidate) || 1;
        let path: number[] | undefined;
        if (Math.imul(policy.getInt32(0x6c34, true), danger) > power) {
          path = alternateRoute(origin, candidate, power);
          danger = threat(origin, candidate, path) || 1;
          if (danger > power) continue;
        }
        const score = Math.trunc(Math.imul(power, priority) / danger);
        if (score <= bestScore) continue;
        bestScore = score; selected = candidate; selectedPath = path ?? route(origin, candidate);
      }
      if (selected !== -1) {
        excluded[selected] = 1; staged.policy[base + 0x1ea4] = 0;
        retarget(base, selected, selectedPath);
      } else if (mode === 2) {
        staged.policy[base + 0x1ea4] = 3;
        enter(0x4584ec);
        let fallback = -1, fewest = 100, nearest = 256;
        for (let candidate = 0; candidate < 256; candidate++) {
          if (!defensive[candidate]) continue;
          const hops = distance(candidate, origin);
          if (fallbackCounts[candidate] < fewest || (fallbackCounts[candidate] === fewest && hops < nearest)) {
            fallback = candidate; fewest = fallbackCounts[candidate]; nearest = hops;
          }
        }
        if (fallback < 0) throw new RangeError("Native group-2 fallback requires a defensive target");
        retarget(base, fallback); fallbackCounts[fallback]++;
      }
    } else if (mode === 0) {
      const power = strength(base), cursor = policy.getInt16(base + 0x1ea6, true);
      if (cursor < 0 || cursor >= 256) throw new RangeError("Invalid group-2 route cursor");
      const danger = threat(origin, target, Array.from(staged.policy.subarray(base + 0x1ea8 + cursor, base + 0x1fa8)));
      if ((danger === 0 && (staged.policy[bucket * 18 + 18] & 1) === 0
        && policy.getUint16(target * 18 + 16, true) === 0) || (Math.imul(power, 2) <= danger)) {
        staged.policy[base + 0x1ea4] = 2;
      }
    } else if (mode === 1) {
      const divisor = Math.trunc(enabledBuckets * 4 / (bucket + 1));
      if (divisor === 0) throw new RangeError("Native group-2 quota division by zero");
      let underQuota = false;
      for (let kind = 0; kind < 9; kind++) {
        const count = policy.getUint16(base + 0x1fae + kind * 2, true);
        if (count < 3 || Math.trunc(policy.getUint16(groupBase + 0x3154 + kind * 2, true) / divisor) > count) underQuota = true;
      }
      if (!underQuota) staged.policy[base + 0x1ea4] = 2;
    }
  }
  enter(0x463e78);
  const orders = consumeLegacyAiGroupOrders(staged, 2);
  for (const packet of orders.packets) events.push({ packet });
  state.policy.set(staged.policy); state.entities.set(staged.entities); state.forceOrder = staged.forceOrder;
  return { ...orders, prelude, events, enabledBuckets, groupsCompleted: 1 as const,
    completedCallbacks: [0x4578a0, 0x44bbec, 0x458b44, 0x463e78] as const,
    completeInvocation: true as const, nextGroup: 3 as const };
}

export const LEGACY_AI_RULES = [
  [0x4564c8, 0x456550, 8], [0x45642c, 0x456448, 1], [0x4564c8, 0x456550, 0],
  [0x456664, 0x4566ac, 5], [0x4564c8, 0x456550, 1], [0x4564c8, 0x456550, 3],
  [0x456664, 0x4566ac, 10], [0x45642c, 0x456448, 2], [0x456664, 0x4566ac, 15],
  [0x4564c8, 0x456550, 4], [0x4564c8, 0x456550, 2], [0x456664, 0x4566ac, 20],
  [0x4564c8, 0x456550, 7], [0x4564c8, 0x456550, 6], [0x456664, 0x4566ac, 30],
  [0x4564c8, 0x456550, 5], [0x456664, 0x4566ac, 200], [0x456868, 0x456874, 0],
] as const;

export type LegacyAiDemandInputs = LegacyAiAssignmentInputs & {
  population: number;
  populationLimit: number;
  cityDependencies: readonly number[];
};

export const LEGACY_AI_DEMAND_CAPS = Object.freeze({ entitySlots: 800, teamBytes: 0xe30,
  dependencyRecords: 110, productionQueues: 4, queueCapacity: 800, ruleRecords: 18,
  productionReceipt: false, groupDecisions: false });

export type LegacyAiProductionIntent = {
  callback: 0x40c13c | 0x40c168;
  team: number;
  dependency: number;
  cost: number;
  creditsBefore: number;
  creditsAfter: number;
  packet: Uint8Array;
  receipt: "pending-owner";
} & ({ kind: "city"; city: number; level: number } | { kind: "unit"; unitType: number; count: 1 });

function demandAccess(inputs: LegacyAiDemandInputs) {
  if (!Number.isInteger(inputs.team) || inputs.team < 0 || inputs.team > 7
    || inputs.teamBytes.length !== 0xe30 || inputs.dependencies.length !== 110 * 52
    || inputs.types.length !== 110 * 280 || inputs.cityDependencies.length !== 18
    || inputs.cityDependencies.some((source) => !Number.isInteger(source) || source < 0 || source >= 110)
    || ![inputs.population, inputs.populationLimit].every((value) => Number.isInteger(value)
      && value >= -2147483648 && value <= 2147483647)) throw new RangeError("Incomplete native demand inputs");
  const team = data(inputs.teamBytes), dependencies = data(inputs.dependencies), types = data(inputs.types);
  const race = team.getInt32(0x20, true);
  if (race !== 0 && race !== 1) throw new RangeError("Invalid demand race");
  const record = (source: number) => {
    if (!Number.isInteger(source) || source < 0 || source >= 110) throw new RangeError("Invalid demand dependency");
    return source * 52;
  };
  const city = (source: number) => {
    const target = dependencies.getInt32(record(source) + 20, true);
    if (target < 0 || target >= 15) throw new RangeError("Invalid demand city slot");
    return target;
  };
  const busy = (source: number) => inputs.teamBytes[0x78 + city(source)] !== 0;
  const building = (source: number, seen = new Set<number>()): 0 | 1 | 2 => {
    const base = record(source);
    if (inputs.dependencies[base] === 0) return 2;
    const kind = dependencies.getInt32(base + 16, true);
    if ((kind === 0 && busy(source)) || inputs.teamBytes[0xda4 + source] !== 0
      || kind !== 0 || dependencies.getInt32(base + 28, true) !== race) return 2;
    const target = city(source), level = dependencies.getInt32(base + 24, true);
    if (team.getInt32(0x3c + target * 4, true) !== 0 && level <= team.getInt32(0xc4 + target * 4, true)) return 0;
    if (seen.has(source)) throw new RangeError("Cyclic native demand dependencies");
    const nested = new Set(seen).add(source);
    for (let index = 0; index < 5; index++) {
      const prerequisite = dependencies.getInt32(base + 32 + index * 4, true);
      if (prerequisite < 0) break;
      if (prerequisite === source || building(prerequisite, nested) !== 0) return 2;
    }
    return 1;
  };
  const unit = (source: number) => {
    const base = record(source);
    if (inputs.dependencies[base] === 0 || inputs.teamBytes[0xda4 + source] !== 0
      || dependencies.getInt32(base + 16, true) !== 1) return null;
    const unitType = dependencies.getInt32(base + 20, true);
    if (unitType < 0 || unitType >= 110) throw new RangeError("Invalid production unit type");
    if (types.getInt32(unitType * 280 + 4, true) !== race) return null;
    for (let index = 0; index < 5; index++) {
      const prerequisite = dependencies.getInt32(base + 32 + index * 4, true);
      if (prerequisite < 0) break;
      if (building(prerequisite) !== 0) return null;
    }
    return { unitType, cost: dependencies.getInt32(base + 8, true) };
  };
  return { team, dependencies, race, building, busy, unit, city };
}

function checkDemandState(state: LegacyAiOrderState, inputs: LegacyAiDemandInputs): void {
  checkState(state, inputs);
  demandAccess(inputs);
  const buffers = [inputs.teamBytes, inputs.dependencies, state.policy, state.entities, inputs.types,
    inputs.weapons, inputs.relations, state.navigation.families, state.navigation.nextFamily];
  for (let first = 0; first < 2; first++) {
    for (let second = first + 1; second < buffers.length; second++) {
      const left = buffers[first], right = buffers[second];
      if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + right.byteLength
        && right.byteOffset < left.byteOffset + left.byteLength) throw new RangeError("Overlapping demand inputs");
    }
  }
}

export function evaluateLegacyAiRulePredicate(inputs: LegacyAiDemandInputs, counts: readonly number[], rule: number): 0 | 1 {
  if (!Number.isInteger(rule) || rule < 0 || rule >= LEGACY_AI_RULES.length || counts.length !== 9
    || counts.some((value) => !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
    throw new RangeError("Invalid native demand rule or counts");
  }
  const access = demandAccess(inputs), [predicate, , parameter] = LEGACY_AI_RULES[rule];
  if (predicate === 0x45642c) return counts[6] < parameter ? 0 : 1;
  if (predicate === 0x4564c8) {
    const source = inputs.cityDependencies[parameter * 2 + access.race];
    return access.building(source) === 1 || access.busy(source) ? 0 : 1;
  }
  if (predicate === 0x456664) {
    const total = [0, 2, 3, 4, 5].reduce((sum, kind) => (sum + counts[kind]) | 0, 0);
    return inputs.population < inputs.populationLimit && total < parameter ? 0 : 1;
  }
  return 0;
}

function demandRules(state: LegacyAiOrderState, inputs: LegacyAiDemandInputs, counts: readonly number[]) {
  const policy = data(state.policy), access = demandAccess(inputs);
  for (let rule = 0; rule < 18; rule++) {
    for (let field = 0; field < 3; field++) {
      if (policy.getInt32(0x6a94 + rule * 12 + field * 4, true) !== LEGACY_AI_RULES[rule][field]) {
        throw new RangeError("Unrecognized native demand rule table");
      }
    }
  }
  const predicates: { rule: number; callback: number; parameter: number; result: 0 | 1 }[] = [];
  let selected = 0;
  for (; selected < 18; selected++) {
    const result = evaluateLegacyAiRulePredicate(inputs, counts, selected);
    predicates.push({ rule: selected, callback: LEGACY_AI_RULES[selected][0], parameter: LEGACY_AI_RULES[selected][2], result });
    if (result === 0) break;
  }
  const [, action, parameter] = LEGACY_AI_RULES[selected];
  const productionRequests: LegacyAiProductionIntent[] = [];
  const debit = (cost: number) => {
    const creditsBefore = access.team.getInt32(0x14, true), creditsAfter = (creditsBefore - cost) | 0;
    access.team.setInt32(0x14, creditsAfter, true);
    return { creditsBefore, creditsAfter };
  };
  const requestUnit = (source: number, unitType: number, cost: number) => {
    if (access.team.getInt32(0x14, true) < cost) return false;
    productionRequests.push({ kind: "unit", callback: 0x40c168, team: inputs.team, dependency: source,
      unitType, count: 1, cost, ...debit(cost), receipt: "pending-owner",
      packet: Uint8Array.of(7, 0, 10, unitType, inputs.team, 1, 0) });
    return true;
  };
  if (action === 0x456550) {
    const source = inputs.cityDependencies[parameter * 2 + access.race];
    const cost = access.dependencies.getInt32(source * 52 + 8, true);
    if (cost <= access.team.getInt32(0x14, true) && !access.busy(source)) {
      if (access.building(source) !== 1) throw new RangeError("Native city action requires available dependency");
      const city = access.city(source), level = access.dependencies.getInt32(source * 52 + 24, true);
      productionRequests.push({ kind: "city", callback: 0x40c13c, team: inputs.team, dependency: source,
        city, level, cost, ...debit(cost), receipt: "pending-owner",
        packet: Uint8Array.of(7, 0, 9, city, level, inputs.team, 0) });
    }
  } else if (action === 0x456448) {
    for (let source = 0; source < 110; source++) {
      const available = access.unit(source);
      if (available && category(available.unitType) === 6
        && !requestUnit(source, available.unitType, available.cost)) break;
    }
  } else if (action === 0x4566ac) {
    const weights = Array<number>(8).fill(10000);
    [0, 2, 3, 4, 5, 7, 1].forEach((kind, index) => {
      weights[kind] = Math.imul(counts[kind], policy.getInt32(0x6c18 + index * 4, true));
    });
    let bestWeight = 10000, bestSource = -1;
    for (let source = 0; source < 110; source++) {
      const available = access.unit(source);
      if (!available) continue;
      const kind = category(available.unitType);
      if (kind !== 8 && weights[kind] < bestWeight) {
        bestWeight = weights[kind]; bestSource = source;
      }
    }
    if (bestSource !== -1) {
      const available = access.unit(bestSource)!;
      requestUnit(bestSource, available.unitType, available.cost);
    }
  }
  return { selectedRule: selected, actionCallback: action, predicates, productionRequests };
}

export function consumeLegacyAiDemand(state: LegacyAiOrderState, inputs: LegacyAiDemandInputs) {
  checkDemandState(state, inputs);
  const staged = { ...state, policy: new Uint8Array(state.policy), entities: new Uint8Array(state.entities) };
  const stagedInputs = { ...inputs, teamBytes: new Uint8Array(inputs.teamBytes) };
  const assignment = consumeLegacyAiAssignment(staged, stagedInputs);
  const policy = data(staged.policy), entities = data(staged.entities), team = data(stagedInputs.teamBytes);
  const counts = Array<number>(9).fill(0), seen = new Set<number>();
  for (let group = 0; group < 4; group++) {
    const groupBase = group * 0x12fc;
    const expected = group === 0 ? 0x459d98 : 0x44b6a4;
    if (policy.getUint32(groupBase + 0x3178, true) !== expected) throw new RangeError("Unknown demand census callback");
    staged.policy.fill(0, groupBase + 0x3154, groupBase + 0x3166);
    for (let bucket = 0; bucket < (group === 0 ? 1 : 16); bucket++) {
      const base = groupBase + bucket * 300;
      if (group !== 0) {
        staged.policy.fill(0, base + 0x1fae, base + 0x1fc0);
        if (staged.policy[base + 0x1e95] === 0) continue;
      }
      let slot = policy.getInt16(base + 0x1faa, true);
      while (slot !== -1) {
        if (slot < 0 || slot >= 800 || seen.has(slot)) throw new RangeError("Invalid demand member list");
        seen.add(slot);
        const kind = group === 0 ? 6 : category(staged.entities[slot * 220 + 6]);
        const totalOffset = groupBase + 0x3154 + kind * 2;
        policy.setUint16(totalOffset, policy.getUint16(totalOffset, true) + 1, true);
        if (group !== 0) {
          const bucketOffset = base + 0x1fae + kind * 2;
          policy.setUint16(bucketOffset, policy.getUint16(bucketOffset, true) + 1, true);
        }
        slot = entities.getInt16(slot * 220 + 0xd2, true);
      }
    }
    for (let kind = 0; kind < 9; kind++) counts[kind] += policy.getUint16(groupBase + 0x3154 + kind * 2, true);
  }
  for (let queue = 0; queue < 4; queue++) {
    const length = team.getUint16(0x110 + queue * 2, true);
    if (length > 800) throw new RangeError("Native production queue exceeds record capacity");
    for (let index = 0; index < length; index++) counts[category(stagedInputs.teamBytes[0x118 + queue * 800 + index])]++;
  }
  const rules = demandRules(staged, stagedInputs, counts);
  state.policy.set(staged.policy);
  state.entities.set(staged.entities);
  inputs.teamBytes.set(stagedInputs.teamBytes);
  return { assignment, counts, ...rules, completedCallbacks: [0x457940, 0x4578d0] as const,
    rngDraws: 0 as const, nextGroup: 0 as const, admitted: false as const,
    productionLifecycleExecuted: false as const, readyWholeCall: false as const,
    inputCaps: LEGACY_AI_DEMAND_CAPS };
}

export function consumeLegacyAiPolicyPipeline(state: LegacyAiOrderState, inputs: LegacyAiDemandInputs) {
  checkDemandState(state, inputs);
  const staged = { ...state, policy: new Uint8Array(state.policy), entities: new Uint8Array(state.entities) };
  const stagedInputs = { ...inputs, teamBytes: new Uint8Array(inputs.teamBytes) };
  const preparation = consumeLegacyAiPreparation(staged, stagedInputs);
  const demand = consumeLegacyAiDemand(staged, stagedInputs);
  state.policy.set(staged.policy);
  state.entities.set(staged.entities);
  inputs.teamBytes.set(stagedInputs.teamBytes);
  return { ...demand, preparation, remainingGroups: [0, 1, 2, 3] as const };
}

export function consumeLegacyAiPreparation(state: LegacyAiOrderState, inputs: LegacyAiAssignmentInputs) {
  const staged = { ...state, policy: new Uint8Array(state.policy), entities: new Uint8Array(state.entities) };
  const assignment = staged.policy[0] !== 0 ? consumeLegacyAiAssignment(staged, inputs) : null;
  staged.policy[0] = 0;
  const observation = consumeLegacyAiObservation(staged, inputs);
  state.policy.set(staged.policy);
  state.entities.set(staged.entities);
  return { assignment, observation, nextCallback: 0x457940 as const,
    requiredCallbacks: [0x457940, 0x4578d0] as const, admitted: false as const };
}

export function consumeLegacyAiGroupOne(state: LegacyAiActiveState, rngTable: readonly number[]) {
  if (rngTable.length !== 256 || rngTable.some((value) => !Number.isInteger(value)
    || value < -2147483648 || value > 2147483647)
    || !Number.isInteger(state.rngCursor) || state.rngCursor < 0 || state.rngCursor > 255) {
    throw new RangeError("Group 1 requires native policy RNG state");
  }
  const staged = { ...state, policy: new Uint8Array(state.policy), entities: new Uint8Array(state.entities) };
  const policy = data(staged.policy), entities = data(staged.entities);
  if (policy.getUint32(0x12fc + 0x316c, true) !== 0x4593a8) throw new RangeError("Unknown group-1 decision callback");
  const prelude = consumeLegacyAiGroupPrelude(staged.policy, staged.entities, 1);
  const events: ({ callback: number } | { rngCursor: number } | { packet: Uint8Array })[] =
    [...prelude.completedCallbacks, 0x4593a8].map((callback) => ({ callback }));
  let rngDraws = 0;
  const random = () => {
    events.push({ rngCursor: staged.rngCursor });
    staged.rngCursor = (staged.rngCursor + 1) & 255;
    rngDraws++;
    return rngTable[staged.rngCursor];
  };
  const region = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError("Invalid group-1 region");
    return value;
  };
  const retarget = (base: number, target: number) => {
    events.push({ callback: 0x463840 });
    const origin = region(policy.getInt32(base + 0x1e9c, true));
    let current = origin;
    const path: number[] = [], visited = new Set<number>();
    while (true) {
      if (visited.has(current) || path.length === 256) throw new RangeError("Cyclic native group-1 route");
      visited.add(current); path.push(current);
      if (current === target) break;
      current = state.navigation.nextFamily[current * 256 + target];
      region(current);
    }
    staged.policy.set(path, base + 0x1ea8);
    policy.setUint16(base + 0x1ea6, origin === target ? 0 : 1, true);
    policy.setInt32(base + 0x1ea0, target, true);
  };
  if ((random() & 15) === 0) {
    let selected = -1, divisor = 1;
    for (let candidate = 1; candidate < 255; candidate++) {
      if (staged.policy[candidate * 18 + 13] < 2 && random() % divisor === 0) {
        selected = candidate;
        divisor++;
      }
    }
    if (selected === -1) throw new RangeError("Native group-1 retarget has no rank-below-2 candidate");
    retarget(0x12fc, selected);
    staged.forceOrder = 1;
  }
  const regions = new Set<number>(), seen = new Set<number>();
  let slot = policy.getInt16(0x1faa, true);
  while (slot !== -1) {
    if (slot < 0 || slot >= 800 || seen.has(slot)) throw new RangeError("Invalid observation member list");
    seen.add(slot);
    const region = staged.entities[slot * 220 + 0x11];
    if (region !== 0) regions.add(region);
    slot = entities.getInt16(slot * 220 + 0xd2, true);
  }
  for (let index = 0; index < 16; index++) {
    if (staged.policy[0x6a74 + index * 2] !== 0) regions.add(staged.policy[0x6a75 + index * 2]);
  }
  for (let bucket = 1; bucket < 16; bucket++) {
    const base = 0x12fc + bucket * 300;
    if (staged.policy[base + 0x1e95] === 0) continue;
    const target = region(policy.getInt32(base + 0x1ea0, true));
    if (!regions.has(target)) {
      events.push({ callback: 0x464074 });
      staged.policy[base + 0x1e95] = 0;
      let member = policy.getInt16(base + 0x1faa, true);
      while (member !== -1) {
        const offset = member * 220, next = entities.getInt16(offset + 0xd2, true);
        staged.entities[offset + 0xcc] = 0;
        entities.setInt16(offset + 0xd2, -2, true);
        member = next;
      }
    }
    regions.delete(target);
  }
  for (let target = 0; target < 256; target++) {
    if (!regions.has(target)) continue;
    let bucket = 1;
    while (bucket < 16 && staged.policy[0x12fc + bucket * 300 + 0x1e95] !== 0) bucket++;
    if (bucket === 16) continue;
    events.push({ callback: 0x463eec });
    const base = 0x12fc + bucket * 300;
    let origin = 1;
    while (origin < 255 && staged.policy[origin * 18 + 13] >= 3) origin++;
    policy.setUint16(base + 0x1ea6, 0, true);
    staged.policy[base + 0x1e95] = 1;
    policy.setInt16(base + 0x1faa, -1, true);
    policy.setInt16(base + 0x1fac, -1, true);
    policy.setInt32(base + 0x1e9c, origin, true);
    policy.setInt32(base + 0x1ea0, origin, true);
    staged.policy[base + 0x1ea8] = origin;
    events.push({ callback: 0x44b864 });
    retarget(base, target);
  }
  events.push({ callback: 0x463e78 });
  const orders = consumeLegacyAiGroupOrders(staged, 1);
  events.push(...orders.packets.map((packet) => ({ packet })));
  state.policy.set(staged.policy);
  state.entities.set(staged.entities);
  state.rngCursor = staged.rngCursor;
  state.forceOrder = staged.forceOrder;
  return { ...orders, prelude, completedCallbacks: [0x4578a0, 0x44bbec, 0x4593a8, 0x463e78] as const,
    rngDraws, events, completeInvocation: true as const, nextGroup: 2 as const };
}