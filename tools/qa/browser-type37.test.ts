import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";
import { createCampaignWorld } from "../../src/engine/campaign-world.ts";
import { browserType37Presentation } from "../../src/engine/browser-type37.ts";
import { loadCampaignMission } from "../../src/game-data.ts";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options.ts";
import { CampaignSession } from "../../src/engine/campaign-session.ts";
import { consumeTransportFifo, transportHostState } from "../../src/engine/transport-host.ts";
import { initializeCampaignPlacements, initializeCampaignSession } from "../../src/engine/campaign-session.ts";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime.ts";
import { parseWeaponStats } from "../extractors/data/tables.ts";
import { createCampaignWorldAdapter } from "../../src/engine/campaign-world.ts";
import { createTransportHostAdapter } from "../../src/engine/transport-host.ts";
import { stepBrowserType37 } from "../../src/engine/browser-type37.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";
import { missionOrdinarySceneAdmission } from "../../src/render/mission-scene-frame.ts";

const root = new URL("../../", import.meta.url);
const units = parseUnitStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root), "utf8"));
const source = parseScenario(readFileSync(new URL("raw_cd/DC/SCENARIO/HUMAN/HUMAN07.SCN", root), "utf8"));

test("type37 placement: strict guard unchanged; adapted preserves actual marker slots and ordered captures", () => {
  const options = { sessionId: "type37", source, units, messages: [],
    placementInitialization: { firstSlot: 152, mode: 0 as const },
    resourceInitialization: { firstSlot: 152, width: 128, height: 128, scales: { rateScale: 256, reserveScale: 256 } } };
  const strict = createCampaignWorld(options);
  assert.equal(strict.ok, false);
  if (!strict.ok) assert.match(strict.diagnostics[0].message, /Placement 38 requires native type-37 coordinate queue and selector-6 state/);
  const adapted = createCampaignWorld({ ...options, runtimeProfile: "browser-adapted" });
  assert.equal(adapted.ok, true, JSON.stringify(adapted));
  if (!adapted.ok) return;
  const world = adapted.value;
  assert.deepEqual(world.source, source);
  assert.equal(world.scenarioMarkers!.length, source.placementRows.filter(row => row[2] === 37).length);
  for (const marker of world.scenarioMarkers!) {
    const entity = world.entities.find(entry => entry.key === marker.key)!;
    assert.equal(entity.team, 8);
    assert.equal(entity.unitType, 37);
    assert.equal(browserType37Presentation(entity, world.scenarioMarkers!, false), "excluded-native-spy-gate");
    assert.equal(browserType37Presentation(entity, world.scenarioMarkers!, true), "source-art-required");
  }
  let slot = 152;
  for (const [sourceRow, row] of source.placementRows.entries()) {
    const captured = world.coordinateQueues!.some(queue => queue.captured.some(entry => entry.sourceRow === sourceRow));
    const entity = world.entities.find(entry => entry.sourceRow === sourceRow);
    if (row[3] === -1 || captured) assert.equal(entity, undefined);
    else assert.equal(entity?.rawSlot, slot++);
  }
  assert.equal(world.placementState.nextSlot, slot);
});

test("type37 presentation: original normal admission excludes only marker type with spy disabled, even under reveal", () => {
  const input = { rawSlot: 190, status: 1, type: 37, team: 8, localTeam: 0, spyEnabled: false,
    tileVisibilityWord: 1, localVisibilityMask: 1, concealedType: false, detectedTeams: 0, revealAll: true,
    xQ8: 128, yQ8: 128, bounds: { left: 0, bottom: 0, right: 128, top: 128 },
    bankMode: 0 as const, bankFrame: 0, bankTimelineCount: 1 };
  assert.equal(missionOrdinarySceneAdmission(input).admitted, false);
  assert.equal(missionOrdinarySceneAdmission({ ...input, spyEnabled: true }).admitted, true);
  assert.equal(missionOrdinarySceneAdmission({ ...input, type: 84 }).admitted, true);
});

test("type37 placement fields: HP override is not resource quantity and script byte is ignored", () => {
  const result = initializeCampaignPlacements({ sessionId: "marker-fields", runtimeProfile: "browser-adapted",
    source: { ...source, placementRows: [[2, 3, 37, 0, 77, 257], [2, 3, 0, 2, -1, 42], [5, 5, 0, 0, -1, 257]] },
    units, messages: [], map: { width: 8, height: 8 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const world = result.value;
  assert.equal(world.entities[0].health, 77);
  assert.equal(world.entities[0].resource, undefined);
  assert.deepEqual(world.entities[0].rawTail, [77, 257]);
  assert.equal(world.entityBytes![152 * 220 + 0xcb], 0);
  assert.equal(world.entityBytes![153 * 220 + 0xcb], 1);
  assert.deepEqual(world.coordinateQueues![0].captured, [{ sourceRow: 1, unitType: 8 }]);
});

test("type37 relay: reinforce2 queues source types; eligible collector receives FIFO arrivals without marker combat or source mutation", () => {
  const controlled = { ...source, placementRows: [[4, 4, 6, 0, -1], [4, 4, 37, 0, -1], [4, 4, 0, 0, -1]],
    teams: source.teams.map(team => ({ ...team, coordinateRows: [[0, 0], [0, 0]] as const })) };
  const initialized = initializeCampaignSession({ sessionId: "relay", source: controlled, units,
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(controlled),
    weapons: parseWeaponStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT", root), "utf8")),
    triggers: [], messages: [], map: { width: 10, height: 10 }, pathGrid: new Uint8Array(100).fill(1), tags: new Uint8Array(100),
    commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }], directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1 });
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;
  let world = initialized.value.world;
  const adapter = createCampaignWorldAdapter(createTransportHostAdapter());
  const prepared = adapter.prepare(world, [{ id: "fifo-reinforce2", triggerId: 0, actionIndex: 0,
    action: { name: "reinforce2", arguments: [1, 4, 4, 8, 1, 0, 0, 0, 0, 0, 0] },
    command: { kind: "reinforce2", team: 1, tileX: 4, tileY: 4, groups: [{ unitType: 8, count: 1 }] } }]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) return;
  world = prepared.value.world;
  assert.deepEqual(transportHostState(world).fifos[0].types, [0, 8]);
  assert.equal(world.entities.length, 2);
  const frame = { spyTeams: [true, false, false, false, false, false, false, false], idleHarvesterSlots: [152] };
  for (let visit = 0; visit < 449; visit++) world = stepBrowserType37(world, frame);
  assert.equal(world.entities.length, 2);
  const saved = JSON.parse(JSON.stringify({ markers: world.scenarioMarkers, queues: world.coordinateQueues }));
  assert.equal(saved.markers[0].remainingVisits, 1);
  assert.equal(stepBrowserType37(world, { ...frame, spyTeams: Array(8).fill(false) }).scenarioMarkers![0].remainingVisits, 450);
  const host = transportHostState(world);
  const blocked = { ...world, transportState: { ...host, groundEligible: host.groundEligible.map(() => false) } };
  const blockedBefore = structuredClone(blocked);
  assert.throws(() => stepBrowserType37(blocked, frame), /No eligible creation position/);
  assert.deepEqual(blocked, blockedBefore);
  world = stepBrowserType37(world, frame);
  assert.deepEqual(transportHostState(world).fifos[0].types, [8]);
  assert.equal(world.entities.at(-1)!.unitType, 0);
  assert.equal(world.entities.at(-1)!.team, 0);
  for (let visit = 0; visit < 450; visit++) world = stepBrowserType37(world, frame);
  assert.equal(world.entities.at(-1)!.unitType, 8);
  assert.equal(world.entities.at(-1)!.team, 0);
  assert.deepEqual(world.source, controlled);
  assert.deepEqual(world.coordinateQueues, saved.queues);
  assert.equal(world.scenarioMarkers![0].active, true);
  for (let visit = 0; visit < 450; visit++) world = stepBrowserType37(world, frame);
  assert.equal(world.scenarioMarkers![0].active, false);
  assert.equal(transportHostState(world).registry[153], null);
  assert.ok(world.entities.some(entity => entity.unitType === 37));
});

test("type37 session: original HUMAN07 loader preflight, registry, FIFO and JSON restore", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(readFileSync(new URL(`public${path}`, root))).buffer);
  });
  const mission = await loadCampaignMission("human", 7, "browser-adapted");
  await assert.rejects(loadCampaignMission("human", 7), /Placement 38 requires native type-37 coordinate queue and selector-6 state/);
  const rawBefore = mission.scenario.rawScenario;
  assert.deepEqual(parseScenario(atob(rawBefore!)), source);
  const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
  const world = session.snapshot.world;
  assert.equal(world.placementState.nextSlot, 202);
  assert.deepEqual(world.scenarioMarkers!.map(marker => marker.rawSlot), [190, 197]);
  assert.deepEqual(transportHostState(world).fifos, [
    { tile: { x: 88, y: 80 }, types: [63, 63, 63] }, { tile: { x: 5, y: 32 }, types: [63, 63, 63] },
  ]);
  for (const marker of world.scenarioMarkers!) {
    const host = transportHostState(world);
    assert.equal(host.registry[marker.rawSlot], marker.key);
    assert.equal(host.ground.includes(marker.rawSlot), false);
    assert.equal(host.flying.includes(marker.rawSlot), false);
    assert.equal(world.entityBytes![marker.rawSlot * 220 + 0xcb], 0);
  }
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  assert.deepEqual(CampaignSession.restore(saved).checkpoint(), saved);
  assert.equal(mission.scenario.rawScenario, rawBefore);
});

test("type37 census: twelve full original adapted loaders preserve SCN/TRO, source slots and queued metadata", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(readFileSync(new URL(`public${path}`, root))).buffer);
  });
  const evidence = process.env.DC_TYPE37_NATIVE ? JSON.parse(readFileSync(process.env.DC_TYPE37_NATIVE, "utf8")) : undefined;
  const reports: object[] = [];
  for (const [faction, numbers] of [["human", [7, 8, 9, 12, 13]], ["alien", [6, 7, 8, 10, 11, 12, 13]]] as const) {
    for (const number of numbers) {
      const name = `${faction.toUpperCase()}${String(number).padStart(2, "0")}`;
      const path = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${name}`;
      const scn = readFileSync(new URL(`${path}.SCN`, root));
      const tro = readFileSync(new URL(`${path}.TRO`, root));
      const mission = await loadCampaignMission(faction, number, "browser-adapted");
      assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), scn);
      assert.deepEqual(mission.triggers, parseTriggerScript(tro.toString()));
      const options = sourceBrowserCampaignSessionOptions(mission);
      assert.deepEqual(options.source.placementRows, parseScenario(scn.toString()).placementRows);
      const session = new CampaignSession(options);
      const world = session.snapshot.world;
      assert.deepEqual(world.exomoney, Object.fromEntries(options.source.teams.map(team => [team.index, team.money])));
      const native = evidence?.missions.find((entry: { scenario: string }) => entry.scenario === name);
      if (evidence) assert.ok(native, `Missing native stream ${name}`);
      if (native) {
        assert.equal(createHash("sha256").update(scn).digest("hex"), native.sourceSha256);
        assert.equal(world.placementState.nextSlot, native.nextSlot);
        for (const record of native.records) {
          const entity = world.entities.find(entry => entry.sourceRow === record.sourceRow);
          assert.equal(entity?.rawSlot, record.slot, `${name} source row ${record.sourceRow}`);
          if (entity) {
            const raw = world.entityBytes!.slice(entity.rawSlot! * 220, (entity.rawSlot! + 1) * 220);
            const expected = Buffer.from(record.entityHex, "hex");
            for (const offset of [0, 1, 4, 5, 6, 7, 12, 13, 14, 15, 44, 203]) {
              assert.equal(raw[offset], expected[offset], `${name} source row ${record.sourceRow} raw+${offset}`);
            }
          }
        }
      }
      const saved = JSON.parse(JSON.stringify(session.checkpoint()));
      assert.deepEqual(CampaignSession.restore(saved).checkpoint(), saved);
      const host = transportHostState(world);
      assert.deepEqual(host.fifos, world.coordinateQueues!.map(queue => ({ tile: { x: queue.tileX, y: queue.tileY },
        types: queue.captured.map(entry => entry.unitType) })));
      for (const [queueIndex, queue] of world.coordinateQueues!.entries()) {
        if (!queue.captured.length) continue;
        const arrived = consumeTransportFifo(world, queueIndex, 0);
        assert.equal(arrived.ok, true, JSON.stringify(arrived));
        if (!arrived.ok) continue;
        const arrival = arrived.value.entities.at(-1)!;
        assert.equal(arrival.unitType, queue.captured[0].unitType);
        assert.equal(arrival.team, 0);
        assert.equal(arrival.sourceRow, null);
        assert.equal(arrival.rawSlot, world.placementState.highWater);
        assert.equal(transportHostState(arrived.value).registry[arrival.rawSlot!], arrival.key);
        assert.deepEqual(arrived.value.source, world.source);
        assert.deepEqual(transportHostState(arrived.value).fifos[queueIndex].types, host.fifos[queueIndex].types.slice(1));
      }
      const consumers = mission.triggers.flatMap(block => block.actions.flatMap((action, actionIndex) =>
        action.name === "reinforce2" && world.coordinateQueues!.some(queue => queue.tileX === action.arguments[1]
          && queue.tileY === action.arguments[2]) ? [{ triggerId: block.id, actionIndex, action }] : []));
      reports.push({ mission: name, scnSha256: createHash("sha256").update(scn).digest("hex"),
        troSha256: createHash("sha256").update(tro).digest("hex"), nextSlot: world.placementState.nextSlot,
        markers: world.scenarioMarkers, queues: world.coordinateQueues, reinforce2QueueWriters: consumers,
        nativeProjectionSha256: native?.projectedEntitySha256 ?? null,
        loaded: true, restored: true, nativeCompared: Boolean(native) });
    }
  }
  if (process.env.DC_TYPE37_REPORT) writeFileSync(process.env.DC_TYPE37_REPORT, JSON.stringify(reports, null, 2) + "\n");
});

test("type37 session relay: actual scheduler, JSON restore before arrival, invalid observations and combat roll back", () => {
  const controlled = { ...source, placementRows: [[4, 4, 6, 0, -1], [4, 4, 37, 0, -1]],
    teams: source.teams.map(team => ({ ...team,
      coordinateRows: [[0, 0], team.index === 0 ? [12, 10] : [0, 0]] as const,
      cityRows: team.cityRows.map((row, index) => team.index === 0 && index === 0
        ? [0, -1, 0, -1, 0, -1, 0, -1, 1, 3600] : row) })) };
  const session = new CampaignSession({ sessionId: "relay-replay", source: controlled, units,
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(controlled),
    weapons: parseWeaponStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT", root), "utf8")),
    triggers: parseTriggerScript("0 norm 1 (c>0)\nreinforce2 1 4 4 8 1 0 0 0 0 0 0\nend"), messages: [],
    map: { width: 20, height: 20 }, pathGrid: new Uint8Array(400).fill(1), tags: new Uint8Array(400),
    commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }], directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1 });
  const type37Frame = { spyTeams: [true, false, false, false, false, false, false, false], idleHarvesterSlots: [152] };
  for (let tick = 1; tick <= 449; tick++) {
    const result = session.step({ clockMilliseconds: tick * 50, type37Frame });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = CampaignSession.restore(saved);
  assert.equal(saved.state.world.scenarioMarkers[0].remainingVisits, 1);
  assert.deepEqual(saved.state.world.transportState.fifos[0].types, [8]);
  for (const instance of [session, restored]) {
    assert.equal(instance.step({ clockMilliseconds: 22500, type37Frame }).ok, true);
    assert.equal(instance.snapshot.world.entities.at(-1)!.unitType, 8);
    assert.equal(instance.snapshot.world.entities.at(-1)!.team, 0);
  }
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  for (const mutate of [
    (copy: typeof saved) => { copy.state.world.coordinateQueues[0].tileX++; },
    (copy: typeof saved) => { copy.state.world.scenarioMarkers[0].remainingVisits++; },
    (copy: typeof saved) => { copy.state.world.markerSpyTeams[0] = false; },
    (copy: typeof saved) => { copy.state.world.transportState.fifos[0].types[0] = 0; },
    (copy: typeof saved) => { copy.state.world.scenarioMarkers[0].extra = 1; },
  ]) { const copy = structuredClone(saved); mutate(copy); assert.throws(() => CampaignSession.restore(copy)); }
  const before = session.checkpoint();
  assert.equal(session.step({ clockMilliseconds: 22550, type37Frame: { ...type37Frame, idleHarvesterSlots: [153] } }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  assert.equal(session.step({ clockMilliseconds: 22550, updates: [{ type: "combat-death", slot: 153, generation: 0 }] }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  assert.equal(session.step({ clockMilliseconds: 22550 }).ok, true);
  assert.equal(session.snapshot.world.scenarioMarkers![0].remainingVisits, 450);
});