import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";
import { CampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { transportHostState } from "../../src/engine/transport-host";
import { DeterministicRandom } from "../../src/engine/random";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { sourceProductionVisits } from "../../src/engine/source-production-options";

type Mission = Awaited<ReturnType<typeof loadCampaignMission>>;

function previousOptions(mission: Mission): CampaignSessionOptions {
  const { rawScenario: _rawScenario, ...source } = mission.scenario;
  const random = new DeterministicRandom(0xdc1997);
  return {
    sessionId: `${source.id}:browser`, source, units: mission.units, weapons: mission.weapons,
    triggers: mission.triggers, messages: mission.messages, map: mission.map, pathGrid: mission.pathGrid, tags: mission.tags,
    commanders: mission.faction === "human" ? [{ team: 0, unitType: 69, sprite: "TRSC" }]
      : [{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }],
    directionBits: Array.from({ length: 256 }, () => [random.nextInt(2) as 0 | 1, random.nextInt(2) as 0 | 1] as const),
    fixedStepMilliseconds: 50, orientationSteps: 1, resourceScales: mission.sourceResource?.resourceScales ?? "configured-startup",
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    ...(mission.browserEconomy ? { browserEconomy: mission.browserEconomy } : {}),
    ...(mission.sourceProduction?.production ? { production: mission.sourceProduction.production } : {}),
  };
}

function originalFetch(context: TestContext) {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url))).buffer);
  });
}

test("source commanders: original rescue mappings and unchanged M01/M02 prefixes", async context => {
  originalFetch(context);
  for (const [faction, number, extra] of [
    ["human", 1, []], ["human", 2, []], ["alien", 1, []], ["alien", 2, []],
    ["human", 4, [{ team: 1, unitType: 72, sprite: "TRSC" }]],
    ["alien", 4, [{ team: 4, unitType: 69, sprite: "TRSC" }]],
    ["alien", 5, [{ team: 7, unitType: 72, sprite: "TRSC" }]],
  ] as const) {
    const mission = await loadCampaignMission(faction, number, "browser-adapted");
    const baseline = faction === "human" ? [{ team: 0, unitType: 69, sprite: "TRSC" }]
      : [{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }];
    const options = sourceBrowserCampaignSessionOptions(mission);
    assert.deepEqual(options.commanders, [...baseline, ...extra], `${faction}${number}`);
    assert.deepEqual(options, { ...previousOptions(mission), commanders: [...baseline, ...extra] });
    if (number <= 2) assert.equal(JSON.stringify(options), JSON.stringify(previousOptions(mission)));
  }
});

test("source commanders: all 30 original SCN/TRO role census", async context => {
  originalFetch(context);
  const baseline = await loadCampaignMission("human", 1, "browser-adapted");
  const unresolved: { mission: string; diagnostic: string }[] = [];
  let visited = 0;
  for (const faction of ["human", "alien"] as const) for (let number = 1; number <= 15; number++) {
    const id = `${faction.toUpperCase()}${String(number).padStart(2, "0")}`;
    const read = (extension: string) => readFileSync(new URL(
      `../../raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${id}.${extension}`, import.meta.url), "utf8");
    const mission = { ...baseline, faction, scenario: { ...baseline.scenario, ...parseScenario(read("SCN")) },
      triggers: parseTriggerScript(read("TRO")) };
    visited++;
    try {
      const mappings = sourceBrowserCampaignSessionOptions(mission).commanders;
      context.diagnostic(JSON.stringify({ mission: id, mappings }));
      const extra = id === "HUMAN04" ? [{ team: 1, unitType: 72, sprite: "TRSC" }]
        : id === "ALIEN04" ? [{ team: 4, unitType: 69, sprite: "TRSC" }]
        : id === "ALIEN05" ? [{ team: 7, unitType: 72, sprite: "TRSC" }] : [];
      assert.deepEqual(mappings, [...previousOptions(mission).commanders, ...extra]);
      const required = mission.triggers.flatMap(block => block.actions.filter(action => action.name === "abduct")
        .map(action => action.arguments[0]));
      assert.ok(required.every(team => mappings.some(mapping => mapping.team === team)));
    } catch (error) {
      unresolved.push({ mission: id, diagnostic: String(error) });
    }
  }
  context.diagnostic(JSON.stringify({ unresolved }));
  assert.equal(visited, 30);
  assert.deepEqual(unresolved, []);
});

test("source commanders: controlled role guards reject guesses and preserve source allocation semantics", async context => {
  originalFetch(context);
  const original = await loadCampaignMission("human", 4, "browser-adapted");
  const spawn = original.triggers.find(block => block.id === 6)!;
  const extraction = original.triggers.find(block => block.id === 7)!;
  const mission = { ...original, triggers: [spawn, extraction] };
  const replaceSpawn = (unitType: number, count = 1) => ({ ...mission, triggers: [
    { ...spawn, actions: spawn.actions.map(action => action.name === "reinforce2"
      ? { ...action, arguments: action.arguments.map((value, index) => index === 3 ? unitType : index === 4 ? count : value) }
      : action) }, extraction,
  ] });
  for (const ordinaryType of [0, 8]) {
    assert.throws(() => sourceBrowserCampaignSessionOptions(replaceSpawn(ordinaryType)), /Unresolved or ambiguous/);
  }
  assert.throws(() => sourceBrowserCampaignSessionOptions(replaceSpawn(72, 0)), /Unresolved or ambiguous/);
  assert.throws(() => sourceBrowserCampaignSessionOptions(replaceSpawn(76)), /definition mismatch/);
  assert.throws(() => sourceBrowserCampaignSessionOptions({ ...mission,
    units: mission.units.filter(unit => unit.index !== 72) }), /definition mismatch/);
  assert.throws(() => sourceBrowserCampaignSessionOptions({ ...mission,
    scenario: { ...mission.scenario, teams: mission.scenario.teams.map(team => team.index === 1 ? { ...team, race: 1 } : team) },
  }), /definition mismatch/);
  const withoutSpawn = { ...mission, triggers: [extraction] };
  const placed = (unitType: number) => ({ ...withoutSpawn, scenario: { ...mission.scenario,
    placementRows: [...mission.scenario.placementRows, [6, 29, unitType, 1, -1]] } });
  assert.deepEqual(sourceBrowserCampaignSessionOptions(placed(72)).commanders.at(-1), { team: 1, unitType: 72, sprite: "TRSC" });
  assert.deepEqual(sourceBrowserCampaignSessionOptions(placed(76)).commanders.at(-1), { team: 1, unitType: 72, sprite: "TRSC" });
  assert.throws(() => sourceBrowserCampaignSessionOptions({ ...placed(76),
    units: mission.units.map(unit => unit.index === 76 ? { ...unit, rawTail: [] } : unit) }), /counterpart metadata/);
  assert.throws(() => sourceBrowserCampaignSessionOptions({ ...mission, scenario: { ...mission.scenario,
    placementRows: [...mission.scenario.placementRows, [6, 29, 71, 1, -1]] } }), /ambiguous.*71.*72/);
  const conflict = { ...mission, triggers: [...mission.triggers, { ...spawn, id: 100,
    actions: [{ name: "reinforce", arguments: [1, 6, 29, 70, 1] }] }] };
  assert.throws(() => sourceBrowserCampaignSessionOptions(conflict), /ambiguous.*72.*70/);
  const scheduled = { ...mission, triggers: [{ ...spawn, actions: spawn.actions.map(action =>
    action.name === "reinforce2" ? { ...action, name: "reinforce" } : action) }, extraction] };
  assert.deepEqual(sourceBrowserCampaignSessionOptions(scheduled).commanders.at(-1), { team: 1, unitType: 72, sprite: "TRSC" });
  for (const queued of [mission, placed(72)]) {
    assert.throws(() => sourceBrowserCampaignSessionOptions({ ...queued, scenario: { ...queued.scenario,
      placementRows: [[6, 29, 37, 8, -1], ...queued.scenario.placementRows] } }), /Unresolved or ambiguous/);
  }
  const malformed = { ...mission, triggers: [{ ...spawn, actions: [{ name: "reinforce2", arguments: [1, 6, 29, "unknown", 1] }] }, extraction] };
  assert.throws(() => sourceBrowserCampaignSessionOptions(malformed), /Commander source command/);
  const playerConflict = { ...mission, triggers: [{ ...spawn, actions: [
    { name: "reinforce2", arguments: [0, 6, 29, 70, 1] }, { name: "abduct", arguments: [0, 0] },
  ] }] };
  assert.throws(() => sourceBrowserCampaignSessionOptions(playerConflict), /conflicts with existing mapping/);
  const duplicate = { ...placed(72), scenario: { ...placed(72).scenario,
    placementRows: [...placed(72).scenario.placementRows, [7, 29, 72, 1, -1]] } };
  assert.throws(() => new CampaignSession(sourceBrowserCampaignSessionOptions({ ...duplicate,
    triggers: original.triggers, browserEconomy: undefined })), /Ambiguous commander mapping/);
});

for (const [faction, number, spawnId, extractionId, winId, team, unitType, carrierTeam] of [
  ["human", 4, 6, 7, 8, 1, 72, 1],
  ["alien", 4, 10, 11, 11, 4, 69, 1],
  ["alien", 5, 17, 18, 19, 7, 72, 0],
] as const) {
  test(`source commanders: controlled predicates ${faction}${number} original commander spawn/extraction/WIN chain (not playthrough)`, async context => {
    originalFetch(context);
    const mission = await loadCampaignMission(faction, number, "browser-adapted");
    const id = `${faction.toUpperCase()}${String(number).padStart(2, "0")}`;
    const sourceTriggers = parseTriggerScript(readFileSync(new URL(
      `../../raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${id}.TRO`, import.meta.url), "utf8"));
    assert.deepEqual(mission.triggers, sourceTriggers);
    const controlled = mission.triggers.map(block => {
      if (faction === "alien" && number === 4) {
        if (block.id === 9) return { ...block, condition: "(c==6)" };
        if (block.id === spawnId) return { ...block, condition: "(c==7)" };
      } else {
        if (block.id === spawnId) return { ...block, mode: "norm", condition: "(c==6)" };
        if (block.id === extractionId) return { ...block, mode: "norm", condition: "(c==7)" };
        if (faction === "human" && block.id === winId) return { ...block, condition: "(c>20)" };
      }
      return block;
    });
    assert.deepEqual(controlled.map(block => block.actions), sourceTriggers.map(block => block.actions));
    assert.deepEqual(controlled.map(block => block.flag), sourceTriggers.map(block => block.flag));
    const fullOptions = { ...sourceBrowserCampaignSessionOptions(mission), triggers: controlled };
    const options = fullOptions;
    const session = new CampaignSession(options);
    const legacy = new CampaignSession({ ...options, commanders: previousOptions(mission).commanders });
    let restored: CampaignSession | undefined;
    let identity: { slot: number; generation: number; key: string } | undefined;
    let carrierId: number | undefined;
    let removed = false;
    let win = false;
    let extractionTick = 0;
    let legacyRejected = false;
    for (let tick = 1; tick <= 360; tick++) {
      const before = session.browserViewSnapshot;
      const input = { clockMilliseconds: tick * 50,
        ...(before.production ? { productionVisits: sourceProductionVisits(before.world, before.production, 150) } : {}) };
      const result = session.stepForBrowserView(input);
      assert.ok(result.ok, `${id} tick ${tick}: ${JSON.stringify(result.ok ? null : result.diagnostics)}`);
      if (restored) assert.ok(restored.stepForBrowserView(input).ok);
      if (!legacyRejected) {
        const oldResult = legacy.stepForBrowserView(input);
        if (!oldResult.ok) {
          assert.match(JSON.stringify(oldResult.diagnostics), /Missing valid full commander slot/);
          assert.ok(result.value.entry.commands.some(command => command.triggerId === extractionId && command.command.kind === "abduct"));
          legacyRejected = true;
        }
      }
      const frame = result.value;
      if (frame.entry.commands.some(command => command.triggerId === spawnId && command.command.kind === "reinforce2")) {
        const actor = frame.world.entities.find(entity => entity.team === team && entity.unitType === unitType)!;
        assert.ok(actor);
        identity = { slot: actor.rawSlot!, generation: actor.generation, key: actor.key };
        assert.equal(frame.world.commanderSlots[team], identity.slot);
        assert.ok(frame.entry.requests.some(request => request.type === "create" && request.slot === identity!.slot
          && request.generation === identity!.generation && request.team === team && request.unitType === unitType));
        const host = transportHostState(session.snapshot.world);
        assert.equal(host.registry[identity.slot], identity.key);
        assert.equal(host.slots[identity.slot]!.generation, identity.generation);
        if (faction === "alien" && number === 4) {
          const artifact = frame.world.entities.find(entity => entity.team === 0 && entity.unitType === 94)!;
          assert.ok(artifact);
          assert.deepEqual([artifact.tileX, artifact.tileY, artifact.health], [6, 6, 300]);
          assert.ok(frame.entry.requests.some(request => request.type === "create" && request.unitType === 94
            && request.slot === artifact.rawSlot && request.generation === artifact.generation));
        }
      }
      if (frame.entry.commands.some(command => command.triggerId === extractionId && command.command.kind === "abduct")) {
        assert.ok(identity);
        extractionTick = tick;
        const host = transportHostState(session.snapshot.world);
        const carrier = host.reducer.carriers.find(candidate => candidate.commanderSlot === identity!.slot)!;
        assert.ok(carrier);
        carrierId = carrier.id;
        assert.equal(carrier.team, carrierTeam);
        assert.equal(carrier.type, mission.scenario.teams[carrierTeam].race === 1 ? 93 : 92);
        assert.equal(host.slots[identity.slot]!.generation, identity.generation);
        assert.equal(host.registry[identity.slot], identity.key);
        if (winId !== extractionId) assert.equal(session.snapshot.controller.runtime.lives[winId], 1);
        else assert.equal(frame.controller.runtime.bail?.resultCode, 0);
        const checkpoint = session.checkpoint();
        restored = CampaignSession.restore(JSON.parse(JSON.stringify(checkpoint)));
        assert.deepEqual(restored.checkpoint(), checkpoint);
      }
      if (frame.entry.requests.some(request => request.type === "remove-noncombat" && request.slot === identity?.slot)) {
        const removal = frame.entry.requests.find(request => request.type === "remove-noncombat" && request.slot === identity?.slot)!;
        assert.equal(removal.generation, identity!.generation);
        const host = transportHostState(session.snapshot.world);
        assert.equal(host.reducer.carriers.find(carrier => carrier.id === carrierId)!.commanderSlot, identity!.slot);
        assert.equal(host.registry[identity!.slot], identity!.key);
        assert.equal(host.slots[identity!.slot]!.status, 10);
        assert.equal(host.slots[identity!.slot]!.health, mission.units.find(unit => unit.index === unitType)!.health);
        assert.ok(!host.ground.includes(identity!.slot) && !host.flying.includes(identity!.slot));
        removed = true;
      }
      if (frame.controller.runtime.bail) {
        assert.equal(frame.controller.runtime.bail.resultCode, 0);
        assert.equal(frame.controller.runtime.bail.reasonCode, 1);
        win = true;
      }
    }
    assert.ok(identity && carrierId && extractionTick && removed && win && legacyRejected && restored);
    assert.equal(session.snapshot.controller.runtime.statistics[`${team},0,${unitType}`], 0);
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
    context.diagnostic(JSON.stringify({ mission: id, controlledPredicatesNotPlaythrough: true,
      identity, carrierId, extractionTick, removed, win, exactRestore: true, fullOriginalActions: true }));
  });
}