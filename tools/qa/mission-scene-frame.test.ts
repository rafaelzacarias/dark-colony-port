import assert from "node:assert/strict";
import test from "node:test";
import { withMissionTerrainCoverage, type MissionIndexedTerrain } from "../../src/render/mission-terrain.ts";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import { createMissionSceneFrame, missionSceneCamera, missionSceneQ8, type MissionSceneEntity } from "../../src/render/mission-scene-frame.ts";

function sceneFixture() {
  const children = [
    { sprite: "body", frame: 0, x: 0, y: 0, flags: 16, layer: 0, valueA: 0, valueB: 0 },
    { sprite: "shadow", frame: 0, x: 0, y: 0, flags: 16, layer: 1, valueA: 1, valueB: 0 },
  ];
  const sample = { timelineIndex: 0, finished: false, children };
  const parts = composeFinSample(sample, () => ({ index: 0, x: 0, y: 0, width: 16, height: 40, anchorX: 0, anchorY: 0, empty: false }));
  const entity: MissionSceneEntity = { rawSlot: 152, xSubcells: 32 * 32, ySubcells: (128 - 64 - 1) * 32,
    heightSubcells: 0, sample, parts, fallbackOrigin: { x: 900, y: 901 },
    ordinaryPrimary: { admitted: true, acceptedBeforePrimary: 0, effectsEnabled: true } };
  return { mission: { map: { width: 4, height: 4 } as Parameters<typeof createMissionSceneFrame>[0]["mission"]["map"],
    tileRecordIndices: Uint16Array.from({ length: 32 }, () => 1), attributes: new Uint16Array(16).fill(4) },
  indexed: withMissionTerrainCoverage(indexedTerrain(), new Uint8Array(2048).fill(1)),
  camera: { x: 37, y: 30, width: 8, height: 24 }, entities: [entity] };
}

test("mixed frame keeps caller order and clips only normal bodies without IDs or queue sorting", () => {
  const input = sceneFixture();
  input.indexed.sourceForegroundCoverage![1].fill(0);
  const frame = createMissionSceneFrame(input);
  assert.equal(frame.orderingVerified, false);
  assert.equal(frame.globalOrder, null);
  assert.equal(frame.commands[0].source.part.child.sprite, "shadow");
  assert.equal(frame.commands[0].clips, null);
  const body = frame.commands[1];
  assert.deepEqual(body.topLeft, { x: -5, y: -6 });
  assert.equal(body.clips!.reduce((sum, span) => sum + span.width * span.height, 0), 8 * 24);
  assert.deepEqual(frame.submissions.map(({ sourceChildIndex, submissionWord }) => [sourceChildIndex, submissionWord]), [[0, 504], [1, 503]]);
  const calls: unknown[][] = [];
  const context = Object.fromEntries(["save", "restore", "beginPath", "rect", "clip", "translate", "scale", "drawImage"]
    .map((name) => [name, (...args: unknown[]) => calls.push([name, ...args])])) as unknown as CanvasRenderingContext2D;
  frame.drawEntity(context, 152, (name) => ({ name }) as unknown as CanvasImageSource);
  assert.deepEqual(calls.filter(([name]) => name === "translate"), [["translate", 900, 861], ["translate", -5, -6]]);
  assert.equal(calls.filter(([name]) => name === "clip").length, 1);
  assert.equal(calls.filter(([name]) => name === "save").length, calls.filter(([name]) => name === "restore").length);
});

test("queue evidence is optional for masks and incomplete primary lists never acquire invented words", () => {
  const input = sceneFixture();
  const entity = input.entities[0];
  const unknown = createMissionSceneFrame({ ...input, entities: [{ ...entity, ordinaryPrimary: undefined }] });
  assert.equal(unknown.submissions.length, 0);
  assert.notEqual(unknown.commands[1].clips, null);
  const missing = createMissionSceneFrame({ ...input, entities: [{ ...entity, parts: entity.parts.slice(1) }] });
  assert.equal(missing.submissions.length, 0);
  assert.ok(missing.diagnostics.some((value) => value.includes("headers-incomplete")));
  const full = createMissionSceneFrame({ ...input, entities: [{ ...entity,
    ordinaryPrimary: { admitted: true, acceptedBeforePrimary: 800, effectsEnabled: true } }] });
  assert.deepEqual(full.submissions, []);
  const capacity = createMissionSceneFrame({ ...input, entities: [{ ...entity,
    ordinaryPrimary: { admitted: true, acceptedBeforePrimary: 799, effectsEnabled: true } }] });
  assert.equal(capacity.submissions.length, 1);
});

test("camera rounding matches terrain edges and adapter rejects fabricated or ambiguous inputs", () => {
  assert.deepEqual(missionSceneCamera(10.01, 20.02, 128), { x: 64, y: 3229, width: 512, height: 452 });
  assert.equal(missionSceneQ8(2), 1);
  const input = sceneFixture();
  assert.throws(() => createMissionSceneFrame({ ...input, camera: { ...input.camera, x: 0.5 } }), /integer/);
  assert.throws(() => createMissionSceneFrame({ ...input, entities: [input.entities[0], input.entities[0]] }), /Duplicate/);
  assert.throws(() => createMissionSceneFrame({ ...input, entities: [{ ...input.entities[0], rawSlot: undefined as unknown as number }] }), /raw slot/);
  assert.throws(() => createMissionSceneFrame({ ...input, entities: [{ ...input.entities[0], sample: { ...input.entities[0].sample, children: [] } }] }), /references/);
});

test("primary effect filtering and capacity use accepted source order, not FIN paint order", () => {
  const input = sceneFixture();
  const original = input.entities[0];
  const effect = { ...original.sample.children[0], sprite: "effect", valueA: 3, layer: 2 };
  const sample = { ...original.sample, children: [effect, ...original.sample.children] };
  const parts = composeFinSample(sample, () => original.parts[0].frame);
  const entity = { ...original, sample, parts,
    ordinaryPrimary: { admitted: true, acceptedBeforePrimary: 0, effectsEnabled: false } };
  const plan = createMissionSceneFrame({ ...input, entities: [entity] });
  assert.deepEqual(plan.submissions.map(({ sourceChildIndex, submissionWord }) => [sourceChildIndex, submissionWord]), [[1, 504], [2, 503]]);
  assert.deepEqual(plan.commands.map(({ source }) => source.sourceChildIndex), [2, 1, 0]);
  assert.equal(plan.commands[2].clips, null);
  const enabled = createMissionSceneFrame({ ...input, entities: [{ ...entity,
    ordinaryPrimary: { ...entity.ordinaryPrimary, effectsEnabled: true } }] });
  assert.deepEqual(enabled.submissions.map(({ submissionWord }) => submissionWord), [504, 503, 502]);
});

function indexedTerrain(): MissionIndexedTerrain {
  return { schemaVersion: 1, palette: "fixture", atlas: { width: 64, height: 32 },
    indices: { path: "fixture", bytes: 2048, sha256: "", width: 64, height: 32, format: "R8UI" },
    tiles: [0, 1].map((recordIndex) => ({ recordIndex, key: recordIndex, x: recordIndex * 32,
      y: 0, width: 32, height: 32 })), keySpace: 2, keyToRecord: [0, 1] };
}

test("indexed terrain exposes 32 source-order coverage rows, independent of display colors", () => {
  const metadata = indexedTerrain();
  const indices = new Uint8Array(2048);
  indices[32] = 1;
  indices[63] = 255;
  indices[64 + 33] = 17;
  const terrain = withMissionTerrainCoverage(metadata, indices);
  assert.equal(metadata.sourceForegroundCoverage, undefined);
  assert.equal(terrain.sourceForegroundCoverage!.length, 2);
  assert.deepEqual(Array.from(terrain.sourceForegroundCoverage![0]), Array(32).fill(0));
  assert.equal(terrain.sourceForegroundCoverage![1].length, 32);
  assert.equal(terrain.sourceForegroundCoverage![1][0], 0x80000001);
  assert.equal(terrain.sourceForegroundCoverage![1][1], 0x40000000);
  indices.fill(0);
  assert.equal(terrain.sourceForegroundCoverage![1][0], 0x80000001);
  assert.throws(() => withMissionTerrainCoverage(metadata, new Uint8Array(1)), /atlas/);
});