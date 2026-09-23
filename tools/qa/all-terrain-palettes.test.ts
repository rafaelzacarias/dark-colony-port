import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CampaignMissionData } from "../../src/game-data";
import { createMissionTerrain, initializeMissionTerrainPalette } from "../../src/render/mission-terrain";
import { createMissionSpritePalettes, remapSpritePixels } from "../../src/render/mission-sprites";
import { IndexedWebGLUnavailableError } from "../../src/render/indexed-webgl";
import { initializeMissionPalette, terrainPaletteLookup } from "../../src/render/palette-init";

const source = (file: string) => readFileSync(new URL(`../../raw_cd/DC/${file}`, import.meta.url));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function fixture(bank: string, options: {
  verified?: readonly string[]; initialUse?: boolean; paletteName?: string; corrupt?: boolean;
  omitPalette?: boolean; badDescriptor?: boolean;
} = {}) {
  const mission = {
    scenario: { terrainBank: `${bank.toLowerCase()}.bts`, rawHeader: ["", "1"],
      teams: Array.from({ length: 8 }, (_, index) => ({ index, teamColor: (index + 3) % 8 })) },
    map: { terrainBank: `${bank}.BTS`, width: 1, height: 1 },
    tileReferences: new Uint16Array(2), tileRecordIndices: new Uint16Array(2), attributes: new Uint16Array(1),
  } as unknown as CampaignMissionData;
  const original = initializeMissionPalette(mission.scenario, source(`${bank}.GIF`), source(`${bank}.RMP`));
  const files = new Map<string, Uint8Array>();
  const outputs: { path: string; bytes: number; sha256: string }[] = [];
  const asset = (path: string, bytes: Uint8Array) => {
    files.set(path, bytes);
    const entry = { path, bytes: bytes.length, sha256: hash(bytes) };
    outputs.push(entry);
    return entry;
  };
  const json = (path: string, value: unknown) => asset(path, Buffer.from(JSON.stringify(value)));
  const display = { ...asset(`palettes/${bank}.palette.rgb8`, original.palette), width: 256, height: 1, format: "RGB8UI" };
  const remap = { ...asset(`palettes/${bank}.rmp.r8`, original.remap.toTextureBytes()), width: 256, height: 768, format: "R8UI" };
  json(`palettes/${bank}.json`, { schemaVersion: 1, name: options.paletteName ?? bank,
    verifiedInitialUse: options.initialUse ?? true, display: options.badDescriptor ? { ...display, width: 255 } : display, remap });
  const indices = { ...asset(`terrain/${bank}.indices.r8`, new Uint8Array(1024)), width: 32, height: 32, format: "R8UI" };
  json(`terrain/${bank}.json`, { schemaVersion: 1, palette: bank, atlas: { width: 32, height: 32 }, indices,
    keySpace: 1, keyToRecord: [0], tiles: [{ recordIndex: 0, key: 0, x: 0, y: 0, width: 32, height: 32 }] });
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, verifiedInitialPalettes: options.verified ?? [bank],
    palettes: options.omitPalette ? [] : [{ name: bank, metadata: `palettes/${bank}.json` }],
    terrain: [{ name: bank, metadata: `terrain/${bank}.json` }], outputs }));
  files.set("index.json", manifest);
  files.set("index.sha256", Buffer.from(`${hash(manifest)}  index.json\n`));
  if (options.corrupt) files.get(display.path)![40] ^= 1;
  return { mission, original, files };
}

for (const bank of ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]) {
  test(`${bank} published terrain and sprite colors match source bytes for all blends and colors`, () => {
    const { mission, original } = fixture(bank);
    const remapBytes = source(`${bank}.RMP`);
    const gif = source(`${bank}.GIF`);
    const palette = Uint8Array.from(gif.subarray(13, 781));
    palette.fill(0, 0, 3);
    palette.fill(255, 765);
    const initialized = initializeMissionTerrainPalette(mission, original.palette, remapBytes);
    assert.deepEqual(initialized.palette, palette);
    const indices = Uint8Array.from({ length: 256 }, (_, index) => index);
    for (let blend = 0; blend <= 256; blend++) {
      for (let brightness = 0; brightness <= 16; brightness++) {
        const lookup = terrainPaletteLookup(blend, brightness);
        const row = brightness * 8 + Math.trunc(7 * blend / 256);
        for (const index of indices) {
          assert.equal(initialized.remap.lookup(lookup.bank, brightness * 8 + lookup.selector, index), remapBytes[row * 256 + index]);
        }
      }
    }
    for (let selector = 0; selector < 8; selector++) {
      const actual = remapSpritePixels(indices, new Uint8Array(256).fill(255), initialized.remap, initialized.palette, selector);
      const expected = new Uint8ClampedArray(1024);
      for (const index of indices) {
        const color = remapBytes[2 * 65536 + (128 + selector) * 256 + index] * 3;
        expected.set([...palette.subarray(color, color + 3), 255], index * 4);
      }
      assert.deepEqual(actual, expected);
    }
  });

  test(`${bank} loaders select verified bank resources and fail closed on stale or altered metadata`, async (context) => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      createElement: () => ({ getContext: () => null }),
    } });
    context.after(() => {
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else Reflect.deleteProperty(globalThis, "document");
    });
    let current = fixture(bank);
    const requests: string[] = [];
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const path = String(input).replace("/assets/generated/indexed/", "");
      requests.push(path);
      const bytes = current.files.get(path);
      assert.ok(bytes, `Unexpected resource: ${path}`);
      return new Response(Uint8Array.from(bytes).buffer);
    });
    const sprites = await createMissionSpritePalettes(current.mission, []);
    sprites.dispose();
    await assert.rejects(createMissionTerrain(current.mission), IndexedWebGLUnavailableError);
    assert.ok(requests.includes(`palettes/${bank}.palette.rgb8`));
    assert.ok(requests.includes(`palettes/${bank}.rmp.r8`));
    if (bank !== "DESERT") assert.ok(requests.every((path) => !path.includes("DESERT")));
    for (const [options, error] of [
      [{ verified: [] }, /unverified initial palette/],
      [{ initialUse: false }, /schema mismatch/],
      [{ paletteName: "PALETTE" }, /schema mismatch/],
      [{ omitPalette: true }, /Missing indexed/],
      [{ badDescriptor: true }, /descriptor/],
      [{ corrupt: true }, /size\/hash mismatch/],
    ] as const) {
      current = fixture(bank, options);
      await assert.rejects(createMissionSpritePalettes(current.mission, []), error);
      await assert.rejects(createMissionTerrain(current.mission), error);
    }
    current = fixture(bank);
    current.files.set("index.sha256", Buffer.from("invalid"));
    await assert.rejects(createMissionSpritePalettes(current.mission, []), /checksum mismatch/);
    await assert.rejects(createMissionTerrain(current.mission), /checksum mismatch/);
    const mismatched = { ...current.mission, map: { ...current.mission.map, terrainBank: "OTHER.BTS" } };
    await assert.rejects(createMissionTerrain(mismatched), /must match/);
    const arbitrary = { ...current.mission, scenario: { ...current.mission.scenario, terrainBank: "CUSTOM.BTS" } };
    await assert.rejects(createMissionSpritePalettes(arbitrary, []), /Unverified/);
    await assert.rejects(createMissionTerrain(arbitrary), /Unverified/);
  });
}