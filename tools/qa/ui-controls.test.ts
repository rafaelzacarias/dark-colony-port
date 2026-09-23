import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  accumulateRadarExploration,
  bindRadarPointer,
  createRadarTerrain,
  drawRadar,
  radarCameraView,
  radarCellAt,
  radarClientToMap,
  radarMapRect,
  radarMarkers,
  snapshotRadarEntities,
  radarViewRect,
  RADAR_COLORS,
  type RadarFrame,
  type RadarNavigation,
  type RadarTerrainSource,
} from "../../src/ui/radar";
import { ORIGINAL_HUD } from "../../src/ui/hud-geometry";
import { DeterministicSimulation, NavigationGrid } from "../../src/engine";
import {
  bindControlGroups,
  createControlGroups,
  pruneControlGroups,
  reduceControlGroupKey,
  restoreControlGroups,
} from "../../src/ui/control-groups";

const units = [
  { id: 3, owned: true, health: 10 },
  { id: 1, owned: true, health: 10 },
  { id: 2, owned: false, health: 10 },
  { id: 4, owned: true, health: 0 },
  { id: 5, owned: true, health: 10, activity: "die" },
];

test("saved control groups restore detached memberships and prune dead or foreign IDs", () => {
  const groups = Array.from({ length: 10 }, () => [] as number[]);
  groups[1] = [3, 1, 1, 2, 4, 99];
  const restored = restoreControlGroups(groups, units);
  assert.deepEqual(restored.groups[1], [1, 3]);
  assert.equal(restored.awaitingDigit, false);
  groups[1].push(5);
  assert.deepEqual(restored.groups[1], [1, 3]);
  assert.deepEqual(reduceControlGroupKey(restored, { key: "1" }, [], units).selection, [1, 3]);
  for (const invalid of [null, [], Array(10).fill([0]), Array(10).fill([1.5]), Array(10).fill(["1"])]) {
    assert.throws(() => restoreControlGroups(invalid, units), /Invalid saved/);
  }
});

test("radar includes source static targets with team ownership and fog filtering", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
  const own = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 0, y: 0 }, maxHealth: 100 });
  const enemy = simulation.addStaticTarget({ faction: "human", team: 1, cell: { x: 2, y: 0 }, maxHealth: 100 });
  const entities = snapshotRadarEntities(simulation.snapshot, (entity) => "team" in entity && entity.team === 0);
  assert.deepEqual(entities.map(({ id, owned, kind }) => ({ id, owned, kind })), [
    { id: own, owned: true, kind: "building" }, { id: enemy, owned: false, kind: "building" },
  ]);
  const frame = { visible: Uint8Array.from([1, 0, 0, 0]), entities, view: { x: 0, y: 0, width: 4, height: 1 } };
  assert.deepEqual(radarMarkers({ width: 4, height: 1 }, { width: 40, height: 10 }, frame).map(({ id }) => id), [own]);
  frame.visible[2] = 1;
  assert.deepEqual(radarMarkers({ width: 4, height: 1 }, { width: 40, height: 10 }, frame).map(({ id }) => id), [own, enemy]);
});

test("g then every digit creates deterministic owned-only groups; numbers recall", () => {
  const initial = createControlGroups();
  for (let digit = 0; digit < 10; digit += 1) {
    const armed = reduceControlGroupKey(initial, { key: "g" }, [], units);
    const created = reduceControlGroupKey(armed.state, { key: String(digit) }, [3, 2, 1, 3, 4, 5, 99], units);
    assert.equal(created.selection, null);
    assert.equal(created.state.awaitingDigit, false);
    assert.deepEqual(created.state.groups[digit], [1, 3]);
    const recalled = reduceControlGroupKey(created.state, { key: String(digit) }, [], units);
    assert.deepEqual(recalled.selection, [1, 3]);
    assert.deepEqual(initial.groups[digit], []);
  }
});

test("recall and explicit prune remove missing, dead, dying and foreign units", () => {
  const state = { groups: Array.from({ length: 10 }, () => [1, 2, 3, 4, 5, 99]), awaitingDigit: false };
  const changed = units.map((unit) => unit.id === 3 ? { ...unit, owned: false } : unit);
  assert.deepEqual(reduceControlGroupKey(state, { key: "0" }, [], changed).selection, [1]);
  assert.deepEqual(pruneControlGroups(state, changed).groups, Array.from({ length: 10 }, () => [1]));
  assert.deepEqual(state.groups[0], [1, 2, 3, 4, 5, 99]);
});

test("ctrl alias is opt-in; repeats do not overwrite; empty creation clears", () => {
  const initial = createControlGroups();
  assert.equal(reduceControlGroupKey(initial, { key: "1", ctrlKey: true }, [1], units).handled, false);
  const created = reduceControlGroupKey(initial, { key: "1", ctrlKey: true }, [1], units, true);
  assert.deepEqual(created.state.groups[1], [1]);
  const repeated = reduceControlGroupKey(created.state, { key: "1", ctrlKey: true, repeat: true }, [3], units, true);
  assert.deepEqual(repeated.state.groups[1], [1]);
  const armed = reduceControlGroupKey(created.state, { key: "g" }, [], units);
  assert.deepEqual(reduceControlGroupKey(armed.state, { key: "1" }, [], units).state.groups[1], []);
});

test("intervening keys, editing and modifiers cancel group creation", () => {
  const armed = reduceControlGroupKey(createControlGroups(), { key: "g" }, [], units).state;
  for (const input of [{ key: "Escape" }, { key: "a" }, { key: "1", editable: true },
    { key: "1", metaKey: true }, { key: "1", altKey: true }, { key: "1", shiftKey: true }]) {
    const result = reduceControlGroupKey(armed, input, [1], units);
    assert.equal(result.state.awaitingDigit, false);
    assert.equal(result.handled, false);
    assert.deepEqual(result.state.groups[1], []);
  }
});

function key(target: EventTarget, value: string): Event {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value });
  target.dispatchEvent(event);
  return event;
}

test("keyboard binding recalls, resets on blur, and removes listeners", () => {
  const target = new EventTarget();
  const recalled: (readonly number[])[] = [];
  const binding = bindControlGroups(target, {
    getUnits: () => units, getSelectedIds: () => [3, 1], onRecall: (ids) => recalled.push(ids),
  });
  assert.equal(key(target, "g").defaultPrevented, true);
  key(target, "7");
  key(target, "7");
  assert.deepEqual(recalled, [[1, 3]]);
  key(target, "g");
  target.dispatchEvent(new Event("blur"));
  assert.equal(binding.state.awaitingDigit, false);
  binding.dispose();
  binding.dispose();
  assert.equal(key(target, "7").defaultPrevented, false);
  assert.equal(recalled.length, 1);
});

test("disabled groups cancel pending creation and session reset clears previous bindings", () => {
  const target = new EventTarget();
  const recalled: (readonly number[])[] = [];
  let enabled = true;
  const binding = bindControlGroups(target, {
    isEnabled: () => enabled, getUnits: () => units, getSelectedIds: () => [1],
    onRecall: (ids) => recalled.push(ids),
  });
  key(target, "g");
  enabled = false;
  assert.equal(key(target, "2").defaultPrevented, false);
  assert.equal(binding.state.awaitingDigit, false);
  enabled = true;
  key(target, "g");
  key(target, "2");
  key(target, "2");
  binding.reset();
  key(target, "2");
  assert.deepEqual(recalled, [[1], []]);
  binding.dispose();
});

test("HUD radar fits above portrait without touching world or command controls", () => {
  const { radar, portrait, rightPanel, world } = ORIGINAL_HUD;
  assert.deepEqual([world.width, world.height], [512, 452]);
  assert.deepEqual(radar, { x: 522, y: 4, width: 112, height: 98 });
  assert.ok(radar.y + radar.height <= portrait.y);
  assert.ok(radar.x >= rightPanel.x && radar.x + radar.width <= rightPanel.x + rightPanel.width);
  assert.ok(radar.y + radar.height < 400);
});

test("radar maps CSS-scaled clients through aspect-fit letterboxing and edge clamping", () => {
  const map = { width: 200, height: 100 };
  const surface = { width: 100, height: 100 };
  const bounds = { left: 10, top: 20, width: 200, height: 200 };
  assert.deepEqual(radarMapRect(map, surface), { x: 0, y: 25, width: 100, height: 50 });
  assert.deepEqual(radarClientToMap({ x: 110, y: 120 }, bounds, surface, map), { x: 100, y: 50 });
  assert.equal(radarClientToMap({ x: 110, y: 30 }, bounds, surface, map), null);
  const edge = radarClientToMap({ x: 999, y: 999 }, bounds, surface, map, true)!;
  assert.deepEqual(edge, { x: 200, y: 0 });
  assert.deepEqual(radarCellAt(edge, map), { x: 199, y: 0 });
  assert.equal(radarClientToMap({ x: NaN, y: 0 }, bounds, surface, map), null);
  assert.equal(radarClientToMap({ x: 0, y: 0 }, { ...bounds, width: 0 }, surface, map), null);
  assert.deepEqual(radarMapRect({ width: 100, height: 200 }, surface), { x: 25, y: 0, width: 50, height: 100 });
  assert.throws(() => radarMapRect({ width: 0, height: 1 }, surface), RangeError);
});

test("camera view clamps in map cells, including maps smaller than world viewport", () => {
  const map = { width: 100, height: 50 };
  const view = radarCameraView(map, { x: 100, y: 0 }, { width: 16, height: 14.125 });
  assert.deepEqual(view, { x: 84, y: 0, width: 16, height: 14.125 });
  const projected = radarViewRect(map, { width: 100, height: 100 }, view);
  assert.deepEqual([projected.x, projected.y, projected.width], [84, 60.875, 16]);
  assert.ok(Math.abs(projected.height - 14.125) < 1e-10);
  assert.deepEqual(radarCameraView(map, { x: -5, y: 99 }, { width: 512, height: 452 }), { x: 0, y: 0, width: 100, height: 50 });
});

test("radar shows living owned units but only currently visible enemies, never explored-only enemies", () => {
  const frame: RadarFrame = {
    visible: new Uint8Array([0, 1, 0, 0]), explored: new Uint8Array([1, 1, 1, 1]),
    view: { x: 0, y: 0, width: 2, height: 2 },
    entities: [
      { id: 1, owned: true, health: 10, cellX: 0, cellY: 0 },
      { id: 2, owned: false, health: 10, cellX: 1, cellY: 0 },
      { id: 3, owned: false, health: 10, cellX: 0, cellY: 1 },
      { id: 4, owned: true, health: 0, cellX: 1, cellY: 1 },
      { id: 5, owned: true, health: 10, cellX: 1, cellY: 1, activity: "die" },
      { id: 6, owned: true, health: 10, cellX: -1, cellY: 0 },
    ],
  };
  assert.deepEqual(radarMarkers({ width: 2, height: 2 }, { width: 100, height: 100 }, frame), [
    { id: 1, owned: true, kind: "unit", x: 25, y: 75 },
    { id: 2, owned: false, kind: "unit", x: 75, y: 75 },
  ]);
  assert.throws(() => radarMarkers({ width: 2, height: 2 }, { width: 100, height: 100 }, { ...frame, visible: [] }), RangeError);
  const previous = new Uint8Array([1, 0, 0, 0]);
  assert.deepEqual(accumulateRadarExploration(previous, frame.visible), new Uint8Array([1, 1, 0, 0]));
  assert.deepEqual(previous, new Uint8Array([1, 0, 0, 0]));
});

function recordingContext() {
  const calls: { name: string; args: unknown[]; fill: string }[] = [];
  const context = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, imageSmoothingEnabled: true,
    save() {}, restore() {}, setTransform() {}, beginPath() {}, rect() {}, clip() {},
    translate(...args: unknown[]) { calls.push({ name: "translate", args, fill: this.fillStyle }); },
    scale(...args: unknown[]) { calls.push({ name: "scale", args, fill: this.fillStyle }); },
    fillRect(...args: unknown[]) { calls.push({ name: "fill", args, fill: this.fillStyle }); },
    strokeRect(...args: unknown[]) { calls.push({ name: "stroke", args, fill: this.strokeStyle }); },
    drawImage(...args: unknown[]) { calls.push({ name: "image", args, fill: this.fillStyle }); },
  };
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

test("terrain cache draws source references in layer order and leaves unresolved cells neutral", () => {
  const { context, calls } = recordingContext();
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const atlas = {} as CanvasImageSource;
  const source = {
    map: { schemaVersion: 2, width: 2, height: 1, referencesPerCell: 2 },
    tileRecordIndices: new Uint16Array([0, 1, 99, 99]),
    attributes: new Uint16Array(2),
    terrain: { tiles: [{ recordIndex: 0, x: 32, y: 64, width: 32, height: 32 }, { recordIndex: 1, x: 96, y: 0, width: 32, height: 32 }] },
  } as unknown as RadarTerrainSource;
  assert.equal(createRadarTerrain(source, atlas, () => canvas), canvas);
  assert.deepEqual([canvas.width, canvas.height], [4, 2]);
  assert.equal(calls[0].fill, RADAR_COLORS.unresolvedTerrain);
  assert.deepEqual(calls.filter(({ name }) => name === "image").map(({ args }) => args), [
    [atlas, 32, 64, 32, 32, 0, 0, 2, 2],
    [atlas, 96, 0, 32, 32, 0, 0, 2, 2],
  ]);
  assert.throws(() => createRadarTerrain({ ...source, map: { ...source.map, schemaVersion: 1 } } as unknown as RadarTerrainSource, atlas, () => canvas), RangeError);
  assert.throws(() => createRadarTerrain({ ...source, tileRecordIndices: new Uint16Array(3) }, atlas, () => canvas), RangeError);
  assert.throws(() => createRadarTerrain({ ...source, attributes: new Uint16Array(1) }, atlas, () => canvas), RangeError);
  calls.length = 0;
  createRadarTerrain({ ...source, attributes: new Uint16Array([0x40, 0]) }, atlas, () => canvas);
  assert.deepEqual(calls.filter(({ name }) => name === "scale").map(({ args }) => args), [[-1, 1]]);
});

test("radar renderer draws terrain, opaque unknown fog, explored fog, markers and view in order", () => {
  const { context, calls } = recordingContext();
  drawRadar(context, { width: 30, height: 10 }, { width: 3, height: 1 }, {} as CanvasImageSource, {
    visible: [0, 0, 1], explored: [0, 1, 1], view: { x: 2, y: 0, width: 1, height: 1 },
    entities: [{ id: 1, owned: false, health: 10, cellX: 2, cellY: 0 }],
  });
  assert.deepEqual(calls.map(({ name }) => name), ["fill", "image", "fill", "fill", "fill", "stroke"]);
  assert.equal(calls[2].fill, "#000000");
  assert.equal(calls[3].fill, "rgba(0, 0, 0, 0.72)");
  assert.equal(calls[4].fill, RADAR_COLORS.enemy);
  assert.equal(calls[5].fill, RADAR_COLORS.view);
});

class PointerCanvas extends EventTarget {
  width = 100;
  height = 100;
  style = { touchAction: "pan-y" };
  ownerDocument = { defaultView: new EventTarget() };
  captures = new Set<number>();
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 200 }; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
}

function pointer(canvas: PointerCanvas, type: string, overrides: Record<string, number | boolean> = {}): Event {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries({ pointerId: 1, button: 0, isPrimary: true, clientX: 110, clientY: 120, ...overrides })) {
    Object.defineProperty(event, name, { value });
  }
  canvas.dispatchEvent(event);
  return event;
}

test("pointer binding navigates both buttons, captures drag, and cleans all termination paths", () => {
  const canvas = new PointerCanvas();
  const navigations: RadarNavigation[] = [];
  const dispose = bindRadarPointer(canvas as unknown as HTMLCanvasElement, { width: 200, height: 100 }, (event) => navigations.push(event));
  assert.equal(pointer(canvas, "pointerdown", { clientY: 30 }).defaultPrevented, false);
  assert.equal(pointer(canvas, "pointerdown", { button: 1 }).defaultPrevented, false);
  assert.equal(pointer(canvas, "pointerdown").defaultPrevented, true);
  assert.equal(canvas.captures.size, 1);
  pointer(canvas, "pointermove", { clientX: 999, clientY: 999 });
  assert.deepEqual(navigations[1].cell, { x: 199, y: 0 });
  pointer(canvas, "pointerup");
  assert.equal(canvas.captures.size, 0);
  pointer(canvas, "pointerdown", { button: 2 });
  assert.equal(navigations[2].button, 2);
  assert.deepEqual(navigations[2].point, { x: 100, y: 50 });
  pointer(canvas, "pointercancel");
  pointer(canvas, "pointermove");
  assert.equal(navigations.length, 3);
  for (const ending of ["lostpointercapture", "blur"]) {
    pointer(canvas, "pointerdown");
    if (ending === "blur") canvas.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
    else pointer(canvas, ending);
    assert.equal(canvas.captures.size, 0);
  }
  assert.equal(pointer(canvas, "contextmenu").defaultPrevented, true);
  pointer(canvas, "pointerdown");
  const count = navigations.length;
  dispose();
  dispose();
  assert.equal(canvas.captures.size, 0);
  assert.equal(canvas.style.touchAction, "pan-y");
  assert.equal(pointer(canvas, "contextmenu").defaultPrevented, false);
  pointer(canvas, "pointerdown");
  pointer(canvas, "pointermove");
  assert.equal(navigations.length, count);
});

test("optional Chromium: original HUD, source terrain, fog pixels, scaled input and disposal", {
  skip: !process.env.UI_BROWSER_MODULE || !process.env.UI_BROWSER_EXECUTABLE,
}, async () => {
  const { default: playwright } = await import(pathToFileURL(process.env.UI_BROWSER_MODULE!).href);
  const browser = await playwright.chromium.launch({
    executablePath: process.env.UI_BROWSER_EXECUTABLE,
    headless: false,
    args: ["--use-angle=metal", "--window-position=2400,1200"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route("**/__agent-interface-check", (route: { fulfill: (options: object) => Promise<void> }) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{margin:0;background:#222}#hud{position:relative;width:min(640px,100%);aspect-ratio:4/3}
        #frame{width:100%;height:100%;position:absolute}canvas{position:absolute;image-rendering:pixelated}</style>
        <div id="hud"><img id="frame" src="/assets/generated/interface/INTRFACE.GIF"><canvas aria-label="Radar" id="radar"></canvas></div>`,
    }));
    await page.goto(`${process.env.UI_BROWSER_URL ?? "http://127.0.0.1:5173"}/__agent-interface-check`);
    const initial = await page.evaluate(`(async () => {
      const ui = await import('/src/ui/index.ts');
      const map = await fetch('/assets/generated/maps/HUMAN/HUMAN01.json').then(response => response.json());
      const terrainStem = map.terrainBank.replace(/\\.bts$/i, '').toUpperCase();
      const terrain = await fetch('/assets/generated/terrain/' + terrainStem + '.json').then(response => response.json());
      const referenceBytes = await fetch('/assets/generated/maps/HUMAN/' + map.files.tileRecordIndices).then(response => response.arrayBuffer());
      const referenceView = new DataView(referenceBytes);
      const tileRecordIndices = Uint16Array.from({ length: referenceBytes.byteLength / 2 }, (_, index) => referenceView.getUint16(index * 2, true));
      const attributeBytes = await fetch('/assets/generated/maps/HUMAN/' + map.files.attributes).then(response => response.arrayBuffer());
      const attributes = new Uint16Array(attributeBytes);
      const mission = { map, terrain, tileRecordIndices, attributes };
      const atlas = new Image(); atlas.src = '/assets/generated/terrain/' + terrain.atlas.file; await atlas.decode();
      const canvas = document.querySelector('#radar');
      const geometry = ui.ORIGINAL_HUD.radar;
      canvas.width = geometry.width; canvas.height = geometry.height;
      Object.assign(canvas.style, {
        left: geometry.x / 640 * 100 + '%', top: geometry.y / 480 * 100 + '%',
        width: geometry.width / 640 * 100 + '%', height: geometry.height / 480 * 100 + '%',
      });
      const calls = [];
      const radar = ui.createRadar({ canvas, source: mission, atlas, onNavigate: event => calls.push(event) });
      const count = mission.map.width * mission.map.height;
      const entities = [
        { id: 1, owned: true, cellX: 22, cellY: 3, health: 100, kind: 'unit' },
        { id: 2, owned: false, cellX: Math.floor(map.width / 2), cellY: Math.floor(map.height / 2), health: 100, kind: 'building' },
      ];
      const frame = {
        visible: Uint8Array.from({ length: count }, (_, index) => index % mission.map.width < mission.map.width * .6 ? 1 : 0),
        explored: new Uint8Array(count).fill(1), entities,
        view: ui.radarCameraView(mission.map, { x: 22, y: 3 }, { width: 512 / 32, height: 452 / 32 }),
      };
      const pixels = () => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      radar.render(frame);
      const colors = new Set(); const data = pixels();
      for (let offset = 0; offset < data.length; offset += 4) colors.add(data[offset] + ',' + data[offset+1] + ',' + data[offset+2]);
      radar.render({ visible: new Uint8Array(count), entities: entities.map(entity => ({ ...entity, owned: false })),
        view: { x: mission.map.width * 2, y: 0, width: 1, height: 1 } });
      const hidden = pixels(); let leakedPixels = 0;
      for (let offset = 0; offset < hidden.length; offset += 4) if (hidden[offset] || hidden[offset+1] || hidden[offset+2]) leakedPixels++;
      radar.render(frame);
      window.radarCheck = { radar, canvas, calls };
      return { width: mission.map.width, height: mission.map.height, colors: colors.size, leakedPixels };
    })()`);
    assert.ok(initial.colors > 50);
    assert.equal(initial.leakedPixels, 0);
    const screenshots: string[] = [];
    for (const width of [800, 390]) {
      await page.setViewportSize({ width, height: 600 });
      const bounds = await page.locator("#radar").boundingBox();
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { button: "right" });
      const calls: RadarNavigation[] = await page.evaluate("window.radarCheck.calls.slice(-2)");
      for (const call of calls) {
        assert.ok(Math.abs(call.point.x - initial.width / 2) < 1e-6);
        assert.ok(Math.abs(call.point.y - initial.height / 2) < 1e-6);
      }
      assert.deepEqual(calls.map((call) => call.button), [0, 2]);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), false);
      const path = join(tmpdir(), `darkcolony-agent-interface-${width}-${Date.now()}.png`);
      await page.locator("#hud").screenshot({ path });
      screenshots.push(path);
    }
    const cleanup = await page.evaluate(`(() => {
      const { radar, canvas, calls } = window.radarCheck;
      radar.dispose(); const before = calls.length;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 91, clientX: 345, clientY: 205, button: 0 }));
      return { before, after: calls.length, touchAction: canvas.style.touchAction };
    })()`);
    assert.equal(cleanup.before, cleanup.after);
    assert.equal(cleanup.touchAction, "");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initial, cleanup, screenshots, errors }));
  } finally {
    await browser.close();
  }
});

test("optional Chromium: real HUD lifecycle against the promised MissionView boundary", {
  skip: !process.env.UI_BROWSER_MODULE || !process.env.UI_BROWSER_EXECUTABLE,
}, async () => {
  const { default: playwright } = await import(pathToFileURL(process.env.UI_BROWSER_MODULE!).href);
  const browser = await playwright.chromium.launch({
    executablePath: process.env.UI_BROWSER_EXECUTABLE, headless: false,
    args: ["--use-angle=metal", "--window-position=2400,1200"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route(/\/src\/audio\/index\.ts(?:\?.*)?$/, (route: { fulfill: (options: object) => Promise<void> }) => route.fulfill({
      contentType: "text/javascript", body: `
        export class WebAudioManager {
          constructor() { window.hudAudio = this; this.events = []; }
          unlock() { this.events.push('unlock'); return Promise.resolve(true); }
          stopAll() { this.events.push('stop'); }
          setMuted(value) { this.muted = value; }
        }`,
    }));
    await page.route(/\/src\/mission-view\.ts(?:\?.*)?$/, (route: { fulfill: (options: object) => Promise<void> }) => route.fulfill({
      contentType: "text/javascript", body: `
        window.hudViews = [];
        export class MissionView {
          constructor(canvas, stage, callbacks, mission, audio) {
            this.callbacks = callbacks; this.mission = mission; this.audio = audio;
            this.selectedIds = [1, 2]; this.cameraView = { x: 0, y: 0, width: 16, height: 14.125 };
            this.visibility = new Uint8Array(mission.map.width * mission.map.height).fill(1);
            this.simulation = { snapshot: { units: [1, 2].map(id => ({ id, faction: mission.faction,
              cellX: id, cellY: 1, health: 100, activity: 'idle' })), buildings: [] } };
            this.terrainImage = new Image(); this.terrainImage.src = mission.terrainAtlasUrl;
            this.gate = new Promise(resolve => { this.finish = resolve; });
            window.hudViews.push(this);
          }
          async initialize() {
            this.render(999); await this.terrainImage.decode(); await this.gate; this.render(999);
          }
          isOwnedUnit(id) { return id === 1; }
          replaceSelection(ids) { this.selectedIds = [...ids]; this.render(); }
          setCameraCenter(x, y) { this.cameraView = { ...this.cameraView, x, y }; this.render(); }
          unitName(id) { return 'UNIT ' + id; }
          resetClock() {}
          update() {}
          render(tick = 7) {
            this.callbacks.onStats({ tick, selectedCell: '1,1', daylight: 'DAY', selectedState: 'IDLE',
              healthAndResources: '100', selectedCount: this.selectedIds.length, unitCount: 2,
              missionMessage: 'SOURCE MISSION MESSAGE' });
            this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
          }
        }`,
    }));
    await page.goto(process.env.UI_BROWSER_URL ?? "http://127.0.0.1:5173");
    await page.locator("#campaign-launcher").waitFor({ state: "visible" });
    const launch = () => page.locator('#campaign-launcher [data-campaign-faction="human"]').click();
    await launch();
    await page.waitForFunction("window.hudViews.length === 1");
    assert.equal(await page.locator("#frame-size").textContent(), "01");
    assert.equal(await page.locator("#mission-shell").isVisible(), false);
    assert.equal(await page.evaluate("window.hudViews[0].audio === window.hudAudio"), true);
    assert.deepEqual(await page.evaluate("window.hudAudio.events.slice(-2)"), ["stop", "unlock"]);
    await page.locator('[data-mode="campaign"]').click();
    await launch();
    await page.waitForFunction("window.hudViews.length === 2");
    await page.evaluate("window.hudViews[0].finish()");
    assert.equal(await page.locator("#mission-shell").isVisible(), false);
    assert.equal(await page.locator('#campaign-launcher [data-campaign-faction="human"]').isDisabled(), true);
    await page.evaluate("window.hudViews[1].finish()");
    await page.locator("#mission-radar").waitFor({ state: "visible" });
    assert.equal(await page.locator("#frame-size").textContent(), "7");
    await page.evaluate("document.activeElement.blur()");
    await page.keyboard.press("g");
    await page.keyboard.press("2");
    await page.evaluate("window.hudViews[1].replaceSelection([])");
    await page.keyboard.press("2");
    assert.deepEqual(await page.evaluate("window.hudViews[1].selectedIds"), [1]);
    await page.locator("#show-objectives").click();
    await page.evaluate("window.hudViews[1].replaceSelection([])");
    await page.keyboard.press("2");
    assert.deepEqual(await page.evaluate("window.hudViews[1].selectedIds"), []);
    await page.locator("#close-objectives").click();
    await page.locator("#mission-mute").check();
    assert.equal(await page.evaluate("window.hudAudio.muted"), true);
    await page.locator("#mission-mute").uncheck();
    assert.equal(await page.evaluate("window.hudAudio.muted"), false);
    const radarBounds = await page.locator("#mission-radar").boundingBox();
    await page.mouse.click(radarBounds.x + radarBounds.width / 2, radarBounds.y + radarBounds.height / 2);
    assert.ok(await page.evaluate("window.hudViews[1].cameraView.x > 0"));
    const screenshots: string[] = [];
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 760 });
      const layout = await page.evaluate(`(() => {
        const selectors = ['#mission-canvas', '#mission-radar', '.legacy-portrait', '.legacy-command-grid',
          '#select-all-units', '#exit-campaign', '#show-objectives', '#campaign-faction', '#campaign-selection',
          '#mission-message', '#mission-mute-label', '.legacy-status-strip'];
        const rectangles = selectors.map(selector => ({ selector, rect: document.querySelector(selector).getBoundingClientRect() }));
        const overlaps = [];
        for (const [index, first] of rectangles.entries()) for (const second of rectangles.slice(index + 1)) {
          if (Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left) > .1
            && Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top) > .1)
            overlaps.push([first.selector, second.selector]);
        }
        return { overlaps, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      })()`);
      assert.deepEqual(layout, { overlaps: [], overflow: false });
      const path = join(tmpdir(), `darkcolony-hud-contract-${width}-${Date.now()}.png`);
      await page.locator("#mission-shell").screenshot({ path });
      screenshots.push(path);
    }
    await page.locator("#exit-campaign").click();
    assert.equal(await page.locator("#mission-radar").isVisible(), false);
    assert.equal(await page.evaluate("window.hudAudio.events.at(-1)"), "stop");
    await launch();
    await page.waitForFunction("window.hudViews.length === 3");
    await page.evaluate("window.hudViews[2].finish()");
    await page.locator("#mission-radar").waitFor({ state: "visible" });
    await page.evaluate("document.activeElement.blur()");
    await page.keyboard.press("2");
    assert.deepEqual(await page.evaluate("window.hudViews[2].selectedIds"), []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ boundary: "mocked MissionView/audio, real main/HUD", screenshots, errors }));
  } finally {
    await browser.close();
  }
});