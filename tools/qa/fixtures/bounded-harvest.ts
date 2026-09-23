import type { CampaignMissionData } from "../../../src/game-data";
import { sourceBoundedHarvestConfiguration, sourceResourceProfiles } from "../../../src/engine/source-resource-options";
import { loadSourceProductionOptions, sourceProductionTeamSeeds } from "../../../src/engine/source-production-options";

export type BoundedHarvestLoader = (url: string) => Promise<Uint8Array>;

const root = "/assets/generated/";
const fetchBytes: BoundedHarvestLoader = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Bounded harvest fixture: cannot load ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};
const json = async (path: string, loadBytes: BoundedHarvestLoader) =>
  JSON.parse(new TextDecoder().decode(await loadBytes(`${root}${path}`)));

export async function createBoundedHarvestFixture(typeId: 6 | 14, mobileFirst = false,
  loadBytes: BoundedHarvestLoader = fetchBytes, originalPth?: Uint8Array): Promise<CampaignMissionData> {
  const scenario = await json("data/scenarios/HUMAN/HUMAN02.json", loadBytes);
  const map = await json("maps/HUMAN/HUMAN02.json", loadBytes);
  const units = (await json("data/units.json", loadBytes)).records;
  const weapons = (await json("data/weapons.json", loadBytes)).records;
  const fin = Object.fromEntries(await Promise.all(["VENT", "EXPL", "SLUG"].map(async stem =>
    [stem, await json(`animations/${stem}.json`, loadBytes)]))) as Parameters<typeof sourceResourceProfiles>[0];
  const sourceRow = scenario.placementRows.find((row: number[]) => row[0] === 69 && row[1] === 48 && row[2] === 40);
  if (JSON.stringify(sourceRow) !== JSON.stringify([69, 48, 40, 22, 12000])) {
    throw new Error("Bounded harvest fixture: original HUMAN02 VENT row changed");
  }
  const slot = mobileFirst ? 152 : 153;
  const raw = new Uint8Array(220), view = new DataView(raw.buffer);
  view.setUint16(0, 17280, true); view.setUint16(4, 12416, true);
  raw[6] = typeId; raw[0xa] = 64; view.setInt32(12, 800, true);
  for (const offset of [0x14, 0x1c, 0x24]) view.setUint32(offset, 4839108, true);
  raw[0x22] = 2; raw[0x2a] = 2; raw[0x2c] = 1; raw[0x35] = 255;
  raw[0x39] = 1; raw[0x3c] = 3; view.setUint16(0x46, 65535, true);
  raw[0xcd] = 67; raw[0xce] = 48; raw.set([255, 254, 255, 254, 255], 0xd1);
  const pathGrid = Uint8Array.from(await loadBytes(`${root}maps/HUMAN/${map.files.pathGrid}`));
  const tags = Uint8Array.from(await loadBytes(`${root}maps/HUMAN/${map.files.tags}`));
  const nativeHarvest = await sourceBoundedHarvestConfiguration({ scope: "source-separated-bounded",
    evidence: "SourceSeparated seeded idle: original generalized commandBefore (67,48)->(69,48), heading0, isolated RNG index0; no mission-global RNG claim",
    pth: originalPth ?? await loadBytes("/raw_cd/DC/SCENARIO/HUMAN/HUMAN02.PTH"),
    width: 96, height: 84, tags, fin, units,
    banks: [{ typeId, stand: 4839108, move: 4839908, preservedIdle: 4840228 }],
    bindings: [{ slot, generation: 0, raw: [...raw], randomIndex: 0, groundWord: slot, provenance: "restored-idle" }] });
  const mobile = [67, 48, typeId, 0, 800];
  const teams = scenario.teams.map((team: object, index: number) => ({ ...team,
    ...(index === 0 ? { race: typeId === 6 ? 0 : 1, money: 0 } : {}) }));
  const profiles = sourceResourceProfiles(fin);
  const resourceLifecycle = { ...profiles, nativeHarvest, bindings: [{ slot: mobileFirst ? 153 : 152, generation: 0,
    state: { direction: 0, animation: { profile: "VENTSTAND", frame: 0, delay: 0, mode: 0 as const },
      pendingOrder: 0, order: 0, released: false, stack: [{ opcode: 1 as const, words: [65535, 0, 0] }] } }] };
  const words = async (path: string) => {
    const bytes = await loadBytes(`${root}${path}`);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Uint16Array.from({ length: bytes.length / 2 }, (_, index) => data.getUint16(index * 2, true));
  };
  const terrainStem = map.terrainBank.split(".")[0].toUpperCase();
  return { faction: typeId === 6 ? "human" : "alien", map,
    scenario: { ...scenario, id: `SourceSeparated-${typeId}-${mobileFirst}`, rawScenario: undefined, teams,
      source: { path: "SourceSeparated-HUMAN02-VENT-seeded-harvester", sha256: "fixture-not-original-mission" },
      placementRows: mobileFirst ? [mobile, sourceRow] : [sourceRow, mobile] }, triggers: [], messages: [],
    briefing: await json("data/briefings/HUMAN/HUMAN02.json", loadBytes), units, weapons,
    damageMatrix: (await json("data/damage-matrix.json", loadBytes)).coefficients,
    terrain: await json(`terrain/${terrainStem}.json`, loadBytes), terrainAtlasUrl: `${root}terrain/${terrainStem}.png`,
    tileReferences: await words(`maps/HUMAN/${map.files.tileReferences}`),
    tileRecordIndices: await words(`maps/HUMAN/${map.files.tileRecordIndices}`),
    attributes: await words(`maps/HUMAN/${map.files.attributes}`), pathGrid, tags,
    sourceResource: { source: scenario, configuration: { profile: "user-selected-source-campaign-fresh", mode: 0,
      race: typeId === 6 ? 0 : 1, localTeam: 0, resourceConfiguration: "native-constructor", aiPercentages: Array(8).fill(100) },
      evidence: { executableSha256: "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
        scenarioSha256: scenario.source.sha256, profile: "bounded-native-constructor-scn" },
      resourceLifecycle, resourceInitialIncome: Array(8).fill(0), resourceScales: { rateScale: 256, reserveScale: 256 },
      resourceFrameSource: { teams: teams.map(({ index, ai }: { index: number; ai: number }) => ({ index, ai })),
        aiMultipliers: Array(8).fill(256), localTeam: 0, cancellationGate: 0 }, missionAdmission: "not-evaluated",
      prerequisites: ["generic-mobile-idle-owner", "incoming-harvester-task-handoff", "mission-admission"],
      eruption: { category: 1, event: 7, soundId: 183, source: "SOUND/ERUPT.WAV", spatial: false } } };
}

export async function createBoundedHarvestProductionFixture(typeId: 6 | 14, mobileFirst = false,
  loadBytes: BoundedHarvestLoader = fetchBytes, originalPth?: Uint8Array): Promise<CampaignMissionData> {
  const seeded = await createBoundedHarvestFixture(typeId, mobileFirst, loadBytes, originalPth);
  const faction = typeId === 6 ? "human" : "alien";
  const stem = faction === "human" ? "HUMAN/HUMAN02" : "ALIEN/ALIEN02";
  const scenario = await json(`data/scenarios/${stem}.json`, loadBytes);
  const source = await loadSourceProductionOptions({ sessionId: `${scenario.id}:browser`,
    mission: { faction, scenario, units: seeded.units },
    rawScenario: Uint8Array.from(atob(scenario.rawScenario), character => character.charCodeAt(0)),
    configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: typeId === 6 ? 0 : 1 },
    loadBytes });
  if (!source.production) throw new Error("Bounded harvest fixture: source production unavailable");
  return { ...seeded, sourceProduction: { configuration: source.configuration,
    initialPopulationCeiling: 150, production: { ...source.production,
      teams: [sourceProductionTeamSeeds({ ...source.source, ...seeded.scenario,
        teams: seeded.scenario.teams.map((team, index) => ({ ...source.source.teams[index], ...team })) }, seeded.units)[0]] } } };
}