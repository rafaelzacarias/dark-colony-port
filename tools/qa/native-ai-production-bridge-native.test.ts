import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNativeAiProductionConfiguration, receiveNativeAiPaidProduction, visitNativeAiProduction,
  advanceNativeAiProductionFin, computeNativeAiProductionPolicy, constructNativeAiProductionActor,
  checkpointNativeAiProduction, restoreNativeAiProduction, type NativeAiProductionReplayInput,
  type NativeAiProductionWorld } from "../../src/engine/native-ai-production-bridge";
import { authenticateLegacyNativeSchedulerSource } from "../../src/engine/legacy-native-scheduler";
import { createSourceNativeTaskOptions } from "../../src/engine/source-native-task-options";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { parseScenario } from "../extractors/data/scenario";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";
import type { LegacyAiFullPolicyInputs } from "../../src/engine/legacy-ai-policy";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const decode = (encoded: string) => Uint8Array.from(Buffer.from(encoded, "base64"));
type Snapshot = { game: string; groundCells: number[]; populations: number[]; rngCursor: number };
type Policy = { counter: number; team: number; population: number; populationLimit: number;
  before: { policy: string; entities: string; teamBytes: string; rngCursor: number; forceOrder: number; policyAddress: number };
  after: Policy["before"]; packets: string[]; ruleTable: string;
  navigation: { width: number; height: number; families: number[]; nextFamily: string };
  inputs: Omit<LegacyAiFullPolicyInputs, "types" | "weapons" | "dependencies" | "neighbors" | "relations"> & {
    types: string; weapons: string; dependencies: string; neighbors: string; relations: number[] } };
const trace = JSON.parse(process.env.DC_NATIVE_AI_PRODUCTION_TRACE
  ? readFileSync(process.env.DC_NATIVE_AI_PRODUCTION_TRACE, "utf8")
  : execFileSync("python3", ["-B", new URL("native-ai-production-bridge-native.py", import.meta.url).pathname], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env,
      PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as {
  runtimeCoreInterceptions: unknown[]; fullPolicies: Policy[];
  productionEvents: { address: number; counter: number; returnAddress: number; before: Snapshot; after: Snapshot }[];
  events: { phase: string; counter: number; slot?: number; registryChanges?: { slot: number }[] }[];
  control: { label: string; originalCredits: number; width: number; height: number; unitType: number; producerSlot: number;
    before: Snapshot; received: Snapshot; visits: { before: Snapshot; handlerEntry: Snapshot; after: Snapshot }[];
    banks: { build: number; producerStand: number; troopStand: number } };
};

const productionAssets = { executable: read("raw_cd/DC/DC.EXE"), dependencies: read("raw_cd/DC/GAMESTAT/DEPEND.TXT"),
  gameStat: read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"), humanProducer: read("public/assets/generated/animations/HUBU.json"),
  alienProducer: read("public/assets/generated/animations/ALBU.json") };

async function owner() {
  const scenario = (extension: string) => read(`raw_cd/DC/SCENARIO/ALIEN/ALIEN02.${extension}`);
  const assets = { executable: productionAssets.executable, gameStat: productionAssets.gameStat,
    weaponStat: read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT"), scenario: scenario("SCN"), map: scenario("MAP"),
    mtg: scenario("MTG"), pth: scenario("PTH"), animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem =>
      [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const source = parseScenario(assets.scenario.toString()), map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const fresh = initializeCampaignSession({ sessionId: "native-production-bridge-source", source,
    units: parseUnitStats(assets.gameStat.toString()), weapons: parseWeaponStats(assets.weaponStat.toString()),
    triggers: [], messages: [], map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: 73, sprite: "GRAY" }], directionBits: [], fixedStepMilliseconds: 16,
    orientationSteps: 1, resourceScales: "configured-startup" });
  assert.ok(fresh.ok);
  return createNativeAiProductionConfiguration({ ...productionAssets,
    constructors: await createSourceNativeTaskOptions({ assets, world: fresh.value.world }) });
}

function world(snapshot: Snapshot, normalize = false): NativeAiProductionWorld {
  const game = decode(snapshot.game), bytes = new DataView(game.buffer), control = trace.control;
  if (normalize) {
    const fields = new Map([[control.banks.build, 8 * 280 + 0x98], [control.banks.producerStand, 29 * 280 + 0x80],
      [control.banks.troopStand, 8 * 280 + 0x80]]);
    for (let slot = 0; slot < 800; slot++) for (const field of [0x14, 0x1c, 0x24]) {
      const offset = 0x7d28 + slot * 220 + field, native = bytes.getUint32(offset, true);
      if (fields.has(native)) bytes.setUint32(offset, fields.get(native)!, true);
    }
  }
  return { game, groundCells: Uint32Array.from(snapshot.groundCells), populations: [...snapshot.populations],
    rngCursor: snapshot.rngCursor, width: control.width, height: control.height };
}

test("original ALIEN1160/1192 policy is synchronous; slot207 at1200 is not paid production", async () => {
  assert.deepEqual(trace.runtimeCoreInterceptions, []);
  assert.equal(trace.productionEvents.filter(event => event.address === 0x41c7f8).length, 0);
  const created = trace.productionEvents.find(event => event.address === 0x41af14)!;
  assert.equal(created.counter, 1200);
  assert.equal(created.returnAddress, 0x41b745);
  const configuration = await owner();
  const expected = world(created.after), constructorInput = world(created.before), allocated = 0x7d28 + 207 * 220;
  const nativeStand = new DataView(expected.game.buffer).getUint32(allocated + 0x14, true);
  assert.notEqual(nativeStand, 0);
  for (const current of [constructorInput, expected]) {
    const bytes = new DataView(current.game.buffer);
    for (let slot = 0; slot < 800; slot++) for (const field of [0x14, 0x1c, 0x24]) {
      const offset = 0x7d28 + slot * 220 + field;
      if (bytes.getUint32(offset, true) === nativeStand) bytes.setUint32(offset, 0x80, true);
    }
  }
  const constructed = constructNativeAiProductionActor(configuration, constructorInput, { phase: "constructor-41af14",
    slot: 207, team: 1, unitType: 0, tileX: 11, tileY: 54, expectedRaw: constructorInput.game.slice(allocated, allocated + 220) });
  assert.deepEqual(constructed.world, expected, "natural type0 constructor all220/registry/ground/census/RNG");
  const creationIndex = trace.events.findIndex(event => event.counter === 1200 && event.registryChanges?.some(change => change.slot === 207));
  const visitIndex = trace.events.findIndex(event => event.counter === 1200 && event.phase === "actor" && event.slot === 207);
  assert.ok(creationIndex >= 0 && visitIndex > creationIndex);
  const scheduler = await authenticateLegacyNativeSchedulerSource(productionAssets.executable);
  assert.deepEqual(trace.fullPolicies.map(policy => policy.counter), [1160, 1192]);
  for (const policy of trace.fullPolicies) {
    const game = new Uint8Array(0x471b0), bytes = new DataView(game.buffer);
    game.set(decode(policy.before.entities), 0x7d28);
    game.set(decode(policy.before.teamBytes), 0xb98 + policy.team * 0xe30);
    bytes.setInt32(0x528, policy.populationLimit, true);
    const current: NativeAiProductionWorld = { game, width: policy.navigation.width, height: policy.navigation.height,
      groundCells: Uint32Array.from(policy.inputs.occupancy), populations: Array.from({ length: 8 }, (_, team) => team === policy.team ? policy.population : 0),
      rngCursor: policy.before.rngCursor };
    const result = computeNativeAiProductionPolicy(configuration, current, { policy: decode(policy.before.policy),
      entities: decode(policy.before.entities), rngCursor: policy.before.rngCursor, forceOrder: policy.before.forceOrder,
      navigation: { ...policy.navigation, families: Uint8Array.from(policy.navigation.families), nextFamily: decode(policy.navigation.nextFamily) } },
    { ...policy.inputs, team: policy.team, teamBytes: decode(policy.before.teamBytes),
      population: policy.population, populationLimit: policy.populationLimit, rngTable: scheduler.rngTable,
      types: decode(policy.inputs.types), weapons: decode(policy.inputs.weapons), dependencies: decode(policy.inputs.dependencies),
      neighbors: decode(policy.inputs.neighbors), relations: Uint8Array.from(policy.inputs.relations), groundCells: current.groundCells,
      actorTransport: "synchronous", initialization: policy.counter === 1160
        ? { needed: true, ruleTable: decode(policy.ruleTable), policyAddress: policy.after.policyAddress } : { needed: false } });
    assert.deepEqual(result.candidate.policy, decode(policy.after.policy));
    assert.deepEqual(result.candidate.entities, decode(policy.after.entities));
    assert.deepEqual(result.teamBytes, decode(policy.after.teamBytes));
    assert.equal(result.world.rngCursor, policy.after.rngCursor);
    assert.equal(result.candidate.forceOrder, policy.after.forceOrder);
    assert.deepEqual(result.packets.map(entry => Buffer.from(entry.packet).toString("hex")), policy.packets);
  }
});

test("funded original ALIEN producer: raw receiver, every FIN/handler boundary, constructor and census match", async () => {
  const configuration = await owner(), control = trace.control;
  assert.match(control.label, /not natural AI demand/);
  assert.ok(control.originalCredits < 350);
  const before = world(control.before, true), offset = 0xb98, bytes = new DataView(before.game.buffer);
  const dependency = parseDependencies(productionAssets.dependencies.toString()).find(record => record.rawFields[0] === 1 && record.rawFields[1] === 8)!.id;
  const paid = { phase: "ai-demand-prepaid-unit" as const, team: 0, dependency,
    packet: Uint8Array.of(7, 0, 10, 8, 0, 1, 0), creditsBefore: 1000, creditsAfter: 650,
    expectedQueueLength: bytes.getUint16(offset + 0x110, true), expectedAccounting: bytes.getInt32(offset + 0x18, true) };
  let current = receiveNativeAiPaidProduction(configuration, before, paid).world;
  const inputs: NativeAiProductionReplayInput[] = [{ kind: "paid-receipt", receipt: { ...paid, packet: [...paid.packet] } }];
  assert.deepEqual(current, world(control.received, true));
  const actor = 0x7d28 + 220;
  const visit = () => ({ phase: "producer-handler-entry" as const, slot: 1,
    expectedCounter: new DataView(current.game.buffer).getUint32(0x94c, true), expectedRaw: current.game.slice(actor, actor + 220) });
  let allocated: number | null = null;
  for (const [index, golden] of control.visits.entries()) {
    assert.deepEqual(current, world(golden.before, true), `visit ${index} before`);
    if (index > 0) {
      inputs.push({ kind: "secondary-fin", visit: { ...visit(), expectedRaw: [...visit().expectedRaw] } });
      current = advanceNativeAiProductionFin(configuration, current, visit()).world;
    }
    assert.deepEqual(current, world(golden.handlerEntry, true), `visit ${index} secondary FIN`);
    if (index === control.visits.length - 1) {
      const checkpoint = checkpointNativeAiProduction(configuration, before, inputs);
      const restored = restoreNativeAiProduction(await owner(), before, JSON.parse(JSON.stringify(checkpoint)));
      assert.deepEqual(restored.world, current, "fresh-provider pre-spawn replay");
      const tampered = structuredClone(checkpoint);
      tampered.current.game[0x7d20] ^= 1;
      assert.throws(() => restoreNativeAiProduction(configuration, before, tampered), /replay mismatch/);
      const exhausted = structuredClone(current);
      new DataView(exhausted.game.buffer).setInt32(0x7d20, 799, true);
      assert.throws(() => visitNativeAiProduction(configuration, exhausted, visit()), /freecount/);
      const lost = structuredClone(current);
      lost.groundCells[66 * lost.width + 13] = 1023;
      assert.throws(() => visitNativeAiProduction(configuration, lost, visit()), /reservation/);
    }
    inputs.push({ kind: "producer", visit: { ...visit(), expectedRaw: [...visit().expectedRaw] } });
    const result = visitNativeAiProduction(configuration, current, visit());
    current = result.world;
    allocated = result.allocatedSlot ?? allocated;
    assert.deepEqual(current, world(golden.after, true), `visit ${index} handler`);
  }
  assert.equal(allocated, 208);
  assert.deepEqual(current.populations, before.populations);
  assert.equal(current.rngCursor, before.rngCursor);
  const checkpoint = checkpointNativeAiProduction(configuration, before, inputs);
  assert.deepEqual(restoreNativeAiProduction(await owner(), before, JSON.parse(JSON.stringify(checkpoint))).world, current);
  assert.throws(() => checkpointNativeAiProduction(configuration, before, [inputs[0], inputs[0]]), /stale queue/);
});