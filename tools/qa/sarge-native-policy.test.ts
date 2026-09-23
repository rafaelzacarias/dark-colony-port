import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { activateBrowserIncomeInterception, initializeBrowserIncomeInterception,
  observeBrowserIncomeInterception, splitBrowserInterceptedIncome } from "../../src/engine/browser-income-interception";

test("SARGE source policy: ordered cells, persistent link and odd loss", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(64, 64, new Uint16Array(4096).fill(1)));
  const thief = simulation.addUnit({ faction: "human", team: 0, cell: { x: 30, y: 30 } });
  const far = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 30, y: 8 } });
  const near = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 31, y: 30 } });
  const collectors = [{ key: "far", slot: 155, generation: 0, team: 1, simulationId: far, currentType: 48 as const },
    { key: "near", slot: 153, generation: 0, team: 1, simulationId: near, currentType: 48 as const }];
  const groundWords = Array(4096).fill(1023);
  groundWords[8 * 64 + 30] = 0x40000000 | 155;
  groundWords[30 * 64 + 31] = 0x40000000 | 153;
  const frame = { tick: 0, width: 64, height: 64, groundWords, teamVisibilityMasks: [0x40000000, 0, 0, 0, 0, 0, 0, 0], collectors };
  let state = activateBrowserIncomeInterception(initializeBrowserIncomeInterception(), simulation.snapshot,
    { type: "deploy", actor: { key: "sarge", slot: 154, generation: 0, simulationId: thief, team: 0, typeId: 4 } });
  state = observeBrowserIncomeInterception(state, simulation.snapshot, frame);
  assert.equal(state.deployments[0].partner?.key, "far");
  state = observeBrowserIncomeInterception(state, simulation.snapshot,
    { ...frame, groundWords: groundWords.map(word => word & 1023) });
  for (let cycle = 0; cycle < 2; cycle++) {
    const split = splitBrowserInterceptedIncome(state, simulation.snapshot, undefined, collectors[0],
      simulation.snapshot.units.find(unit => unit.id === far)!, 25);
    assert.equal(split.retained, 12); assert.equal(split.stolen, 12); state = split.state;
  }
  assert.equal(state.ledger[0].gross, 50);
  assert.equal(state.ledger[0].stolen, 24);
  assert.equal(state.ledger[0].dissipated, 2);
});

test("SARGE source scan: L envelope, all caller masks, first occupied link and displacement retention", () => {
  for (const [offsetX, offsetY, expected] of [[11, 22, true], [22, 11, true], [12, 12, false],
    [12, 22, false], [23, 0, false], [-22, -11, true], [0, -22, true]] as const) {
    for (let team = 0; team < 8; team++) {
      const simulation = new DeterministicSimulation(new NavigationGrid(64, 64, new Uint16Array(4096).fill(1)));
      const thief = simulation.addUnit({ faction: "human", team, cell: { x: 30, y: 30 } });
      const target = simulation.addUnit({ faction: "alien", team: (team + 1) % 8,
        cell: { x: 30 + offsetX, y: 30 + offsetY } });
      const collector = { key: "collector", slot: 153, generation: 0, team: (team + 1) % 8,
        simulationId: target, currentType: 48 as const };
      const mask = 0x40000000 >>> team, cell = (30 + offsetY) * 64 + 30 + offsetX;
      const groundWords = Array<number>(4096).fill(1023); groundWords[cell] = mask | 153;
      const frame = { tick: 0, width: 64, height: 64, groundWords,
        teamVisibilityMasks: Array.from({ length: 8 }, (_, owner) => owner === team ? mask : 0), collectors: [collector] };
      let state = activateBrowserIncomeInterception(initializeBrowserIncomeInterception(), simulation.snapshot,
        { type: "deploy", actor: { key: "sarge", slot: 154, generation: 0, team, simulationId: thief, typeId: 4 } });
      state = observeBrowserIncomeInterception(state, simulation.snapshot, frame);
      assert.equal(Boolean(state.deployments[0].partner), expected, JSON.stringify({ offsetX, offsetY, team }));
      if (!expected) continue;
      const moved = { ...simulation.snapshot, units: simulation.snapshot.units.map(unit => unit.id === thief
        ? { ...unit, cellX: 2, cellY: 2, xSubcells: 2560, ySubcells: 2560 } : unit) };
      state = observeBrowserIncomeInterception(state, moved, { ...frame, groundWords: groundWords.map(word => word & 1023) });
      assert.ok(state.deployments[0].partner, "controlled displacement does not recheck range");
      const second = simulation.addUnit({ faction: "human", team, cell: { x: 30, y: 31 } });
      state = activateBrowserIncomeInterception(state, simulation.snapshot,
        { type: "deploy", actor: { key: "second", slot: 155, generation: 0, team, simulationId: second, typeId: 4 } });
      state = observeBrowserIncomeInterception(state, simulation.snapshot, frame);
      assert.equal(state.deployments[1].partner, undefined);
    }
  }
});

test("SARGE source scan: an occupied first target rejects without trying a free second target", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(64, 64, new Uint16Array(4096).fill(1)));
  const first = simulation.addUnit({ faction: "human", team: 0, cell: { x: 30, y: 30 } });
  const second = simulation.addUnit({ faction: "human", team: 0, cell: { x: 30, y: 31 } });
  const far = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 30, y: 9 } });
  const near = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 31, y: 30 } });
  const collectors = [{ key: "far", slot: 159, generation: 0, team: 1, simulationId: far, currentType: 47 as const },
    { key: "near", slot: 153, generation: 0, team: 1, simulationId: near, currentType: 48 as const }];
  const groundWords = Array<number>(4096).fill(1023);
  groundWords[9 * 64 + 30] = 159 | 0x40000000; groundWords[30 * 64 + 31] = 153 | 0x40000000;
  const frame = { tick: 0, width: 64, height: 64, groundWords, collectors,
    teamVisibilityMasks: [0x40000000, 0, 0, 0, 0, 0, 0, 0] };
  let state = initializeBrowserIncomeInterception();
  for (const [simulationId, slot] of [[first, 154], [second, 155]]) {
    state = activateBrowserIncomeInterception(state, simulation.snapshot,
      { type: "deploy", actor: { key: `sarge:${slot}`, slot, generation: 0, simulationId, team: 0, typeId: 4 } });
    state = observeBrowserIncomeInterception(state, simulation.snapshot, frame);
  }
  assert.equal(state.deployments[0].partner?.key, "far");
  assert.equal(state.deployments[1].partner, undefined);
});