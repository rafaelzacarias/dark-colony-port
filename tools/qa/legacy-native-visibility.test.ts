import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clearLegacyNativeVisibility, reduceLegacyNativeVisibility, type LegacyNativeVisibilityFrame } from "../../src/engine/legacy-native-visibility";
import { createSourceNativeVisibilityConfiguration, type SourceNativeVisibilityConfiguration } from "../../src/engine/source-native-visibility";

const root = fileURLToPath(new URL("../../", import.meta.url));
const asset = (path: string) => Uint8Array.from(readFileSync(`${root}raw_cd/DC/${path}`));
const assets = (faction = "HUMAN") => ({
  executable: asset("DC.EXE"), gameStat: asset("GAMESTAT/GAMESTAT.TXT"),
  scenario: asset(`SCENARIO/${faction}/${faction}02.SCN`), map: asset(`SCENARIO/${faction}/${faction}02.MAP`),
  mtg: asset(`SCENARIO/${faction}/${faction}02.MTG`), pth: asset(`SCENARIO/${faction}/${faction}02.PTH`),
  bts: asset("SCENARIO/DESERT.BTS"),
});

test("native visibility clear preserves exploration and low metadata, clearing only bits 23..30", () => {
  const ground = [0xffffffff, 0xe00003ff, ...Array.from({ length: 32 }, (_, bit) => (2 ** bit) >>> 0)];
  const before = [...ground];
  const result = clearLegacyNativeVisibility(ground);
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.deepEqual(result.ground, [0x807fffff, 0x800003ff,
    ...Array.from({ length: 32 }, (_, bit) => bit >= 23 && bit <= 30 ? 0 : (2 ** bit) >>> 0)]);
  assert.deepEqual(ground, before);
});

test("native visibility clear rejects invalid unsigned words without mutation", () => {
  const ground = [0xe00003ff, -1];
  assert.equal(clearLegacyNativeVisibility(ground).supported, false);
  assert.deepEqual(ground, [0xe00003ff, -1]);
  assert.equal(clearLegacyNativeVisibility(Array<number>(2)).supported, false);
});

test("visibility config derives exact native terrain and type fields from actual source bytes", async () => {
  const trace = JSON.parse(process.env.DC_VISIBILITY_TRACE ? readFileSync(process.env.DC_VISIBILITY_TRACE, "utf8")
    : execFileSync("python3", ["-B", `${root}tools/qa/native-visibility-native.py`], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
    }));
  const configuration = await createSourceNativeVisibilityConfiguration(assets(trace.faction));
  assert.deepEqual(configuration.terrain, trace.initialTerrain);
  const types = Buffer.from(trace.typeTable, "base64");
  for (let index = 0; index < 106; index++) {
    assert.deepEqual(configuration.types[index], { night: types.readInt32LE(index * 280 + 16),
      day: types.readInt32LE(index * 280 + 20), flight: types[index * 280 + 96],
      detection: types[index * 280 + 108], metadata: types.readInt32LE(index * 280 + 120) });
  }
});

test("bounded original caller matches full actors, all ground cells, planes, RNG and ordered writes", async () => {
  const trace = JSON.parse(process.env.DC_VISIBILITY_BOUNDED_TRACE ? readFileSync(process.env.DC_VISIBILITY_BOUNDED_TRACE, "utf8")
    : execFileSync("python3", ["-B", `${root}tools/qa/native-visibility-native.py`, "--bounded"], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
    }));
  assert.equal(trace.bounded, true);
  const configuration = await createSourceNativeVisibilityConfiguration(assets(trace.faction));
  const frame: LegacyNativeVisibilityFrame = { configuration, phase: "caller", counter: trace.counter,
    highWater: trace.highWater, actors: Array.from(Buffer.from(trace.initial.actors, "base64")), registry: trace.registry,
    ground: trace.initial.ground, air: trace.initial.air, extra: trace.initial.extra, terrain: trace.terrain,
    localTeam: 0, localMask: 0x40000000, daylight: trace.daylight, revealAll: 0, revealLocal: 0,
    rngCursor: trace.initial.rngCursor, crtSeed: trace.initial.crtSeed,
    producerSlots: trace.selected, excludedProducerSlots: trace.excluded };
  const before = structuredClone(frame);
  const actual = reduceLegacyNativeVisibility(frame);
  assert.equal(actual.supported, true, actual.supported ? undefined : actual.diagnostic);
  if (!actual.supported) return;
  assert.deepEqual(actual.actors, Array.from(Buffer.from(trace.caller.actors, "base64")));
  assert.deepEqual(actual.ground, trace.caller.ground);
  assert.deepEqual(actual.air, trace.caller.air);
  assert.deepEqual(actual.extra, trace.caller.extra);
  assert.equal(actual.rngCursor, trace.caller.rngCursor);
  assert.equal(actual.crtSeed, trace.caller.crtSeed);
  assert.deepEqual(actual.writes, trace.writes.map(({ plane, index, before, after }: {
    plane: string; index: number; before: number; after: number;
  }) => ({ plane, index, before, after })));
  assert.deepEqual(frame, before);
  const cell = (frame.actors[trace.slot * 220 + 5] * configuration.width) + frame.actors[trace.slot * 220 + 1];
  assert.equal(frame.ground[cell] >>> 31, 0);
  if (!(trace.counter & 15)) assert.equal(actual.ground[cell] >>> 31, 1);
});

interface NativeSnapshot {
  actors: string; ground: number[]; air: number[]; extra: number[]; rngCursor: number; crtSeed: number;
}
interface NativeTrace {
  name: string; faction: string; slot: number; victimSlot: number | null; counter: number; highWater: number;
  daylight: number; localMask?: number; staleMetadataControl?: boolean; registry: number[]; selected: number[]; excluded: number[]; terrain: number[];
  initial: NativeSnapshot; computed: NativeSnapshot; persistent: NativeSnapshot; recomputed: NativeSnapshot; caller: NativeSnapshot;
  writes: { plane: string; index: number; before: number; after: number }[];
  soundGate?: { before: string[]; computed: string[]; cleared: string[]; boundaryOnly: boolean };
}

interface GroundTrace extends NativeTrace {
  fresh: boolean; bounded: boolean; skipped: number[]; initialTerrain: number[]; typeTable: string;
  inclusiveHighWaterControl: boolean;
  phases: { name: LegacyNativeVisibilityFrame["phase"]; before: NativeSnapshot; after: NativeSnapshot;
    writes: NativeTrace["writes"]; calls: { entry: string }[];
    workers: { entry: string; slot: number; type: number; radius: number; game: number; width: number;
      arguments: number[]; actor: string }[] }[];
}

function fromTrace(trace: NativeTrace, configuration: SourceNativeVisibilityConfiguration): LegacyNativeVisibilityFrame {
  return { configuration, phase: "caller", counter: trace.counter,
    highWater: trace.highWater, actors: Array.from(Buffer.from(trace.initial.actors, "base64")), registry: trace.registry,
    ground: trace.initial.ground, air: trace.initial.air, extra: trace.initial.extra, terrain: trace.terrain,
    localTeam: 0, localMask: trace.localMask ?? 0x40000000, daylight: trace.daylight, revealAll: 0, revealLocal: 0,
    rngCursor: trace.initial.rngCursor, crtSeed: trace.initial.crtSeed,
    producerSlots: trace.selected, excludedProducerSlots: trace.excluded };
}

for (const faction of ["HUMAN", "ALIEN"]) test(`fresh full ${faction}02 visibility includes every original eligible producer`, async () => {
  const path = faction === "HUMAN" ? process.env.DC_VISIBILITY_FRESH_TRACE : process.env.DC_VISIBILITY_FRESH_ALIEN_TRACE;
  const trace = JSON.parse(path ? readFileSync(path, "utf8")
    : execFileSync("python3", ["-B", `${root}tools/qa/native-visibility-native.py`, "--fresh", "--faction", faction], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
    }));
  assert.equal(trace.fresh, true);
  assert.equal(trace.bounded, false);
  assert.equal(trace.slot, null);
  assert.deepEqual(trace.excluded, []);
  assert.deepEqual(trace.skipped, []);
  const configuration = await createSourceNativeVisibilityConfiguration(assets(faction));
  const frame = fromTrace(trace, configuration), before = structuredClone(frame);
  const actual = reduceLegacyNativeVisibility(frame);
  assert.equal(actual.supported, true, actual.supported ? undefined : actual.diagnostic);
  if (!actual.supported) return;
  assert.deepEqual(actual.actors, Array.from(Buffer.from(trace.caller.actors, "base64")));
  assert.deepEqual(actual.ground, trace.caller.ground);
  assert.deepEqual(actual.air, trace.caller.air);
  assert.deepEqual(actual.extra, trace.caller.extra);
  assert.equal(actual.rngCursor, trace.caller.rngCursor);
  assert.equal(actual.crtSeed, trace.caller.crtSeed);
  assert.deepEqual(actual.writes, trace.writes.map(({ plane, index, before, after }: NativeTrace["writes"][number]) =>
    ({ plane, index, before, after })));
  assert.deepEqual(frame, before);
});

test("ground visibility matrix: exact source producers, worker frames and every native phase", async context => {
  const content = process.env.DC_VISIBILITY_GROUND_MATRIX ? readFileSync(process.env.DC_VISIBILITY_GROUND_MATRIX, "utf8")
    : execFileSync("python3", ["-B", `${root}tools/qa/native-visibility-native.py`, "--ground-matrix"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
    });
  const traces = content.trim().split("\n").map(line => JSON.parse(line) as GroundTrace);
  assert.equal(traces.length, 37);
  const configurations = { HUMAN: await createSourceNativeVisibilityConfiguration(assets()),
    ALIEN: await createSourceNativeVisibilityConfiguration(assets("ALIEN")) };
  const visitedTypes = new Set<number>(), visitedWorkers = new Set<string>();
  let orderedWrites = 0;
  for (const trace of traces) await context.test(trace.name, () => {
    const configuration = configurations[trace.faction as keyof typeof configurations];
    const frame = fromTrace(trace, configuration), types = Buffer.from(trace.typeTable, "base64");
    assert.deepEqual(configuration.terrain, trace.initialTerrain);
    assert.ok(Object.isFrozen(configuration.producerProfiles));
    for (let kind = 0; kind < 106; kind++) assert.deepEqual(configuration.types[kind], {
      night: types.readInt32LE(kind * 280 + 16), day: types.readInt32LE(kind * 280 + 20),
      flight: types[kind * 280 + 0x60], detection: types[kind * 280 + 0x6c], metadata: types.readInt32LE(kind * 280 + 0x78),
    });
    const active = frame.registry.filter(slot => slot >= 0 && frame.actors[slot * 220 + 0x2c]);
    const eligible = active.filter(slot => frame.actors[slot * 220 + 7] <= 7 && ![1, 2].includes(frame.actors[slot * 220 + 0xcb]));
    assert.deepEqual([...trace.selected, ...trace.excluded].sort((left, right) => left - right), eligible);
    if (trace.inclusiveHighWaterControl) {
      assert.equal(trace.slot, frame.highWater);
      assert.ok(trace.selected.includes(frame.highWater));
      assert.equal(frame.actors[frame.highWater * 220 + 0xca], 0xa5);
    }
    if (trace.fresh) {
      assert.equal(trace.bounded, false);
      assert.equal(trace.slot, null);
      assert.deepEqual(trace.selected, eligible);
      assert.deepEqual(trace.excluded, []);
      assert.deepEqual(trace.skipped, []);
      assert.equal(active.length, trace.faction === "HUMAN" ? 21 : 44);
      assert.equal(eligible.length, trace.faction === "HUMAN" ? 14 : 41);
      assert.ok(active.some(slot => frame.actors[slot * 220 + 7] === 8 && !eligible.includes(slot)));
    }
    assert.deepEqual(trace.phases.map(phase => phase.name), ["clear", "compute", "clear", "compute", "caller"]);
    assert.deepEqual(trace.phases[0].before, trace.initial);
    assert.deepEqual(trace.phases[4].before, trace.initial);
    for (let index = 1; index < 4; index++) assert.deepEqual(trace.phases[index].before, trace.phases[index - 1].after);
    for (const phase of trace.phases) {
      const input: LegacyNativeVisibilityFrame = { ...frame, phase: phase.name,
        actors: Array.from(Buffer.from(phase.before.actors, "base64")), ground: phase.before.ground,
        air: phase.before.air, extra: phase.before.extra, rngCursor: phase.before.rngCursor, crtSeed: phase.before.crtSeed };
      const before = structuredClone(input), actual = reduceLegacyNativeVisibility(input);
      assert.equal(actual.supported, true, actual.supported ? undefined : actual.diagnostic);
      if (!actual.supported) return;
      assert.equal(actual.scope, "source-separated-ground-visibility");
      assert.deepEqual(actual.actors, Array.from(Buffer.from(phase.after.actors, "base64")));
      assert.deepEqual(actual.ground, phase.after.ground);
      assert.deepEqual(actual.air, phase.after.air);
      assert.deepEqual(actual.extra, phase.after.extra);
      assert.deepEqual(actual.terrain, frame.terrain);
      assert.deepEqual(actual.registry, frame.registry);
      assert.equal(actual.highWater, frame.highWater);
      assert.equal(actual.rngCursor, phase.after.rngCursor);
      assert.equal(actual.crtSeed, phase.after.crtSeed);
      assert.equal(actual.rngCursor, frame.rngCursor);
      assert.equal(actual.crtSeed, frame.crtSeed);
      assert.deepEqual(actual.randomAdvances, []);
      assert.deepEqual(actual.writes, phase.writes.map(({ plane, index, before, after }) => ({ plane, index, before, after })));
      assert.deepEqual(actual.phases.map(name => name === "clear" ? "0x4456f0" : "0x44a6d4"),
        phase.calls.filter(call => ["0x4456f0", "0x44a6d4"].includes(call.entry)).map(call => call.entry));
      assert.deepEqual(actual.producers.map(producer => producer.slot), phase.workers.map(worker => worker.slot));
      assert.deepEqual(actual.writes.filter(write => write.plane === "actors").map(write => write.index),
        actual.phases.includes("compute") ? active.map(slot => slot * 220 + 0xca) : []);
      for (const [index, worker] of phase.workers.entries()) {
        const producer: { readonly slot: number; readonly radius: number; readonly local: boolean } = actual.producers[index];
        const kind = frame.actors[worker.slot * 220 + 6], type = configuration.types[kind];
        const raw = input.actors.slice(worker.slot * 220, (worker.slot + 1) * 220);
        raw[0xca] = 0;
        const column = raw[1], row = raw[5], radius = producer.radius;
        const interior = column > radius && row > radius && column < configuration.width - radius && row < configuration.height - radius;
        const unpruned = configuration.producerProfiles[kind] === "ground-unpruned";
        const entries = unpruned ? interior ? ["0x446844", "0x4463e0"] : ["0x447b60", "0x4476c8"]
          : interior ? ["0x448e44", "0x4489cc"] : ["0x44a1e0", "0x449d20"];
        assert.equal(worker.entry, entries[Number(producer.local)]);
        assert.equal(worker.type, kind);
        assert.equal(worker.radius, (trace.daylight * type.night + (256 - trace.daylight) * type.day) >> 8);
        assert.equal(worker.radius, radius);
        assert.equal(worker.game, 0x800000);
        assert.equal(worker.width, configuration.width);
        assert.deepEqual(worker.arguments, [configuration.height, type.flight, type.detection, Number(producer.local)]);
        assert.deepEqual(Array.from(Buffer.from(worker.actor, "base64")), raw);
        visitedTypes.add(kind);
        visitedWorkers.add(worker.entry);
      }
      assert.deepEqual(input, before);
      orderedWrites += actual.writes.length;
    }
    assert.deepEqual(trace.computed, trace.recomputed);
    assert.equal(trace.persistent.ground.some(word => word & 0x7f800000), false);
    assert.deepEqual(trace.computed.ground.map(word => word >>> 31), trace.persistent.ground.map(word => word >>> 31));
    if (trace.name.endsWith("-occluded")) {
      const worker = trace.phases[1].workers[0], raw = Buffer.from(worker.actor, "base64");
      const stack = [configuration.roots[worker.radius]];
      let unvisited = 0;
      while (stack.length) {
        const address = stack.pop()!;
        if (!address) continue;
        const node = configuration.nodes[address], column = raw[1] + node.x, row = raw[5] + node.y;
        if (column >= 0 && row >= 0 && column < configuration.width && row < configuration.height
          && !(trace.computed.ground[row * configuration.width + column] & 0x80000000)) unvisited++;
        stack.push(...node.children);
      }
      assert.ok(unvisited > 0, "original terrain must prune the new commander radius tree");
    }
  });
  assert.deepEqual([...visitedTypes].sort((left, right) => left - right), [0, 2, 8, 10, 16, 17, 28, 29, 41, 69, 73, 81, 84, 86, 89, 91]);
  assert.equal(visitedWorkers.size, 8);
  context.diagnostic(`Native ground coverage: ${traces.length} cases, ${orderedWrites} ordered phase writes`);
  await context.test("unproved profiles, incomplete partitions and forged source maps reject atomically", () => {
    const trace = traces[0], frame = fromTrace(trace, configurations.HUMAN), slot = frame.producerSlots[0];
    const changedActor = (offset: number, value: number) => frame.actors.map((byte, index) => index === slot * 220 + offset ? value : byte);
    const candidates: LegacyNativeVisibilityFrame[] = [
      ...[1, 4, 5, 12, 13, 40].map(kind => ({ ...frame, actors: changedActor(6, kind) })),
      { ...frame, actors: changedActor(0x2c, 10) }, { ...frame, actors: changedActor(2, 1) },
      { ...frame, actors: changedActor(0xcb, 1) }, { ...frame, actors: changedActor(7, 8) },
      { ...frame, producerSlots: frame.producerSlots.slice(1) },
      { ...frame, excludedProducerSlots: [slot] }, { ...frame, highWater: 0 },
      { ...frame, registry: frame.registry.map((value, index) => index === slot ? -1 : value) },
      { ...frame, revealAll: 1 }, { ...frame, revealLocal: 1 },
      { ...frame, configuration: { ...frame.configuration, producerProfiles: { ...frame.configuration.producerProfiles, 5: "ground-unpruned" } } },
      { ...frame, configuration: { ...frame.configuration, types: frame.configuration.types.map((type, index) => index === 16 ? { ...type, metadata: 1 } : type) } },
    ];
    for (const candidate of candidates) {
      const before = structuredClone(candidate);
      assert.equal(reduceLegacyNativeVisibility(candidate).supported, false);
      assert.deepEqual(candidate, before);
    }
  });
});

test("source visibility matrix: troops, movement, native terrain occlusion, persistent exploration and exact cadence", async context => {
  const content = process.env.DC_VISIBILITY_MATRIX ? readFileSync(process.env.DC_VISIBILITY_MATRIX, "utf8")
    : execFileSync("python3", ["-B", `${root}tools/qa/native-visibility-native.py`, "--matrix"], {
      encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
    });
  const traces = content.trim().split("\n").map(line => JSON.parse(line) as NativeTrace);
  const configurations = { HUMAN: await createSourceNativeVisibilityConfiguration(assets("HUMAN")),
    ALIEN: await createSourceNativeVisibilityConfiguration(assets("ALIEN")) };
  let occludedCells = 0, naturalVictims = 0;
  for (const trace of traces) await context.test(trace.name, () => {
    const configuration = configurations[trace.faction as keyof typeof configurations], frame = fromTrace(trace, configuration);
    const before = structuredClone(frame), actual = reduceLegacyNativeVisibility(frame);
    assert.equal(actual.supported, true, actual.supported ? undefined : actual.diagnostic);
    if (!actual.supported) return;
    assert.deepEqual(actual.actors, Array.from(Buffer.from(trace.caller.actors, "base64")));
    assert.deepEqual(actual.ground, trace.caller.ground);
    assert.deepEqual(actual.air, trace.caller.air);
    assert.deepEqual(actual.extra, trace.caller.extra);
    assert.equal(actual.rngCursor, trace.caller.rngCursor);
    assert.equal(actual.crtSeed, trace.caller.crtSeed);
    assert.deepEqual(actual.registry, frame.registry);
    assert.deepEqual(actual.terrain, frame.terrain);
    assert.deepEqual(actual.randomAdvances, []);
    assert.deepEqual(actual.writes, trace.writes.map(({ plane, index, before, after }) => ({ plane, index, before, after })));
    assert.deepEqual(frame, before);
    assert.equal(actual.executed, (trace.counter & 15) === 0);
    if (!actual.executed) return;
    if (trace.staleMetadataControl) {
      assert.ok(frame.actors.some((value, index) => index % 220 === 0xca && value === 0xa5));
      assert.ok(actual.writes.some(write => write.plane === "ground" && (write.before & 0x3fc00) !== (write.after & 0x3fc00)));
      for (let slot = 0; slot <= frame.highWater; slot++) if (frame.actors[slot * 220 + 0x2c])
        assert.equal(actual.actors[slot * 220 + 0xca], 0);
    }
    const cleared = reduceLegacyNativeVisibility({ ...frame, actors: actual.actors, ground: actual.ground, phase: "clear" });
    assert.equal(cleared.supported, true);
    if (!cleared.supported) return;
    assert.deepEqual(cleared.ground, trace.persistent.ground);
    const again = reduceLegacyNativeVisibility({ ...frame, actors: cleared.actors, ground: cleared.ground, phase: "compute" });
    assert.equal(again.supported, true);
    if (!again.supported) return;
    assert.deepEqual(again.ground, trace.recomputed.ground);
    assert.deepEqual(again.actors, Array.from(Buffer.from(trace.recomputed.actors, "base64")));
    if (trace.victimSlot !== null) {
      const offset = trace.victimSlot * 220, cell = frame.actors[offset + 5] * configuration.width + frame.actors[offset + 1];
      assert.equal(frame.ground[cell] >>> 31, 0, "victim must start unexplored");
      assert.equal(actual.ground[cell] >>> 31, 1, "original visibility must naturally explore victim cell");
      assert.equal(cleared.ground[cell] >>> 31, 1, "death sound consumes persistent exploration, not current sight");
      assert.equal(cleared.ground[cell] & 0x7f800000, 0);
      assert.deepEqual(trace.soundGate, { before: [], computed: ["0x431e08"], cleared: ["0x431e08"], boundaryOnly: true });
      naturalVictims++;
    }
    for (const producer of actual.producers) {
      if (!producer.local) continue;
      const offset = producer.slot * 220, column = frame.actors[offset + 1], row = frame.actors[offset + 5];
      const stack = [configuration.roots[producer.radius]];
      while (stack.length) {
        const address = stack.pop()!;
        if (!address) continue;
        const node = configuration.nodes[address], x = column + node.x, y = row + node.y;
        if (x >= 0 && y >= 0 && x < configuration.width && y < configuration.height
          && actual.ground[y * configuration.width + x] >>> 31 === 0) occludedCells++;
        stack.push(...node.children);
      }
    }
  });
  assert.ok(naturalVictims >= 8, "nonvacuous source victim coverage");
  assert.ok(occludedCells > 0, "real terrain must prune at least one original tree branch");
  assert.ok(configurations.HUMAN.terrain.some(value => value & 0x03c00000), "source height metadata retained");
  const frame = fromTrace(traces[0], configurations.HUMAN);
  await context.test("atomic profile and source rejection", async () => {
    const badFrames: LegacyNativeVisibilityFrame[] = [
      { ...frame, configuration: structuredClone(frame.configuration) },
      { ...frame, revealAll: 1 }, { ...frame, revealLocal: 1 }, { ...frame, counter: -1 },
      { ...frame, daylight: 257 }, { ...frame, localMask: 0x80000000 },
      { ...frame, excludedProducerSlots: [] }, { ...frame, producerSlots: [...frame.producerSlots, ...frame.producerSlots] },
      { ...frame, actors: frame.actors.map((value, index) => index === frame.producerSlots[0] * 220 + 6 ? 5 : value) },
      { ...frame, terrain: frame.terrain.map((value, index) => index === 0 ? (value ^ 0x20000000) >>> 0 : value) },
    ];
    for (const candidate of badFrames) {
      const before = structuredClone(candidate), result = reduceLegacyNativeVisibility(candidate);
      assert.equal(result.supported, false);
      assert.deepEqual(candidate, before);
    }
    for (const field of ["executable", "gameStat", "scenario", "map", "bts", "mtg", "pth"] as const) {
      const altered = assets(); altered[field][altered[field].length - 1] ^= 1;
      await assert.rejects(createSourceNativeVisibilityConfiguration(altered), /source:/);
    }
  });
});