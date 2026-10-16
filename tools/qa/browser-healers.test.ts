import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ALIEN_HEALER_UNIT_TYPE,
  BROWSER_HEALER_PROFILES,
  buildUnitCostTable,
  calculateCostScaledHeal,
  calculateFullHealChargeCost,
  calculateHpPerCharge,
  canHealerDeployAt,
  canHealerHeal,
  DEFAULT_DEPENDENCY_UNIT_COSTS,
  DEFAULT_HEALER_UNIT_COST,
   getHealerProfile,
  HEALER_DEPLOY_MANHATTAN_LIMIT,
  HEALER_INITIAL_CHARGE,
  HEALER_MAX_CHARGE,
  HEALER_MIN_CHARGE,
  HEALER_SCAN_RADIUS,
  HUMAN_HEALER_UNIT_TYPE,
  isHealerUnitStat,
  isHealerUnitType,
  isWithinHealerDeployRange,
  isWithinHealerScanRadius,
  rechargeHealer,
  resolveUnitHealCost,
  scanBrowserHealerNeighborhood,
  stepBrowserHealer,
  verifiedHealerSprite,
} from "../../src/engine/browser-healers";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";

interface GeneratedDependenciesJson {
  readonly schemaVersion: number;
  readonly records: readonly {
    readonly id: number;
    readonly cost: number;
    readonly interfaceId: number;
    readonly rawFields: readonly number[];
    readonly dependencies: readonly number[];
  }[];
}

interface GeneratedUnitsJson {
  readonly schemaVersion: number;
  readonly records: readonly {
    readonly index: number;
    readonly sprite: string;
    readonly faction: number;
    readonly health: number;
    readonly movementSpeed: number;
    readonly turnSpeed: number;
    readonly weapons: readonly [number, number, number];
  }[];
}

const dependenciesData = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/dependencies.json", import.meta.url), "utf8"),
) as GeneratedDependenciesJson;

const unitsData = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/units.json", import.meta.url), "utf8"),
) as GeneratedUnitsJson;

test("browser healers: BEON (49) and ZISP (50) recognition and cost lookup from dependencies.json and units.json", () => {
  const beonUnit = unitsData.records.find((record) => record.index === HUMAN_HEALER_UNIT_TYPE);
  const zispUnit = unitsData.records.find((record) => record.index === ALIEN_HEALER_UNIT_TYPE);
  assert.ok(beonUnit, "Expected BEON (unit 49) in units.json");
  assert.ok(zispUnit, "Expected ZISP (unit 50) in units.json");

  assert.equal(beonUnit.sprite, "BEON");
  assert.equal(beonUnit.faction, 0);
  assert.equal(beonUnit.health, 400);
  assert.equal(zispUnit.sprite, "ZISP");
  assert.equal(zispUnit.faction, 1);
  assert.equal(zispUnit.health, 400);

  assert.equal(isHealerUnitType(49), true);
  assert.equal(isHealerUnitType(50), true);
  assert.equal(isHealerUnitType(0), false);
  assert.equal(isHealerUnitType(48), false);
  assert.equal(verifiedHealerSprite(49), "BEON");
  assert.equal(verifiedHealerSprite(50), "ZISP");
  assert.equal(verifiedHealerSprite(1), null);
  assert.equal(isHealerUnitStat(beonUnit), true);
  assert.equal(isHealerUnitStat(zispUnit), true);
  assert.equal(isHealerUnitStat(unitsData.records[0]), false);

  const beonDep = dependenciesData.records.find((record) => record.id === 83);
  const zispDep = dependenciesData.records.find((record) => record.id === 84);
  assert.ok(beonDep, "Expected dependency record 83 for BEON");
  assert.ok(zispDep, "Expected dependency record 84 for ZISP");
  assert.deepEqual(beonDep.rawFields, [1, 49]);
  assert.equal(beonDep.cost, 900);
  assert.equal(beonDep.interfaceId, 135);
  assert.deepEqual(zispDep.rawFields, [1, 50]);
  assert.equal(zispDep.cost, 900);
  assert.equal(zispDep.interfaceId, 134);

  assert.equal(getHealerProfile(49), BROWSER_HEALER_PROFILES[49]);
  assert.equal(getHealerProfile(50), BROWSER_HEALER_PROFILES[50]);
  assert.equal(getHealerProfile(99), null);

  const costTable = buildUnitCostTable(dependenciesData);
  assert.equal(costTable.get(49), 900);
  assert.equal(costTable.get(50), 900);
  assert.equal(costTable.get(0), 350);
  assert.equal(costTable.get(2), 600);
  assert.equal(costTable.get(3), 1000);
  assert.equal(costTable.get(4), 1500);
  assert.equal(costTable.get(5), 600);
  assert.equal(costTable.get(8), 350);
  assert.equal(costTable.get(13), 600);

  for (const [unitTypeKey, expectedCost] of Object.entries(DEFAULT_DEPENDENCY_UNIT_COSTS)) {
    const unitType = Number(unitTypeKey);
    assert.equal(costTable.get(unitType), expectedCost);
    assert.equal(resolveUnitHealCost(unitType, costTable), expectedCost);
  }

  // Spawned unit types without a dependency record (e.g. commanders 69..76) fall back to 300
  assert.equal(resolveUnitHealCost(69, costTable), DEFAULT_HEALER_UNIT_COST);
  assert.equal(resolveUnitHealCost(73, dependenciesData), 300);
  assert.equal(resolveUnitHealCost(undefined, costTable), 300);
});

test("browser healers: full heal and charge deduction math (0x413E17..0x413FE0)", () => {
  // Human Mercenary (type 0, cost 350, missingHp = 100):
  // fullChargeCost = Math.trunc((100 * 64) / 350) = 18
  // hpPerCharge = Math.trunc((350 * 36) / 256) = 49
  assert.equal(calculateFullHealChargeCost(100, 350), 18);
  assert.equal(calculateHpPerCharge(350), 49);

  const fullMercHeal = calculateCostScaledHeal(100, 32, 350);
  assert.equal(fullMercHeal.fullChargeCost, 18);
  assert.equal(fullMercHeal.hpPerCharge, 49);
  assert.equal(fullMercHeal.healedHp, 100);
  assert.equal(fullMercHeal.chargeBefore, 32);
  assert.equal(fullMercHeal.chargeAfter, 14);
  assert.equal(fullMercHeal.chargeSpent, 18);
  assert.equal(fullMercHeal.partial, false);

  // Sarge / Gorum (cost 1500, missingHp = 300):
  // fullChargeCost = Math.trunc((300 * 64) / 1500) = 12
  // hpPerCharge = Math.trunc((1500 * 36) / 256) = 210
  assert.equal(calculateFullHealChargeCost(300, 1500), 12);
  assert.equal(calculateHpPerCharge(1500), 210);
  const fullSargeHeal = calculateCostScaledHeal(300, 12, 1500);
  assert.equal(fullSargeHeal.healedHp, 300);
  assert.equal(fullSargeHeal.chargeAfter, 0);
  assert.equal(fullSargeHeal.partial, false);

  // Scan verifies candidate health reaches maxHealth and healer charge is deducted
  const scan = scanBrowserHealerNeighborhood({
    healerId: 1,
    owner: 0,
    sourceX: 10,
    sourceY: 10,
    charge: HEALER_INITIAL_CHARGE,
    width: 64,
    height: 64,
    unitCosts: dependenciesData,
    candidates: [
      { id: 2, unitType: 0, owner: 0, cellX: 10, cellY: 11, health: 700, maxHealth: 800, movementPlane: "ground" },
      { id: 3, unitType: 4, owner: 0, cellX: 11, cellY: 11, health: 1200, maxHealth: 1500, movementPlane: "ground" },
    ],
  });

  assert.equal(scan.healed.length, 2);
  assert.equal(scan.healed[0].targetId, 2);
  assert.equal(scan.healed[0].healedHp, 100);
  assert.equal(scan.healed[0].newHealth, 800);
  assert.equal(scan.healed[0].chargeAfter, 14);
  assert.equal(scan.healed[0].partial, false);

  assert.equal(scan.healed[1].targetId, 3);
  assert.equal(scan.healed[1].healedHp, 300);
  assert.equal(scan.healed[1].newHealth, 1500);
  assert.equal(scan.healed[1].chargeAfter, 2);
  assert.equal(scan.healed[1].partial, false);

  assert.equal(scan.finalCharge, 2);
  assert.equal(scan.stoppedByLowCharge, true);
});

test("browser healers: partial heal drains charge to 0 and stops scan when charge < 4", () => {
  // Spawned unit without dependency cost uses fallback cost 300:
  // hpPerCharge = Math.trunc((300 * 36) / 256) = 42
  // missingHp = 500 -> fullChargeCost = Math.trunc((500 * 64) / 300) = 106
  // With charge = 6: fullChargeCost (106) > 6 -> partial heal by min(500, max(1, 6 * 42)) = 252 HP, charge = 0
  const partialOutcome = calculateCostScaledHeal(500, 6, 300);
  assert.equal(partialOutcome.fullChargeCost, 106);
  assert.equal(partialOutcome.hpPerCharge, 42);
  assert.equal(partialOutcome.healedHp, 252);
  assert.equal(partialOutcome.chargeAfter, 0);
  assert.equal(partialOutcome.partial, true);

  const scan = scanBrowserHealerNeighborhood({
    healerId: 10,
    owner: 1,
    sourceX: 5,
    sourceY: 5,
    charge: 6,
    width: 32,
    height: 32,
    unitCosts: dependenciesData,
    candidates: [
      // Closest ally (r = 1): Commander type 73 (fallback cost 300), missing 500 HP -> partial heal +252 HP, charge becomes 0
      { id: 11, unitType: 73, owner: 1, cellX: 5, cellY: 6, health: 300, maxHealth: 800, movementPlane: "ground" },
      // Second ally (r = 2): should not be healed because charge dropped to 0 (< 4)
      { id: 12, unitType: 8, owner: 1, cellX: 7, cellY: 5, health: 400, maxHealth: 800, movementPlane: "ground" },
    ],
  });

  assert.equal(scan.healed.length, 1);
  assert.equal(scan.healed[0].targetId, 11);
  assert.equal(scan.healed[0].healedHp, 252);
  assert.equal(scan.healed[0].newHealth, 552);
  assert.equal(scan.healed[0].partial, true);
  assert.equal(scan.finalCharge, 0);
  assert.equal(scan.stoppedByLowCharge, true);
  assert.equal(scan.healthByUnitId.get(12), 400);

  // Starting a scan with charge < 4 performs no healing and stops immediately
  const lowChargeScan = scanBrowserHealerNeighborhood({
    healerId: 10,
    owner: 1,
    sourceX: 5,
    sourceY: 5,
    charge: 3,
    width: 32,
    height: 32,
    unitCosts: dependenciesData,
    candidates: [
      { id: 11, unitType: 8, owner: 1, cellX: 5, cellY: 6, health: 700, maxHealth: 800, movementPlane: "ground" },
    ],
  });
  assert.equal(lowChargeScan.healed.length, 0);
  assert.equal(lowChargeScan.finalCharge, 3);
  assert.equal(lowChargeScan.stoppedByLowCharge, true);
});

test("browser healers: ground (pass 0) and air (pass 1) healing within radius 0..7, filtering invalid candidates", () => {
  const scan = scanBrowserHealerNeighborhood({
    healerId: 100,
    owner: 0,
    sourceX: 10,
    sourceY: 10,
    charge: 32,
    width: 32,
    height: 32,
    unitCosts: dependenciesData,
    candidates: [
      // Self at (10, 10) ground: must be ignored even if damaged
      { id: 100, unitType: 49, owner: 0, cellX: 10, cellY: 10, health: 200, maxHealth: 400, movementPlane: "ground" },
      // Friendly air unit at same cell (10, 10) (r = 0, pass = 1): VTOL (type 5, cost 600), missing 50 HP -> fullChargeCost = trunc(3200/600) = 5
      { id: 101, unitType: 5, owner: 0, cellX: 10, cellY: 10, health: 550, maxHealth: 600, movementPlane: "air" },
      // Same cell (11, 10) (r = 1): both ground (pass 0) and air (pass 1) allies; pass 0 must be healed before pass 1
      { id: 102, unitType: 5, owner: 0, cellX: 11, cellY: 10, health: 540, maxHealth: 600, movementPlane: "air" },
      { id: 103, unitType: 2, owner: 0, cellX: 11, cellY: 10, health: 740, maxHealth: 800, movementPlane: "ground" },
      // Full-health ally at r = 1: must be ignored
      { id: 104, unitType: 0, owner: 0, cellX: 9, cellY: 10, health: 800, maxHealth: 800, movementPlane: "ground" },
      // Enemy unit at r = 1: must be ignored
      { id: 105, unitType: 8, owner: 1, cellX: 10, cellY: 9, health: 500, maxHealth: 800, movementPlane: "ground" },
      // Dead/dying ally at r = 1: must be ignored
      { id: 106, unitType: 0, owner: 0, cellX: 9, cellY: 9, health: 0, maxHealth: 800, movementPlane: "ground" },
      { id: 107, unitType: 0, owner: 0, cellX: 9, cellY: 11, health: 300, maxHealth: 800, activity: "die", movementPlane: "ground" },
      // Friendly unit at max radius boundary r = 7 ((17, 17)): Reaper (type 2, cost 600), missing 60 HP -> fullChargeCost = trunc(3840/600) = 6
      { id: 108, unitType: 2, owner: 0, cellX: 17, cellY: 17, health: 740, maxHealth: 800, movementPlane: "ground" },
      // Friendly unit outside radius at r = 8 ((18, 10)): must be ignored
      { id: 109, unitType: 2, owner: 0, cellX: 18, cellY: 10, health: 500, maxHealth: 800, movementPlane: "ground" },
      // Out-of-bounds unit: must be ignored
      { id: 110, unitType: 2, owner: 0, cellX: -1, cellY: 10, health: 500, maxHealth: 800, movementPlane: "ground" },
    ],
  });

  // Expected heal order:
  // 1) id 101 at r=0 (10,10) pass=1 (air), charge 32 -> 27
  // 2) id 103 at r=1 (11,10) pass=0 (ground), missing 60, cost 600 -> fullChargeCost = 6, charge 27 -> 21
  // 3) id 102 at r=1 (11,10) pass=1 (air), missing 60, cost 600 -> fullChargeCost = 6, charge 21 -> 15
  // 4) id 108 at r=7 (17,17) pass=0 (ground), missing 60, cost 600 -> fullChargeCost = 6, charge 15 -> 9
  assert.deepEqual(
    scan.healed.map((event) => ({
      targetId: event.targetId,
      radius: event.radius,
      pass: event.pass,
      plane: event.plane,
      healedHp: event.healedHp,
      newHealth: event.newHealth,
      chargeAfter: event.chargeAfter,
    })),
    [
      { targetId: 101, radius: 0, pass: 1, plane: "air", healedHp: 50, newHealth: 600, chargeAfter: 27 },
      { targetId: 103, radius: 1, pass: 0, plane: "ground", healedHp: 60, newHealth: 800, chargeAfter: 21 },
      { targetId: 102, radius: 1, pass: 1, plane: "air", healedHp: 60, newHealth: 600, chargeAfter: 15 },
      { targetId: 108, radius: 7, pass: 0, plane: "ground", healedHp: 60, newHealth: 800, chargeAfter: 9 },
    ],
  );
  assert.equal(scan.finalCharge, 9);
  assert.equal(scan.stoppedByLowCharge, false);
  assert.equal(scan.healthByUnitId.get(100), 200);
  assert.equal(scan.healthByUnitId.get(105), 500);
  assert.equal(scan.healthByUnitId.get(109), 500);
});

test("browser healers: 0x416640 deploy-eligibility Manhattan range check and idle recharge", () => {
  assert.equal(HEALER_MAX_CHARGE, 32);
  assert.equal(HEALER_MIN_CHARGE, 4);
  assert.equal(HEALER_SCAN_RADIUS, 7);
  assert.equal(HEALER_DEPLOY_MANHATTAN_LIMIT, 7);

  assert.equal(canHealerHeal(3), false);
  assert.equal(canHealerHeal(4), true);
  assert.equal(rechargeHealer(10), 11);
  assert.equal(rechargeHealer(32), 32);

  // Manhattan distance < 7 (0..6) is eligible; >= 7 is ineligible
  assert.equal(isWithinHealerDeployRange(10, 10, 10, 10), true);
  assert.equal(isWithinHealerDeployRange(10, 10, 13, 13), true); // |3| + |3| = 6 < 7
  assert.equal(isWithinHealerDeployRange(10, 10, 14, 13), false); // |4| + |3| = 7
  assert.equal(isWithinHealerDeployRange(10, 10, 17, 10), false); // |7| + |0| = 7
  assert.equal(isWithinHealerScanRadius(10, 10, 17, 17), true); // Chebyshev 7 <= 7
  assert.equal(isWithinHealerScanRadius(10, 10, 18, 17), false);

  assert.equal(
    canHealerDeployAt({
      healerId: 1,
      owner: 0,
      sourceX: 10,
      sourceY: 10,
      charge: 4,
      candidates: [{ id: 2, owner: 0, cellX: 13, cellY: 13, health: 700, maxHealth: 800 }],
    }),
    true,
  );
  assert.equal(
    canHealerDeployAt({
      healerId: 1,
      owner: 0,
      sourceX: 10,
      sourceY: 10,
      charge: 4,
      candidates: [{ id: 2, owner: 0, cellX: 14, cellY: 13, health: 700, maxHealth: 800 }],
    }),
    false,
  );
  assert.equal(
    canHealerDeployAt({
      healerId: 1,
      owner: 0,
      sourceX: 10,
      sourceY: 10,
      charge: 3,
      candidates: [{ id: 2, owner: 0, cellX: 10, cellY: 11, health: 700, maxHealth: 800 }],
    }),
    false,
  );

  // Idle step recharges +1 up to 32 when no healing occurs
  const idleStep = stepBrowserHealer({
    healerId: 1,
    owner: 0,
    sourceX: 10,
    sourceY: 10,
    charge: 20,
    candidates: [{ id: 2, owner: 0, cellX: 10, cellY: 11, health: 800, maxHealth: 800 }],
  });
  assert.equal(idleStep.healed.length, 0);
  assert.equal(idleStep.finalCharge, 21);
  assert.equal(idleStep.recharged, true);
});

test("browser healers: Simulation integration heals nearby injured friendly units over ticks and recharges", () => {
  const withoutHealer = new DeterministicSimulation(new NavigationGrid(16, 16));
  withoutHealer.addUnit({ faction: "human", team: 0, cell: { x: 4, y: 4 }, health: 500, maxHealth: 800 });
  assert.equal("browserHealers" in withoutHealer.checkpoint(), false);

  const simulation = new DeterministicSimulation(new NavigationGrid(16, 16));
  const beonId = simulation.addUnit({
    faction: "human",
    team: 0,
    cell: { x: 5, y: 5 },
    unitType: 49,
    sprite: "BEON",
    maxHealth: 400,
    healerCharge: 4,
  });
  const injuredAllyId = simulation.addUnit({
    faction: "human",
    team: 0,
    cell: { x: 6, y: 5 },
    unitType: 0, // Mercenary cost 350 -> hpPerCharge = 49, fullChargeCost(400, 350) = 73
    health: 400,
    maxHealth: 800,
  });
  const enemyId = simulation.addUnit({
    faction: "alien",
    team: 1,
    cell: { x: 5, y: 6 },
    unitType: 8,
    health: 400,
    maxHealth: 800,
  });

  assert.equal(simulation.browserHealerState(beonId)?.charge, 4);

  // Tick 1: BEON has charge = 4 >= 4 -> partial heal of 4 * 49 = 196 HP (400 -> 596), charge drains to 0
  simulation.advance();
  assert.equal(simulation.snapshot.units.find((u) => u.id === injuredAllyId)?.health, 596);
  assert.equal(simulation.snapshot.units.find((u) => u.id === enemyId)?.health, 400);
  assert.equal(simulation.browserHealerState(beonId)?.charge, 0);
  assert.equal(simulation.healerEvents.length, 1);

  // Ticks 2..5: BEON recharges +1 per tick while charge < 4 (0 -> 1 -> 2 -> 3 -> 4)
  for (let i = 1; i <= 4; i += 1) {
    simulation.advance();
    assert.equal(simulation.browserHealerState(beonId)?.charge, i);
    assert.equal(simulation.snapshot.units.find((u) => u.id === injuredAllyId)?.health, 596);
  }

  // Checkpoint/restore round-trip with active healer state
  const restored = DeterministicSimulation.restore(simulation.checkpoint());
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());

  // Tick 6: BEON has charge = 4 >= 4 -> partial heal of 4 * 49 = 196 HP (596 -> 792), charge drains to 0
  restored.advance();
  assert.equal(restored.snapshot.units.find((u) => u.id === injuredAllyId)?.health, 792);
  assert.equal(restored.browserHealerState(beonId)?.charge, 0);

  // Advance until ally is fully healed (800/800) and BEON recharges back to 32
  for (let tick = 0; tick < 40; tick += 1) {
    restored.advance();
  }
  assert.equal(restored.snapshot.units.find((u) => u.id === injuredAllyId)?.health, 800);
  assert.equal(restored.snapshot.units.find((u) => u.id === enemyId)?.health, 400);
  assert.equal(restored.browserHealerState(beonId)?.charge, 32);
});

