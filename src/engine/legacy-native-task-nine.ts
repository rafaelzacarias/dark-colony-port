import { createLegacyNativeGroundRouteSource, searchLegacyNativeGroundRoute, distanceLegacyNativeGroundRoute,
  serializeLegacyNativeGroundRoute, type LegacyNativeGroundRouteSource, type LegacyNativeGroundRouteWorld,
  type LegacyNativeGroundRouteState } from "./legacy-native-ground-route";

export interface LegacyNativeTaskNineSource {
  readonly scope: "source-native-task-nine";
  readonly mission: LegacyNativeGroundRouteSource["mission"];
  readonly width: number;
  readonly height: number;
}

const sources = new WeakMap<LegacyNativeTaskNineSource, Omit<LegacyNativeGroundRouteWorld, "ground" | "dynamic">>();

export function isLegacyNativeTaskNineSource(source: LegacyNativeTaskNineSource): boolean {
  return sources.has(source);
}

export async function createLegacyNativeTaskNineSource(input: Parameters<typeof createLegacyNativeGroundRouteSource>[0]) {
  const executable = Uint8Array.from(input.executable), map = Uint8Array.from(input.map), pth = Uint8Array.from(input.pth);
  const authenticated = await createLegacyNativeGroundRouteSource({ executable, map, pth, mission: input.mission });
  const image = new DataView(executable.buffer), pe = image.getUint32(0x3c, true);
  const sections = pe + 24 + image.getUint16(pe + 20, true);
  const word = (address: number) => {
    for (let index = 0; index < image.getUint16(pe + 6, true); index++) {
      const section = sections + index * 40, base = 0x400000 + image.getUint32(section + 12, true);
      if (address >= base && address + 4 <= base + image.getUint32(section + 16, true))
        return image.getInt32(image.getUint32(section + 20, true) + address - base, true);
    }
    throw new RangeError("Unmapped native task9 route table");
  };
  const source = Object.freeze({ ...authenticated, scope: "source-native-task-nine" as const });
  sources.set(source, { width: source.width, height: source.height, families: pth.slice(65536), nextFamily: pth.slice(0, 65536),
    tables: { costs: Array.from({ length: 81 }, (_, index) => word(0x47a9b4 + index * 4)),
      directions: Array.from({ length: 9 }, (_, index) => word(0x47a984 + index * 4)) } });
  return source;
}

export function buildLegacyNativeTaskNineRoute(source: LegacyNativeTaskNineSource, current: LegacyNativeGroundRouteState,
  raw: Uint8Array, rawAddress: number, ground: readonly number[]) {
  const configuration = sources.get(source);
  if (!configuration || current.dynamic !== false || current.air !== false || raw.length !== 220 || ![0, 8].includes(raw[6]))
    throw new RangeError("Unsupported source task9 ground route");
  const actor = Uint8Array.from(raw), record = new DataView(actor.buffer);
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
    if (!found) throw new RangeError("No native task9 corrected endpoint");
  }
  record.setUint16(0x2e, column * 256 + 128, true); record.setUint16(0x30, row * 256 + 128, true);
  const origin = [record.getUint16(0, true) >> 8, record.getUint16(4, true) >> 8] as const;
  const search = searchLegacyNativeGroundRoute({ ...configuration, ground, dynamic: false }, current, [column, row], origin);
  const distance = distanceLegacyNativeGroundRoute(search.state, configuration.tables, origin);
  if (distance === 0x8000) throw new RangeError("Native task9 ground route is unreachable");
  const count = Math.min(32, distance);
  const serialized = serializeLegacyNativeGroundRoute(search.state, configuration.tables, origin,
    actor.slice(0x86, 0xa6), rawAddress + 0x86, 0, count);
  if (serialized.count !== count) throw new RangeError("Native task9 route serialization failed");
  actor.set(serialized.packed, 0x86);
  return { raw: actor, state: serialized.state, count, origin };
}

export interface LegacyNativeTaskNineRoute {
  readonly raw: Uint8Array;
  readonly routeMode: 1;
  readonly boundary: 0x414ce4;
}

export function reduceLegacyNativeTaskNine(raw: Uint8Array): LegacyNativeTaskNineRoute {
  if (raw.length !== 220 || raw[0x36] !== 0 || raw[0x38] >= 5
    || raw[0x39 + raw[0x38] * 2] !== 9 || raw[0xc6] > 8)
    throw new RangeError("Invalid native task9 route entry");
  const payload = 0x46 + raw[0x3a + raw[0x38] * 2] * 2;
  if (payload < 0x46 || payload + 2 > 0x86)
    throw new RangeError("Invalid native task9 payload");
  const next = Uint8Array.from(raw), actor = new DataView(next.buffer);
  let waypoint = actor.getInt16(payload, true);
  if (waypoint < 0 || waypoint > 8) throw new RangeError("Invalid native task9 waypoint");
  if (waypoint >= next[0xc6]) waypoint = 0;
  actor.setUint16(0x2e, actor.getUint16(0xa6 + waypoint * 4, true), true);
  actor.setUint16(0x30, actor.getUint16(0xa8 + waypoint * 4, true), true);
  actor.setUint16(payload, waypoint + 1, true);
  return { raw: next, routeMode: 1, boundary: 0x414ce4 };
}