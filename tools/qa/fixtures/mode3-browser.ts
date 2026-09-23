import { loadCampaignMission, type CampaignMissionData } from "../../../src/game-data";
import { MissionView, type MissionViewMode3Frame } from "../../../src/mission-view";
import type { FinAnimationData, FinAtlasFrame } from "../../../src/render/fin-animation";
import { composeFinSample } from "../../../src/render/fin-composition";
import type { MissionSceneEntity } from "../../../src/render/mission-scene-frame";
import { createMissionTerrain } from "../../../src/render/mission-terrain";
import { createMissionSpritePalettes } from "../../../src/render/mission-sprites";
import { registerNativePaletteImage } from "../../../src/render/mode1-canvas";

export const mode3BrowserSource = Object.freeze({ animation: "VENT", timelineIndex: 19, rawSlot: 0,
  camera: Object.freeze({ x: 480, y: 192, width: 320, height: 256 }), queuedX: 541, baseline: 304 });
export const mode3BrowserLabel = "QA only: unchanged VENT timeline 19, all four children; controlled native-probe placement, not original world queue or full-scene parity";
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

export async function loadMode3BrowserSource() {
  const bytes = async (path: string) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error("Invalid indexed source path");
    }
    const response = await fetch(`/assets/generated/indexed/${path}`);
    if (!response.ok) throw new Error(`Mode3 source fetch ${response.status}: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const [manifestBytes, checksum] = await Promise.all([bytes("index.json"), bytes("index.sha256")]);
  const manifestSha256 = await sha256(manifestBytes);
  if (new TextDecoder().decode(checksum).trim() !== `${manifestSha256}  index.json`) throw new Error("Indexed manifest checksum mismatch");
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
  const animation = JSON.parse(new TextDecoder().decode(await asset("animations/VENT.json"))) as FinAnimationData & { schemaVersion: number; source: AssetDigest };
  if (animation.schemaVersion !== 1) throw new Error("Source animation schema mismatch");
  const sprites = new Map<string, { metadata: SpriteMetadata; indices: Uint8Array; coverage: Uint8Array }>();
  for (const name of ["VENT2", "PUFF", "GLIT", "SMSP"]) {
    const metadata = JSON.parse(new TextDecoder().decode(await asset(`sprites/SPRITES/${name}.json`))) as SpriteMetadata;
    if (metadata.schemaVersion !== 1) throw new Error("Source sprite schema mismatch");
    const [indices, coverage] = await Promise.all([asset(metadata.indices.path, metadata.indices), asset(metadata.coverage.path, metadata.coverage)]);
    if (indices.length !== metadata.atlas.width * metadata.atlas.height || coverage.length !== indices.length) {
      throw new Error("Source atlas dimensions mismatch");
    }
    sprites.set(name, { metadata, indices, coverage });
  }
  return { animation, sprites, manifestSha256, verified };
}

export function prepareMode3BrowserScene(mission: Pick<CampaignMissionData, "map">,
  source: Awaited<ReturnType<typeof loadMode3BrowserSource>>) {
  const children = source.animation.timeline[19]?.children;
  const expected = [["puff", 0, -39, 6, 0, 16, 5, 0], ["vent2", 0, -40, 12, 1, 16, 0, 0],
    ["glit", 6, -54, 11, 1, 16, 5, 0], ["smsp", 1, -60, 14, 1, 16, 3, 0]];
  if (children?.length !== 4 || children.some((child, index) => JSON.stringify([
    child.sprite, child.frame, child.x, child.y, child.layer, child.flags, child.valueA, child.valueB,
  ]) !== JSON.stringify(expected[index]))) throw new Error("Expected unchanged VENT timeline 19 children");
  const camera = mode3BrowserSource.camera;
  if (camera.x + camera.width > mission.map.width * 32 || camera.y + camera.height > mission.map.height * 32) {
    throw new Error("Controlled viewport exceeds source mission");
  }
  const sample = Object.freeze({ children, timelineIndex: 19, finished: false });
  const parts = composeFinSample(sample, (name, index) => source.sprites.get(name.toUpperCase())?.metadata.frames.find(frame => frame.index === index));
  const origin = { x: mode3BrowserSource.queuedX - children[3].x, y: mode3BrowserSource.baseline - children[3].y };
  const frames = parts.map(part => {
    const sourceAtlas = source.sprites.get(part.child.sprite.toUpperCase())!;
    const frame = part.frame;
    if (!frame || frame.empty) throw new Error("Complete source frames required");
    const left = origin.x + part.child.x + frame.anchorX, bottom = origin.y + part.child.y;
    if (left < camera.x || left + frame.width >= camera.x + camera.width || bottom - frame.height < camera.y
      || bottom >= camera.y + camera.height - 1) throw new Error("Source child exceeds native viewport bounds");
    const indices = new Uint8Array(frame.width * frame.height), coverage = new Uint8Array(indices.length);
    for (let row = 0; row < frame.height; row++) {
      const start = (frame.y + row) * sourceAtlas.metadata.atlas.width + frame.x;
      indices.set(sourceAtlas.indices.subarray(start, start + frame.width), row * frame.width);
      coverage.set(sourceAtlas.coverage.subarray(start, start + frame.width), row * frame.width);
    }
    return { child: part.child, width: frame.width, height: frame.height, indices, coverage };
  });
  const entity: MissionSceneEntity = Object.freeze({ rawSlot: mode3BrowserSource.rawSlot, sample, parts,
    xSubcells: origin.x * 32, ySubcells: (mission.map.height * 32 - 1 - origin.y) * 32, heightSubcells: 0,
    fallbackOrigin: { x: origin.x - camera.x, y: origin.y - camera.y } });
  const queue = children.map((_, sourceChildIndex) => ({ rawSlot: entity.rawSlot, sourceChildIndex }));
  return { camera, entity, queue, frames };
}

export function renderMode3BrowserPass(view: MissionView, input: MissionViewMode3Frame,
  imageNames: ReadonlyMap<CanvasImageSource, string>) {
  const context = view.canvas.getContext("2d");
  if (!context) throw new Error("Mode3 QA requires actual Canvas2D");
  const counts = { snapshots: 0, captures: 0, reads: 0, readPixels: 0, preTerrainReads: 0, writes: 0,
    drawImage: 0, sourceBodyCalls: 0, mode3SpriteCalls: 0 };
  const events: string[] = [];
  const originals = { getImageData: context.getImageData, putImageData: context.putImageData, drawImage: context.drawImage };
  const descriptors = Object.fromEntries(Object.keys(originals).map(name => [name, Object.getOwnPropertyDescriptor(context, name)]));
  const simulation = view.simulation;
  const snapshotDescriptor = Object.getOwnPropertyDescriptor(simulation, "snapshot");
  const snapshotGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(simulation), "snapshot")?.get;
  if (!snapshotGetter || snapshotDescriptor) throw new Error("Unmodified simulation snapshot getter required");
  try {
    Object.defineProperty(simulation, "snapshot", { configurable: true, get() { counts.snapshots++; return snapshotGetter.call(simulation); } });
    for (const name of ["getImageData", "putImageData", "drawImage"] as const) {
      Object.defineProperty(context, name, { configurable: true, writable: true, value: (...args: unknown[]) => {
        if (name === "getImageData") {
          counts.reads++; counts.readPixels += Number(args[2]) * Number(args[3]);
          if (!counts.writes) counts.preTerrainReads++;
          events.push("adapter-readback");
        } else if (name === "putImageData") {
          events.push(counts.writes++ ? "effect-publication" : "terrain-publication");
        } else {
          counts.drawImage++;
          const sprite = imageNames.get(args[0] as CanvasImageSource) ?? "unknown";
          if (sprite === "VENT2") counts.sourceBodyCalls++;
          if (sprite === "SMSP") counts.mode3SpriteCalls++;
          events.push(`drawImage:${sprite}`);
        }
        return Reflect.apply(originals[name], context, args);
      } });
    }
    const native = view.renderBoundedMode3({ ...input, capture: snapshot => { counts.captures++; return input.capture(snapshot); } });
    return { native, counts, events };
  } finally {
    Reflect.deleteProperty(simulation, "snapshot");
    for (const name of Object.keys(originals)) {
      const descriptor = descriptors[name];
      if (descriptor) Object.defineProperty(context, name, descriptor);
      else Reflect.deleteProperty(context, name);
    }
  }
}

export function compareMode3BrowserPixels(baseline: Uint8ClampedArray, final: Uint8ClampedArray,
  baselineTerrain: Uint8ClampedArray, enabledTerrain: Uint8ClampedArray) {
  if (baseline.length !== final.length || final.length !== baselineTerrain.length || final.length !== enabledTerrain.length
    || final.length % 4) throw new Error("Comparable full RGBA planes required");
  let changedPixels = 0, nativePlaneChangedPixels = 0, visibleNativePositivePixels = 0;
  for (let offset = 0; offset < final.length; offset += 4) {
    const changed = final.subarray(offset, offset + 4).some((value, channel) => value !== baseline[offset + channel]);
    const nativeChanged = enabledTerrain.subarray(offset, offset + 3).some((value, channel) => value !== baselineTerrain[offset + channel]);
    if (changed) changedPixels++;
    if (nativeChanged) nativePlaneChangedPixels++;
    if (changed && nativeChanged && final.subarray(offset, offset + 4).every((value, channel) => value === enabledTerrain[offset + channel])
      && baseline.subarray(offset, offset + 4).every((value, channel) => value === baselineTerrain[offset + channel])) visibleNativePositivePixels++;
  }
  return { changedPixels, nativePlaneChangedPixels, visibleNativePositivePixels };
}

export async function createMode3BrowserFixture(mission?: CampaignMissionData, options: { parent?: HTMLElement } = {}) {
  mission ??= await loadCampaignMission("human");
  if (mission.faction !== "human" || mission.scenario.id.toUpperCase() !== "HUMAN01"
    || mission.scenario.terrainBank.toUpperCase() !== "DESERT.BTS") throw new Error("Original HUMAN01 DESERT mission required");
  const source = await loadMode3BrowserSource();
  const prepared = prepareMode3BrowserScene(mission, source);
  const stage = document.createElement("section"), canvas = document.createElement("canvas");
  stage.dataset.qa = "mode3-browser";
  stage.setAttribute("aria-label", "Bounded mode3 controlled Canvas QA");
  stage.style.cssText = "position:fixed;inset:0;z-index:99999;display:block;overflow:auto;min-width:0;background:#161616;color:#fff;padding:12px;box-sizing:border-box;font:14px/1.4 monospace";
  const label = document.createElement("p"), report = document.createElement("pre");
  label.style.cssText = "display:block;max-width:100%;white-space:normal;overflow-wrap:anywhere";
  label.textContent = `${mode3BrowserLabel}. Original HUMAN01 / DESERT indexed terrain. Fixed 320x256 (81920 pixels), camera (480,192); initial illumination 128, enable=true. Native probe SMSP baseline (541,304).`;
  report.style.cssText = "display:block;min-width:0;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere";
  canvas.width = prepared.camera.width; canvas.height = prepared.camera.height;
  canvas.style.cssText = "display:block;width:320px;max-width:100%;height:auto;image-rendering:pixelated";
  canvas.setAttribute("aria-label", "Actual MissionView bounded mode3 terrain and all four source VENT19 children");
  stage.append(label, canvas, report);
  let terrain: Awaited<ReturnType<typeof createMissionTerrain>> | undefined;
  let palettes: Awaited<ReturnType<typeof createMissionSpritePalettes>> | undefined;
  let view: MissionView | undefined;
  let disposed = false;
  const images = new Map<string, HTMLImageElement>();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    view?.dispose(); palettes?.dispose(); terrain?.dispose();
    if (terrain) terrain.canvas.width = terrain.canvas.height = 0;
    images.clear(); canvas.width = canvas.height = 0; stage.remove();
  };
  try {
    terrain = await createMissionTerrain(mission);
    palettes = await createMissionSpritePalettes(mission, [...source.sprites.keys()]);
    const imageNames = new Map<CanvasImageSource, string>();
    for (const [name, sprite] of source.sprites) {
      const atlas = palettes.indexedImage(name, 0);
      if (!atlas || atlas.width !== sprite.metadata.atlas.width || atlas.height !== sprite.metadata.atlas.height
        || await sha256(atlas.indices) !== sprite.metadata.indices.sha256 || await sha256(atlas.coverage) !== sprite.metadata.coverage.sha256) {
        throw new Error(`Registered source atlas differs from verified bytes: ${name}`);
      }
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error(`Source PNG atlas failed to load: ${name}`)), { once: true });
        image.src = `/assets/generated/sprites/SPRITES/${name}.png`;
      });
      if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height) throw new Error(`Source PNG atlas dimensions differ: ${name}`);
      registerNativePaletteImage(image, atlas);
      images.set(name, image); imageNames.set(image, name);
    }
    const body = palettes.image("VENT2", 0);
    if (!body) throw new Error("Source VENT2 body canvas required");
    imageNames.set(body, "VENT2");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Mode3 QA requires actual Canvas2D");
    context.imageSmoothingEnabled = false;
    view = new MissionView(canvas, stage, { onStats() {}, onUnitsChanged() {} }, mission);
    const fixtureView = view, owner = terrain.mode3;
    const initialIndices = new Uint8Array(canvas.width * canvas.height).fill(128);
    const input: MissionViewMode3Frame = { terrain: owner, surface: { ...prepared.camera, indices: initialIndices }, enabled: true,
      queue: prepared.queue, capture: () => [prepared.entity],
      sprite: command => prepared.frames.find(frame => frame.child === command.part.child),
      image: (name, part) => part.child.valueA === 0 ? body : images.get(name.toUpperCase()) };
    const render = (mode3enabled = true) => {
      if (disposed) throw new Error("Mode3 browser fixture disposed");
      if (typeof mode3enabled !== "boolean") throw new Error("Explicit boolean mode3 enable required");
      const before = JSON.stringify(fixtureView.checkpoint()), simulationBefore = JSON.stringify(fixtureView.simulation.checkpoint());
      const baseline = renderMode3BrowserPass(fixtureView, { ...input, enabled: false }, imageNames);
      if (!baseline.native.exact) throw new Error(baseline.native.diagnostic);
      const baselineRgba = context.getImageData(0, 0, canvas.width, canvas.height).data.slice();
      const current = renderMode3BrowserPass(fixtureView, { ...input, enabled: mode3enabled }, imageNames);
      if (!current.native.exact) throw new Error(current.native.diagnostic);
      const finalRgba = context.getImageData(0, 0, canvas.width, canvas.height).data.slice();
      const pixels = compareMode3BrowserPixels(baselineRgba, finalRgba, baseline.native.output.rgba, current.native.output.rgba);
      const checkpointUnchanged = before === JSON.stringify(fixtureView.checkpoint());
      const simulationUnchanged = simulationBefore === JSON.stringify(fixtureView.simulation.checkpoint());
      const initialPlaneUnchanged = initialIndices.every(value => value === 128);
      const passEvidence = (pass: typeof current) => {
        if (!pass.native.exact) throw new Error(pass.native.diagnostic);
        const budget = pass.native.frame.effectBudget;
        return { counts: pass.counts, events: pass.events, budget, mode3Suppressed: pass.native.owned.has("0:3") && pass.counts.mode3SpriteCalls === 0,
          mode3Readbacks: pass.counts.preTerrainReads,
          adapterReadbacksCharged: pass.counts.readPixels === budget.readbackPixels,
          mode5Results: Object.fromEntries(pass.native.frame.mode5Results), orderingVerified: pass.native.frame.orderingVerified,
          diagnostics: [...pass.native.frame.diagnostics, ...pass.native.frame.commands.flatMap(command => command.diagnostics)] };
      };
      const disabled = passEvidence(baseline), enabled = passEvidence(current);
      const passed = checkpointUnchanged && simulationUnchanged && initialPlaneUnchanged && [disabled, enabled].every(pass =>
        pass.counts.snapshots === 1 && pass.counts.captures === 1 && pass.counts.sourceBodyCalls > 0 && pass.mode3Suppressed
        && pass.mode3Readbacks === 0 && pass.adapterReadbacksCharged && pass.budget.remainingPixels >= 0
        && pass.budget.mode3AllocatedPixels === 81920 && pass.events[0] === "terrain-publication")
        && (mode3enabled ? pixels.visibleNativePositivePixels > 0 : pixels.changedPixels === 0 && pixels.nativePlaneChangedPixels === 0);
      const evidence = { passed, scope: current.native.scope, label: mode3BrowserLabel, mode3enabled, initialIllumination: 128,
        camera: prepared.camera, source: { ...mode3BrowserSource, fin: source.animation.source,
          children: prepared.entity.sample.children, sprites: [...source.sprites].map(([name, sprite]) => ({ name, source: sprite.metadata.source })),
          manifestSha256: source.manifestSha256, verified: source.verified },
        missionDiagnostic: fixtureView.missionDiagnostic ?? null, checkpointUnchanged, simulationUnchanged, initialPlaneUnchanged,
        ...pixels, disabled, enabled, qaReadbacks: { calls: 2, pixels: canvas.width * canvas.height * 2, outsideAdapterBudget: true } };
      report.textContent = JSON.stringify(evidence, null, 2);
      stage.dataset.result = passed ? "pass" : "fail";
      stage.dataset.enabled = String(mode3enabled);
      return { ...evidence, native: current.native, baselineNative: baseline.native, baselineRgba, finalRgba };
    };
    (options.parent ?? document.body).append(stage);
    const initial = render(true);
    return { stage, canvas, view: fixtureView, terrain, initial, render, dispose };
  } catch (error) { dispose(); throw error; }
}