import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMissionCursorAnimation, createMissionCursorController, CURSOR_PRESENTATION_HZ,
  cursorFrameIds, loadMissionCursorAnimation, loadMissionCursorStyles } from "../../src/ui/mission-cursor";
import type { FinAnimationData } from "../../src/render/fin-animation";

const animation: FinAnimationData = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/CURS.json", import.meta.url), "utf8"));
const atlas = JSON.parse(readFileSync(new URL("../../public/assets/generated/sprites/SPRITES/CURS.json", import.meta.url), "utf8"));
const image = (frame: number) => ({ ...atlas.frames[frame], url: `data:frame-${frame}` });

test("mission cursor states use the shipped named CURS timeline", () => {
  const animation = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/CURS.json", import.meta.url), "utf8"));
  assert.deepEqual(cursorFrameIds(animation), { default: 0, select: 3, move: 9, attack: 15, drag: 6 });
  assert.throws(() => cursorFrameIds({ states: [], timeline: [] }), /Missing original cursor/);
});

test("mission cursor animation preserves all original frames and FIN delays at 20 Hz", () => {
  const table = createMissionCursorAnimation(animation, image);
  assert.equal(CURSOR_PRESENTATION_HZ, 20);
  const expected = { default: [0, 1, 2], select: [3, 4, 5], move: [9, 10, 11], attack: [15, 16, 17], drag: [6, 6, 8] };
  for (const kind of Object.keys(expected) as (keyof typeof expected)[]) {
    const sequence = table.states[kind];
    assert.deepEqual(sequence.frames.map(frame => frame.frame), expected[kind]);
    assert.deepEqual(sequence.frames.map(frame => frame.durationTicks), [2, 2, 2]);
    assert.deepEqual(sequence.frames.map(frame => frame.endTick), [2, 4, 6]);
    assert.equal(sequence.durationTicks, 6);
    assert.equal(table.firstStyles[kind], sequence.frames[0].style);
    const controller = createMissionCursorController(table);
    for (const [elapsed, frameIndex] of [[0, 0], [99, 0], [100, 1], [199, 1], [200, 2], [299, 2], [300, 0], [10400, 2]]) {
      assert.equal(controller.styleAt(kind, 1000 + elapsed), sequence.frames[frameIndex].style);
    }
  }
  assert.equal(table.firstStyles.blocked, "not-allowed");
});

test("mission cursor clock resets only on state changes, without source reads or frame allocations", () => {
  let crops = 0;
  const table = createMissionCursorAnimation(animation, frame => { crops++; return image(frame); });
  assert.equal(crops, 14);
  const controller = createMissionCursorController(table);
  assert.equal(controller.styleAt("attack", 500), table.states.attack.frames[0].style);
  for (let now = 501; now < 800; now++) {
    assert.equal(controller.styleAt("attack", now), table.states.attack.frames[Math.floor((now - 500) / 100)].style);
  }
  assert.equal(controller.styleAt("attack", 800), table.states.attack.frames[0].style);
  assert.equal(controller.styleAt("move", 825), table.states.move.frames[0].style);
  assert.equal(controller.styleAt("move", 925), table.states.move.frames[1].style);
  assert.equal(controller.styleAt("blocked", 930), "not-allowed");
  assert.equal(controller.styleAt("attack", 940), table.states.attack.frames[0].style);
  assert.equal(crops, 14);
  const source = readFileSync(new URL("../../src/ui/mission-cursor.ts", import.meta.url), "utf8");
  const hotpath = source.slice(source.indexOf("    styleAt("), source.indexOf("let loadedAnimation"));
  assert.doesNotMatch(hotpath, /document|createElement|toDataURL|\.map\(|\.slice\(|\.find\(|finSourceDuration|\bnew\b/);
});

test("mission cursor timing uses each FIN field2 and caches repeated source frames", () => {
  const varied = { ...animation, timeline: animation.timeline.map((entry, index) => index === 1
    ? { ...entry, field2: 37, children: animation.timeline[0].children } : entry) };
  let crops = 0;
  const table = createMissionCursorAnimation(varied, frame => { crops++; return image(frame); });
  assert.equal(crops, 13);
  assert.deepEqual(table.states.default.frames.map(frame => frame.durationTicks), [2, 6, 2]);
  const controller = createMissionCursorController(table);
  controller.styleAt("default", 0);
  assert.equal(controller.styleAt("default", 399), table.states.default.frames[1].style);
  assert.equal(controller.styleAt("default", 400), table.states.default.frames[2].style);
  assert.equal(controller.styleAt("default", 500), table.states.default.frames[0].style);
  assert.throws(() => createMissionCursorAnimation({ states: [], timeline: [] }, image), /Missing original cursor/);
});

test("mission cursor loader caches exact-size source crops and keeps the first-frame API", async context => {
  let fetches = 0, crops = 0, encodes = 0;
  const drawn: number[][] = [];
  const dimensions: number[][] = [];
  context.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ++fetches === 1 ? animation : atlas }) as Response);
  const installGlobal = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    context.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  };
  installGlobal("Image", class {
    onload?: () => void;
    set src(_value: string) { this.onload?.(); }
  });
  installGlobal("document", { createElement: (tag: string) => {
    assert.equal(tag, "canvas");
    crops++;
    const canvas = { width: 0, height: 0,
      getContext: () => ({ drawImage: (_image: unknown, ...args: number[]) => drawn.push(args) }),
      toDataURL: () => { dimensions.push([canvas.width, canvas.height]); return `data:crop-${encodes++}`; } };
    return canvas;
  } });
  const [table, styles, again] = await Promise.all([loadMissionCursorAnimation(), loadMissionCursorStyles(), loadMissionCursorAnimation()]);
  assert.equal(table, again);
  assert.equal(styles, table.firstStyles);
  assert.equal(fetches, 2);
  assert.equal(crops, 14);
  assert.equal(encodes, 14);
  let cropIndex = 0;
  const checked = new Set<number>();
  for (const kind of ["default", "select", "move", "attack", "drag"] as const) {
    for (const entry of table.states[kind].frames) {
      if (checked.has(entry.frame)) continue;
      checked.add(entry.frame);
      const frame = atlas.frames[entry.frame];
      assert.deepEqual(drawn[cropIndex], [frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height]);
      assert.deepEqual(dimensions[cropIndex], [frame.width, frame.height]);
      assert.ok(entry.style.includes(` ${Math.floor(frame.width / 2)} ${Math.floor(frame.height / 2)}, `));
      cropIndex++;
    }
  }
  const controller = createMissionCursorController(table);
  for (let now = 0; now < 10000; now++) controller.styleAt("attack", now);
  assert.equal(encodes, 14);
});

test("mission cursor presentation runs before simulation with no per-frame hit testing or DOM reads", () => {
  const source = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  assert.match(source, /function animate\(time: number\): void \{\s+renderMissionCursor\(performance\.now\(\)\);/);
  const render = source.slice(source.indexOf("function renderMissionCursor("), source.indexOf("function trackMissionPointer("));
  assert.match(render, /if \(!missionPointer \|\| assetMode !== "campaign"\) return/);
  assert.match(render, /appliedMissionCursorStyle !== style/);
  assert.doesNotMatch(render, /getBoundingClientRect|cursorAt|\.hidden|dataset|document|createElement|toDataURL|\.update\(/);
  assert.doesNotMatch(render, /(?:const|let) \w+ = missionCanvas\./);
  const tracking = source.slice(source.indexOf("function trackMissionPointer("), source.indexOf("function updateMissionCursor("));
  assert.match(tracking, /event\.clientX < bounds\.right/);
  assert.match(tracking, /event\.clientY < bounds\.bottom/);
  assert.match(source, /"pointerleave", \(\) => \{\s+missionPointer = null/);
  assert.match(source, /createMissionCursorController\(await loadMissionCursorAnimation\(\)\)/);
});