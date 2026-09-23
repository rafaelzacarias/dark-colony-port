import { isSourceNativeVisibilityConfiguration, type SourceNativeVisibilityConfiguration } from "./source-native-visibility";

export type LegacyNativeVisibilityClearResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly ground: readonly number[] };

const integer = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;

export function clearLegacyNativeVisibility(ground: readonly number[]): LegacyNativeVisibilityClearResult {
  if (!Array.isArray(ground) || !ground.length || !words(ground, ground.length, 0xffffffff))
    return { supported: false, diagnostic: "invalid-native-visibility-ground" };
  return { supported: true, ground: ground.map(value => (value & 0x807fffff) >>> 0) };
}

export interface LegacyNativeVisibilityFrame {
  readonly configuration: SourceNativeVisibilityConfiguration;
  readonly phase: "caller" | "clear" | "compute";
  readonly counter: number;
  readonly highWater: number;
  readonly actors: readonly number[];
  readonly registry: readonly number[];
  readonly ground: readonly number[];
  readonly air: readonly number[];
  readonly extra: readonly number[];
  readonly terrain: readonly number[];
  readonly localTeam: number;
  readonly localMask: number;
  readonly daylight: number;
  readonly revealAll: number;
  readonly revealLocal: number;
  readonly rngCursor: number;
  readonly crtSeed: number;
  readonly producerSlots: readonly number[];
  readonly excludedProducerSlots: readonly number[];
}

export interface LegacyNativeVisibilityWrite {
  readonly plane: "ground" | "actors";
  readonly index: number;
  readonly before: number;
  readonly after: number;
}

export type LegacyNativeVisibilityResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly scope: "source-separated-ground-visibility";
      readonly executed: boolean; readonly phases: readonly ("clear" | "compute")[];
      readonly actors: readonly number[]; readonly ground: readonly number[];
      readonly air: readonly number[]; readonly extra: readonly number[]; readonly terrain: readonly number[];
      readonly registry: readonly number[]; readonly highWater: number; readonly rngCursor: number;
      readonly crtSeed: number; readonly randomAdvances: readonly number[];
      readonly writes: readonly LegacyNativeVisibilityWrite[];
      readonly producers: readonly { readonly slot: number; readonly radius: number; readonly local: boolean }[] };

function words(value: readonly number[], length: number, maximum: number): boolean {
  if (!Array.isArray(value) || value.length !== length) return false;
  for (let index = 0; index < length; index++) if (!integer(value[index], 0, maximum)) return false;
  return true;
}

export function reduceLegacyNativeVisibility(frame: LegacyNativeVisibilityFrame): LegacyNativeVisibilityResult {
  const reject = (diagnostic: string): LegacyNativeVisibilityResult => ({ supported: false, diagnostic });
  if (!frame || !isSourceNativeVisibilityConfiguration(frame.configuration)) return reject("visibility-source-configuration-required");
  const configuration = frame.configuration, { width, height } = configuration, cells = width * height;
  if (!["caller", "clear", "compute"].includes(frame.phase) || !integer(frame.counter, 0, 0xffffffff)
    || !integer(frame.highWater, 0, 799) || !integer(frame.localTeam, 0, 7)
    || !integer(frame.localMask, 0, 0x7f800000) || (frame.localMask & 0x7fffff)
    || !integer(frame.daylight, 0, 256) || !integer(frame.rngCursor, 0, 255)
    || !integer(frame.crtSeed, 0, 0xffffffff) || frame.revealAll !== 0 || frame.revealLocal !== 0)
    return reject("unowned-native-visibility-phase-profile");
  if (!words(frame.actors, 800 * 220, 255) || !words(frame.ground, cells, 0xffffffff)
    || !words(frame.air, cells, 65535) || !words(frame.extra, cells, 65535)
    || !words(frame.terrain, cells, 0xffffffff) || !Array.isArray(frame.registry) || frame.registry.length !== 800
    || Array.from(frame.registry).some((value, index) => value !== -1 && value !== index))
    return reject("invalid-native-visibility-world");
  if (frame.terrain.some((value, index) => ((value ^ configuration.terrain[index]) & ~0x04000000) !== 0))
    return reject("unowned-native-visibility-terrain-change");
  const validSlots = (slots: readonly number[]) => Array.isArray(slots) && Array.from(slots).every((slot, index) =>
    integer(slot, 0, frame.highWater) && (index === 0 || slot > slots[index - 1]));
  if (!validSlots(frame.producerSlots) || !validSlots(frame.excludedProducerSlots)) return reject("invalid-native-visibility-selection");
  const selected = new Set(frame.producerSlots), excluded = new Set(frame.excludedProducerSlots);
  const eligible: number[] = [], source = new DataView(Uint8Array.from(frame.actors).buffer);
  for (let slot = 0; slot < 800; slot++) {
    const offset = slot * 220, status = frame.actors[offset + 0x2c], kind = frame.actors[offset + 6];
    if (!status) continue;
    if (slot > frame.highWater || kind >= configuration.types.length || frame.registry[slot] !== slot
      || source.getUint16(offset, true) >= width * 256 || source.getUint16(offset + 4, true) >= height * 256
      || frame.actors[offset + 7] > 9) return reject("invalid-native-visibility-actor");
    if (![1, 2].includes(frame.actors[offset + 0xcb]) && frame.actors[offset + 7] <= 7) eligible.push(slot);
  }
  if (eligible.length !== selected.size + excluded.size || eligible.some(slot => selected.has(slot) === excluded.has(slot)))
    return reject("native-visibility-explicit-producer-partition-required");
  const producers: { slot: number; radius: number; local: boolean }[] = [];
  for (const slot of frame.producerSlots) {
    const offset = slot * 220, kind = frame.actors[offset + 6], type = configuration.types[kind];
    const profile = configuration.producerProfiles[kind], altitude = source.getUint16(offset + 2, true);
    if (!profile || type.detection !== 0 || type.metadata !== 0
      || altitude !== 0 && !(profile === "ground-unpruned" && altitude === 600)
      || frame.actors[offset + 0x2c] !== 1) return reject("unowned-native-visibility-producer");
    const radius = (Math.imul(frame.daylight, type.night) + Math.imul(256 - frame.daylight, type.day)) >> 8;
    if (!integer(radius, 1, 10)) return reject("unowned-native-visibility-radius");
    producers.push({ slot, radius, local: Boolean(frame.localMask & (0x40000000 >>> frame.actors[offset + 7])) });
  }
  const actors = [...frame.actors], ground = [...frame.ground], writes: LegacyNativeVisibilityWrite[] = [];
  const phases: ("clear" | "compute")[] = frame.phase === "caller" ? frame.counter & 15 ? [] : ["clear", "compute"] : [frame.phase];
  const write = (plane: "ground" | "actors", index: number, after: number) => {
    const target = plane === "ground" ? ground : actors;
    writes.push({ plane, index, before: target[index], after: after >>> 0 });
    target[index] = after >>> 0;
  };
  if (phases.includes("clear")) for (let cell = 0; cell < cells; cell++) write("ground", cell, ground[cell] & 0x807fffff);
  if (phases.includes("compute")) {
    for (let slot = 0; slot <= frame.highWater; slot++)
      if (actors[slot * 220 + 0x2c]) write("actors", slot * 220 + 0xca, 0);
    for (const producer of producers) {
      const offset = producer.slot * 220, column = source.getUint16(offset, true) >>> 8;
      const row = source.getUint16(offset + 4, true) >>> 8, team = actors[offset + 7];
      if (actors[offset + 0x10] & 31) {
        const revealTeam = actors[offset + 0x10] >>> 5;
        const mask = (0x40000000 >>> revealTeam) | (revealTeam === frame.localTeam ? 0x80000000 : 0);
        write("ground", row * width + column, ground[row * width + column] | mask);
      }
      const localBit = producer.local ? 0x80000000 : 0, mask = (0x40000000 >>> team) | localBit;
      const stack = [{ address: configuration.roots[producer.radius], depth: 0 }];
      while (stack.length) {
        const current = stack.pop()!;
        if (!current.address) break;
        const node = configuration.nodes[current.address], x = column + node.x, y = row + node.y;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const cell = y * width + x, terrain = frame.terrain[(height - 1 - y) * width + x];
        if (producer.local) write("ground", cell, ground[cell] & 0xfffc03ff);
        write("ground", cell, ground[cell] | ((terrain & 0x40000000) && current.depth >= 2 ? localBit : mask));
        if (configuration.producerProfiles[actors[offset + 6]] === "ground-unpruned" || terrain & 0x20000000)
          for (const address of node.children) stack.push({ address, depth: current.depth + 1 });
      }
    }
    for (let slot = 0; slot < frame.highWater; slot++) {
      const offset = slot * 220, status = actors[offset + 0x2c], kind = actors[offset + 6];
      if (!status || status === 10 || kind === 40 && source.getUint16(offset + 0x32, true) === 0) continue;
      const metadata = configuration.types[kind].metadata;
      if (!metadata) continue;
      const cell = (source.getUint16(offset + 4, true) >>> 8) * width + (source.getUint16(offset, true) >>> 8);
      if (!(ground[cell] & frame.localMask)) continue;
      const occupant = ground[cell] & 1023;
      if (kind === 40 && occupant < 800 && configuration.types[actors[occupant * 220 + 6]].metadata) continue;
      if (actors[offset + 7] === 9 || metadata >= 16) return reject("unowned-native-visibility-metadata");
      write("ground", cell, ground[cell] & 0xfffc03ff);
      write("ground", cell, ground[cell] | ((actors[offset + 7] & 7) | metadata << 3) << 10);
    }
  }
  return { supported: true, scope: "source-separated-ground-visibility", executed: phases.length > 0, phases,
    actors, ground, air: [...frame.air], extra: [...frame.extra], terrain: [...frame.terrain],
    registry: [...frame.registry], highWater: frame.highWater, rngCursor: frame.rngCursor, crtSeed: frame.crtSeed,
    randomAdvances: [], writes, producers: phases.includes("compute") ? producers : [] };
}