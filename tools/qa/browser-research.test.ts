import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { createBrowserResearchConfiguration, observeBrowserResearch, restoreBrowserResearch } from "../../src/engine/browser-research";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { aiSelectorSourceCanonical } from "../../src/engine/ai-command-selector";
import { observeBrowserResearchType37Frame, projectBrowserType37Discovery } from "../../src/engine/browser-type37-presentation";
import { stepBrowserType37 } from "../../src/engine/browser-type37";
import { transportHostState } from "../../src/engine/transport-host";
import { DeterministicSimulation, type ResourceActorOwnership } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const source = parseScenario(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN07.SCN"));
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"));
const dependencies = parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT"));
const configurationInput = { runtimeProfile: "browser-adapted" as const, activation: "source-city-slot4-health" as const,
  scienceOwner: "campaign-city-test", source, units, dependencies };

test("browser research: original research center and science dependency chain are distinct", () => {
  const configuration = createBrowserResearchConfiguration(configurationInput);
  assert.equal(configuration.activation, "source-city-slot4-health");
  assert.throws(() => createBrowserResearchConfiguration({ ...configurationInput, scienceOwner: "" }), /owner/);
  assert.throws(() => createBrowserResearchConfiguration({ ...configurationInput,
    dependencies: dependencies.map(entry => entry.id === 6 ? { ...entry, rawFields: [0, 3, 0, 0] } : entry) }), /dependency/);
  assert.throws(() => createBrowserResearchConfiguration({ ...configurationInput,
    units: units.map(unit => unit.index === 22 ? { ...unit, weapons: [1, 1, 1] as const } : unit) }), /definition/);
});

function fixture(race = 0, researchHealth = 3600, original = false) {
  const controlled = original ? source : { ...source,
    placementRows: [[4, 4, race === 0 ? 6 : 14, 0, -1], [4, 4, 37, 0, -1], [4, 4, 63, 0, -1], [4, 4, 64, 0, -1]],
    teams: source.teams.map(team => ({ ...team, race: team.index === 0 ? race : team.race,
      coordinateRows: [[0, 0], team.index === 0 ? [12, 10] : [0, 0]] as const,
      cityRows: team.cityRows.map((row, index) => index === 0
        ? [1, -1, 1, -1, 0, -1, 2, -1, researchHealth > 0 ? 1 : 0, researchHealth] : row) })) };
  const size = original ? 128 : 20;
  const commander = units.find(unit => unit.index >= 69 && unit.index <= 76 && unit.faction === controlled.teams[0].race)!;
  const result = initializeCampaignSession({ sessionId: "research-qa", source: controlled, units, messages: [],
    resourceScales: "configured-startup",
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(controlled),
    weapons: parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT")), triggers: [],
    map: { width: size, height: size }, pathGrid: new Uint8Array(size * size).fill(1), tags: new Uint8Array(size * size),
    commanders: [{ team: 0, unitType: commander.index, sprite: commander.sprite }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1 });
  assert.ok(result.ok, JSON.stringify(result));
  const world = result.value.world;
  const research = createBrowserResearchConfiguration({ ...configurationInput, source: controlled });
  const owner = { runtimeProfile: "browser-adapted" as const, sourceCanonical: aiSelectorSourceCanonical(controlled) };
  return { world, research, owner, scienceOwner: configurationInput.scienceOwner };
}

test("browser research: original H07 opening has no center; lab2 alone and dfiddle cannot activate", () => {
  const original = fixture(0, 0, true);
  assert.equal(original.world.buildingSlots["0,4"], 0);
  assert.deepEqual(observeBrowserResearch(original.world, original.research, original.scienceOwner).spyTeams, Array(8).fill(false));
  const lab = fixture(0, 0);
  assert.ok(lab.world.buildingSlots["0,3"] > 0);
  assert.equal(observeBrowserResearch(lab.world, lab.research, lab.scienceOwner).spyTeams[0], false);
  assert.deepEqual(lab.world.source.teams[0].dependencies, source.teams[0].dependencies);
});

test("browser research: both races, declared owner, actor replacement, health loss and strict save checks", () => {
  for (const race of [0, 1]) {
    const { world, research, scienceOwner } = fixture(race);
    const before = structuredClone(world);
    const observed = observeBrowserResearch(world, research, scienceOwner);
    assert.equal(observed.spyTeams[0], true);
    assert.equal(observed.teams[0].unitType, race === 0 ? 22 : 34);
    assert.equal(observed.teams[0].dependency, race === 0 ? 6 : 20);
    assert.deepEqual(restoreBrowserResearch(world, research, JSON.parse(JSON.stringify(observed))), observed);
    assert.throws(() => observeBrowserResearch(world, research, "another-city-owner"), /owner/);
    assert.throws(() => observeBrowserResearch(world, { ...research }, scienceOwner), /profile/);
    assert.throws(() => observeBrowserResearch({ ...world, source: { ...world.source, id: "other" } }, research, scienceOwner), /source/);
    for (const saved of [{ ...observed, extra: true }, { ...observed, scienceOwner: "another" },
      { ...observed, sessionId: "other" }, { ...observed, clockMilliseconds: 50 },
      { ...observed, spyTeams: Array(8).fill(false) }, { ...observed, teams: observed.teams.slice(1) }]) {
      assert.throws(() => restoreBrowserResearch(world, research, saved), /saved research/);
    }
    const stale = structuredClone(world);
    const staleHost = transportHostState(stale);
    staleHost.slots[4]!.generation++;
    assert.throws(() => observeBrowserResearch({ ...stale, transportState: staleHost }, research, scienceOwner), /stale/);
    const lost = { ...structuredClone(world), buildingSlots: { ...world.buildingSlots, "0,4": 0 },
      entities: world.entities.map(entity => entity.rawSlot === 4 ? { ...entity, health: 0 } : entity) };
    const lostHost = transportHostState(lost);
    lostHost.slots[4]!.health = 0;
    assert.equal(observeBrowserResearch({ ...lost, transportState: lostHost }, research, scienceOwner).spyTeams[0], false);
    assert.throws(() => restoreBrowserResearch({ ...lost, transportState: lostHost }, research, observed), /saved research/);
    assert.deepEqual(world, before);
  }
});

test("browser research: public idle collector excavates source artifacts at visit450 in FIFO order", () => {
  const setup = fixture();
  let world = setup.world;
  const simulation = new DeterministicSimulation(new NavigationGrid(20, 20));
  const collector = world.entities.find(entity => entity.unitType === 6)!;
  const simulationId = simulation.addUnit({ faction: "human", team: 0, cell: { x: 4, y: 4 },
    health: collector.health, maxHealth: collector.maxHealth });
  const bindings = [{ simulationId, key: collector.key, slot: collector.rawSlot!, generation: collector.generation }];
  simulation.queue({ type: "move", unitIds: [simulationId], target: { x: 3, y: 4 } });
  for (let tick = 0; tick < 80; tick++) simulation.advance();
  assert.deepEqual(observeBrowserResearchType37Frame(world, setup.owner, { research: setup.research,
    scienceOwner: setup.scienceOwner, snapshot: simulation.snapshot, bindings }).idleHarvesterSlots, []);
  simulation.queue({ type: "move", unitIds: [simulationId], target: { x: 4, y: 4 } });
  for (let tick = 0; tick < 80; tick++) simulation.advance();
  assert.equal(simulation.snapshot.units[0].activity, "idle");
  const input = { research: setup.research, scienceOwner: setup.scienceOwner, snapshot: simulation.snapshot, bindings };
  const observe = () => observeBrowserResearchType37Frame(world, setup.owner, input);
  assert.deepEqual(observe().idleHarvesterSlots, [collector.rawSlot]);
  const absentHost = transportHostState(world);
  absentHost.slots[4]!.health = 0;
  const absent = { ...world, transportState: absentHost, buildingSlots: { ...world.buildingSlots, "0,4": 0 },
    entities: world.entities.map(entity => entity.rawSlot === 4 ? { ...entity, health: 0 } : entity) };
  assert.deepEqual(observeBrowserResearchType37Frame(absent, setup.owner, input).idleHarvesterSlots, []);
  assert.throws(() => observeBrowserResearchType37Frame(world, setup.owner, { ...input, scienceOwner: "undeclared" }), /owner/);
  const resourceSnapshot = { ...input.snapshot, units: input.snapshot.units.map(unit => ({ ...unit,
    resourceActor: { owner: "resource" } as ResourceActorOwnership })) };
  assert.deepEqual(observeBrowserResearchType37Frame(world, setup.owner,
    { ...input, snapshot: resourceSnapshot }).idleHarvesterSlots, []);
  const resourceHost = transportHostState(world);
  resourceHost.slots[collector.rawSlot!]!.resourceTask = { direction: 0, pendingOrder: 1, order: 1, released: false,
    animation: { profile: "EXPLSTAND", frame: 0, delay: 0, mode: 0 }, stack: [{ opcode: 1, words: [] }] };
  assert.deepEqual(observeBrowserResearchType37Frame({ ...world, transportState: resourceHost }, setup.owner, input).idleHarvesterSlots, []);
  for (const activity of ["move", "harvest", "attack"] as const) {
    assert.deepEqual(observeBrowserResearchType37Frame(world, setup.owner, { ...input,
      snapshot: { ...input.snapshot, units: input.snapshot.units.map(unit => ({ ...unit, activity })) } }).idleHarvesterSlots, []);
  }
  const count = world.entities.length;
  for (let visit = 0; visit < 449; visit++) world = stepBrowserType37(world, observe());
  assert.equal(world.entities.length, count);
  assert.equal(world.scenarioMarkers![0].remainingVisits, 1);
  const savedResearch = JSON.parse(JSON.stringify(observeBrowserResearch(world, setup.research, setup.scienceOwner)));
  assert.deepEqual(restoreBrowserResearch(world, setup.research, savedResearch).spyTeams, observe().spyTeams);
  const stopped = stepBrowserType37(world, observeBrowserResearchType37Frame(world, setup.owner,
    { ...input, snapshot: resourceSnapshot }));
  assert.equal(stopped.scenarioMarkers![0].remainingVisits, 450);
  world = stepBrowserType37(world, observe());
  assert.equal(world.entities.at(-1)!.unitType, 63);
  assert.equal(world.entities.at(-1)!.team, 0);
  assert.deepEqual(transportHostState(world).fifos[0].types, [64]);
  const spawned = world.entities.at(-1)!;
  assert.equal(spawned.health, units[63].health);
  assert.equal(world.entityBytes![spawned.rawSlot! * 220 + 0xcb], 0);
  for (let visit = 0; visit < 450; visit++) world = stepBrowserType37(world, observe());
  assert.equal(world.entities.at(-1)!.unitType, 64);
  assert.deepEqual(transportHostState(world).fifos[0].types, []);
  assert.deepEqual(world.source, setup.world.source);
  assert.deepEqual(world.coordinateQueues, setup.world.coordinateQueues);
});

test("browser research: discovery uses original UI pixels and ordinary visibility, not a type37 actor", () => {
  const { world, research, owner, scienceOwner } = fixture();
  const before = structuredClone(world);
  const input = { research, scienceOwner, localTeam: 0, presentationPolicy: "adapted-original-cursor-v1" as const,
    isTileVisible: () => true };
  const discovery = projectBrowserType37Discovery(world, owner, input);
  const entry = discovery.entries[0];
  assert.equal(entry.visible, true);
  assert.equal(entry.selectable, false);
  assert.equal(entry.combatBinding, null);
  assert.deepEqual(entry.collisionFootprint, []);
  assert.equal(discovery.revealsTerrain, false);
  assert.equal(projectBrowserType37Discovery(world, owner, { ...input, isTileVisible: () => false }).entries[0].visible, false);
  assert.equal(projectBrowserType37Discovery(world, owner, { ...input, localTeam: 1 }).entries[0].visible, false);
  const metadata = JSON.parse(read(`public${entry.asset.metadata}`));
  assert.equal(metadata.source.path, entry.asset.source);
  assert.equal(metadata.source.sha256, entry.asset.sourceSha256);
  assert.equal(metadata.frames[entry.asset.frame].empty, false);
  assert.equal(readFileSync(new URL(`public${entry.asset.image}`, root)).readUInt32BE(16), metadata.atlas.width);
  entry.pendingTypes.push(0);
  assert.deepEqual(world, before);
});