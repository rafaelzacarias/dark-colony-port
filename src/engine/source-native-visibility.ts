export interface SourceNativeVisibilityAssets {
  readonly executable: Uint8Array;
  readonly gameStat: Uint8Array;
  readonly scenario: Uint8Array;
  readonly map: Uint8Array;
  readonly bts: Uint8Array;
  readonly mtg: Uint8Array;
  readonly pth: Uint8Array;
}

export interface NativeVisibilityTreeNode {
  readonly x: number;
  readonly y: number;
  readonly children: readonly number[];
}

export interface SourceNativeVisibilityConfiguration {
  readonly kind: "source-native-visibility-v1";
  readonly mission: "HUMAN02" | "ALIEN02";
  readonly hashes: Readonly<Record<keyof SourceNativeVisibilityAssets, string>>;
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly number[];
  readonly pathFamilies: readonly number[];
  readonly roots: readonly number[];
  readonly nodes: Readonly<Record<number, NativeVisibilityTreeNode>>;
  readonly producerProfiles: Readonly<Partial<Record<number, "ground-occluded" | "ground-unpruned">>>;
  readonly types: readonly { readonly night: number; readonly day: number; readonly flight: number;
    readonly detection: number; readonly metadata: number }[];
}

const trusted = new WeakSet<SourceNativeVisibilityConfiguration>();
const hashes = {
  executable: "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
  gameStat: "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629",
  bts: "3243b51139cb3cf71de9336ee282ba1502c90e2b12520ac1c349965c7f97fc6d",
  mtg: "615e95f568d1c83d750f63255b12de32db470a45017f4fe5fa02ed1336f0cc49",
};
const missions = {
  HUMAN02: ["bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab",
    "ea7377f73ad1d02974d8b2c04d929d3805f591a12b870254a8d466b65685f3c5",
    "623c4e65f710527bc27f02f99644eb13828a3f4aaf533a1fd4f4accc8d3ba2df"],
  ALIEN02: ["d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e",
    "d5ab938493b41614ef12f2640b152970e5aad8668a15e4709d6db3df80c18bae",
    "1e6633ca04693915fb2187d06fa16f4a52c973c5eb6617e73afd7797a0850155"],
} as const;

function requireSource(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native visibility source: ${message}`);
}

function freeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function isSourceNativeVisibilityConfiguration(value: SourceNativeVisibilityConfiguration): boolean {
  return trusted.has(value);
}

export async function createSourceNativeVisibilityConfiguration(input: SourceNativeVisibilityAssets): Promise<SourceNativeVisibilityConfiguration> {
  const source = Object.fromEntries(Object.keys(input).map(key => {
    const bytes = input[key as keyof SourceNativeVisibilityAssets];
    requireSource(bytes instanceof Uint8Array, `missing ${key} bytes`);
    return [key, Uint8Array.from(bytes)];
  })) as unknown as SourceNativeVisibilityAssets;
  const fields = ["executable", "gameStat", "scenario", "map", "bts", "mtg", "pth"] as const;
  const actual = Object.fromEntries(await Promise.all(fields.map(async key => {
    requireSource(source[key] instanceof Uint8Array, `missing ${key} bytes`);
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(source[key]).buffer);
    return [key, Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")];
  }))) as Record<keyof SourceNativeVisibilityAssets, string>;
  for (const key of Object.keys(hashes) as (keyof typeof hashes)[])
    requireSource(actual[key] === hashes[key], `${key} hash mismatch`);
  const mission = (Object.keys(missions) as (keyof typeof missions)[]).find(name =>
    [actual.scenario, actual.map, actual.pth].every((value, index) => value === missions[name][index]));
  requireSource(mission, "scenario/MAP/PTH source mismatch");
  const executable = new DataView(source.executable.buffer), pe = executable.getUint32(0x3c, true);
  const sections = pe + 24 + executable.getUint16(pe + 20, true);
  const word = (address: number): number => {
    for (let index = 0; index < executable.getUint16(pe + 6, true); index++) {
      const header = sections + index * 40, base = 0x400000 + executable.getUint32(header + 12, true);
      const rawSize = executable.getUint32(header + 16, true), virtualSize = executable.getUint32(header + 8, true);
      if (address >= base && address + 4 <= base + Math.max(rawSize, virtualSize)) {
        if ((executable.getUint32(header + 36, true) & 0x80) || address - base >= rawSize) return 0;
        return executable.getInt32(executable.getUint32(header + 20, true) + address - base, true);
      }
    }
    throw new Error("Native visibility source: unmapped executable word");
  };
  const roots = Array.from({ length: 11 }, (_, radius) => word(0x488fc8 + radius * 4));
  const nodes: Record<number, NativeVisibilityTreeNode> = {}, active = new Set<number>();
  const visit = (address: number): void => {
    if (!address || nodes[address]) return;
    requireSource(!active.has(address), "cyclic visibility tree");
    active.add(address);
    const x = word(address), y = word(address + 4), displacement = word(address + 8);
    requireSource(Math.abs(x) <= 10 && Math.abs(y) <= 10 && displacement >= -4
      && displacement <= 28 && displacement % 4 === 0, "invalid visibility tree node");
    const children = Array.from({ length: displacement / 4 + 1 }, (_, index) => word(address + 12 + index * 4));
    children.forEach(visit);
    nodes[address] = { x, y, children };
    active.delete(address);
  };
  roots.forEach(visit);
  const rows = new TextDecoder().decode(source.gameStat).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("%"));
  requireSource(Number(rows.shift()) === 106 && rows.length === 106, "incomplete GAMESTAT");
  const types = rows.map((row, index) => {
    const tokens = row.split(/\s+/);
    const metadata = word(0x4f1880 + index * 280 + 0x78);
    requireSource(tokens.length === 33 && metadata === 0, "unknown initial metadata class");
    return { night: Number(tokens[5]), day: Number(tokens[4]), flight: Number(tokens[13]),
      detection: Number(tokens[16]) & 255, metadata };
  });
  const producerProfiles: Partial<Record<number, "ground-occluded" | "ground-unpruned">> = {};
  for (const kind of [0, 2, 8, 10, 16, 17, 28, 29, 41, 69, 73, 81, 84, 86, 89, 91]) {
    const unpruned = [16, 17, 28, 29, 81].includes(kind), type = types[kind];
    requireSource(type.flight === Number(unpruned) && type.detection === 0 && type.metadata === 0,
      "unknown producer dispatch profile");
    producerProfiles[kind] = unpruned ? "ground-unpruned" : "ground-occluded";
  }
  const map = new DataView(source.map.buffer), bts = new DataView(source.bts.buffer);
  const width = map.getUint32(0, true), height = map.getUint32(4, true), cells = width * height;
  requireSource(source.map.length === 8 + cells * 6 && source.pth.length === 65536 + cells
    && source.mtg.length === 2 + cells && source.mtg[0] === width && source.mtg[1] === height,
  "invalid source dimensions");
  const lookup = Array<number>(bts.getUint32(0, true)).fill(0), count = bts.getUint32(4, true);
  requireSource(source.bts.length === 776 + count * 1028, "invalid BTS records");
  for (let index = 0; index < count; index++) lookup[bts.getUint32(776 + index * 1028, true)] = index;
  const terrain = Array.from({ length: cells }, (_, cell) => {
    const background = lookup[map.getUint16(8 + cell * 4, true)];
    const foreground = lookup[map.getUint16(10 + cell * 4, true)];
    requireSource(background !== undefined && foreground !== undefined, "invalid BTS key");
    let packed = (background | foreground << 11 | map.getUint16(8 + cells * 4 + cell * 2, true) << 22) >>> 0;
    if (!(packed & 0x80000000)) packed = (packed | 0x20000000) >>> 0;
    if (!foreground) packed = (packed & 0xfc3fffff) >>> 0;
    return packed;
  });
  const configuration: SourceNativeVisibilityConfiguration = freeze({ kind: "source-native-visibility-v1", mission,
    hashes: actual, width, height, terrain, pathFamilies: Array.from(source.pth.subarray(65536)), roots, nodes, types, producerProfiles });
  trusted.add(configuration);
  return configuration;
}