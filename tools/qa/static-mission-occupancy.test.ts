import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView, MISSION_BROWSER_POLICY } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import { findPath } from "../../src/engine/pathfinding";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { legacyStaticOccupancyFieldsFromSource, projectLegacyStaticOccupancy } from "../../src/engine/legacy-static-occupancy";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";
import { parseMapBundle } from "../extractors/maps/map";

const root = new URL("../../", import.meta.url);
const source = readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root));
const units = parseUnitStats(source.toString("ascii"));

test("all 106 original GAMESTAT rows match actual scanner destinations and native occupancy fields", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629");
  assert.equal(createHash("sha256").update(readFileSync(new URL("raw_cd/DC/DC.EXE", root))).digest("hex"),
    "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  const native = JSON.parse(execFileSync("python3", ["-c", `
import json, runpy, struct
scope = runpy.run_path('tools/research/inspire-audit-20260919.py', run_name='static_mapping_fixture')
machine = scope['fixture']()
frame, types = scope['FRAME'], scope['TYPES']
machine.mem_write(frame - 4, struct.pack('<I', types))
machine.reg_write(scope['UC_X86_REG_EBP'], frame)
machine.reg_write(scope['UC_X86_REG_ESP'], scope['STACK'])
scope['run_slice'](machine, 0x43BBC5, 0x43BCCC)
pointer = machine.reg_read(scope['UC_X86_REG_ESP'])
destinations = struct.unpack('<33I', machine.mem_read(pointer + 8, 132))
assert destinations[13] == frame - 0x18
assert destinations[15] == types + 0x68
machine = scope['parsed_fixture']()
print(json.dumps([{'movementClassByte': machine.mem_read(types + index * 280 + 0x60, 1)[0],
                  'auxiliaryField': struct.unpack('<i', machine.mem_read(types + index * 280 + 0x68, 4))[0]}
                 for index in range(106)]))
`], { cwd: root, encoding: "utf8", env: { ...process.env,
    PYTHONPATH: [process.env.PYTHONPATH, "/private/tmp/dc-re-capstone-20260918", "/private/tmp/dc-trigger-unicorn-20260918"]
      .filter(Boolean).join(":") } }));
  assert.equal(units.length, 106);
  for (const stat of units) assert.deepEqual(legacyStaticOccupancyFieldsFromSource(stat), native[stat.index], stat.sprite);
});

test("source field adapter rejects unknown shapes and missing values instead of assuming ground", () => {
  for (const rawTail of [[], units[82].rawTail.slice(1), [...units[82].rawTail, 0],
    units[82].rawTail.map((value, index) => index === 4 ? NaN : value),
    units[82].rawTail.map((value, index) => index === 2 ? 0.5 : value)]) {
    assert.throws(() => legacyStaticOccupancyFieldsFromSource({ rawTail }));
  }
  const sparse = [...units[82].rawTail];
  delete sparse[4];
  assert.throws(() => legacyStaticOccupancyFieldsFromSource({ rawTail: sparse }));
});

test("all 23 required source types select ground, air, auxiliary or owner-8 no occupancy", () => {
  const required = [37, 40, 41, 42, 45, 46, 47, 48, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 94, 95, 97, 98, 100];
  for (const type of required) {
    const projection = projectLegacyStaticOccupancy({ slot: 152, owner: type === 37 || type === 40 ? 8 : 0,
      tileX: 2, tileY: 3, width: 96, height: 84, ...legacyStaticOccupancyFieldsFromSource(units[type]) });
    assert.deepEqual(projection, type === 37 || type === 40 ? null : {
      plane: type === 45 || type === 46 ? "auxiliary" : type === 94 ? "air" : "ground", x: 2, y: 3,
    }, String(type));
  }
});

function fixture(faction: "HUMAN" | "ALIEN"): CampaignMissionData {
  const read = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root));
  const original = (extension: string) => read(`SCENARIO/${faction}/${faction}01.${extension}`);
  const map = parseMapBundle(original("MAP"), original("MTG"), original("PTH"));
  const generated = (path: string) => JSON.parse(readFileSync(new URL(`public/assets/generated/${path}`, root), "utf8"));
  return {
    faction: faction === "HUMAN" ? "human" : "alien",
    scenario: { ...generated(`data/scenarios/${faction}/${faction}01.json`), ...parseScenario(original("SCN").toString()) },
    map: generated(`maps/${faction}/${faction}01.json`),
    triggers: parseTriggerScript(original("TRO").toString()), messages: parseMissionMessages(original("MSG").toString()),
    units, weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    briefing: generated(`data/briefings/${faction}/${faction}01.json`),
    terrain: generated("terrain/DESERT.json"), terrainAtlasUrl: "", pathGrid: map.pathGrid, tags: map.tagGrid,
    tileReferences: new Uint16Array(0), tileRecordIndices: new Uint16Array(0), attributes: new Uint16Array(0),
  };
}

function createView(data: CampaignMissionData): MissionView {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, data);
  view.render = () => {};
  assert.equal(view.missionDiagnostic, undefined);
  view.update(0);
  return view;
}

function step(view: MissionView): void {
  view.update((view.simulation.snapshot.tick + 1) * MISSION_BROWSER_POLICY.fixedStepMilliseconds);
  assert.equal(view.missionDiagnostic, undefined);
}

test("ALIEN01 all eleven type-82 statics and the owned mind link block their source cells, not neighboring paths", () => {
  const data = fixture("ALIEN");
  const view = createView(data);
  const targets = view.campaignSnapshot!.world.entities.filter(({ unitType }) => unitType === 82 || unitType === 89);
  assert.equal(targets.filter(({ unitType }) => unitType === 82).length, 11);
  const mindLink = targets.find(({ unitType }) => unitType === 89)!;
  assert.equal(mindLink.team, 0);
  assert.equal(view.isOwnedUnit(view.nativeBindings.find(({ key }) => key === mindLink.key)!.simulationId), true);
  for (const entity of targets) {
    assert.ok(entity.rawSlot! >= 120);
    assert.equal(view.grid.isPassable(entity.tileX, entity.tileY), false);
    const neighbors = view.grid.neighbors(view.grid.index(entity.tileX, entity.tileY)).map((index) => view.grid.point(index));
    assert.ok(neighbors.length > 0);
    assert.equal(findPath(view.grid, neighbors[0], { x: entity.tileX, y: entity.tileY }), null);
  }
  const before = createLegacyInfantryFamilyMask({ ...data.map, pathGrid: data.pathGrid });
  const occupied = new Set(targets.map(({ tileX, tileY }) => view.grid.index(tileX, tileY)));
  for (const [index, cost] of view.grid.costs.entries()) assert.equal(cost, occupied.has(index) ? 0 : before[index]);
});

test("HUMAN01 actual tag-7 neighbor reservation changes 95 to 84 without changing identity or ground blocking", () => {
  const data = fixture("HUMAN");
  const view = createView(data);
  for (let tick = 0; tick < 1000 && view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id)).length < 5; tick += 1) step(view);
  const soldier = view.simulation.snapshot.units.find(({ id }) => view.isOwnedUnit(id));
  assert.ok(soldier);
  const beacon = view.campaignSnapshot!.world.entities.find(({ tileX, tileY }) => tileX === 26 && tileY === 59)!;
  assert.equal(beacon.unitType, 95);
  const binding = view.nativeBindings.find(({ key }) => key === beacon.key)!;
  const neighbor = { x: 25, y: 59 };
  assert.equal(data.tags[(data.map.height - 1 - neighbor.y) * data.map.width + neighbor.x], 7);
  assert.equal(view.grid.isPassable(neighbor.x, neighbor.y), true);
  assert.equal(view.grid.isPassable(beacon.tileX, beacon.tileY), false);
  assert.equal(findPath(view.grid, neighbor, { x: beacon.tileX, y: beacon.tileY }), null);
  const route = findPath(view.grid, { x: soldier.cellX, y: soldier.cellY }, neighbor);
  assert.ok(route);
  assert.deepEqual(route.at(-1), neighbor);
  assert.ok(route.every(({ x, y }) => x !== beacon.tileX || y !== beacon.tileY));
  assert.equal(view.campaignSnapshot!.controller.runtime.lives[7], 1);
  view.recordDestinationReservation(soldier.id, neighbor.x, neighbor.y);
  step(view);
  assert.equal(view.campaignSnapshot!.controller.runtime.lives[7], 0);
  for (let tick = 0; tick < 4; tick += 1) {
    assert.equal(view.campaignSnapshot!.world.entities.find(({ key }) => key === beacon.key)!.unitType, 84);
    assert.deepEqual(view.nativeBindings.find(({ key }) => key === beacon.key), binding);
    assert.equal(view.unitName(binding.simulationId), data.units[84].sprite);
    assert.equal(view.grid.isPassable(beacon.tileX, beacon.tileY), false);
    assert.equal(view.grid.isPassable(neighbor.x, neighbor.y), true);
    step(view);
  }
});

for (const priorCost of [0, 1]) for (const overlap of [false, true]) {
  test(`source static death restores prior PTH cost ${priorCost} only after the last blocker (overlap=${overlap})`, () => {
    const original = fixture("ALIEN");
    const row = original.scenario.placementRows.find((entry) => entry[2] === 82)!;
    const cell = { x: row[0], y: row[1] };
    const pathGrid = Uint8Array.from(original.pathGrid);
    const index = cell.y * original.map.width + cell.x;
    if (priorCost === 0) pathGrid[index] = 0;
    else assert.equal(createLegacyInfantryFamilyMask({ ...original.map, pathGrid })[index], 1);
    const data = { ...original, pathGrid, triggers: [], scenario: { ...original.scenario,
      placementRows: overlap ? [...original.scenario.placementRows, [...row]] : original.scenario.placementRows } };
    const view = createView(data);
    const targets = view.campaignSnapshot!.world.entities.filter(({ unitType, tileX, tileY }) =>
      unitType === 82 && tileX === cell.x && tileY === cell.y);
    assert.equal(targets.length, overlap ? 2 : 1);
    const free = view.grid.neighbors(index)[0];
    assert.notEqual(free, undefined);
    assert.equal(view.grid.costs[index], 0);
    for (const [targetIndex, entity] of targets.entries()) {
      const attacker = view.simulation.addUnit({ faction: "alien", cell: view.grid.point(free),
        weapon: { damage: 10000, rangeCells: 200, cooldownTicks: 1 } });
      const binding = view.nativeBindings.find(({ key }) => key === entity.key)!;
      view.simulation.queue({ type: "attack", unitIds: [attacker], targetId: binding.simulationId });
      for (let tick = 0; tick < 8 && view.simulation.snapshot.staticTargets.find(({ id }) => id === binding.simulationId)!.health > 0; tick += 1) step(view);
      assert.equal(view.simulation.snapshot.staticTargets.find(({ id }) => id === binding.simulationId)!.health, 0);
      assert.equal(view.grid.costs[index], targetIndex === targets.length - 1 ? priorCost : 0);
      assert.equal(view.missionStatistics["1,0,82"], targetIndex + 1);
      view.simulation.removeUnit(attacker);
    }
  });
}

test("live resource admission remains rejected until the resource registration contract is supplied", () => {
  const original = fixture("ALIEN");
  const data = { ...original, scenario: { ...original.scenario, placementRows: [[10, 10, 40, 0, 0]] } };
  const view = new MissionView({} as HTMLCanvasElement, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, data);
  assert.match(view.missionDiagnostic!, /resource/i);
  assert.equal(view.nativeBindings.length, 0);
});