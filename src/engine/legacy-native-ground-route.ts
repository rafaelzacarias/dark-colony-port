import { legacyHarvesterMotionTables } from "./legacy-harvester-movement";
import { sha256Hex as digest } from "../sha256";

export interface LegacyNativeGroundRouteTables {
  readonly costs: readonly number[];
  readonly directions: readonly number[];
}

export interface LegacyNativeGroundRouteState {
  readonly address: number;
  readonly bytes: Uint8Array;
  readonly stamp: number;
  readonly familyMask: Uint8Array;
  readonly neighbors: readonly number[];
  readonly dynamic?: boolean;
  readonly air?: boolean;
}

export interface LegacyNativeGroundRouteWorld {
  readonly width: number;
  readonly height: number;
  readonly families: Uint8Array;
  readonly nextFamily: Uint8Array;
  readonly ground: readonly number[];
  readonly dynamic: boolean;
  readonly occupiedLocal?: boolean;
  readonly tables: LegacyNativeGroundRouteTables;
}

export interface LegacyNativeGroundRouteWrite {
  readonly address: number;
  readonly size: number;
  readonly value: number;
}

const dataView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function requireRoute(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(message);
}
const integer = (value: number, maximum: number) => Number.isInteger(value) && value >= 0 && value <= maximum;
const nodeOffset = (column: number, row: number) => 4 + ((row + 1) * 162 + column + 1) * 24;

export function searchLegacyNativeGroundRoute(world: LegacyNativeGroundRouteWorld, current: LegacyNativeGroundRouteState,
  origin: readonly [number, number], destination: readonly [number, number]) {
  requireRoute(integer(world.width, 160) && world.width > 0 && integer(world.height, 140) && world.height > 0
    && world.families.length === world.width * world.height && world.nextFamily.length === 65536
    && world.ground.length === world.families.length, "Invalid native ground-route world");
  requireRoute(current.bytes.length === 0x990ac && current.familyMask.length === 256 && current.neighbors.length === 9
    && integer(current.stamp, 0xfffffffd) && integer(current.address, 0xffffffff)
    && world.tables.costs.length === 81 && world.tables.directions.length === 9, "Invalid native ground-route scratch");
  for (const [column, row] of [origin, destination]) requireRoute(integer(column, world.width - 1)
    && integer(row, world.height - 1), "Native route endpoint outside source grid");
  const bytes = Uint8Array.from(current.bytes), memory = dataView(bytes);
  const familyMask = new Uint8Array(256), neighbors = [...current.neighbors];
  const writes: LegacyNativeGroundRouteWrite[] = [];
  let stamp = current.stamp;
  const put = (offset: number, value: number, size = 4) => {
    requireRoute(offset >= 0 && offset + size <= bytes.length, "Native route scratch overflow");
    if (size === 1) bytes[offset] = value; else memory.setUint32(offset, value >>> 0, true);
    writes.push({ address: current.address + offset, size, value: size === 1 ? value & 255 : value >>> 0 });
  };
  const word = (offset: number) => memory.getUint32(offset, true);
  const global = (address: number, value: number, size = 4) => writes.push({ address, size, value: value >>> 0 });
  const pointerOffset = (pointer: number) => {
    const offset = pointer - current.address;
    requireRoute(offset >= 0 && offset + 24 <= 0x86ca4, "Invalid native route queue link");
    return offset;
  };
  for (let row = 0; row < world.height; row++) for (let column = 0; column < world.width; column++) {
    const offset = nodeOffset(column, row);
    requireRoute(bytes[offset + 8] === column && bytes[offset + 9] === row
      && bytes[offset + 12] === world.families[row * world.width + column], "Native path scratch differs from source PTH");
  }
  requireRoute(bytes.subarray(0x870a4, 0x970a4).every((value, index) => value === world.nextFamily[index]),
    "Native directional prefix differs from source PTH");
  if (world.occupiedLocal) {
    requireRoute(world.dynamic && !current.air, "Unowned native local air search");
    stamp++; global(0x47a980, stamp);
    familyMask.fill(255);
    for (let offset = 0; offset < 256; offset += 4) global(0x4fe65c + offset, 0xffffffff);
    familyMask[0] = 0; global(0x4fe65c, 0, 1);
    familyMask[255] = 0; global(0x4fe75b, 0, 1);
  } else {
  for (let offset = 0; offset < 256; offset += 4) global(0x4fe65c + offset, 0);
  let family = world.families[origin[1] * world.width + origin[0]];
  const targetFamily = world.families[destination[1] * world.width + destination[0]];
  requireRoute(family > 0 && family < 255 && targetFamily > 0 && targetFamily < 255, "Unsupported native endpoint family");
  for (let step = 0; ; step++) {
    requireRoute(step < 256 && !familyMask[family], "Invalid native family route");
    familyMask[family] = 1; global(0x4fe65c + family, 1, 1);
    if (family === targetFamily) break;
    family = world.nextFamily[family * 256 + targetFamily];
    requireRoute(family > 0 && family < 255, "Disconnected native family route");
  }
  stamp++; global(0x47a980, stamp);
  }
  for (let bucket = 0; bucket < 256; bucket++) put(0x86ca4 + bucket * 4, 0);
  put(0x990a8, 0); put(0x990a4, 0);
  const start = nodeOffset(...origin);
  put(start, stamp); put(start + 4, 0); put(start + 16, 0);
  put(start + 10, origin[0], 1); put(start + 11, origin[1], 1);
  const expand = (column: number, row: number, cost: number) => {
    const node = nodeOffset(column, row);
    const sector = Math.sign(destination[0] - column) + 1 + (Math.sign(destination[1] - row) + 1) * 3;
    for (const neighbor of [0, 1, 2, 3, 5, 6, 7, 8]) {
      const nextColumn = column + neighbor % 3 - 1, nextRow = row + Math.floor(neighbor / 3) - 1;
      neighbors[neighbor] = familyMask[bytes[nodeOffset(nextColumn, nextRow) + 12]];
      global(0x4fe75c + neighbor * 4, neighbors[neighbor]);
    }
    if (world.dynamic) for (const neighbor of [0, 3, 6, 2, 5, 8, 1, 7]) {
      const nextColumn = column + neighbor % 3 - 1, nextRow = row + Math.floor(neighbor / 3) - 1;
      if (nextColumn >= 0 && nextColumn < world.width && nextRow >= 0 && nextRow < world.height
        && (world.ground[nextRow * world.width + nextColumn] & 1023) !== 1023) {
        neighbors[neighbor] = 0; global(0x4fe75c + neighbor * 4, 0);
      }
    }
    const insert = (neighbor: number, costIndex = neighbor) => {
      const nextColumn = column + neighbor % 3 - 1, nextRow = row + Math.floor(neighbor / 3) - 1;
      requireRoute(nextColumn >= 0 && nextColumn < world.width && nextRow >= 0 && nextRow < world.height,
        "Unsupported native border expansion");
      const next = nodeOffset(nextColumn, nextRow), nextCost = cost + world.tables.costs[sector * 9 + costIndex];
      if (word(next) !== stamp) {
        put(next + 16, 0); put(next + 4, 0xffffffff); put(next + 13, 0, 1); put(next, stamp);
      } else {
        const previousCost = memory.getInt32(next + 4, true);
        if (previousCost === 0 || previousCost !== -1 && previousCost - bytes[next + 13] < nextCost) return;
        if (previousCost !== -1) {
          const previous = word(next + 20), following = word(next + 16);
          if (previous) put(pointerOffset(previous) + 16, following);
          else put(0x86ca4 + ((previousCost - word(0x990a8) + word(0x990a4)) & 255) * 4, following);
          if (following) put(pointerOffset(following) + 20, previous);
        }
      }
      const bucket = 0x86ca4 + ((nextCost - word(0x990a8) + word(0x990a4)) & 255) * 4;
      put(next + 16, word(bucket)); put(bucket, current.address + next);
      put(next + 11, row, 1); put(next + 4, nextCost); put(next + 10, column, 1);
      const following = word(next + 16);
      if (following) put(pointerOffset(following) + 20, current.address + next);
      put(next + 20, 0);
    };
    if (neighbors[5]) insert(5);
    if (neighbors[8] && (neighbors[5] || neighbors[7])) insert(8);
    if (neighbors[2] && (neighbors[5] || neighbors[1])) insert(2);
    if (neighbors[3]) insert(3);
    if (neighbors[0] && (neighbors[3] || neighbors[1])) insert(0);
    if (neighbors[6] && (neighbors[3] || neighbors[7])) insert(6, neighbors[3] ? 6 : 1);
    if (neighbors[7]) insert(7);
    if (neighbors[1]) insert(1);
    put(node + 4, 0); global(0x47a980, stamp);
  };
  expand(...origin, 0);
  let expansions = 1, found = false;
  const expansionLimit = world.occupiedLocal ? 257 : world.width * world.height;
  for (; world.occupiedLocal ? expansions < expansionLimit : expansions <= expansionLimit; ) {
    const firstBucket = word(0x990a4);
    let bucket = firstBucket;
    while (!word(0x86ca4 + bucket * 4)) {
      bucket = (bucket + 1) & 255;
      put(0x990a4, bucket); put(0x990a8, word(0x990a8) + 1);
      if (bucket === firstBucket) break;
    }
    const pointer = word(0x86ca4 + bucket * 4);
    if (!pointer) break;
    const node = pointerOffset(pointer), column = bytes[node + 8], row = bytes[node + 9];
    expand(column, row, word(node + 4)); expansions++;
    const following = word(node + 16);
    if (following) put(pointerOffset(following) + 20, 0);
    put(0x86ca4 + bucket * 4, following);
    if (column === destination[0] && row === destination[1]) { found = true; break; }
  }
  requireRoute(world.occupiedLocal || expansions <= expansionLimit, "Native route expansion budget exceeded");
  return { state: { ...current, bytes, stamp, familyMask, neighbors }, writes, found, expansions };
}

export function distanceLegacyNativeGroundRoute(current: LegacyNativeGroundRouteState,
  tables: LegacyNativeGroundRouteTables, destination: readonly [number, number]): number {
  const memory = dataView(current.bytes);
  let [column, row] = destination;
  for (let distance = 0; distance <= 22400; distance++) {
    const node = nodeOffset(column, row);
    if (memory.getUint32(node, true) !== current.stamp) return 0x8000;
    const previousColumn = current.bytes[node + 10], previousRow = current.bytes[node + 11];
    const direction = tables.directions[(previousRow + 1 - row) * 3 + previousColumn + 1 - column];
    if (direction === -1) return distance;
    requireRoute(integer(direction, 7), "Invalid native route predecessor");
    column = previousColumn; row = previousRow;
  }
  throw new RangeError("Native route predecessor cycle");
}

export function serializeLegacyNativeGroundRoute(current: LegacyNativeGroundRouteState,
  tables: LegacyNativeGroundRouteTables, destination: readonly [number, number], output: Uint8Array,
  outputAddress: number, start: number, count: number) {
  requireRoute(integer(start, output.length * 2) && integer(count, output.length * 2 - start), "Invalid native route output span");
  const bytes = Uint8Array.from(current.bytes), memory = dataView(bytes), packed = Uint8Array.from(output);
  const writes: LegacyNativeGroundRouteWrite[] = [];
  let [column, row] = destination, cursor = start + count - 1;
  for (let step = 0; step <= start + count; step++) {
    const node = nodeOffset(column, row);
    if (memory.getUint32(node, true) !== current.stamp) return { state: { ...current, bytes }, packed, writes, count: 0x8000 };
    memory.setUint32(node, current.stamp + 1, true);
    writes.push({ address: current.address + node, size: 4, value: current.stamp + 1 });
    const previousColumn = bytes[node + 10], previousRow = bytes[node + 11];
    const direction = tables.directions[(previousRow + 1 - row) * 3 + previousColumn + 1 - column];
    if (direction === -1 || cursor === -1) {
      writes.push({ address: 0x47a980, size: 4, value: current.stamp + 1 });
      return { state: { ...current, bytes, stamp: current.stamp + 1 }, packed, writes, count };
    }
    requireRoute(integer(direction, 7), "Invalid native route serialization predecessor");
    const offset = Math.trunc(cursor / 2), shift = (cursor & 1) * 4;
    packed[offset] &= shift ? 15 : 240;
    writes.push({ address: outputAddress + offset, size: 1, value: packed[offset] });
    packed[offset] |= direction << shift;
    writes.push({ address: outputAddress + offset, size: 1, value: packed[offset] });
    cursor--; column = previousColumn; row = previousRow;
  }
  throw new RangeError("Native route serialization budget exceeded");
}

const missionHashes = {
  HUMAN02: { map: "ea7377f73ad1d02974d8b2c04d929d3805f591a12b870254a8d466b65685f3c5",
    pth: "623c4e65f710527bc27f02f99644eb13828a3f4aaf533a1fd4f4accc8d3ba2df" },
  ALIEN02: { map: "d5ab938493b41614ef12f2640b152970e5aad8668a15e4709d6db3df80c18bae",
    pth: "1e6633ca04693915fb2187d06fa16f4a52c973c5eb6617e73afd7797a0850155" },
};
export interface LegacyNativeGroundRouteSource {
  readonly scope: "source-native-ground-route";
  readonly mission: keyof typeof missionHashes;
  readonly width: number;
  readonly height: number;
}
const sources = new WeakMap<LegacyNativeGroundRouteSource, Omit<LegacyNativeGroundRouteWorld, "ground" | "dynamic">>();
const sourceRandom = new WeakMap<LegacyNativeGroundRouteSource, readonly number[]>();
export function isLegacyNativeGroundRouteSource(source: LegacyNativeGroundRouteSource): boolean {
  return sources.has(source);
}
export async function createLegacyNativeGroundRouteSource(input: {
  readonly executable: Uint8Array; readonly map: Uint8Array; readonly pth: Uint8Array;
  readonly mission: keyof typeof missionHashes;
}): Promise<LegacyNativeGroundRouteSource> {
  const executable = Uint8Array.from(input.executable), map = Uint8Array.from(input.map), pth = Uint8Array.from(input.pth);
  const mission = input.mission;
  requireRoute(await digest(executable) === "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
    "Unauthenticated native ground-route executable");
  requireRoute(missionHashes[mission] && await digest(map) === missionHashes[mission].map
    && await digest(pth) === missionHashes[mission].pth, "Unauthenticated native ground-route MAP/PTH");
  const header = dataView(map), width = header.getUint32(0, true), height = header.getUint32(4, true);
  requireRoute(width <= 160 && height <= 140 && map.length === 8 + width * height * 6 && pth.length === 65536 + width * height,
    "Invalid original native route dimensions");
  const image = dataView(executable), pe = image.getUint32(0x3c, true), sections = pe + 24 + image.getUint16(pe + 20, true);
  const word = (address: number) => {
    for (let index = 0; index < image.getUint16(pe + 6, true); index++) {
      const section = sections + index * 40, base = 0x400000 + image.getUint32(section + 12, true);
      if (address >= base && address + 4 <= base + image.getUint32(section + 16, true))
        return image.getInt32(image.getUint32(section + 20, true) + address - base, true);
    }
    throw new RangeError("Unmapped native ground-route table");
  };
  const source = Object.freeze({ scope: "source-native-ground-route" as const, mission, width, height });
  sources.set(source, { width, height, families: pth.slice(65536), nextFamily: pth.slice(0, 65536),
    tables: { costs: Array.from({ length: 81 }, (_, index) => word(0x47a9b4 + index * 4)),
      directions: Array.from({ length: 9 }, (_, index) => word(0x47a984 + index * 4)) } });
  sourceRandom.set(source, Array.from({ length: 256 }, (_, index) => word(0x478e04 + index * 4)));
  return source;
}

export function buildLegacyNativeGroundRoute(source: LegacyNativeGroundRouteSource, current: LegacyNativeGroundRouteState,
  raw: Uint8Array, rawAddress: number, ground: readonly number[]) {
  requireRoute(raw.length === 220 && raw[6] === 25, "Unowned native ground-route actor");
  return buildGroundRoute(source, current, raw, rawAddress, ground);
}

function buildGroundRoute(source: LegacyNativeGroundRouteSource, current: LegacyNativeGroundRouteState,
  raw: Uint8Array, rawAddress: number, ground: readonly number[]) {
  const configuration = sources.get(source);
  requireRoute(configuration, "Authenticated native ground-route source required");
  requireRoute(current.dynamic === false && current.air === false, "Missing native dynamic/air route caller owner");
  const actor = Uint8Array.from(raw), record = dataView(actor);
  let column = Math.min(source.width - 1, record.getUint16(0x2e, true) >> 8);
  let row = Math.min(source.height - 1, record.getUint16(0x30, true) >> 8);
  if (configuration.families[row * source.width + column] === 0) {
    let found = false;
    for (let radius = 0; radius < 256 && !found; radius++) {
      for (let candidateColumn = column - radius; candidateColumn <= column + radius && !found; candidateColumn++) {
        if (candidateColumn < 0 || candidateColumn >= source.width) continue;
        for (let candidateRow = row - radius; candidateRow <= row + radius; candidateRow++) {
          if (candidateRow >= 0 && candidateRow < source.height
            && configuration.families[candidateRow * source.width + candidateColumn] !== 0) {
            column = candidateColumn; row = candidateRow; found = true; break;
          }
        }
      }
    }
    requireRoute(found, "No native corrected endpoint");
  }
  record.setUint16(0x2e, column * 256 + 128, true); record.setUint16(0x30, row * 256 + 128, true);
  const origin = [record.getUint16(0, true) >> 8, record.getUint16(4, true) >> 8] as const;
  const search = searchLegacyNativeGroundRoute({ ...configuration, ground, dynamic: false }, current, [column, row], origin);
  const distance = distanceLegacyNativeGroundRoute(search.state, configuration.tables, origin);
  requireRoute(distance !== 0x8000, "Native ground route is unreachable");
  const count = Math.min(32, distance);
  const serialized = serializeLegacyNativeGroundRoute(search.state, configuration.tables, origin, actor.slice(0x86, 0xa6), rawAddress + 0x86, 0, count);
  requireRoute(serialized.count === count, "Native route serialization failed");
  actor.set(serialized.packed, 0x86);
  return { raw: actor, state: serialized.state, distance, count, origin, endpoint: [column, row] as const,
    expansions: search.expansions, writes: [...search.writes, ...serialized.writes] };
}

export interface LegacyNativeRandomizedEndpointRequest {
  readonly boundary: 0x4155d5;
  readonly slot: number;
  readonly raw: Uint8Array;
  readonly rawAddress: number;
  readonly ground: readonly number[];
  readonly rngCursor: number;
}

export function correctLegacyNativeGroundRouteEndpoint(source: LegacyNativeGroundRouteSource,
  current: LegacyNativeGroundRouteState, request: LegacyNativeRandomizedEndpointRequest) {
  const random = sourceRandom.get(source), { raw, slot } = request;
  requireRoute(random && request.boundary === 0x4155d5 && integer(request.rngCursor, 255)
    && integer(slot, 799) && slot >= 152 && request.rawAddress === 0x800000 + 0x7d28 + slot * 220
    && current.dynamic === false && current.air === false && request.ground.length === source.width * source.height,
  "Invalid source randomized endpoint request");
  requireRoute(raw.length === 220 && [0, 8, 25].includes(raw[6]) && raw[0x2c] === 1 && raw[0x36] === 0
    && raw[0x38] > 0 && raw[0x38] < 6 && raw[0x39 + raw[0x38] * 2] === 6,
  "Unsupported randomized endpoint actor");
  const actor = Uint8Array.from(raw), record = dataView(actor);
  const payload = 0x46 + raw[0x3a + raw[0x38] * 2] * 2;
  requireRoute(payload + 16 <= 0x86 && raw[0x3c + raw[0x38] * 2] - raw[0x3a + raw[0x38] * 2] === 8
    && record.getUint16(payload + 8, true) <= 1 && record.getInt32(12, true) > 0,
  "Invalid randomized endpoint task6 payload");
  const origin = [record.getUint16(0, true) >> 8, record.getUint16(4, true) >> 8] as const;
  requireRoute(integer(origin[0], source.width - 1) && integer(origin[1], source.height - 1)
    && (request.ground[origin[1] * source.width + origin[0]] & 1023) === slot,
  "Randomized endpoint lost source reservation");
  const routeMode = record.getUint16(payload + 8, true);
  actor[0x38]--;
  let rngCursor = request.rngCursor;
  for (const offset of [0x2e, 0x30]) {
    rngCursor = (rngCursor + 1) & 255;
    record.setUint16(offset, record.getUint16(offset, true) + ((random[rngCursor] % 3) - 1) * 256, true);
  }
  for (const offset of [0x2e, 0x30]) {
    if (record.getUint16(offset, true) > 0xf000) actor[offset + 1]++;
  }
  for (const [offset, extent] of [[0x2e, source.width], [0x30, source.height]]) {
    if (record.getUint16(offset, true) >= extent * 256)
      record.setUint16(offset, record.getUint16(offset, true) - 256, true);
  }
  const candidate = Uint8Array.from(actor);
  if (record.getUint16(0x2e, true) >> 8 === origin[0] && record.getUint16(0x30, true) >> 8 === origin[1])
    return { raw: actor, state: current, rngCursor, candidate, rebuilt: false, writes: [] as LegacyNativeGroundRouteWrite[] };
  const route = buildGroundRoute(source, current, actor, request.rawAddress, request.ground);
  actor.set(route.raw);
  actor[0x38]++;
  actor[0x39 + actor[0x38] * 2] = 6;
  actor[0x3c + actor[0x38] * 2] = actor[0x3a + actor[0x38] * 2] + 8;
  for (const [index, value] of [route.count - 1, route.count, ...route.origin, routeMode, 65535, 65535].entries())
    record.setUint16(payload + index * 2, value, true);
  return { raw: actor, state: route.state, rngCursor, candidate, rebuilt: true, writes: route.writes };
}

export function rerouteLegacyNativeGroundRoute(source: LegacyNativeGroundRouteSource, current: LegacyNativeGroundRouteState,
  raw: Uint8Array, rawAddress: number, ground: readonly number[], slot: number,
  endpoint: readonly [number, number], start: number) {
  const configuration = sources.get(source);
  requireRoute(configuration && current.dynamic === false && current.air === false,
    "Authenticated ground-only occupied route required");
  requireRoute(raw.length === 220 && [0, 8, 25].includes(raw[6]) && integer(slot, 799)
    && raw[0x38] < 6 && raw[0x39 + raw[0x38] * 2] === 6 && integer(start, 31), "Invalid occupied task6 caller");
  const actor = Uint8Array.from(raw), record = dataView(actor);
  const payload = 0x46 + raw[0x3a + raw[0x38] * 2] * 2;
  requireRoute(payload + 16 <= 0x86, "Invalid occupied task6 payload");
  const origin = [record.getUint16(0, true) >> 8, record.getUint16(4, true) >> 8] as const;
  const cell = origin[1] * source.width + origin[0];
  requireRoute((ground[cell] & 1023) === slot, "Occupied route origin lacks actor reservation");
  const searchGround = [...ground];
  searchGround[cell] = (searchGround[cell] | 1023) >>> 0;
  const search = searchLegacyNativeGroundRoute({ ...configuration, ground: searchGround, dynamic: true, occupiedLocal: true },
    current, endpoint, origin);
  const distance = distanceLegacyNativeGroundRoute(search.state, configuration.tables, origin);
  if (distance === 0x8000) return { raw: actor, state: search.state, reachable: false, distance };
  const splice = distance + start < 32 ? start : 0;
  requireRoute(distance > 0 && distance <= 32, "Missing occupied route long-chunk consumer");
  const serialized = serializeLegacyNativeGroundRoute(search.state, configuration.tables, origin,
    actor.slice(0x86, 0xa6), rawAddress + 0x86, splice, distance);
  requireRoute(serialized.count === distance, "Occupied route serialization failed");
  actor.set(serialized.packed, 0x86);
  record.setUint16(payload, splice + distance - 1, true);
  record.setUint16(payload + 10, endpoint[0], true); record.setUint16(payload + 12, endpoint[1], true);
  record.setUint16(payload + 14, splice, true);
  return { raw: actor, state: serialized.state, reachable: true, distance };
}

export function legacyNativeGroundRouteLeg(xQ8: number, yQ8: number, column: number, row: number, speed: number) {
  const deltaX = column * 256 + 128 - xQ8, deltaY = row * 256 + 128 - yQ8;
  const absoluteX = Math.abs(deltaX), absoluteY = Math.abs(deltaY);
  let angle = 0;
  if (absoluteX || absoluteY) {
    if (absoluteX === absoluteY) angle = deltaX > 0 ? (deltaY > 0 ? 1024 : 7168) : (deltaY > 0 ? 3072 : 5120);
    else {
      const base = legacyHarvesterMotionTables.atanQ13[Math.trunc(Math.min(absoluteX, absoluteY) * 256 / Math.max(absoluteX, absoluteY))];
      if (absoluteY > absoluteX) angle = deltaX < 0 ? (deltaY >= 0 ? 2048 + base : 6144 - base)
        : (deltaY < 0 ? 6144 + base : 2048 - base);
      else angle = deltaX < 0 ? (deltaY >= 0 ? 4096 - base : 4096 + base)
        : (deltaY < 0 && base !== 0 ? 8192 - base : base);
    }
  }
  const direction = Math.trunc(angle / 32) & 255;
  const sine = (heading: number) => {
    const normalized = heading & 255, quarter = normalized >> 6, offset = normalized & 63;
    return legacyHarvesterMotionTables.sineQuarterQ11[quarter & 1 ? 64 - offset : offset] * (quarter >= 2 ? -1 : 1);
  };
  const cosine = sine(direction + 64), vertical = sine(direction);
  return { direction, count: Math.trunc(Math.trunc((cosine * deltaX + vertical * deltaY) / 2048) / speed),
    stepX: Math.trunc(cosine * speed / 2048), stepY: Math.trunc(vertical * speed / 2048) };
}