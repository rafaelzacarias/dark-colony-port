import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import { compareNativeSceneSprites, composeSceneFrame, nativeSceneCutoff, nativeScenePosition,
  type SceneSpriteInput, type SceneTerrainCommand } from "../../src/render/scene-composition.ts";

const native = JSON.parse(execFileSync("python3", [new URL("../research/scene-occlusion-20260919.py", import.meta.url).pathname], {
  env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH, "/tmp/dc-re-capstone-20260918",
    "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") }, encoding: "utf8",
}));

function sprite(id = "body", layer = 0, submissionWord = 100, x = 48): SceneSpriteInput {
  const [part] = composeFinSample({ timelineIndex: 0, finished: false, children: [
    { sprite: "fixture", frame: 0, x: -12, y: 3, flags: 16, layer, valueA: 0, valueB: 0 },
  ] }, () => ({ index: 0, x: 0, y: 0, width: 48, height: 160, anchorX: 0, anchorY: 99, empty: false }));
  return { id, part, submissionWord, position: { x, y: 210, heightOffset: 0 } };
}

function terrain(nibble: number): SceneTerrainCommand[] {
  return Array.from({ length: 32 }, (_, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    return { kind: "terrain", column, row, backgroundIndex: 1, foregroundIndex: 2,
      attributes: column === 1 ? nibble : Math.max(0, nibble - 2),
      foregroundMask: Uint32Array.from({ length: 32 }, (_, localY) => {
        let mask = 0;
        for (let bit = 0; bit < 32; bit += 1) {
          if ((column * 32 + bit + 3 * (row * 32 + localY)) % 7 < 3) mask |= 1 << (31 - bit);
        }
        return mask >>> 0;
      }) };
  });
}

test("normal body draw-plan pixels match complete native x86 tall-foreground fixtures", () => {
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  for (const fixture of native.body) {
    const tiles = terrain(fixture.nibble);
    const source = sprite();
    const plan = composeSceneFrame({ terrain: tiles, sprites: [source] });
    assert.equal(plan.verifiedSubset, true);
    assert.deepEqual(plan.commands.slice(0, tiles.length), tiles);
    const command = plan.commands.at(-1)!;
    assert.equal(command.kind, "sprite");
    if (command.kind !== "sprite") throw new Error("Expected sprite");
    assert.equal(command.source, source);
    assert.deepEqual(command.compositionOrigin, { x: 60, y: 207 });
    const output = Buffer.alloc(128 * 256, 0xee);
    let pixels = 0;
    for (const span of command.clips!) {
      for (let column = span.x; column < span.x + span.width; column += 1) {
        if (fixture.transparentRemap && (column + span.y) % 11 === 3) continue;
        const value = 1 + (column + span.y) % 200;
        output[(command.topLeft.y + span.y) * 128 + command.topLeft.x + column] = fixture.transparentRemap ? (value + 37) & 255 : value;
        pixels += 1;
      }
    }
    assert.equal(pixels, fixture.visiblePixels);
    assert.equal(createHash("sha256").update(output).digest("hex"), fixture.framebufferSha256);
  }
});

test("global child comparator matches native crowded priority, submission and signed X ties", () => {
  const sprites = native.comparator.crowded.map((record: { id: string; layer: number; submissionWord: number; x: number }) =>
    sprite(record.id, record.layer, record.submissionWord, record.x));
  assert.deepEqual([...sprites].sort(compareNativeSceneSprites).map((entry) => entry.id), native.comparator.stableComparatorOrder);
  assert.deepEqual([...sprites.slice(0, -1)].sort(compareNativeSceneSprites).map((entry) => entry.id), native.comparator.nativeSortUniqueOrder);
  const plan = composeSceneFrame({ terrain: terrain(0), sprites });
  assert.ok(plan.diagnostics.includes("native-equal-key-sort-stability-unverified"));
  assert.equal(plan.verifiedSubset, false);
  assert.equal(compareNativeSceneSprites(sprite("negative", 0, 100, -1), sprite("positive", 0, 100, 1)), 2);
  assert.equal(compareNativeSceneSprites(sprite("wrapped", 255), sprite("base")), (-(384000 << 16)) | 0);
});

test("queue origin uses arithmetic eighth shifts, minus one, and word stores", () => {
  for (const fixture of native.origin) {
    assert.deepEqual(nativeScenePosition(fixture.position, fixture.position, fixture.position, 32768),
      { x: fixture.x, y: fixture.y, heightOffset: fixture.elevation });
  }
  assert.deepEqual(nativeScenePosition(262144, 0, 0, 8), { x: -32768, y: 0, heightOffset: 0 });
  assert.throws(() => nativeScenePosition(0.5, 0, 0, 0), RangeError);
});

test("MAP cutoff clears only the low nibble for resolved foreground zero", () => {
  for (const fixture of native.cutoff.tallForeground) {
    assert.equal(nativeSceneCutoff(fixture.height, fixture.localY, fixture.nibble | 0x60, 2), fixture.cutoff);
    assert.equal(nativeSceneCutoff(fixture.height, fixture.localY, fixture.nibble | 0x60, 0), 174);
  }
});

test("coverage reflects only foreground, and layer 2 bypasses the mask", () => {
  const tiles = terrain(8);
  const draw = (commands: SceneTerrainCommand[], layer = 0) => composeSceneFrame({ terrain: commands, sprites: [sprite("body", layer)] }).commands.at(-1)!;
  const plain = draw(tiles);
  assert.deepEqual(draw(tiles.map((cell) => ({ ...cell, attributes: cell.attributes | 0x20 }))), plain);
  assert.notDeepEqual(draw(tiles.map((cell) => ({ ...cell, attributes: cell.attributes | 0x40 }))), plain);
  const bypass = draw(tiles, 2);
  assert.equal(bypass.kind, "sprite");
  if (bypass.kind === "sprite") assert.equal(bypass.clips!.reduce((sum, span) => sum + span.width, 0), 48 * 160);
});

test("unsupported modes and incomplete MAP coverage remain explicit, never silently clipped", () => {
  const base = sprite();
  for (const altered of [
    { ...base, part: { ...base.part, mirrored: true } },
    { ...base, part: { ...base.part, child: { ...base.part.child, valueB: 1 } } },
    { ...base, part: { ...base.part, child: { ...base.part.child, valueB: 2 } } },
    { ...base, part: { ...base.part, child: { ...base.part.child, valueA: 1 } } },
    { ...base, position: { ...base.position, heightOffset: -1 } },
  ]) {
    const plan = composeSceneFrame({ terrain: terrain(8), sprites: [altered] });
    assert.equal(plan.verifiedSubset, false);
    const command = plan.commands.at(-1)!;
    if (command.kind !== "sprite") throw new Error("Expected sprite");
    assert.equal(command.clips, null);
    assert.ok(command.diagnostics.length);
  }
  assert.equal(composeSceneFrame({ terrain: [], sprites: [base] }).verifiedSubset, false);
  assert.equal(composeSceneFrame({ terrain: terrain(8).map(({ foregroundMask: _mask, ...cell }) => cell), sprites: [base] }).verifiedSubset, false);
  assert.throws(() => composeSceneFrame({ terrain: [], sprites: [base, base] }), /Duplicate/);
  assert.throws(() => composeSceneFrame({ terrain: [], sprites: Array(801).fill(base) }), /800/);
  assert.equal(composeSceneFrame({ terrain: terrain(0), sprites: [
    { ...base, part: { ...base.part, x: base.part.x + 0.5 } },
  ] }).verifiedSubset, false);
  assert.throws(() => composeSceneFrame({ terrain: [], sprites: [base, sprite("overflow", 0, 32768)] }), /overflow/);
});