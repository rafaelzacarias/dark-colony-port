import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ALIEN_ARTILLERY_UNIT_TYPE,
  ALIEN_SCOUT_UNIT_TYPE,
  ARTILLERY_UNIT_TYPES,
  ARTILLERY_WEAPON_RANGES_BY_ID,
  ARTILLERY_WEAPON_RANGES_BY_LEVEL,
  ATRAIN5_SPOTTING_MESSAGE_ID,
  ATRAIN5_SPOTTING_MESSAGE_TEXT,
  AVII_OBSERVATION_RANGE_CELLS,
  AVII_SCOUT_UNIT_TYPE,
  BROWSER_ARTILLERY_PROFILES,
  BROWSER_SCOUT_SPOTTER_PROFILES,
  canArtilleryAcquireTarget,
  DEFAULT_SCOUT_RANGE_BONUS_CELLS,
  getArtilleryProfile,
  getScoutSpotterProfile,
  HTRAIN5_SPOTTING_MESSAGE_ID,
  HTRAIN5_SPOTTING_MESSAGE_TEXT,
  HUMAN_ARTILLERY_UNIT_TYPE,
  HUMAN_SCOUT_UNIT_TYPE,
  isArtilleryUnit,
  isScoutSpotterUnit,
  isTargetSpottedByScout,
  ORTU_OBSERVATION_RANGE_CELLS,
  resolveArtilleryEffectiveRange,
  resolveArtillerySelfSightRange,
  resolveArtilleryUnitType,
  resolveArtilleryWeaponRange,
  resolveScoutSpotterUnitType,
  SCGM_OBSERVATION_RANGE_CELLS,
  SCOUT_SPOTTER_UNIT_TYPES,
  scoutObservationRange,
  withinScoutObservationRing,
} from "../../src/engine/browser-artillery-spotting";
import { guardCommands } from "../../src/engine/guard-ai";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation, withinSourceWeaponRange, type SimulationSnapshot } from "../../src/engine/simulation";

interface GeneratedUnitsJson {
  readonly schemaVersion: number;
  readonly records: readonly {
    readonly index: number;
    readonly sprite: string;
    readonly faction: number;
    readonly turnSpeed: number;
    readonly movementSpeed: number;
    readonly observationDay: number;
    readonly observationNight: number;
    readonly weapons: readonly [number, number, number];
    readonly armorUpgradePercentages: readonly [number, number];
    readonly targetClass: number;
    readonly health: number;
    readonly rawTail: readonly number[];
  }[];
}

interface GeneratedWeaponsJson {
  readonly schemaVersion: number;
  readonly records: readonly {
    readonly id: number;
    readonly visualClass: string;
    readonly rawPrefix: number;
    readonly soundId: number;
    readonly rateOfFire: number;
    readonly damage: number;
    readonly speed: number;
    readonly range: number;
    readonly shots: number;
    readonly reload: number;
    readonly magicChewing: number;
  }[];
}

interface GeneratedMessagesJson {
  readonly schemaVersion: number;
  readonly messages: readonly {
    readonly id: number;
    readonly text: string;
  }[];
}

const unitsData = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/units.json", import.meta.url), "utf8"),
) as GeneratedUnitsJson;

const weaponsData = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/weapons.json", import.meta.url), "utf8"),
) as GeneratedWeaponsJson;

const htrain5Messages = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/messages/TEST/HTRAIN5.json", import.meta.url), "utf8"),
) as GeneratedMessagesJson;

const atrain5Messages = JSON.parse(
  readFileSync(new URL("../../public/assets/generated/data/messages/TEST/ATRAIN5.json", import.meta.url), "utf8"),
) as GeneratedMessagesJson;

test("artillery and scout spotter profiles match units.json, weapons.json, HTRAIN5.json, and ATRAIN5.json", () => {
  const barrUnit = unitsData.records.find((record) => record.index === HUMAN_ARTILLERY_UNIT_TYPE);
  const atrilUnit = unitsData.records.find((record) => record.index === ALIEN_ARTILLERY_UNIT_TYPE);
  const scgmUnit = unitsData.records.find((record) => record.index === HUMAN_SCOUT_UNIT_TYPE);
  const ortuUnit = unitsData.records.find((record) => record.index === ALIEN_SCOUT_UNIT_TYPE);
  const aviiUnit = unitsData.records.find((record) => record.index === AVII_SCOUT_UNIT_TYPE);

  assert.ok(barrUnit, "Expected BARR (unit 3) in units.json");
  assert.ok(atrilUnit, "Expected ATRIL (unit 11) in units.json");
  assert.ok(scgmUnit, "Expected SCGM (unit 5) in units.json");
  assert.ok(ortuUnit, "Expected ORTU (unit 13) in units.json");
  assert.ok(aviiUnit, "Expected AVII (unit 24) in units.json");

  // BARR (3)
  assert.equal(barrUnit.sprite, "BARR");
  assert.equal(barrUnit.faction, 0);
  assert.equal(barrUnit.turnSpeed, BROWSER_ARTILLERY_PROFILES[3].turnSpeed);
  assert.equal(barrUnit.movementSpeed, BROWSER_ARTILLERY_PROFILES[3].movementSpeed);
  assert.equal(barrUnit.observationDay, BROWSER_ARTILLERY_PROFILES[3].gamestatObservationDay);
  assert.equal(barrUnit.observationNight, BROWSER_ARTILLERY_PROFILES[3].gamestatObservationNight);
  assert.equal(barrUnit.observationNight, 4);
  assert.deepEqual(barrUnit.weapons, [10, 11, 12]);
  assert.deepEqual(barrUnit.armorUpgradePercentages, [125, 150]);
  assert.equal(barrUnit.targetClass, 3);
  assert.equal(barrUnit.health, 400);

  // ATRIL (11)
  assert.equal(atrilUnit.sprite, "ATRIL");
  assert.equal(atrilUnit.faction, 1);
  assert.equal(atrilUnit.turnSpeed, BROWSER_ARTILLERY_PROFILES[11].turnSpeed);
  assert.equal(atrilUnit.movementSpeed, BROWSER_ARTILLERY_PROFILES[11].movementSpeed);
  assert.equal(atrilUnit.observationDay, 4);
  assert.equal(atrilUnit.observationNight, 7);
  assert.deepEqual(atrilUnit.weapons, [24, 25, 26]);
  assert.deepEqual(atrilUnit.armorUpgradePercentages, [125, 150]);
  assert.equal(atrilUnit.targetClass, 3);
  assert.equal(atrilUnit.health, 400);

  // SCGM (5)
  assert.equal(scgmUnit.sprite, "SCGM");
  assert.equal(scgmUnit.faction, 0);
  assert.equal(scgmUnit.observationDay, 8);
  assert.equal(scgmUnit.observationNight, 8);
  assert.deepEqual(scgmUnit.weapons, [37, 44, 45]);
  assert.equal(scgmUnit.targetClass, 2);
  assert.equal(scgmUnit.health, 800);

  // ORTU (13)
  assert.equal(ortuUnit.sprite, "ORTU");
  assert.equal(ortuUnit.faction, 1);
  assert.equal(ortuUnit.observationDay, 8);
  assert.equal(ortuUnit.observationNight, 8);
  assert.deepEqual(ortuUnit.weapons, [37, 44, 45]);
  assert.equal(ortuUnit.targetClass, 2);
  assert.equal(ortuUnit.health, 800);

  // AVII (24)
  assert.equal(aviiUnit.sprite, "AVII");
  assert.equal(aviiUnit.faction, 1);
  assert.equal(aviiUnit.observationDay, BROWSER_SCOUT_SPOTTER_PROFILES[24].gamestatObservationDay);
  assert.equal(aviiUnit.observationNight, BROWSER_SCOUT_SPOTTER_PROFILES[24].gamestatObservationNight);
  assert.deepEqual(aviiUnit.weapons, [53, 53, 53]);
  assert.equal(aviiUnit.targetClass, 2);
  assert.equal(aviiUnit.health, 250);

  // Artillery weapons in weapons.json: BARR [10, 11, 12] and ATRIL [24, 25, 26] -> ranges [12, 14, 16]
  for (let level = 0; level < 3; level += 1) {
    const expectedRange = ARTILLERY_WEAPON_RANGES_BY_LEVEL[level];
    const barrWeaponId: number = barrUnit.weapons[level];
    const atrilWeaponId: number = atrilUnit.weapons[level];
    const barrWeapon = weaponsData.records.find((record) => record.id === barrWeaponId);
    const atrilWeapon = weaponsData.records.find((record) => record.id === atrilWeaponId);
    assert.ok(barrWeapon, `Expected BARR weapon ${barrWeaponId} in weapons.json`);
    assert.ok(atrilWeapon, `Expected ATRIL weapon ${atrilWeaponId} in weapons.json`);
    assert.equal(barrWeapon.range, expectedRange);
    assert.equal(atrilWeapon.range, expectedRange);
    assert.equal(ARTILLERY_WEAPON_RANGES_BY_ID[barrWeaponId], expectedRange);
    assert.equal(ARTILLERY_WEAPON_RANGES_BY_ID[atrilWeaponId], expectedRange);
    assert.ok(
      barrWeapon.range > barrUnit.observationDay && barrWeapon.range > barrUnit.observationNight,
      "BARR weapon range must exceed BARR self-observation range",
    );
    assert.ok(
      atrilWeapon.range > atrilUnit.observationDay && atrilWeapon.range > atrilUnit.observationNight,
      "ATRIL weapon range must exceed ATRIL self-observation range",
    );
  }

  // Training messages HTRAIN5 and ATRAIN5
  const htrain5Msg10 = htrain5Messages.messages.find((entry) => entry.id === HTRAIN5_SPOTTING_MESSAGE_ID);
  const atrain5Msg10 = atrain5Messages.messages.find((entry) => entry.id === ATRAIN5_SPOTTING_MESSAGE_ID);
  assert.ok(htrain5Msg10, "Expected message 10 in HTRAIN5.json");
  assert.ok(atrain5Msg10, "Expected message 10 in ATRAIN5.json");
  assert.equal(htrain5Msg10.text, HTRAIN5_SPOTTING_MESSAGE_TEXT);
  assert.equal(atrain5Msg10.text, ATRAIN5_SPOTTING_MESSAGE_TEXT);
});

test("isArtilleryUnit and isScoutSpotterUnit recognize unit types, sprites, and unit records", () => {
  assert.deepEqual(ARTILLERY_UNIT_TYPES, [3, 11]);
  assert.deepEqual(SCOUT_SPOTTER_UNIT_TYPES, [5, 13, 24]);

  assert.equal(isArtilleryUnit(3), true);
  assert.equal(isArtilleryUnit(11), true);
  assert.equal(isArtilleryUnit("BARR"), true);
  assert.equal(isArtilleryUnit("ATRIL"), true);
  assert.equal(isArtilleryUnit("barr"), true);
  assert.equal(isArtilleryUnit("atril"), true);
  assert.equal(isArtilleryUnit(unitsData.records[3]), true);
  assert.equal(isArtilleryUnit(unitsData.records[11]), true);
  assert.equal(resolveArtilleryUnitType(3), 3);
  assert.equal(resolveArtilleryUnitType("ATRIL"), 11);
  assert.equal(getArtilleryProfile("BARR"), BROWSER_ARTILLERY_PROFILES[3]);
  assert.equal(getArtilleryProfile(11), BROWSER_ARTILLERY_PROFILES[11]);

  // Unarmed placeholder records in GAMESTAT.TXT that share the "ATRIL" sprite (indices 7, 15, 27, 39) are not artillery
  for (const nonArtilleryIndex of [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 24, 27, 39]) {
    assert.equal(isArtilleryUnit(nonArtilleryIndex), false, `index ${nonArtilleryIndex} should not be artillery`);
    assert.equal(isArtilleryUnit(unitsData.records[nonArtilleryIndex]), false);
  }
  assert.equal(isArtilleryUnit("SCGM"), false);
  assert.equal(isArtilleryUnit(null), false);
  assert.equal(isArtilleryUnit(undefined), false);

  assert.equal(isScoutSpotterUnit(5), true);
  assert.equal(isScoutSpotterUnit(13), true);
  assert.equal(isScoutSpotterUnit(24), true);
  assert.equal(isScoutSpotterUnit("SCGM"), true);
  assert.equal(isScoutSpotterUnit("ORTU"), true);
  assert.equal(isScoutSpotterUnit("AVII"), true);
  assert.equal(isScoutSpotterUnit("scgm"), true);
  assert.equal(isScoutSpotterUnit("ortu"), true);
  assert.equal(isScoutSpotterUnit("avii"), true);
  assert.equal(isScoutSpotterUnit(unitsData.records[5]), true);
  assert.equal(isScoutSpotterUnit(unitsData.records[13]), true);
  assert.equal(isScoutSpotterUnit(unitsData.records[24]), true);
  assert.equal(resolveScoutSpotterUnitType("SCGM"), 5);
  assert.equal(resolveScoutSpotterUnitType("ORTU"), 13);
  assert.equal(resolveScoutSpotterUnitType("AVII"), 24);
  assert.equal(getScoutSpotterProfile(5), BROWSER_SCOUT_SPOTTER_PROFILES[5]);
  assert.equal(getScoutSpotterProfile(13), BROWSER_SCOUT_SPOTTER_PROFILES[13]);
  assert.equal(getScoutSpotterProfile(24), BROWSER_SCOUT_SPOTTER_PROFILES[24]);

  for (const nonScoutIndex of [0, 3, 4, 6, 8, 11, 12, 14, 80, 104]) {
    assert.equal(isScoutSpotterUnit(nonScoutIndex), false);
    assert.equal(isScoutSpotterUnit(unitsData.records[nonScoutIndex]), false);
  }
  assert.equal(isScoutSpotterUnit("BARR"), false);
  assert.equal(isScoutSpotterUnit(null), false);
  assert.equal(isScoutSpotterUnit(undefined), false);
});

test("scoutObservationRange returns 8 for SCGM/ORTU and 11 for AVII across day and night", () => {
  assert.equal(SCGM_OBSERVATION_RANGE_CELLS, 8);
  assert.equal(ORTU_OBSERVATION_RANGE_CELLS, 8);
  assert.equal(AVII_OBSERVATION_RANGE_CELLS, 11);

  for (const isNight of [false, true]) {
    assert.equal(scoutObservationRange(5, isNight), 8);
    assert.equal(scoutObservationRange("SCGM", isNight), 8);
    assert.equal(scoutObservationRange(unitsData.records[5], isNight), 8);

    assert.equal(scoutObservationRange(13, isNight), 8);
    assert.equal(scoutObservationRange("ORTU", isNight), 8);
    assert.equal(scoutObservationRange(unitsData.records[13], isNight), 8);

    assert.equal(scoutObservationRange(24, isNight), 11);
    assert.equal(scoutObservationRange("AVII", isNight), 11);
    assert.equal(scoutObservationRange(unitsData.records[24], isNight), 11);
  }

  assert.equal(scoutObservationRange({ unitType: 5, observationDay: 9, observationNight: 6 }, false), 9);
  assert.equal(scoutObservationRange({ unitType: 5, observationDay: 9, observationNight: 6 }, true), 6);
  assert.equal(scoutObservationRange(null, false), 0);
});

test("isTargetSpottedByScout checks DC.EXE ring convention and filters dead/hostile/non-scout units", () => {
  const scout = { id: 2, unitType: HUMAN_SCOUT_UNIT_TYPE, sprite: "SCGM", team: 0, cellX: 20, cellY: 20, health: 800 };

  // Ring radius 8: (8 + 1)^2 = 81
  // (28, 24) -> dx=8, dy=4 -> 64 + 16 = 80 <= 81 -> spotted
  assert.equal(withinScoutObservationRing(8, 4, 8), true);
  assert.equal(isTargetSpottedByScout({ cellX: 28, cellY: 24 }, [scout], { team: 0 }), true);

  // (29, 20) -> dx=9, dy=0 -> 81 <= 81 -> spotted on the (obsRange + 1)^2 boundary
  assert.equal(withinScoutObservationRing(9, 0, 8), true);
  assert.equal(isTargetSpottedByScout({ cellX: 29, cellY: 20 }, [scout], { team: 0 }), true);

  // (29, 21) -> dx=9, dy=1 -> 82 > 81 -> not spotted
  assert.equal(withinScoutObservationRing(9, 1, 8), false);
  assert.equal(isTargetSpottedByScout({ cellX: 29, cellY: 21 }, [scout], { team: 0 }), false);

  // Dead or dying scout cannot spot
  assert.equal(isTargetSpottedByScout({ cellX: 22, cellY: 20 }, [{ ...scout, health: 0 }], { team: 0 }), false);
  assert.equal(isTargetSpottedByScout({ cellX: 22, cellY: 20 }, [{ ...scout, activity: "die" }], { team: 0 }), false);
  assert.equal(isTargetSpottedByScout({ cellX: 22, cellY: 20 }, [{ ...scout, dead: true }], { team: 0 }), false);

  // Hostile scout (team 1) does not spot for team 0 unless allied
  assert.equal(isTargetSpottedByScout({ cellX: 22, cellY: 20 }, [{ ...scout, team: 1 }], { team: 0 }), false);
  assert.equal(
    isTargetSpottedByScout(
      { cellX: 22, cellY: 20 },
      [{ ...scout, team: 1 }],
      { team: 0, teamAlliances: [[0, 1], [1, 0]] },
    ),
    true,
  );

  // Non-scout unit (e.g. TRSC type 0) in units list does not count as a scout spotter
  const infantry = { id: 3, unitType: 0, sprite: "TRSC", team: 0, cellX: 21, cellY: 20, health: 800 };
  assert.equal(isTargetSpottedByScout({ cellX: 22, cellY: 20 }, [infantry], { team: 0 }), false);

  // AVII (type 24) has effective observation radius 11 ((11 + 1)^2 = 144)
  const aviiScout = { id: 4, unitType: AVII_SCOUT_UNIT_TYPE, sprite: "AVII", team: 0, cellX: 20, cellY: 20, health: 250 };
  // dx=11, dy=4 -> 121 + 16 = 137 <= 144 -> spotted by AVII, but not by SCGM (137 > 81)
  assert.equal(isTargetSpottedByScout({ cellX: 31, cellY: 24 }, [scout], { team: 0 }), false);
  assert.equal(isTargetSpottedByScout({ cellX: 31, cellY: 24 }, [aviiScout], { team: 0 }), true);
});

test("Human (BARR + SCGM) unspotted vs scout-spotted target acquisition across weapon upgrade levels 0, 1, 2", () => {
  const barr = {
    id: 1,
    unitType: HUMAN_ARTILLERY_UNIT_TYPE,
    sprite: "BARR",
    faction: "human" as const,
    team: 0,
    cellX: 10,
    cellY: 10,
    health: 400,
    weapons: [10, 11, 12] as const,
  };
  const scgm = {
    id: 2,
    unitType: HUMAN_SCOUT_UNIT_TYPE,
    sprite: "SCGM",
    faction: "human" as const,
    team: 0,
    cellX: 20,
    cellY: 10,
    health: 800,
  };

  const expectedWeaponIds = [10, 11, 12] as const;
  const expectedRanges = [12, 14, 16] as const;

  for (const level of [0, 1, 2] as const) {
    const weaponRange = expectedRanges[level];
    const weaponId = expectedWeaponIds[level];

    // Unspotted: BARR is limited to its short self-observation range (4 cells)
    const unspotted = resolveArtilleryEffectiveRange(barr, [], {
      weaponLevel: level,
      weapons: weaponsData,
      isNight: true,
    });
    assert.equal(unspotted.isArtillery, true);
    assert.equal(unspotted.unitType, 3);
    assert.equal(unspotted.sprite, "BARR");
    assert.equal(unspotted.weaponLevel, level);
    assert.equal(unspotted.weaponId, weaponId);
    assert.equal(unspotted.selfSightRange, 4);
    assert.equal(unspotted.unspottedRange, 4);
    assert.equal(unspotted.weaponRange, weaponRange);
    assert.equal(unspotted.hasActiveScout, false);
    assert.equal(unspotted.effectiveRange, 4);

    // Close target within self-sight (dx=4, dy=0) can be acquired without a scout
    const closeTarget = { id: 10, team: 1, faction: "alien" as const, cellX: 14, cellY: 10, health: 800 };
    assert.equal(unspotted.canArtilleryAcquireTarget(closeTarget), true);
    assert.equal(canArtilleryAcquireTarget(barr, closeTarget, [], { weaponLevel: level, weapons: weaponsData }), true);

    // Target at weaponRange (dx = 12, 14, or 16 from BARR at x=10 -> x = 22, 24, 26) is within SCGM sight from x=20
    const maxRangeTarget = {
      id: 11,
      team: 1,
      faction: "alien" as const,
      cellX: 10 + weaponRange,
      cellY: 10,
      health: 800,
    };
    const beyondRangeTarget = {
      id: 12,
      team: 1,
      faction: "alien" as const,
      cellX: 10 + weaponRange + 1,
      cellY: 10,
      health: 800,
    };

    // Unspotted BARR cannot acquire target at distance 12..16
    assert.equal(unspotted.canArtilleryAcquireTarget(maxRangeTarget), false);
    assert.equal(canArtilleryAcquireTarget(barr, maxRangeTarget, [], { weaponLevel: level, weapons: weaponsData }), false);

    // Scout-spotted BARR acquires target across full weapon range (12, 14, 16)
    const spotted = resolveArtilleryEffectiveRange(barr, [scgm], {
      weaponLevel: level,
      weapons: weaponsData,
      isNight: true,
    });
    assert.equal(spotted.hasActiveScout, true);
    assert.equal(spotted.effectiveRange, weaponRange);
    assert.equal(spotted.spottedRange, weaponRange);
    assert.equal(spotted.spottedRangeWithBonus, weaponRange + DEFAULT_SCOUT_RANGE_BONUS_CELLS);
    assert.equal(withinSourceWeaponRange(weaponRange, 0, spotted.effectiveRange), true);
    assert.equal(withinSourceWeaponRange(weaponRange + 1, 0, spotted.effectiveRange), false);
    assert.equal(spotted.canArtilleryAcquireTarget(maxRangeTarget), true);
    assert.equal(spotted.canArtilleryAcquireTarget(beyondRangeTarget), false);

    // With optional scout range bonus (+4 cells -> 16, 18, 20), scout placed forward spots target at weaponRange + 4
    const forwardScout = { ...scgm, cellX: 10 + weaponRange, cellY: 10 };
    const bonusTarget = {
      id: 13,
      team: 1,
      faction: "alien" as const,
      cellX: 10 + weaponRange + DEFAULT_SCOUT_RANGE_BONUS_CELLS,
      cellY: 10,
      health: 800,
    };
    const spottedWithBonus = resolveArtilleryEffectiveRange(barr, [forwardScout], {
      weaponLevel: level,
      weapons: weaponsData,
      includeScoutRangeBonus: true,
    });
    assert.equal(spottedWithBonus.scoutRangeBonus, 4);
    assert.equal(spottedWithBonus.effectiveRange, weaponRange + 4);
    assert.equal(spottedWithBonus.canArtilleryAcquireTarget(bonusTarget), true);
    assert.equal(
      spottedWithBonus.canArtilleryAcquireTarget({ ...bonusTarget, cellX: bonusTarget.cellX + 1 }),
      false,
    );
  }
});

test("Alien (ATRIL + ORTU) unspotted vs scout-spotted target acquisition across weapon upgrade levels 0, 1, 2", () => {
  const atril = {
    id: 1,
    unitType: ALIEN_ARTILLERY_UNIT_TYPE,
    sprite: "ATRIL",
    faction: "alien" as const,
    team: 0,
    cellX: 10,
    cellY: 10,
    health: 400,
    weapons: [24, 25, 26] as const,
  };
  const ortu = {
    id: 2,
    unitType: ALIEN_SCOUT_UNIT_TYPE,
    sprite: "ORTU",
    faction: "alien" as const,
    team: 0,
    cellX: 20,
    cellY: 10,
    health: 800,
  };

  const expectedWeaponIds = [24, 25, 26] as const;
  const expectedRanges = [12, 14, 16] as const;

  // ATRIL self-observation is 4 by day and 7 by night in GAMESTAT.TXT
  assert.equal(resolveArtillerySelfSightRange(atril, { isNight: false }), 4);
  assert.equal(resolveArtillerySelfSightRange(atril, { isNight: true }), 7);

  for (const level of [0, 1, 2] as const) {
    const weaponRange = expectedRanges[level];
    const weaponId = expectedWeaponIds[level];
    const resolvedWeapon = resolveArtilleryWeaponRange(atril, { weaponLevel: level, weapons: weaponsData });
    assert.equal(resolvedWeapon.weaponId, weaponId);
    assert.equal(resolvedWeapon.weaponRange, weaponRange);

    const unspottedDay = resolveArtilleryEffectiveRange(atril, [], {
      weaponLevel: level,
      weapons: weaponsData,
      isNight: false,
    });
    assert.equal(unspottedDay.unitType, 11);
    assert.equal(unspottedDay.sprite, "ATRIL");
    assert.equal(unspottedDay.unspottedRange, 4);
    assert.equal(unspottedDay.effectiveRange, 4);

    const unspottedNight = resolveArtilleryEffectiveRange(atril, [], {
      weaponLevel: level,
      weapons: weaponsData,
      isNight: true,
    });
    assert.equal(unspottedNight.unspottedRange, 7);
    assert.equal(unspottedNight.effectiveRange, 7);

    // Target at distance 6 is out of ATRIL day sight (4), within night sight (7)
    const midTarget = { id: 20, team: 1, faction: "human" as const, cellX: 16, cellY: 10, health: 800 };
    assert.equal(unspottedDay.canArtilleryAcquireTarget(midTarget), false);
    assert.equal(unspottedNight.canArtilleryAcquireTarget(midTarget), true);

    // Target at full weapon range (12, 14, 16) is out of both day (4) and night (7) self-sight
    const farTarget = {
      id: 21,
      team: 1,
      faction: "human" as const,
      cellX: 10 + weaponRange,
      cellY: 10,
      health: 800,
    };
    assert.equal(unspottedDay.canArtilleryAcquireTarget(farTarget), false);
    assert.equal(unspottedNight.canArtilleryAcquireTarget(farTarget), false);

    // With ORTU spotting, ATRIL acquires the target at full weapon range (12, 14, 16)
    const spotted = resolveArtilleryEffectiveRange(atril, [ortu], {
      weaponLevel: level,
      weapons: weaponsData,
      isNight: false,
    });
    assert.equal(spotted.hasActiveScout, true);
    assert.equal(spotted.effectiveRange, weaponRange);
    assert.equal(spotted.canArtilleryAcquireTarget(farTarget), true);
    assert.equal(
      spotted.canArtilleryAcquireTarget({ ...farTarget, cellX: farTarget.cellX + 1 }),
      false,
    );
  }
});

test("integration with guardCommands: artillery only acquires long-range targets when spotted by scout", () => {
  const barr = {
    id: 1,
    unitType: HUMAN_ARTILLERY_UNIT_TYPE,
    sprite: "BARR",
    faction: "human" as const,
    team: 0,
    activity: "idle" as const,
    xSubcells: 0,
    ySubcells: 0,
    cellX: 10,
    cellY: 10,
    health: 400,
    maxHealth: 400,
    cargo: 0,
    cargoCapacity: 0,
    targetId: null,
    movementPlane: "ground" as const,
  };
  const scgm = {
    id: 2,
    unitType: HUMAN_SCOUT_UNIT_TYPE,
    sprite: "SCGM",
    faction: "human" as const,
    team: 0,
    activity: "idle" as const,
    xSubcells: 0,
    ySubcells: 0,
    cellX: 18,
    cellY: 10,
    health: 800,
    maxHealth: 800,
    cargo: 0,
    cargoCapacity: 0,
    targetId: null,
    movementPlane: "air" as const,
  };
  const enemy = {
    id: 3,
    faction: "alien" as const,
    team: 1,
    activity: "idle" as const,
    xSubcells: 0,
    ySubcells: 0,
    cellX: 22,
    cellY: 10,
    health: 800,
    maxHealth: 800,
    cargo: 0,
    cargoCapacity: 0,
    targetId: null,
    movementPlane: "ground" as const,
  };

  const baseSnapshot: SimulationSnapshot = {
    tick: 0,
    entityCount: 3,
    timeOfDay: "night",
    daylightPermille: 0,
    randomState: 1,
    resources: { human: 0, alien: 0 },
    buildings: [],
    staticTargets: [],
    resourceNodes: [],
    teamAlliances: [
      [0, 0],
      [0, 0],
    ],
    units: [barr, enemy],
  };

  const unspottedRange = resolveArtilleryEffectiveRange(barr, []);
  const unspottedCommands = guardCommands(baseSnapshot, [
    {
      id: barr.id,
      dayRangeCells: unspottedRange.selfSightRange,
      nightRangeCells: unspottedRange.selfSightRange,
      weaponRangeCells: unspottedRange.effectiveRange,
      splash: true,
      isCellVisible: unspottedRange.isCellVisible,
    },
  ]);
  assert.deepEqual(unspottedCommands, []);

  const spottedSnapshot: SimulationSnapshot = {
    ...baseSnapshot,
    units: [barr, scgm, enemy],
  };
  const spottedRange = resolveArtilleryEffectiveRange(barr, [scgm]);
  const spottedCommands = guardCommands(spottedSnapshot, [
    {
      id: barr.id,
      dayRangeCells: spottedRange.selfSightRange,
      nightRangeCells: spottedRange.selfSightRange,
      weaponRangeCells: spottedRange.effectiveRange,
      splash: true,
      isCellVisible: spottedRange.isCellVisible,
    },
  ]);
  assert.deepEqual(spottedCommands, [{ type: "attack", unitIds: [barr.id], targetId: enemy.id }]);
});

test("DeterministicSimulation integration: BARR (3) and ATRIL (11) acquire scout-spotted targets via SCGM (5) / ORTU (13) / AVII (24)", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(32, 32));
  const barrId = simulation.addUnit({
    faction: "human",
    team: 0,
    cell: { x: 5, y: 10 },
    unitType: HUMAN_ARTILLERY_UNIT_TYPE,
    sprite: "BARR",
    maxHealth: 400,
    weapon: { damage: 250, rangeCells: 12, cooldownTicks: 10, weaponId: 10 },
  });
  const enemyId = simulation.addUnit({
    faction: "alien",
    team: 1,
    cell: { x: 17, y: 10 }, // dx = 12 from BARR (outside self-sight 4, at max level-0 weapon range 12)
    maxHealth: 800,
  });

  // Without a scout on team 0, BARR effective range is capped to self-sight (4) and cannot acquire enemy at distance 12
  assert.equal(simulation.resolveArtilleryEffectiveRange(barrId)?.hasActiveScout, false);
  assert.equal(simulation.resolveArtilleryEffectiveRange(barrId)?.effectiveRange, 4);
  assert.equal(simulation.canArtilleryAcquireTarget(barrId, enemyId), false);
  simulation.advance();
  assert.equal(simulation.combatEvents.length, 0);
  assert.equal(simulation.snapshot.units.find((u) => u.id === barrId)?.targetId, null);

  // Add allied SCGM scout (unitType 5) on team 0 within observation range (8) of the enemy at (17, 10)
  const scgmId = simulation.addUnit({
    faction: "human",
    team: 0,
    movementPlane: "air",
    cell: { x: 13, y: 10 }, // dx = 4 <= 8 from enemy at (17, 10)
    unitType: HUMAN_SCOUT_UNIT_TYPE,
    sprite: "SCGM",
    maxHealth: 800,
  });

  assert.equal(simulation.resolveArtilleryEffectiveRange(barrId)?.hasActiveScout, true);
  assert.equal(simulation.resolveArtilleryEffectiveRange(barrId)?.effectiveRange, 12);
  assert.equal(simulation.canArtilleryAcquireTarget(barrId, enemyId), true);

  // Checkpoint/restore preserves artillery spotting state
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());

  simulation.advance();
  restored.advance();
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  assert.equal(simulation.snapshot.units.find((u) => u.id === barrId)?.targetId, enemyId);
  assert.deepEqual(simulation.combatEvents, [
    { type: "shot", tick: 1, attackerId: barrId, targetId: enemyId, damage: 250 },
  ]);

  // Removing the scout drops the long-range auto-spotted target on the next advance
  simulation.removeUnit(scgmId);
  assert.equal(simulation.canArtilleryAcquireTarget(barrId, enemyId), false);
  simulation.advance();
  assert.equal(simulation.snapshot.units.find((u) => u.id === barrId)?.targetId, null);
  assert.equal(simulation.snapshot.units.find((u) => u.id === barrId)?.activity, "idle");
});
