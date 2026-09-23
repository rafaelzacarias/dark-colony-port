import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView, type MissionViewMode3Frame } from "../../src/mission-view.ts";
import type { CampaignMissionData } from "../../src/game-data.ts";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import type { FinChildData } from "../../src/render/fin-animation.ts";
import { createMissionSceneFrame, type MissionSceneEntity } from "../../src/render/mission-scene-frame.ts";
import { createMissionMode3Terrain, withMissionTerrainCoverage, type MissionIndexedTerrain } from "../../src/render/mission-terrain.ts";
import { registerNativePaletteImage } from "../../src/render/mode1-canvas.ts";
import { nativeMode3Filter } from "../../src/render/mode3-effect.ts";
import { readNativeGifPalette, RemapTable } from "../../src/render/palette.ts";
import { parseFin } from "../extractors/animations/fin.ts";
import { parseSprite } from "../extractors/sprites/spr.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(read(`public/assets/generated/${path}`).toString());
const native = JSON.parse(process.env.DC_MODE3_TRACE ? readFileSync(process.env.DC_MODE3_TRACE, "utf8") :
  execFileSync("python3", [new URL("../research/mode3-effect-20260920.py", import.meta.url).pathname], {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
const evidence = native.cases.find((entry: { bank: string; controlledMirror: boolean }) => entry.bank === "DESERT" && !entry.controlledMirror);

function sourceMission(): CampaignMissionData {
  const original = (extension: string) => read(`raw_cd/DC/SCENARIO/HUMAN/HUMAN01.${extension}`);
  const bundle = parseMapBundle(original("MAP"), original("MTG"), original("PTH"));
  const map = json("maps/HUMAN/HUMAN01.json");
  const records = read(`public/assets/generated/maps/HUMAN/${map.files.tileRecordIndices}`);
  return { faction: "human", map,
    scenario: { ...json("data/scenarios/HUMAN/HUMAN01.json"), ...parseScenario(original("SCN").toString()) },
    triggers: [], messages: [], briefing: json("data/briefings/HUMAN/HUMAN01.json"),
    units: parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString()),
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    tileReferences: bundle.tileReferences, attributes: bundle.attributes, pathGrid: bundle.pathGrid, tags: bundle.tagGrid,
    tileRecordIndices: Uint16Array.from({ length: records.length / 2 }, (_, index) => records.readUInt16LE(index * 2)) };
}

type Source = ReturnType<typeof parseSprite>["frames"][number];
interface SoftwareImage { source: Source; rgba: Uint8ClampedArray; name: string }

function framebuffer(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4), touched = new Uint8Array(width * height);
  const events: string[] = [];
  type State = { x: number; y: number; scaleX: number; scaleY: number; clip: number[][] | null };
  let state: State = { x: 0, y: 0, scaleX: 1, scaleY: 1, clip: null }, path: number[][] = [];
  const stack: State[] = [];
  let writes = 0;
  const context = {
    globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    getTransform: () => ({ a: state.scaleX, b: 0, c: 0, d: state.scaleY, e: state.x, f: state.y }),
    createImageData: (imageWidth: number, imageHeight: number) => ({ width: imageWidth, height: imageHeight,
      data: new Uint8ClampedArray(imageWidth * imageHeight * 4) }),
    putImageData(image: ImageData, left: number, top: number) {
      events.push(writes++ ? "effect" : "terrain");
      for (let row = 0; row < image.height; row++) for (let column = 0; column < image.width; column++) {
        const offset = (top + row) * width + left + column;
        pixels.set(image.data.subarray((row * image.width + column) * 4, (row * image.width + column + 1) * 4), offset * 4);
        if (writes > 1) touched[offset] = 1;
      }
    },
    getImageData(left: number, top: number, imageWidth: number, imageHeight: number) {
      events.push("readback");
      const image = context.createImageData(imageWidth, imageHeight);
      for (let row = 0; row < imageHeight; row++) image.data.set(pixels.subarray(((top + row) * width + left) * 4,
        ((top + row) * width + left + imageWidth) * 4), row * imageWidth * 4);
      return image;
    },
    save() { stack.push({ ...state }); }, restore() { state = stack.pop()!; },
    translate(horizontal: number, vertical: number) { state.x += horizontal * state.scaleX; state.y += vertical * state.scaleY; },
    scale(horizontal: number, vertical: number) { state.scaleX *= horizontal; state.scaleY *= vertical; },
    beginPath() { path = []; }, rect(left: number, top: number, spanWidth: number, spanHeight: number) { path.push([left, top, spanWidth, spanHeight]); },
    clip() { state.clip = path; }, strokeRect() {}, moveTo() {}, lineTo() {}, stroke() {},
    drawImage(image: SoftwareImage, sourceX: number, sourceY: number, sourceWidth: number, sourceHeight: number,
      left: number, top: number, targetWidth: number, targetHeight: number) {
      events.push(`sprite:${image.name}`);
      assert.equal(sourceWidth, targetWidth); assert.equal(sourceHeight, targetHeight);
      for (let row = 0; row < sourceHeight; row++) for (let column = 0; column < sourceWidth; column++) {
        const source = (sourceY + row) * image.source.width + sourceX + column;
        if (!image.source.alpha[source]) continue;
        const destinationX = state.x + (left + column) * state.scaleX - (state.scaleX < 0 ? 1 : 0);
        const destinationY = state.y + (top + row) * state.scaleY;
        if (destinationX < 0 || destinationY < 0 || destinationX >= width || destinationY >= height) continue;
        if (state.clip && !state.clip.some(([clipX, clipY, clipWidth, clipHeight]) =>
          destinationX >= clipX && destinationY >= clipY && destinationX < clipX + clipWidth && destinationY < clipY + clipHeight)) continue;
        const offset = destinationY * width + destinationX;
        pixels.set(image.rgba.subarray(source * 4, source * 4 + 4), offset * 4);
        touched[offset] = 1;
      }
    },
  };
  const canvas = { width, height, getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) } as unknown as HTMLCanvasElement;
  Object.assign(context, { canvas });
  return { canvas, context: context as unknown as CanvasRenderingContext2D, pixels, touched, events };
}

function fixture() {
  const mission = sourceMission();
  const metadata = json("indexed/terrain/DESERT.json") as MissionIndexedTerrain;
  const atlas = read(`public/assets/generated/indexed/${metadata.indices.path}`);
  const indexed = withMissionTerrainCoverage(metadata, atlas);
  const palette = readNativeGifPalette(read(evidence.gif.path)), remap = new RemapTable(read(evidence.remap.path));
  const terrain = createMissionMode3Terrain(mission, indexed, atlas, palette, remap);
  const golden = evidence.raster.frames[0];
  const sample = Object.freeze({ timelineIndex: 19, finished: false,
    children: Object.freeze(parseFin(read("raw_cd/DC/ANIMATE/VENT.FIN")).timeline[19].children.map(child => Object.freeze(child))) });
  assert.deepEqual(sample.children[3], evidence.sourceChild);
  const sources = new Map<FinChildData, Source>(sample.children.map(child => [child, parseSprite(read(`raw_cd/DC/SPRITES/${child.sprite.toUpperCase()}.SPR`)).frames[child.frame]]));
  const parts = composeFinSample(sample, (name, frame) => {
    const child = sample.children.find(child => child.sprite === name && child.frame === frame)!;
    return { ...sources.get(child)!, x: 0, y: 0, index: frame, empty: false };
  });
  const entity: MissionSceneEntity = Object.freeze({ rawSlot: 0, sample, parts,
    xSubcells: (golden.queuedX - sample.children[3].x) * 32,
    ySubcells: (mission.map.height * 32 - 1 - golden.baseline + sample.children[3].y) * 32,
    heightSubcells: 0, fallbackOrigin: { x: golden.queuedX - sample.children[3].x - golden.camera.x,
      y: golden.baseline - sample.children[3].y - golden.camera.y } });
  const images = new Map<FinChildData, CanvasImageSource>(sample.children.map(child => {
    const source = sources.get(child)!;
    const rgba = Uint8ClampedArray.from({ length: source.indices.length * 4 }, (_, offset) => {
      if (offset % 4 === 3) return source.alpha[Math.floor(offset / 4)] ? 255 : 0;
      const index = source.indices[Math.floor(offset / 4)];
      return palette[(child.valueA === 0 ? remap.lookup(2, 128, index) : index) * 3 + offset % 4];
    });
    const image = { source, rgba, name: `${child.sprite}:${child.frame}` } as unknown as CanvasImageSource;
    registerNativePaletteImage(image, { ...source, coverage: source.alpha, palette, remap, selector: 0 });
    return [child, image] as const;
  }));
  const input: MissionViewMode3Frame = { terrain, surface: { ...golden.camera, indices: new Uint8Array(golden.camera.width * golden.camera.height).fill(128) },
    enabled: true, queue: sample.children.map((_, sourceChildIndex) => ({ rawSlot: 0, sourceChildIndex })),
    capture: () => [entity], sprite: body => { const source = sources.get(body.part.child); return source && { ...source, coverage: source.alpha }; },
    image: (_name, part) => images.get(part.child) };
  return { mission, terrain, golden, entity, input, palette, remap };
}

test("MissionView frozen source VENT19 publishes native-positive pixels before bodies with one snapshot, no mode3 sprite or state mutation", context => {
  context.mock.method(console, "warn", () => {});
  const fixtureData = fixture(), { mission, input, golden, entity } = fixtureData;
  const surface = framebuffer(input.surface.width, input.surface.height);
  const view = new MissionView(surface.canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  const before = view.checkpoint();
  const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(view.simulation), "snapshot")!.get!;
  let snapshots = 0, captures = 0;
  Object.defineProperty(view.simulation, "snapshot", { configurable: true, get() { snapshots++; return getter.call(this); } });
  const result = view.renderBoundedMode3({ ...input, capture: () => { captures++; return [entity]; } });
  Reflect.deleteProperty(view.simulation, "snapshot");
  assert.equal(result.exact, true, JSON.stringify(result.exact ? {} : result));
  assert.equal(snapshots, 1); assert.equal(captures, 1);
  if (!result.exact) return;
  assert.equal(result.scope, "bounded-terrain-prepass");
  assert.deepEqual(Buffer.from(result.output.indices), Buffer.from(golden.variants[0].output, "base64"));
  assert.deepEqual(Buffer.from(result.illumination.indices), Buffer.from(golden.variants[0].filter, "base64"));
  assert.deepEqual(Buffer.from(result.output.terrainIndices), Buffer.from(golden.terrain, "base64"));
  assert.equal(surface.events[0], "terrain");
  assert.ok(surface.events.some(event => event.startsWith("sprite:")));
  assert.ok(!surface.events.includes(`sprite:${entity.sample.children[3].sprite}:${entity.sample.children[3].frame}`));
  const baseline = input.terrain!.renderIllumination(input.surface);
  let visiblePositive = 0;
  for (let offset = 0; offset < surface.touched.length; offset++) if (!surface.touched[offset]
    && result.output.indices[offset] !== baseline.indices[offset]
    && result.output.rgba.slice(offset * 4, offset * 4 + 3).some((value, channel) => value !== baseline.rgba[offset * 4 + channel])) {
    assert.deepEqual(surface.pixels.slice(offset * 4, offset * 4 + 4), result.output.rgba.slice(offset * 4, offset * 4 + 4));
    visiblePositive++;
  }
  assert.ok(visiblePositive > 0);
  assert.equal(result.frame.effectBudget.mode3AllocatedPixels, 320 * 256);
  assert.ok(result.frame.effectBudget.remainingPixels >= 0);
  assert.ok(input.surface.indices.every(value => value === 128));
  assert.deepEqual(view.checkpoint(), before);
  context.diagnostic(`${visiblePositive} visible lit pixels survive the actual bounded MissionView body/effect pass`);
});

test("bounded publication rejects unknown, incomplete, fractional, top/side clipped and over-budget inputs without mode3 suppression", context => {
  context.mock.method(console, "warn", () => {});
  const { mission, terrain, input, entity } = fixture();
  const surface = framebuffer(512, 452);
  const view = new MissionView(surface.canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  const before = surface.pixels.slice();
  for (const rejected of [{ ...input, sprite: () => undefined }, { ...input, queue: input.queue.slice(1) },
    { ...input, surface: { ...input.surface, x: input.surface.x + 0.25 } },
    { ...input, surface: { ...input.surface, x: input.surface.x + 128 } },
    { ...input, surface: { ...input.surface, y: input.surface.y + 128 } },
    { ...input, surface: { ...input.surface, width: 512, height: 452, indices: new Uint8Array(512 * 452) } }]) {
    assert.equal(view.renderBoundedMode3(rejected).exact, false);
    assert.deepEqual(surface.pixels, before);
    assert.equal(surface.events.length, 0);
  }
  const frame = createMissionSceneFrame({ mission, indexed: terrain.indexed, camera: input.surface, entities: [entity] });
  assert.equal(frame.drawMode3Terrain(surface.context, terrain, { ...input, sprite: () => undefined }).exact, false);
  frame.drawEntity(surface.context, entity.rawSlot, input.image);
  assert.ok(surface.events.includes(`sprite:${entity.sample.children[3].sprite}:${entity.sample.children[3].frame}`));
  assert.ok(frame.commands.some(command => command.diagnostics.includes("native-draw-mode:3")));
  assert.equal(frame.drawMode3Terrain(surface.context, terrain, input).exact, false);
});

test("bounded publication rejects a captured mode3 child with no parts or queue before sprite lookup", context => {
  context.mock.method(console, "warn", () => {});
  const { mission, terrain, input, entity } = fixture();
  const surface = framebuffer(input.surface.width, input.surface.height);
  const before = surface.pixels.slice(), filters = input.surface.indices.slice();
  const view = new MissionView(surface.canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  let spriteCalls = 0;
  const sprite = () => { spriteCalls++; throw new Error("Missing parts must reject before sprite lookup"); };
  assert.equal(entity.sample.children.length, 4);
  assert.ok(entity.parts.some(part => part.child.valueA === 0));
  for (const incomplete of [
    { ...entity, sample: { ...entity.sample, children: [entity.sample.children[3]] }, parts: [] },
    { ...entity, parts: [] },
    { ...entity, sample: { ...entity.sample, finished: true }, parts: [] },
    { ...entity, parts: entity.parts.filter(part => part.child.valueA !== 0) },
    { ...entity, parts: entity.parts.map(part => part.child.valueA === 0 ? { ...part, frame: undefined } : part) },
  ]) {
    const frame = createMissionSceneFrame({ mission, indexed: terrain.indexed, camera: input.surface, entities: [incomplete] });
    assert.equal(frame.commands.length, incomplete.parts.length);
    const queue = incomplete.parts.map(part => ({ rawSlot: incomplete.rawSlot, sourceChildIndex: incomplete.sample.children.indexOf(part.child) }));
    const result = view.renderBoundedMode3({ ...input, capture: () => [incomplete], queue, sprite });
    assert.equal(spriteCalls, 0);
    assert.equal(result.exact, false);
    if (!result.exact) assert.match(result.diagnostic, /mode3-prepass-unverified:Complete captured queue required/);
    assert.equal(frame.drawMode3Terrain(surface.context, terrain, { ...input, queue, sprite }).exact, false);
    assert.deepEqual(surface.events, []);
    assert.deepEqual(surface.pixels, before);
    assert.deepEqual(input.surface.indices, filters);
    assert.equal(frame.effectBudget.mode3AllocatedPixels, 0);
    if (incomplete.parts.length) {
      assert.ok(frame.commands.some(command => command.diagnostics.includes("native-draw-mode:3")));
      const fallback = framebuffer(input.surface.width, input.surface.height);
      frame.drawEntity(fallback.context, incomplete.rawSlot, input.image);
      assert.ok(fallback.events.includes(`sprite:${entity.sample.children[3].sprite}:${entity.sample.children[3].frame}`));
    }
  }
  for (const finished of [false, true]) {
    const empty = { ...entity, sample: { ...entity.sample, finished, children: [] }, parts: [] };
    const result = view.renderBoundedMode3({ ...input, capture: () => [empty], queue: [], sprite });
    assert.equal(result.exact, true);
    if (result.exact) {
      assert.deepEqual(result.illumination.indices, filters);
      assert.equal(result.owned.size, 0);
    }
  }
  assert.equal(spriteCalls, 0);
  assert.deepEqual(surface.events, ["terrain", "effect"]);
  assert.deepEqual(input.surface.indices, filters);
});

test("two frozen captures accumulate all mode3 children before a single original-index terrain lookup and reset next frame", context => {
  context.mock.method(console, "warn", () => {});
  const { mission, input, entity, golden, remap } = fixture();
  const surface = framebuffer(input.surface.width, input.surface.height);
  const view = new MissionView(surface.canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  const other = { ...entity, rawSlot: 120 };
  const result = view.renderBoundedMode3({ ...input, capture: () => [entity, other],
    queue: [...input.queue, ...input.queue.map(entry => ({ ...entry, rawSlot: 120 }))] });
  assert.equal(result.exact, true, JSON.stringify(result.exact ? {} : result));
  if (!result.exact) return;
  const once = Buffer.from(golden.variants[0].filter, "base64");
  assert.ok(result.illumination.indices.some((value, offset) => value !== once[offset]));
  assert.deepEqual(Buffer.from(result.output.terrainIndices), Buffer.from(golden.terrain, "base64"));
  const source = input.sprite(result.frame.commands.find(command => command.source.part.child.valueA === 3)!.source)!;
  const light = result.frame.commands.find(command => command.source.part.child.valueA === 3)!.source;
  let checked = 0;
  for (let row = 0; row < source.height; row++) for (let column = 0; column < source.width; column++) {
    const pixel = row * source.width + column;
    if (!source.coverage[pixel]) continue;
    const offset = (light.position.y - source.height + row - input.surface.y) * input.surface.width
      + light.position.x + light.part.frame!.anchorX + column - input.surface.x;
    assert.equal(result.illumination.indices[offset], nativeMode3Filter(source.indices[pixel], nativeMode3Filter(source.indices[pixel], 128)));
    checked++;
  }
  assert.ok(checked > 0);
  const reset = view.renderBoundedMode3(input);
  assert.equal(reset.exact, true);
  if (reset.exact) assert.deepEqual(Buffer.from(reset.output.indices), Buffer.from(golden.variants[0].output, "base64"));
  assert.ok(result.output.indices.some((value, offset) => value !== remap.lookup(0, result.illumination.indices[offset], once[offset])));
});

test("explicit day/night filter bytes are consumed once; disabled gate preserves source terrain lookup", context => {
  context.mock.method(console, "warn", () => {});
  const { mission, input, remap } = fixture();
  const surface = framebuffer(input.surface.width, input.surface.height);
  const view = new MissionView(surface.canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  for (const filter of [128, 131, 135]) {
    const plane = { ...input.surface, indices: new Uint8Array(input.surface.indices.length).fill(filter) };
    const disabled = view.renderBoundedMode3({ ...input, surface: plane, enabled: false });
    assert.equal(disabled.exact, true);
    if (!disabled.exact) return;
    assert.ok(disabled.illumination.indices.every(value => value === filter));
    for (let offset = 0; offset < plane.indices.length; offset++) {
      assert.equal(disabled.output.indices[offset], remap.lookup(0, filter, disabled.output.terrainIndices[offset]));
    }
    const enabled = view.renderBoundedMode3({ ...input, surface: plane });
    assert.equal(enabled.exact, true);
    if (!enabled.exact) return;
    const direct = input.terrain!.renderIllumination(enabled.illumination);
    assert.deepEqual(enabled.output, direct);
    assert.ok(enabled.illumination.indices.some(value => value !== filter));
    assert.ok(plane.indices.every(value => value === filter));
  }
});

test("publication failure never acquires no-op entitlement and bounded shadow adapters cannot exceed the frame budget", context => {
  context.mock.method(console, "warn", () => {});
  const { mission, terrain, input, entity } = fixture();
  const surface = framebuffer(input.surface.width, input.surface.height);
  const frame = createMissionSceneFrame({ mission, indexed: terrain.indexed, camera: input.surface, entities: [entity] });
  const originalPut = surface.context.putImageData;
  surface.context.putImageData = () => { throw new Error("controlled write failure"); };
  assert.equal(frame.drawMode3Terrain(surface.context, terrain, input).exact, false);
  assert.equal(frame.effectBudget.mode3AllocatedPixels, 0);
  assert.ok(frame.commands.some(command => command.diagnostics.includes("native-draw-mode:3")));
  surface.context.putImageData = originalPut;
  const trsc = parseFin(read("raw_cd/DC/ANIMATE/TRSC.FIN")).timeline[0];
  const sample = { timelineIndex: 0, finished: false, children: trsc.children };
  assert.ok(sample.children.some(child => child.valueA === 1));
  const sprites = new Map(sample.children.map(child => [child.sprite, parseSprite(read(`raw_cd/DC/SPRITES/${child.sprite.toUpperCase()}.SPR`))]));
  const parts = composeFinSample(sample, (sprite, frame) => ({ ...sprites.get(sprite)!.frames[frame], x: 0, y: 0, index: frame, empty: false }));
  const actor = { ...entity, rawSlot: 121, sample, parts };
  const bounded = createMissionSceneFrame({ mission, indexed: terrain.indexed, camera: input.surface, entities: [entity, actor] });
  const published = bounded.drawMode3Terrain(surface.context, terrain, { ...input,
    queue: [...input.queue, ...sample.children.map((_, sourceChildIndex) => ({ rawSlot: 121, sourceChildIndex }))] });
  assert.equal(published.exact, true);
  bounded.drawEntity(surface.context, actor.rawSlot, () => undefined);
  assert.ok([...bounded.mode1Results.values()].every(result => !result.exact && result.diagnostic === "mode1-shadow-shared-budget-unverified"));
  assert.equal(bounded.effectBudget.readbackPixels, 0);
  assert.equal(bounded.effectBudget.remainingPixels, 128 * 1024 - input.surface.indices.length);
});