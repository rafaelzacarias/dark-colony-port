import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createNativeCombatMissionFixture, nativeCombatInput } from "./fixtures/native-combat-mission";
import { CampaignSession } from "../../src/engine/campaign-session";
import { transportHostState } from "../../src/engine/transport-host";
import { createSourceNativeCombatPresentation } from "../../src/engine/source-native-combat-presentation";
import { MissionView } from "../../src/mission-view";
import { composeFinSample, createFinFrameLookup, drawFinComposition, type FinAtlasFrame } from "../../src/render";

test("native combat VENT fresh source-field presentation without resource ownership", async context => {
  const { mission } = await createNativeCombatMissionFixture();
  const world = new CampaignSession(mission.sourceNativeCombat!.options).snapshot.world;
  const host = transportHostState(world);
  const loadBytes = async (url: string) => readFileSync(new URL(`../../public${url}`, import.meta.url));
  const present = await createSourceNativeCombatPresentation(mission, loadBytes);
  const poses = present(world);
  const native = JSON.parse(process.env.DC_NATIVE_COMBAT_PRESENTATION_TRACE
    ? readFileSync(process.env.DC_NATIVE_COMBAT_PRESENTATION_TRACE, "utf8")
    : execFileSync("python3", ["-B", new URL("source-native-combat-presentation-native.py", import.meta.url).pathname],
      { encoding: "utf8", env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as {
        executableSha256: string; resourceVisits: number; sourceEntry: string;
        mission: { sha256: string; records: { slot: number; row: number[]; direction: number; constructor: {
          raw220: number[]; standField: number; task: number; taskDepth: number; taskWords: number[];
          pendingOrder: number; order: number;
          animation: { bank: number; frame: number; delay: number; mode: number; sourceTimeline: number };
        } }[] };
      };
  assert.equal(native.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(native.mission.sha256, mission.scenario.source.sha256);
  assert.equal(native.resourceVisits, 0);
  assert.equal(native.sourceEntry, "0x41b9ce..0x41c7ee");
  const vents = world.entities.filter(entity => entity.unitType === 40);
  assert.equal(vents.length, 4);
  assert.equal(poses.length, 4);
  for (const entity of vents) {
    const actor = host.slots[entity.rawSlot!]!;
    const raw = Buffer.from(world.entityBytes!.slice(entity.rawSlot! * 220, (entity.rawSlot! + 1) * 220));
    assert.equal(actor.resourceTask, undefined);
    assert.equal(raw[9], 0);
    assert.equal(raw[0x1a], 0);
    assert.equal(raw.readUInt32LE(0x14), 0, "source-field projection must not fabricate native pointers");
    const sample = poses.find(pose => pose.slot === actor.slot)!.sample;
    const original = native.mission.records.find(record => record.slot === actor.slot)!;
    const constructor = original.constructor, nativeRaw = Buffer.from(constructor.raw220);
    assert.equal(nativeRaw.length, 220);
    assert.equal(original.direction, raw[9]);
    assert.equal(constructor.animation.bank, constructor.standField);
    assert.notEqual(constructor.standField, 0);
    for (const offset of [0x14, 0x1c, 0x24]) assert.equal(nativeRaw.readUInt32LE(offset), constructor.standField);
    assert.deepEqual([...nativeRaw.subarray(0x18, 0x1c)], [0, 0, 0, 0]);
    assert.deepEqual([...nativeRaw.subarray(0x20, 0x24)], [0, 0, 2, 0]);
    assert.deepEqual([...nativeRaw.subarray(0x28, 0x2c)], [0, 0, 2, 0]);
    assert.deepEqual([constructor.animation.frame, constructor.animation.delay, constructor.animation.mode], [0, 0, 0]);
    assert.deepEqual([constructor.task, constructor.taskDepth, constructor.pendingOrder, constructor.order], [1, 0, 0, 0]);
    assert.deepEqual(constructor.taskWords.slice(0, 3), [65535, 0, 0]);
    assert.equal(sample.timelineIndex, constructor.animation.sourceTimeline);
    assert.ok(sample.children.length > 0);
  }
  assert.equal(host.resourceLifecycle, undefined);
  const later = { ...structuredClone(world), clockMilliseconds: 90000 };
  assert.deepEqual(present(later), poses);
  const canvas = { width: 512, height: 452, getContext: () => null } as unknown as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  const before = view.checkpoint();
  await view.initializeNativeCombatPresentation(loadBytes);
  assert.deepEqual(view.checkpoint(), before);
  assert.equal(view.resourceSources.length, 4);
  assert.ok(view.resourceSources.every(source => source.task === undefined && source.presentation));
  assert.equal(view.resourceWorkflow.harvestEnabled, false);
  const sourcePoses = view.resourceSources.map(source => source.presentation);
  view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  assert.equal(view.campaignSnapshot!.cycleCounter, 1);
  assert.deepEqual(view.resourceSources.map(source => source.presentation), sourcePoses);
  assert.ok(view.resourceSources.every(source => source.task === undefined));

  await context.test("authenticated source composition draws a frozen frame", () => {
    const atlases = Object.fromEntries([...new Set(poses.flatMap(pose => pose.sample.children.map(child => child.sprite)))].map(sprite => {
      const atlas: { frames: FinAtlasFrame[] } = JSON.parse(readFileSync(
        new URL(`../../public/assets/generated/sprites/SPRITES/${sprite}.json`, import.meta.url), "utf8"));
      return [sprite, atlas];
    }));
    const lookup = createFinFrameLookup(atlases);
    let draws = 0;
    const drawing = { save() {}, restore() {}, translate() {}, scale() {}, strokeRect() {},
      drawImage() { draws++; } } as unknown as CanvasRenderingContext2D;
    for (const pose of poses) {
      const parts = composeFinSample(pose.sample, lookup);
      assert.ok(parts.length > 0 && parts.every(part => part.frame));
      assert.deepEqual(parts.flatMap(part => part.diagnostics), ["native-draw-mode:5", "native-draw-mode:3", "native-draw-mode:5"]);
      drawFinComposition(drawing, parts, () => canvas, { x: 100, y: 100 }, 1);
    }
    assert.equal(draws, 16);
    assert.deepEqual(present(world), poses);
  });

  await context.test("changed raw, identity, resource owner and source reject", () => {
    const slot = 166;
    const changeHost = (copy: typeof world, mutate: (host: ReturnType<typeof transportHostState>) => void) => {
      const state = transportHostState(copy);
      mutate(state);
      return { ...copy, transportState: state };
    };
    for (const offset of [0, 2, 4, 6, 7, 9, 12, 0x14, 0x18, 0x19, 0x1a, 0x22, 0x2c, 0x32, 0x36, 0x37, 0x38, 0x46, 0x48, 0xd2]) {
      const changed = structuredClone(world);
      changed.entityBytes![slot * 220 + offset] ^= 1;
      assert.throws(() => present(changed), /fresh constructor changed/, `raw byte ${offset}`);
    }
    for (const mutate of [
      (copy: typeof world) => changeHost(copy, state => { state.slots[slot]!.generation++; }),
      (copy: typeof world) => changeHost(copy, state => { state.slots[slot]!.health--; }),
      (copy: typeof world) => changeHost(copy, state => { state.slots[slot]!.position = { ...state.slots[slot]!.position, x: 1 }; }),
      (copy: typeof world) => changeHost(copy, state => { state.slots[slot]!.resource!.countdownWord--; }),
      (copy: typeof world) => changeHost(copy, state => { state.registry[slot] = null; }),
      (copy: typeof world) => ({ ...copy, entities: copy.entities.filter(entity => entity.rawSlot !== slot) }),
      (copy: typeof world) => changeHost(copy, state => { state.resourceLifecycle = {} as never; }),
      (copy: typeof world) => changeHost(copy, state => { state.slots[slot]!.resourceTask = {} as never; }),
      (copy: typeof world) => ({ ...copy, sessionId: `${copy.sessionId}-changed` }),
    ]) {
      assert.throws(() => present(mutate(structuredClone(world))), TypeError);
    }
    const returned = present(world);
    returned[0].sample.children = [];
    assert.deepEqual(present(world), poses, "returned presentation cannot mutate authenticated samples");
  });

  await context.test("forged FIN/config and normal mission fallback reject", async () => {
    await assert.rejects(createSourceNativeCombatPresentation(mission, async url => {
      const bytes = Uint8Array.from(await loadBytes(url));
      if (url.endsWith("/VENT.json")) bytes[bytes.length - 1] ^= 1;
      return bytes;
    }), /FIN hash mismatch/);
    const options = mission.sourceNativeCombat!.options;
    const forged = { ...mission, sourceNativeCombat: { ...mission.sourceNativeCombat!, options: {
      ...options, nativeAiTasks: { ...options.nativeAiTasks, bindings: options.nativeAiTasks.bindings.map((binding, index) => ({
        ...binding, raw: binding.raw.map((byte, offset) => index === 0 && offset === 9 ? byte ^ 1 : byte),
      })) },
    } } };
    await assert.rejects(createSourceNativeCombatPresentation(forged, loadBytes), /source authentication/);
    const normal = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} },
      { ...mission, sourceNativeCombat: undefined });
    assert.ok(normal.missionDiagnostic, "normal boot remains blocked without resource configuration");
    assert.equal(normal.resourceWorkflow.enabled, false);
    await assert.rejects(createSourceNativeCombatPresentation({ ...mission, sourceNativeCombat: undefined }, loadBytes),
      /exclusive authenticated combat session/);
    await assert.rejects(normal.initializeNativeCombatPresentation(loadBytes), /active source-bound view/);
  });
});