import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legacyCueCatalog } from "../../src/audio/legacy-cues";
import {
  ALIEN_DEPLOYED_HARVESTER_UNIT_TYPE,
  ALIEN_DEPLOYED_MINE_UNIT_TYPE,
  ALIEN_DEPLOYED_PSYC_UNIT_TYPE,
  ALIEN_DEPLOYED_TURRET_UNIT_TYPE,
  ALIEN_MOBILE_HARVESTER_UNIT_TYPE,
  ALIEN_MOBILE_MINE_UNIT_TYPE,
  ALIEN_MOBILE_TURRET_UNIT_TYPE,
  ALIEN_PSYC_UNIT_TYPE,
  ALIEN_TURRET_WEAPON_IDS,
  applyMineChargeDetonation,
  browserDeployedMineOptions,
  browserDeployedTurretOptions,
  browserMobileDeploymentUnitOptions,
  browserTurretDefenseOptions,
  browserTurretWeaponOptions,
  canDeployMineAtCell,
  canStartTask13Deployment,
  COLONY_DEPLOY_MANHATTAN_LIMIT,
  completeTask13Deployment,
  deductMineChargeHp,
  DEPLOYED_HARVESTER_UNIT_TYPES,
  DEPLOYED_MINE_UNIT_TYPES,
  DEPLOYED_TURRET_UNIT_TYPES,
  DEPLOYMENT_FIN_BANK_ADDRESS,
  DEPLOYMENT_INITIAL_COUNTDOWN_TICKS,
  DEPLOYMENT_SOUND_EVENT,
  DEPLOYMENT_SOUND_GROUP,
  DEPLOYMENT_TASK_ID,
  EMPTY_MINE_CELL_SLOT,
  evaluateTask13DeploymentEligibility,
  getTask13DeploymentProfile,
  hasEnemyColonyWithinDeployRange,
  hasTeamSurvivingUnits,
  HUMAN_DEPLOYED_HARVESTER_UNIT_TYPE,
  HUMAN_DEPLOYED_MINE_UNIT_TYPE,
  HUMAN_DEPLOYED_SARGE_UNIT_TYPE,
  HUMAN_DEPLOYED_TURRET_UNIT_TYPE,
  HUMAN_MOBILE_HARVESTER_UNIT_TYPE,
  HUMAN_MOBILE_MINE_UNIT_TYPE,
  HUMAN_MOBILE_TURRET_UNIT_TYPE,
  HUMAN_SARGE_UNIT_TYPE,
  HUMAN_TURRET_WEAPON_IDS,
  isDeployedHarvesterUnitType,
  isDeployedMineUnitType,
  isDeployedTurretUnitType,
  isMineCellSlotEmpty,
  isMobileMineUnitType,
  isMobileTurretUnitType,
  isReversibleDeploymentUnitType,
  isStealthDeployUnitType,
  isTask13DeployableUnitType,
  isTeamSurvivalEligibleUnitType,
  isWithinEnemyColonyDeployRange,
  MINE_CHARGE_HP_DEDUCTION,
  MINE_IDEAL_CHARGE_POOL_HP,
  MINE_MAX_CHARGES,
  MINE_MIN_CHARGE_HIT_HP,
  MINE_WEAPON_ID,
  MOBILE_MINE_UNIT_TYPES,
  MOBILE_TURRET_UNIT_TYPES,
  resolveMineChargesFromHp,
  resolveTask13TargetUnitType,
  simulateMineChargeLifecycle,
  STAND_FIN_BANK_ADDRESS,
  startTask13Deployment,
  STEALTH_DEPLOYED_UNIT_TYPES,
  STEALTH_MOBILE_UNIT_TYPES,
  stepTask13Deployment,
  TASK_13_DEPLOYMENT_PROFILES,
  TASK_13_ID,
  TASK_13_SOURCE_UNIT_TYPES,
  TEAM_SURVIVAL_EXCLUDED_UNIT_TYPES,
  validateBrowserDeployedMineOptions,
  validateBrowserDeployedTurretOptions,
  writeMineCellSlotWord,
} from "../../src/engine/browser-deployment";
import { NavigationGrid } from "../../src/engine/grid";
import {
  defenseOptionsFromLegacy,
  unitOptionsFromLegacy,
  type LegacyDamageMatrix,
  type LegacyUnitStat,
  type LegacyWeaponStat,
} from "../../src/engine/legacy-balance";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { createBrowserCampaignAiConfiguration } from "../../src/engine/browser-campaign-ai";
import { createBrowserCampaignEconomyProfile } from "../../src/engine/browser-campaign-economy-source";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseScenario } from "../extractors/data/scenario";

interface GeneratedUnitsJson {
  readonly schemaVersion: number;
  readonly records: readonly LegacyUnitStat[];
}

interface GeneratedWeaponsJson {
  readonly schemaVersion: number;
  readonly records: readonly LegacyWeaponStat[];
}

interface GeneratedDamageMatrixJson {
  readonly schemaVersion: number;
  readonly percentages: readonly (readonly number[])[];
  readonly coefficients: LegacyDamageMatrix;
}

const unitsData = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/units.json", import.meta.url), "utf8"),
) as GeneratedUnitsJson;

const weaponsData = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/weapons.json", import.meta.url), "utf8"),
) as GeneratedWeaponsJson;

const damageMatrixData = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/damage-matrix.json", import.meta.url), "utf8"),
) as GeneratedDamageMatrixJson;

const dataSources = {
  runtimeProfile: "browser-adapted" as const,
  units: unitsData,
  weapons: weaponsData,
  damageMatrix: damageMatrixData,
};

test("Task-13 (0x417CF4..0x417D73): all deployment conversions match GAMESTAT/WEAPSTAT and SLIST DPY bindings", () => {
  assert.equal(TASK_13_ID, 13);
  assert.equal(DEPLOYMENT_TASK_ID, 13);
  assert.equal(DEPLOYMENT_INITIAL_COUNTDOWN_TICKS, 50);
  assert.equal(DEPLOYMENT_SOUND_EVENT, 5);
  assert.equal(DEPLOYMENT_SOUND_GROUP, "DPY");
  assert.equal(DEPLOYMENT_FIN_BANK_ADDRESS, 0x4f1914);
  assert.equal(STAND_FIN_BANK_ADDRESS, 0x4f1900);

  assert.deepEqual(MOBILE_TURRET_UNIT_TYPES, [1, 9]);
  assert.deepEqual(DEPLOYED_TURRET_UNIT_TYPES, [41, 42]);
  assert.deepEqual(MOBILE_MINE_UNIT_TYPES, [43, 44]);
  assert.deepEqual(DEPLOYED_MINE_UNIT_TYPES, [45, 46]);
  assert.deepEqual(STEALTH_MOBILE_UNIT_TYPES, [4, 12]);
  assert.deepEqual(STEALTH_DEPLOYED_UNIT_TYPES, [77, 78]);
  assert.deepEqual(DEPLOYED_HARVESTER_UNIT_TYPES, [47, 48]);
  assert.deepEqual(TASK_13_SOURCE_UNIT_TYPES, [1, 9, 43, 44, 4, 12, 77, 78, 47, 48]);

  // 1) 1 (TURR) -> 41 (T), one-way turret deployment
  const turr = getTask13DeploymentProfile(HUMAN_MOBILE_TURRET_UNIT_TYPE)!;
  assert.equal(turr.sourceType, 1);
  assert.equal(turr.targetType, HUMAN_DEPLOYED_TURRET_UNIT_TYPE);
  assert.equal(turr.sourceSprite, "TURR");
  assert.equal(turr.targetSprite, "T");
  assert.equal(turr.faction, 0);
  assert.equal(turr.category, "turret");
  assert.equal(turr.direction, "deploy");
  assert.equal(turr.reversible, false);
  assert.equal(turr.oneWay, true);
  assert.equal(turr.reverseType, null);
  assert.deepEqual(turr.sourceWeapons, [-1, -1, -1]);
  assert.deepEqual(turr.targetWeapons, [34, 35, 36]);
  assert.equal(getTask13DeploymentProfile(41), null);

  // 2) 9 (XENO) -> 42 (XDEPLOY), one-way turret deployment
  const xeno = getTask13DeploymentProfile(ALIEN_MOBILE_TURRET_UNIT_TYPE)!;
  assert.equal(xeno.sourceType, 9);
  assert.equal(xeno.targetType, ALIEN_DEPLOYED_TURRET_UNIT_TYPE);
  assert.equal(xeno.sourceSprite, "XENO");
  assert.equal(xeno.targetSprite, "XDEPLOY");
  assert.equal(xeno.faction, 1);
  assert.equal(xeno.category, "turret");
  assert.equal(xeno.direction, "deploy");
  assert.equal(xeno.reversible, false);
  assert.equal(xeno.oneWay, true);
  assert.equal(xeno.reverseType, null);
  assert.deepEqual(xeno.sourceWeapons, [-1, -1, -1]);
  assert.deepEqual(xeno.targetWeapons, [40, 41, 42]);
  assert.equal(getTask13DeploymentProfile(42), null);

  // 3) 43 (ENGI, 0x2B) -> 45 (HMINE, 0x2D), one-way mine deployment
  const engi = getTask13DeploymentProfile(HUMAN_MOBILE_MINE_UNIT_TYPE)!;
  assert.equal(engi.sourceType, 0x2b);
  assert.equal(engi.targetType, 0x2d);
  assert.equal(engi.targetType, HUMAN_DEPLOYED_MINE_UNIT_TYPE);
  assert.equal(engi.sourceSprite, "ENGI");
  assert.equal(engi.targetSprite, "HMINE");
  assert.equal(engi.faction, 0);
  assert.equal(engi.category, "mine");
  assert.equal(engi.reversible, false);
  assert.equal(engi.requiresEmptyMineCell, true);
  assert.deepEqual(engi.targetWeapons, [38, 38, 38]);
  assert.equal(getTask13DeploymentProfile(45), null);

  // 4) 44 (SLOM, 0x2C) -> 46 (HMINE, 0x2E), one-way mine deployment
  const slom = getTask13DeploymentProfile(ALIEN_MOBILE_MINE_UNIT_TYPE)!;
  assert.equal(slom.sourceType, 0x2c);
  assert.equal(slom.targetType, 0x2e);
  assert.equal(slom.targetType, ALIEN_DEPLOYED_MINE_UNIT_TYPE);
  assert.equal(slom.sourceSprite, "SLOM");
  assert.equal(slom.targetSprite, "HMINE");
  assert.equal(slom.faction, 1);
  assert.equal(slom.category, "mine");
  assert.equal(slom.reversible, false);
  assert.equal(slom.requiresEmptyMineCell, true);
  assert.deepEqual(slom.targetWeapons, [38, 38, 38]);
  assert.equal(getTask13DeploymentProfile(46), null);

  // 5) 4 (SARG) <-> 77 (SARGSTL), reversible stealth deployment with < 7 colony Manhattan gate on deploy
  const sarg = getTask13DeploymentProfile(HUMAN_SARGE_UNIT_TYPE)!;
  const sargStl = getTask13DeploymentProfile(HUMAN_DEPLOYED_SARGE_UNIT_TYPE)!;
  assert.equal(sarg.targetType, 77);
  assert.equal(sarg.reversible, true);
  assert.equal(sarg.reverseType, 77);
  assert.equal(sarg.requiresEnemyColonyProximity, true);
  assert.equal(sarg.enemyColonyManhattanLimit, 7);
  assert.equal(sargStl.targetType, 4);
  assert.equal(sargStl.direction, "undeploy");
  assert.equal(sargStl.reversible, true);
  assert.equal(sargStl.reverseType, 4);
  assert.equal(sargStl.requiresEnemyColonyProximity, false);

  // 6) 12 (PSYC) <-> 78 (PSYCSTL), reversible stealth deployment with < 7 colony Manhattan gate on deploy
  const psyc = getTask13DeploymentProfile(ALIEN_PSYC_UNIT_TYPE)!;
  const psycStl = getTask13DeploymentProfile(ALIEN_DEPLOYED_PSYC_UNIT_TYPE)!;
  assert.equal(psyc.targetType, 78);
  assert.equal(psyc.reversible, true);
  assert.equal(psyc.reverseType, 78);
  assert.equal(psyc.requiresEnemyColonyProximity, true);
  assert.equal(psyc.enemyColonyManhattanLimit, 7);
  assert.equal(psycStl.targetType, 12);
  assert.equal(psycStl.direction, "undeploy");
  assert.equal(psycStl.reversible, true);
  assert.equal(psycStl.reverseType, 12);
  assert.equal(psycStl.requiresEnemyColonyProximity, false);

  // 7) 47 (EDPLY) -> 6 (EXPL) and 48 (SDPL) -> 14 (SLUG)
  const edply = getTask13DeploymentProfile(HUMAN_DEPLOYED_HARVESTER_UNIT_TYPE)!;
  const sdpl = getTask13DeploymentProfile(ALIEN_DEPLOYED_HARVESTER_UNIT_TYPE)!;
  assert.equal(edply.targetType, HUMAN_MOBILE_HARVESTER_UNIT_TYPE);
  assert.equal(edply.sourceSprite, "EDPLY");
  assert.equal(edply.targetSprite, "EXPL");
  assert.equal(edply.direction, "undeploy");
  assert.equal(sdpl.targetType, ALIEN_MOBILE_HARVESTER_UNIT_TYPE);
  assert.equal(sdpl.sourceSprite, "SDPL");
  assert.equal(sdpl.targetSprite, "SLUG");
  assert.equal(sdpl.direction, "undeploy");

  // Cross-check every profile against units.json
  for (const sourceType of TASK_13_SOURCE_UNIT_TYPES) {
    const profile = TASK_13_DEPLOYMENT_PROFILES[sourceType];
    const sourceUnit = unitsData.records.find((u) => u.index === profile.sourceType)!;
    const targetUnit = unitsData.records.find((u) => u.index === profile.targetType)!;
    assert.ok(sourceUnit, `Expected unit ${profile.sourceType} in units.json`);
    assert.ok(targetUnit, `Expected unit ${profile.targetType} in units.json`);
    assert.equal(sourceUnit.sprite, profile.sourceSprite);
    assert.equal(targetUnit.sprite, profile.targetSprite);
    assert.equal(sourceUnit.faction, profile.faction);
    assert.equal(targetUnit.faction, profile.faction);
    assert.deepEqual(sourceUnit.weapons, profile.sourceWeapons);
    assert.deepEqual(targetUnit.weapons, profile.targetWeapons);
    assert.equal(resolveTask13TargetUnitType(sourceType), profile.targetType);
    assert.equal(isTask13DeployableUnitType(sourceType), true);
    assert.equal(isReversibleDeploymentUnitType(sourceType), profile.reversible);
  }

  // Verify SLIST.DAT DPY sound bindings exist for deploying mobile units (1, 9, 43, 44, 4, 12, 6, 14)
  for (const dpyUnitType of [1, 9, 43, 44, 4, 12, 6, 14]) {
    const binding = legacyCueCatalog.bindings.find((b) => b.group === "DPY" && b.id === dpyUnitType);
    assert.ok(binding && binding.soundIds.length > 0, `Expected DPY sound binding for unit type ${dpyUnitType}`);
  }

  assert.equal(isMobileTurretUnitType(1), true);
  assert.equal(isMobileTurretUnitType(9), true);
  assert.equal(isMobileTurretUnitType(41), false);
  assert.equal(isDeployedTurretUnitType(41), true);
  assert.equal(isDeployedTurretUnitType(42), true);
  assert.equal(isMobileMineUnitType(43), true);
  assert.equal(isMobileMineUnitType(44), true);
  assert.equal(isDeployedMineUnitType(45), true);
  assert.equal(isDeployedMineUnitType(46), true);
  assert.equal(isStealthDeployUnitType(4), true);
  assert.equal(isStealthDeployUnitType(77), true);
  assert.equal(isStealthDeployUnitType(12), true);
  assert.equal(isStealthDeployUnitType(78), true);
  assert.equal(isDeployedHarvesterUnitType(47), true);
  assert.equal(isDeployedHarvesterUnitType(48), true);
});

test("Task-13 start, 50-tick countdown (0x416784..0x41694D), 0x416640 colony proximity, and 0x41686C mine cell occupancy", () => {
  // 0x416640 Manhattan distance < 7 (0..6) check
  assert.equal(COLONY_DEPLOY_MANHATTAN_LIMIT, 7);
  assert.equal(isWithinEnemyColonyDeployRange(20, 20, 20, 20), true); // distance 0
  assert.equal(isWithinEnemyColonyDeployRange(20, 20, 23, 23), true); // |3| + |3| = 6 < 7
  assert.equal(isWithinEnemyColonyDeployRange(20, 20, 26, 20), true); // |6| + |0| = 6 < 7
  assert.equal(isWithinEnemyColonyDeployRange(20, 20, 24, 23), false); // |4| + |3| = 7
  assert.equal(isWithinEnemyColonyDeployRange(20, 20, 27, 20), false); // |7| + |0| = 7

  // SARG (4) and PSYC (12) require Manhattan distance < 7 to an enemy colony when deploying
  assert.equal(
    canStartTask13Deployment({
      unitType: 4,
      team: 0,
      cellX: 20,
      cellY: 20,
      enemyColonies: [{ team: 1, x: 23, y: 23 }], // distance 6 < 7
    }),
    true,
  );
  assert.equal(
    canStartTask13Deployment({
      unitType: 4,
      team: 0,
      cellX: 20,
      cellY: 20,
      enemyColonies: [{ team: 1, x: 24, y: 23 }], // distance 7 >= 7
    }),
    false,
  );
  assert.equal(
    evaluateTask13DeploymentEligibility({
      unitType: 12,
      team: 1,
      cellX: 10,
      cellY: 10,
      enemyColonies: [{ team: 0, x: 15, y: 12 }], // distance 7 >= 7
    }).reason,
    "enemy-colony-out-of-range",
  );
  // Friendly colony within < 7 does not satisfy enemy colony requirement
  assert.equal(
    hasEnemyColonyWithinDeployRange({
      unitX: 10,
      unitY: 10,
      unitTeam: 0,
      colonies: [{ team: 0, x: 11, y: 11 }],
    }),
    false,
  );
  // Undeploying SARGSTL (77) and PSYCSTL (78) is reversible without colony proximity requirement
  assert.equal(
    canStartTask13Deployment({
      unitType: 77,
      team: 0,
      cellX: 50,
      cellY: 50,
      enemyColonies: [],
    }),
    true,
  );
  assert.equal(
    canStartTask13Deployment({
      unitType: 78,
      team: 1,
      cellX: 50,
      cellY: 50,
      enemyColonies: [],
    }),
    true,
  );

  // Mine cell-occupancy gate (0x41686C..0x4168BA): 0x3FF is empty, any slot 0..799 blocks ENGI (43) / SLOM (44)
  assert.equal(EMPTY_MINE_CELL_SLOT, 0x3ff);
  assert.equal(isMineCellSlotEmpty(0x3ff), true);
  assert.equal(isMineCellSlotEmpty(0xfbff), true); // high flags set, low 10 bits = 0x3FF
  assert.equal(isMineCellSlotEmpty(153), false);
  assert.equal(isMineCellSlotEmpty(0), false);

  assert.equal(canDeployMineAtCell({ cellX: 8, cellY: 9, mineCellWord: 0x3ff }), true);
  assert.equal(canDeployMineAtCell({ cellX: 8, cellY: 9, mineCellWord: 200 }), false);
  assert.equal(
    canDeployMineAtCell({
      cellX: 8,
      cellY: 9,
      staticTargets: [{ id: 10, cellX: 8, cellY: 9, health: 800, mine: { sourceTypeIndex: 45 } }],
    }),
    false,
  );
  // Dead mine on the cell (health: 0) does not block deployment
  assert.equal(
    canDeployMineAtCell({
      cellX: 8,
      cellY: 9,
      staticTargets: [{ id: 10, cellX: 8, cellY: 9, health: 0, mine: { sourceTypeIndex: 45 } }],
    }),
    true,
  );

  assert.equal(
    evaluateTask13DeploymentEligibility({
      unitType: 43,
      cellX: 8,
      cellY: 9,
      mineCellWord: 155,
    }).reason,
    "mine-cell-occupied",
  );
  assert.equal(
    canStartTask13Deployment({
      unitType: 44,
      cellX: 8,
      cellY: 9,
      mineCellWord: 0x3ff,
    }),
    true,
  );

  // 0x417D93..0x417DC5 mine/object plane slot write preserves upper 6 bits (0xFC00) and writes low 10-bit slot
  const updatedWord = writeMineCellSlotWord(0xa400 | 0x3ff, 172);
  assert.equal(updatedWord & 0xfc00, 0xa400);
  assert.equal(updatedWord & 0x3ff, 172);

  // Start Task-13 deployment and step through the 50-tick countdown (0x32 at 0x416943)
  const started = startTask13Deployment({
    unitId: 7,
    slot: 180,
    unitType: 43,
    team: 0,
    localTeam: 0,
    cellX: 12,
    cellY: 15,
    mineCellWord: 0x3ff,
  });
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error("Expected deployment start to succeed");
  assert.equal(started.state.taskId, 13);
  assert.equal(started.state.countdownTicks, 50);
  assert.equal(started.state.initialCountdownTicks, 50);
  assert.equal(started.state.soundEvent, 5);
  assert.equal(started.state.soundGroup, "DPY");
  assert.equal(started.state.soundTriggered, true);
  assert.equal(started.state.finBankAddress, 0x4f1914);
  assert.equal(started.state.animationMode, 1);
  assert.equal(started.state.completed, false);

  let current = started.state;
  for (let tick = 1; tick < 50; tick += 1) {
    current = stepTask13Deployment(current);
    assert.equal(current.countdownTicks, 50 - tick);
    assert.equal(current.completed, false);
  }
  current = stepTask13Deployment(current);
  assert.equal(current.countdownTicks, 0);
  assert.equal(current.elapsedTicks, 50);
  assert.equal(current.animationMode, 2);
  assert.equal(current.completed, true);

  const completed = completeTask13Deployment(current, { previousMineCellWord: 0x3ff });
  assert.equal(completed.sourceType, 43);
  assert.equal(completed.targetType, 45);
  assert.equal(completed.targetSprite, "HMINE");
  assert.equal(completed.targetIsStatic, true);
  assert.equal(completed.removesMobileFromGroundPlane, true);
  assert.equal(completed.writesMineObjectPlane, true);
  assert.equal(completed.minePlaneWord, 180);
  assert.equal(completed.standFinBankAddress, 0x4f1900);
  assert.equal(completed.animationMode, 0);
  assert.equal(completed.taskPopped, true);
});

test("Deployed turret resolution: 41 (T) and 42 (XDEPLOY) weapon levels 0..2 and armor levels 0..2 from generated data", () => {
  const expectedDamages = [100, 125, 150] as const;
  const expectedArmorFactors = [256, 204, 170] as const;
  const expectedClass5Row = damageMatrixData.coefficients[5];
  assert.deepEqual(expectedClass5Row, [256, 84, 128, 84, 168, 204, 84, 128, 0, 84]);

  for (const [mobileType, deployedType, sprite, faction, weaponIds, daySight, nightSight] of [
    [1, 41, "T", "human", HUMAN_TURRET_WEAPON_IDS, 9, 5] as const,
    [9, 42, "XDEPLOY", "alien", ALIEN_TURRET_WEAPON_IDS, 5, 9] as const,
  ]) {
    for (const weaponLevel of [0, 1, 2] as const) {
      for (const armorLevel of [0, 1, 2] as const) {
        // Resolve from either mobile type (1/9) or deployed type (41/42)
        const fromDeployed = browserDeployedTurretOptions(dataSources, deployedType, {
          weaponLevel,
          armorLevel,
          cell: { x: 6, y: 7 },
          team: faction === "human" ? 0 : 1,
        });
        const fromMobile = browserDeployedTurretOptions(dataSources, mobileType, {
          weaponLevel,
          armorLevel,
          cell: { x: 6, y: 7 },
          team: faction === "human" ? 0 : 1,
        });
        assert.deepEqual(fromMobile, fromDeployed);

        assert.equal(fromDeployed.sourceTypeIndex, deployedType);
        assert.equal(fromDeployed.mobileUnitType, mobileType);
        assert.equal(fromDeployed.sprite, sprite);
        assert.equal(fromDeployed.faction, faction);
        assert.equal(fromDeployed.weaponId, weaponIds[weaponLevel]);
        assert.equal(fromDeployed.maxHealth, 800);
        assert.equal(fromDeployed.health, 800);
        assert.deepEqual(fromDeployed.vision, { dayRangeCells: daySight, nightRangeCells: nightSight });
        assert.deepEqual(fromDeployed.footprint, [{ x: 6, y: 7 }]);

        assert.equal(fromDeployed.weapon.damage, expectedDamages[weaponLevel]);
        assert.equal(fromDeployed.weapon.rangeCells, 6);
        assert.equal(fromDeployed.weapon.cooldownTicks, 15);
        assert.equal(fromDeployed.weapon.projectileSpeed, 60);
        assert.equal(fromDeployed.weapon.weaponId, weaponIds[weaponLevel]);
        assert.equal(fromDeployed.weapon.splash, 0);
        assert.deepEqual(fromDeployed.weapon.sourceDamage.coefficients, expectedClass5Row);
        assert.equal(fromDeployed.weapon.sourceDamage.callerFactor, 256);
        assert.equal(fromDeployed.weapon.sourceDamage.specialFlag, false);

        const unitStat = unitsData.records.find((u) => u.index === deployedType)!;
        const legacyDefense = defenseOptionsFromLegacy(unitStat, armorLevel);
        assert.equal(fromDeployed.sourceDefense.targetClass, 6);
        assert.equal(fromDeployed.sourceDefense.armorFactor, expectedArmorFactors[armorLevel]);
        assert.equal(fromDeployed.sourceDefense.armorFactor, legacyDefense.armorFactor);
        assert.equal(fromDeployed.sourceDefense.sourceTypeIndex, deployedType);

        validateBrowserDeployedTurretOptions(fromDeployed);
      }
    }
  }

  // Verify deployed turret options can be admitted directly into DeterministicSimulation.addStaticTarget
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 16));
  const humanTurret = browserDeployedTurretOptions(dataSources, 1, {
    weaponLevel: 2,
    armorLevel: 1,
    cell: { x: 5, y: 5 },
    team: 0,
  });
  const turretId = simulation.addStaticTarget({
    faction: humanTurret.faction,
    team: humanTurret.team,
    cell: humanTurret.cell!,
    maxHealth: humanTurret.maxHealth,
    health: humanTurret.health,
    footprint: humanTurret.footprint,
    weapon: humanTurret.weapon,
    vision: humanTurret.vision,
    sourceDefense: humanTurret.sourceDefense,
  });
  const snapshotTurret = simulation.snapshot.staticTargets.find((t) => t.id === turretId)!;
  const checkpointTurret = simulation.checkpoint().staticTargets.find((t) => t.id === turretId)!;
  assert.equal(snapshotTurret.weapon?.damage, 150);
  assert.equal(snapshotTurret.weapon?.weaponId, 36);
  assert.equal(checkpointTurret.sourceDefense?.armorFactor, 204);
  assert.equal(checkpointTurret.sourceDefense?.targetClass, 6);
  assert.equal(simulation.grid.isPassable(5, 5), false);

  // Verify reversible/undeployed mobile targets (4, 12, 6, 14) match unitOptionsFromLegacy
  for (const mobileType of [4, 12, 6, 14] as const) {
    const stat = unitsData.records.find((u) => u.index === mobileType)!;
    const built = browserMobileDeploymentUnitOptions(dataSources, mobileType, { weaponLevel: 1, armorLevel: 2 });
    const expected = unitOptionsFromLegacy(stat, weaponsData.records, 1, {
      matrix: damageMatrixData.coefficients,
      armorLevel: 2,
      callerFactor: 256,
      specialFlag: false,
    });
    assert.deepEqual(built.weapon, expected.weapon);
    assert.deepEqual(built.sourceDefense, expected.sourceDefense);
    assert.equal(built.speedSubcellsPerTick, expected.speedSubcellsPerTick);
  }

  assert.throws(() => browserTurretWeaponOptions(dataSources, 45, 0));
  assert.throws(() => browserTurretWeaponOptions(dataSources, 41, 3));
  assert.throws(() => browserTurretDefenseOptions(dataSources, 41, 3));
});

test("Deployed mine resolution & 0x41310F 3-charge mine HP deduction (HP -= 300, clamp to 1, 3 charges)", () => {
  assert.equal(MINE_MAX_CHARGES, 3);
  assert.equal(MINE_CHARGE_HP_DEDUCTION, 300);
  assert.equal(MINE_MIN_CHARGE_HIT_HP, 1);
  assert.equal(MINE_IDEAL_CHARGE_POOL_HP, 900);
  assert.equal(MINE_WEAPON_ID, 38);

  const expectedMineArmorFactors = [256, 213, 182] as const;
  for (const [mobileType, deployedType, faction] of [
    [43, 45, "human"] as const,
    [44, 46, "alien"] as const,
  ]) {
    for (const armorLevel of [0, 1, 2] as const) {
      const fromMobile = browserDeployedMineOptions(dataSources, mobileType, {
        armorLevel,
        cell: { x: 4, y: 4 },
        team: faction === "human" ? 0 : 1,
      });
      const fromDeployed = browserDeployedMineOptions(dataSources, deployedType, {
        armorLevel,
        cell: { x: 4, y: 4 },
        team: faction === "human" ? 0 : 1,
      });
      assert.deepEqual(fromMobile, fromDeployed);
      assert.equal(fromDeployed.sourceTypeIndex, deployedType);
      assert.equal(fromDeployed.mobileUnitType, mobileType);
      assert.equal(fromDeployed.sprite, "HMINE");
      assert.equal(fromDeployed.faction, faction);
      assert.equal(fromDeployed.weaponId, 38);
      assert.equal(fromDeployed.maxCharges, 3);
      assert.equal(fromDeployed.chargesRemaining, 3);
      assert.equal(fromDeployed.chargeHpDeduction, 300);
      assert.equal(fromDeployed.minChargeHitHp, 1);
      assert.deepEqual(fromDeployed.footprint, []);
      assert.equal(fromDeployed.sourceDefense.targetClass, 7);
      assert.equal(fromDeployed.sourceDefense.armorFactor, expectedMineArmorFactors[armorLevel]);
      assert.equal(fromDeployed.mine.weaponId, 38);
      assert.equal(fromDeployed.mine.boomId, 2);
      assert.equal(fromDeployed.mine.weapon.damage, 1300);
      assert.equal(fromDeployed.mine.triggerRange, 1);
      assert.equal(fromDeployed.mine.splashRange, 3);
      validateBrowserDeployedMineOptions(fromDeployed);
    }
  }

  // Raw 0x41310F pre-hit clamping: sub eax, 12Ch (300); if <= 0, mov eax, 1
  assert.equal(deductMineChargeHp(900, 45), 600);
  assert.equal(deductMineChargeHp(600, 45), 300);
  assert.equal(deductMineChargeHp(300, 45), 1); // 300 - 300 = 0 <= 0 -> clamped to 1
  assert.equal(deductMineChargeHp(800, 46), 500);
  assert.equal(deductMineChargeHp(500, 46), 200);
  assert.equal(deductMineChargeHp(200, 46), 1); // 200 - 300 = -100 <= 0 -> clamped to 1
  assert.equal(deductMineChargeHp(1, 45), 1);
  assert.equal(deductMineChargeHp(0, 45), 0);

  // Full 3-charge lifecycle from 900 HP: 900 -> 600 -> 300 -> 0 (chargesRemaining: 3 -> 2 -> 1 -> 0)
  const lifecycle900 = simulateMineChargeLifecycle(900, 45);
  assert.equal(lifecycle900.length, 3);
  assert.deepEqual(
    lifecycle900.map((step) => ({
      hpBefore: step.hpBefore,
      chargeHitHp: step.chargeHitHp,
      clampedToOne: step.clampedToOne,
      hpAfter: step.hpAfter,
      chargesBefore: step.chargesBefore,
      chargesRemaining: step.chargesRemaining,
      destroyed: step.destroyed,
    })),
    [
      {
        hpBefore: 900,
        chargeHitHp: 600,
        clampedToOne: false,
        hpAfter: 600,
        chargesBefore: 3,
        chargesRemaining: 2,
        destroyed: false,
      },
      {
        hpBefore: 600,
        chargeHitHp: 300,
        clampedToOne: false,
        hpAfter: 300,
        chargesBefore: 2,
        chargesRemaining: 1,
        destroyed: false,
      },
      {
        hpBefore: 300,
        chargeHitHp: 1,
        clampedToOne: true,
        hpAfter: 0,
        chargesBefore: 1,
        chargesRemaining: 0,
        destroyed: true,
      },
    ],
  );

  // Full 3-charge lifecycle from GAMESTAT 800 HP: 800 -> 500 -> 200 -> 0 (clamped to 1 during 3rd charge hit)
  const lifecycle800 = simulateMineChargeLifecycle(800, 46);
  assert.equal(lifecycle800.length, 3);
  assert.deepEqual(
    lifecycle800.map((step) => ({
      hpBefore: step.hpBefore,
      chargeHitHp: step.chargeHitHp,
      clampedToOne: step.clampedToOne,
      hpAfter: step.hpAfter,
      chargesBefore: step.chargesBefore,
      chargesRemaining: step.chargesRemaining,
      destroyed: step.destroyed,
    })),
    [
      {
        hpBefore: 800,
        chargeHitHp: 500,
        clampedToOne: false,
        hpAfter: 500,
        chargesBefore: 3,
        chargesRemaining: 2,
        destroyed: false,
      },
      {
        hpBefore: 500,
        chargeHitHp: 200,
        clampedToOne: false,
        hpAfter: 200,
        chargesBefore: 2,
        chargesRemaining: 1,
        destroyed: false,
      },
      {
        hpBefore: 200,
        chargeHitHp: 1,
        clampedToOne: true,
        hpAfter: 0,
        chargesBefore: 1,
        chargesRemaining: 0,
        destroyed: true,
      },
    ],
  );

  // Depleted mine does not detonate a 4th time
  const afterDepleted = applyMineChargeDetonation({ unitType: 45, health: 0, chargesRemaining: 0 });
  assert.equal(afterDepleted.detonated, false);
  assert.equal(afterDepleted.chargesRemaining, 0);
  assert.equal(afterDepleted.hpAfter, 0);
  assert.equal(afterDepleted.destroyed, true);

  assert.equal(resolveMineChargesFromHp(900), 3);
  assert.equal(resolveMineChargesFromHp(800), 3);
  assert.equal(resolveMineChargesFromHp(600), 2);
  assert.equal(resolveMineChargesFromHp(500), 2);
  assert.equal(resolveMineChargesFromHp(300), 1);
  assert.equal(resolveMineChargesFromHp(200), 1);
  assert.equal(resolveMineChargesFromHp(1), 1);
  assert.equal(resolveMineChargesFromHp(0), 0);
});

test("0x40DE20 team-survival unit filter predicate excludes deployed mines (45, 46) and deployed turrets (41, 42)", () => {
  assert.deepEqual(TEAM_SURVIVAL_EXCLUDED_UNIT_TYPES, [41, 42, 45, 46]);

  // Deployed turrets (41, 42) and deployed mines (45, 46) must be excluded
  assert.equal(isTeamSurvivalEligibleUnitType(41), false);
  assert.equal(isTeamSurvivalEligibleUnitType(42), false);
  assert.equal(isTeamSurvivalEligibleUnitType(45), false);
  assert.equal(isTeamSurvivalEligibleUnitType(46), false);

  // Mobile counterparts (1, 9, 43, 44), stealth units (4, 12, 77, 78), harvesters (6, 14, 47, 48), and combat units are eligible
  for (const eligibleType of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16, 28, 43, 44, 47, 48, 49, 50, 69, 73, 77, 78]) {
    assert.equal(isTeamSurvivalEligibleUnitType(eligibleType), true, `Expected unitType ${eligibleType} to be survival-eligible`);
  }

  // Every valid unit index in 0..109 except 41, 42, 45, 46 is eligible
  for (let unitType = 0; unitType < 110; unitType += 1) {
    const expected = ![41, 42, 45, 46].includes(unitType);
    assert.equal(isTeamSurvivalEligibleUnitType(unitType), expected);
  }
  assert.equal(isTeamSurvivalEligibleUnitType(-1), false);
  assert.equal(isTeamSurvivalEligibleUnitType(110), false);
  assert.equal(isTeamSurvivalEligibleUnitType(Number.NaN), false);

  // Team with only deployed mines (45, 46), deployed turrets (41, 42), colony slot % 15 === 5, or dead units does NOT survive
  assert.equal(
    hasTeamSurvivingUnits(1, [
      { slot: 160, team: 1, unitType: 41, health: 800, status: 1 },
      { slot: 161, team: 1, unitType: 42, health: 800, status: 1 },
      { slot: 162, team: 1, unitType: 45, health: 800, status: 1 },
      { slot: 163, team: 1, unitType: 46, health: 800, status: 1 },
      { slot: 20, team: 1, unitType: 81, health: 1600, status: 1 }, // slot 20 === 1 * 15 + 5 (colony TOWR marker)
      { slot: 164, team: 1, unitType: 8, health: 0, status: 10 }, // dead unit
    ]),
    false,
  );

  // Adding a mobile unit (e.g. mobile mine 43 or mobile turret 1 or trooper 0) makes the team survive
  assert.equal(
    hasTeamSurvivingUnits(1, [
      { slot: 160, team: 1, unitType: 45, health: 800, status: 1 },
      { slot: 165, team: 1, unitType: 43, health: 800, status: 1 },
    ]),
    true,
  );
});

const publicRoot = new URL("../../public/", import.meta.url);
const testCanvas = () =>
  ({
    width: 512,
    height: 452,
    getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }),
  }) as unknown as HTMLCanvasElement;
const testCallbacks = { onStats() {}, onUnitsChanged() {} };

test("MissionView integration: deploySelected() converts 1->41 (T), 9->42 (XDEPLOY), 43->45 (HMINE), 44->46 (HMINE) and enforces 0x41686C mine cell occupancy", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => new Response(readFileSync(new URL(String(input).slice(1), publicRoot)));
  try {
    for (const [campaign, missionNumber, mobileTurret, deployedTurret, turretWeapon, mobileMine, deployedMine] of [
      ["human", 3, 1, 41, 34, 43, 45] as const,
      ["alien", 2, 9, 42, 40, 44, 46] as const,
    ]) {
      const original = await loadCampaignMission(campaign, missionNumber, "browser-adapted");
      const parsed = parseScenario(atob(original.scenario.rawScenario!));
      let replacedCount = 0;
      const placementRows = original.scenario.placementRows.map((row) => {
        if (row[3] === 0 && [0, 2, 8, 10].includes(row[2]) && replacedCount < 2) {
          replacedCount += 1;
          const nextType = replacedCount === 1 ? mobileTurret : mobileMine;
          return row.map((value, idx) => (idx === 2 ? nextType : value));
        }
        return row;
      });
      assert.equal(replacedCount, 2);

      const scenario = { ...original.scenario, ...parsed, placementRows };
      const fixture = { ...original, scenario, browserEconomy: undefined, browserResearch: undefined };
      const initial = initializeCampaignSession(sourceBrowserCampaignSessionOptions(fixture));
      assert.ok(initial.ok, JSON.stringify(initial));
      const browserEconomy = await createBrowserCampaignEconomyProfile({
        scope: "browser-adapted-economy-v1",
        world: initial.value.world,
        teams: scenario.teams,
        units: original.units,
      });
      const browserAi = await createBrowserCampaignAiConfiguration({
        scenario,
        units: original.units,
        weapons: original.weapons,
        dependencies: [],
        pathGrid: new NavigationGrid(
          original.map.width,
          original.map.height,
          Uint16Array.from(createLegacyInfantryFamilyMask({ ...original.map, pathGrid: original.pathGrid })),
        ),
      });
      const mission = { ...fixture, browserAi, browserEconomy };
      const view = new MissionView(testCanvas(), {} as HTMLElement, testCallbacks, mission);
      try {
        assert.equal(view.missionDiagnostic, undefined);
        const beforeDeploy = view.checkpoint();
        const turretUnitId = beforeDeploy.state.unitStats.find((s) => s.type === mobileTurret)?.id;
        const mineUnitId = beforeDeploy.state.unitStats.find((s) => s.type === mobileMine)?.id;
        assert.ok(turretUnitId !== undefined, `Expected mobile turret ${mobileTurret} in MissionView`);
        assert.ok(mineUnitId !== undefined, `Expected mobile mine ${mobileMine} in MissionView`);

        // Select mobile turret (1 or 9) -> canDeploy is true, canUndeploy is false
        view.replaceSelection([turretUnitId]);
        assert.deepEqual(view.deploymentSelection, { canDeploy: true, canUndeploy: false });
        assert.deepEqual(view.deploySelected(), [turretUnitId]);
        assert.deepEqual(view.deploymentSelection, { canDeploy: false, canUndeploy: false });

        // Select mobile mine (43 or 44) -> canDeploy is true, deploySelected converts to 45/46
        const mineUnitBefore = view.simulation.snapshot.units.find((u) => u.id === mineUnitId)!;
        view.replaceSelection([mineUnitId]);
        assert.deepEqual(view.deploymentSelection, { canDeploy: true, canUndeploy: false });
        assert.deepEqual(view.deploySelected(), [mineUnitId]);

        const afterDeploy = view.checkpoint();
        assert.equal(afterDeploy.state.unitStats.find((s) => s.id === turretUnitId)?.type, deployedTurret);
        assert.equal(afterDeploy.state.unitWeapons.find((w) => w.id === turretUnitId)?.weapon, turretWeapon);
        const staticTurret = afterDeploy.simulation.staticTargets.find((t) => t.id === turretUnitId)!;
        assert.ok(staticTurret);
        assert.equal(staticTurret.weapon?.weaponId, turretWeapon);
        assert.equal(staticTurret.weapon?.damage, 100);
        assert.equal(staticTurret.weapon?.rangeCells, 6);
        assert.equal(staticTurret.footprint.length, 1);

        assert.equal(afterDeploy.state.unitStats.find((s) => s.id === mineUnitId)?.type, deployedMine);
        assert.equal(afterDeploy.state.unitWeapons.find((w) => w.id === mineUnitId)?.weapon, 38);
        const staticMine = afterDeploy.simulation.staticTargets.find((t) => t.id === mineUnitId)!;
        assert.ok(staticMine);
        assert.equal(staticMine.mine?.sourceTypeIndex, deployedMine);
        assert.equal(staticMine.mine?.weaponId, 38);
        assert.equal(staticMine.mine?.weapon.damage, 1300);
        assert.equal(staticMine.footprint.length, 0);

        // Verify 0x41686C mine cell-occupancy rejection on the deployed mine's cell
        assert.equal(
          canDeployMineAtCell({
            cellX: mineUnitBefore.cellX,
            cellY: mineUnitBefore.cellY,
            staticTargets: view.simulation.snapshot.staticTargets,
          }),
          false,
        );

        // Full MissionView checkpoint & restore round-trip after deployment
        const restored = MissionView.restore(
          testCanvas(),
          {} as HTMLElement,
          testCallbacks,
          mission,
          JSON.parse(JSON.stringify(afterDeploy)),
        );
        try {
          assert.deepEqual(restored.checkpoint(), afterDeploy);
          view.update(0);
          restored.update(0);
          view.update(50);
          restored.update(50);
          assert.equal(view.missionDiagnostic, undefined);
          assert.equal(restored.missionDiagnostic, undefined);
          assert.deepEqual(restored.checkpoint(), view.checkpoint());
        } finally {
          restored.dispose();
        }
      } finally {
        view.dispose();
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});
