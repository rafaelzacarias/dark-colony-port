import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BTS_DATA_OFFSET } from "./bts";
import { extractMapBundles, extractTerrainBanks } from "./extract";

function btsFixture(): Buffer {
  const buffer = Buffer.alloc(BTS_DATA_OFFSET + 1028);
  buffer.writeUInt32LE(10, 0);
  buffer.writeUInt32LE(1, 4);
  buffer[11] = 63;
  buffer.writeUInt32LE(3, BTS_DATA_OFFSET);
  buffer.fill(1, BTS_DATA_OFFSET + 4);
  return buffer;
}

test("exports deterministic terrain atlases and typed map layers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-maps-"));
  const source = path.join(root, "source");
  const terrainOutput = path.join(root, "terrain");
  const mapOutput = path.join(root, "maps");
  try {
    await mkdir(path.join(source, "HUMAN"), { recursive: true });
    await writeFile(path.join(source, "TEST.BTS"), btsFixture());
    const map = Buffer.alloc(20);
    map.writeUInt32LE(2, 0);
    map.writeUInt32LE(1, 4);
    map.writeUInt16LE(3, 8);
    map.writeUInt16LE(0, 10);
    map.writeUInt16LE(9, 12);
    map.writeUInt16LE(0, 14);
    map.writeUInt16LE(0x1ce0, 16);
    map.writeUInt16LE(0x1c81, 18);
    await writeFile(path.join(source, "HUMAN", "ONE.MAP"), map);
    await writeFile(path.join(source, "HUMAN", "ONE.MTG"), Buffer.from([2, 1, 7, 8]));
    const pth = Buffer.alloc(65_538);
    pth[65_536] = 8;
    await writeFile(path.join(source, "HUMAN", "ONE.PTH"), pth);
    await writeFile(path.join(source, "HUMAN", "ONE.SCN"), "TEST.BTS\r\n");

    const firstTerrain = await extractTerrainBanks(source, terrainOutput);
    const firstMaps = await extractMapBundles(source, mapOutput);
    const terrainHash = await readFile(path.join(terrainOutput, "TEST.png"));
    const mapMetadata = await readFile(path.join(mapOutput, "HUMAN", "ONE.json"), "utf8");
    const secondTerrain = await extractTerrainBanks(source, terrainOutput);
    const secondMaps = await extractMapBundles(source, mapOutput);

    assert.deepEqual(secondTerrain, firstTerrain);
    assert.deepEqual(secondMaps, firstMaps);
    assert.deepEqual(await readFile(path.join(terrainOutput, "TEST.png")), terrainHash);
    assert.equal(await readFile(path.join(mapOutput, "HUMAN", "ONE.json"), "utf8"), mapMetadata);
    assert.deepEqual(
      [...(await readFile(path.join(mapOutput, "HUMAN", "ONE.tiles.u16")))],
      [3, 0, 0, 0, 9, 0, 0, 0],
    );
    assert.equal(firstMaps.schemaVersion, 2);
    const metadata = JSON.parse(mapMetadata);
    assert.equal(metadata.referencesPerCell, 2);
    assert.deepEqual(metadata.missingKeys, [{ key: 9, backgroundCount: 1, foregroundCount: 0 }]);
    assert.deepEqual([...await readFile(path.join(mapOutput, "HUMAN", "ONE.tile-records.u16"))], Array(8).fill(0));
    assert.deepEqual([...await readFile(path.join(mapOutput, "HUMAN", "ONE.attributes.u16"))], [0xe0, 0x1c, 0x81, 0x1c]);
    assert.equal(firstMaps.entries[0].directBtsReferences, 1);
    assert.equal(firstMaps.entries[0].unresolvedReferences, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
