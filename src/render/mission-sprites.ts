import { assetUrl } from "../asset-url";
import type { CampaignMissionData } from "../game-data";
import {
  finBodyPaletteLookup, initializePublishedMissionPalette, missionPaletteBank, validateMissionPaletteManifest,
} from "./palette-init";
import { RemapTable } from "./palette";
import { registerNativePaletteImage } from "./mode1-canvas";
import { registerNativeEffectMission } from "./mode5-canvas";

export function remapSpritePixels(indices: Uint8Array, coverage: Uint8Array,
  remap: RemapTable, palette: Uint8Array, selector: number): Uint8ClampedArray {
  if (indices.length !== coverage.length || palette.length !== 768 ||
    !Number.isInteger(selector) || selector < 0 || selector > 7) throw new RangeError("Invalid indexed sprite inputs");
  const result = new Uint8ClampedArray(indices.length * 4);
  for (let index = 0; index < indices.length; index += 1) {
    if (!coverage[index]) continue;
    const color = remap.lookup(2, 128 + selector, indices[index]) * 3;
    result[index * 4] = palette[color];
    result[index * 4 + 1] = palette[color + 1];
    result[index * 4 + 2] = palette[color + 2];
    result[index * 4 + 3] = 255;
  }
  return result;
}

export function adaptedGoldExtractorIndices(indices: Uint8Array, palette: Uint8Array, remap: RemapTable): Uint8Array {
  const luminance = (index: number) => palette[index * 3] * 0.2126
    + palette[index * 3 + 1] * 0.7152 + palette[index * 3 + 2] * 0.0722;
  const goldRamp = Array.from({ length: 6 }, (_, step) => 138 + step);
  const mapping = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (let index = 8; index <= 31; index += 1) {
    const brightness = luminance(index);
    mapping[index] = goldRamp.reduce((closest, candidate) =>
      Math.abs(luminance(remap.lookup(2, 130, candidate)) - brightness)
        < Math.abs(luminance(remap.lookup(2, 130, closest)) - brightness) ? candidate : closest);
  }
  return indices.map((index) => mapping[index]);
}

export async function createMissionSpritePalettes(
  mission: CampaignMissionData & { readonly runtimeProfile?: string }, names: readonly string[],
) {
  const bank = missionPaletteBank(mission.scenario.terrainBank);
  const root = assetUrl("/assets/generated/indexed");
  const bytes = async (path: string) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      throw new RangeError("Invalid indexed-root-relative asset path");
    }
    const response = await fetch(`${root}/${path}`);
    if (!response.ok) throw new Error(`Indexed sprite fetch ${response.status}: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const digest = async (data: Uint8Array) => {
    const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(data).buffer);
    return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
  };
  const [manifestBytes, checksumBytes] = await Promise.all([bytes("index.json"), bytes("index.sha256")]);
  if (new TextDecoder().decode(checksumBytes).trim() !== `${await digest(manifestBytes)}  index.json`) {
    throw new Error("Indexed manifest checksum mismatch");
  }
  interface AssetDigest { path: string; bytes: number; sha256: string }
  interface TextureDescriptor extends AssetDigest { width: number; height: number; format: string }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    schemaVersion: number; verifiedInitialPalettes: string[];
    palettes: { name: string; metadata: string }[]; outputs: AssetDigest[];
  };
  validateMissionPaletteManifest(mission.scenario.terrainBank, manifest);
  const loadAsset = async (path: string) => {
    const entry = manifest.outputs.find((output) => output.path === path);
    if (!entry) throw new Error(`Asset absent from indexed manifest: ${path}`);
    const data = await bytes(path);
    if (data.length !== entry.bytes || await digest(data) !== entry.sha256) {
      throw new Error(`Indexed asset size/hash mismatch: ${path}`);
    }
    return data;
  };
  const entry = manifest.palettes.find((palette) => palette.name === bank);
  if (!entry) throw new RangeError(`Missing indexed palette: ${bank}`);
  const metadata = JSON.parse(new TextDecoder().decode(await loadAsset(entry.metadata))) as {
    schemaVersion: number; name: string; verifiedInitialUse: boolean;
    display: TextureDescriptor; remap: TextureDescriptor;
  };
  if (metadata.schemaVersion !== 1 || metadata.name !== bank || metadata.verifiedInitialUse !== true) {
    throw new RangeError("Indexed sprite palette schema mismatch");
  }
  const texture = async (descriptor: TextureDescriptor, height: number, format: string) => {
    const output = manifest.outputs.find((entry) => entry.path === descriptor.path);
    if (descriptor.width !== 256 || descriptor.height !== height || descriptor.format !== format ||
        descriptor.bytes !== 256 * height * (format === "RGB8UI" ? 3 : 1) ||
        !output || output.bytes !== descriptor.bytes || output.sha256 !== descriptor.sha256) {
      throw new RangeError("Indexed sprite palette texture descriptor mismatch");
    }
    return loadAsset(descriptor.path);
  };
  const [display, table] = await Promise.all([
    texture(metadata.display, 1, "RGB8UI"), texture(metadata.remap, 768, "R8UI"),
  ]);
  const { palette, remap, teamSelectors: selectors } = initializePublishedMissionPalette(mission.scenario, display, table);
  const sources = new Map<string, { width: number; height: number; indices: Uint8Array; coverage: Uint8Array }>();
  for (const name of [...new Set(names.map((name) => name.toUpperCase()))]) {
    const response = await fetch(`${root}/sprites/${name === "CURSOR/CURS" ? name : `SPRITES/${name}`}.json`);
    if (!response.ok) throw new Error(`Indexed sprite metadata ${response.status}: ${name}`);
    const metadata = await response.json();
    const [indices, coverage] = await Promise.all([bytes(metadata.indices.path), bytes(metadata.coverage.path)]);
    if (indices.length !== metadata.atlas.width * metadata.atlas.height || coverage.length !== indices.length) {
      throw new RangeError(`Indexed sprite dimensions mismatch: ${name}`);
    }
    sources.set(name, { ...metadata.atlas, indices, coverage });
  }
  const cache = new Map<string, HTMLCanvasElement>();
  const unregisterEffects = registerNativeEffectMission(mission, { sources, palette, remap });
  const budget = 32 * 1024 * 1024;
  let used = 0;
  return {
    indexedImage(name: string, owner: number, override = 8) {
      const source = sources.get(name.toUpperCase());
      if (!source) return undefined;
      const { selector } = finBodyPaletteLookup(owner, override, selectors);
      return { ...source, palette, remap, selector };
    },
    image(name: string, owner: number, override = 8, bodyAppearance?: "gold-extractor"): HTMLCanvasElement | undefined {
      let source = sources.get(name.toUpperCase());
      if (!source) return undefined;
      const goldBody = bodyAppearance === "gold-extractor" && name.toUpperCase() === "EXPL"
        && owner === 0 && mission.runtimeProfile === "browser-adapted";
      const selector = goldBody ? 2 : finBodyPaletteLookup(owner, override, selectors).selector;
      const key = `${name.toUpperCase()}:${selector}:${goldBody ? "gold-extractor" : "native"}`;
      const existing = cache.get(key);
      if (existing) { cache.delete(key); cache.set(key, existing); return existing; }
      if (goldBody) source = { ...source, indices: adaptedGoldExtractorIndices(source.indices, palette, remap) };
      const size = source.width * source.height * 4;
      if (size > budget) throw new RangeError(`Sprite exceeds color-cache budget: ${name}`);
      while (used + size > budget && cache.size > 0) {
        const oldest = cache.keys().next().value!;
        const canvas = cache.get(oldest)!;
        used -= canvas.width * canvas.height * 4;
        canvas.width = canvas.height = 0;
        cache.delete(oldest);
      }
      const canvas = document.createElement("canvas");
      canvas.width = source.width; canvas.height = source.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Sprite remapping needs Canvas2D");
      const data = context.createImageData(source.width, source.height);
      data.data.set(remapSpritePixels(source.indices, source.coverage, remap, palette, selector));
      context.putImageData(data, 0, 0);
      registerNativePaletteImage(canvas, { ...source, palette, remap, selector });
      cache.set(key, canvas); used += size;
      return canvas;
    },
    dispose() {
      unregisterEffects();
      for (const canvas of cache.values()) canvas.width = canvas.height = 0;
      cache.clear(); sources.clear(); used = 0;
    },
  };
}