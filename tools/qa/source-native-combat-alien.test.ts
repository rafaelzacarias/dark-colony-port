import assert from "node:assert/strict";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import test from "node:test";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { createSourceNativeCombatProof, composeSourceNativeCombatProof } from "../../src/engine/source-native-combat-options";
import { createSourceNativeCombatOptions, createSourceNativeCombatOwner, retainSourceNativeCombatConfiguration,
  validateSourceNativeCombatConfiguration, sourceNativeCombatVisitWorld,
  stepSourceNativeCombatProjectiles, guardSourceNativeProjectileGeometry } from "../../src/engine/source-native-combat-host";
import { createSourceNativeTaskOptions, isImmutableSourceNativeTaskConfiguration,
  withSourceNativeCombatTasks } from "../../src/engine/source-native-task-options";
import { reduceLegacyAiRegisteredVisit } from "../../src/engine/legacy-ai-task";
import type { LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";
import { nativeProofTrace } from "./fixtures/native-proof-trace";

async function fixture(faction: "ALIEN" | "HUMAN" = "ALIEN") {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const raw = (path: string) => read(`raw_cd/DC/${path}`);
  const scenario = (extension: string) => raw(`SCENARIO/${faction}/${faction}02.${extension}`);
  const troop = faction === "ALIEN" ? "GRAY" : "TRSC", animationRegistry = raw("ANIM.DAT");
  const assets = { executable: raw("DC.EXE"), gameStat: raw("GAMESTAT/GAMESTAT.TXT"), weaponStat: raw("GAMESTAT/WEAPSTAT.TXT"),
    boomStat: raw("GAMESTAT/BOOMSTAT.TXT"), damageMatrix: raw("GAMESTAT/MBULLET.TXT"), scenario: scenario("SCN"),
    map: scenario("MAP"), mtg: scenario("MTG"), pth: scenario("PTH"), troopFin: raw(`ANIMATE/${troop}.FIN`),
    troopSprite: raw(`SPRITES/${troop}.SPR`), animationRegistry,
    registryFins: Object.fromEntries(animationRegistry.toString().trim().split(/\s+/).map(name =>
      [name.toUpperCase(), raw(`ANIMATE/${name.toUpperCase()}`)])),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem =>
      [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const initial = initializeCampaignSession({ sessionId: `combat-provider-${faction}`, source: parseScenario(assets.scenario.toString()),
    units: parseUnitStats(assets.gameStat.toString()), weapons: parseWeaponStats(assets.weaponStat.toString()),
    triggers: [], messages: [], map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: faction === "ALIEN" ? 73 : 69, sprite: troop }],
    directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1, resourceScales: "configured-startup" });
  assert.ok(initial.ok, JSON.stringify(initial));
  const world = initial.value.world, before = structuredClone(world);
  const configuration = await createSourceNativeTaskOptions({ assets, world });
  const proof = await createSourceNativeCombatProof(assets);
  const options = await createSourceNativeCombatOptions({ configuration, proof });
  assert.deepEqual(world, before, "provider composition never changes the source world");
  return { assets, world, configuration, proof, ...options };
}

async function nativeBaseProjectile() {
  const path = nativeProofTrace(process.env.DC_SOURCE_NATIVE_ALIEN_COMBAT_TRACE,
    "source-native-combat-alien-native.py");
  const stream = createReadStream(path), lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const evidence = JSON.parse(line);
      if (evidence.world.typeId === 8 && !evidence.activity && !evidence.repeated && !evidence.receipt
        && evidence.projectile.policy === 1 && evidence.projectile.fixture.policy === null
        && evidence.projectile.fire.nearbyEnemy.enemyRaw[6] === 8)
        return { ...evidence.projectile, damaged: evidence };
    }
  } finally { lines.close(); stream.destroy(); }
  throw new Error("native base type8 projectile capture required");
}

test("ALIEN provider composes all original teams without changing other profiles or authenticating copied proofs", async () => {
  const source = await fixture();
  const { configuration, proof, nativeAiTasks, nativeCombat } = source;
  assert.equal(source.world.entities.length, 44);
  assert.deepEqual(nativeAiTasks.bindings, configuration.bindings);
  assert.equal(nativeCombat.scope, "source-separated-type8-weapon15-nonlethal");
  assert.equal(nativeCombat.sourceType, 8);
  assert.equal(nativeCombat.weapon, 15);
  assert.equal(nativeCombat.policy, 1);
  assert.equal(nativeCombat.runtimeReady, true);
  assert.equal(nativeCombat.scanOffsets.length, 814);
  assert.deepEqual(nativeCombat.scanOffsets.slice(809), [[16, 0], [0, 16], [0, -16], [-16, 0], [99, 99]]);
  assert.equal(proof.runtimeReady, false);
  assert.deepEqual(nativeCombat.geometryTypes, [8]);
  assert.equal(nativeCombat.death, undefined);
  assert.ok(isImmutableSourceNativeTaskConfiguration(nativeAiTasks));
  assert.equal(retainSourceNativeCombatConfiguration(structuredClone(nativeCombat)), nativeCombat);
  for (const [index, profile] of nativeAiTasks.profiles.entries()) {
    if (profile.typeId !== 8) {
      assert.deepEqual(profile, configuration.profiles[index]);
      continue;
    }
    const fragment = composeSourceNativeCombatProof({ configuration, proof, team: index % 8 });
    assert.deepEqual(profile.typeBytes, fragment.typeBytes);
    assert.deepEqual(profile.fin, proof.fin);
    assert.deepEqual(profile.weapons.slice(15 * 72, 16 * 72), proof.weaponBytes);
    assert.deepEqual(profile.nativeFire, { spread: proof.ordinaryBoom, frames: proof.fireFrames });
    assert.equal(profile.typeBytes[0x30 + index % 8], 0);
  }
  await assert.rejects(createSourceNativeCombatOptions({ configuration, proof, death: true }), /type8 death owner/);
  await assert.rejects(createSourceNativeCombatOptions({ configuration, proof: structuredClone(proof) }), /authenticated source/);
  const changed = structuredClone(nativeCombat);
  Object.assign(changed, { scope: "source-separated-type0-weapon1-nonlethal", sourceType: 0, weapon: 1 });
  assert.throws(() => validateSourceNativeCombatConfiguration(changed), /externally authenticated/);
  const human = await fixture("HUMAN");
  assert.throws(() => composeSourceNativeCombatProof({ configuration: human.configuration, proof, team: 0 }), /complete SCN mismatch/);
  assert.throws(() => composeSourceNativeCombatProof({ configuration, proof: human.proof, team: 0 }), /complete SCN mismatch/);
  await assert.rejects(withSourceNativeCombatTasks(human.configuration, proof), /same complete SCN/);
  assert.equal(human.nativeCombat.scope, "source-separated-type0-weapon1-nonlethal");
  assert.equal(human.nativeCombat.scanOffsets.length, 809);
  assert.deepEqual(human.nativeCombat.scanOffsets, nativeCombat.scanOffsets.slice(0, 809));
  const mutable = structuredClone(configuration);
  const pending = createSourceNativeCombatOptions({ configuration: mutable, proof });
  (mutable.profiles.find(profile => profile.typeId === 8)!.typeBytes as number[]).fill(0);
  (mutable.bindings[0].raw as number[]).fill(0);
  const snapshotted = await pending;
  assert.deepEqual(snapshotted.nativeAiTasks, nativeAiTasks);
  assert.deepEqual(snapshotted.nativeCombat, nativeCombat);
  for (const field of ["scenario", "troopFin", "troopSprite"] as const) {
    const changed = { ...source.assets, [field]: Buffer.from(human.assets[field]) };
    await assert.rejects(createSourceNativeCombatProof(changed), /hash mismatch/);
  }
});

test("ALIEN authenticated tables execute native registered fire and nonlethal projectile bytes exactly", async context => {
  const source = await fixture(), evidence = await nativeBaseProjectile(), fire = evidence.fire;
  const { nativeCombat, nativeAiTasks, proof } = source;
  assert.equal(fire.received[7], 0, "actual ALIEN02 selected source team");
  assert.equal(fire.binarySha256, proof.hashes.executable);
  assert.deepEqual(fire.runtimeIntercepts, []);
  const profile = nativeAiTasks.profiles.find(profile => profile.typeId === 8)!;
  const nativeType = Buffer.from(fire.world.typeBytes);
  const banks = new Map(proof.bankFields.map(field => [nativeType.readUInt32LE(field.offset), field.id]));
  const nativeTargetType = Buffer.from(evidence.damaged.world.typeBytes);
  for (const field of proof.reactionFields) banks.set(nativeTargetType.readUInt32LE(field.offset), field.id);
  const nativeWeapon = Buffer.from(fire.world.weapons).subarray(15 * 72, 16 * 72);
  const relocateActor = (raw: readonly number[]) => {
    const result = Buffer.from(raw);
    if (result[6] === 8) for (const offset of [0x14, 0x1c, 0x24]) {
      const replacement = banks.get(result.readUInt32LE(offset));
      if (replacement !== undefined) result.writeUInt32LE(replacement, offset);
    }
    return [...result];
  };
  const relocateActors = (encoded: string) => {
    const bytes = Buffer.from(encoded, "base64");
    return Array.from({ length: 800 }, (_, slot) => relocateActor([...bytes.subarray(slot * 220, (slot + 1) * 220)])).flat();
  };
  const relocatePool = (pool: { records: string; highWater: number; heads: [number, number]; statistics: number[] }) => {
    const records = Buffer.from(pool.records, "base64");
    for (let slot = 0; slot < pool.highWater; slot++) if (records.readUInt32LE(slot * 40 + 32) === nativeWeapon.readUInt32LE(44))
      records.writeUInt32LE(proof.weaponFin.travelBank, slot * 40 + 32);
    return { ...pool, records: [...records] };
  };
  let actors = Uint8Array.from(relocateActors(evidence.initial.actors));
  let raw = relocateActor(fire.received), projectiles = relocatePool(fire.visits[0].before.projectiles);
  let rngCursor = fire.visits[0].before.rngCursor, launches = 0;
  actors.set(raw, fire.slot * 220);
  for (const visit of fire.visits) {
    const currentProfile = { ...profile, ground: fire.world.ground, air: fire.world.air, extra: fire.world.extra };
    const world = sourceNativeCombatVisitWorld(nativeCombat, currentProfile, actors, currentProfile.ground);
    assert.ok(world.combat, "explicit type8 acquisition owner");
    const result = reduceLegacyAiRegisteredVisit({ slot: fire.slot, raw, world, projectiles, rngCursor,
      counter: visit.before.counter, task6Budget: visit.before.task6Budget });
    assert.ok(result.supported, JSON.stringify(result));
    assert.deepEqual(result.raw, relocateActor(visit.raw));
    assert.deepEqual(result.projectiles, relocatePool(visit.projectiles));
    assert.equal(result.rngCursor, visit.rngCursor);
    raw = [...result.raw]; projectiles = { ...result.projectiles!, records: [...result.projectiles!.records],
      heads: [...result.projectiles!.heads], statistics: [...result.projectiles!.statistics] };
    rngCursor = result.rngCursor; launches += result.spawns.length;
    actors.set(raw, fire.slot * 220);
  }
  assert.equal(launches, 1);
  assert.deepEqual(projectiles, relocatePool(evidence.initial.projectiles));
  assert.deepEqual([...actors], relocateActors(evidence.initial.actors));
  const owner = createSourceNativeCombatOwner(nativeCombat);
  owner.projectiles = projectiles;
  const currentProfile = { ...profile, air: evidence.projectileAir, extra: fire.world.extra,
    families: evidence.projectileFamilies };
  let hits = 0;
  const groundBefore = [...evidence.projectileGround];
  for (const expected of evidence.visits) {
    const result = stepSourceNativeCombatProjectiles(owner, actors, currentProfile, evidence.projectileGround, rngCursor);
    assert.deepEqual(result.actors, relocateActors(expected.actors), "all800 raw220 actors");
    assert.deepEqual(result.projectiles, relocatePool(expected.projectiles), "all80960 projectile bytes");
    assert.equal(result.rngCursor, expected.rngCursor);
    assert.deepEqual(result.randomAdvances, expected.randomWrites);
    hits += result.impacts.length;
    actors = Uint8Array.from(result.actors); owner.projectiles = result.projectiles; rngCursor = result.rngCursor;
  }
  assert.equal(hits, evidence.expectedHits);
  assert.ok(hits > 0);
  assert.equal(owner.projectiles.heads[1], -1);
  assert.deepEqual(evidence.projectileGround, groundBefore);
  const targetProfile = nativeAiTasks.profiles.filter(profile => profile.typeId === 8)[1];
  let reactionVisits = 0;
  for (const visit of evidence.damaged.visits) {
    assert.equal(visit.owner, "target");
    assert.deepEqual([...actors], relocateActors(visit.before.actors));
    const world = sourceNativeCombatVisitWorld(nativeCombat, { ...targetProfile,
      air: currentProfile.air, extra: currentProfile.extra }, actors, groundBefore);
    const result = reduceLegacyAiRegisteredVisit({ slot: evidence.damaged.slot,
      raw: [...actors.slice(evidence.damaged.slot * 220, (evidence.damaged.slot + 1) * 220)],
      world, counter: visit.counter, rngCursor, task6Budget: 0, projectiles: owner.projectiles });
    assert.ok(result.supported, JSON.stringify(result));
    actors.set(result.raw, evidence.damaged.slot * 220);
    assert.deepEqual([...actors], relocateActors(visit.after.actors));
    assert.deepEqual(result.ground, visit.after.ground);
    assert.equal(result.rngCursor, visit.after.rngCursor);
    rngCursor = result.rngCursor;
    reactionVisits++;
  }
  assert.equal(reactionVisits, evidence.damaged.visits.length);
  assert.ok(reactionVisits > 0);
  const initialPool = relocatePool(evidence.initial.projectiles);
  const initialActors = relocateActors(evidence.initial.actors);
  const frame: LegacyNativeProjectileFrame = { phase: "after-actor-visits", projectiles: initialPool,
    actors: initialActors, rngCursor: evidence.initial.rngCursor, tables: nativeCombat.tables,
    world: { width: profile.width, height: profile.height, ground: groundBefore, air: currentProfile.air,
      extra: currentProfile.extra, families: currentProfile.families, relations: nativeCombat.relations, policy: nativeCombat.policy } };
  for (const weapon of [1, 16, 17]) {
    const records = Buffer.from(initialPool.records);
    records.writeInt16LE(weapon, initialPool.heads[1] * 40 + 12);
    assert.throws(() => guardSourceNativeProjectileGeometry({ ...frame, projectiles: { ...initialPool, records: [...records] } },
      nativeCombat), /uncovered projectile source\/weapon/);
  }
  const target = fire.nearbyEnemy.enemySlot;
  assert.ok(Number.isInteger(target));
  const unknownGeometry = [...initialActors];
  unknownGeometry[target * 220 + 6] = 0;
  assert.throws(() => guardSourceNativeProjectileGeometry({ ...frame, actors: unknownGeometry }, nativeCombat),
    /uncovered candidate geometry/);
  const lethal = Buffer.from(initialActors);
  lethal.writeInt32LE(1, target * 220 + 12);
  owner.projectiles = initialPool;
  const before = structuredClone(owner);
  assert.throws(() => stepSourceNativeCombatProjectiles(owner, lethal, currentProfile, groundBefore, frame.rngCursor),
    /native-projectile-death-owner-required/);
  assert.deepEqual(owner, before);
  context.diagnostic(JSON.stringify({ sourceTeam: fire.received[7], launches, hits,
    projectilePhases: evidence.visits.length, reactionVisits }));
});