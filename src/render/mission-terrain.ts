import { assetUrl } from "../asset-url.js";
import { sha256Hex as digest } from "../sha256.js";
import type { CampaignMissionData } from "../game-data.js";
import {
  IndexedWebGLRenderer, IndexedWebGLUnavailableError, resolvePaletteLookup,
  type IndexedImage, type IndexedLayer, type IndexedSource, type PaletteLookup,
} from "./indexed-webgl.js";
import {
  initializePublishedMissionPalette, missionPaletteBank, terrainPaletteLookup, validateMissionPaletteManifest,
} from "./palette-init.js";
import { terrainLayerMirrored } from "./terrain.js";
import { nativeMode3FilterOffsets, validateNativeMode3Surface } from "./mode3-effect.js";
import type { NativeIndexedSurface } from "./mode1-shadow.js";
import type { RemapTable } from "./palette.js";
import type { SceneTerrainCommand } from "./scene-composition.js";

export const MISSION_TERRAIN_WIDTH = 512;
export const MISSION_TERRAIN_HEIGHT = 452;
export const MISSION_TERRAIN_TILE_SIZE = 32;
export const MISSION_TERRAIN_MAX_CACHED_IMAGES = 1024;

export type MissionTerrainInput = Pick<CampaignMissionData,
  "scenario" | "map" | "tileReferences" | "tileRecordIndices" | "attributes">;
export type MissionTerrainFog = "overlay" | "palette";

export interface MissionTerrainFrame {
  readonly cameraX: number;
  readonly cameraY: number;
  readonly visible: Uint8Array;
  readonly explored?: Uint8Array;
  readonly phase?: 0 | 1;
  readonly blend?: number;
  readonly fog?: MissionTerrainFog;
}

export interface MissionTerrainDraw {
  readonly cellX: number;
  readonly worldY: number;
  readonly sourceY: number;
  readonly sourceKey: number;
  readonly recordIndex: number;
  readonly attributes: number;
  readonly layer: 0 | 1;
  readonly coverage: "opaque" | "source-zero";
  readonly mirrorX: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lookup: PaletteLookup;
  readonly row: number;
}

function initialBlend(mission: MissionTerrainInput): number {
  const phase = mission.scenario.rawHeader[1];
  if (phase !== "0" && phase !== "1") throw new RangeError("Expected native SCN phase 0 or 1");
  return Number(phase) * 256;
}

function frameBlend(frame: MissionTerrainFrame, initial: number): number {
  if (frame.phase !== undefined && frame.blend !== undefined) {
    throw new RangeError("Supply phase or blend, not both");
  }
  if (frame.phase !== undefined && frame.phase !== 0 && frame.phase !== 1) {
    throw new RangeError("Native phase must be 0 or 1");
  }
  const blend = frame.blend ?? (frame.phase === undefined ? initial : frame.phase * 256);
  terrainPaletteLookup(blend, 16);
  return blend;
}

export function planMissionTerrainFrame(
  mission: MissionTerrainInput, frame: MissionTerrainFrame, initializedBlend = initialBlend(mission),
): MissionTerrainDraw[] {
  const { width, height } = mission.map;
  const count = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      mission.tileReferences.length !== count * 2 || mission.tileRecordIndices.length !== count * 2 ||
      mission.attributes.length !== count || frame.visible.length !== count ||
      (frame.explored !== undefined && frame.explored.length !== count)) {
    throw new RangeError("Mission terrain dimensions or layer lengths do not match");
  }
  if (!Number.isFinite(frame.cameraX) || !Number.isFinite(frame.cameraY)) {
    throw new RangeError("Mission terrain camera must be finite");
  }
  const fog = frame.fog ?? "overlay";
  if (fog !== "overlay" && fog !== "palette") throw new RangeError("Unknown terrain fog owner");
  const blend = frameBlend(frame, initializedBlend);
  const originX = Math.round(MISSION_TERRAIN_WIDTH / 2 - frame.cameraX * MISSION_TERRAIN_TILE_SIZE);
  const originY = Math.round(MISSION_TERRAIN_HEIGHT / 2 + frame.cameraY * MISSION_TERRAIN_TILE_SIZE);
  const firstX = Math.max(0, Math.floor(-originX / MISSION_TERRAIN_TILE_SIZE));
  const lastX = Math.min(width - 1, Math.ceil((MISSION_TERRAIN_WIDTH - originX) / MISSION_TERRAIN_TILE_SIZE) - 1);
  const firstY = Math.max(0, Math.floor((originY - MISSION_TERRAIN_HEIGHT) / MISSION_TERRAIN_TILE_SIZE));
  const lastY = Math.min(height - 1, Math.ceil(originY / MISSION_TERRAIN_TILE_SIZE) - 1);
  const draws: MissionTerrainDraw[] = [];
  for (let worldY = firstY; worldY <= lastY; worldY++) {
    const sourceY = height - 1 - worldY;
    for (let cellX = firstX; cellX <= lastX; cellX++) {
      const sourceCell = sourceY * width + cellX;
      const worldCell = worldY * width + cellX;
      const brightness = fog === "overlay" || frame.visible[worldCell] ? 16 : frame.explored?.[worldCell] ? 10 : 0;
      const lookup = terrainPaletteLookup(blend, brightness);
      const attributes = mission.attributes[sourceCell];
      for (const layer of [0, 1] as const) {
        const offset = sourceCell * 2 + layer;
        const sourceKey = mission.tileReferences[offset];
        if (layer === 1 && mission.tileRecordIndices[offset] === 0) continue;
        draws.push({
          cellX, worldY, sourceY, sourceKey, recordIndex: mission.tileRecordIndices[offset], attributes, layer,
          coverage: layer === 0 ? "opaque" : "source-zero",
          mirrorX: terrainLayerMirrored(attributes, layer),
          x: originX + cellX * MISSION_TERRAIN_TILE_SIZE,
          y: originY - (worldY + 1) * MISSION_TERRAIN_TILE_SIZE,
          width: MISSION_TERRAIN_TILE_SIZE, height: MISSION_TERRAIN_TILE_SIZE,
          lookup, row: resolvePaletteLookup(lookup).row,
        });
      }
    }
  }
  return draws;
}

interface AssetDigest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface TextureDescriptor extends AssetDigest {
  readonly width: number;
  readonly height: number;
  readonly format: "R8UI" | "RGB8UI";
}

interface IndexedManifest {
  readonly schemaVersion: number;
  readonly verifiedInitialPalettes: readonly string[];
  readonly terrain: readonly { readonly name: string; readonly metadata: string }[];
  readonly palettes: readonly { readonly name: string; readonly metadata: string }[];
  readonly outputs: readonly AssetDigest[];
}

export interface MissionTerrainTile {
  readonly recordIndex: number;
  readonly key: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MissionIndexedTerrain {
  readonly schemaVersion: number;
  readonly palette: string;
  readonly atlas: { readonly width: number; readonly height: number };
  readonly indices: TextureDescriptor;
  readonly tiles: readonly MissionTerrainTile[];
  readonly keySpace: number;
  readonly keyToRecord: readonly number[];
  readonly sourceForegroundCoverage?: readonly Uint32Array[];
}

export function withMissionTerrainCoverage(terrain: MissionIndexedTerrain, indices: Uint8Array): MissionIndexedTerrain {
  const foregroundCoverage = terrain.tiles.map((tile, recordIndex) => {
    if (tile.recordIndex !== recordIndex) throw new RangeError("Indexed terrain records must be in source order");
    const source = cropMissionTerrainTile(indices, terrain.atlas.width, terrain.atlas.height, tile, 1);
    return Uint32Array.from({ length: 32 }, (_, row) => {
      let coverage = 0;
      for (let column = 0; column < 32; column++) {
        if (source.indices[row * 32 + column] !== 0) coverage |= 1 << (31 - column);
      }
      return coverage >>> 0;
    });
  });
  return { ...terrain, sourceForegroundCoverage: foregroundCoverage };
}

interface IndexedPalette {
  readonly schemaVersion: number;
  readonly name: string;
  readonly verifiedInitialUse: boolean;
  readonly display: TextureDescriptor;
  readonly remap: TextureDescriptor;
}

export function initializeMissionTerrainPalette(
  mission: MissionTerrainInput, display: Uint8Array, remap: Uint8Array,
): ReturnType<typeof initializePublishedMissionPalette> {
  return initializePublishedMissionPalette(mission.scenario, display, remap);
}

export function cropMissionTerrainTile(
  indices: Uint8Array, atlasWidth: number, atlasHeight: number, tile: MissionTerrainTile, layer: 0 | 1,
): IndexedSource {
  if (!Number.isSafeInteger(atlasWidth) || !Number.isSafeInteger(atlasHeight) || atlasWidth < 1 || atlasHeight < 1 ||
      indices.length !== atlasWidth * atlasHeight || tile.width !== 32 || tile.height !== 32 ||
      !Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y) || tile.x < 0 || tile.y < 0 ||
      tile.x + tile.width > atlasWidth || tile.y + tile.height > atlasHeight || (layer !== 0 && layer !== 1)) {
    throw new RangeError("Invalid indexed terrain tile rectangle or atlas");
  }
  const cropped = new Uint8Array(tile.width * tile.height);
  for (let row = 0; row < tile.height; row++) {
    const start = (tile.y + row) * atlasWidth + tile.x;
    cropped.set(indices.subarray(start, start + tile.width), row * tile.width);
  }
  return { width: tile.width, height: tile.height, indices: cropped,
    coverage: { mode: layer === 0 ? "opaque" : "source-zero" } };
}

export class MissionTerrainTileCache {
  readonly #renderer: Pick<IndexedWebGLRenderer, "upload" | "releaseImage">;
  readonly #terrain: MissionIndexedTerrain;
  #indices: Uint8Array;
  readonly #entries = new Map<number, IndexedImage>();
  readonly #capacity: number;
  #disposed = false;
  #uploads = 0;
  #hits = 0;
  #evictions = 0;

  constructor(
    renderer: Pick<IndexedWebGLRenderer, "upload" | "releaseImage">,
    terrain: MissionIndexedTerrain, indices: Uint8Array, capacity = MISSION_TERRAIN_MAX_CACHED_IMAGES,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MISSION_TERRAIN_MAX_CACHED_IMAGES) {
      throw new RangeError("Terrain image cache capacity must be in 1..1024");
    }
    this.#renderer = renderer;
    this.#terrain = terrain;
    this.#indices = indices;
    this.#capacity = capacity;
  }

  get stats() {
    return { cachedImages: this.#entries.size, capacity: this.#capacity, uploads: this.#uploads,
      cacheHits: this.#hits, evictions: this.#evictions, retainedIndexBytes: this.#indices.byteLength };
  }

  layers(plan: readonly MissionTerrainDraw[]): IndexedLayer[] {
    if (this.#disposed) throw new IndexedWebGLUnavailableError("Terrain cache disposed");
    const required = new Set(plan.map(({ recordIndex, layer }) => recordIndex * 2 + layer));
    if (required.size > this.#capacity) throw new RangeError("Terrain frame exceeds configured image cache capacity");
    const missing = [...required].filter((key) => !this.#entries.has(key)).length;
    for (const [key, image] of this.#entries) {
      if (this.#entries.size + missing <= this.#capacity) break;
      if (required.has(key)) continue;
      this.#renderer.releaseImage(image);
      this.#entries.delete(key);
      this.#evictions++;
    }
    return plan.map((draw) => {
      const key = draw.recordIndex * 2 + draw.layer;
      let image = this.#entries.get(key);
      if (image) {
        this.#entries.delete(key);
        this.#hits++;
      } else {
        const tile = this.#terrain.tiles[draw.recordIndex];
        if (!tile || tile.recordIndex !== draw.recordIndex) throw new RangeError("Unknown indexed terrain record");
        image = this.#renderer.upload(cropMissionTerrainTile(
          this.#indices, this.#terrain.atlas.width, this.#terrain.atlas.height, tile, draw.layer,
        ));
        this.#uploads++;
      }
      this.#entries.set(key, image);
      return { image, x: draw.x, y: draw.y, width: draw.width, height: draw.height,
        mirrorX: draw.mirrorX, lookup: draw.lookup };
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const image of this.#entries.values()) this.#renderer.releaseImage(image);
    this.#entries.clear();
    this.#indices = new Uint8Array(0);
    this.#disposed = true;
  }
}

export interface MissionTerrainOptions {
  readonly indexedRoot?: string;
  readonly maxCachedImages?: number;
}

export interface MissionMode3Terrain {
  readonly mission: MissionTerrainInput;
  readonly indexed: MissionIndexedTerrain;
  renderIllumination(surface: NativeIndexedSurface): {
    readonly terrainIndices: Uint8Array;
    readonly indices: Uint8Array;
    readonly rgba: Uint8ClampedArray;
  };
}

export function createMissionMode3Terrain(mission: MissionTerrainInput, indexed: MissionIndexedTerrain,
  atlas: Uint8Array, palette: Uint8Array, remap: RemapTable): MissionMode3Terrain {
  if (atlas.length !== indexed.atlas.width * indexed.atlas.height || palette.length !== 768) {
    throw new RangeError("Invalid bounded terrain source planes");
  }
  return { mission, indexed, renderIllumination(surface) {
    validateNativeMode3Surface(surface);
    const { width, height } = mission.map;
    if (mission.tileRecordIndices.length !== width * height * 2 || mission.attributes.length !== width * height
      || surface.x + surface.width > width * 32 || surface.y + surface.height > height * 32) {
      throw new RangeError("Bounded illumination outside source MAP");
    }
    const terrainIndices = new Uint8Array(surface.indices.length);
    const cells: SceneTerrainCommand[] = [];
    for (let top = 0; top < surface.height; top += 32) for (let left = 0; left < surface.width; left += 32) {
      const column = (surface.x + left) / 32, row = (surface.y + top) / 32;
      const cell = row * width + column, attributes = mission.attributes[cell];
      const backgroundIndex = mission.tileRecordIndices[cell * 2], foregroundIndex = mission.tileRecordIndices[cell * 2 + 1];
      cells.push({ kind: "terrain", column, row, backgroundIndex, foregroundIndex, attributes });
      const background = cropMissionTerrainTile(atlas, indexed.atlas.width, indexed.atlas.height, indexed.tiles[backgroundIndex], 0);
      const foreground = foregroundIndex ? cropMissionTerrainTile(atlas, indexed.atlas.width, indexed.atlas.height, indexed.tiles[foregroundIndex], 1) : undefined;
      for (let localY = 0; localY < Math.min(32, surface.height - top); localY++) for (let localX = 0; localX < 32; localX++) {
        const foregroundPixel = foreground?.indices[localY * 32 + (terrainLayerMirrored(attributes, 1) ? 31 - localX : localX)] ?? 0;
        terrainIndices[(top + localY) * surface.width + left + localX] = foregroundPixel ||
          background.indices[localY * 32 + (terrainLayerMirrored(attributes, 0) ? 31 - localX : localX)];
      }
    }
    const offsets = nativeMode3FilterOffsets(surface, cells);
    const indices = new Uint8Array(terrainIndices.length), rgba = new Uint8ClampedArray(indices.length * 4);
    for (let offset = 0; offset < indices.length; offset++) {
      const index = remap.lookup(0, surface.indices[offsets[offset]], terrainIndices[offset]);
      indices[offset] = index;
      rgba[offset * 4] = palette[index * 3];
      rgba[offset * 4 + 1] = palette[index * 3 + 1];
      rgba[offset * 4 + 2] = palette[index * 3 + 2];
      rgba[offset * 4 + 3] = 255;
    }
    return { terrainIndices, indices, rgba };
  } };
}

export interface MissionTerrainStats {
  readonly frames: number;
  readonly draws: number;
  readonly cachedImages: number;
  readonly capacity: number;
  readonly uploads: number;
  readonly cacheHits: number;
  readonly evictions: number;
  readonly retainedIndexBytes: number;
  readonly liveTextures: number;
  readonly textureBytes: number;
  readonly loadedBytes: number;
}

export interface MissionTerrainStatus {
  readonly state: "ready" | "unavailable" | "disposed";
  readonly palette: string;
  readonly initialBlend: number;
  readonly blend: number;
  readonly teamSelectors: readonly number[];
  readonly fog: MissionTerrainFog;
  readonly spatialInterpolation: "pending";
  readonly error: string | null;
}

export interface MissionTerrain {
  readonly canvas: HTMLCanvasElement;
  readonly indexed: MissionIndexedTerrain;
  readonly mode3: MissionMode3Terrain;
  readonly stats: MissionTerrainStats;
  readonly status: MissionTerrainStatus;
  render(frame: MissionTerrainFrame): HTMLCanvasElement;
  /** Renders like render() but returns immediately; collectReadback() yields the pixels on a later frame. */
  renderAsync(frame: MissionTerrainFrame): void;
  collectReadback(): ImageData | null;
  cancelReadback(): void;
  dispose(): void;
}

function validateTexture(descriptor: TextureDescriptor, width: number, height: number, format: "R8UI" | "RGB8UI"): void {
  if (descriptor.width !== width || descriptor.height !== height || descriptor.format !== format ||
      descriptor.bytes !== width * height * (format === "RGB8UI" ? 3 : 1)) {
    throw new RangeError(`Invalid indexed texture descriptor: ${descriptor.path}`);
  }
}

export async function createMissionTerrain(
  mission: MissionTerrainInput, options: MissionTerrainOptions = {},
): Promise<MissionTerrain> {
  if (typeof document === "undefined") throw new IndexedWebGLUnavailableError("Mission terrain requires a browser WebGL2 canvas");
  const bank = missionPaletteBank(mission.scenario.terrainBank);
  if (mission.map.terrainBank.toLowerCase() !== mission.scenario.terrainBank.toLowerCase()) {
    throw new RangeError("Mission terrain bank must match the scenario palette");
  }
  const root = (options.indexedRoot ?? assetUrl("/assets/generated/indexed")).replace(/\/$/, "");
  let loadedBytes = 0;
  async function fetchBytes(path: string): Promise<Uint8Array> {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      throw new RangeError("Invalid indexed-root-relative asset path");
    }
    const response = await fetch(`${root}/${path}`);
    if (!response.ok) throw new Error(`Indexed terrain asset ${response.status}: ${path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    loadedBytes += bytes.byteLength;
    return bytes;
  }
  const [manifestBytes, checksumBytes] = await Promise.all([fetchBytes("index.json"), fetchBytes("index.sha256")]);
  const checksum = new TextDecoder().decode(checksumBytes).trim();
  if (checksum !== `${await digest(manifestBytes)}  index.json`) throw new Error("Indexed manifest checksum mismatch");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as IndexedManifest;
  validateMissionPaletteManifest(mission.scenario.terrainBank, manifest);
  async function loadAsset(path: string): Promise<Uint8Array> {
    const entry = manifest.outputs.find((output) => output.path === path);
    if (!entry) throw new Error(`Asset absent from indexed manifest: ${path}`);
    const bytes = await fetchBytes(path);
    if (bytes.byteLength !== entry.bytes || await digest(bytes) !== entry.sha256) {
      throw new Error(`Indexed asset size/hash mismatch: ${path}`);
    }
    return bytes;
  }
  async function loadJson<T>(path: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await loadAsset(path))) as T;
  }
  async function loadTexture(descriptor: TextureDescriptor): Promise<Uint8Array> {
    const entry = manifest.outputs.find((output) => output.path === descriptor.path);
    if (!entry || entry.bytes !== descriptor.bytes || entry.sha256 !== descriptor.sha256) {
      throw new Error(`Texture descriptor differs from indexed manifest: ${descriptor.path}`);
    }
    return loadAsset(descriptor.path);
  }
  const terrainEntry = manifest.terrain.find((entry) => entry.name === bank);
  const paletteEntry = manifest.palettes.find((entry) => entry.name === bank);
  if (!terrainEntry || !paletteEntry) throw new Error(`Missing indexed terrain/palette: ${bank}`);
  const [terrain, palette] = await Promise.all([
    loadJson<MissionIndexedTerrain>(terrainEntry.metadata), loadJson<IndexedPalette>(paletteEntry.metadata),
  ]);
  if (terrain.schemaVersion !== 1 || palette.schemaVersion !== 1 || terrain.palette !== bank ||
      palette.name !== bank || palette.verifiedInitialUse !== true) throw new RangeError("Indexed terrain/palette schema mismatch");
  validateTexture(terrain.indices, terrain.atlas.width, terrain.atlas.height, "R8UI");
  validateTexture(palette.display, 256, 1, "RGB8UI");
  validateTexture(palette.remap, 256, 768, "R8UI");
  if (terrain.keyToRecord.length !== terrain.keySpace || mission.tileReferences.length !== mission.tileRecordIndices.length) {
    throw new RangeError("Indexed terrain key map length mismatch");
  }
  for (let offset = 0; offset < mission.tileReferences.length; offset++) {
    const key = mission.tileReferences[offset];
    const expected = terrain.keyToRecord[key] ?? 0;
    const record = mission.tileRecordIndices[offset];
    if (record !== expected || !terrain.tiles[record] || terrain.tiles[record].recordIndex !== record) {
      throw new RangeError(`Mission record differs from indexed key map at ${offset}`);
    }
  }
  const [indices, display, remap] = await Promise.all([
    loadTexture(terrain.indices), loadTexture(palette.display), loadTexture(palette.remap),
  ]);
  const indexed = withMissionTerrainCoverage(terrain, indices);
  const initialized = initializeMissionTerrainPalette(mission, display, remap);
  const canvas = document.createElement("canvas");
  canvas.width = MISSION_TERRAIN_WIDTH;
  canvas.height = MISSION_TERRAIN_HEIGHT;
  const renderer = new IndexedWebGLRenderer(canvas, initialized);
  let cache: MissionTerrainTileCache;
  try {
    cache = new MissionTerrainTileCache(renderer, terrain, indices, options.maxCachedImages);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  let disposed = false;
  let frames = 0;
  let draws = 0;
  let blend = initialized.dayNightBlend;
  let fog: MissionTerrainFog = "overlay";
  let failure: string | null = null;
  const teamSelectors = Object.freeze(Array.from(initialized.teamSelectors));
  function render(frame: MissionTerrainFrame): HTMLCanvasElement {
    if (disposed || !renderer.ready || failure !== null) {
      throw new IndexedWebGLUnavailableError(failure ?? "Terrain disposed or WebGL context lost");
    }
    const plan = planMissionTerrainFrame(mission, frame, initialized.dayNightBlend);
    const nextBlend = frameBlend(frame, initialized.dayNightBlend);
    try {
      renderer.render(cache.layers(plan));
    } catch (error) {
      if (error instanceof IndexedWebGLUnavailableError) failure = error.message;
      throw error;
    }
    frames++;
    draws = plan.length;
    blend = nextBlend;
    fog = frame.fog ?? "overlay";
    return canvas;
  }
  return {
    canvas,
    indexed,
    mode3: createMissionMode3Terrain(mission, indexed, indices, initialized.palette, initialized.remap),
    get status(): MissionTerrainStatus {
      return {
        state: disposed ? "disposed" : renderer.ready && failure === null ? "ready" : "unavailable",
        palette: bank, initialBlend: initialized.dayNightBlend, blend, teamSelectors, fog,
        spatialInterpolation: "pending",
        error: failure ?? (!disposed && !renderer.ready ? "WebGL context lost; dispose and recreate terrain" : null),
      };
    },
    get stats(): MissionTerrainStats {
      const stats = cache.stats;
      const live = renderer.ready;
      return { ...stats, frames, draws, loadedBytes,
        liveTextures: live ? stats.cachedImages * 2 + 2 : 0,
        textureBytes: live ? stats.cachedImages * 32 * 32 * 2 + 196608 + 768 : 0 };
    },
    render,
    renderAsync(frame): void {
      render(frame);
      renderer.queueReadback();
    },
    collectReadback(): ImageData | null {
      return disposed ? null : renderer.collectReadback();
    },
    cancelReadback(): void {
      if (!disposed) renderer.cancelReadback();
    },
    dispose(): void {
      if (disposed) return;
      cache.dispose();
      renderer.dispose();
      disposed = true;
    },
  };
}