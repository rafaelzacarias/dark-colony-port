import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { createTransportHostAdapter, stepTransportHost, transportHostState } from "../../src/engine/transport-host";
import { projectLegacyColony } from "../../src/engine/legacy-colony";
import { legacyStaticOccupancyFieldsFromSource, projectLegacyStaticOccupancy } from "../../src/engine/legacy-static-occupancy";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { installSourceRender } from "./fixtures/source-render";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";
import { parseMapBundle } from "../extractors/maps/map";

function human07(): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const mission = (extension: string) => read(`SCENARIO/HUMAN/HUMAN07.${extension}`);
  const source = parseScenario(mission("SCN").toString());
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  return { sessionId: "transport-human07", source, runtimeProfile: "browser-adapted",
    browserAi: createBrowserAiSelectorConfiguration(source), journalLimit: 1,
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    triggers: parseTriggerScript(mission("TRO").toString()), messages: parseMissionMessages(mission("MSG").toString()),
    map, pathGrid: map.pathGrid, tags: map.tagGrid, resourceScales: "configured-startup",
    commanders: source.teams.map(team => ({ team: team.index, unitType: team.race === 0 ? 69 : 73,
      sprite: team.race === 0 ? "TRSC" : "GRAY" })),
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 50, orientationSteps: 1 };
}

test("transport HUMAN07: original full SCN/TRO ground deliveries avoid live source statics through 200", () => {
  const options = human07();
  const session = new CampaignSession(options);
  const initial = session.snapshot.world;
  const turret = initial.entities.find(actor => actor.rawSlot === 160)!;
  assert.deepEqual([turret.unitType, turret.tileX, turret.tileY], [41, 15, 11]);
  const blocked = new Set(initial.entities.flatMap(actor => {
    const stat = options.units.find(unit => unit.index === actor.unitType)!;
    if (stat.movementSpeed !== 0 || actor.rawSlot! < 120 || actor.health <= 0) return [];
    const cell = projectLegacyStaticOccupancy({ slot: actor.rawSlot!, owner: actor.team,
      tileX: actor.tileX, tileY: actor.tileY, width: options.map.width, height: options.map.height,
      ...legacyStaticOccupancyFieldsFromSource(stat) });
    return cell?.plane === "ground" ? [`${cell.x},${cell.y}`] : [];
  }));
  for (const building of projectLegacyColony(options.source.teams, options.units).buildings) {
    for (const cell of building.footprint) blocked.add(`${cell.x},${cell.y}`);
  }
  let restored: CampaignSession | undefined;
  let maximumCarriers = 0;
  let delivered = 0;
  for (let tick = 1; tick <= 200; tick++) {
    const result = session.step({ clockMilliseconds: tick * 50 });
    assert.equal(result.ok, true, `tick ${tick}: ${JSON.stringify(result.ok ? null : result.diagnostics)}`);
    if (restored) assert.equal(restored.step({ clockMilliseconds: tick * 50 }).ok, true);
    if (tick === 80) {
      const saved = JSON.parse(JSON.stringify(session.checkpoint()));
      restored = CampaignSession.restore(saved);
      assert.deepEqual(restored.checkpoint(), session.checkpoint());
    }
    const world = session.snapshot.world;
    const host = transportHostState(world);
    maximumCarriers = Math.max(maximumCarriers, host.reducer.carriers.filter(carrier => carrier.phase !== "released").length);
    const occupied = new Set<string>();
    for (const actor of world.entities.filter(actor => actor.key.startsWith("transport:"))) {
      if (host.definitions.find(definition => definition.unitType === actor.unitType)?.plane !== "ground") continue;
      assert.equal(blocked.has(`${actor.tileX},${actor.tileY}`), false,
        `tick ${tick}: ${actor.key} type ${actor.unitType} overlaps static ${actor.tileX},${actor.tileY}`);
      assert.equal(host.groundEligible[actor.tileY * host.width + actor.tileX], true);
      assert.equal(occupied.has(`${actor.tileX},${actor.tileY}`), false);
      occupied.add(`${actor.tileX},${actor.tileY}`);
      delivered++;
    }
  }
  assert.ok(delivered > 0);
  assert.ok(maximumCarriers > 0);
  assert.deepEqual(restored!.checkpoint(), session.checkpoint());
  const host = transportHostState(session.snapshot.world);
  const creates = host.requests.filter(request => request.type === "create");
  assert.equal(new Set(creates.map(request => `${request.slot}:${request.generation}`)).size, creates.length);
});

test("transport HUMAN07 view: original scene initializes and renders all 200 frames without relocated admission", async context => {
  const root = new URL("../../public/", import.meta.url);
  const fetched = new Set<string>();
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    fetched.add(path);
    return new Response(readFileSync(new URL(path.slice(1), root)));
  });
  const rendering = installSourceRender();
  const gl = new Proxy({ NO_ERROR: 0, drawingBufferWidth: 512, drawingBufferHeight: 452,
    isContextLost: () => false, getError: () => 0, getParameter: () => 16384,
    getShaderParameter: () => true, getProgramParameter: () => true,
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => ({})) });
  context.mock.method(document, "createElement", () => {
    const canvas = rendering.canvas();
    const getContext = canvas.getContext.bind(canvas);
    Object.assign(canvas, { getContext: (type: string) => type === "webgl2" ? gl : getContext(type as "2d"),
      addEventListener() {}, removeEventListener() {} });
    return canvas;
  });
  const admissions: { tick: number; cell: { x: number; y: number }; position: unknown }[] = [];
  const originalAddUnit = DeterministicSimulation.prototype.addUnit;
  context.mock.method(DeterministicSimulation.prototype, "addUnit", function (
    this: DeterministicSimulation, options: Parameters<typeof originalAddUnit>[0],
  ) {
    const id = originalAddUnit.call(this, options);
    const actor = this.snapshot.units.find(unit => unit.id === id)!;
    assert.deepEqual({ x: actor.xSubcells, y: actor.ySubcells }, options.positionSubcells);
    admissions.push({ tick: this.snapshot.tick, cell: options.cell, position: options.positionSubcells });
    return id;
  });
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("human", 7, "browser-adapted");
    assert.deepEqual(mission.triggers, human07().triggers);
    assert.deepEqual(mission.scenario.placementRows, human07().source.placementRows);
    view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    assert.equal(view.missionDiagnostic, undefined);
    await view.initialize();
    const initialAdmissions = admissions.length;
    view.update(0);
    for (let tick = 1; tick <= 200; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `frame ${tick}`);
      assert.equal(view.simulation.snapshot.tick, tick);
    }
    const delivered = admissions.slice(initialAdmissions);
    assert.ok(delivered.length > 1);
    assert.ok(delivered.every(entry => entry.cell.x !== 15 || entry.cell.y !== 11));
    const bindings = view.nativeBindings;
    assert.equal(new Set(bindings.map(binding => `${binding.slot}:${binding.generation}`)).size, bindings.length);
    assert.ok(bindings.some(binding => binding.key === "transport:203:0"));
    assert.ok(rendering.evidence().spriteDraws > 0);
    assert.equal([...fetched].some(path => /POOP/.test(path)), false);
    const evidence = rendering.evidence();
    context.diagnostic(JSON.stringify({ frames: 200, delivered, spriteDraws: evidence.spriteDraws,
      imageDraws: evidence.imageDraws, sourceImages: evidence.images.length, warnings: evidence.warnings }));
  } finally { view?.dispose(); rendering.dispose(); }
});

test("transport HUMAN07 full-scene control: simultaneous carriers avoid all occupied cells and replay before arrival", () => {
  const options = human07();
  const original = new CampaignSession(options).snapshot.world;
  let world = original;
  const adapter = createTransportHostAdapter();
  for (const id of ["first", "second"]) {
    const result = adapter.prepare(world, { id, triggerId: 0, actionIndex: 0,
      action: { name: "reinforce", arguments: [0, 15, 11, 0, 4] },
      command: { kind: "reinforce", team: 0, tileX: 15, tileY: 11, groups: [{ unitType: 0, count: 4 }] } });
    assert.ok(result.ok, JSON.stringify(result));
    world = result.value.world;
  }
  const blockedStatics = original.entities.filter(actor => {
    const stat = options.units.find(unit => unit.index === actor.unitType)!;
    if (stat.movementSpeed !== 0 || actor.rawSlot! < 120 || actor.health <= 0) return false;
    return actor.resource || projectLegacyStaticOccupancy({ slot: actor.rawSlot!, owner: actor.team,
      tileX: actor.tileX, tileY: actor.tileY, width: options.map.width, height: options.map.height,
      ...legacyStaticOccupancyFieldsFromSource(stat) })?.plane === "ground";
  });
  let restored: typeof world | undefined;
  for (let tick = 1; tick <= 200; tick++) {
    const next = stepTransportHost(world);
    assert.ok(next.ok, JSON.stringify(next));
    world = next.value;
    if (restored) {
      const replayed = stepTransportHost(restored);
      assert.ok(replayed.ok, JSON.stringify(replayed));
      restored = replayed.value;
    }
    if (tick === 50) {
      restored = { ...structuredClone(world), transportState: JSON.parse(JSON.stringify(world.transportState)) };
      assert.equal(transportHostState(world).reducer.carriers.filter(carrier => carrier.phase === "descent").length, 2);
      assert.equal(world.entities.filter(actor => actor.key.startsWith("transport:")).length, 0);
    }
    const host = transportHostState(world);
    for (const actor of world.entities.filter(actor => actor.key.startsWith("transport:"))) {
      assert.equal(host.groundEligible[actor.tileY * host.width + actor.tileX], true);
      assert.equal(blockedStatics.some(staticActor => staticActor.tileX === actor.tileX && staticActor.tileY === actor.tileY), false);
      assert.equal(world.entities.some(other => other.key !== actor.key && other.health > 0
        && other.tileX === actor.tileX && other.tileY === actor.tileY
        && host.ground[other.tileY * host.width + other.tileX] === other.rawSlot), false);
    }
  }
  assert.deepEqual(restored, world);
  const delivered = world.entities.filter(actor => actor.key.startsWith("transport:"));
  assert.equal(delivered.length, 8);
  assert.equal(new Set(delivered.map(actor => `${actor.tileX},${actor.tileY}`)).size, 8);
  const creates = transportHostState(world).requests.filter(request => request.type === "create");
  assert.equal(creates.length, 8);
  assert.equal(new Set(creates.map(request => `${request.slot}:${request.generation}`)).size, 8);
  assert.deepEqual(world.entities.filter(actor => !actor.key.startsWith("transport:")), original.entities);
});