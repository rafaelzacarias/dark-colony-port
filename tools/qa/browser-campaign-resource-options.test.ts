import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission, loadCampaignResourceOptions } from "../../src/game-data";
import { loadBrowserCampaignResourceOptions } from "../../src/engine/browser-campaign-resource-options";
import { BrowserCampaignEconomy, consumeBrowserEconomyIncome } from "../../src/engine/browser-campaign-economy";
import { sourceBrowserEconomyHarvesters } from "../../src/engine/browser-campaign-economy-source";
import { CampaignSession } from "../../src/engine/campaign-session";
import { sourceBrowserCampaignSessionOptions, prepareSourceBrowserCampaignMission } from "../../src/engine/source-browser-campaign-options";
import { initializeLegacyResource } from "../../src/engine/legacy-resource";
import { sourceProductionVisits } from "../../src/engine/source-production-options";
import { transportHostState } from "../../src/engine/transport-host";
import { NavigationGrid } from "../../src/engine/grid";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { parseFin } from "../extractors/animations/fin";
import { missionPaletteBank } from "../../src/render/palette-init";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const json = (path: string) => JSON.parse(read(path).toString());
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Mission = Awaited<ReturnType<typeof loadCampaignMission>>;

function assertResourceWorld(mission: Mission) {
  const metadata = mission.browserResource!;
  assert.equal(metadata.scope, "browser-adapted-resource-metadata-v1");
  assert.equal(metadata.paletteBank, missionPaletteBank(mission.scenario.terrainBank));
  assert.equal(metadata.source.sha256, hash(read(`raw_cd/DC/SCENARIO/${metadata.source.path}`)));
  const manifest = json("asset_manifest.json").files as { path: string; sha256: string }[];
  assert.equal(manifest.find(entry => entry.path === `DC/SCENARIO/${metadata.source.path}`)?.sha256, metadata.source.sha256);
  assert.equal(manifest.find(entry => entry.path === "DC/ANIMATE/VENT.FIN")?.sha256, metadata.animation.source.sha256);
  const fin = parseFin(read("raw_cd/DC/ANIMATE/VENT.FIN"));
  assert.deepEqual(metadata.animation.states, fin.states);
  assert.deepEqual(metadata.animation.timeline, fin.timeline);
  assert.ok(Object.isFrozen(metadata) && Object.isFrozen(metadata.resources) && Object.isFrozen(metadata.animation.timeline));
  assert.throws(() => Object.assign(metadata.resources[0].cell, { x: -1 }), TypeError);
  const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
  const world = session.snapshot.world;
  assert.equal(transportHostState(world).resourceLifecycle, undefined);
  assert.deepEqual(world.exomoney, mission.browserEconomy!.initialCredits);
  const raw = new DataView(world.entityBytes!.buffer, world.entityBytes!.byteOffset, world.entityBytes!.byteLength);
  const vent = mission.units.find(unit => unit.index === 40)!;
  for (const resource of metadata.resources) {
    const row = mission.scenario.placementRows[resource.sourceRow];
    const source = initializeLegacyResource({ slot: resource.slot, tileX: row[0], tileY: row[1],
      sourceRate: row[3], sourceReserve: row[4], typeReserve: vent.health, scales: { rateScale: 256, reserveScale: 256 } });
    const entity = world.entities.find(actor => actor.key === resource.key)!;
    const node = mission.browserEconomy!.nodes.find(candidate => candidate.key === resource.key)!;
    assert.deepEqual([resource.reserve, resource.health, resource.rateWord], [source.reserve, source.reserve, source.rateWord]);
    assert.deepEqual([entity.health, entity.resource!.rateWord, entity.tileX, entity.tileY],
      [source.reserve, source.rateWord, resource.cell.x, resource.cell.y]);
    assert.deepEqual([node.amount, node.rateWord, node.cell, node.slot], [source.reserve, source.rateWord, resource.cell, resource.slot]);
    const offset = resource.slot * 220;
    assert.deepEqual([raw.getUint8(offset + 6), raw.getUint8(offset + 7), raw.getInt32(offset + 12, true),
      raw.getUint16(offset + 0x32, true), raw.getUint16(offset + 0x46, true)], [40, 8, source.reserve, source.rateWord, 65535]);
  }
  return session;
}

function harvestCycle(mission: Mission, session: CampaignSession) {
  const profile = mission.browserEconomy!;
  let startupTicks = 0;
  for (let tick = 1; tick <= 300; tick += 1) {
    if (sourceBrowserEconomyHarvesters(session.snapshot.world, mission.units).some(actor => actor.team === 0)) break;
    const snapshot = session.snapshot;
    const frame = session.step({ clockMilliseconds: tick * 50,
      ...(snapshot.production ? { productionVisits: sourceProductionVisits(snapshot.world, snapshot.production, 150) } : {}) });
    assert.ok(frame.ok, JSON.stringify(frame));
    startupTicks = tick;
  }
  const world = session.snapshot.world;
  const sourceHarvesters = sourceBrowserEconomyHarvesters(world, mission.units);
  const harvester = sourceHarvesters.find(actor => actor.team === 0) ?? sourceHarvesters[0];
  assert.ok(harvester, `${mission.scenario.id}: no source harvester after 300 natural ticks`);
  const team = harvester.team;
  const grid = new NavigationGrid(mission.map.width, mission.map.height,
    Uint16Array.from(createLegacyInfantryFamilyMask({ ...mission.map, pathGrid: mission.pathGrid })));
  const simulation = new DeterministicSimulation(grid, { initialResources: { [mission.faction]: profile.initialCredits[0] } });
  for (const resource of mission.browserResource!.resources) {
    const entity = world.entities.find(actor => actor.key === resource.key)!;
    simulation.addStaticTarget({ faction: mission.faction, team: 8, cell: resource.cell, footprint: [resource.cell],
      health: entity.health, maxHealth: entity.maxHealth });
  }
  const bindings = profile.harvesters.map(actor => ({ key: actor.key, simulationId: simulation.addUnit(actor.options) }));
  const owner = new BrowserCampaignEconomy(profile, simulation, bindings);
  let unitId = bindings.find(binding => binding.key === harvester.key)?.simulationId;
  if (unitId === undefined) {
    unitId = simulation.addUnit(harvester.options);
    owner.bindHarvester(simulation, harvester, unitId);
    bindings.push({ key: harvester.key, simulationId: unitId });
  }
  const node = profile.nodes.find(candidate => owner.harvest(simulation, [unitId], candidate.key, team).length > 0);
  assert.ok(node, `${mission.scenario.id}: no reachable source VENT`);
  for (let tick = 0; tick < 2500 && !(owner.checkpoint().earned[team] > 0); tick += 1) {
    simulation.advance();
    owner.observe(simulation);
  }
  const earned = owner.checkpoint().earned[team];
  assert.ok(earned > 0, `${mission.scenario.id}: no completed extraction`);
  assert.equal(owner.checkpoint().remaining[node.key], node.amount - earned);
  const delivered = consumeBrowserEconomyIncome(world, owner.initialLedger, owner.income);
  assert.equal(delivered.world.exomoney[team], world.exomoney[team] + earned);
  const restoredSimulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  const restored = new BrowserCampaignEconomy(profile, restoredSimulation, bindings, JSON.parse(JSON.stringify(owner.checkpoint())));
  simulation.advance(); owner.observe(simulation);
  restoredSimulation.advance(); restored.observe(restoredSimulation);
  assert.deepEqual(restored.checkpoint(), owner.checkpoint());
  return { startupTicks, harvestTeam: team, playerHarvesterByTick32: team === 0 && startupTicks <= 32,
    harvestTick: simulation.snapshot.tick, earned, initialCredits: profile.initialCredits[0] };
}

test("browser resources: original six missions bypass only native resource admission", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."), path);
    return new Response(Uint8Array.from(read(`public${path}`)).buffer);
  });
  for (const [faction, number] of [["human", 2], ["human", 3], ["human", 10],
    ["alien", 2], ["alien", 3], ["alien", 4]] as const) {
    const mission = await loadCampaignMission(faction, number, "browser-adapted");
    const original = JSON.parse(read(`public/assets/generated/data/scenarios/${mission.scenario.source.path.replace(/\.SCN$/, ".json")}`).toString());
    assert.deepEqual(mission.scenario, original);
    assert.equal(mission.sourceResource, undefined, "adapted metadata must not claim native lifecycle admission");
    assert.ok(mission.browserEconomy!.nodes.length > 0);
    assert.equal(mission.browserEconomy!.nodes.length, original.placementRows.filter((row: number[]) => row[2] === 40).length);
    const session = assertResourceWorld(mission);
    context.diagnostic(JSON.stringify({ mission: mission.scenario.id, nodes: mission.browserEconomy!.nodes.length,
      profileId: mission.browserEconomy!.profileId, ...harvestCycle(mission, session) }));
    if (number === 2) {
      const sourceResource = await loadCampaignResourceOptions(mission, async url => read(`public${url}`), "browser-adapted");
      const previous = await prepareSourceBrowserCampaignMission({ ...mission, sourceResource },
        json("public/assets/generated/data/dependencies.json").records);
      assert.deepEqual(mission.browserEconomy, previous.browserEconomy);
      assert.deepEqual(mission.browserAi, previous.browserAi);
      assert.equal(sourceResource.evidence.profile, "bounded-native-constructor-scn");
      assert.equal(sourceResource.resourceLifecycle.bindings.length, mission.browserEconomy!.nodes.length);
    }
    if (number !== 2) await assert.rejects(loadCampaignResourceOptions(mission, async url => read(`public${url}`), "browser-adapted"),
      /unproved SCN resource mapping/);
  }
});

test("browser resources: indexed VENT children retain original source hashes and palette-independent pixels", () => {
  const metadata = json("public/assets/generated/animations/VENT.json");
  const manifest = json("asset_manifest.json").files as { path: string; sha256: string }[];
  const indexBytes = read("public/assets/generated/indexed/index.json");
  assert.equal(read("public/assets/generated/indexed/index.sha256").toString().trim(), `${hash(indexBytes)}  index.json`);
  const indexed = JSON.parse(indexBytes.toString());
  const children = new Set<string>(metadata.timeline.flatMap((frame: { children: { sprite: string }[] }) =>
    frame.children.map(child => child.sprite.toUpperCase())));
  for (const sprite of children) {
    const path = `sprites/SPRITES/${sprite}.json`;
    const bytes = read(`public/assets/generated/indexed/${path}`);
    assert.equal(hash(bytes), indexed.outputs.find((output: { path: string }) => output.path === path).sha256);
    const asset = JSON.parse(bytes.toString());
    assert.equal(asset.source.sha256, manifest.find(entry => entry.path === `DC/${asset.source.path}`)?.sha256);
    assert.equal(asset.source.sha256, hash(read(`raw_cd/DC/${asset.source.path}`)));
    for (const texture of [asset.indices, asset.coverage]) {
      const pixels = read(`public/assets/generated/indexed/${texture.path}`);
      assert.equal(pixels.length, texture.bytes);
      assert.equal(hash(pixels), texture.sha256);
      assert.equal(texture.sha256, indexed.outputs.find((output: { path: string }) => output.path === texture.path).sha256);
    }
  }
});

test("browser resources: metadata rejects changed SCN or FIN and strict HUMAN01 stays resource-free", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(Uint8Array.from(read(`public${String(input)}`)).buffer));
  const mission = await loadCampaignMission("human", 3, "browser-adapted");
  await assert.rejects(loadBrowserCampaignResourceOptions({ ...mission,
    scenario: { ...mission.scenario, rawScenario: btoa("changed") } }), /raw SCN hash/);
  await assert.rejects(loadBrowserCampaignResourceOptions({ ...mission,
    scenario: { ...mission.scenario, placementRows: [] } }), /placementRows differs/);
  await assert.rejects(loadBrowserCampaignResourceOptions(mission, async url => {
    const bytes = Uint8Array.from(read(`public${url}`)); bytes[bytes.length - 1] ^= 1; return bytes;
  }), /VENT generated FIN hash/);
  const strict = await loadCampaignMission("human", 1);
  assert.equal(strict.browserResource, undefined);
  assert.equal(strict.sourceResource, undefined);
  assert.equal(strict.runtimeProfile, undefined);
});

test("browser resources: later original resource missions report remaining admission failures separately", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(Uint8Array.from(read(`public${String(input)}`)).buffer));
  for (const faction of ["human", "alien"] as const) for (let number = 2; number <= 15; number += 1) {
    const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}${String(number).padStart(2, "0")}`;
    const scenario = json(`public/assets/generated/data/scenarios/${stem}.json`);
    if (!scenario.placementRows.some((row: number[]) => row[2] === 40)) continue;
    let mission: Mission;
    try { mission = await loadCampaignMission(faction, number, "browser-adapted"); }
    catch (error) {
      const message = String(error);
      assert.doesNotMatch(message, /unproved SCN resource mapping/);
      assert.match(message, /TRO|Unsupported operand|dimensions|type-37/);
      context.diagnostic(JSON.stringify({ mission: scenario.id, loaded: false, failure: message }));
      continue;
    }
    assertResourceWorld(mission);
    context.diagnostic(JSON.stringify({ mission: scenario.id, loaded: true, resources: mission.browserEconomy!.nodes.length }));
  }
});