import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createFinFrameLookup, createFinSelector, directionFromMotion, finCanvasPlacement,
  finChildPlacements, finSourceDuration, TRSC_GRAY_VISUAL_DIRECTIONS, worldYSubcells,
  type CompassDirection, type FinAnimationData, type FinAtlasFrame, type FinChildData,
} from "../../src/render/fin-animation.ts";
import { parseFin } from "../extractors/animations/fin.ts";
import { composeFinSample, createFinSourceSampler, drawFinComposition, finSourcePlacement } from "../../src/render/fin-composition.ts";
import { createAtlasCache } from "../../src/render/atlas-cache.ts";

const options = { prefix: "TEST", directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "ascending" as const };
const child: FinChildData = { sprite: "test", frame: 42, x: -159, y: 3, layer: 0 };
const frame: FinAtlasFrame = { index: 42, x: 50, y: 60, width: 28, height: 45, anchorX: 147, anchorY: 99, empty: false };

test("source FIN duration uses the loader's signed-word conversion and runtime low byte", () => {
  assert.deepEqual([0, 1, 15, 20, 100, 65535].map(finSourceDuration), [2, 0, 2, 3, 15, 0]);
  assert.throws(() => finSourceDuration(-1), RangeError);
  assert.throws(() => finSourceDuration(1.5), RangeError);
});

test("native unmirrored placement adds horizontal crop and subtracts height, never anchorY", () => {
  assert.deepEqual(finSourcePlacement(child, frame), { x: -12, y: -42 });
  assert.deepEqual(finSourcePlacement(child, { ...frame, anchorY: 999 }), { x: -12, y: -42 });
  assert.deepEqual(finSourcePlacement({ ...child, x: -32, y: 5 }, {
    ...frame, anchorX: 21, anchorY: 11, height: 38,
  }), { x: -11, y: -33 });
});

test("source composition preserves all children, native layer priority, mirror and unsupported diagnostics", () => {
  const parts = composeFinSample({ timelineIndex: 0, finished: false, children: [
    { ...child, flags: 16, valueA: 0, valueB: 0 },
    { ...child, sprite: "effect", layer: 1, flags: 16, valueA: 3, valueB: 1 },
    { ...child, sprite: "missing", layer: 2 },
  ] }, (sprite) => sprite === "missing" ? undefined : frame);
  assert.deepEqual(parts.map(({ child }) => child.sprite), ["effect", "test", "missing"]);
  assert.equal(parts[0].x, child.x + 1);
  assert.equal(parts[0].mirrored, true);
  assert.deepEqual(parts[0].diagnostics, ["native-draw-mode:3"]);
  assert.deepEqual(parts[1].diagnostics, []);
  assert.ok(parts[2].diagnostics.includes("missing-atlas-frame"));
});

test("source sampling preserves unequal durations and empty death entries", () => {
  const animation: FinAnimationData = {
    states: [{ name: "TESTDIE0", firstTimelineIndex: 0, lastTimelineIndex: 2 }],
    timeline: [{ field2: 6, children: [child] }, { field2: 13, children: [child] }, { field2: 0, children: [] }],
  };
  const selection = createFinSelector(animation, options).select("Die", "S")!;
  const sample = createFinSourceSampler(animation);
  assert.deepEqual([0, 0.9, 1, 2, 3, 4, 5, 100].map((updates) => sample(selection, updates).timelineIndex),
    [0, 0, 1, 1, 2, 2, 2, 2]);
  assert.equal(sample(selection, 4).finished, false);
  assert.equal(sample(selection, 5).finished, true);
  assert.deepEqual(sample(selection, 100).children, []);
  assert.equal(sample({ ...selection, action: "Move" }, 5).timelineIndex, 0);
  assert.throws(() => sample(selection, Infinity), RangeError);
});

test("shared atlas cache coalesces names, bounds concurrency and retention, retries failures", async () => {
  const calls: string[] = [];
  let active = 0;
  let maximum = 0;
  const cache = createAtlasCache(async (name) => {
    calls.push(name);
    active += 1;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active -= 1;
    if (name === "BAD") throw new Error("missing");
    return name;
  }, { retained: 2, concurrent: 1, pending: 3 });
  assert.equal(cache.load("one"), cache.load("ONE"));
  assert.deepEqual(await Promise.all([cache.load("ONE"), cache.load("two"), cache.load("three")]), ["ONE", "TWO", "THREE"]);
  assert.equal(maximum, 1);
  assert.equal(cache.size, 2);
  await cache.load("one");
  assert.equal(calls.filter((name) => name === "ONE").length, 2);
  await assert.rejects(cache.load("bad"));
  await assert.rejects(cache.load("BAD"));
  assert.equal(calls.filter((name) => name === "BAD").length, 2);
});

test("atlas queue has a hard pending bound without rejecting duplicate requests", async () => {
  let release: (value: string) => void = () => {};
  const cache = createAtlasCache(() => new Promise<string>((resolve) => { release = resolve; }),
    { retained: 1, concurrent: 1, pending: 1 });
  const first = cache.load("one");
  assert.equal(cache.load("ONE"), first);
  await assert.rejects(cache.load("two"), /pending limit/);
  await assert.rejects(cache.load("..\/escape"), /Invalid atlas/);
  release("ONE");
  assert.equal(await first, "ONE");
  assert.equal(cache.pending, 0);
});

test("missing FIN art retains diagnostics without drawing placeholder markers", () => {
  for (const [atlasFrame, image] of [
    [undefined, undefined], [undefined, {}], [frame, undefined],
  ] as const) {
    const calls: string[] = [];
    const context = new Proxy({}, {
      get: (_target, method) => () => calls.push(String(method)),
      set: (_target, property) => { calls.push(`set:${String(property)}`); return true; },
    }) as CanvasRenderingContext2D;
    const parts = composeFinSample({ timelineIndex: 0, finished: false, children: [child] }, () => atlasFrame);
    const diagnostics = [...parts[0].diagnostics];
    drawFinComposition(context, parts, () => image as CanvasImageSource | undefined, { x: 0, y: 0 }, 1);
    assert.deepEqual(calls, ["save", "translate", "scale", "restore"]);
    assert.deepEqual(parts[0].diagnostics, diagnostics);
    if (!atlasFrame) assert.ok(diagnostics.includes("missing-atlas-frame"));
  }
});

test("FIN source art and unsupported mode 3/5 fallbacks draw unchanged images without diagnostic outlines", () => {
  const paletteImages = [{ palette: "DESERT" }, { palette: "JUNGLE" }];
  for (const valueA of [0, 3, 5]) for (const valueB of [0, 1]) for (const image of paletteImages) {
    const calls: unknown[][] = [];
    const context = new Proxy({}, {
      get: (_target, method) => (...args: unknown[]) => calls.push([String(method), ...args]),
      set: (_target, property, value) => { calls.push([`set:${String(property)}`, value]); return true; },
    }) as CanvasRenderingContext2D;
    const parts = composeFinSample({ timelineIndex: 0, finished: false, children: [
      { ...child, flags: 16, valueA, valueB },
    ] }, () => frame);
    const diagnostics = valueA ? [`native-draw-mode:${valueA}`] : [];
    assert.deepEqual(parts[0].diagnostics, diagnostics);
    drawFinComposition(context, parts, (sprite, part) => {
      assert.equal(sprite, child.sprite);
      assert.equal(part, parts[0]);
      return image as unknown as CanvasImageSource;
    }, { x: 320, y: 240 }, 2);
    assert.deepEqual(calls, [
      ["save"],
      ["translate", Math.round(320 + parts[0].x * 2), Math.round(240 + parts[0].y * 2)],
      ["scale", 2, 2],
      ...(valueB ? [["translate", frame.width, 0], ["scale", -1, 1]] : []),
      ["drawImage", image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height],
      ["restore"],
    ]);
    assert.equal(calls.find(([method]) => method === "drawImage")?.[1], image);
    assert.deepEqual(parts[0].diagnostics, diagnostics);
  }
});

function fixture(names: readonly string[]): FinAnimationData {
  return {
    states: names.map((name, index) => ({ name, firstTimelineIndex: index * 3, lastTimelineIndex: index * 3 + 2 })),
    timeline: names.flatMap(() => [{ children: [child] }, { children: [] }, { children: [{ ...child, frame: 43 }] }]),
  };
}

test("cardinal and diagonal motion uses screen +Y down and actual source suffixes", () => {
  const vectors: readonly [number, number, CompassDirection, string][] = [
    [0, -1024, "N", "8"], [1024, -1024, "NE", "10"], [1024, 0, "E", "12"], [1024, 1024, "SE", "14"],
    [0, 1024, "S", "0"], [-1024, 1024, "SW", "2"], [-1024, 0, "W", "4"], [-1024, -1024, "NW", "6"],
  ];
  const selector = createFinSelector(fixture(vectors.map(([, , , suffix]) => `TESTMOVE${suffix}`)), options);
  for (const [dx, dy, direction, suffix] of vectors) {
    assert.equal(directionFromMotion(dx, dy, "S"), direction);
    assert.equal(selector.select("Move", direction)?.state.name, `TESTMOVE${suffix}`);
  }
  assert.equal(directionFromMotion(0, 0, "W"), "W");
  assert.equal(directionFromMotion(1, -10, "S"), "N");
  assert.throws(() => directionFromMotion(NaN, 0, "S"), RangeError);
});

test("families, nearest directions, explicit adapters, and safe missing-state fallbacks", () => {
  const selector = createFinSelector(fixture(["TESTSTAND0", "TESTMOVE14", "TESTFIREA0", "TESTFIREB8", "TESTDIE210"]), options);
  assert.equal(selector.select("Attack", "S")?.state.name, "TESTFIREA0");
  assert.equal(selector.select("Attack", "N")?.state.name, "TESTFIREB8");
  assert.equal(selector.select("Move", "W")?.state.name, "TESTMOVE14");
  assert.equal(selector.select("Die", "NE")?.state.name, "TESTDIE210");
  const idle = createFinSelector(fixture(["TESTSTAND0", "TESTSTAND14EXTRA"]), options);
  assert.equal(idle.select("Attack", "S")?.action, "Stand");
  assert.equal(idle.select("Move", "S")?.fallback, true);
  assert.equal(idle.select("Die", "S"), undefined);
  const undirected = createFinSelector(fixture(["TESTSTAND"]), options);
  assert.equal(undirected.select("Stand", "N")?.direction, null);
  const remapped = createFinSelector(fixture(["TESTSTAND0"]), {
    ...options, directions: { ...options.directions, N: "0", S: "8" },
  });
  assert.equal(remapped.select("Stand", "N")?.fallback, false);
});

test("explicit tick rate preserves empty entries, loops living states, clamps death", () => {
  const selector = createFinSelector(fixture(["TESTMOVE0", "TESTDIEA0"]), options);
  const move = selector.select("Move", "S")!;
  const die = selector.select("Die", "S")!;
  assert.equal(selector.sample(move, 0, 10, 20).timelineIndex, 0);
  assert.deepEqual(selector.sample(move, 2, 10, 20).children, []);
  assert.equal(selector.sample(move, 6, 10, 20).timelineIndex, 0);
  assert.equal(selector.sample(move, 2, 5, 20).timelineIndex, 0);
  assert.equal(selector.sample(die, -10, 10, 20).timelineIndex, 3);
  assert.equal(selector.sample(die, 4, 10, 20).finished, false);
  assert.equal(selector.sample(die, 6, 10, 20).finished, true);
  assert.equal(selector.sample(die, 10000, 10, 20).timelineIndex, 5);
  assert.throws(() => selector.sample(move, 0, 0, 20), RangeError);
  assert.throws(() => selector.sample(move, Infinity, 10, 20), RangeError);
  const emptyDeath = createFinSelector({
    states: [{ name: "TESTDIEA0", firstTimelineIndex: 0, lastTimelineIndex: 1 }],
    timeline: [{ children: [child] }, { children: [] }],
  }, options);
  const final = emptyDeath.sample(emptyDeath.select("Die", "S")!, 100, 10, 20);
  assert.deepEqual(final.children, []);
  assert.equal(final.finished, true);
});

test("invalid ranges and empty animations do not select arbitrary frame zero", () => {
  assert.equal(createFinSelector({ states: [], timeline: [] }, options).select("Stand", "S"), undefined);
  for (const [firstTimelineIndex, lastTimelineIndex] of [[-1, 0], [2, 1], [0, 99], [0.5, 1]]) {
    const selector = createFinSelector({
      states: [{ name: "TESTSTAND0", firstTimelineIndex, lastTimelineIndex }], timeline: [{ children: [] }],
    }, options);
    assert.equal(selector.select("Stand", "S"), undefined);
  }
});

test("child layers sort stably without mutation; frame IDs, offsets and anchors survive compositing", () => {
  const children = [{ ...child, frame: 43, layer: 2 }, child, { ...child, sprite: "effect", layer: 0 }];
  const animation = { states: [{ name: "TESTSTAND0", firstTimelineIndex: 0, lastTimelineIndex: 0 }], timeline: [{ children }] };
  const selector = createFinSelector(animation, options);
  const sample = selector.sample(selector.select("Stand", "S")!, 0, 10, 20);
  assert.deepEqual(sample.children.map((entry) => entry.sprite), ["test", "effect", "test"]);
  assert.equal(children[0].layer, 2);
  const lookup = createFinFrameLookup({ TEST: { frames: [frame, { ...frame, index: 43, empty: true }] }, EFFECT: { frames: [frame] } });
  const placements = finChildPlacements(sample, lookup, finCanvasPlacement({ x: 0, y: 140 }, "add"));
  assert.equal(placements.length, 2);
  assert.deepEqual([placements[0].x, placements[0].y], [-12, -38]);
  assert.equal(placements[0].frame.index, 42);
  assert.equal(placements[0].frame.x, 50);
  assert.deepEqual(finChildPlacements(sample, () => undefined, finCanvasPlacement({ x: 0, y: 0 }, "ignore")), []);
  for (const layerOrder of ["descending", "source"] as const) {
    const alternate = createFinSelector(animation, { ...options, layerOrder });
    assert.equal(alternate.sample(alternate.select("Stand", "S")!, 0, 10, 20).children[0].frame, 43);
  }
});

test("static cell and fixed-point unit depth use the same units", () => {
  assert.equal(worldYSubcells(2.5, "cells"), worldYSubcells(2560, "subcells"));
  assert.ok(worldYSubcells(2.5, "cells") > worldYSubcells(2048, "subcells"));
});

for (const name of ["TRSC", "GRAY"]) {
  test(`${name}: every source attack/death child reaches the Canvas adapter with its own atlas`, () => {
    const animation = parseFin(readFileSync(new URL(`../../raw_cd/DC/ANIMATE/${name}.FIN`, import.meta.url)));
    const atlases = Object.fromEntries(animation.spriteNames.map((sprite) => [sprite,
      JSON.parse(readFileSync(new URL(`../../public/assets/generated/sprites/SPRITES/${sprite.toUpperCase()}.json`, import.meta.url), "utf8")) as { frames: FinAtlasFrame[] },
    ]));
    const lookup = createFinFrameLookup(atlases);
    const selector = createFinSelector(animation, { ...options, prefix: name });
    const sample = createFinSourceSampler(animation);
    const calls: { name: string; args: unknown[] }[] = [];
    const context = new Proxy({}, {
      get: (_target, method) => (...args: unknown[]) => calls.push({ name: String(method), args }),
      set: () => true,
    }) as CanvasRenderingContext2D;
    const images = new Map(animation.spriteNames.map((sprite) => [sprite, { sprite } as unknown as CanvasImageSource]));
    let effectCount = 0;
    let mirroredCount = 0;
    for (const action of ["Attack", "Die"] as const) {
      for (const facing of Object.keys(options.directions) as CompassDirection[]) {
        const selection = selector.select(action, facing)!;
        let updates = 0;
        for (let index = selection.state.firstTimelineIndex; index <= selection.state.lastTimelineIndex; index += 1) {
          const entry = sample(selection, updates);
          assert.equal(entry.timelineIndex, index);
          assert.deepEqual(entry.children, animation.timeline[index].children);
          const parts = composeFinSample(entry, lookup);
          assert.equal(parts.length, entry.children.filter((child) => {
            const frame = lookup(child.sprite, child.frame)!;
            assert.ok(frame, `${name}: missing ${child.sprite}:${child.frame}`);
            return !frame.empty && frame.width > 0 && frame.height > 0;
          }).length);
          calls.length = 0;
          drawFinComposition(context, parts, (sprite) => images.get(sprite), { x: 320, y: 240 }, 1);
          const draws = calls.filter((call) => call.name === "drawImage");
          assert.equal(draws.length, parts.length);
          assert.equal(calls.filter((call) => call.name === "save").length, parts.length);
          assert.equal(calls.filter((call) => call.name === "restore").length, parts.length);
          parts.forEach((part, position) => {
            const frame = part.frame!;
            assert.equal(draws[position].args[0], images.get(part.child.sprite));
            assert.deepEqual(draws[position].args.slice(1, 5), [frame.x, frame.y, frame.width, frame.height]);
            if (part.child.sprite.toUpperCase() !== name) effectCount += 1;
            if (part.mirrored) mirroredCount += 1;
          });
          updates += finSourceDuration(animation.timeline[index].field2);
        }
      }
    }
    assert.ok(effectCount > 0, "attack/death effects must not be filtered to the body sprite");
    assert.ok(mirroredCount > 0, "source mirrored children must reach the adapter");
  });

  test(`${name}: generated states and timelines match FIN binary; stand references actual atlas IDs`, () => {
    const animation: FinAnimationData = JSON.parse(readFileSync(new URL(`../../public/assets/generated/animations/${name}.json`, import.meta.url), "utf8"));
    const source = parseFin(readFileSync(new URL(`../../raw_cd/DC/ANIMATE/${name}.FIN`, import.meta.url)));
    assert.deepEqual(animation.states, source.states);
    assert.deepEqual(animation.timeline, source.timeline);
    const atlas: { frames: FinAtlasFrame[] } = JSON.parse(readFileSync(new URL(`../../public/assets/generated/sprites/SPRITES/${name}.json`, import.meta.url), "utf8"));
    const lookup = createFinFrameLookup({ [name]: atlas });
    const selector = createFinSelector(animation, { ...options, prefix: name });
    for (const action of ["Stand", "Move", "Attack"] as const) {
      const family = action === "Stand" ? "STAND" : action === "Move" ? "MOVE" : "FIREA";
      assert.equal(selector.select(action, "E")?.state.name, `${name}${family}12`);
      assert.equal(selector.select(action, "W")?.state.name, `${name}${family}4`);
    }
    const suffixes = ["0", "14", "12", "10", "8", "6", "4", "2"];
    for (const [index, suffix] of suffixes.entries()) {
      const direction = (Object.keys(options.directions) as CompassDirection[]).find((key) => options.directions[key] === suffix)!;
      const stand = selector.select("Stand", direction)!;
      assert.equal(stand.state.name, `${name}STAND${suffix}`);
      const sample = selector.sample(stand, 0, 10, 20);
      assert.equal(sample.timelineIndex, index);
      const body = sample.children.find((entry) => entry.sprite.toUpperCase() === name)!;
      assert.equal(body.frame, index);
      assert.ok(lookup(body.sprite, body.frame));
      assert.equal(selector.select("Attack", direction)?.state.name, `${name}FIREA${suffix}`);
      assert.ok(selector.select("Die", direction));
    }
    const first = animation.timeline[0].children[0];
    const firstFrame = lookup(first.sprite, first.frame)!;
    assert.deepEqual([first.x, first.y, firstFrame.anchorX, firstFrame.anchorY],
      name === "TRSC" ? [-159, 4, 147, 99] : [-32, 5, 21, 11]);
    const move = selector.select("Move", "S")!.state;
    assert.equal(move.lastTimelineIndex - move.firstTimelineIndex + 1, name === "TRSC" ? 8 : 7);
  });
}