import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView, missionVisualSprites } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import { loadSourceProductionOptions, sourceProductionTeamSeeds } from "../../src/engine/source-production-options";
import { parseScenario } from "../extractors/data/scenario";

const root = new URL("../../public/assets/generated/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(read(path).toString());
const canvas = () => ({ width: 512, height: 452, getContext: () => null }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

async function sourceMission(faction: "human" | "alien", number: 1 | 2): Promise<CampaignMissionData> {
  const prefix = faction.toUpperCase(), stem = `${prefix}/${prefix}0${number}`;
  const map = json(`maps/${stem}.json`), scenario = json(`data/scenarios/${stem}.json`);
  const words = (path: string) => {
    const bytes = read(path);
    return Uint16Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readUInt16LE(index * 2));
  };
  const mission = { faction, scenario, units: json("data/units.json").records };
  const source = await loadSourceProductionOptions({ sessionId: `${scenario.id}:browser`, mission,
    rawScenario: Buffer.from(scenario.rawScenario, "base64"),
    configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: faction === "human" ? 0 : 1 },
    loadBytes: async (url) => read(url.replace("/assets/generated/", "")),
  });
  return { ...mission, map, triggers: json(`data/triggers/${stem}.json`).blocks,
    messages: json(`data/messages/${stem}.json`).messages, briefing: json(`data/briefings/${stem}.json`),
    weapons: json("data/weapons.json").records, damageMatrix: json("data/damage-matrix.json").coefficients,
    terrain: json(`terrain/${map.terrainBank.split(".")[0].toUpperCase()}.json`), terrainAtlasUrl: "unused-in-node",
    tileReferences: words(`maps/${prefix}/${map.files.tileReferences}`),
    tileRecordIndices: words(`maps/${prefix}/${map.files.tileRecordIndices}`),
    attributes: words(`maps/${prefix}/${map.files.attributes}`),
    pathGrid: Uint8Array.from(read(`maps/${prefix}/${map.files.pathGrid}`)),
    tags: Uint8Array.from(read(`maps/${prefix}/${map.files.tags}`)),
    sourceProduction: { configuration: source.configuration, initialPopulationCeiling: source.initialPopulationCeiling,
      ...(source.production ? { production: source.production } : {}) },
  };
}

function create(mission: CampaignMissionData): MissionView {
  return new MissionView(canvas(), stage, callbacks, mission);
}

function step(view: MissionView, count = 1): void {
  for (let index = 0; index < count; index += 1) {
    view.update((view.simulation.snapshot.tick + 1) * 50);
    assert.equal(view.missionDiagnostic, undefined);
  }
}

function restore(view: MissionView): MissionView {
  const saved = JSON.parse(JSON.stringify(view.checkpoint()));
  const restored = MissionView.restore(canvas(), stage, callbacks, view.mission, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  restored.update(restored.simulation.snapshot.tick * 50);
  return restored;
}

for (const faction of ["human", "alien"] as const) {
  test(`${faction} original first mission has no factory UI or purchase`, async () => {
    const mission = await sourceMission(faction, 1), view = create(mission);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(mission.sourceProduction!.production, undefined);
    assert.deepEqual(view.productionMenu, []);
    assert.equal(view.purchaseProduction(9), false);
    assert.deepEqual(restore(view).productionMenu, []);
  });
}

test("unchanged HUMAN02 retains full TRO and fails before admission, despite verified factory options", async () => {
  const mission = await sourceMission("human", 2), view = create(mission);
  assert.deepEqual(mission.triggers, json("data/triggers/HUMAN/HUMAN02.json").blocks);
  assert.deepEqual(mission.sourceProduction!.production!.teams.map(({ team }) => team), [0]);
  assert.equal(mission.sourceProduction!.production!.teams[0].credits, 0);
  assert.deepEqual(JSON.parse(view.missionDiagnostic!), ["TRO 17: ai: native policy scheduling owner required"]);
  assert.equal(view.campaignSnapshot, null);
  assert.deepEqual(view.productionMenu, []);
  assert.equal(view.purchaseProduction(9), false);
});

for (const faction of ["human", "alien"] as const) test(`${faction} SYNTHETIC source-separate seeded funds, purchase, native completion and restore`, async () => {
  const original = await sourceMission(faction, 2);
  const parsed = parseScenario(Buffer.from(original.scenario.rawScenario!, "base64").toString("ascii"));
  const synthetic = { ...parsed, id: `SYNTHETIC-PRODUCTION-${faction}`, placementRows: [],
    teams: parsed.teams.map((team) => ({ ...team, money: team.index === 0 ? 1000 : team.money,
      coordinateRows: [[0, 0], team.index === 0 ? [24, 24] : [0, 0]] as const,
      cityRows: team.index === 0 ? team.cityRows : [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ...team.cityRows.slice(1)] })) };
  const mission: CampaignMissionData = { ...original,
    scenario: { ...original.scenario, ...synthetic, rawScenario: undefined,
      source: { path: "SYNTHETIC-PRODUCTION", sha256: "synthetic-not-original-source" } },
    pathGrid: new Uint8Array(original.pathGrid.length).fill(1), tags: new Uint8Array(original.tags.length),
    triggers: [{ id: 1, mode: "norm", flag: 1, condition: "(c > 4)",
      actions: [{ name: "exomoney", arguments: [0, 255] }] }],
    sourceProduction: { ...original.sourceProduction!, production: { ...original.sourceProduction!.production!,
      teams: [sourceProductionTeamSeeds(synthetic, original.units)[0]] } },
  };
  const view = create(mission);
  assert.equal(view.missionDiagnostic, undefined);
  assert.equal(view.productionMenu.length, 1);
  const choice = view.productionMenu[0];
  assert.equal(choice.sprite, faction === "human" ? "TRSC" : "GRAY");
  assert.equal(choice.enabled, true);
  assert.ok(missionVisualSprites(mission).includes(choice.sprite));
  view.update(0);
  step(view);
  assert.equal(view.productionMenu[0].credits, 1000);
  assert.equal(view.productionMenu[0].enabled, true);
  assert.equal(view.purchaseProduction(choice.dependency), true);
  assert.equal(view.purchaseProduction(choice.dependency), false);
  const pending = restore(view);
  step(view); step(pending);
  assert.deepEqual(view.checkpoint(), pending.checkpoint());
  assert.equal(view.productionMenu[0].credits, 1000 - choice.cost);
  assert.equal(view.productionMenu[0].queued, 1);
  step(view, 5);
  const resumed = restore(view);
  for (let index = 0; index < 90; index += 1) {
    step(view); step(resumed);
    assert.deepEqual(view.nativeBindings, resumed.nativeBindings);
    assert.deepEqual(view.campaignJournal.at(-1), resumed.campaignJournal.at(-1));
  }
  assert.equal(view.productionMenu[0].queued, 0);
  assert.equal(view.productionMenu[0].credits, 255);
  assert.equal(view.productionMenu[0].enabled, false);
  const created = view.campaignJournal.flatMap((entry) => entry.requests).filter((request) => request.type === "create");
  assert.equal(created.length, 1);
  assert.equal(view.nativeBindings.filter(({ slot, generation }) => slot === created[0].slot && generation === created[0].generation).length, 1);
  assert.equal(view.simulation.snapshot.units.length, 1);
  assert.ok(view.simulation.checkpoint().units[0].weapon?.sourceDamage);
  assert.ok(view.simulation.checkpoint().units[0].sourceDefense);
  assert.deepEqual(restore(view).checkpoint(), view.checkpoint());
  const saved = JSON.parse(JSON.stringify(view.checkpoint()));
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks,
    { ...mission, sourceProduction: undefined }, saved), /sourceIdentity|enum/);
  saved.session.options.production.sourceProfiles[0].directions[0][0] += 1;
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, saved), /source\/options/);
});