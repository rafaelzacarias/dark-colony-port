import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration, createBrowserAiSelectorOwner, initializeBrowserCampaignView,
  planBrowserCampaignViewFrame, restoreBrowserCampaignView } from "../../src/engine/browser-campaign-runtime";
import { createBrowserCampaignAiConfiguration, type BrowserCampaignAiObservation } from "../../src/engine/browser-campaign-ai";
import { NavigationGrid } from "../../src/engine/grid";
import { loadSourceProductionOptions, sourceProductionVisits } from "../../src/engine/source-production-options";
import { createCampaignWorldAdapter } from "../../src/engine/campaign-world";
import { auditMissionTriggerSupport } from "../../src/engine/mission-controller";
import { parseScenario, type ScenarioDefinition } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";
import { parseMapBundle } from "../extractors/maps/map";
import type { RuntimeTriggerBlock } from "../../src/engine/trigger-runtime";

function fixture(faction: "HUMAN" | "ALIEN"): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const mission = (extension: string) => read(`SCENARIO/${faction}/${faction}02.${extension}`);
  const source = parseScenario(mission("SCN").toString());
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  return { sessionId: `browser-${faction}02`, source, runtimeProfile: "browser-adapted",
    browserAi: createBrowserAiSelectorConfiguration(source), journalLimit: 1,
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    triggers: parseTriggerScript(mission("TRO").toString()), messages: parseMissionMessages(mission("MSG").toString()),
    map, pathGrid: map.pathGrid, tags: map.tagGrid, resourceScales: "configured-startup",
    commanders: faction === "HUMAN" ? [{ team: 0, unitType: 69, sprite: "TRSC" }]
      : [{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1 };
}

function control(triggers: readonly RuntimeTriggerBlock[]): CampaignSessionOptions {
  const original = fixture("HUMAN");
  const source = { ...original.source, placementRows: [],
    teams: original.source.teams.map(team => ({ ...team, coordinateRows: [[0, 0], [0, 0]] as const })) };
  return { ...original, source, browserAi: createBrowserAiSelectorConfiguration(source),
    units: original.units.filter(unit => unit.index === 0), triggers, messages: [], map: { width: 8, height: 8 },
    pathGrid: new Uint8Array(64).fill(1), tags: new Uint8Array(64),
    commanders: [{ team: 0, unitType: 0, sprite: "TRSC" }] };
}

function advance(session: CampaignSession, start: number, end: number) {
  for (let tick = start; tick <= end; tick++) {
    const result = session.step({ clockMilliseconds: tick * 16 });
    assert.equal(result.ok, true, `tick ${tick}: ${JSON.stringify(result.ok ? null : result.diagnostics)}`);
  }
}

const action = { name: "ai", arguments: [2, 3], raw: "ai 2 3" };
const block: RuntimeTriggerBlock = { id: 0, mode: "norm", flag: 1, condition: "1", actions: [action] };

test("browser profile: explicit separate capability, full startup modes and unchanged strict default", () => {
  const options = fixture("HUMAN"), session = new CampaignSession(options);
  assert.equal(session.runtimeProfile, "browser-adapted");
  assert.deepEqual(session.browserAiProjection!.selectors.modes, [0, 0, 4, 3, 3, 0, 0, 0]);
  assert.deepEqual(session.snapshot.world.source, options.source);
  assert.deepEqual(session.snapshot.controller.blocks, options.triggers);
  const owner = createBrowserAiSelectorOwner(options.browserAi!, options.source);
  assert.throws(() => createCampaignWorldAdapter(undefined, owner as never), /native policy scheduling profile required/);
  const adapter = createCampaignWorldAdapter(undefined, undefined, owner);
  assert.equal(adapter.browserAi, true);
  assert.equal(adapter.aiSelector, undefined);
});

test("browser profile: config and source mutations rejected; plain JSON replay needs no native provider", () => {
  const options = control([block]);
  for (const invalid of [
    { ...options, runtimeProfile: undefined },
    { ...options, runtimeProfile: "unknown" },
    { ...options, browserAi: undefined },
    { ...options, browserAi: { ...options.browserAi, processor: { kind: "isReady" } } },
    { ...options, browserAi: { ...options.browserAi, sourceCanonical: "{}" } },
    { ...options, source: { ...options.source, placementRows: [[1, 2, 3]] } },
  ]) assert.throws(() => new CampaignSession(invalid as CampaignSessionOptions));
  const session = new CampaignSession(options);
  advance(session, 1, 8);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = CampaignSession.restore(saved);
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  advance(session, 9, 16);
  advance(restored, 9, 16);
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  assert.deepEqual(session.fork().checkpoint(), session.checkpoint());
  for (const mutate of [
    (copy: typeof saved) => { copy.options.runtimeProfile = "unknown"; },
    (copy: typeof saved) => { copy.options.browserAi.extra = true; },
    (copy: typeof saved) => { copy.options.browserAi.processor.phase = "native-scheduler"; },
    (copy: typeof saved) => { copy.state.world.aiSelectors.modes[2] = 4; },
    (copy: typeof saved) => { copy.state.world.aiSelectors.events[0].before = 0; },
    (copy: typeof saved) => { copy.state.aiSelectorInputs.pop(); },
    (copy: typeof saved) => { copy.options.source.teams[2].aiSlots[0] += 1; copy.state.world.source = copy.options.source; },
    (copy: typeof saved) => { copy.state.world.entityBytes[12] ^= 1; },
    (copy: typeof saved) => { copy.state.world.exomoney[0] += 1; },
  ]) { const copy = structuredClone(saved); mutate(copy); assert.throws(() => CampaignSession.restore(copy), String(mutate)); }
  const projection = session.browserAiProjection!;
  assert.throws(() => { (projection.selectors.modes as number[])[2] = 0; });
  assert.throws(() => { (projection.money as Record<number, number>)[0] = 999; });
  assert.throws(() => { (projection.statistics as Record<string, number>)["0,10"] = 999; });
  assert.equal(session.browserAiProjection!.selectors.modes[2], 3);
  assert.notEqual(session.browserAiProjection!.money[0], 999);
});

test("browser profile: all eight teams accept only literal modes 0..4", () => {
  const options = fixture("HUMAN"), world = new CampaignSession(options).snapshot.world;
  const adapter = createCampaignWorldAdapter(undefined, undefined, createBrowserAiSelectorOwner(options.browserAi!, options.source));
  for (let team = 0; team < 8; team++) for (let mode = 0; mode <= 4; mode++) {
    const result = adapter.prepare(world, [{ id: `${team}:${mode}`, triggerId: 0, actionIndex: 0,
      action: { name: "ai", arguments: [team, mode] }, command: { kind: "ai", team, mode } }]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.world.aiSelectors!.modes[team], mode);
  }
  for (const mode of [-1, 5, 32768, 1.5]) assert.equal(adapter.prepare(world, [{ id: "invalid", triggerId: 0, actionIndex: 0,
    action: { name: "ai", arguments: [0, mode] }, command: { kind: "ai", team: 0, mode } }]).ok, false);
  assert.throws(() => createBrowserAiSelectorConfiguration({ id: "incomplete", placementRows: [],
    teams: options.source.teams.map(team => ({ index: team.index, ai: team.ai })) }), /complete parsed SCN/);
});

test("browser profile: view-owned pure strategy plans once with projected selectors and JSON state", async () => {
  const options = control([block]), session = new CampaignSession(options);
  const createStrategy = () => createBrowserCampaignAiConfiguration({ scenario: options.source as ScenarioDefinition,
    units: options.units, weapons: options.weapons, dependencies: [], pathGrid: new NavigationGrid(8, 8) });
  const strategy = await createStrategy();
  const previous = initializeBrowserCampaignView(session.browserAiProjection!, strategy);
  const observation: BrowserCampaignAiObservation = { actors: [], snapshot: { tick: 0, entityCount: 0,
    timeOfDay: "day", daylightPermille: 1000, randomState: 1, resources: { human: 0, alien: 0 },
    units: [], staticTargets: [], buildings: [], resourceNodes: [] } };
  const before = session.checkpoint();
  const first = planBrowserCampaignViewFrame(session.browserAiProjection!, strategy, previous, observation);
  assert.equal(first.state.strategy.teams[3].decisions, 1);
  assert.equal(first.state.strategy.teams[4].decisions, 1);
  assert.equal(first.state.strategy.teams[2].decisions, 0);
  assert.deepEqual(session.checkpoint(), before);
  assert.equal(previous.strategy.lastTick, -1);
  assert.throws(() => planBrowserCampaignViewFrame(session.browserAiProjection!, strategy, first.state, observation), /already planned/);
  advance(session, 1, 8);
  const next = planBrowserCampaignViewFrame(session.browserAiProjection!, strategy, first.state,
    { ...observation, snapshot: { ...observation.snapshot, tick: 20 } });
  assert.equal(next.state.strategy.teams[2].decisions, 1);
  assert.equal(next.state.sourceCycle, 8);
  const fresh = await createStrategy();
  assert.deepEqual(restoreBrowserCampaignView(session.browserAiProjection!, fresh, JSON.parse(JSON.stringify(next.state))), next.state);
  assert.throws(() => restoreBrowserCampaignView(session.browserAiProjection!, fresh,
    { ...next.state, sourceCanonical: "{}" }), /fingerprint/);
  assert.throws(() => restoreBrowserCampaignView(session.browserAiProjection!, fresh,
    { ...next.state, runtimeProfile: "strict-native" } as never), /checkpoint/);
  assert.throws(() => restoreBrowserCampaignView(session.browserAiProjection!, fresh,
    { ...next.state, strategy: { ...next.state.strategy, fingerprint: "wrong" } }), /fingerprint/);
});

test("browser profile: selectors coexist with configured original player production", async () => {
  const original = fixture("HUMAN");
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const source = await loadSourceProductionOptions({ sessionId: original.sessionId,
    mission: { faction: "human", units: original.units,
      scenario: JSON.parse(read("public/assets/generated/data/scenarios/HUMAN/HUMAN02.json").toString()) },
    rawScenario: read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN"),
    configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: 0 },
    loadBytes: async url => read(`public${url}`) });
  assert.ok(source.production);
  const session = new CampaignSession({ ...original, triggers: [block], production: source.production });
  for (let tick = 1; tick <= 8; tick++) {
    const snapshot = session.snapshot;
    const result = session.step({ clockMilliseconds: tick * 16,
      productionVisits: sourceProductionVisits(snapshot.world, snapshot.production!, 150) });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.diagnostics));
  }
  assert.equal(session.browserAiProjection!.selectors.modes[2], 3);
  assert.equal(session.snapshot.production!.teams[0].team, 0);
  assert.equal(session.browserAiProjection!.money[0], session.snapshot.production!.teams[0].credits);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("browser profile: reversed setters, setlifes and later-block failures are atomic", () => {
  const triggers: RuntimeTriggerBlock[] = [
    { ...block, actions: [{ name: "setlifes", arguments: [1, 1] }, { ...action, arguments: [2, 1] }, action] },
    { id: 1, mode: "norm", flag: 0, condition: "1", actions: [{ ...action, arguments: [2, 2] }] },
  ];
  const options = control(triggers), session = new CampaignSession(options);
  advance(session, 1, 8);
  assert.deepEqual(session.snapshot.world.aiSelectors!.events.map(event => [event.triggerId, event.actionIndex, event.after]),
    [[0, 2, 3], [0, 1, 1], [1, 0, 2]]);
  assert.equal(session.snapshot.controller.runtime.lives[1], 0);
  const failed = new CampaignSession(control([...triggers, { id: 2, mode: "norm", flag: 1, condition: "1", actions: [
    { name: "msg", arguments: [0, 0, 29, 0, 0] },
    { name: "reinforce2", arguments: [0, 2, 2, 0, 1, 0, 0, 0, 0, 0, 0] },
  ] }]));
  advance(failed, 1, 7);
  const before = failed.checkpoint();
  const rejected = failed.step({ clockMilliseconds: 128 });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.diagnostics[0].message, /Missing message 29/);
  assert.deepEqual(failed.checkpoint(), before);
  const strict = new CampaignSession({ ...options, runtimeProfile: undefined, browserAi: undefined });
  advance(strict, 1, 7);
  const strictBefore = strict.checkpoint();
  const unsupported = strict.step({ clockMilliseconds: 128 });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.match(unsupported.diagnostics[0].message, /native policy scheduling owner required/);
  assert.deepEqual(strict.checkpoint(), strictBefore);
});

for (const [faction, threshold, team, triggerId] of [["HUMAN", 14096, 2, 17], ["ALIEN", 1136, 1, 0]] as const) {
  test(`browser original ${faction}02: natural VM threshold ${threshold}, source footprint and replay`, () => {
    const options = fixture(faction), before = structuredClone(options), session = new CampaignSession(options);
    assert.ok(auditMissionTriggerSupport(options.triggers).some(diagnostic => diagnostic.triggerId === triggerId
      && diagnostic.message.includes("native policy scheduling owner required")));
    assert.equal(auditMissionTriggerSupport(options.triggers, { browserAi: true }).some(diagnostic => diagnostic.triggerId === triggerId), false);
    advance(session, 1, threshold - 1);
    assert.equal(session.browserAiProjection!.selectors.events.length, 0);
    assert.equal(session.browserAiProjection!.selectors.modes[team], 4);
    advance(session, threshold, threshold);
    const selectors = session.browserAiProjection!.selectors;
    assert.equal(selectors.events.length, 1);
    assert.equal(selectors.events[0].triggerId, triggerId);
    assert.equal(selectors.events[0].before, 4);
    assert.equal(selectors.events[0].after, 3);
    assert.equal(selectors.events[0].profileId, "browser-adapted-v1");
    assert.deepEqual(session.journal[0].commands.filter(command => command.triggerId === triggerId).map(command => command.command.kind),
      faction === "HUMAN" ? ["ai", "reinforce"] : ["abduct", "reinforce", "ai"]);
    assert.deepEqual(session.snapshot.world.source, options.source);
    assert.deepEqual(session.snapshot.controller.blocks, options.triggers);
    assert.deepEqual(options, before);
    const saved = JSON.parse(JSON.stringify(session.checkpoint()));
    const restored = CampaignSession.restore(saved);
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    advance(session, threshold + 1, threshold + 8);
    advance(restored, threshold + 1, threshold + 8);
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    assert.equal(restored.browserAiProjection!.selectors.events.length, 1);
  });
}