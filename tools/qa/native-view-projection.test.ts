import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CampaignSession } from "../../src/engine/campaign-session";
import { nativeViewResourceIdentity, projectNativeView } from "../../src/engine/native-view-projection";
import { sourceNativeCombatActorSample } from "../../src/engine/source-native-combat-mission";
import { transportHostState } from "../../src/engine/transport-host";
import { MissionView } from "../../src/mission-view";
import type { FinAnimationData } from "../../src/render/fin-animation";
import { createNativeCombatMissionFixture, nativeCombatPacket } from "./fixtures/native-combat-mission";

const callbacks = { onStats() {}, onUnitsChanged() {} };
const canvas = (context: CanvasRenderingContext2D | null = null) => ({ width: 512, height: 452,
  getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;

test("native view compact transaction matches public steps for 20 frames and stays detached", async context => {
  const { mission, column, row } = await createNativeCombatMissionFixture();
  const compact = new CampaignSession(mission.sourceNativeCombat!.options), full = compact.fork();
  for (let counter = 1; counter <= 20; counter++) {
    const before = compact.nativeViewProjection;
    const source = before.transport.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 0);
    const input = { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0 },
      ...(counter === 17 ? { nativeAiReceipt: { id: `combat-view:${counter}`,
        packets: [nativeCombatPacket(source!.slot, column + 2, row, 7)],
        expected: before.transport.slots.flatMap(actor => actor?.nativeAiTask ? [{ slot: actor.slot,
          generation: actor.generation, key: actor.key, raw: actor.nativeAiTask.raw }] : []) } } : {}) };
    const result = compact.stepForNativeView(input), expected = full.step(input);
    if (!result.ok || !expected.ok) assert.fail(JSON.stringify({ result, expected }));
    assert.deepEqual(result.value, { ...projectNativeView(expected.value, transportHostState(expected.value.world)),
      entry: { requests: expected.value.entry.requests, commands: expected.value.entry.commands }, bailExpired: expected.value.bailExpired });
    assert.equal("nativeAiInputs" in result.value, false);
    assert.equal("entityBytes" in result.value.world, false);
    assert.equal("nativeAiTasks" in result.value.transport, false);
    assert.equal("configuration" in result.value.transport.nativeCombat, false);
    result.value.transport.slots.find(Boolean)!.health--;
    result.value.transport.registry.fill(null);
    result.value.visibility.groundWords.fill(0);
    (result.value.world.entities[0] as { health: number }).health--;
    assert.deepEqual(compact.nativeViewProjection, full.nativeViewProjection);
  }
  assert.deepEqual(compact.checkpoint(), full.checkpoint());
  assert.deepEqual(compact.journal, full.journal);
  const projection = compact.nativeViewProjection;
  assert.equal(projection.world.entities.length, 23);
  assert.ok(JSON.stringify(projection).length < 500_000);
  const snapshot = compact.snapshot, original = compact.nativeViewProjection;
  ((snapshot.world.transportState as ReturnType<typeof transportHostState>).nativeAiTasks!.configuration.profiles[0].ground as number[])[0] ^= 1;
  assert.deepEqual(compact.nativeViewProjection, original);
  const bad = { clockMilliseconds: 336, nativeAiFrame: { counter: 21, task6Budget: 0 },
    updates: [{ type: "position" as const, slot: projection.transport.slots.find(Boolean)!.slot, generation: 0, position: { x: 1, y: 1 } }] };
  const checkpoint = compact.checkpoint(), journal = compact.journal;
  assert.equal(compact.stepForNativeView(bad).ok, false);
  assert.deepEqual(compact.checkpoint(), checkpoint);
  assert.deepEqual(compact.journal, journal);
  const animation: FinAnimationData = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/TRSC.json", import.meta.url), "utf8"));
  const host = transportHostState(full.snapshot.world), actor = host.slots.find(actor => actor?.nativeAiTask && actor.unitType === 0)!;
  assert.deepEqual([...projection.visibility.groundWords], host.nativeAiTasks!.ground.map(word => word >>> 0));
  const sample = compact.nativeViewActorSample(animation, actor.slot, actor.generation, "TRSC");
  assert.deepEqual(sample, sourceNativeCombatActorSample(animation, actor, host.nativeAiTasks!.configuration.profiles[actor.nativeAiTask!.profile], "TRSC"));
  sample.sample.children.length = 0;
  assert.ok(compact.nativeViewActorSample(animation, actor.slot, actor.generation, "TRSC").sample.children.length > 0);
  assert.throws(() => compact.nativeViewActorSample(animation, actor.slot, actor.generation + 1, "TRSC"), /identity mismatch/);
  context.diagnostic(JSON.stringify({ projectionBytes: JSON.stringify(projection).length, publicBytes: JSON.stringify(full.snapshot).length }));
});

test("native view frozen resource identity retains every constructor guard", async () => {
  const { mission } = await createNativeCombatMissionFixture();
  const session = new CampaignSession(mission.sourceNativeCombat!.options), original = session.nativeViewProjection;
  const identity = nativeViewResourceIdentity(original), slot = original.resources[0].slot;
  for (const offset of [0, 2, 4, 6, 7, 9, 12, 0x14, 0x18, 0x19, 0x1a, 0x22, 0x2c, 0x32, 0x36, 0x37, 0x38, 0x46, 0x48, 0xd2]) {
    const changed = structuredClone(original);
    (changed.resources[0].raw as number[])[offset] ^= 1;
    assert.notEqual(nativeViewResourceIdentity(changed), identity);
  }
  for (const mutate of [
    (copy: typeof original) => { copy.transport.registry[slot] = null; },
    (copy: typeof original) => { copy.transport.generations[slot]++; },
    (copy: typeof original) => { copy.transport.slots[slot]!.resourceTask = {} as never; },
    (copy: typeof original) => { copy.transport.slots[slot]!.nativeAiTask = { profile: 0, raw: [] }; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => nativeViewResourceIdentity(changed), /ownership changed/);
  }
  for (const mutate of [
    (copy: typeof original) => { copy.transport.slots[slot]!.health--; },
    (copy: typeof original) => { copy.transport.slots[slot]!.position = { x: 1, y: 1 }; },
    (copy: typeof original) => { copy.transport.slots[slot]!.resource!.countdownWord--; },
    (copy: typeof original) => { (copy.world.entities.find(entity => entity.rawSlot === slot)! as { health: number }).health--; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.notEqual(nativeViewResourceIdentity(changed), identity);
  }
  const state = session.snapshot, host = transportHostState(state.world);
  assert.throws(() => projectNativeView(state, { ...host, resourceLifecycle: {} as never }), /exclusive/);
});

test("native view 20 advances and repeated render use no public world copies", async context => {
  const { mission, column, row } = await createNativeCombatMissionFixture();
  const drawing = new Proxy({} as CanvasRenderingContext2D, { get: () => () => {} });
  const view = new MissionView(canvas(drawing), {} as HTMLElement, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  await view.initializeNativeCombatPresentation(async url => readFileSync(new URL(`../../public${url}`, import.meta.url)));
  const descriptor = Object.getOwnPropertyDescriptor(CampaignSession.prototype, "snapshot")!;
  const clone = globalThis.structuredClone;
  let publicCopies = 0, fullHostCopies = 0;
  Object.defineProperty(CampaignSession.prototype, "snapshot", { ...descriptor, get() { publicCopies++; return descriptor.get!.call(this); } });
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    if (value && typeof value === "object" && "kind" in value && value.kind === "transport-host-v1" &&
      (value as ReturnType<typeof transportHostState>).nativeAiTasks?.configuration) fullHostCopies++;
    return clone(value, options);
  }) as typeof structuredClone;
  const advances: number[] = [], preparation: number[] = [], renders: number[] = [];
  try {
    for (let counter = 1; counter <= 20; counter++) {
      const start = performance.now(), state = view.nativeCombatFrameState;
      const source = state.actors.find(actor => actor.key.startsWith("transport:") && actor.team === 0);
      const input = { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0 },
        ...(counter === 17 ? { nativeAiReceipt: { id: `combat-view:${counter}`, packets: [nativeCombatPacket(source!.slot, column + 2, row, 7)],
          expected: state.actors.flatMap(actor => actor.raw ? [{ slot: actor.slot, generation: actor.generation, key: actor.key, raw: actor.raw }] : []) } } : {}) };
      preparation.push(performance.now() - start);
      const advanceStart = performance.now(); view.advanceNativeCombat(input); advances.push(performance.now() - advanceStart);
    }
    const before = view.nativeCombatFrameState;
    const changed = view.nativeCombatFrameState;
    changed.actors.find(actor => actor.raw)!.raw!.fill(0);
    assert.deepEqual(view.nativeCombatFrameState, before);
    const poses = view.resourceSources;
    (poses[0].presentation!.sample.children as unknown[]).length = 0;
    assert.ok(view.resourceSources[0].presentation!.sample.children.length > 0);
    for (let iteration = 0; iteration < 20; iteration++) {
      const start = performance.now(); view.render(); renders.push(performance.now() - start);
    }
    assert.equal(publicCopies, 0);
    assert.equal(fullHostCopies, 0);
    assert.equal(view.nativeCombatFrameState.cycleCounter, 20);
    assert.equal(view.nativeCombatFrameState.actors.filter(actor => actor.status !== 0).length, 23);
    const originalCheckpoint = view.simulation.checkpoint.bind(view.simulation);
    view.simulation.checkpoint = () => { const checkpoint = originalCheckpoint(); checkpoint.staticTargets[0].health--; return checkpoint; };
    assert.throws(() => view.advanceNativeCombat({ clockMilliseconds: 336, nativeAiFrame: { counter: 21, task6Budget: 0 } }), /projection mutated/);
    view.simulation.checkpoint = originalCheckpoint;
    context.diagnostic(JSON.stringify({ timestamp: new Date().toISOString(), advances, preparation, renders,
      publicCopies, fullHostCopies, renderScope: "Canvas CPU mock; no loaded sprite atlases or GPU" }));
  } finally {
    Object.defineProperty(CampaignSession.prototype, "snapshot", descriptor);
    globalThis.structuredClone = clone;
  }
});

test("native view loaded FIN render caches samples once per committed revision", async context => {
  const { mission, column, row } = await createNativeCombatMissionFixture();
  let draws = 0, samples = 0, publicCopies = 0;
  const drawing = new Proxy({
    drawImage() { draws++; },
    createImageData(width: number, height: number) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
    getImageData(_left: number, _top: number, width: number, height: number) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as unknown as CanvasRenderingContext2D;
  const view = new MissionView(canvas(drawing), {} as HTMLElement, callbacks, mission);
  for (let counter = 1; counter <= 20; counter++) view.advanceNativeCombat({ clockMilliseconds: counter * 16,
    nativeAiFrame: { counter, task6Budget: 0 } });
  const originals = new Map(["fetch", "Image", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const read = (url: string) => readFileSync(new URL(`../../public${url}`, import.meta.url));
  class MockImage extends EventTarget {
    width = 0;
    height = 0;
    decoding = "async";
    set src(url: string) {
      const bytes = read(url);
      this.width = bytes.readUInt32BE(16); this.height = bytes.readUInt32BE(20);
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(CampaignSession.prototype, "snapshot")!;
  const sample = CampaignSession.prototype.nativeViewActorSample;
  try {
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string) => new Response(Uint8Array.from(read(url))) });
    Object.defineProperty(globalThis, "Image", { configurable: true, value: MockImage });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0,
      getContext: (kind: string) => kind === "2d" ? drawing : null }) } });
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    CampaignSession.prototype.nativeViewActorSample = function (...args) { samples++; return sample.apply(this, args); };
    Object.defineProperty(CampaignSession.prototype, "snapshot", { ...descriptor, get() { publicCopies++; return descriptor.get!.call(this); } });
    view.setCameraCenter(column + 0.5, row + 0.5);
    assert.ok(samples > 0, "camera must actually draw a native actor with authenticated FIN");
    const initialSamples = samples, initialDraws = draws, renders: number[] = [];
    for (let iteration = 0; iteration < 20; iteration++) {
      const start = performance.now(); view.render(); renders.push(performance.now() - start);
    }
    assert.equal(samples, initialSamples);
    assert.ok(draws > initialDraws);
    view.advanceNativeCombat({ clockMilliseconds: 336, nativeAiFrame: { counter: 21, task6Budget: 0 } });
    view.render();
    assert.ok(samples > initialSamples);
    const committedSamples = samples; view.render();
    assert.equal(samples, committedSamples);
    assert.equal(publicCopies, 0);
    assert.equal(view.missionDiagnostic, undefined);
    context.diagnostic(JSON.stringify({ timestamp: new Date().toISOString(), renders, samples, publicCopies,
      drawCalls: draws - initialDraws, renderScope: "real FIN/atlas/indexed metadata, mock Canvas2D; no pixel/GPU claim" }));
  } finally {
    view.dispose();
    CampaignSession.prototype.nativeViewActorSample = sample;
    Object.defineProperty(CampaignSession.prototype, "snapshot", descriptor);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});