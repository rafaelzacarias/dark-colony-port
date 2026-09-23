import assert from "node:assert/strict";
import test from "node:test";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import { stageMissionMode3Prepass, type MissionSceneBody } from "../../src/render/mission-scene-frame.ts";
import { nativeMode3Filter } from "../../src/render/mode3-effect.ts";

function fixture() {
  const children = [1, 3].map(value => ({ sprite: String(value), frame: 0, x: 0, y: 0,
    flags: 16, layer: 1, valueA: 3, valueB: 0 }));
  const sample = { timelineIndex: 0, finished: false, children };
  const parts = composeFinSample(sample, () => ({ index: 0, x: 0, y: 0, width: 1, height: 1,
    anchorX: 0, anchorY: 0, empty: false }));
  const entity = { rawSlot: 120, xSubcells: 0, ySubcells: 0, heightSubcells: 0, sample, parts, fallbackOrigin: { x: 0, y: 0 } };
  const bodies: MissionSceneBody[] = parts.map(part => ({ entity, part, sourceChildIndex: children.findIndex(child => child === part.child),
    position: { x: 2, y: 3, heightOffset: 0 } }));
  return { entities: [entity], bodies, terrain: [{ kind: "terrain" as const, column: 0, row: 0, backgroundIndex: 0, foregroundIndex: 0, attributes: 0 }],
    surface: { x: 0, y: 0, width: 32, height: 32, indices: new Uint8Array(1024).fill(1) },
    enabled: true, queue: [0, 1].map(sourceChildIndex => ({ rawSlot: 120, sourceChildIndex })),
    sprite: (body: MissionSceneBody) => ({ width: 1, height: 1, indices: Uint8Array.of(Number(body.part.child.sprite)), coverage: Uint8Array.of(255) }) };
}

test("bounded prepass accumulates in captured queue order, not FIN paint order, without committing input", () => {
  const input = fixture();
  const result = stageMissionMode3Prepass(input);
  assert.equal(result.exact, true, JSON.stringify(result.exact ? {} : result));
  if (!result.exact) return;
  assert.equal(result.illumination.indices[66], nativeMode3Filter(3, nativeMode3Filter(1, 1)));
  assert.deepEqual([...result.owned], ["120:0", "120:1"]);
  const reverse = stageMissionMode3Prepass({ ...input, queue: [...input.queue].reverse() });
  assert.equal(reverse.exact, true);
  if (reverse.exact) assert.notEqual(reverse.illumination.indices[66], result.illumination.indices[66]);
  assert.ok(input.surface.indices.every(value => value === 1));
});

test("bounded prepass rejects a late unsupported child, incomplete queue, clipping and oversized surface atomically", () => {
  const input = fixture();
  const original = input.entities[0];
  const children = original.sample.children.map((child, index) => index === 1 ? { ...child, flags: 0 } : child);
  const entity = { ...original, sample: { ...original.sample, children },
    parts: original.parts.map((part, index) => ({ ...part, child: children[index] })) };
  const bad = input.bodies.map(body => ({ ...body, entity, part: entity.parts[body.sourceChildIndex] }));
  for (const candidate of [{ ...input, entities: [entity], bodies: bad }, { ...input, queue: input.queue.slice(1) },
    { ...input, surface: { ...input.surface, x: 0.25 } },
    { ...input, surface: { ...input.surface, width: 512, height: 452, indices: new Uint8Array(512 * 452) } }]) {
    const result = stageMissionMode3Prepass(candidate);
    assert.equal(result.exact, false);
    assert.ok(input.surface.indices.every(value => value === 1));
  }
});