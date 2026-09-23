import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSourceResourceOptions, selectSourceResourceConfiguration, sourceResourceMultipliers,
  sourceResourceProfiles, sourceResourceFrame, sourceHarvesterConstructorBinding } from "../../src/engine/source-resource-options.ts";
import { initializeCampaignSession } from "../../src/engine/campaign-session.ts";
import { bindCampaignResourceTask, configureCampaignResourceLifecycle, stepTransportHost, transportHostState, type ResourceHostBinding,
  type ResourceHostOptions } from "../../src/engine/transport-host.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";
import { parseFin } from "../extractors/animations/fin.ts";
import { sourceDayNightFromHeader } from "../../src/engine/source-day-night.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const json = (path: string) => JSON.parse(read(path).toString());
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const units = json("public/assets/generated/data/units.json").records;
const native = JSON.parse(process.env.DC_SOURCE_RESOURCE_TRACE ? readFileSync(process.env.DC_SOURCE_RESOURCE_TRACE, "utf8")
  : execFileSync("python3", [`${root}tools/qa/source-resource-options-native.py`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as {
  executableSha256: string; configuration: { constructorPercentages: number[]; multipliers: number[]; initialIncome: number[]; localTeam: number;
    loadedGates: number[]; modeGate: number; headers: { provenance: string; header: number[]; mode: number; race: number }[] };
  missions: { name: string; sha256: string; fresh: { cancellationGate: number; localTeam: number; initialIncome: number[] };
    records: { sourceRow: number; slot: number; row: number[]; direction: number; rateWord: number; constructor: Constructor }[];
    harvesters: { direction: number; constructor: Constructor }[];
    profiles: { sources: { source: string; sha256: string }[]; bindings: { unitType: number; standBank: number;
      deployBank: number; deathBank: number; deathVariants: number; selectedWeapon: number; removalHoldField: number }[] };
    animations: ResourceHostOptions["animations"]; scnExternalBoundaries: string[]; directionSearch: number[] }[];
};
interface Constructor {
  id: number; type: number; hp: number; team: number; activeSlot: number; status: number; pendingOrder: number; order: number;
  taskDepth: number; task: number; taskWords: number[]; animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 | 3 };
}

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected supported fixture");
  return result.value;
}

function input(faction: "human" | "alien") {
  const name = `${faction.toUpperCase()}02`, stem = `${faction.toUpperCase()}/${name}`;
  const rawScenario = read(`raw_cd/DC/SCENARIO/${stem}.SCN`);
  const source = parseScenario(rawScenario.toString());
  const asset = (extension: string) => read(`raw_cd/DC/SCENARIO/${stem}.${extension}`);
  const map = parseMapBundle(asset("MAP"), asset("MTG"), asset("PTH"));
  const mission = { faction, units, scenario: json(`public/assets/generated/data/scenarios/${stem}.json`) };
  const configuration = selectSourceResourceConfiguration({ profile: "user-selected-source-campaign-fresh", mode: 0,
    localTeam: 0, race: faction === "human" ? 0 : 1 }, "native-constructor");
  const initialized = unwrap(initializeCampaignSession({ sessionId: name, source, units,
    weapons: json("public/assets/generated/data/weapons.json").records, messages: [], triggers: [], map,
    pathGrid: map.pathGrid, tags: map.tagGrid, commanders: [{ team: 0, unitType: faction === "human" ? 69 : 73,
      sprite: faction === "human" ? "TRSC" : "GRAY" }], directionBits: [[0, 0]], fixedStepMilliseconds: 16,
    orientationSteps: 1, resourceScales: "configured-startup" }));
  return { sessionId: name, mission, rawScenario, configuration, world: initialized.world,
    loadBytes: async (url: string) => read(`public${url}`) };
}

test("hash-pinned native constructor, full bounded SCN and fresh configuration goldens", () => {
  assert.equal(native.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(digest(read("raw_cd/DC/DC.EXE")), native.executableSha256);
  const { loadedGates, modeGate, headers, ...configuration } = native.configuration;
  assert.deepEqual(configuration, { constructorPercentages: Array(8).fill(100), multipliers: Array(8).fill(256),
    initialIncome: Array(8).fill(0), localTeam: 0 });
  assert.deepEqual(loadedGates, [0, 1, 1]);
  assert.equal(modeGate, 1);
  assert.deepEqual(headers.map(({ mode, race }) => [mode, race]), [[0, 0], [0, 1]]);
  for (const header of headers) {
    assert.equal(header.provenance, "explicit-user-selected-header-not-installed-config");
    assert.deepEqual(header.header, [1, 0, header.race, 0, 0, 0, 0, 0]);
  }
  assert.deepEqual(native.missions.map((mission) => mission.name), ["HUMAN02", "ALIEN02"]);
  for (const mission of native.missions) {
    assert.deepEqual(mission.fresh, { cancellationGate: 0, localTeam: 0, initialIncome: Array(8).fill(0) });
    assert.ok(mission.scnExternalBoundaries.includes("0x43c388"));
    assert.deepEqual(mission.directionSearch, [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16]);
    for (const source of mission.profiles.sources) assert.equal(digest(read(source.source)), source.sha256);
  }
});

test("configuration selection is explicit, copied, and rejects unproved named difficulty or custom percentages", () => {
  for (const race of [0, 1] as const) {
    const profile = { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race } as const;
    const selected = selectSourceResourceConfiguration(profile, "native-constructor");
    assert.deepEqual(sourceResourceMultipliers(selected), native.configuration.multipliers);
    assert.notEqual(selected, profile);
    for (const name of ["easy", "normal", "hard", undefined]) {
      assert.throws(() => selectSourceResourceConfiguration(profile, name as never), /unproved/);
    }
    assert.throws(() => sourceResourceMultipliers({ ...selected, aiPercentages: [100] }), /percentages/);
    assert.throws(() => sourceResourceMultipliers({ ...selected, aiPercentages: Array(8).fill(125) }), /percentages/);
    assert.throws(() => selectSourceResourceConfiguration({ ...profile, mode: 1 } as never, "native-constructor"), /profile/);
  }
});

test("all resource FIN directions, fallbacks and type fields equal executed native banks", () => {
  const metadata = Object.fromEntries(["VENT", "EXPL", "SLUG"].map((stem) => {
    const generated = json(`public/assets/generated/animations/${stem}.json`);
    const raw = read(`raw_cd/DC/ANIMATE/${stem}.FIN`);
    const decoded = parseFin(raw);
    assert.equal(digest(raw), generated.source.sha256);
    assert.deepEqual(generated.states, decoded.states);
    assert.deepEqual(generated.timeline.map((frame: { field2: number }) => frame.field2), decoded.timeline.map((frame) => frame.field2));
    return [stem, generated];
  })) as Parameters<typeof sourceResourceProfiles>[0];
  const actual = sourceResourceProfiles(metadata);
  assert.equal(actual.types.length, 5);
  for (const mission of native.missions) for (const profile of actual.types) {
    const expected = mission.profiles.bindings.find((binding) => binding.unitType === profile.unitType)!;
    assert.deepEqual([profile.deathVariants, profile.removalHoldField, profile.selectedWeapon],
      [expected.deathVariants, expected.removalHoldField, expected.selectedWeapon | 0]);
    for (const field of ["stand", "deploy", "death"] as const) {
      const bank = mission.animations.find((animation) => animation.id === String(expected[`${field}Bank`]))!;
      assert.equal(bank.directions.length, 32);
      assert.deepEqual(actual.animations.find((animation) => animation.id === profile[field])!.directions, bank.directions,
        `${mission.name} ${profile.unitType} ${field}`);
    }
  }
});

for (const faction of ["human", "alien"] as const) {
  test(`${faction}: seven-row mapping pairs unchanged source world, raw bytes and actual native host`, async () => {
    const request = input(faction), before = structuredClone(request.world);
    const expected = native.missions.find((mission) => mission.name === request.sessionId)!;
    assert.equal(digest(request.rawScenario), expected.sha256);
    const options = await loadSourceResourceOptions(request);
    assert.deepEqual(request.world, before);
    assert.equal(options.missionAdmission, "not-evaluated");
    assert.ok(options.prerequisites.includes("generic-mobile-idle-owner"));
    assert.deepEqual(options.resourceInitialIncome, expected.fresh.initialIncome);
    assert.equal(options.resourceFrameSource.cancellationGate, expected.fresh.cancellationGate);
    assert.deepEqual(options.resourceFrameSource.aiMultipliers, native.configuration.multipliers);
    assert.deepEqual(options.resourceLifecycle.bindings.map((binding) => binding.slot), expected.records.map((entry) => entry.slot));
    for (const record of expected.records) {
      const binding = options.resourceLifecycle.bindings.find((entry) => entry.slot === record.slot)!;
      assert.deepEqual(binding.state, { direction: record.direction,
        animation: { profile: "VENTSTAND", frame: record.constructor.animation.frame, delay: record.constructor.animation.delay,
          mode: record.constructor.animation.mode }, pendingOrder: record.constructor.pendingOrder, order: record.constructor.order,
        released: false, stack: [{ opcode: record.constructor.task, words: record.constructor.taskWords.slice(0, 3) }] });
      const entity = transportHostState(request.world).slots[record.slot]!;
      assert.deepEqual([entity.health, entity.resource!.rateWord, entity.team, entity.status],
        [record.constructor.hp, record.rateWord, record.constructor.team, record.constructor.status]);
      assert.equal(record.constructor.activeSlot, record.slot);
      assert.deepEqual(record.row, options.source.placementRows[record.sourceRow]);
    }
    const configured = unwrap(configureCampaignResourceLifecycle(request.world, options.resourceLifecycle));
    assert.equal(transportHostState(configured).slots[expected.records[0].slot]!.resourceTask!.stack[0].words[0], 65535);
    assert.deepEqual(options.eruption, { category: 1, event: 7, soundId: 183, source: "SOUND/ERUPT.WAV", spatial: false });
  });

  test(`${faction}: frame derives live full32 HP and advances source clock once without mutating state`, async () => {
    const request = input(faction), options = await loadSourceResourceOptions(request);
    const sourceDayNight = sourceDayNightFromHeader(options.source.rawHeader);
    const world = { ...request.world, buildingSlots: { ...request.world.buildingSlots, "0,0": 65536 } };
    const frameInput = { ...options.resourceFrameSource, sourceDayNight, world };
    const before = structuredClone(frameInput);
    const frame = unwrap(sourceResourceFrame(frameInput));
    assert.equal(frame.resourceFrame.nativePhaseCounter, (faction === "human" ? 5100 : 5700) + 1);
    assert.equal(frame.resourceFrame.sides[0].creditGate, 65536);
    assert.deepEqual(frameInput, before);
    assert.equal(sourceResourceFrame({ ...frameInput, aiMultipliers: [] }).ok, false);
    const changed = unwrap(sourceResourceFrame({ ...frameInput, cancellationGate: 1, localTeam: 1,
      aiMultipliers: Array(8).fill(512) }));
    assert.equal(changed.resourceFrame.cancellationGate, 1);
    assert.equal(changed.resourceFrame.localTeam, 1);
    assert.equal(changed.resourceFrame.sides[0].aiMultiplier, 512);
  });
}

test("builder rejects hash, configuration, source world, host and raw-byte mismatches transactionally", async () => {
  const request = input("human");
  await assert.rejects(loadSourceResourceOptions({ ...request, rawScenario: input("alien").rawScenario }), /SCN hash/);
  await assert.rejects(loadSourceResourceOptions({ ...request, configuration: undefined! }), /profile/);
  await assert.rejects(loadSourceResourceOptions({ ...request, world: { ...request.world, clockMilliseconds: 1 } }), /fresh/);
  await assert.rejects(loadSourceResourceOptions({ ...request, world: { ...request.world,
    source: { ...request.world.source, placementRows: [] } } }), /world placementRows/);
  for (const mutate of [
    (world: typeof request.world) => {
      const entity = (world.transportState as ReturnType<typeof transportHostState>).slots[166]!;
      entity.position = { ...entity.position, x: entity.position.x + 1 };
    },
    (world: typeof request.world) => { (world.transportState as ReturnType<typeof transportHostState>).registry[166] = null; },
    (world: typeof request.world) => { world.entityBytes![166 * 220 + 9] = 1; },
  ]) {
    const world = structuredClone(request.world); mutate(world);
    const before = structuredClone(world);
    await assert.rejects(loadSourceResourceOptions({ ...request, world }), /native/);
    assert.deepEqual(world, before);
  }
  await assert.rejects(loadSourceResourceOptions({ ...request, loadBytes: async (url) => {
    const bytes = await request.loadBytes(url);
    if (!url.endsWith("VENT.json")) return bytes;
    const changed = JSON.parse(bytes.toString()); changed.timeline[19].field2 += 1;
    return Buffer.from(JSON.stringify(changed));
  } }), /FIN hash/);
});

test("fresh harvester binding requires actual native constructor direction and idle payload, never generic idle", async () => {
  for (const observed of native.missions[0].harvesters) {
    const request = input("human");
    const options = await loadSourceResourceOptions(request);
    const world = unwrap(configureCampaignResourceLifecycle(request.world, options.resourceLifecycle));
    const host = world.transportState as ReturnType<typeof transportHostState>;
    const slot = observed.constructor.id, key = `constructor:${slot}`;
    host.slots[slot] = { slot, generation: 1, key, unitType: observed.constructor.type, team: observed.constructor.team,
      health: observed.constructor.hp, status: 1, position: { x: 1408, y: 1408 }, height: 0, task: "unit", taskWords: [] };
    host.registry[slot] = key;
    const binding: ResourceHostBinding = { slot, generation: 1, state: { direction: observed.direction,
      animation: { profile: observed.constructor.type === 6 ? "EXPLSTAND" : "SLUGSTAND", frame: observed.constructor.animation.frame,
        delay: observed.constructor.animation.delay, mode: observed.constructor.animation.mode },
      pendingOrder: observed.constructor.pendingOrder, order: observed.constructor.order, released: false,
      stack: [{ opcode: 1, words: observed.constructor.taskWords.slice(0, 3) }] } };
    assert.deepEqual(sourceHarvesterConstructorBinding(world, binding), binding);
    assert.notEqual(sourceHarvesterConstructorBinding(world, binding), binding);
    assert.throws(() => sourceHarvesterConstructorBinding(world, { ...binding, state: { ...binding.state, direction: 0 } }), /constructor/);
    assert.throws(() => sourceHarvesterConstructorBinding(world, { ...binding, generation: 0 }), /identity/);
    assert.throws(() => sourceHarvesterConstructorBinding(world, { ...binding,
      state: { ...binding.state, stack: [{ opcode: 1, words: [65535, 800, 0] }] } }), /constructor/);
    const bound = unwrap(bindCampaignResourceTask(world, sourceHarvesterConstructorBinding(world, binding)));
    const before = structuredClone(bound);
    const frame = unwrap(sourceResourceFrame({ ...options.resourceFrameSource, world: bound, rawHeader: options.source.rawHeader }));
    const blocked = stepTransportHost(bound, frame.resourceFrame);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.diagnostics[0].message, /general mobile idle\/wait/);
    assert.deepEqual(bound, before);
  }
});