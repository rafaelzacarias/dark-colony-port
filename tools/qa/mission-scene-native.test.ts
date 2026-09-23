import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFin } from "../extractors/animations/fin.ts";
import { parseTerrainBank, resolveTerrainReferences } from "../extractors/maps/bts.ts";
import { parseMap } from "../extractors/maps/map.ts";
import { parseSprite } from "../extractors/sprites/spr.ts";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import { createMissionSceneFrame, missionOrdinarySceneAdmission, missionSceneCamera, type MissionSceneCamera } from "../../src/render/mission-scene-frame.ts";
import { withMissionTerrainCoverage, type MissionIndexedTerrain } from "../../src/render/mission-terrain.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const native = JSON.parse(execFileSync("python3", [new URL("../research/mission-scene-frame-20260919.py", import.meta.url).pathname], {
  encoding: "utf8", env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH,
    "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") },
}));

test("complete bounded ordinary admission runs through source gates and primary caller without hooks", () => {
  assert.equal(native.runtimeInterceptions, 0);
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(native.admission.length, 14);
  const children = parseFin(read(native.fin.path)).timeline[native.fin.timeline].children;
  const sample = { timelineIndex: native.fin.timeline, finished: false, children };
  const parts = composeFinSample(sample, (sprite, index) => {
    const source = parseSprite(read(`raw_cd/DC/SPRITES/${sprite.toUpperCase()}.SPR`)).frames[index];
    return { ...source, index, x: 0, y: 0, empty: false };
  });
  for (const fixture of native.admission) {
    const values = fixture.inputs;
    const result = missionOrdinarySceneAdmission({ rawSlot: 152, status: values.status, type: values.type,
      team: values.team, localTeam: 0, spyEnabled: Boolean(values.spy), tileVisibilityWord: values.visibility,
      localVisibilityMask: 1, concealedType: Boolean(values.concealed), detectedTeams: values.detected,
      revealAll: Boolean(values.reveal), xQ8: 384, yQ8: 384, bounds: { left: 0, bottom: 0, right: values.right, top: 128 },
      bankMode: values.bankMode, bankFrame: values.bankFrame, bankTimelineCount: 1 });
    assert.equal(result.bankFrame, fixture.bankFrameAfter, fixture.name);
    assert.equal(result.bankMode, fixture.bankModeAfter, fixture.name);
    assert.equal(result.admitted && values.accepted < 800 ? 1 : 0, fixture.accepted, fixture.name);
    const plan = createMissionSceneFrame({
      mission: { map: { width: 128, height: 128 }, tileRecordIndices: new Uint16Array(128 * 128 * 2),
        attributes: new Uint16Array(128 * 128) }, indexed: undefined, camera: { x: 0, y: 0, width: 192, height: 192 },
      entities: [{ rawSlot: 152, xSubcells: 384 * 4, ySubcells: 384 * 4, heightSubcells: 0,
        sample, parts, fallbackOrigin: { x: 0, y: 0 }, ordinaryPrimary: {
          admitted: result.admitted, acceptedBeforePrimary: values.accepted, effectsEnabled: true,
        } }],
    });
    assert.deepEqual(plan.submissions.map(({ submissionWord, sourceChildIndex }) => {
      const { position } = plan.commands.find(({ source }) => source.sourceChildIndex === sourceChildIndex)!.source;
      return { submissionWord, position: [position.x, position.y] };
    }), fixture.queued, fixture.name);
  }
});

for (const [label, evidence] of [["unmirrored", native], ["mirrored", native.mirrored]] as const) {
test(`original ${label} TRSC FIN and SPR match native framebuffer bytes and integer camera crops`, () => {
  for (const source of [evidence.fin, ...evidence.raster.sources]) assert.equal(hash(read(source.path)), source.sha256);
  const fin = parseFin(read(evidence.fin.path));
  const children = fin.timeline[evidence.fin.timeline].children;
  assert.deepEqual(children, evidence.children);
  assert.ok(children.every((child) => child.flags === 16 && child.valueA === 0 && child.valueB === (label === "mirrored" ? 1 : 0)));
  const sample = { timelineIndex: evidence.fin.timeline, finished: false, children };
  const sprites = new Map(children.map(({ sprite }) => [sprite, parseSprite(read(`raw_cd/DC/SPRITES/${sprite.toUpperCase()}.SPR`))]));
  const parts = composeFinSample(sample, (sprite, index) => {
    const frame = sprites.get(sprite)!.frames[index];
    return { ...frame, index, x: 0, y: 0, empty: frame.width === 0 || frame.height === 0 };
  });
  const bank = parseTerrainBank(read("raw_cd/DC/SCENARIO/DESERT.BTS"));
  const map = parseMap(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN01.MAP"));
  const { recordIndices } = resolveTerrainReferences(bank, map.tileReferences);
  const metadata = JSON.parse(read("public/assets/generated/indexed/terrain/DESERT.json").toString()) as MissionIndexedTerrain;
  const indices = read(`public/assets/generated/indexed/${metadata.indices.path}`);
  assert.equal(hash(indices), metadata.indices.sha256);
  const indexed = withMissionTerrainCoverage(metadata, indices);
  for (const [record, tile] of bank.tiles.entries()) {
    for (let row = 0; row < 32; row++) {
      let coverage = 0;
      for (let column = 0; column < 32; column++) if (tile.indices[row * 32 + column]) coverage |= 1 << (31 - column);
      assert.equal(indexed.sourceForegroundCoverage![record][row], coverage >>> 0);
    }
  }
  function background(camera: MissionSceneCamera): Buffer {
    return Buffer.from(Array.from({ length: camera.width * camera.height }, (_, offset) => {
      const worldX = camera.x + offset % camera.width, worldY = camera.y + Math.floor(offset / camera.width);
      const cell = Math.floor(worldY / 32) * map.width + Math.floor(worldX / 32);
      const attribute = map.attributes[cell];
      const background = recordIndices[cell * 2], foreground = recordIndices[cell * 2 + 1];
      const sourceY = (worldY & 31) * 32;
      const backgroundX = attribute & 0x20 ? 31 - (worldX & 31) : worldX & 31;
      const foregroundX = attribute & 0x40 ? 31 - (worldX & 31) : worldX & 31;
      return (foreground && bank.tiles[foreground].indices[sourceY + foregroundX]) || bank.tiles[background].indices[sourceY + backgroundX];
    }));
  }
  assert.equal(evidence.raster.frames.length, label === "mirrored" ? 8 : 4);
  for (const fixture of evidence.raster.frames) {
    const child = children[fixture.childIndex];
    assert.equal(map.attributes[fixture.sourceCell], fixture.attributes);
    assert.equal(fixture.writer, label === "mirrored" ? "0x46152c" : "0x461170");
    if (label === "mirrored") assert.notEqual(fixture.anchorX, 1);
    for (const [camera, expected] of [[fixture.camera, fixture.framebufferSha256], [fixture.cropCamera, fixture.cropSha256]] as const) {
      const output = background(camera);
      if (camera === fixture.camera) assert.equal(hash(output), fixture.backgroundSha256);
      const entity = { rawSlot: 152, sample, parts,
        xSubcells: (fixture.queuedX - child.x) * 32,
        ySubcells: (map.height * 32 - 1 - fixture.baseline + child.y) * 32,
        heightSubcells: 0, fallbackOrigin: { x: 0, y: 0 },
        ordinaryPrimary: { admitted: true, acceptedBeforePrimary: 0, effectsEnabled: true } };
      const plan = createMissionSceneFrame({ mission: { map, tileRecordIndices: recordIndices, attributes: map.attributes },
        indexed, camera, entities: [entity] });
      assert.equal(plan.commands.length, children.length);
      assert.equal(plan.submissions.length, children.length);
      for (const command of plan.commands) {
        assert.notEqual(command.clips, null, command.diagnostics.join(","));
        const source = sprites.get(command.source.part.child.sprite)!.frames[command.source.part.child.frame];
        for (const span of command.clips!) {
          for (let column = span.x; column < span.x + span.width; column++) {
            const offset = span.y * source.width + (command.source.part.mirrored ? source.width - 1 - column : column);
            if (!source.alpha[offset]) continue;
            output[(command.topLeft.y + span.y) * camera.width + command.topLeft.x + column] = source.indices[offset];
          }
        }
      }
      const original = Buffer.from(fixture.framebufferBase64, "base64");
      const expectedPixels = camera === fixture.camera ? original : Buffer.from(Array.from({ length: camera.width * camera.height }, (_, offset) =>
        original[(camera.y - fixture.camera.y + Math.floor(offset / camera.width)) * fixture.camera.width
          + camera.x - fixture.camera.x + offset % camera.width]));
      assert.equal(hash(expectedPixels), expected);
      const differences = Array.from(output.keys()).filter((offset) => output[offset] !== expectedPixels[offset]);
      assert.equal(differences.length, 0, JSON.stringify({ reflection: fixture.reflection, negativeEdge: fixture.negativeEdge,
        phase: fixture.phase, camera, differences: differences.slice(0, 12).map((offset) =>
          ({ x: offset % camera.width, y: Math.floor(offset / camera.width), actual: output[offset], expected: expectedPixels[offset] })) }));
      if (camera === fixture.cropCamera) assert.ok(plan.commands.some(({ topLeft }) => topLeft.x < 0 && topLeft.y < 0));
    }
  }
  assert.ok(evidence.raster.frames.some((fixture: { changedPixels: number }) => fixture.changedPixels > 0));
  assert.ok(evidence.raster.frames.every((fixture: { maskDifferencePixels: number }) => fixture.maskDifferencePixels > 0));
  if (label === "mirrored") {
    const fixture = evidence.raster.frames[0];
    const child = children[fixture.childIndex];
    const centerX = (fixture.camera.x + fixture.camera.width / 2) / 32;
    const centerY = (map.height * 32 - fixture.camera.y - fixture.camera.height / 2) / 32;
    for (const movement of [0, 1, 2, 15, 29, 30, 31, 32, 33, 62, 63, 64]) {
      const entity = { rawSlot: 152, sample, parts,
        xSubcells: (fixture.queuedX - child.x) * 32 + movement,
        ySubcells: (map.height * 32 - 1 - fixture.baseline + child.y) * 32 + movement,
        heightSubcells: 0, fallbackOrigin: { x: 0.25, y: 0.75 } };
      let reference: readonly unknown[] | undefined;
      for (const cameraFraction of [-0.49, 0, 0.49, 0.51, 1.49, 1.51]) {
        const camera = missionSceneCamera(centerX + cameraFraction / 32, centerY + cameraFraction / 32,
          map.height, fixture.camera.width, fixture.camera.height);
        const plan = createMissionSceneFrame({ mission: { map, tileRecordIndices: recordIndices, attributes: map.attributes },
          indexed, camera, entities: [entity] });
        const command = plan.commands[0];
        assert.notEqual(command.clips, null);
        assert.equal(plan.globalOrder, null);
        assert.equal(plan.orderingVerified, false);
        const worldLeft = (Math.round(entity.xSubcells / 4) >> 3) + child.x + 1;
        const worldTop = ((map.height * 256 - Math.round(entity.ySubcells / 4) - 1) >> 3) + child.y - parts[0].frame!.height;
        assert.deepEqual(command.topLeft, { x: worldLeft - camera.x, y: worldTop - camera.y });
        assert.deepEqual(command.compositionOrigin, { x: worldLeft - child.x - 1 - camera.x,
          y: worldTop - child.y + parts[0].frame!.height - camera.y });
        const normalized = [command.topLeft.x + camera.x, command.topLeft.y + camera.y, command.clips];
        if (reference) assert.deepEqual(normalized, reference, "camera quantization must not change world-space mask coverage");
        reference = normalized;
      }
    }
  }
});
}