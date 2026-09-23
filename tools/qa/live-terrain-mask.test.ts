import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import { createFinFrameLookup, type FinAnimationData } from "../../src/render/fin-animation";
import { composeFinSample } from "../../src/render/fin-composition";
import { createMissionSceneFrame, missionSceneCamera } from "../../src/render/mission-scene-frame";
import { withMissionTerrainCoverage, type MissionIndexedTerrain } from "../../src/render/mission-terrain";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseMapBundle } from "../extractors/maps/map";
import { parseFin } from "../extractors/animations/fin";
import { parseTerrainBank } from "../extractors/maps/bts";
import { parseSprite } from "../extractors/sprites/spr";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(read(`public/assets/generated/${path}`).toString());

function sourceMission(): CampaignMissionData {
  const original = (extension: string) => read(`raw_cd/DC/SCENARIO/ALIEN/ALIEN01.${extension}`);
  const bundle = parseMapBundle(original("MAP"), original("MTG"), original("PTH"));
  const map = json("maps/ALIEN/ALIEN01.json");
  const records = read(`public/assets/generated/maps/ALIEN/${map.files.tileRecordIndices}`);
  return {
    faction: "alien", map,
    scenario: { ...json("data/scenarios/ALIEN/ALIEN01.json"), ...parseScenario(original("SCN").toString()) },
    triggers: [], messages: [], briefing: json("data/briefings/ALIEN/ALIEN01.json"),
    units: parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString()),
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    tileReferences: bundle.tileReferences, attributes: bundle.attributes, pathGrid: bundle.pathGrid, tags: bundle.tagGrid,
    tileRecordIndices: Uint16Array.from({ length: records.length / 2 }, (_, index) => records.readUInt16LE(index * 2)),
  };
}

type Call = { name: string; args: unknown[] };

function recordingCanvas(calls: Call[], gpu: { draws: number; uploads: number }) {
  const drawing: Record<string, unknown> = Object.fromEntries([
    "setTransform", "clearRect", "fillRect", "strokeRect", "beginPath", "ellipse", "stroke",
    "save", "restore", "translate", "scale", "moveTo", "lineTo", "fillText", "setLineDash",
    "drawImage", "rect", "clip", "putImageData",
  ].map((name) => [name, (...args: unknown[]) => calls.push({ name, args })]));
  drawing.measureText = (text: string) => ({ width: text.length * 6 });
  drawing.createImageData = (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) });
  const gl: Record<string, unknown> = {
    drawingBufferWidth: 512, drawingBufferHeight: 452,
    isContextLost: () => false, getError: () => 0,
    getParameter: () => 16384, getShaderParameter: () => true, getProgramParameter: () => true,
    drawArrays: () => { gpu.draws++; }, texImage2D: () => { gpu.uploads++; },
  };
  for (const name of ["createTexture", "createProgram", "createVertexArray", "createShader", "getUniformLocation"]) {
    gl[name] = () => ({});
  }
  for (const name of ["bindBuffer", "bindTexture", "pixelStorei", "texParameteri", "deleteTexture", "shaderSource",
    "compileShader", "attachShader", "linkProgram", "detachShader", "deleteShader", "deleteVertexArray", "deleteProgram",
    "bindFramebuffer", "viewport", "disable", "colorMask", "clearColor", "clear", "useProgram", "bindVertexArray",
    "uniform2i", "uniform4i", "uniform1i", "activeTexture", "bindSampler"]) gl[name] = () => {};
  const constants = ["NO_ERROR", "MAX_TEXTURE_SIZE", "PIXEL_UNPACK_BUFFER", "TEXTURE_2D", "UNPACK_ALIGNMENT",
    "UNPACK_FLIP_Y_WEBGL", "UNPACK_PREMULTIPLY_ALPHA_WEBGL", "UNPACK_COLORSPACE_CONVERSION_WEBGL", "NONE",
    "UNPACK_ROW_LENGTH", "UNPACK_SKIP_PIXELS", "UNPACK_SKIP_ROWS", "TEXTURE_MIN_FILTER", "NEAREST",
    "TEXTURE_MAG_FILTER", "TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "CLAMP_TO_EDGE", "R8UI", "RGB8UI", "RED_INTEGER",
    "RGB_INTEGER", "UNSIGNED_BYTE", "VERTEX_SHADER", "FRAGMENT_SHADER", "COMPILE_STATUS", "LINK_STATUS",
    "FRAMEBUFFER", "BLEND", "DITHER", "DEPTH_TEST", "STENCIL_TEST", "SCISSOR_TEST", "CULL_FACE",
    "RASTERIZER_DISCARD", "COLOR_BUFFER_BIT", "TEXTURE0", "TRIANGLE_STRIP"];
  constants.forEach((name, index) => { gl[name] = index; });
  const strictGL = new Proxy(gl, { get(target, name) {
    assert.ok(name in target, `Unexpected WebGL member: ${String(name)}`);
    return target[String(name)];
  } });
  return {
    width: 512, height: 452,
    getContext: (kind: string) => kind === "2d" ? drawing : kind === "webgl2" ? strictGL : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }),
    addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLCanvasElement;
}

test("live MissionView clips original normal and mirrored TRSC mode 0; mode 1 falls back", { timeout: 10000 }, async (context) => {
  const calls: Call[] = [];
  const gpu = { draws: 0, uploads: 0 };
  const warnings: string[] = [];
  const requested = new Set<string>();
  class FixtureImage {
    decoding = "";
    #load: (() => void) | undefined;
    addEventListener(event: string, listener: () => void) { if (event === "load") this.#load = listener; }
    set src(_path: string) { queueMicrotask(() => this.#load?.()); }
  }
  for (const [key, value] of Object.entries({ Image: FixtureImage,
    document: { createElement: () => recordingCanvas([], gpu) } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    context.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  let fixtureTimeline: number | undefined;
  const animation = json("animations/TRSC.json") as FinAnimationData;
  const originalFin = parseFin(read("raw_cd/DC/ANIMATE/TRSC.FIN"));
  for (const index of [0, 254, 276]) assert.deepEqual(animation.timeline[index], originalFin.timeline[index]);
  const metadata = json("indexed/terrain/DESERT.json") as MissionIndexedTerrain;
  const indexed = withMissionTerrainCoverage(metadata, read(`public/assets/generated/indexed/${metadata.indices.path}`));
  const bank = parseTerrainBank(read("raw_cd/DC/SCENARIO/DESERT.BTS"));
  for (const [record, tile] of bank.tiles.entries()) {
    for (let row = 0; row < 32; row++) {
      let coverage = 0;
      for (let column = 0; column < 32; column++) {
        if (tile.indices[row * 32 + column] !== 0) coverage |= 1 << (31 - column);
      }
      assert.equal(indexed.sourceForegroundCoverage![record][row], coverage >>> 0);
    }
  }
  const atlas = json("sprites/SPRITES/TRSC.json");
  const lookup = createFinFrameLookup({ TRSC: atlas });
  const originalSprite = parseSprite(read("raw_cd/DC/SPRITES/TRSC.SPR"));
  for (const frameIndex of [0, 156, 135]) {
    const frame = lookup("trsc", frameIndex)!;
    const original = originalSprite.frames[frameIndex];
    assert.deepEqual([frame.width, frame.height, frame.anchorX, frame.anchorY],
      [original.width, original.height, original.anchorX, original.anchorY]);
  }
  assert.deepEqual(animation.timeline[254].children.map(({ frame, flags, valueA, valueB, layer }) =>
    [frame, flags, valueA, valueB, layer]), [[156, 16, 0, 0, 1]]);
  assert.deepEqual(animation.timeline[276].children.map(({ frame, flags, valueA, valueB, layer }) =>
    [frame, flags, valueA, valueB, layer]), [[135, 16, 0, 1, 1]]);
  assert.equal(animation.timeline[0].children[0].valueA, 1);
  context.mock.method(globalThis, "fetch", async (url: string) => {
    assert.ok(url.startsWith("/assets/generated/"));
    requested.add(url);
    if (url === "/assets/generated/animations/TRSC.json" && fixtureTimeline !== undefined) {
      return Response.json({ ...animation, states: animation.states.map((state) => state.name === "TRSCSTAND0"
        ? { ...state, firstTimelineIndex: fixtureTimeline, lastTimelineIndex: fixtureTimeline } : state) });
    }
    return new Response(read(`public${url}`));
  });
  context.mock.method(console, "warn", (...args: unknown[]) => warnings.push(String(args[0])));
  const measurements: unknown[] = [];
  for (const timeline of [undefined, 254, 276]) {
    fixtureTimeline = timeline;
    const mission = sourceMission();
    const view = new MissionView(recordingCanvas(calls, gpu), {} as HTMLElement,
      { onStats() {}, onUnitsChanged() {} }, mission);
    context.after(() => view.dispose());
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.terrainRendererStatus, "indexed-webgl2");
    const units = view.simulation.snapshot.units;
    const checkpoint = view.checkpoint();
    const trscTypes = new Set(mission.units.filter(({ sprite }) => sprite === "TRSC").map(({ index }) => index));
    const trscIds = new Set(checkpoint.state.unitStats.filter(({ type }) => trscTypes.has(type)).map(({ id }) => id));
    const focus = units.find(({ id }) => trscIds.has(id));
    assert.ok(focus, "ALIEN01 must supply an original TRSC mobile actor");
    context.mock.method(view, "isOwnedUnit", (id: number) => id === focus.id);
    view.setCameraCenter(focus.cellX + 0.5, focus.cellY + 0.5);
    const binding = view.nativeBindings.find(({ simulationId }) => simulationId === focus.id)!;
    assert.ok(binding && Number.isInteger(binding.slot));
    assert.ok(Number.isInteger(focus.xSubcells) && Number.isInteger(focus.ySubcells));
    const camera = view.checkpoint().state.camera;
    const sample = { timelineIndex: timeline ?? 0, finished: false,
      children: originalFin.timeline[timeline ?? 0].children };
    const parts = composeFinSample(sample, lookup);
    const fallbackOrigin = { x: 256 + (focus.xSubcells / 1024 - camera.x) * 32,
      y: 226 - (focus.ySubcells / 1024 - camera.y) * 32 };
    const expected = createMissionSceneFrame({ mission, indexed,
      camera: missionSceneCamera(camera.x, camera.y, mission.map.height),
      entities: [{ rawSlot: binding.slot, xSubcells: focus.xSubcells, ySubcells: focus.ySubcells,
        heightSubcells: 0, sample, parts, fallbackOrigin }] });
    assert.equal(expected.orderingVerified, false);
    assert.equal(expected.commands.length, 1);
    const command = expected.commands[0];
    const readSnapshot = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(view.simulation), "snapshot")!.get!;
    let snapshotReads = 0;
    Object.defineProperty(view.simulation, "snapshot", { configurable: true, get() {
      snapshotReads++;
      assert.equal(snapshotReads, 1, "render must reuse one simulation snapshot");
      return readSnapshot.call(this);
    } });
    calls.length = 0;
    const previousDraws = gpu.draws;
    view.render();
    assert.equal(snapshotReads, 1);
    Reflect.deleteProperty(view.simulation, "snapshot");
    assert.equal(view.terrainRendererStatus, "indexed-webgl2");
    assert.ok(gpu.draws > previousDraws && gpu.uploads > 2, "real indexed renderer uploads and submits terrain");
    const clips = calls.filter(({ name }) => name === "clip");
    const rects = calls.filter(({ name }) => name === "rect");
    const sprites = calls.filter(({ name, args }) => name === "drawImage" && args.length === 9);
    assert.ok(sprites.length > 0, "real FIN consumer draws palette-backed atlas crops");
    const firstHealthBar = calls.findIndex(({ name, args }) => name === "fillRect" && args[3] === 2);
    assert.ok(firstHealthBar > calls.indexOf(sprites.at(-1)!), "all health overlays must follow all world bodies and shadows");
    const frame = parts[0].frame!;
    const crop = [frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height];
    assert.equal(calls.filter(({ name }) => name === "save").length,
      calls.filter(({ name }) => name === "restore").length, "clip state must not leak into overlays");
    if (timeline === undefined) {
      assert.equal(command.clips, null);
      assert.equal(clips.length, 0, "original default mode 1 must not acquire a mask");
      const sprite = sprites.find(({ args }) => JSON.stringify(args.slice(1)) === JSON.stringify(crop));
      assert.ok(sprite, "default mode 1 must retain its original SPR crop");
      assert.ok(!(sprite.args[0] instanceof FixtureImage), "mode 1 retains the palette/team canvas lookup");
      const drawIndex = calls.indexOf(sprite);
      assert.deepEqual(calls[drawIndex - 2], { name: "translate", args: [
        Math.round(fallbackOrigin.x + parts[0].x), Math.round(fallbackOrigin.y + parts[0].y)] });
    }
    else {
      assert.equal(clips.length, 1, `original timeline ${timeline} must reach MissionView's supported mask branch`);
      assert.ok(command.clips && command.clips.length > 0);
      assert.deepEqual(rects.map(({ args }) => args), command.clips.map((span) =>
        [command.topLeft.x + span.x, command.topLeft.y + span.y, span.width, span.height]),
      "live clip spans must use the source-bound current Q10 position and real source coverage");
      const clipIndex = calls.indexOf(clips[0]);
      const body = calls.slice(clipIndex + 1).find(({ name }) => name === "drawImage")!;
      assert.deepEqual(body.args.slice(1), crop, "the clipped draw must consume the unchanged original SPR frame");
      assert.ok(!(body.args[0] instanceof FixtureImage), "mode 0 retains the palette/team canvas lookup");
      assert.deepEqual(calls[clipIndex + 2], { name: "translate", args: [command.topLeft.x, command.topLeft.y] });
      const bodyIndex = calls.indexOf(body);
      assert.equal(sprites.filter(({ args }) => args[0] === body.args[0]
        && JSON.stringify(args.slice(1)) === JSON.stringify(crop)).length, 1, "the body must be drawn exactly once");
      if (timeline === 276) {
        assert.deepEqual(calls.slice(bodyIndex - 2, bodyIndex), [
          { name: "translate", args: [frame.width, 0] }, { name: "scale", args: [-1, 1] },
        ]);
        assert.equal(command.topLeft.x, command.compositionOrigin.x + parts[0].child.x + 1);
      }
      assert.deepEqual(calls.slice(bodyIndex + 1, bodyIndex + 3).map(({ name }) => name), ["restore", "restore"]);
      assert.ok(calls.slice(bodyIndex + 3).some(({ name, args }) => name === "fillRect" && args[3] === 2),
        "health overlay still draws after the body clip is restored");
    }
    measurements.push({ timeline: timeline ?? "original default", rawSlot: binding.slot, generation: binding.generation,
      positionQ10: [focus.xSubcells, focus.ySubcells], snapshotReads, clips: clips.length,
      rects: rects.length, sprites: sprites.length, bodyArea: frame.width * frame.height,
      clippedArea: command.clips?.reduce((area, span) => area + span.width * span.height, 0) ?? null });
    view.dispose();
  }
  assert.ok(requested.has("/assets/generated/indexed/terrain/DESERT.json"));
  assert.ok(requested.has(`/assets/generated/indexed/${metadata.indices.path}`));
  assert.ok(!warnings.some((warning) => warning.includes("Indexed terrain unavailable")));
  assert.ok(!warnings.some((warning) => warning.includes("unsupported-timeline")));
  assert.ok(warnings.some((warning) => warning.includes("native-cross-entity-child-sorting-unimplemented")));
  context.diagnostic(JSON.stringify(measurements));
});