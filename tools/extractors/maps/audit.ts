import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseTerrainBank, resolveTerrainReferences, type TerrainBank } from "./bts";
import { parseMap } from "./map";

const root = path.resolve(process.argv[2] ?? "raw_cd/DC/SCENARIO");
const banks = new Map<string, Set<number>>();
const terrainBanks = new Map<string, TerrainBank>();
for (const name of await readdir(root)) {
  if (!name.endsWith(".BTS")) continue;
  const bank = parseTerrainBank(await readFile(path.join(root, name)));
  terrainBanks.set(name, bank);
  banks.set(name, new Set(bank.tiles.map((tile) => tile.key)));
  console.log(JSON.stringify({ bank: name, keySpace: bank.keySpace, tiles: bank.tiles.length,
    firstKeys: bank.tiles.slice(0, 20).map((tile) => tile.key) }));
}
const totals = Array.from({ length: 3 }, () => ({ count: 0, zero: 0, hit: 0, max: 0 }));
let maps = 0;
for (const name of await readdir(root, { recursive: true })) {
  if (!name.endsWith(".MAP")) continue;
  const bytes = await readFile(path.join(root, name));
  const bankName = (await readFile(path.join(root, name.replace(/\.MAP$/, ".SCN")), "ascii")).split(/\r?\n/)[0].trim();
  const keys = banks.get(bankName.toUpperCase());
  if (!keys) throw new Error(`Missing bank ${bankName}`);
  const area = bytes.readUInt32LE(0) * bytes.readUInt32LE(4);
  const parsed = parseMap(bytes);
  const resolution = resolveTerrainReferences(terrainBanks.get(bankName.toUpperCase())!, parsed.tileReferences);
  const regions = Array.from({ length: 3 }, () => ({ count: 0, zero: 0, hit: 0, max: 0 }));
  for (let index = 0; index < area * 3; index += 1) {
    const value = bytes.readUInt16LE(8 + index * 2);
    const decoded = index < area * 2 ? parsed.tileReferences[index] : parsed.attributes[index - area * 2];
    if (decoded !== value) throw new Error(`Plane mismatch in ${name} at word ${index}`);
    const region = index < area * 2 ? index % 2 : 2;
    for (const stats of [regions[region], totals[region]]) {
      stats.count += 1;
      stats.zero += Number(value === 0);
      stats.hit += Number(keys.has(value));
      stats.max = Math.max(stats.max, value);
    }
  }
  maps += 1;
  console.log(JSON.stringify({ map: name, bankName, regions, missingKeys: resolution.missingKeys,
    boundary: bytes.subarray(8 + area * 4 - 16, 8 + area * 4 + 32).toString("hex") }));
}
console.log(JSON.stringify({ maps, totals }));