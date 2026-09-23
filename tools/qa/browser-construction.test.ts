import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { CampaignSession } from "../../src/engine/campaign-session";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { transportHostState } from "../../src/engine/transport-host";
import { createBrowserConstruction, createBrowserConstructionConfiguration, reduceBrowserConstruction,
  restoreBrowserConstruction, validateBrowserConstruction, type BrowserConstructionRequest } from "../../src/engine/browser-construction";
import type { CampaignWorld } from "../../src/engine/campaign-world";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));

test("browser construction: original ALIEN10 empty-city source contract", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(read(`public${path}`)).buffer);
  });
  const mission = await loadCampaignMission("alien", 10, "browser-adapted");
  const world = new CampaignSession(sourceBrowserCampaignSessionOptions(mission)).snapshot.world;
  assert.equal(mission.scenario.teams[0].money, 1500);
  assert.deepEqual(mission.scenario.teams[0].coordinateRows[1], [119, 6]);
  assert.deepEqual(Array.from({ length: 5 }, (_, slot) => world.buildingSlots[`0,${slot}`]), [0, 0, 0, 0, 0]);
  assert.equal(transportHostState(world).slots[0], null);
  const records = JSON.parse(read("public/assets/generated/data/dependencies.json").toString()).records;
  assert.deepEqual(records.find((record: { id: number }) => record.id === 14),
    { id: 14, cost: 2000, interfaceId: 205, rawFields: [0, 0, 0, 1], dependencies: [] });
  assert.match(read("raw_cd/DC/SCENARIO/ALIEN/ALIEN10.TRO").toString(), /c>180/);
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const host = transportHostState(world);
  context.diagnostic(JSON.stringify({ scenario: mission.scenario.source, dimensions: [mission.map.width, mission.map.height],
    pathHash: hash(mission.pathGrid), tagsHash: hash(mission.tags), credits: world.exomoney,
    health: mission.units.filter(unit => [16, 28].includes(unit.index)).map(unit => [unit.index, unit.health]),
    cells: [[116, 6], [117, 6], [116, 7], [117, 7]].map(([tileX, tileY]) => {
      const cell = tileY * host.width + tileX;
      return [tileX, tileY, host.groundEligible[cell], host.ground[cell], host.resourceTileFlags[cell]];
    }) }));
});

test("browser construction: ALIEN10 owner transactions and explicitly funded integration controls", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(read(`public${path}`)).buffer);
  });
  const mission = await loadCampaignMission("alien", 10, "browser-adapted");
  const missionBefore = structuredClone(mission);
  const assetPaths = ["SCN", "TRO", "MAP", "MTG", "PTH"].map(extension => `raw_cd/DC/SCENARIO/ALIEN/ALIEN10.${extension}`);
  const assetHashes = assetPaths.map(path => createHash("sha256").update(read(path)).digest("hex"));
  const world = new CampaignSession(sourceBrowserCampaignSessionOptions(mission)).snapshot.world;
  const before = structuredClone(world);
  const configuration = await createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission, completionVisits: 3 });
  assert.equal(configuration.cost, 2000);
  assert.equal(configuration.building.maxHealth, 4800);
  assert.deepEqual(configuration.building.nativePosition, { x: 29952, y: 1656 });
  assert.deepEqual(configuration.building.footprint, [{ x: 116, y: 6 }, { x: 117, y: 6 }, { x: 116, y: 7 }, { x: 117, y: 7 }]);
  assert.ok(Object.isFrozen(configuration.policy));
  assert.ok(Object.isFrozen(configuration.building.footprint));
  const options = sourceBrowserCampaignSessionOptions(mission);
  const session = new CampaignSession({ ...options, browserConstruction: configuration });
  assert.equal(session.snapshot.browserConstruction?.phase, "empty");
  const initialCheckpoint = session.checkpoint();
  assert.deepEqual(CampaignSession.restore(initialCheckpoint, undefined, undefined, undefined, undefined, undefined, configuration).checkpoint(), initialCheckpoint);
  assert.throws(() => CampaignSession.restore(initialCheckpoint), /construction restore/);
  assert.equal(new CampaignSession(options).snapshot.browserConstruction, undefined);
  assert.throws(() => new CampaignSession({ ...options, browserConstruction: structuredClone(configuration) }), /authenticated/);
  assert.throws(() => new CampaignSession({ ...options, browserConstruction: configuration, fixedStepMilliseconds: 25 }), /authenticated source/);
  assert.throws(() => new CampaignSession({ ...options, browserConstruction: configuration,
    pathGrid: new Uint8Array(options.pathGrid.length) }), /authenticated source/);
  assert.throws(() => new CampaignSession({ ...options, browserConstruction: configuration,
    units: options.units.map(unit => unit.index === 28 ? { ...unit, health: 1 } : unit) }), /authenticated source/);
  assert.throws(() => new CampaignSession({ ...options, runtimeProfile: "strict-native", browserConstruction: configuration }), /browser-adapted/);
  const state = createBrowserConstruction(configuration, world);
  const purchase: BrowserConstructionRequest = { type: "purchase", id: "player:central-base:1", sequence: 1,
    dependency: 14, home: { x: 119, y: 6 } };
  const rejected = session.step({ clockMilliseconds: 50, browserConstructionRequest: purchase });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected), /insufficient credits/);
  assert.deepEqual(session.checkpoint(), initialCheckpoint, "rejected session purchase is atomic");
  const income = { scope: "browser-adapted-economy-v1" as const, profileId: mission.browserEconomy!.profileId,
    sessionId: options.sessionId, team: 0, earnedTotal: 500 };
  const startedSession = session.step({ clockMilliseconds: 50, economyIncome: [income], browserConstructionRequest: purchase });
  assert.equal(startedSession.ok, true, JSON.stringify(startedSession.ok ? "" : startedSession.diagnostics));
  assert.equal(session.snapshot.world.exomoney[0], 0);
  assert.ok(session.snapshot.staticSlots.includes(0));
  const buildingCheckpoint = session.checkpoint();
  const resumedSession = CampaignSession.restore(buildingCheckpoint, undefined, undefined, undefined, undefined, undefined, configuration);
  assert.deepEqual(resumedSession.checkpoint(), buildingCheckpoint);
  for (let tick = 2; tick <= 4; tick++) {
    const input = { clockMilliseconds: tick * 50, economyIncome: [income] };
    const result = session.step(input);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? "" : result.diagnostics));
    assert.deepEqual(resumedSession.step(input), result);
  }
  assert.equal(session.snapshot.browserConstruction?.phase, "ready");
  assert.equal(session.snapshot.world.exomoney[0], 0, "income synchronization does not undo the debit");
  assert.deepEqual(resumedSession.checkpoint(), session.checkpoint());
  assert.equal(session.identityProvenance.filter(event => event.type === "create" && event.slot === 0).length, 1);
  const forged = { ...buildingCheckpoint, state: { ...buildingCheckpoint.state,
    browserConstruction: { ...buildingCheckpoint.state.browserConstruction!, paid: 0 } } };
  assert.throws(() => CampaignSession.restore(forged, undefined, undefined, undefined, undefined, undefined, configuration), /replay/);
  const rollback = new CampaignSession({ ...options, browserConstruction: configuration });
  const lateFailure = rollback.step({ clockMilliseconds: 50, economyIncome: [income], browserConstructionRequest: purchase,
    resourceFrameSource: {} as NonNullable<Parameters<CampaignSession["step"]>[0]["resourceFrameSource"]> });
  assert.equal(lateFailure.ok, false);
  assert.deepEqual(rollback.checkpoint(), initialCheckpoint, "late outer failure rolls back credits, slot and progress");
  assert.throws(() => reduceBrowserConstruction(configuration, state, world, purchase), /insufficient credits/);
  assert.deepEqual(world, before, "original 1500-credit opening is not silently funded");
  assert.equal(world.entities.filter(entity => entity.team === 0 && entity.unitType === 14).length, 0,
    "no initial source collector available to erase the funding gap");
  const funded: CampaignWorld = { ...world, exomoney: { ...world.exomoney, 0: 2000 } };
  const fundedBefore = structuredClone(funded);
  assert.throws(() => reduceBrowserConstruction(configuration, state, funded, { ...purchase, home: { x: 120, y: 6 } }), /placement/);
  assert.throws(() => reduceBrowserConstruction(configuration, state, funded, { ...purchase, dependency: 0 }), /dependency/);
  assert.deepEqual(funded, fundedBefore);

  const started = reduceBrowserConstruction(configuration, state, funded, purchase);
  assert.deepEqual(funded, fundedBefore, "planning does not mutate the input world");
  assert.equal(started.world.exomoney[0], 0);
  assert.equal(started.state.paid, 2000);
  assert.equal(started.state.costAccumulator, 2000);
  assert.equal(started.state.phase, "building");
  assert.equal(started.world.buildingSlots["0,0"], 4800, "source receipt health precedes readiness");
  assert.deepEqual(started.world.statistics, world.statistics, "static construction is not a mobile build/kill statistic");
  const host = transportHostState(started.world), initialHost = transportHostState(world);
  assert.equal(host.highWater, initialHost.highWater);
  assert.deepEqual(started.world.placementState, world.placementState);
  assert.equal(host.generations[0], 0);
  assert.equal(host.registry[0], started.world.entities.at(-1)!.key);
  assert.equal(host.slots[0]!.nativeConstruction, undefined);
  assert.equal(host.requests.length, initialHost.requests.length + 1);
  for (const cell of configuration.building.footprint) {
    assert.equal(host.ground[cell.y * host.width + cell.x], 0);
    assert.equal(host.groundEligible[cell.y * host.width + cell.x], false);
  }
  const bytes = new DataView(started.world.entityBytes!.buffer);
  assert.equal(bytes.getInt32(12, true), 4800);
  assert.equal(bytes.getUint16(0, true), 29952);
  assert.equal(bytes.getUint16(4, true), 1656);
  assert.equal(bytes.getUint8(6), 28);
  assert.equal(bytes.getUint8(7), 0);
  assert.equal(bytes.getUint8(0x2c), 1);
  assert.deepEqual(started.world.entityBytes!.slice(220), world.entityBytes!.slice(220));
  assert.throws(() => reduceBrowserConstruction(configuration, started.state, started.world, purchase), /sequence/);
  assert.throws(() => reduceBrowserConstruction(configuration, started.state, started.world, { ...purchase, sequence: 2 }), /duplicate/);

  const reauthenticated = await createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission, completionVisits: 3 });
  let live = started;
  let restored = restoreBrowserConstruction(reauthenticated, JSON.parse(JSON.stringify(started.state)), structuredClone(started.world));
  for (let sequence = 2; sequence <= 4; sequence++) {
    const request = { type: "visit" as const, sequence };
    live = reduceBrowserConstruction(configuration, live.state, live.world, request);
    const mirror = reduceBrowserConstruction(reauthenticated, restored, structuredClone(live.world), request);
    assert.deepEqual(mirror, live, "restored owner continues identically against the same external world");
    restored = restoreBrowserConstruction(reauthenticated, JSON.parse(JSON.stringify(mirror.state)), mirror.world);
  }
  assert.equal(live.state.phase, "ready");
  assert.equal(live.effects[0].type, "construction-ready");
  assert.equal(live.effects[0].busy, 0);
  assert.equal(transportHostState(live.world).requests.length, host.requests.length, "completion emits no second create");
  assert.equal(live.world.exomoney[0], 0, "visits do not debit again");
  assert.throws(() => reduceBrowserConstruction(configuration, live.state, live.world, { type: "visit", sequence: 5 }), /no active/);
  assert.throws(() => createBrowserConstruction(structuredClone(configuration), world), /authenticated/);
  assert.throws(() => restoreBrowserConstruction(configuration, { ...started.state, paid: 0 }, started.world), /accounting/);
  assert.throws(() => restoreBrowserConstruction(configuration, { ...started.state, phase: "ready" }, started.world), /phase/);
  assert.throws(() => restoreBrowserConstruction(configuration, { ...started.state, sessionId: "other" }, started.world), /session/);
  assert.throws(() => restoreBrowserConstruction(configuration, { ...started.state, sourceId: "other" }, started.world), /source/);
  const otherPolicy = await createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission, completionVisits: 4 });
  assert.throws(() => restoreBrowserConstruction(otherPolicy, started.state, started.world), /source/);

  const occupied = structuredClone(funded);
  const occupiedHost = transportHostState(occupied);
  occupiedHost.ground[6 * host.width + 116] = 152;
  assert.throws(() => reduceBrowserConstruction(configuration, state, { ...occupied, transportState: occupiedHost }, purchase), /footprint/);
  const sourceOccupied = { ...funded, entities: [...funded.entities, { ...funded.entities[0],
    key: "controlled-static-blocker", rawSlot: 799, unitType: 28, tileX: 116, tileY: 6, health: 4800 }] };
  assert.throws(() => reduceBrowserConstruction(configuration, state, sourceOccupied, purchase), /source entity/);
  const resourceHost = transportHostState(funded);
  resourceHost.resourceTileFlags[6 * host.width + 116] = 0x04000000;
  assert.throws(() => reduceBrowserConstruction(configuration, state, { ...funded, transportState: resourceHost }, purchase), /footprint/);
  const restricted = structuredClone(funded);
  const restrictions = Array.from({ length: 8 }, (_, team) => [...world.source.teams[team].dependencies!]);
  restrictions[0].push(14);
  assert.throws(() => reduceBrowserConstruction(configuration, state, { ...restricted, adaptedTro: {
    sharedVision: [], dependencyRestrictions: restrictions, noPickup: [], aiGroupWeights: {}, events: [] } }, purchase), /restricted/);
  assert.throws(() => createBrowserConstruction(configuration, { ...world, browserCasualtyPickup: undefined }), /unowned/);
  const nativeHost = transportHostState(funded);
  nativeHost.slots.find(actor => actor !== null)!.nativeConstruction = { team: 0, receiptId: "native", raw: [] };
  assert.throws(() => reduceBrowserConstruction(configuration, state, { ...funded, transportState: nativeHost }, purchase), /native/);
  const corrupt = structuredClone(started.world);
  corrupt.entityBytes![12] ^= 1;
  assert.throws(() => validateBrowserConstruction(configuration, started.state, corrupt), /mutation/);
  const corruptHost = transportHostState(started.world);
  corruptHost.generations[0] = 1;
  assert.throws(() => validateBrowserConstruction(configuration, started.state, { ...started.world, transportState: corruptHost }), /mutation/);
  await assert.rejects(createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission, completionVisits: 0 }), /duration/);
  await assert.rejects(createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted",
    mission: { ...mission, pathGrid: new Uint8Array(mission.pathGrid.length) }, completionVisits: 3 }), /hash/);
  await assert.rejects(createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission, completionVisits: 3,
    loadBytes: async () => new Uint8Array([0]) }), /hash/);
  assert.deepEqual(mission, missionBefore);
  const enabled = await loadCampaignMission("alien", 10, "browser-adapted", { completionVisits: 3 });
  const alteredProduction = { ...enabled.sourceProduction!.production!, records: enabled.sourceProduction!.production!.records.map(record =>
    record.id === 14 ? { ...record, cost: 1500 } : record) };
  assert.throws(() => new CampaignSession({ ...sourceBrowserCampaignSessionOptions(enabled), production: alteredProduction }), /authenticated source/);
  const deferred = new CampaignSession(sourceBrowserCampaignSessionOptions(enabled));
  assert.equal(Boolean(deferred.snapshot.production), false, "no production owner before the first base");
  const bought = deferred.step({ clockMilliseconds: 50, economyIncome: [income], browserConstructionRequest: purchase });
  assert.equal(bought.ok, true, JSON.stringify(bought.ok ? "" : bought.diagnostics));
  assert.equal(deferred.snapshot.production?.teams[0].slots[0].busy, 1);
  assert.equal(deferred.snapshot.production?.teams[0].credits, 0);
  assert.equal(deferred.snapshot.production?.teams[0].costAccumulator, 2000);
  for (let tick = 2; tick <= 4; tick++) {
    const result = deferred.step({ clockMilliseconds: tick * 50, productionVisits: [],
      ...(tick === 2 ? { browserConstructionHealth: 4300 } : {}) });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? "" : result.diagnostics));
  }
  assert.equal(deferred.snapshot.production?.teams[0].slots[0].busy, 0);
  assert.equal(deferred.snapshot.world.buildingSlots["0,0"], 4300, "completion cannot heal combat damage");
  const damaged = deferred.checkpoint();
  assert.equal(deferred.step({ clockMilliseconds: 250, browserConstructionHealth: 4800 }).ok, false);
  assert.deepEqual(deferred.checkpoint(), damaged);
  assert.deepEqual(deferred.browserFrameContext(150).productionVisits?.map(visit => visit.queue), [2]);
  assert.deepEqual(CampaignSession.restore(deferred.checkpoint(), undefined, undefined, undefined, undefined, undefined,
    enabled.browserConstruction).checkpoint(), deferred.checkpoint());
  const death = deferred.step({ clockMilliseconds: 250, productionVisits: deferred.browserFrameContext(150).productionVisits,
    updates: [{ type: "combat-death", slot: 0, generation: 0 }] });
  assert.equal(death.ok, true, JSON.stringify(death.ok ? "" : death.diagnostics));
  assert.equal(deferred.snapshot.world.buildingSlots["0,0"], 0);
  assert.deepEqual(CampaignSession.restore(deferred.checkpoint(), undefined, undefined, undefined, undefined, undefined,
    enabled.browserConstruction).checkpoint(), deferred.checkpoint());
  const destroyedBusy = new CampaignSession(sourceBrowserCampaignSessionOptions(enabled));
  assert.equal(destroyedBusy.step({ clockMilliseconds: 50, economyIncome: [income], browserConstructionRequest: purchase }).ok, true);
  assert.equal(destroyedBusy.step({ clockMilliseconds: 100, productionVisits: [],
    updates: [{ type: "combat-death", slot: 0, generation: 0 }] }).ok, true);
  for (let tick = 3; tick <= 5; tick++) assert.equal(destroyedBusy.step({ clockMilliseconds: tick * 50, productionVisits: [] }).ok, true);
  assert.equal(destroyedBusy.snapshot.world.buildingSlots["0,0"], 0, "busy death never resurrects at completion");
  assert.equal(destroyedBusy.snapshot.world.exomoney[0], 0, "destroyed construction is not refunded");
  assert.deepEqual(CampaignSession.restore(destroyedBusy.checkpoint(), undefined, undefined, undefined, undefined, undefined,
    enabled.browserConstruction).checkpoint(), destroyedBusy.checkpoint());
  assert.deepEqual(world, before);
  assert.deepEqual(assetPaths.map(path => createHash("sha256").update(read(path)).digest("hex")), assetHashes);
  context.diagnostic("Original ALIEN10 is 500 credits short and has no initial player collector; successful transaction uses an explicit funded integration control, not an untouched opening playthrough.");
});