import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { copySourceDamageProfile, nativeOrdinaryHitDamage, parseLegacyDamageMatrix, sourceScenarioUpgradeLevels,
  verifiedNativeDamageFromLegacy, verifiedNativeDefenseFromLegacy, VERIFIED_NATIVE_TARGET_TYPES,
  VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, VERIFIED_NATIVE_MBULLET_SHA256,
  type NativeOrdinaryDamageProfile } from "../../src/engine/legacy-balance";
import { NavigationGrid } from "../../src/engine/grid";
import { projectLegacyColony } from "../../src/engine/legacy-colony";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";

const matrix = parseLegacyDamageMatrix(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/MBULLET.TXT", import.meta.url), "ascii"));
const profile: NativeOrdinaryDamageProfile = {
  mode: "verified-native-ordinary", coefficients: matrix[0], sourceTypeIndex: 0, sourceTypeFaction: 0, weaponId: 1,
};

const units = parseUnitStats(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/GAMESTAT.TXT", import.meta.url), "ascii"));
const weapons = parseWeaponStats(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/WEAPSTAT.TXT", import.meta.url), "ascii"));
const scenario = (race: string) => parseScenario(readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${race}/${race}01.SCN`, import.meta.url), "ascii"));
const caller = { caller: "ordinary-direct", inspireTimer: 0 };

test("SCN initial levels preserve ALIEN01 team-0 GRAY upgrades and HUMAN01 zero rows", () => {
  for (const race of ["HUMAN", "ALIEN"]) {
    const parsed = scenario(race);
    for (const team of parsed.teams) {
      assert.equal(team.cityRows.length, 9);
      for (let type = 0; type < 106; type += 1) {
        const levels = sourceScenarioUpgradeLevels(team, type);
        const expected = race === "ALIEN" && team.index === 0 && type === 8 ? 1 : 0;
        assert.equal(levels.weaponLevel, expected);
        assert.equal(levels.armorLevel, expected);
      }
    }
  }
  const levels = sourceScenarioUpgradeLevels(scenario("ALIEN").teams[0], 8);
  const damage = verifiedNativeDamageFromLegacy(units[8], weapons.find(({ id }) => id === 16)!, matrix, levels, caller);
  assert.equal(damage.supported, true);
  if (damage.supported) assert.equal(damage.profile.weaponId, 16);
  assert.deepEqual(verifiedNativeDefenseFromLegacy(units[8], levels),
    { supported: true, profile: { sourceTypeIndex: 8, targetClass: 0, armorFactor: 204 } });
});

test("scenario mapping uses race, row, and owning team without conflating type faction", () => {
  for (const [race, mapping] of [[0, [0, 2, 3, 6, 43, 5, 1, 4]], [1, [8, 10, 11, 14, 44, 13, 9, 12]]] as const) {
    const team = { ...scenario("HUMAN").teams[3], race,
      cityRows: [Array(10).fill(0), ...mapping.map((_, row) => [9, 7, row % 3, (row + 1) % 3, 6])] };
    mapping.forEach((type, row) => {
      assert.deepEqual(sourceScenarioUpgradeLevels(team, type), { team: 3, sourceTypeIndex: type,
        weaponLevel: row % 3, armorLevel: (row + 1) % 3, origin: "scenario-unit-row" });
    });
    assert.deepEqual(sourceScenarioUpgradeLevels(team, race === 0 ? 8 : 0), {
      team: 3, sourceTypeIndex: race === 0 ? 8 : 0, weaponLevel: 0, armorLevel: 0, origin: "type-initialization",
    });
    assert.throws(() => sourceScenarioUpgradeLevels({ ...team, index: 8 }, 0), /source team/);
    assert.throws(() => sourceScenarioUpgradeLevels({ ...team, race: 2 }, 0), /scenario race/);
    assert.throws(() => sourceScenarioUpgradeLevels({ ...team, cityRows: team.cityRows.slice(1) }, 0), /city row/);
    assert.throws(() => sourceScenarioUpgradeLevels({ ...team,
      cityRows: team.cityRows.map((values, row) => row === 1 ? [0, 0, 3, 0, 0] : values) }, 0), /weapon level/);
  }
});

test("exported integration row and checksum match actual MBULLET bytes", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/MBULLET.TXT", import.meta.url))).digest("hex"),
    VERIFIED_NATIVE_MBULLET_SHA256);
  assert.deepEqual(VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, matrix[0]);
  assert.equal(Object.isFrozen(VERIFIED_NATIVE_ORDINARY_COEFFICIENTS), true);
});

test("verified factories cover upgraded infantry, initial commanders, and every proven defense level", () => {
  for (const sourceType of [0, 8, 69, 73]) {
    const unit = units[sourceType];
    for (const weaponLevel of sourceType < 9 ? [0, 1, 2] : [0]) {
      const levels = { ...sourceScenarioUpgradeLevels(scenario("HUMAN").teams[0], sourceType), weaponLevel };
      const weapon = weapons.find(({ id }) => id === unit.weapons[weaponLevel])!;
      const result = verifiedNativeDamageFromLegacy(unit, weapon, matrix, levels, caller);
      if (!result.supported) throw new Error(result.diagnostic);
      for (const targetType of VERIFIED_NATIVE_TARGET_TYPES) {
        for (const armorLevel of [0, 1, 2]) {
          const defense = verifiedNativeDefenseFromLegacy(units[targetType], {
            ...sourceScenarioUpgradeLevels(scenario("HUMAN").teams[1], targetType), armorLevel,
          });
          if (!defense.supported) throw new Error(defense.diagnostic);
          for (const phase of [0, 1] as const) {
            const adverse = phase !== unit.faction;
            const unarmored = Math.floor(matrix[0][units[targetType].targetClass] * weapon.damage / 256);
            const armored = Math.floor(unarmored * defense.profile.armorFactor / 256);
            assert.deepEqual(nativeOrdinaryHitDamage(weapon.damage, result.profile, defense.profile, phase, 3, 7), {
              damage: adverse ? Math.floor(armored * 3 / 4) : armored,
            });
          }
        }
      }
    }
  }
});

test("every HUMAN01/ALIEN01 placement, colony, reinforcement and newtype has an initial profile", () => {
  for (const race of ["HUMAN", "ALIEN"]) {
    const parsed = scenario(race);
    const roster = parsed.placementRows.map((row) => ({ type: row[2], team: row[3] }));
    roster.push(...projectLegacyColony(parsed.teams, units).buildings.map((building) => ({ type: building.unitType, team: building.team })));
    const script = parseTriggerScript(readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${race}/${race}01.TRO`, import.meta.url), "ascii"));
    for (const action of script.flatMap((block) => block.actions)) {
      if (action.name === "reinforce" || action.name === "reinforce2") {
        assert.ok(action.arguments.every((argument) => typeof argument === "number"));
        const args = action.arguments as readonly number[];
        for (let offset = 3; offset + 1 < args.length; offset += 2) {
          if (args[offset + 1] > 0) roster.push({ type: args[offset], team: args[0] });
        }
      } else if (action.name === "newtype") {
        const placement = parsed.placementRows.find((row) => row[0] === action.arguments[0] && row[1] === action.arguments[1]);
        assert.ok(placement);
        assert.equal(typeof action.arguments[2], "number");
        roster.push({ type: action.arguments[2] as number, team: placement[3] });
      }
    }
    const attackers = new Set<number>();
    for (const entity of roster) {
      const unit = units[entity.type];
      const levels = sourceScenarioUpgradeLevels(parsed.teams[entity.team], entity.type);
      assert.equal(verifiedNativeDefenseFromLegacy(unit, levels).supported, true, `${race}: target ${entity.type}`);
      const weaponId = unit.weapons[levels.weaponLevel];
      if (weaponId >= 0) {
        attackers.add(entity.type);
        assert.equal(verifiedNativeDamageFromLegacy(unit, weapons.find(({ id }) => id === weaponId)!, matrix, levels, caller).supported,
          true, `${race}: attacker ${entity.type}, weapon ${weaponId}`);
      }
    }
    assert.deepEqual([...attackers].sort((left, right) => left - right), race === "HUMAN" ? [0, 8, 69] : [0, 8, 69, 73]);
    assert.deepEqual([...new Set(roster.map(({ type }) => type))].sort((left, right) => left - right),
      race === "HUMAN" ? [0, 8, 16, 17, 69, 81, 84, 95] : [0, 8, 69, 73, 82, 89]);
  }
});

test("runtime profiles match the independently executed native upgraded-hit report", {
  skip: process.env.DC_NATIVE_HIT_REPORT ? false : "set DC_NATIVE_HIT_REPORT to the upgraded x86 probe JSON",
}, () => {
  const report = JSON.parse(readFileSync(process.env.DC_NATIVE_HIT_REPORT!, "utf8")) as {
    executableSha256: string; sourceHashes: Record<string, string>; hitCount: number;
    hits: { sourceType: number; weaponLevel: number; weapon: number; targetType: number; armorLevel: number;
      phase: 0 | 1; sourceTeam: number; targetTeam: number; damage: number }[];
  };
  assert.equal(report.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  for (const name of ["GAMESTAT.TXT", "WEAPSTAT.TXT", "MBULLET.TXT", "BOOMSTAT.TXT"]) {
    assert.equal(report.sourceHashes[name], createHash("sha256").update(
      readFileSync(new URL(`../../raw_cd/DC/GAMESTAT/${name}`, import.meta.url))).digest("hex"));
  }
  assert.equal(report.hitCount, 3456);
  assert.equal(report.hits.length, report.hitCount);
  for (const hit of report.hits) {
    const weapon = weapons.find(({ id }) => id === hit.weapon)!;
    const sourceLevels = { team: hit.sourceTeam, sourceTypeIndex: hit.sourceType, weaponLevel: hit.weaponLevel,
      armorLevel: 0, origin: "type-initialization" as const };
    const source = verifiedNativeDamageFromLegacy(units[hit.sourceType], weapon, matrix, sourceLevels, caller);
    const defense = verifiedNativeDefenseFromLegacy(units[hit.targetType], { ...sourceLevels,
      team: hit.targetTeam, sourceTypeIndex: hit.targetType, armorLevel: hit.armorLevel });
    if (!source.supported || !defense.supported) throw new Error(JSON.stringify({ source, defense, hit }));
    assert.deepEqual(nativeOrdinaryHitDamage(weapon.damage, source.profile, defense.profile, hit.phase, hit.sourceTeam, hit.targetTeam),
      { damage: hit.damage }, JSON.stringify(hit));
  }
});

test("upgraded and commander simulation hits use type faction, including class-6 objectives and class-8 zero hits", () => {
  const parsed = scenario("ALIEN");
  for (const sourceType of [8, 69, 73]) {
    const sourceTeam = sourceType === 69 ? 1 : 0;
    const levels = sourceScenarioUpgradeLevels(parsed.teams[sourceTeam], sourceType);
    const weapon = weapons.find(({ id }) => id === units[sourceType].weapons[levels.weaponLevel])!;
    const source = verifiedNativeDamageFromLegacy(units[sourceType], weapon, matrix, levels, caller);
    if (!source.supported) throw new Error(source.diagnostic);
    for (const [targetType, targetTeam, favorable, adverse] of sourceType === 8
      ? [[0, 1, 31, 23], [82, 1, 5, 3], [89, 1, 0, 0]]
      : sourceType === 69 ? [[8, 0, 31, 23], [82, 0, 7, 5], [81, 0, 0, 0]]
        : [[8, 2, 40, 30], [82, 1, 7, 5], [89, 1, 0, 0]]) {
      for (const phase of [0, 1] as const) {
        const defense = verifiedNativeDefenseFromLegacy(units[targetType], sourceScenarioUpgradeLevels(parsed.teams[targetTeam], targetType));
        if (!defense.supported) throw new Error(defense.diagnostic);
        const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), {
          sourceDayNightHeader: ["fixture", String(phase), "10", "4", "2"],
        });
        const attacker = simulation.addUnit({ faction: units[sourceType].faction === 0 ? "alien" : "human",
          team: sourceTeam, cell: { x: 0, y: 0 }, weapon: { damage: weapon.damage, rangeCells: 4, cooldownTicks: 2, sourceDamage: source.profile } });
        const targetId = simulation.addStaticTarget({ faction: "human", team: targetTeam,
          cell: { x: 1, y: 0 }, maxHealth: 800, health: 100, sourceDefense: defense.profile });
        simulation.queue({ type: "attack", unitIds: [attacker], targetId });
        simulation.advance();
        const damage = phase === units[sourceType].faction ? favorable : adverse;
        assert.deepEqual(simulation.combatEvents.map((event) => event.damage), [damage]);
        assert.equal(simulation.snapshot.staticTargets[0].health, 100 - damage);
        assert.deepEqual(simulation.sourceDamageDiagnostics, []);
        simulation.advance();
        assert.deepEqual(simulation.combatEvents, []);
      }
    }
  }
});

test("unsupported caller, data, type, and upgrade inputs are diagnosed", () => {
  const unit = units[0];
  const weapon = weapons.find(({ id }) => id === 1)!;
  const levels = sourceScenarioUpgradeLevels(scenario("HUMAN").teams[0], 0);
  for (const result of [
    verifiedNativeDamageFromLegacy(unit, weapon, matrix, levels, { ...caller, inspireTimer: 1 }),
    verifiedNativeDamageFromLegacy(unit, weapon, matrix, levels, { ...caller, caller: "area-effect" }),
    verifiedNativeDamageFromLegacy(unit, { ...weapon, shots: 1 }, matrix, levels, caller),
    verifiedNativeDamageFromLegacy(unit, { ...weapon, id: 2 }, matrix, levels, caller),
    verifiedNativeDamageFromLegacy(unit, weapon, matrix, { ...levels, team: 8 }, caller),
    verifiedNativeDamageFromLegacy(unit, weapon, matrix, { ...levels, weaponLevel: 1 }, caller),
    verifiedNativeDamageFromLegacy({ ...unit, faction: 1 }, weapon, matrix, levels, caller),
    verifiedNativeDamageFromLegacy(unit, weapon, matrix.map(() => Array(10).fill(256)), levels, caller),
    verifiedNativeDefenseFromLegacy(units[1], { ...levels, sourceTypeIndex: 1 }),
    ...[-1, 3, 0.5, NaN].flatMap((level) => [
      verifiedNativeDamageFromLegacy(unit, weapon, matrix, { ...levels, weaponLevel: level }, caller),
      verifiedNativeDefenseFromLegacy(unit, { ...levels, armorLevel: level }),
    ]),
    verifiedNativeDamageFromLegacy(units[69], weapons.find(({ id }) => id === 8)!, matrix,
      { ...levels, sourceTypeIndex: 69, weaponLevel: 1 }, caller),
    verifiedNativeDamageFromLegacy(units[73], weapons.find(({ id }) => id === 6)!, matrix,
      { ...levels, sourceTypeIndex: 73, weaponLevel: 2 }, caller),
    verifiedNativeDefenseFromLegacy({ ...units[82], targetClass: 9 }, { ...levels, sourceTypeIndex: 82 }),
    verifiedNativeDefenseFromLegacy({ ...unit, armorUpgradePercentages: [120, 140] }, levels),
  ]) {
    assert.equal(result.supported, false);
    if (!result.supported) assert.match(result.diagnostic, /^unsupported-native-/);
  }
  assert.throws(() => copySourceDamageProfile({ ...profile, sourceTypeFaction: 1 }), /source type/);
  assert.throws(() => copySourceDamageProfile({ ...profile, coefficients: Array(10).fill(256) }), /coefficient row/);
  assert.deepEqual(nativeOrdinaryHitDamage(125, profile, { sourceTypeIndex: 0, targetClass: 0, armorFactor: 204 }, 0, 0, 1),
    { diagnostic: "unsupported-native-base-damage" });
  assert.deepEqual(nativeOrdinaryHitDamage(100, profile, { sourceTypeIndex: 0, targetClass: 0, armorFactor: 213 }, 0, 0, 1),
    { diagnostic: "unsupported-native-defense" });
});

test("live mode never silently falls back when phase, team, or certified defense is absent", () => {
  for (const failure of ["phase", "team", "defense", "armor", "base"]) {
    const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), failure === "phase" ? {} : {
      sourceDayNightHeader: ["fixture", "0", "4", "3", "2"],
    });
    const attacker = simulation.addUnit({ faction: "human", team: failure === "team" ? 8 : 0, cell: { x: 0, y: 0 },
      weapon: { damage: failure === "base" ? 101 : 100, rangeCells: 4, cooldownTicks: 1, sourceDamage: profile } });
    const targetId = simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 1, y: 0 }, maxHealth: 800,
      ...(failure === "defense" ? {} : { sourceDefense: { sourceTypeIndex: 16, targetClass: 9, armorFactor: failure === "armor" ? 214 : 256 } }) });
    simulation.queue({ type: "attack", unitIds: [attacker], targetId });
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
    assert.equal(simulation.snapshot.staticTargets[0].health, 800);
    assert.equal(simulation.sourceDamageDiagnostics.length, 1);
    assert.equal(simulation.sourceDamageDiagnostics[0].targetId, targetId);
    simulation.advance();
    assert.equal(simulation.sourceDamageDiagnostics.length, 1);
  }
});

test("live hit uses native phase at transition start, independent of ownership race and brightness", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), {
    sourceDayNightHeader: ["fixture", "0", "4", "3", "2"],
  });
  const attacker = simulation.addUnit({ faction: "alien", team: 3, cell: { x: 0, y: 0 },
    weapon: { damage: 100, rangeCells: 4, cooldownTicks: 1, sourceDamage: profile } });
  const targetId = simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 1, y: 0 }, maxHealth: 800,
    sourceDefense: { sourceTypeIndex: 16, targetClass: 9, armorFactor: 256 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId });
  simulation.advance();
  assert.equal(simulation.combatEvents[0].damage, 4);
  simulation.advance();
  assert.equal(simulation.sourceDayNight!.phase, 1);
  assert.equal(simulation.sourceDayNight!.blend, 0);
  assert.equal(simulation.snapshot.daylightPermille, 1000);
  assert.equal(simulation.combatEvents[0].damage, 3);
  assert.equal(simulation.snapshot.staticTargets[0].health, 793);
});

test("live hits preserve simultaneous overkill, health overrides, death events, and footprint release", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 2), {
    sourceDayNightHeader: ["fixture", "0", "10", "4", "2"],
  });
  const mutableProfile = { ...profile, coefficients: [...profile.coefficients] };
  const attackers = [0, 1].map((row) => simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: row },
    weapon: { damage: 100, rangeCells: 4, cooldownTicks: 1, sourceDamage: mutableProfile } }));
  mutableProfile.coefficients.fill(0);
  const cell = { x: 2, y: 0 };
  const priorCost = simulation.grid.costs[2];
  const targetId = simulation.addStaticTarget({ faction: "alien", team: 1, cell, maxHealth: 400, health: 7, footprint: [cell],
    sourceDefense: { sourceTypeIndex: 16, targetClass: 9, armorFactor: 256 } });
  simulation.queue({ type: "attack", unitIds: attackers, targetId });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.map(({ damage }) => damage), [4, 4]);
  assert.deepEqual(simulation.deathEvents, [{ type: "death", tick: 0, targetId }]);
  assert.equal(simulation.snapshot.staticTargets[0].health, 0);
  assert.equal(simulation.snapshot.staticTargets[0].maxHealth, 400);
  assert.equal(simulation.grid.costs[2], priorCost);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, []);
  assert.deepEqual(simulation.deathEvents, []);
});

test("live profiles do not bypass diplomacy or range guards", () => {
  for (const targetTeam of [0, 1, 2]) {
    const simulation = new DeterministicSimulation(new NavigationGrid(8, 1), {
      teamAlliances: [[0, 1]], sourceDayNightHeader: ["fixture", "0", "10", "4", "2"],
    });
    const attacker = simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: 0 },
      weapon: { damage: 100, rangeCells: 1, cooldownTicks: 1, sourceDamage: profile } });
    const targetId = simulation.addUnit({ faction: "alien", team: targetTeam,
      cell: { x: targetTeam === 2 ? 7 : 1, y: 0 }, maxHealth: 800,
      sourceDefense: { sourceTypeIndex: 8, targetClass: 0, armorFactor: 256 } });
    simulation.queue({ type: "attack", unitIds: [attacker], targetId });
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
    assert.deepEqual(simulation.sourceDamageDiagnostics, []);
    assert.equal(simulation.snapshot.units[1].health, 800);
  }
});