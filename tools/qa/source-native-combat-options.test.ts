import assert from "node:assert/strict";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import test from "node:test";
import { createSourceNativeCombatProof, isAuthenticatedSourceNativeCombatProof,
  composeSourceNativeCombatProof, SOURCE_NATIVE_COMBAT_BANK_FIELDS, SOURCE_NATIVE_COMBAT_REACTION_FIELDS } from "../../src/engine/source-native-combat-options";
import { createSourceNativeTaskOptions, isAuthenticatedSourceNativeTaskConfiguration } from "../../src/engine/source-native-task-options";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";
import { parseFin } from "../extractors/animations/fin";

function fixture(faction: "HUMAN" | "ALIEN" = "HUMAN") {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const animationRegistry = read("ANIM.DAT");
  const troop = faction === "HUMAN" ? "TRSC" : "GRAY";
  return { executable: read("DC.EXE"), gameStat: read("GAMESTAT/GAMESTAT.TXT"),
    weaponStat: read("GAMESTAT/WEAPSTAT.TXT"), boomStat: read("GAMESTAT/BOOMSTAT.TXT"),
    damageMatrix: read("GAMESTAT/MBULLET.TXT"), scenario: read(`SCENARIO/${faction}/${faction}02.SCN`),
    troopFin: read(`ANIMATE/${troop}.FIN`), troopSprite: read(`SPRITES/${troop}.SPR`), animationRegistry,
    registryFins: Object.fromEntries(animationRegistry.toString("ascii").trim().split(/\s+/).map(name =>
      [name.toUpperCase(), read(`ANIMATE/${name.toUpperCase()}`)])) };
}

test("ALIEN02 authenticates a separate frozen base type8 weapon15 source proof", async () => {
  const human = await createSourceNativeCombatProof(fixture());
  const alien = await createSourceNativeCombatProof(fixture("ALIEN"));
  assert.equal(alien.sourceType, 8);
  assert.equal(alien.weapon, 15);
  assert.equal(alien.weaponLevels[0], 0);
  assert.equal(alien.runtimeReady, false);
  assert.ok(isAuthenticatedSourceNativeCombatProof(alien) && Object.isFrozen(alien));
  assert.equal(isAuthenticatedSourceNativeCombatProof(structuredClone(alien)), false);
  assert.notDeepEqual(alien.hashes, human.hashes);
  assert.equal(human.sourceType, 0);
  assert.equal(human.weapon, 1);
});

test("ALIEN02 source fields and every admitted FIN frame match native base type8 captures", async context => {
  const proof = await createSourceNativeCombatProof(fixture("ALIEN"));
  assert.equal(proof.reactionFields.length, 6);
  assert.deepEqual(proof.reactionFields.map(field => field.name), [..."ABCDEG"].map(letter => `GRAYBLOOD${letter}`));
  assert.equal(proof.deathFields.length, 0);
  assert.deepEqual(proof.unboundFinEvents, ["", "NONAME"]);
  assert.equal(proof.weaponFin.visualPrefix, "GRAY");
  assert.equal(proof.weaponFin.sourceFinMapping.GRAYBULLET0?.file, "GRAY.FIN");
  assert.equal(proof.weaponFin.sourceFinMapping.GRAYEXPLODE0, null);
  assert.equal(proof.weaponFin.sourceFinMapping.GRAYEXPL0, null);
  assert.notEqual(proof.weaponFin.travelBank, 0);
  let fireRows = 0, projectileRows = 0, reactionRows = 0;
  for (const [kind, path] of [["fire", process.env.DC_NATIVE_FIRE_TRACE],
    ["projectile", process.env.DC_NATIVE_PROJECTILE_TRACE], ["reaction", process.env.DC_NATIVE_DAMAGED_ACTOR_TRACE]] as const) {
    assert.ok(path, `existing ${kind} evidence required`);
    for await (const evidence of evidenceRows(path)) {
      if (kind === "reaction") {
        if (evidence.world.typeId !== 8) continue;
        const type = Buffer.from(evidence.world.typeBytes);
        assert.equal(type.readInt32LE(0xd8), 6);
        for (const field of proof.reactionFields) {
          const nativeBank = type.readUInt32LE(field.offset);
          assert.deepEqual(proof.fin[field.id], evidence.world.fin[nativeBank], field.name);
          assert.deepEqual(proof.fireFrames[field.id], evidence.world.nativeFire.frames[nativeBank], field.name);
        }
        reactionRows++;
        continue;
      }
      const fire = kind === "fire" ? evidence : evidence.fire;
      if (fire.unitType !== 8 || (fire.fireOptions?.scenarioWeaponLevel ?? 0) !== 0) continue;
      assert.equal(fire.binarySha256, proof.hashes.executable);
      assert.deepEqual(fire.runtimeIntercepts, []);
      const type = Buffer.from(fire.world.typeBytes);
      for (const [offset, value] of Object.entries(proof.typeFields)) assert.equal(type.readInt32LE(Number(offset)), value);
      assert.deepEqual(proof.weaponLevels, [...type.subarray(0x30, 0x38)]);
      assert.deepEqual(proof.armorLevels, [...type.subarray(0x38, 0x40)]);
      const weapon = Buffer.from(fire.world.weapons).subarray(15 * 72, 16 * 72);
      const relocatedWeapon = Buffer.from(weapon);
      relocatedWeapon.writeUInt32LE(proof.weaponFin.travelBank, 44);
      assert.deepEqual(proof.weaponBytes, [...relocatedWeapon]);
      assert.deepEqual(proof.randomTable, fire.world.randomTable);
      assert.deepEqual(proof.damageTable, fire.world.combat.damageTable);
      for (const field of proof.bankFields) {
        const nativeBank = type.readUInt32LE(field.offset);
        assert.deepEqual(proof.fireFrames[field.id], fire.world.nativeFire.frames[nativeBank], field.name);
        assert.deepEqual(proof.fin[field.id], fire.fin[nativeBank], field.name);
      }
      if (kind === "fire") fireRows++;
      else {
        const nativeTypes = Buffer.from(fire.world.combat.typeTable);
        for (const [offset, value] of Object.entries(proof.collisionFields))
          assert.equal(nativeTypes.readInt32LE(8 * 280 + Number(offset)), value, `geometry ${offset}`);
        proof.armorCoefficients.forEach((value, index) =>
          assert.equal(nativeTypes.readInt32LE(8 * 280 + 0x24 + index * 4), value));
        assert.deepEqual(proof.projectileFin[proof.weaponFin.travelBank], evidence.projectileFin[weapon.readUInt32LE(44)]);
        assert.deepEqual(proof.ordinaryBoom, evidence.boom.slice(0, 136));
        projectileRows++;
      }
    }
  }
  assert.ok(fireRows > 0 && projectileRows > 0 && reactionRows > 0);
  context.diagnostic(JSON.stringify({ fireRows, projectileRows, reactionRows }));
});

async function* evidenceRows(path: string) {
  const stream = createReadStream(path), lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line.trim()) yield JSON.parse(line);
  } finally { lines.close(); stream.destroy(); }
}

async function firstEvidence(path: string) {
  for await (const evidence of evidenceRows(path)) return evidence;
  throw new Error("empty native evidence");
}

function verifySourceIdentity(evidence: any) {
  assert.equal(evidence.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.deepEqual(evidence.runtimeIntercepts, []);
  assert.equal(evidence.unitType, 0);
}

test("source type-0 reaction banks match original damaged actor timelines", async () => {
  assert.ok(process.env.DC_NATIVE_DAMAGED_ACTOR_TRACE);
  const evidence = await firstEvidence(process.env.DC_NATIVE_DAMAGED_ACTOR_TRACE);
  const proof = await createSourceNativeCombatProof(fixture());
  const type = Buffer.from(evidence.world.typeBytes);
  assert.equal(evidence.world.typeId, 0);
  assert.equal(type.readInt32LE(0xd8), SOURCE_NATIVE_COMBAT_REACTION_FIELDS.length);
  for (const field of SOURCE_NATIVE_COMBAT_REACTION_FIELDS) {
    assert.deepEqual(proof.fin[field.id], evidence.world.fin[type.readUInt32LE(field.offset)]);
  }
});

test("authenticated source scalar projection matches original executable fire inputs", async () => {
  assert.ok(process.env.DC_NATIVE_FIRE_TRACE, "supply the existing native fire trace; no implicit capture");
  const evidence = await firstEvidence(process.env.DC_NATIVE_FIRE_TRACE);
  verifySourceIdentity(evidence);
  const proof = await createSourceNativeCombatProof(fixture());
  assert.equal(isAuthenticatedSourceNativeCombatProof(proof), true);
  assert.equal(isAuthenticatedSourceNativeCombatProof(structuredClone(proof)), false);
  const world = evidence.world;
  const type = Buffer.from(world.typeBytes), weapon = Buffer.from(world.weapons).subarray(72, 144);
  for (const [offset, value] of Object.entries(proof.typeFields)) {
    assert.equal(type.readInt32LE(Number(offset)), value, `type field ${offset}`);
  }
  for (const [offset, value] of Object.entries(proof.weaponFields)) {
    assert.equal(weapon.readInt32LE(Number(offset)), value, `weapon field ${offset}`);
  }
  assert.deepEqual(proof.randomTable, world.randomTable);
  assert.deepEqual(proof.damageTable, world.combat.damageTable);
  assert.deepEqual(proof.scanOffsets, world.combat.scanOffsets.slice(0, proof.scanOffsets.length));
  assert.deepEqual(proof.relations.slice(0, 80).filter((_, index) => index % 10 < 8),
    world.combat.relations.slice(0, 80).filter((_: number, index: number) => index % 10 < 8));
  assert.equal(proof.scalarTypeRows.length, 106);
  const projectileEvidence = await firstEvidence(process.env.DC_NATIVE_PROJECTILE_TRACE!);
  const sourceTypes = Buffer.from(projectileEvidence.fire.world.combat.typeTable);
  proof.scalarTypeRows.forEach((row, type) => {
    const scalar = Buffer.from(row), offset = type * 280;
    for (const field of [4, 0x18, 0x40, 0x68, ...(type === 0 ? [0x24, 0x28, 0x2c] : [])])
      assert.equal(scalar.readInt32LE(field), sourceTypes.readInt32LE(offset + field), `source type ${type} scalar ${field}`);
    for (const field of [0, 0x60, ...Array.from({ length: 16 }, (_, index) => 0x30 + index)])
      assert.equal(scalar[field], sourceTypes[offset + field], `source type ${type} byte ${field}`);
  });
  assert.deepEqual(proof.weaponLevels, [...type.subarray(0x30, 0x38)]);
  assert.deepEqual(proof.armorLevels, [...type.subarray(0x38, 0x40)]);
  for (const field of SOURCE_NATIVE_COMBAT_BANK_FIELDS) {
    const address = type.readUInt32LE(field.offset);
    assert.deepEqual(proof.fireFrames[field.id], world.nativeFire.frames[address], `raw72 bank field ${field.offset}`);
    assert.deepEqual(proof.fin[field.id], evidence.fin[address], `delay bank field ${field.offset}`);
  }
});

test("source collision, normalized armor and ordinary BOOM match native projectile inputs", async () => {
  assert.ok(process.env.DC_NATIVE_PROJECTILE_TRACE, "supply existing native projectile trace; no implicit capture");
  const evidence = await firstEvidence(process.env.DC_NATIVE_PROJECTILE_TRACE);
  verifySourceIdentity(evidence.fire);
  const proof = await createSourceNativeCombatProof(fixture());
  const type = Buffer.from(evidence.fire.world.combat.typeTable).subarray(0, 280);
  proof.armorCoefficients.forEach((value, index) => assert.equal(type.readInt32LE(0x24 + index * 4), value));
  for (const [offset, value] of Object.entries(proof.collisionFields)) {
    assert.equal(type.readInt32LE(Number(offset)), value, `collision field ${offset}`);
  }
  assert.deepEqual(proof.ordinaryBoom, evidence.boom.slice(0, 136));
});

test("proof rejects tampered or missing original sources", async () => {
  for (const field of Object.keys(fixture()).filter(field => field !== "registryFins") as
    (Exclude<keyof ReturnType<typeof fixture>, "registryFins">)[]) {
    const assets = fixture(); assets[field][0] ^= 1;
    await assert.rejects(createSourceNativeCombatProof(assets), new RegExp(`${field} hash mismatch`));
    assets[field] = Buffer.alloc(0);
    await assert.rejects(createSourceNativeCombatProof(assets), new RegExp(`${field} hash mismatch`));
    const missing = { ...fixture(), [field]: undefined } as unknown as ReturnType<typeof fixture>;
    await assert.rejects(createSourceNativeCombatProof(missing), /source bytes required/);
  }
});

test("all supplied base type-0 rows retain exact source projections, including valid reuse", async context => {
  const proof = await createSourceNativeCombatProof(fixture());
  let fireRows = 0, projectileRows = 0, reuseRows = 0;
  for (const [kind, path] of [["fire", process.env.DC_NATIVE_FIRE_TRACE],
    ["projectile", process.env.DC_NATIVE_PROJECTILE_TRACE]] as const) {
    assert.ok(path, `existing ${kind} evidence required`);
    for await (const evidence of evidenceRows(path)) {
      const fire = kind === "fire" ? evidence : evidence.fire;
      if (fire.unitType !== 0 || (fire.fireOptions?.scenarioWeaponLevel ?? 0) !== 0) continue;
      verifySourceIdentity(fire);
      const type = Buffer.from(fire.world.typeBytes), weapon = Buffer.from(fire.world.weapons).subarray(72, 144);
      for (const [offset, value] of Object.entries(proof.weaponFields)) assert.equal(weapon.readInt32LE(Number(offset)), value);
      assert.deepEqual(proof.weaponBytes, [...weapon]);
      for (const offset of [0x2c, 0x30, 0x34, 0x38, 0x3c]) {
        assert.equal(weapon.readUInt32LE(offset), 0, `source-proved absent weapon FIN ${offset}`);
      }
      assert.equal(weapon.readUInt32LE(0x40), proof.weaponFin.impactVariantCount);
      assert.deepEqual(proof.randomTable, fire.world.randomTable);
      assert.deepEqual(proof.damageTable, fire.world.combat.damageTable);
      assert.deepEqual(proof.weaponLevels, [...type.subarray(0x30, 0x38)]);
      assert.deepEqual(proof.armorLevels, [...type.subarray(0x38, 0x40)]);
      for (const field of SOURCE_NATIVE_COMBAT_BANK_FIELDS) {
        const address = type.readUInt32LE(field.offset);
        assert.deepEqual(proof.fireFrames[field.id], fire.world.nativeFire.frames[address]);
        assert.deepEqual(proof.fin[field.id], fire.fin[address]);
      }
      if (kind === "fire") fireRows++;
      else {
        projectileRows++;
        const selectedFin = Object.fromEntries([0x2c, 0x30, 0x34, 0x38, 0x3c]
          .map(offset => weapon.readUInt32LE(offset)).filter(bank => bank !== 0)
          .map(bank => [bank, evidence.projectileFin[bank]]));
        assert.deepEqual(selectedFin, proof.projectileFin);
        assert.equal(Object.hasOwn(evidence.projectileFin, "0"), false);
        const collision = Buffer.from(fire.world.combat.typeTable);
        for (const [offset, value] of Object.entries(proof.collisionFields)) assert.equal(collision.readInt32LE(Number(offset)), value);
        proof.armorCoefficients.forEach((value, index) => assert.equal(collision.readInt32LE(0x24 + index * 4), value));
        assert.deepEqual(proof.ordinaryBoom, evidence.boom.slice(0, 136));
      }
      if (fire.fireOptions?.reusePool) reuseRows++;
    }
  }
  assert.ok(fireRows >= 4 && projectileRows >= 4 && reuseRows > 0, JSON.stringify({ fireRows, projectileRows, reuseRows }));
  context.diagnostic(JSON.stringify({ fireRows, projectileRows, reuseRows }));
});

for (const faction of ["HUMAN", "ALIEN"] as const) for (const shared of [false, true])
test(`${faction} authentication snapshots ${shared ? "shared" : "private"} bytes before asynchronous hashing`, async () => {
  const assets = fixture(faction);
  if (shared) {
    const share = (bytes: Uint8Array) => {
      const result = new Uint8Array(new SharedArrayBuffer(bytes.length));
      result.set(bytes);
      return result;
    };
    for (const [name, bytes] of Object.entries(assets)) {
      if (name !== "registryFins") Object.assign(assets, { [name]: share(bytes as Uint8Array) });
    }
    Object.assign(assets, { registryFins: Object.fromEntries(Object.entries(assets.registryFins)
      .map(([name, bytes]) => [name, share(bytes)])) });
  }
  const pending = createSourceNativeCombatProof(assets);
  for (const [name, bytes] of Object.entries(assets)) {
    if (name !== "registryFins") (bytes as Buffer).fill(0);
  }
  for (const bytes of Object.values(assets.registryFins)) bytes.fill(0);
  const proof = await pending;
  assert.equal(isAuthenticatedSourceNativeCombatProof(proof), true);
  assert.equal(isAuthenticatedSourceNativeCombatProof(JSON.parse(JSON.stringify(proof))), false);
  assert.equal(isAuthenticatedSourceNativeCombatProof(null), false);
  assert.equal(isAuthenticatedSourceNativeCombatProof({ kind: proof.kind, hashes: proof.hashes }), false);
  assert.deepEqual(proof.unresolved, ["complete-projectile-type-table", "host-session-admission"]);
  assert.equal("weapons" in proof, false);
  assert.equal("typeTable" in proof, false);
  assert.equal("projectiles" in proof, false);
});

test("weapon 1 resolves actual WEAPSTAT prefix against every original registry FIN", async () => {
  const assets = fixture(), proof = await createSourceNativeCombatProof(assets);
  const states = new Map<string, { file: string; first: number; last: number }>();
  for (const [file, bytes] of Object.entries(assets.registryFins)) {
    for (const state of parseFin(bytes).states) if (state.validRange) states.set(state.name.toUpperCase(), {
      file, first: state.firstTimelineIndex, last: state.lastTimelineIndex,
    });
  }
  assert.equal(proof.weaponFin.visualPrefix, parseWeaponStats(assets.weaponStat.toString("ascii"))[1].visualClass);
  assert.equal(proof.weaponFin.visualPrefix, "weapons");
  assert.equal(proof.weaponFin.registryFiles.length, 106);
  assert.equal(proof.weaponFin.registryStateCount, states.size);
  assert.ok(states.has("GRAYBULLET0") && states.has("SPAKEXPLODE0") && states.has("TRSCFIREA0"));
  assert.deepEqual(Object.keys(proof.weaponFin.sourceFinMapping), ["WEAPONSBULLET0", "WEAPONSEXPLODE0", "WEAPONSEXPL0"]);
  for (const [name, location] of Object.entries(proof.weaponFin.sourceFinMapping)) {
    assert.equal(states.has(name), false);
    assert.equal(location, null);
  }
  assert.equal(proof.weaponFin.travelBank, 0);
  assert.deepEqual(proof.weaponFin.impactBanks, []);
  assert.equal(proof.weaponFin.impactVariantCount, 0);
  assert.deepEqual(proof.projectileFin, {});
  assert.equal(0 in proof.fin || 0 in proof.fireFrames || 0 in proof.projectileFin, false);
  assert.ok(Object.isFrozen(proof.weaponBytes) && Object.isFrozen(proof.weaponFin.sourceFinMapping));
  const reordered = { ...assets, registryFins: Object.fromEntries(Object.entries(assets.registryFins).reverse()) };
  const again = await createSourceNativeCombatProof(reordered);
  assert.deepEqual(again, proof);
});

test("registry absence cannot be certified with missing, renamed, substituted or changed FIN sources", async () => {
  const assets = fixture();
  for (const file of Object.keys(assets.registryFins)) {
    const registryFins = { ...assets.registryFins };
    delete registryFins[file];
    await assert.rejects(createSourceNativeCombatProof({ ...assets, registryFins }), /exact ANIM.DAT FIN source set required/);
  }
  await assert.rejects(createSourceNativeCombatProof({ ...assets, registryFins: undefined! }), /complete registry FIN sources required/);
  for (const bytes of [undefined, Buffer.alloc(0)]) {
    await assert.rejects(createSourceNativeCombatProof({ ...assets,
      registryFins: { ...assets.registryFins, "TRSC.FIN": bytes! } }), /missing registry FIN source TRSC.FIN/);
  }
  const renamed: typeof assets.registryFins = { ...assets.registryFins, "trsc.fin": assets.registryFins["TRSC.FIN"] };
  delete renamed["TRSC.FIN"];
  await assert.rejects(createSourceNativeCombatProof({ ...assets, registryFins: renamed }), /exact ANIM.DAT FIN source set required/);
  await assert.rejects(createSourceNativeCombatProof({ ...assets,
    registryFins: { ...assets.registryFins, "TRSC.FIN": assets.registryFins["GRAY.FIN"] } }), /registry FIN hash mismatch/);
  for (const file of ["HAZE.FIN", "TRSC.FIN", "HYYK.FIN"]) {
    const changed = Buffer.from(assets.registryFins[file]); changed[0] ^= 1;
    await assert.rejects(createSourceNativeCombatProof({ ...assets,
      registryFins: { ...assets.registryFins, [file]: changed } }), /registry FIN hash mismatch/);
  }
  const injected = Buffer.from(assets.registryFins["TRSC.FIN"]);
  injected.write("WEAPONSBULLET0\0\0\0", 8 + injected.readUInt16LE(6) * 8, "ascii");
  await assert.rejects(createSourceNativeCombatProof({ ...assets,
    registryFins: { ...assets.registryFins, "TRSC.FIN": injected } }), /registry FIN hash mismatch/);
});

test("source proof composes with authenticated task factory without changing or authenticating combat admission", async () => {
  const assets = fixture(), proof = await createSourceNativeCombatProof(assets);
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const taskAssets = { ...assets, map: read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.MAP"),
    mtg: read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.MTG"), pth: read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.PTH"),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem =>
      [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const text = new TextDecoder(), source = parseScenario(text.decode(assets.scenario));
  const map = parseMapBundle(taskAssets.map, taskAssets.mtg, taskAssets.pth);
  const session = initializeCampaignSession({ sessionId: "source-combat-proof", source,
    units: parseUnitStats(text.decode(assets.gameStat)), weapons: parseWeaponStats(text.decode(assets.weaponStat)),
    triggers: [], messages: [], map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }], directionBits: [],
    fixedStepMilliseconds: 16, orientationSteps: 1, resourceScales: "configured-startup" });
  assert.ok(session.ok, JSON.stringify(session));
  const configuration = await createSourceNativeTaskOptions({ assets: taskAssets, world: session.value.world });
  const before = structuredClone(configuration), worldBefore = structuredClone(session.value.world);
  const fragment = composeSourceNativeCombatProof({ configuration, proof, team: 1 });
  assert.equal(fragment.runtimeReady, false);
  assert.equal(proof.runtimeReady, false);
  assert.equal(fragment.kind, "source-native-combat-fragment-v1");
  assert.deepEqual(configuration, before);
  assert.deepEqual(session.value.world, worldBefore);
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(configuration));
  const copied = structuredClone(configuration);
  const candidate = { ...copied, profiles: copied.profiles.map((profile, index) =>
    index === 1 ? { ...profile, typeBytes: fragment.typeBytes } : profile) };
  assert.equal(isAuthenticatedSourceNativeTaskConfiguration(candidate), false);
  const type = Buffer.from(fragment.typeBytes);
  assert.deepEqual([...type.subarray(0x30, 0x40)], [...Buffer.from(configuration.profiles[1].typeBytes).subarray(0x30, 0x40)]);
  for (const field of SOURCE_NATIVE_COMBAT_BANK_FIELDS) assert.equal(type.readUInt32LE(field.offset), field.id);
  assert.equal(type.readInt32LE(0xe4), 2);
  const evidence = await firstEvidence(process.env.DC_NATIVE_PROJECTILE_TRACE!);
  const original = Buffer.from(evidence.fire.world.combat.typeTable);
  for (const offset of [0x24, 0x28, 0x2c, 0x48, 0x4c, 0x50, 0x54, 0x58, 0x5c, 0xe4]) {
    assert.equal(type.readInt32LE(offset), original.readInt32LE(offset), `composed type field ${offset}`);
  }
  assert.throws(() => composeSourceNativeCombatProof({ configuration: candidate, proof, team: 1 }), /authenticated task/);
  assert.throws(() => composeSourceNativeCombatProof({ configuration, proof: structuredClone(proof), team: 1 }), /authenticated combat/);
  for (const team of [-1, 8, 1.5, NaN]) assert.throws(() => composeSourceNativeCombatProof({ configuration, proof, team }), /team selection/);
  assert.ok(Object.isFrozen(fragment) && Object.isFrozen(fragment.typeBytes) && Object.isFrozen(proof.fin[1][0]));
  assert.throws(() => { (proof.fin[1][0] as number[])[0] = 99; }, TypeError);
  assets.troopFin.fill(0);
  assert.equal(isAuthenticatedSourceNativeCombatProof(proof), true);
  assert.deepEqual(proof.fin[1][0], evidence.fire.fin[original.readUInt32LE(0x80)][0]);
});