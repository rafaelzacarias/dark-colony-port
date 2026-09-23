import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  calculateLegacyDamage, copySourceDamageProfile, defenseOptionsFromLegacy, nativeOrdinaryHitDamage,
  parseLegacyDamageMatrix, sourceScenarioUpgradeLevels, unitOptionsFromLegacy,
  verifiedNativeDamageFromLegacy, verifiedNativeDefenseFromLegacy, VERIFIED_NATIVE_TARGET_TYPES,
} from "../../src/engine/legacy-balance";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";

const root = new URL("../../", import.meta.url);
const table = (name: string) => readFileSync(new URL(`raw_cd/DC/GAMESTAT/${name}`, root));
const units = parseUnitStats(table("GAMESTAT.TXT").toString("ascii"));
const weapons = parseWeaponStats(table("WEAPSTAT.TXT").toString("ascii"));
const matrix = parseLegacyDamageMatrix(table("MBULLET.TXT").toString("ascii"));
const caller = { caller: "ordinary-direct", inspireTimer: 0 };
const newTypes = [2, 4, 10, 12];
const newTargets = [2, 4, 10, 12, 83, 87, 88, 97, 98];
const levels = (sourceTypeIndex: number, weaponLevel = 0, armorLevel = 0, team = 0) => ({
  team, sourceTypeIndex, weaponLevel, armorLevel, origin: "type-initialization" as const,
});

interface NativeHit {
  sourceType: number; weaponLevel: number; weapon: number; targetType: number; armorLevel: number;
  phase: 0 | 1; sourceTeam: number; targetTeam: number; damage: number; callerFactor: number;
  flag: number; weaponPointer: number; armorFactor: number; coefficient: number;
  healthBefore: number; healthAfter: number;
}

interface NativeReport {
  executableSha256: string; sourceHashes: Record<string, string>; hitCount: number; hits: NativeHit[];
  sources: { type: number; typeFaction: number; level: number; weapon: number; class: number;
    baseDamage: number; boomProfile: number; boomDimension: number; burstCount: number; burstDelay: number }[];
  defenses: { type: number; class: number; weapons: number[]; armorFactors: number[] }[];
  routeCounts: Record<string, number>;
  scenarios: { path: string; sha256: string; teams: { team: number; race: number; unitRows: number[][];
    scannedUnitRows: number[][]; levelBytesSha256: string }[] }[];
}

let report: NativeReport;
function nativeReport(): NativeReport {
  if (!report) {
    const text = process.env.DC_ADDITIONAL_ORDINARY_REPORT
      ? readFileSync(process.env.DC_ADDITIONAL_ORDINARY_REPORT, "utf8")
      : execFileSync("python3", ["-B", fileURLToPath(new URL("tools/research/live-native-upgraded-hit-20260919.py", root)),
        "--additional-profiles"], {
        encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH, "/tmp/dc-re-capstone-20260918",
          "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") },
      });
    report = JSON.parse(text) as NativeReport;
  }
  return report;
}

test("additional ordinary profiles: original x86 HP and call arguments agree across all source classes", () => {
  const evidence = nativeReport();
  assert.equal(evidence.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(createHash("sha256").update(readFileSync(new URL("raw_cd/DC/DC.EXE", root))).digest("hex"), evidence.executableSha256);
  for (const name of ["GAMESTAT.TXT", "WEAPSTAT.TXT", "MBULLET.TXT", "BOOMSTAT.TXT"]) {
    assert.equal(evidence.sourceHashes[name], createHash("sha256").update(table(name)).digest("hex"));
  }
  assert.equal(evidence.hitCount, 20 * 106 * 3 * 2 * 3);
  assert.equal(evidence.hits.length, evidence.hitCount);
  assert.equal(evidence.sources.length, 20);
  assert.equal(evidence.defenses.length, 106);
  assert.deepEqual(evidence.routeCounts, {
    "0x442767": evidence.hitCount, "0x442775": evidence.hitCount, "0x441930": evidence.hitCount,
    "0x441a38": evidence.hitCount, "0x441bec": 0,
  });
  assert.deepEqual([...new Set(evidence.defenses.map(defense => defense.class))].sort((left, right) => left - right),
    Array.from({ length: 10 }, (_, index) => index));
  for (const source of evidence.sources) {
    const stat = units[source.type], weapon = weapons.find(entry => entry.id === source.weapon)!;
    assert.equal(stat.weapons[source.level], source.weapon);
    assert.equal(stat.faction, source.typeFaction);
    assert.deepEqual([weapon.rawPrefix, weapon.damage, weapon.shots, weapon.reload, weapon.magicChewing],
      [source.class, source.baseDamage, source.boomProfile, source.burstCount, source.burstDelay]);
    assert.deepEqual([source.boomProfile, source.boomDimension, source.burstCount, source.burstDelay], [0, 1, -1, -1]);
  }
  for (const defense of evidence.defenses) {
    assert.equal(defense.class, units[defense.type].targetClass);
    assert.deepEqual(defense.weapons, units[defense.type].weapons);
    assert.deepEqual(defense.armorFactors,
      [0, 1, 2].map(armorLevel => defenseOptionsFromLegacy(units[defense.type], armorLevel).armorFactor));
  }
  const seen = new Set<string>();
  let admitted = 0;
  for (const hit of evidence.hits) {
    const key = [hit.sourceType, hit.weaponLevel, hit.targetType, hit.armorLevel, hit.phase, hit.sourceTeam, hit.targetTeam].join(":");
    assert.equal(seen.has(key), false, key);
    seen.add(key);
    const weapon = weapons.find(entry => entry.id === hit.weapon)!;
    const source = verifiedNativeDamageFromLegacy(units[hit.sourceType], weapon, matrix,
      levels(hit.sourceType, hit.weaponLevel, 0, hit.sourceTeam), caller);
    assert.ok(source.supported, key);
    const defense = defenseOptionsFromLegacy(units[hit.targetType], hit.armorLevel);
    assert.deepEqual([hit.callerFactor, hit.flag, hit.weaponPointer, hit.armorFactor, hit.coefficient],
      [256, Number(units[hit.sourceType].faction !== hit.phase), 0x4f0200 + hit.weapon * 72,
        defense.armorFactor, matrix[weapon.rawPrefix][defense.targetClass]], key);
    assert.equal(hit.healthBefore, 10000);
    assert.equal(hit.healthBefore - hit.healthAfter, hit.damage, key);
    assert.equal(calculateLegacyDamage(weapon.damage, { coefficients: matrix[weapon.rawPrefix],
      callerFactor: 256, specialFlag: hit.flag !== 0 }, defense), hit.damage, key);
    const verified = verifiedNativeDefenseFromLegacy(units[hit.targetType],
      levels(hit.targetType, 0, hit.armorLevel, hit.targetTeam));
    assert.equal(verified.supported, VERIFIED_NATIVE_TARGET_TYPES.includes(hit.targetType), key);
    if (verified.supported) {
      assert.deepEqual(nativeOrdinaryHitDamage(weapon.damage, source.profile, verified.profile,
        hit.phase, hit.sourceTeam, hit.targetTeam), { damage: hit.damage }, key);
      admitted++;
    }
  }
  assert.equal(admitted, 20 * VERIFIED_NATIVE_TARGET_TYPES.length * 18);
});

test("additional ordinary profiles: initial SCN upgrades match original scanner bytes for all four missions", () => {
  const scenarios = nativeReport().scenarios;
  assert.deepEqual(scenarios.map(scenario => scenario.path), [
    "raw_cd/DC/SCENARIO/HUMAN/HUMAN01.SCN", "raw_cd/DC/SCENARIO/ALIEN/ALIEN01.SCN",
    "raw_cd/DC/SCENARIO/HUMAN/HUMAN11.SCN", "raw_cd/DC/SCENARIO/ALIEN/ALIEN14.SCN",
  ]);
  for (const scenario of scenarios) {
    const bytes = readFileSync(new URL(scenario.path, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), scenario.sha256);
    const parsed = parseScenario(bytes.toString("ascii"));
    assert.equal(scenario.teams.length, 8);
    for (const team of scenario.teams) {
      const source = parsed.teams[team.team];
      assert.equal(source.race, team.race);
      assert.deepEqual(source.cityRows.slice(1), team.scannedUnitRows);
      assert.deepEqual(team.scannedUnitRows, team.unitRows);
      const levelBytes = Buffer.alloc(106 * 16);
      for (const unit of units) {
        const upgrade = sourceScenarioUpgradeLevels(source, unit.index);
        levelBytes[unit.index * 16 + team.team] = upgrade.weaponLevel;
        levelBytes[unit.index * 16 + team.team + 8] = upgrade.armorLevel;
      }
      assert.equal(createHash("sha256").update(levelBytes).digest("hex"), team.levelBytesSha256,
        `${scenario.path}: team ${team.team}`);
    }
  }
});

test("additional ordinary profiles: defense, source faction, weapon row, effect and burst gates remain separate", () => {
  for (const type of newTargets) {
    for (const armorLevel of [0, 1, 2]) {
      const result = verifiedNativeDefenseFromLegacy(units[type], levels(type, 0, armorLevel));
      assert.ok(result.supported);
      assert.deepEqual(result.profile, { ...defenseOptionsFromLegacy(units[type], armorLevel), sourceTypeIndex: type });
      assert.equal(verifiedNativeDefenseFromLegacy({ ...units[type], targetClass: (units[type].targetClass + 1) % 10 },
        levels(type, 0, armorLevel)).supported, false);
      assert.equal(verifiedNativeDefenseFromLegacy({ ...units[type], armorUpgradePercentages: [100, 100] },
        levels(type, 0, armorLevel)).supported, false);
    }
  }
  for (const type of newTypes) {
    for (const weaponLevel of [0, 1, 2]) {
      const unit = units[type], upgrade = levels(type, weaponLevel);
      const weapon = weapons.find(entry => entry.id === unit.weapons[weaponLevel])!;
      const result = verifiedNativeDamageFromLegacy(unit, weapon, matrix, upgrade, caller);
      assert.ok(result.supported);
      assert.deepEqual(result.profile.coefficients, matrix[weapon.rawPrefix]);
      assert.ok(Object.isFrozen(result.profile.coefficients));
      const defense = verifiedNativeDefenseFromLegacy(unit, upgrade);
      assert.ok(defense.supported);
      assert.deepEqual(nativeOrdinaryHitDamage(weapon.damage, result.profile, defense.profile, 0, 0, 1, 332),
        { diagnostic: "unsupported-native-caller-or-inspire" });
      for (const altered of [
        { ...weapon, rawPrefix: 0 }, { ...weapon, shots: 1 }, { ...weapon, shots: undefined },
        { ...weapon, reload: 3 }, { ...weapon, reload: undefined },
        { ...weapon, magicChewing: 30 }, { ...weapon, magicChewing: undefined }, { ...weapon, damage: weapon.damage + 1 },
      ]) assert.equal(verifiedNativeDamageFromLegacy(unit, altered, matrix, upgrade, caller).supported, false);
      assert.equal(verifiedNativeDamageFromLegacy({ ...unit, faction: 1 - unit.faction }, weapon, matrix, upgrade, caller).supported, false);
      for (const state of [{ caller: "area-effect", inspireTimer: 0 }, { caller: "ordinary-direct", inspireTimer: 1 }]) {
        assert.equal(verifiedNativeDamageFromLegacy(unit, weapon, matrix, upgrade, state).supported, false);
      }
      for (let column = 0; column < 10; column++) {
        const altered = matrix.map(row => [...row]);
        altered[weapon.rawPrefix][column]++;
        assert.equal(verifiedNativeDamageFromLegacy(unit, weapon, altered, upgrade, caller).supported, false);
        assert.throws(() => copySourceDamageProfile({ ...result.profile, coefficients: altered[weapon.rawPrefix] }), /coefficient row/);
      }
      assert.throws(() => copySourceDamageProfile({ ...result.profile, coefficients: matrix[0] }), /coefficient row/);
    }
  }
  for (const type of [3, 5, 11, 13]) {
    const weapon = weapons.find(entry => entry.id === units[type].weapons[0])!;
    assert.equal(verifiedNativeDamageFromLegacy(units[type], weapon, matrix, levels(type), caller).supported, false);
  }
  for (const type of [83, 87, 88, 97, 98]) {
    assert.deepEqual(units[type].weapons, [-1, -1, -1]);
    assert.equal(verifiedNativeDamageFromLegacy(units[type], weapons[0], matrix, levels(type), caller).supported, false);
  }
  assert.throws(() => unitOptionsFromLegacy(units[2], weapons.filter(weapon => weapon.id !== 7)), /missing weapon 7/);
});

test("additional ordinary profiles: simulation hits retain native HP for new mobile and static defenses", () => {
  const hits = nativeReport().hits.filter(hit => newTypes.includes(hit.sourceType) && newTargets.includes(hit.targetType)
    && hit.sourceTeam === 0 && hit.targetTeam === 1);
  assert.equal(hits.length, 12 * 9 * 3 * 2);
  for (const hit of hits) {
    const weapon = weapons.find(entry => entry.id === hit.weapon)!;
    const source = verifiedNativeDamageFromLegacy(units[hit.sourceType], weapon, matrix,
      levels(hit.sourceType, hit.weaponLevel), caller);
    const defense = verifiedNativeDefenseFromLegacy(units[hit.targetType], levels(hit.targetType, 0, hit.armorLevel, 1));
    assert.ok(source.supported && defense.supported);
    const simulation = new DeterministicSimulation(new NavigationGrid(3, 1), {
      sourceDayNightHeader: ["fixture", String(hit.phase), "10", "4", "2"],
    });
    const attacker = simulation.addUnit({ faction: units[hit.sourceType].faction ? "human" : "alien", team: 0,
      cell: { x: 0, y: 0 }, weapon: { damage: weapon.damage, rangeCells: weapon.range,
        cooldownTicks: weapon.rateOfFire, sourceDamage: source.profile } });
    const targetOptions = { faction: "alien" as const, team: 1, cell: { x: 1, y: 0 },
      maxHealth: hit.healthBefore, sourceDefense: defense.profile };
    const target = units[hit.targetType].movementSpeed === 0
      ? simulation.addStaticTarget(targetOptions) : simulation.addUnit(targetOptions);
    simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
    simulation.advance();
    const snapshot = simulation.snapshot;
    assert.equal([...snapshot.units, ...snapshot.staticTargets].find(actor => actor.id === target)!.health, hit.healthAfter);
    assert.deepEqual(simulation.combatEvents.map(event => event.damage), [hit.damage]);
    assert.deepEqual(simulation.sourceDamageDiagnostics, []);
    assert.deepEqual(copySourceDamageProfile(JSON.parse(JSON.stringify(source.profile))), source.profile);
  }
});

test("additional ordinary profiles: strict checkpoint accepts verified pairs and rejects forged profiles", () => {
  let combinations = 0;
  for (const type of [0, 2, 4, 8, 10, 12, 69, 73]) {
    for (const weaponLevel of type >= 69 ? [0] : [0, 1, 2]) {
      const unit = units[type], upgrade = levels(type, weaponLevel);
      const weapon = weapons.find(entry => entry.id === unit.weapons[weaponLevel])!;
      const damage = verifiedNativeDamageFromLegacy(unit, weapon, matrix, upgrade, caller);
      const defense = verifiedNativeDefenseFromLegacy(unit, upgrade);
      assert.ok(damage.supported && defense.supported);
      const simulation = new DeterministicSimulation(new NavigationGrid(8, 3));
      const actor = simulation.addUnit({ faction: unit.faction ? "alien" : "human", team: 0,
        cell: { x: 1, y: 1 }, sourceDefense: defense.profile,
        weapon: { damage: weapon.damage, rangeCells: weapon.range, cooldownTicks: weapon.rateOfFire,
          sourceDamage: damage.profile } });
      simulation.queue({ type: "move", unitIds: [actor], target: { x: 6, y: 1 } });
      simulation.advance();
      const saved = simulation.checkpoint();
      const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(saved)));
      assert.deepEqual(restored.checkpoint(), saved);
      for (let tick = 0; tick < 3; tick++) {
        simulation.advance(); restored.advance();
        assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
      }
      for (const alteration of [
        { sourceTypeIndex: 3 }, { sourceTypeIndex: 83 }, { sourceTypeIndex: 65535 },
        { sourceTypeIndex: String(type) }, { sourceTypeFaction: 1 - unit.faction },
        { weaponId: type === 0 ? 7 : 1 }, { weaponId: 65535 }, { weaponId: 1.5 },
        { coefficients: damage.profile.coefficients.map((value, index) => value + Number(index === 0)) },
        { callerFactor: 256 }, { mode: "unverified" },
      ]) {
        const tampered = JSON.parse(JSON.stringify(saved));
        Object.assign(tampered.units[0].weapon.sourceDamage, alteration);
        assert.throws(() => DeterministicSimulation.restore(tampered),
          /Invalid simulation checkpoint|unsupported native ordinary/, `${type}:${weapon.id} ${JSON.stringify(alteration)}`);
        assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
      }
      combinations++;
    }
  }
  assert.equal(combinations, 20);
});

test("additional ordinary profiles: full HUMAN11 and ALIEN14 construct without dropping actors or weapons", async context => {
  const originalFetch = globalThis.fetch;
  const mobileOptions = new Map<number, Parameters<DeterministicSimulation["addUnit"]>[0]>();
  const staticOptions = new Map<number, Parameters<DeterministicSimulation["addStaticTarget"]>[0]>();
  const addUnit = DeterministicSimulation.prototype.addUnit;
  const addStaticTarget = DeterministicSimulation.prototype.addStaticTarget;
  context.mock.method(DeterministicSimulation.prototype, "addUnit", function (this: DeterministicSimulation,
    options: Parameters<DeterministicSimulation["addUnit"]>[0]) {
    const id = addUnit.call(this, options);
    mobileOptions.set(id, options);
    return id;
  });
  context.mock.method(DeterministicSimulation.prototype, "addStaticTarget", function (this: DeterministicSimulation,
    options: Parameters<DeterministicSimulation["addStaticTarget"]>[0]) {
    const id = addStaticTarget.call(this, options);
    staticOptions.set(id, options);
    return id;
  });
  globalThis.fetch = async input => new Response(readFileSync(new URL(`public${String(input)}`, root)));
  try {
    for (const [faction, number, expectedMobile, mobileCount, staticCount] of [
      ["human", 11, [0, 2, 8, 10, 12], 92, 16], ["alien", 14, [0, 2, 4, 8, 10], 66, 12],
    ] as const) {
      mobileOptions.clear();
      staticOptions.clear();
      const mission = await loadCampaignMission(faction, number);
      const source = JSON.stringify({ scenario: mission.scenario, triggers: mission.triggers });
      const view = new MissionView({ width: 512, height: 452, getContext: () => null } as unknown as HTMLCanvasElement,
        {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
      try {
        assert.equal(view.missionDiagnostic, undefined);
        const world = view.campaignSnapshot!.world, simulation = view.simulation.snapshot;
        const living = world.entities.filter(entity => entity.health > 0);
        assert.deepEqual([world.entities.length, simulation.units.length, simulation.staticTargets.length],
          [mobileCount + staticCount, mobileCount, staticCount]);
        assert.equal(view.nativeBindings.length, living.length);
        assert.equal(simulation.units.length + simulation.staticTargets.length, living.length);
        const mobileTypes = new Set<number>();
        for (const entity of living) {
          const binding = view.nativeBindings.find(candidate => candidate.slot === entity.rawSlot)!;
          assert.ok(binding, entity.key);
          const projected = [...simulation.units, ...simulation.staticTargets].find(actor => actor.id === binding.simulationId)!;
          assert.equal(projected.health, entity.health, entity.key);
          const stat = mission.units[entity.unitType];
          const upgrade = sourceScenarioUpgradeLevels(mission.scenario.teams[entity.team], stat.index);
          const defense = verifiedNativeDefenseFromLegacy(stat, upgrade);
          assert.ok(defense.supported);
          const options = mobileOptions.get(projected.id) ?? staticOptions.get(projected.id)!;
          assert.deepEqual(options.sourceDefense, defense.profile);
          if (stat.movementSpeed > 0) {
            mobileTypes.add(stat.index);
            const unit = mobileOptions.get(projected.id)!;
            const weaponId = stat.weapons[upgrade.weaponLevel];
            assert.ok(weaponId >= 0 && unit.weapon, `${entity.key}: must not silently disarm`);
            const weapon = mission.weapons.find(entry => entry.id === weaponId)!;
            const damage = verifiedNativeDamageFromLegacy(stat, weapon, mission.damageMatrix!, upgrade, caller);
            assert.ok(damage.supported);
            assert.deepEqual(unit.weapon.sourceDamage, damage.profile);
            assert.equal(unit.weapon.damage, weapon.damage);
          }
        }
        for (const type of expectedMobile) assert.ok(mobileTypes.has(type), `${faction}${number}: missing type ${type}`);
        assert.equal(JSON.stringify({ scenario: mission.scenario, triggers: mission.triggers }), source);
        assert.equal(simulation.tick, 0);
        const saved = JSON.parse(JSON.stringify(view.checkpoint()));
        const restored = MissionView.restore({ width: 512, height: 452, getContext: () => null } as unknown as HTMLCanvasElement,
          {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved);
        try { assert.deepEqual(restored.checkpoint(), saved); }
        finally { restored.dispose(); }
        context.diagnostic(`${faction}${number}: ${world.entities.length} source actors, ${simulation.units.length} mobile, ${simulation.staticTargets.length} static; fresh checkpoint/restore exact`);
      } finally { view.dispose(); }
    }
  } finally { globalThis.fetch = originalFetch; }
});