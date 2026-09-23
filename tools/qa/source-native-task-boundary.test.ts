import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import { createSourceNativeTaskOptions, type SourceNativeTaskAssets } from "../../src/engine/source-native-task-options";
import { applyLegacyAiActorPacket } from "../../src/engine/legacy-ai-policy";
import { allocateTransportProductionExit, authenticateNativeAiTaskConfiguration, consumeTransportFifo,
  createTransportHostAdapter, initializeTransportHostNativeAiTasks, receiveTransportHostAiPolicy,
  reserveTransportProductionExit, transportHostState, validateTransportConstruction,
  type TransportHostState } from "../../src/engine/transport-host";
import type { NativeConstructionHost } from "../../src/engine/native-construction-host";
import type { PlannedMissionCommand } from "../../src/engine/mission-controller";
import type { TriggerResult } from "../../src/engine/trigger-runtime";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

async function fixture(mission: string) {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const scenario = (extension: string) => read(`raw_cd/DC/SCENARIO/${mission.slice(0, -2)}/${mission}.${extension}`);
  const assets: SourceNativeTaskAssets = { executable: read("raw_cd/DC/DC.EXE"),
    gameStat: read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"), weaponStat: read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT"),
    scenario: scenario("SCN"), map: scenario("MAP"), mtg: scenario("MTG"), pth: scenario("PTH"),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem =>
      [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const text = new TextDecoder(), map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const world = unwrap(initializeCampaignSession({ sessionId: `source-boundary-${mission}`,
    source: parseScenario(text.decode(assets.scenario)), units: parseUnitStats(text.decode(assets.gameStat)),
    weapons: parseWeaponStats(text.decode(assets.weaponStat)), triggers: [], messages: [], map,
    pathGrid: map.pathGrid, tags: map.tagGrid, commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }],
    directionBits: [], fixedStepMilliseconds: 16,
    orientationSteps: 1, resourceScales: "configured-startup" })).world;
  const configuration = await authenticateNativeAiTaskConfiguration(await createSourceNativeTaskOptions({ assets, world }));
  return { world, configuration, installed: unwrap(initializeTransportHostNativeAiTasks(world, configuration)) };
}

const human = fixture("HUMAN01"), resources = fixture("HUMAN02");

function modified(world: CampaignWorld, mutate: (world: CampaignWorld, host: TransportHostState) => void): CampaignWorld {
  const copy = structuredClone(world), host = transportHostState(copy);
  mutate(copy, host);
  return { ...copy, transportState: host };
}

test("install rejects authenticated-config unowned slot152 HP800->1 without rewriting the input", async () => {
  const { world, configuration } = await human;
  assert.equal(transportHostState(world).slots[152]!.health, 800);
  assert.ok(!configuration.bindings.some(binding => binding.slot === 152));
  const changed = modified(world, copy => new DataView(copy.entityBytes!.buffer).setInt32(152 * 220 + 12, 1, true));
  const before = structuredClone(changed);
  const rejected = initializeTransportHostNativeAiTasks(changed, configuration);
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected), /source world attestation mismatch/);
  assert.deepEqual(changed, before);
});

test("install validates all unowned, CITY and neutral resource identities and protected raw fields", async () => {
  const { world, configuration } = await resources, state = transportHostState(world);
  const slots = [state.slots.find(actor => actor && actor.slot < 152)!.slot,
    state.slots.find(actor => actor && actor.slot >= 152 && !actor.resource
      && !configuration.bindings.some(binding => binding.slot === actor.slot))!.slot,
    state.slots.find(actor => actor?.resource)!.slot];
  for (const slot of slots) {
    for (const offset of [0, 2, 4, 6, 7, 12, 0x2c]) {
      const changed = modified(world, copy => { copy.entityBytes![slot * 220 + offset] ^= 1; });
      const before = structuredClone(changed);
      assert.equal(initializeTransportHostNativeAiTasks(changed, configuration).ok, false, `slot ${slot}, offset ${offset}`);
      assert.deepEqual(changed, before);
    }
    for (const mutate of [
      (_copy: CampaignWorld, host: TransportHostState) => { host.registry[slot] = "stale"; },
      (_copy: CampaignWorld, host: TransportHostState) => { host.generations[slot]++; },
      (_copy: CampaignWorld, host: TransportHostState) => { host.slots[slot]!.slot++; },
      (copy: CampaignWorld) => { (copy.entities.find(entity => entity.rawSlot === slot)! as { health: number }).health++; },
      (copy: CampaignWorld) => { (copy.entities.find(entity => entity.rawSlot === slot)! as { tileX: number }).tileX++; },
    ]) {
      const changed = modified(world, mutate), before = structuredClone(changed);
      assert.equal(initializeTransportHostNativeAiTasks(changed, configuration).ok, false);
      assert.deepEqual(changed, before);
    }
  }
  const resource = slots[2];
  for (const offset of [0x32, 0x46]) {
    const changed = modified(world, copy => { copy.entityBytes![resource * 220 + offset] ^= 1; });
    const before = structuredClone(changed);
    assert.equal(initializeTransportHostNativeAiTasks(changed, configuration).ok, false);
    assert.deepEqual(changed, before);
  }
  const empty = state.slots.findIndex(actor => !actor);
  const changed = modified(world, copy => { copy.entityBytes![empty * 220 + 0x2c] = 255; });
  assert.equal(initializeTransportHostNativeAiTasks(changed, configuration).ok, false);
});

test("install preserves unowned constructor bytes and coherent signed HP/status representations", async () => {
  const { world, configuration, installed } = await resources;
  for (let slot = 0; slot < 800; slot++) if (!configuration.bindings.some(binding => binding.slot === slot)) {
    assert.deepEqual(installed.entityBytes!.slice(slot * 220, (slot + 1) * 220), world.entityBytes!.slice(slot * 220, (slot + 1) * 220));
  }
  const state = transportHostState(installed);
  const slot = state.slots.find(actor => actor?.resource)!.slot;
  assert.ok(slot >= 152);
  for (const status of [-1, 255]) {
    const changed = modified(installed, (copy, host) => {
      host.slots[slot]!.status = status;
      host.slots[slot]!.health = -1;
      copy.entityBytes![slot * 220 + 0x2c] = 255;
      new DataView(copy.entityBytes!.buffer).setInt32(slot * 220 + 12, -1, true);
      (copy.entities.find(entity => entity.rawSlot === slot)! as { health: number }).health = -1;
    });
    const before = structuredClone(changed);
    const received = receiveTransportHostAiPolicy(changed, changed.entityBytes!, [], "signed-current", "deferred");
    assert.deepEqual(received.entityBytes, changed.entityBytes);
    assert.deepEqual(changed, before);
  }
});

test("AI receipts authenticate and align current world before candidate or packet reads, even when empty", async () => {
  const { installed } = await human;
  for (const mutate of [
    (_copy: CampaignWorld, host: TransportHostState) => { (host.nativeAiTasks!.configuration.profiles[0].typeBytes as number[])[8] ^= 1; },
    (copy: CampaignWorld) => { copy.entityBytes![152 * 220 + 12] ^= 1; },
    (_copy: CampaignWorld, host: TransportHostState) => { host.registry[152] = null; },
  ]) {
    const changed = modified(installed, mutate), before = structuredClone(changed);
    for (const timing of ["deferred", "synchronous"] as const) {
      assert.throws(() => receiveTransportHostAiPolicy(changed, changed.entityBytes!, [], "empty", timing),
        /Native AI|Source native task: source authentication required/);
      assert.throws(() => receiveTransportHostAiPolicy(changed, new Uint8Array(), [new Uint8Array([255])], "bad", timing),
        /Native AI source authentication|Native AI raw\/host|Source native task: source authentication required/);
      assert.deepEqual(changed, before);
    }
  }
  const actor = transportHostState(installed).slots.find(actor => actor?.nativeAiTask)!;
  const packet = Buffer.from([7, 0, 5, actor.slot & 255, actor.slot >>> 8, 2, 0]);
  const candidate = new Uint8Array(installed.entityBytes!);
  applyLegacyAiActorPacket(candidate, packet);
  const before = structuredClone(installed), candidateBefore = new Uint8Array(candidate);
  const synchronous = receiveTransportHostAiPolicy(installed, candidate, [packet], "pending", "synchronous");
  const deferred = receiveTransportHostAiPolicy(installed, installed.entityBytes!, [packet], "pending", "deferred");
  assert.deepEqual(synchronous, deferred);
  assert.equal(synchronous.entityBytes![actor.slot * 220 + 0x36], 1);
  assert.deepEqual(candidate, candidateBefore);
  assert.deepEqual(installed, before);
});

test("source reservation, direct create and FIFO preflight unsupported batches without receipts or debits", async () => {
  const { world, installed } = await human, state = transportHostState(installed);
  const cell = state.ground.findIndex((slot, index) => slot === -1 && state.groundEligible[index]
    && (state.nativeAiTasks!.ground[index] & 1023) === 1023);
  assert.ok(cell >= 0);
  const tile = { x: cell % state.width, y: Math.floor(cell / state.width) };
  for (const unitType of [1, 6, 5]) {
    const request = { key: JSON.stringify([world.sessionId, 0, 0, "unsupported"]), team: 0, queue: 0 as const,
      ticket: "unsupported", unitType, tile };
    const before = structuredClone(installed);
    for (const action of [reserveTransportProductionExit, allocateTransportProductionExit]) {
      const result = action(installed, request);
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), /unsupported source native allocation/);
      assert.deepEqual(installed, before);
    }
    assert.equal(reserveTransportProductionExit(world, request).ok, true, "legacy reservation remains available");
    for (const queued of [false, true]) {
      const candidate = modified(installed, (_copy, host) => {
        if (queued) host.fifos.push({ tile, types: [] });
      });
      const planned: PlannedMissionCommand = { id: `batch-${queued}-${unitType}`, triggerId: 1, actionIndex: 0,
        action: { name: "reinforce2", arguments: [] }, command: { kind: "reinforce2", team: 0,
          tileX: tile.x, tileY: tile.y, groups: [{ unitType: 0, count: 1 }, { unitType, count: 1 }] } };
      const candidateBefore = structuredClone(candidate), result = createTransportHostAdapter().prepare(candidate, planned);
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), /unsupported source native allocation/);
      assert.deepEqual(candidate, candidateBefore);
      const legacy = modified(world, (_copy, host) => { if (queued) host.fifos.push({ tile, types: [] }); });
      assert.equal(createTransportHostAdapter().prepare(legacy, planned).ok, true, "legacy batches remain available");
    }
    const queued = modified(installed, (_copy, host) => { host.fifos.push({ tile, types: [unitType] }); });
    const queuedBefore = structuredClone(queued);
    assert.equal(consumeTransportFifo(queued, transportHostState(queued).fifos.length - 1, 0).ok, false);
    assert.deepEqual(queued, queuedBefore);
  }
  const flying = modified(installed, (_copy, host) => {
    host.definitions = host.definitions.map(entry => entry.unitType === 0 ? { ...entry, plane: "flying" } : entry);
  });
  assert.equal(reserveTransportProductionExit(flying, { key: JSON.stringify([world.sessionId, 0, 0, "air"]),
    team: 0, queue: 0, ticket: "air", unitType: 0, tile }).ok, false);
  const queued = modified(installed, (_copy, host) => { host.fifos.push({ tile, types: [] }); });
  const planned: PlannedMissionCommand = { id: "supported-fifo", triggerId: 1, actionIndex: 0,
    action: { name: "reinforce2", arguments: [] }, command: { kind: "reinforce2", team: 0,
      tileX: tile.x, tileY: tile.y, groups: [{ unitType: 0, count: 1 }, { unitType: 3, count: 1 }] } };
  const enqueued = unwrap(createTransportHostAdapter().prepare(queued, planned)).world;
  const fifoIndex = transportHostState(enqueued).fifos.length - 1;
  assert.deepEqual(transportHostState(enqueued).fifos[fifoIndex].types, [0, 3]);
  const consumed = unwrap(consumeTransportFifo(enqueued, fifoIndex, 0));
  assert.deepEqual(transportHostState(consumed).fifos[fifoIndex].types, [3]);
  assert.ok(transportHostState(consumed).slots.some(actor => actor?.key.startsWith("transport:") && actor.nativeAiTask));
});

test("CITY and native task schedulers reject their combination in either installation direction", async () => {
  const { world, configuration, installed } = await human;
  const city = modified(world, (_copy, host) => {
    const actor = host.slots.find(actor => actor && actor.slot < 152)!;
    actor.nativeConstruction = { team: actor.team, receiptId: "science", raw: Array.from(world.entityBytes!.slice(actor.slot * 220, (actor.slot + 1) * 220)) };
  });
  const before = structuredClone(city);
  const result = initializeTransportHostNativeAiTasks(city, configuration);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /source world attestation mismatch/);
  assert.deepEqual(city, before);
  const state = transportHostState(installed);
  const construction = { configuration: { map: { width: state.width, height: state.height } } } as NativeConstructionHost;
  const installedBefore = structuredClone(installed);
  assert.throws(() => validateTransportConstruction(installed, construction), /CITY map or shared native task scheduler/);
  assert.deepEqual(installed, installedBefore);
});