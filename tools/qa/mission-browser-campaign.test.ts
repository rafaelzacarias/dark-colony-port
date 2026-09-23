import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView, missionAnimationArchives, missionVisualSprites } from "../../src/mission-view";
import { loadCampaignResourceOptions, type CampaignMissionData } from "../../src/game-data";
import { prepareSourceBrowserCampaignMission, type SourceBrowserCampaignMission } from "../../src/engine/source-browser-campaign-options";
import { loadSourceProductionOptions } from "../../src/engine/source-production-options";
import { BrowserCampaignEconomy } from "../../src/engine/browser-campaign-economy";
import { installSourceRender } from "./fixtures/source-render";
import { parseFin } from "../extractors/animations/fin";
import { parseTriggerScript } from "../extractors/data/triggers";

const root = new URL("../../public/assets/generated/", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const bytes = (path: string) => Uint8Array.from(readFileSync(new URL(path, root)));
const words = (path: string) => {
  const buffer = readFileSync(new URL(path, root));
  return Uint16Array.from({ length: buffer.length / 2 }, (_, index) => buffer.readUInt16LE(index * 2));
};
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };
const stage = {} as HTMLElement;

async function fixture(faction: "human" | "alien"): Promise<SourceBrowserCampaignMission> {
  const folder = faction.toUpperCase(), stem = `${folder}/${folder}02`, map = json(`maps/${stem}.json`);
  const mission: CampaignMissionData = {
    faction, map, scenario: json(`data/scenarios/${stem}.json`), triggers: json(`data/triggers/${stem}.json`).blocks,
    messages: json(`data/messages/${stem}.json`).messages, briefing: json(`data/briefings/${stem}.json`),
    units: json("data/units.json").records, weapons: json("data/weapons.json").records,
    damageMatrix: json("data/damage-matrix.json").coefficients,
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    tileReferences: words(`maps/${folder}/${map.files.tileReferences}`),
    tileRecordIndices: words(`maps/${folder}/${map.files.tileRecordIndices}`),
    attributes: words(`maps/${folder}/${map.files.attributes}`),
    tags: bytes(`maps/${folder}/${map.files.tags}`), pathGrid: bytes(`maps/${folder}/${map.files.pathGrid}`),
  };
  const configuration = { profile: "user-selected-source-campaign-fresh" as const, mode: 0 as const,
    race: (faction === "human" ? 0 : 1) as 0 | 1, localTeam: 0 as const };
  const production = await loadSourceProductionOptions({ sessionId: `${mission.scenario.id}:browser`, mission,
    rawScenario: Uint8Array.from(atob(mission.scenario.rawScenario!), character => character.charCodeAt(0)), configuration,
    loadBytes: async url => Uint8Array.from(readFileSync(new URL(`../../public${url}`, import.meta.url))) });
  const prepared = { ...mission, sourceResource: await loadCampaignResourceOptions(mission,
    async url => Uint8Array.from(readFileSync(new URL(`../../public${url}`, import.meta.url)))),
    sourceProduction: { configuration, initialPopulationCeiling: 150 as const,
    production: production.production } };
  return { ...prepared, ...await prepareSourceBrowserCampaignMission(prepared, json("data/dependencies.json").records) };
}

function create(mission: SourceBrowserCampaignMission) {
  const view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  view.update(0);
  return view;
}

function step(view: MissionView, count = 1) {
  for (let index = 0; index < count; index += 1) {
    view.update((view.simulation.snapshot.tick + 1) * 50);
    assert.equal(view.missionDiagnostic, undefined);
  }
}

function sourceEffects(faction: "HUMAN" | "ALIEN", number: number, names: readonly string[]) {
  return parseTriggerScript(readFileSync(new URL(
    `../../raw_cd/DC/SCENARIO/${faction}/${faction}${String(number).padStart(2, "0")}.TRO`, import.meta.url), "utf8"))
    .flatMap(block => block.actions).filter(action => names.includes(action.name));
}

async function effectMission(actions: CampaignMissionData["triggers"][number]["actions"], followup = "") {
  const mission = await fixture("human");
  const blocks = parseTriggerScript(`0 norm 1 (c>0)\nend\n${followup}`);
  return { ...mission, triggers: [{ ...blocks[0], actions }, ...blocks.slice(1)] };
}

test("TRO view H05 original ally actions commit before engine and validate runtime restore", async () => {
  const actions = sourceEffects("HUMAN", 5, ["ally"]);
  const mission = await effectMission(actions);
  const source = structuredClone(mission.scenario);
  const view = create(mission);
  step(view, 15);
  const before = view.checkpoint();
  step(view);
  const saved = view.checkpoint();
  assert.equal(saved.simulation.teamAlliances[0][1], 0);
  assert.equal(saved.simulation.teamAlliances[1][0], 0);
  assert.deepEqual(saved.simulation.teamAlliances, saved.session!.state.world.teamAlliances);
  assert.ok(saved.browserAi!.strategy.teams.some((team, index) =>
    team.decisions > before.browserAi!.strategy.teams[index].decisions), "effect invalidates decision cadence immediately");
  assert.deepEqual(saved.session!.state.world.adaptedTro!.events.map(event => event.sourceAction), [...actions].reverse());
  const restored = MissionView.restore(canvas(), stage, callbacks, mission, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  const tampered = structuredClone(saved);
  (tampered.simulation.teamAlliances[0] as number[])[1] = 1;
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, tampered), /runtime alliance projection/);
  assert.deepEqual(mission.scenario, source);
});

test("TRO view H06 vision keeps own sight and shared teams never become controllable", async () => {
  const grant = parseTriggerScript("0 norm 1 (c>0)\nvision 0 2 1\nend")[0].actions;
  const original = sourceEffects("HUMAN", 6, ["vision"]);
  const mission = await effectMission([...grant, ...original], "1 norm 1 (c>1)\nvision 0 2 0\nend");
  const view = create(mission);
  step(view, 15);
  const hidden = view.visibility;
  step(view);
  assert.deepEqual(view.visibility, view.visibilityForTeam(2));
  const visible = view.visibility;
  assert.ok(visible.some((flag, index) => flag && !hidden[index]), "grant reveals remote team sight");
  const allies = view.simulation.snapshot.units.filter(actor => actor.team === 2);
  assert.ok(allies.length > 0);
  for (const ally of allies) assert.equal(view.isOwnedUnit(ally.id), false);
  view.replaceSelection(allies.map(actor => actor.id));
  assert.deepEqual(view.selectedIds, []);
  assert.equal(view.campaignSnapshot!.world.adaptedTro!.sharedVision[0][0], 0);
  assert.ok(view.visibilityForTeam(2).some(Boolean));
  step(view, 16);
  assert.equal(view.campaignSnapshot!.world.adaptedTro!.sharedVision[0][2], 0);
  assert.ok(view.visibility.some((flag, index) => !flag && visible[index]));
  assert.ok(view.explored.some((flag, index) => flag && !view.visibility[index]));
});

test("TRO view AL07 dfiddle uses session production restrictions and directed relations", async () => {
  const actions = sourceEffects("ALIEN", 7, ["dfiddle", "ally"]);
  const local = parseTriggerScript("0 norm 1 (c>0)\ndfiddle 0 6 1\nend")[0].actions;
  const view = create(await effectMission([...actions, ...local]));
  step(view, 16);
  const snapshot = view.campaignSnapshot!;
  assert.ok(snapshot.world.adaptedTro!.dependencyRestrictions[1].includes(6));
  assert.equal(snapshot.production!.teams.find(team => team.team === 1), undefined);
  const producer = snapshot.production!.teams.find(team => team.team === 0);
  assert.ok(producer);
  assert.ok(producer.restrictions.includes(6));
  assert.equal(producer.eligibility[6], 2);
  assert.equal(view.productionMenu.some(choice => choice.dependency === 6), false);
  assert.equal(view.purchaseProduction(6), false);
  assert.equal(view.simulation.snapshot.teamAlliances![0][1], 0);
  assert.equal(view.simulation.snapshot.teamAlliances![1][0], 0);
});

test("TRO view AL08 nopickup rejects missing automatic pickup owner atomically", async () => {
  const actions = sourceEffects("ALIEN", 8, ["nopickup"]);
  assert.ok(actions.length > 0);
  const view = create(await effectMission(actions));
  step(view, 15);
  const before = view.checkpoint();
  view.update(800);
  assert.match(view.missionDiagnostic!, /automatic casualty-pickup owner/);
  const after = view.checkpoint();
  for (const key of ["simulation", "session", "browserAi", "economy", "combatMovement"] as const) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.deepEqual(after.state.explored, before.state.explored);
});

test("TRO view late economy failure rolls back alliances vision weights and presentation", async () => {
  const actions = [...sourceEffects("HUMAN", 5, ["ally"]), ...sourceEffects("HUMAN", 15, ["aimsg"]),
    ...parseTriggerScript("0 norm 1 (c>0)\nvision 0 1 1\nend")[0].actions];
  const view = create(await effectMission(actions));
  step(view, 15);
  const before = view.checkpoint(), visible = view.visibility;
  const observe = BrowserCampaignEconomy.prototype.observe;
  try {
    BrowserCampaignEconomy.prototype.observe = function(simulation) {
      observe.call(this, simulation);
      throw new Error("controlled TRO post-engine failure");
    };
    view.update(800);
  } finally { BrowserCampaignEconomy.prototype.observe = observe; }
  assert.match(view.missionDiagnostic!, /controlled TRO post-engine failure/);
  const after = view.checkpoint();
  for (const key of ["simulation", "session", "browserAi", "economy", "combatMovement"] as const) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.deepEqual(view.visibility, visible);
  for (const key of ["explored", "latestMessage", "outcome"] as const) assert.deepEqual(after.state[key], before.state[key]);
});

test("ALIEN02 real assets: T turret initializes unchanged source and delivers harvester by tick 300", async context => {
  const mission = await fixture("alien");
  const original = structuredClone({ scenario: mission.scenario, triggers: mission.triggers });
  assert.deepEqual(mission.scenario, json("data/scenarios/ALIEN/ALIEN02.json"));
  assert.deepEqual(mission.triggers, json("data/triggers/ALIEN/ALIEN02.json").blocks);
  assert.deepEqual(mission.scenario.placementRows.filter(row => row[2] === 41),
    [[81, 38, 41, 1, -1, 0], [31, 31, 41, 1, -1, 0]]);
  const rendering = installSourceRender();
  const previousFetch = globalThis.fetch;
  const requested = new Set<string>();
  const missing: string[] = [];
  let view: MissionView | undefined;
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."), path);
    requested.add(path);
    try { return new Response(readFileSync(new URL(`../../public${path}`, import.meta.url))); }
    catch (error) { missing.push(path); throw error; }
  };
  try {
    view = new MissionView(rendering.canvas(), stage, callbacks, mission);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.campaignSnapshot!.world.entities.length, 44);
    const turrets = view.campaignSnapshot!.world.entities.filter(entity => entity.unitType === 41);
    assert.deepEqual(turrets.map(entity => entity.sourceRow), [11, 12]);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const sprites = missionVisualSprites(mission);
    assert.ok(sprites.includes("T"));
    const archives = new Set(sprites.flatMap(sprite => [...missionAnimationArchives(sprite)]));
    for (const archive of archives) {
      assert.ok(requested.has(`/assets/generated/animations/${archive}.json`), archive);
      const generated = json(`animations/${archive}.json`);
      const raw = readFileSync(new URL(`../../raw_cd/DC/ANIMATE/${archive}.FIN`, import.meta.url));
      assert.equal(generated.source.sha256, createHash("sha256").update(raw).digest("hex"), archive);
      const source = parseFin(raw);
      assert.deepEqual(generated.states, source.states, `${archive} source states`);
      assert.deepEqual(generated.timeline, source.timeline, `${archive} source composition`);
    }
    assert.equal(requested.has("/assets/generated/animations/T.json"), false);
    assert.ok(rendering.evidence().images.includes("/assets/generated/sprites/SPRITES/TURR.png"));
    view.update(0);
    step(view, 300);
    assert.equal(view.simulation.snapshot.tick, 300);
    assert.ok(view.browserEconomyState!.bindings.some(binding => view!.isOwnedUnit(binding.simulationId)),
      "original TRO must deliver the player harvester");
    assert.deepEqual(view.campaignSnapshot!.world.entities.filter(entity => entity.unitType === 41)
      .map(entity => entity.sourceRow), [11, 12]);
    assert.deepEqual({ scenario: mission.scenario, triggers: mission.triggers }, original);
    assert.deepEqual(missing, []);
    assert.ok(rendering.evidence().spriteDraws > 0);
    context.diagnostic(`${sprites.length} sprites; ${archives.size} archives; ${requested.size} asset URLs; no missing assets; tick 300`);
  } finally {
    view?.dispose();
    globalThis.fetch = previousFetch;
    rendering.dispose();
  }
});

for (const faction of ["human", "alien"] as const) {
  test(`${faction} adapted view: legacy adjacent mining checkpoint stays exact without teleport`, async () => {
    const mission = await fixture(faction);
    const view = create(mission);
    for (let tick = 0; tick < 300 && !view.browserEconomyState!.bindings.some(binding => view.isOwnedUnit(binding.simulationId)); tick++) step(view);
    const binding = view.browserEconomyState!.bindings.find(binding => view.isOwnedUnit(binding.simulationId))!;
    view.replaceSelection([binding.simulationId]);
    const node = mission.browserEconomy!.nodes.find(node => view.harvestSelected(node.slot))!;
    assert.ok(node);
    const target = [{ x: node.cell.x, y: node.cell.y - 1 }, { x: node.cell.x + 1, y: node.cell.y },
      { x: node.cell.x, y: node.cell.y + 1 }, { x: node.cell.x - 1, y: node.cell.y }]
      .find(cell => view.grid.isPassable(cell.x, cell.y) && !view.simulation.snapshot.units.some(unit => unit.health > 0
        && unit.cellX === cell.x && unit.cellY === cell.y))!;
    assert.ok(target);
    const current = view.checkpoint();
    const staticId = view.nativeBindings.find(binding => binding.key === node.key)!.simulationId;
    const index = node.cell.y * view.grid.width + node.cell.x;
    const costs = [...current.simulation.grid.costs];
    const priorCost = costs[index];
    assert.ok(priorCost > 0);
    costs[index] = 0;
    const legacy = { ...current, economy: { ...current.economy!, orders: current.economy!.orders.map(order =>
      order.simulationId === binding.simulationId ? { ...order, target } : order) }, simulation: { ...current.simulation,
      grid: { ...current.simulation.grid, costs },
      staticTargets: current.simulation.staticTargets.map(actor => actor.id === staticId ? { ...actor, footprint: [index] } : actor),
      staticBlockers: [...current.simulation.staticBlockers, { index, count: 1, priorCost }],
      commands: current.simulation.commands.map(entry => entry.command.type === "move" && entry.command.unitIds.includes(binding.simulationId)
        ? { ...entry, command: { ...entry.command, target } } : entry) } };
    const restored = MissionView.restore(canvas(), stage, callbacks, mission, JSON.parse(JSON.stringify(legacy)));
    const mirror = MissionView.restore(canvas(), stage, callbacks, mission, JSON.parse(JSON.stringify(legacy)));
    assert.deepEqual(restored.checkpoint(), legacy);
    assert.deepEqual(mirror.checkpoint(), legacy);
    restored.update(restored.simulation.snapshot.tick * 50);
    mirror.update(mirror.simulation.snapshot.tick * 50);
    for (let tick = 0; tick < 160 && restored.browserEconomyState!.earned[0] === 0; tick++) {
      step(restored); step(mirror);
    }
    assert.ok(restored.browserEconomyState!.earned[0] > 0);
    assert.deepEqual(restored.checkpoint(), mirror.checkpoint());
    const unit = restored.simulation.snapshot.units.find(unit => unit.id === binding.simulationId)!;
    assert.deepEqual([unit.cellX, unit.cellY], [target.x, target.y]);
    const saved = restored.checkpoint();
    assert.deepEqual(MissionView.restore(canvas(), stage, callbacks, mission, JSON.parse(JSON.stringify(saved))).checkpoint(), saved);
    view.dispose(); restored.dispose(); mirror.dispose();
  });

  test(`${faction} adapted view: original startup and first staged frame`, async () => {
    const mission = await fixture(faction);
    const view = create(mission);
    assert.equal(view.resourceWorkflow.credits[0], 0);
    assert.equal(view.browserEconomyState!.harvesters.length, 0);
    assert.deepEqual(view.browserEconomyState!.remaining,
      Object.fromEntries(mission.browserEconomy!.nodes.map(node => [node.key, node.amount])));
    for (const node of mission.browserEconomy!.nodes) {
      const binding = view.nativeBindings.find(binding => binding.key === node.key)!;
      assert.deepEqual(view.simulation.checkpoint().staticTargets.find(target => target.id === binding.simulationId)!.footprint, []);
      assert.ok(view.nativeBindings.some(binding => binding.key === node.key));
    }
    const initial = JSON.parse(JSON.stringify(view.checkpoint()));
    assert.deepEqual(MissionView.restore(canvas(), stage, callbacks, mission, initial).checkpoint(), initial);
    step(view);
    assert.equal(view.simulation.snapshot.tick, 1);
    assert.equal(view.browserEconomyState!.tick, 1);
    assert.equal(view.browserAiState!.sourceCycle, 1);
    assert.equal(view.browserAiState!.strategy.lastTick, 0);
    assert.deepEqual(view.campaignSnapshot!.world.aiSelectors!.modes, mission.scenario.teams.map(team => team.ai));
    const saved = JSON.parse(JSON.stringify(view.checkpoint()));
    assert.deepEqual(MissionView.restore(canvas(), stage, callbacks, mission, saved).checkpoint(), saved);
    for (const tamper of [
      (checkpoint: typeof saved) => { checkpoint.economy.extra = true; },
      (checkpoint: typeof saved) => { checkpoint.economy.earned[0] = 1; },
      (checkpoint: typeof saved) => { checkpoint.browserAi.strategy.fingerprint = "wrong"; },
      (checkpoint: typeof saved) => { checkpoint.browserAi.strategy.extra = true; },
      (checkpoint: typeof saved) => { delete checkpoint.economy; },
      (checkpoint: typeof saved) => { checkpoint.extra = true; },
    ]) {
      const invalid = structuredClone(saved); tamper(invalid);
      assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, invalid));
    }
  });

  test(`${faction} adapted view: delivered harvester earns a source FIN purchase and restores mid-period`, async () => {
    const mission = await fixture(faction);
    let view = create(mission);
    for (let ticks = 0; ticks < 500 && !view.browserEconomyState!.bindings.length; ticks += 1) step(view);
    const binding = view.browserEconomyState!.bindings.find(entry => view.isOwnedUnit(entry.simulationId));
    assert.ok(binding, "original TRO must deliver the player harvester");
    const unitId = binding.simulationId;
    assert.equal(view.browserEconomyState!.harvesters.find(actor => actor.key === binding.key)!.options.speedSubcellsPerTick, 160);
    assert.equal(view.simulation.resourceActors.length, 0);
    view.replaceSelection([unitId]);
    const node = mission.browserEconomy!.nodes.find(node => view.harvestSelected(node.slot));
    assert.ok(node, "a revealed original VENT must accept extraction");
    assert.equal(view.browserEconomyState!.orders.length, 1);
    step(view, 5);
    const beforeStop = view.simulation.snapshot.units.find(unit => unit.id === unitId)!;
    view.stopSelected();
    step(view, 2);
    const stopped = view.simulation.snapshot.units.find(unit => unit.id === unitId)!;
    assert.deepEqual([stopped.xSubcells, stopped.ySubcells], [beforeStop.xSubcells, beforeStop.ySubcells]);
    assert.equal(view.browserEconomyState!.orders.length, 0);
    assert.equal(view.harvestSelected(node.slot), true);
    view.setOrderMode("move");
    const camera = view.cameraView;
    view.commandAt((stopped.cellX + 0.5 - camera.x) * 32, (camera.y + camera.height - stopped.cellY - 0.5) * 32);
    assert.equal(view.browserEconomyState!.orders.length, 0, "Move cancels external extraction before enqueue");
    step(view, 2);
    assert.equal(view.harvestSelected(node.slot), true);
    for (let ticks = 0; ticks < 2000 && view.browserEconomyState!.orders[0]?.phase !== "extracting"; ticks += 1) step(view);
    assert.equal(view.browserEconomyState!.orders[0]?.phase, "extracting");
    step(view, 7);
    const saved = JSON.parse(JSON.stringify(view.checkpoint()));
    const restored = MissionView.restore(canvas(), stage, callbacks, await fixture(faction), saved);
    assert.deepEqual(restored.checkpoint(), saved);
    restored.update(restored.simulation.snapshot.tick * 50);
    step(view, 21); step(restored, 21);
    assert.deepEqual(restored.checkpoint(), view.checkpoint());
    for (let ticks = 0; ticks < 600 && view.resourceWorkflow.credits[0] < 350; ticks += 1) step(view);
    assert.ok(view.resourceWorkflow.credits[0] >= 350);
    view.stopSelected();
    step(view, 2);
    const earned = view.browserEconomyState!.earned[0];
    assert.equal(node.amount - view.browserEconomyState!.remaining[node.key], earned);
    assert.equal(view.resourceWorkflow.credits[0], earned);
    const choice = view.productionMenu.find(choice => choice.enabled);
    assert.ok(choice, "earned balance must enable the real source producer");
    assert.equal(choice.cost, 350);
    const before = view.nativeBindings.length;
    assert.equal(view.purchaseProduction(choice.dependency), true);
    assert.equal(view.purchaseProduction(choice.dependency), false);
    const pending = JSON.parse(JSON.stringify(view.checkpoint()));
    const observe = BrowserCampaignEconomy.prototype.observe;
    try {
      BrowserCampaignEconomy.prototype.observe = function(simulation) {
        observe.call(this, simulation);
        throw new Error("controlled pending-purchase failure");
      };
      view.update((view.simulation.snapshot.tick + 1) * 50);
    } finally { BrowserCampaignEconomy.prototype.observe = observe; }
    assert.match(view.missionDiagnostic!, /pending-purchase failure/);
    assert.deepEqual(view.checkpoint().session, pending.session);
    assert.deepEqual(view.checkpoint().economy, pending.economy);
    assert.equal(view.checkpoint().state.pendingProduction, choice.dependency);
    view = MissionView.restore(canvas(), stage, callbacks, mission, pending);
    view.update(view.simulation.snapshot.tick * 50);
    step(view);
    assert.equal(view.resourceWorkflow.credits[0], earned - choice.cost);
    for (let ticks = 0; ticks < 300 && view.nativeBindings.length === before; ticks += 1) step(view);
    const created = view.nativeBindings.slice(before).map(binding =>
      view.campaignSnapshot!.world.entities.find(entity => entity.key === binding.key));
    assert.ok(created.some(entity => entity?.team === 0 && entity.unitType === (faction === "human" ? 0 : 8)));
    step(view, 25);
    assert.equal(view.resourceWorkflow.credits[0], earned - choice.cost, "no duplicate debit or receipt credit");
    assert.equal(view.browserEconomyState!.earned[0], earned);
    assert.equal(view.simulation.snapshot.resources[faction], 0, "generic cargo economy stays unused");
    step(view, Math.max(0, 500 - view.simulation.snapshot.tick));
    assert.ok(view.simulation.snapshot.tick >= 500);
    const spent = MissionView.restore(canvas(), stage, callbacks, mission, JSON.parse(JSON.stringify(view.checkpoint())));
    spent.update(spent.simulation.snapshot.tick * 50);
    step(spent, 2);
    assert.equal(spent.resourceWorkflow.credits[0], earned - choice.cost, "restoring spent earnings cannot repay them");
  });
}

test("adapted view rolls back AI, economy, simulation and pending player commands after a late failure", async () => {
  const view = create(await fixture("human"));
  for (let ticks = 0; ticks < 300 && !view.simulation.snapshot.units.some(actor => view.isOwnedUnit(actor.id)); ticks += 1) step(view);
  const unit = view.simulation.snapshot.units.find(actor => view.isOwnedUnit(actor.id));
  assert.ok(unit);
  view.replaceSelection([unit.id]);
  view.stopSelected();
  const saved = view.checkpoint();
  const observe = BrowserCampaignEconomy.prototype.observe;
  try {
    BrowserCampaignEconomy.prototype.observe = function(simulation) {
      observe.call(this, simulation);
      throw new Error("controlled post-economy failure");
    };
    view.update((view.simulation.snapshot.tick + 1) * 50);
  } finally { BrowserCampaignEconomy.prototype.observe = observe; }
  assert.match(view.missionDiagnostic!, /controlled post-economy/);
  const failed = view.checkpoint();
  assert.deepEqual(failed.simulation, saved.simulation);
  assert.deepEqual(failed.session, saved.session);
  assert.deepEqual(failed.browserAi, saved.browserAi);
  assert.deepEqual(failed.economy, saved.economy);
  assert.deepEqual(failed.state.pendingReservations, saved.state.pendingReservations);
  assert.equal(failed.state.pendingProduction, saved.state.pendingProduction);
});

test("HUMAN02 natural AI: source homes alliances and army census through frame 1161", { timeout: 100_000 }, async (context) => {
  const started = performance.now(), mission = await fixture("human"), view = create(mission);
  const config = mission.browserAi!;
  for (const team of [3, 4]) assert.equal(config.teams[team].home, null);
  assert.equal(config.teams[3].allies[0], 0);
  assert.equal(config.teams[4].allies[0], 1);
  assert.ok(config.teams[3].objectives.some(point => point.x === 56 && point.y === 55));
  assert.ok(!config.teams[4].objectives.some(point => point.x === 56 && point.y === 55));
  const initialArmies = view.campaignSnapshot!.world.entities.filter(actor => [3, 4].includes(actor.team));
  assert.equal(initialArmies.length, 0, "original mode-3 selectors do not manufacture armies");
  const issued = new Map<string, { issuedTick: number; signature: string }>();
  for (let tick = 0; tick < 1161; tick++) {
    assert.ok(performance.now() - started < 100_000, "natural source fixture exceeded 100-second budget");
    step(view);
    for (const [identity, actor] of Object.entries(view.browserAiState!.strategy.actors)) {
      if (actor.issuedTick >= 0) issued.set(identity, { issuedTick: actor.issuedTick, signature: actor.signature });
    }
  }
  const state = view.browserAiState!.strategy;
  for (const team of [3, 4]) assert.ok(state.teams[team].decisions > 0);
  const armies = view.campaignSnapshot!.world.entities.filter(actor => [3, 4].includes(actor.team));
  assert.deepEqual(armies.map(actor => [actor.team, actor.unitType]), [[3, 8], [3, 8]], "original conditional reinforce supplies team 3, not allied team 4");
  const delivered = armies.map(actor => {
    const binding = view.nativeBindings.find(binding => binding.key === actor.key && binding.generation === actor.generation)!;
    return { type: actor.unitType, current: view.simulation.snapshot.units.find(unit => unit.id === binding.simulationId),
      lastOrder: issued.get(`${actor.key}:${actor.generation}:${binding.simulationId}`),
      strategy: state.actors[`${actor.key}:${actor.generation}:${binding.simulationId}`] };
  });
  context.diagnostic(JSON.stringify({ tick: view.simulation.snapshot.tick,
    decisions: [state.teams[3].decisions, state.teams[4].decisions], armies: armies.length,
    objectives: [config.teams[3].objectives, config.teams[4].objectives], delivered, wallMs: performance.now() - started }));
  for (const actor of delivered) {
    assert.ok(actor.lastOrder && actor.lastOrder.issuedTick >= 0, JSON.stringify(actor));
    assert.ok(actor.current && (actor.current.cellX !== 42 || actor.current.cellY !== 50), "delivered soldier must move from the original reinforcement anchor");
    if (actor.current.health === 0) assert.equal(actor.strategy, undefined, "dead soldiers must leave the policy's commandable state");
  }
});

test("ALIEN02 adapted view reaches original AI threshold at 1136 and continues with strategy commands", { timeout: 100_000 }, async (context) => {
  const started = performance.now();
  const mission = await fixture("alien");
  const view = create(mission);
  for (let tick = 0; tick < 1135; tick++) {
    assert.ok(performance.now() - started < 100_000, "natural source fixture exceeded 100-second budget");
    step(view);
  }
  assert.equal(view.campaignSnapshot!.world.aiSelectors!.modes[1], 4);
  assert.equal(view.browserAiState!.strategy.teams[1].decisions, 0);
  const selected = view.selectedIds;
  const activationSnapshotTick = view.simulation.snapshot.tick;
  step(view);
  assert.equal(view.campaignSnapshot!.world.aiSelectors!.modes[1], 3);
  assert.ok(view.campaignSnapshot!.world.aiSelectors!.events.some(event => event.team === 1 && event.after === 3));
  const activationActors = Object.entries(view.browserAiState!.strategy.actors)
    .filter(([, actor]) => actor.issuedTick === activationSnapshotTick);
  assert.equal(activationSnapshotTick, 1135);
  assert.equal(activationActors.length, 1, "activation must issue an order in the pre-advance simulation snapshot");
  const [identity, activationActor] = activationActors[0];
  const command = JSON.parse(activationActor.signature);
  assert.deepEqual(command, { type: "move", unitIds: [45], target: { x: 7, y: 70 } });
  const binding = view.nativeBindings.find(binding => binding.simulationId === command.unitIds[0])!;
  const owner = view.campaignSnapshot!.world.entities.find(actor => actor.key === binding.key)!;
  assert.equal(owner.team, 1);
  assert.equal(owner.unitType, 69, "original opening reinforce2 supplies the movable armed actor, not the static turrets");
  const activationPosition = view.simulation.snapshot.units.find(actor => actor.id === binding.simulationId)!;
  step(view, 25);
  assert.ok(view.browserAiState!.strategy.teams[1].decisions > 0);
  const continuing = view.browserAiState!.strategy.actors[identity];
  assert.equal(continuing.issuedTick, activationSnapshotTick, "a continuing order must not be reissued merely to satisfy the post-activation assertion");
  assert.equal(continuing.signature, activationActor.signature);
  const moved = view.simulation.snapshot.units.find(actor => actor.id === binding.simulationId)!;
  assert.equal(moved.activity, "move");
  assert.notDeepEqual([moved.xSubcells, moved.ySubcells], [activationPosition.xSubcells, activationPosition.ySubcells]);
  context.diagnostic(JSON.stringify({ activationFrame: 1136, issuedTick: continuing.issuedTick,
    observedTick: view.simulation.snapshot.tick, owner: owner.key, type: owner.unitType,
    decisions: view.browserAiState!.strategy.teams[1].decisions, command,
    from: [activationPosition.cellX, activationPosition.cellY], to: [moved.cellX, moved.cellY], wallMs: performance.now() - started }));
  assert.deepEqual(view.selectedIds, selected, "AI must not reset player selection");
  const saved = JSON.parse(JSON.stringify(view.checkpoint()));
  const restored = MissionView.restore(canvas(), stage, callbacks, await fixture("alien"), saved);
  restored.update(restored.simulation.snapshot.tick * 50);
  step(view, 21); step(restored, 21);
  assert.deepEqual(restored.checkpoint(), view.checkpoint());
});