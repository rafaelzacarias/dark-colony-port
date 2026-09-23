import type { FinAnimationData, FinAtlasFrame } from "../../../src/render/fin-animation";
import type { CampaignMissionData } from "../../../src/game-data";
import { composeFinSample } from "../../../src/render/fin-composition";
import { createMissionSceneFrame, type MissionSceneCamera } from "../../../src/render/mission-scene-frame";
import { createMissionTerrain, type MissionIndexedTerrain, type MissionTerrainInput } from "../../../src/render/mission-terrain";
import { createMissionSpritePalettes } from "../../../src/render/mission-sprites";
import type { NativePaletteAtlas } from "../../../src/render/mode1-canvas";
import { composeNativeMode2, drawNativeMode2Indexed } from "../../../src/render/mode2-shadow";

export const mode2BrowserSource = Object.freeze({ animation: "ALBU", timelineIndex: 13, childIndex: 2, rawSlot: 120 });
export const mode2BrowserLabel = "QA only: unchanged ALBU timeline 13 child 2; controlled viewport placement, not original world placement or campaign parity";
export const mode2BrowserPalettes = ["DESERT", "JUNGLE", "ATLANTIS", "HTRAIN"] as const;
export type Mode2BrowserPalette = typeof mode2BrowserPalettes[number];

interface AssetDigest { path: string; bytes: number; sha256: string }
interface SpriteMetadata {
  schemaVersion: number;
  source: AssetDigest;
  atlas: { width: number; height: number };
  indices: AssetDigest;
  coverage: AssetDigest;
  frames: readonly FinAtlasFrame[];
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export async function loadMode2BrowserSource(palette: Mode2BrowserPalette = "DESERT") {
  if (!mode2BrowserPalettes.includes(palette)) throw new Error("Unsupported mode2 QA palette");
  const root = "/assets/generated/indexed";
  const bytes = async (path: string) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error("Invalid indexed source path");
    }
    const response = await fetch(`${root}/${path}`);
    if (!response.ok) throw new Error(`Mode2 source fetch ${response.status}: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const [manifestBytes, checksum] = await Promise.all([bytes("index.json"), bytes("index.sha256")]);
  const manifestSha256 = await sha256(manifestBytes);
  if (new TextDecoder().decode(checksum).trim() !== `${manifestSha256}  index.json`) {
    throw new Error("Indexed manifest checksum mismatch");
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { schemaVersion: number; outputs: AssetDigest[] };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.outputs)) throw new Error("Indexed manifest schema mismatch");
  const verified: AssetDigest[] = [];
  const asset = async (path: string, descriptor?: AssetDigest) => {
    const entry = manifest.outputs.find(output => output.path === path);
    if (!entry || (descriptor && (entry.bytes !== descriptor.bytes || entry.sha256 !== descriptor.sha256))) {
      throw new Error(`Source absent from or inconsistent with manifest: ${path}`);
    }
    const data = await bytes(path);
    if (data.length !== entry.bytes || await sha256(data) !== entry.sha256) throw new Error(`Source hash mismatch: ${path}`);
    verified.push(entry);
    return data;
  };
  const [animationBytes, spriteBytes, paletteBytes] = await Promise.all([
    asset("animations/ALBU.json"), asset("sprites/SPRITES/ALBU.json"), asset(`palettes/${palette}.json`),
  ]);
  const animation = JSON.parse(new TextDecoder().decode(animationBytes)) as FinAnimationData & { schemaVersion: number; source: AssetDigest };
  const sprite = JSON.parse(new TextDecoder().decode(spriteBytes)) as SpriteMetadata;
  const paletteMetadata = JSON.parse(new TextDecoder().decode(paletteBytes)) as {
    schemaVersion: number; name: string; sources: AssetDigest[]; display: AssetDigest; remap: AssetDigest;
  };
  if (paletteMetadata.schemaVersion !== 1 || paletteMetadata.name !== palette) throw new Error("Source palette schema mismatch");
  if (animation.schemaVersion !== 1 || sprite.schemaVersion !== 1) throw new Error("Source metadata schema mismatch");
  const [indices, coverage] = await Promise.all([asset(sprite.indices.path, sprite.indices), asset(sprite.coverage.path, sprite.coverage)]);
  if (indices.length !== sprite.atlas.width * sprite.atlas.height || coverage.length !== indices.length) {
    throw new Error("Source atlas dimensions mismatch");
  }
  return { animation, sprite, indices, coverage, paletteMetadata, manifestSha256, verified };
}

export function mode2BrowserBackground(atlas: Pick<NativePaletteAtlas, "palette" | "remap">) {
  const color = (index: number) => Array.from(atlas.palette.subarray(index * 3, index * 3 + 3));
  for (let index = 1; index < 256; index++) {
    const rgb = color(index), shade = color(atlas.remap.lookup(0, 72, index));
    if (rgb.every((value, channel) => value === shade[channel])) continue;
    const aliases = Array.from({ length: 256 }, (_, candidate) => candidate)
      .filter(candidate => color(candidate).every((value, channel) => value === rgb[channel]));
    if (aliases.every(candidate => color(atlas.remap.lookup(0, 72, candidate)).every((value, channel) => value === shade[channel]))) {
      return { index, rgb, shade };
    }
  }
  throw new Error("Source palette has no unambiguous changing shadow background");
}

export function prepareMode2BrowserScene(input: {
  mission: MissionTerrainInput;
  indexed: MissionIndexedTerrain;
  animation: FinAnimationData;
  frames: readonly FinAtlasFrame[];
  camera?: MissionSceneCamera;
}) {
  const camera = input.camera ?? { x: 0, y: 0, width: 512, height: 452 };
  if (![camera.x, camera.y, camera.width, camera.height].every(Number.isSafeInteger)
    || camera.x < 0 || camera.y < 0 || camera.x % 32 || camera.y % 32 || camera.width % 32
    || camera.width < 32 || camera.height < 32) throw new RangeError("Native aligned, nonnegative viewport required");
  const children = input.animation.timeline[mode2BrowserSource.timelineIndex]?.children;
  const child = children?.[mode2BrowserSource.childIndex];
  if (!child || child.sprite.toUpperCase() !== "ALBU" || child.frame !== 21 || child.x !== -137 || child.y !== -100
    || child.layer !== 0 || child.flags !== 16 || child.valueA !== 2 || child.valueB !== 0) {
    throw new Error("Expected unchanged ALBU timeline 13 child 2");
  }
  const sourceFrame = input.frames.find(frame => frame.index === child.frame);
  if (!sourceFrame || sourceFrame.empty) throw new Error("Original ALBU frame 21 required");
  const projectedHeight = sourceFrame.height + Math.floor(sourceFrame.height * 40 / 256);
  const projectedWidth = sourceFrame.width + Math.floor((projectedHeight - 1) / 2);
  if (projectedWidth + 4 >= camera.width || projectedHeight + 4 >= camera.height) {
    throw new RangeError("Source shadow does not fit the controlled viewport");
  }
  const position = {
    x: camera.x + Math.floor((camera.width - projectedWidth) / 2) - sourceFrame.anchorX + Math.floor(projectedHeight / 2),
    y: camera.y + Math.floor((camera.height + projectedHeight) / 2),
    heightOffset: 0,
  };
  const sample = { children, timelineIndex: mode2BrowserSource.timelineIndex, finished: false };
  const parts = composeFinSample(sample, (sprite, frame) => sprite.toUpperCase() === "ALBU"
    ? input.frames.find(candidate => candidate.index === frame) : undefined).filter(part => part.child === child);
  const entity = { rawSlot: mode2BrowserSource.rawSlot, sample, parts, heightSubcells: 0,
    xSubcells: (position.x - child.x) * 32,
    ySubcells: (input.mission.map.height * 32 - 1 - position.y + child.y) * 32,
    fallbackOrigin: { x: position.x - camera.x, y: position.y - camera.y } };
  const scene = createMissionSceneFrame({ mission: input.mission, indexed: input.indexed, camera, entities: [entity] });
  const command = scene.commands[0];
  if (scene.commands.length !== 1 || command.source.sourceChildIndex !== 2
    || command.source.position.x !== position.x || command.source.position.y !== position.y) {
    throw new Error("Source child/baseline placement mismatch");
  }
  return { scene, camera, entity, child, sourceFrame, position, resultKey: "120:2" as const };
}

export async function createMode2BrowserFixture(mission: CampaignMissionData, options: {
  palette?: Mode2BrowserPalette;
  camera?: MissionSceneCamera;
  parent?: HTMLElement;
} = {}) {
  const palette = options.palette ?? mission.scenario.terrainBank.replace(/\.BTS$/i, "").toUpperCase() as Mode2BrowserPalette;
  if (!mode2BrowserPalettes.includes(palette)) throw new Error("Unsupported mode2 QA palette");
  const source = await loadMode2BrowserSource(palette);
  const terrain = await createMissionTerrain(mission);
  let sprites: Awaited<ReturnType<typeof createMissionSpritePalettes>> | undefined;
  const stage = document.createElement("section");
  stage.dataset.qa = "mode2-browser";
  stage.setAttribute("aria-label", "Mode2 Canvas QA fixture");
  stage.style.cssText = "position:fixed;inset:0;z-index:99999;overflow:auto;background:#161616;color:#fff;padding:12px;box-sizing:border-box;font:14px/1.4 monospace";
  const label = document.createElement("p");
  label.textContent = `${mode2BrowserLabel}. Source terrain: ${mission.scenario.id} / ${mission.scenario.terrainBank}; proof palette: ${palette} (source RMP bank 0 row 72).`;
  const layout = document.createElement("div");
  layout.style.cssText = "display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start";
  const canvas = document.createElement("canvas");
  const report = document.createElement("pre");
  report.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-width:1040px";
  const addCanvas = (title: string, element: HTMLCanvasElement) => {
    const figure = document.createElement("figure");
    figure.style.cssText = "margin:0;flex:0 1 512px;min-width:0;max-width:100%";
    const caption = document.createElement("figcaption");
    caption.textContent = title;
    element.setAttribute("aria-label", title);
    element.style.cssText = "display:block;width:100%;max-width:512px;height:auto;image-rendering:pixelated";
    figure.append(caption, element);
    layout.append(figure);
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    sprites?.dispose();
    terrain.dispose();
    canvas.width = canvas.height = 0;
    terrain.canvas.width = terrain.canvas.height = 0;
    stage.remove();
  };
  try {
    const spriteMission = { ...mission, scenario: { ...mission.scenario, terrainBank: `${palette}.BTS` } };
    sprites = await createMissionSpritePalettes(spriteMission, ["ALBU"]);
    const image = sprites.image("ALBU", 0);
    const atlas = sprites.indexedImage("ALBU", 0);
    if (!image || !atlas || atlas.width !== source.sprite.atlas.width || atlas.height !== source.sprite.atlas.height
      || await sha256(atlas.indices) !== source.sprite.indices.sha256 || await sha256(atlas.coverage) !== source.sprite.coverage.sha256
      || await sha256(atlas.palette) !== source.paletteMetadata.display.sha256
      || await sha256(atlas.remap.toTextureBytes()) !== source.paletteMetadata.remap.sha256) {
      throw new Error("Registered sprite differs from authenticated source atlas");
    }
    const background = mode2BrowserBackground(atlas);
    const input = { mission, indexed: terrain.indexed, animation: source.animation, frames: source.sprite.frames, camera: options.camera };
    const prepared = prepareMode2BrowserScene(input);
    canvas.width = prepared.camera.width;
    canvas.height = prepared.camera.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Mode2 QA requires actual Canvas2D");
    addCanvas("Original mission terrain (context only)", terrain.canvas);
    addCanvas("Actual Canvas2D mode2 dispatch / isolated opaque palette-index background", canvas);
    stage.append(label, layout, report);
    (options.parent ?? document.body).append(stage);
    const render = () => {
      if (disposed) throw new Error("Mode2 browser fixture disposed");
      const { scene, camera, position, child, sourceFrame, resultKey, entity } = prepareMode2BrowserScene(input);
      terrain.render({ cameraX: (camera.x + 256) / 32,
        cameraY: mission.map.height - (camera.y + 226) / 32,
        visible: new Uint8Array(mission.map.width * mission.map.height).fill(1) });
      context.fillStyle = `rgb(${background.rgb.join(",")})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = { reads: 0, writes: 0, readPixels: 0, drawImage: 0 };
      const originals = { getImageData: context.getImageData, putImageData: context.putImageData, drawImage: context.drawImage };
      const descriptors = Object.fromEntries(Object.keys(originals).map(name => [name, Object.getOwnPropertyDescriptor(context, name)]));
      try {
        for (const name of ["getImageData", "putImageData", "drawImage"] as const) {
          Object.defineProperty(context, name, { configurable: true, writable: true, value: (...args: unknown[]) => {
            if (name === "getImageData") { counts.reads++; counts.readPixels += Number(args[2]) * Number(args[3]); }
            else if (name === "putImageData") counts.writes++;
            else counts.drawImage++;
            return Reflect.apply(originals[name], context, args);
          } });
        }
        scene.drawEntity(context, mode2BrowserSource.rawSlot, () => image);
      } finally {
        for (const name of Object.keys(originals)) {
          const descriptor = descriptors[name];
          if (descriptor) Object.defineProperty(context, name, descriptor);
          else Reflect.deleteProperty(context, name);
        }
      }
      const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const indices = new Uint8Array(sourceFrame.width * sourceFrame.height), coverage = new Uint8Array(indices.length);
      for (let row = 0; row < sourceFrame.height; row++) {
        const start = (sourceFrame.y + row) * atlas.width + sourceFrame.x;
        indices.set(atlas.indices.subarray(start, start + sourceFrame.width), row * sourceFrame.width);
        coverage.set(atlas.coverage.subarray(start, start + sourceFrame.width), row * sourceFrame.width);
      }
      const tiles = Array.from(mission.attributes, (attributes, index) => ({ kind: "terrain" as const,
        column: index % mission.map.width, row: Math.floor(index / mission.map.width), attributes,
        backgroundIndex: mission.tileRecordIndices[index * 2], foregroundIndex: mission.tileRecordIndices[index * 2 + 1],
        foregroundMask: terrain.indexed.sourceForegroundCoverage?.[mission.tileRecordIndices[index * 2 + 1]] }));
      const plan = composeNativeMode2({ part: entity.parts[0], position, terrain: tiles,
        sprite: { width: sourceFrame.width, height: sourceFrame.height, indices, coverage } });
      const expected = { ...camera, indices: new Uint8Array(camera.width * camera.height).fill(background.index) };
      drawNativeMode2Indexed(expected, plan, atlas.remap);
      let changedPixels = 0, mismatchedPixels = 0;
      for (let pixel = 0; pixel < expected.indices.length; pixel++) {
        const offset = pixel * 4, color = expected.indices[pixel] * 3;
        if (after[offset] !== before[offset] || after[offset + 1] !== before[offset + 1]
          || after[offset + 2] !== before[offset + 2] || after[offset + 3] !== before[offset + 3]) changedPixels++;
        if (after[offset] !== atlas.palette[color] || after[offset + 1] !== atlas.palette[color + 1]
          || after[offset + 2] !== atlas.palette[color + 2] || after[offset + 3] !== 255) mismatchedPixels++;
      }
      const result = scene.mode2Results.get(resultKey);
      const passed = result?.exact === true && result.readbackPixels > 0 && counts.reads === 1 && counts.writes === 1
        && counts.drawImage === 0 && counts.readPixels === result.readbackPixels && changedPixels > 0 && mismatchedPixels === 0;
      const evidence = { passed, label: mode2BrowserLabel, palette, background, camera, position,
        source: { ...mode2BrowserSource, child, frame: sourceFrame, fin: source.animation.source, sprite: source.sprite.source,
          palette: source.paletteMetadata,
          manifestSha256: source.manifestSha256, verified: source.verified },
        terrain: { mission: mission.scenario.id, bank: terrain.indexed.palette },
        mode2Results: Object.fromEntries(scene.mode2Results), counts, changedPixels, mismatchedPixels,
        bodyDrawImage: counts.drawImage, orderingVerified: scene.orderingVerified,
        diagnostics: scene.commands.flatMap(command => command.diagnostics) };
      report.textContent = JSON.stringify(evidence, null, 2);
      stage.dataset.result = passed ? "pass" : "fail";
      return evidence;
    };
    const initial = render();
    return { stage, canvas, terrainCanvas: terrain.canvas, initial, render, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}