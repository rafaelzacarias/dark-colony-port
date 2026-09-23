import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseTriggerScript } from "../extractors/data/triggers.ts";
import { CampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session.ts";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime.ts";
import { createBrowserAiSelectorOwner } from "../../src/engine/browser-campaign-runtime.ts";
import { createCampaignWorldAdapter } from "../../src/engine/campaign-world.ts";
import { parseMissionMessages } from "../extractors/data/messages.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";
import { projectLegacyColony } from "../../src/engine/legacy-colony.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { auditMissionTriggerSupport } from "../../src/engine/mission-controller.ts";
import { decodeMissionWorldAction } from "../../src/engine/mission-controller.ts";
import { evaluateTriggerCondition } from "../../src/engine/trigger-runtime.ts";

const adapted = { runtimeProfile: "browser-adapted" } as const;

test("adapted TRO census audits all thirteen unchanged original complete scripts", () => {
  const rows = ([ ["HUMAN", [4, 5, 6, 9, 12, 15]], ["ALIEN", [5, 7, 8, 9, 10, 12, 15]] ] as const).flatMap(([faction, missions]) =>
    missions.map(number => {
      const mission = `${faction}${String(number).padStart(2, "0")}`;
      const path = new URL(`../../raw_cd/DC/SCENARIO/${faction}/${mission}.TRO`, import.meta.url);
      const bytes = readFileSync(path);
      const blocks = parseTriggerScript(bytes.toString());
      const before = structuredClone(blocks);
      const diagnostics = auditMissionTriggerSupport(blocks, { ...adapted, browserAi: true });
      assert.deepEqual(blocks, before);
      assert.deepEqual(readFileSync(path), bytes);
      return { mission, sha256: createHash("sha256").update(bytes).digest("hex"), blocks: blocks.length,
        actions: blocks.reduce((sum, block) => sum + block.actions.length, 0), diagnostics,
        strictDiagnostics: auditMissionTriggerSupport(blocks, { browserAi: true }) };
    }));
  const report = { scope: "Module-only full original TRO audit; no loader/view/game completion claim", rows,
    total: rows.length, admitted: rows.filter(row => row.diagnostics.length === 0).length };
  if (process.env.DC_ADAPTED_TRO_CENSUS) writeFileSync(process.env.DC_ADAPTED_TRO_CENSUS, JSON.stringify(report, null, 2) + "\n");
  assert.equal(rows.length, 13);
  assert.deepEqual(rows.filter(row => row.diagnostics.length > 0), []);
  assert.ok(rows.every(row => row.strictDiagnostics.length > 0));
});

function control(script: string): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
  const original = parseScenario(read("SCENARIO/HUMAN/HUMAN02.SCN"));
  const source = { ...original, placementRows: [], teams: original.teams.map(team => ({ ...team, ai: 3,
    coordinateRows: [[0, 0], [0, 0]] as const })) };
  return { sessionId: "adapted-tro", ...adapted, source, browserAi: createBrowserAiSelectorConfiguration(source),
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT")).filter(unit => unit.index === 0),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT")), triggers: parseTriggerScript(script),
    messages: [{ id: 1, text: "Source message" }], map: { width: 8, height: 8 }, pathGrid: new Uint8Array(64).fill(1),
    tags: new Uint8Array(64), commanders: [{ team: 0, unitType: 0, sprite: "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1 };
}

function advance(session: CampaignSession, start = 1, end = 8) {
  for (let tick = start; tick <= end; tick++) {
    const result = session.step({ clockMilliseconds: tick * 16 });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
}

const effects = `ally 0 1 0
vision 0 5 1
dfiddle 1 6 1
nopickup 6
aimsg 1 2 3 8
exomoney 0 920
msg 2 0 1 3 8`;

test("adapted TRO session commits actual effects, source evidence and replay, strict default rejects new commands", () => {
  const options = control(`0 norm 1 (c>0)\n${effects}\nend`);
  assert.deepEqual(auditMissionTriggerSupport(options.triggers, { ...adapted, browserAi: true }), []);
  assert.equal(auditMissionTriggerSupport(options.triggers).length, 6);
  const session = new CampaignSession(options);
  const original = session.snapshot.world.source;
  advance(session, 1, 16);
  const world = session.snapshot.world;
  assert.equal(world.exomoney[0], 152);
  assert.equal(world.teamAlliances![0][1], 0);
  assert.equal(world.teamAlliances![1][0], original.teams[1].allies![0]);
  assert.equal(world.adaptedTro!.sharedVision[0][5], 1);
  assert.equal(world.adaptedTro!.sharedVision[5][0], 1);
  assert.ok(world.adaptedTro!.dependencyRestrictions[1].includes(6));
  assert.equal(world.adaptedTro!.noPickup[6], 1);
  assert.equal(world.adaptedTro!.aiGroupWeights[1][3], 8);
  assert.deepEqual(world.adaptedTro!.events.map(event => event.command.kind), ["aimsg", "nopickup", "dfiddle", "vision", "ally"]);
  assert.equal(world.adaptedTro!.events[0].clockMilliseconds, 256);
  assert.equal(world.messages[0].text, "Source message");
  assert.deepEqual(world.source, original);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = CampaignSession.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved);
  advance(session, 17, 24);
  advance(restored, 17, 24);
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  assert.throws(() => { (session.adaptedTroProjection!.teamAlliances[0] as number[])[1] = 1; });
  for (const mutate of [
    (copy: typeof saved) => { copy.state.world.teamAlliances[0][1] = 1; },
    (copy: typeof saved) => { copy.state.world.adaptedTro.noPickup[6] = 0; },
    (copy: typeof saved) => { copy.state.world.adaptedTro.aiGroupWeights[1][3] = 9; },
    (copy: typeof saved) => { copy.state.world.adaptedTro.events[0].evidence = "invented"; },
    (copy: typeof saved) => { copy.state.world.adaptedTro.extra = 1; },
  ]) { const copy = structuredClone(saved); mutate(copy); assert.throws(() => CampaignSession.restore(copy)); }
});

test("adapted TRO late failure rolls back effects, source messages, money and trigger lives", () => {
  const session = new CampaignSession(control(`0 norm 1 (c>0)\nunknown 1\nbail 0 1\n${effects}\nend`));
  advance(session, 1, 15);
  const before = session.checkpoint();
  const result = session.step({ clockMilliseconds: 256 });
  assert.equal(result.ok, false);
  assert.deepEqual(session.checkpoint(), before);
});

test("adapted TRO old checkpoints without effect fields remain restorable", () => {
  const session = new CampaignSession(control("0 norm 1 (c>0)\nexomoney 0 3\nend"));
  advance(session, 1, 16);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  assert.equal(saved.state.world.adaptedTro, undefined);
  assert.equal(saved.state.world.teamAlliances, undefined);
  assert.deepEqual(CampaignSession.restore(saved).checkpoint(), saved);
});

test("adapted TRO dfiddle changes production eligibility while preserving unrelated initial restrictions", () => {
  const base = control("0 norm 1 (c>0)\ndfiddle 0 6 1\nend\n1 norm 1 (c>1)\ndfiddle 0 6 0\nend");
  const units = parseUnitStats(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/GAMESTAT.TXT", import.meta.url), "utf8"));
  const source = { ...base.source, teams: base.source.teams.map(team => team.index === 0 ? { ...team,
    coordinateRows: [[0, 0], [50, 50]] as const, cityRows: [[1, -1, 1, -1, 0, 0, 0, 0, 0, 0]] } : team) };
  const colony = projectLegacyColony(source.teams, units);
  const session = new CampaignSession({ ...base, source, units, browserAi: createBrowserAiSelectorConfiguration(source),
    map: { width: 128, height: 128 }, pathGrid: new Uint8Array(128 * 128).fill(1), tags: new Uint8Array(128 * 128), production: {
    records: [{ id: 6, cost: 350, interfaceId: 89, rawFields: [1, 0], dependencies: [] }],
    units: [{ unitType: 0, queue: 0, exitSelector: 0, exitOffset: { x: 0, y: -3 } }],
    sourceProfiles: [{ unitType: 0, bankField: 152, id: "TRSCBUILD0",
      finSha256: "b27b20282999188e37a74872b70a273b370cc1dd219f2f8fa84f5f2f2ca3a5a4",
      directions: Array.from({ length: 32 }, () => Array(22).fill(1)) }],
    teams: [{ team: 0, race: 0, credits: source.teams[0].money!, costAccumulator: 0, base: { x: 50, y: 50 },
      slots: Array.from({ length: 5 }, (_, slot) => {
        const projected = colony.slots.find(entry => entry.nativeId === slot)!;
        return { health: projected.health, level: projected.upgradeLevel, busy: 0 as const };
      }), restrictions: [14], upgrades: [],
      producerDelays: [0, 0, 0, 0] }],
  } });
  assert.equal(session.snapshot.production!.teams[0].eligibility[6], 1);
  for (let tick = 1; tick <= 32; tick++) {
    const result = session.step({ clockMilliseconds: tick * 16,
      productionVisits: [{ team: 0, queue: 0, population: 0, populationLimit: 100 }] });
    assert.equal(result.ok, true, JSON.stringify(result));
    const team = session.snapshot.production!.teams[0];
    assert.ok(team.restrictions.includes(14));
    if (tick >= 16 && tick < 32) assert.equal(team.eligibility[6], 2);
  }
  assert.deepEqual(session.snapshot.production!.teams[0].restrictions, [14]);
  assert.equal(session.snapshot.production!.teams[0].eligibility[6], 1);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("adapted TRO session reservation supplies current entity type to an original H12 trip predicate", () => {
  const original = parseTriggerScript(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN12.TRO", import.meta.url), "utf8"));
  const tripCondition = original.find(block => block.id === 19)!.condition;
  const base = control(`0 norm 1 (c>0)\nreinforce2 3 2 2 8 1\nend\n19 trip 1 ${tripCondition}\nexomoney 0 920\nend`);
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
  const source = { ...base.source, teams: base.source.teams.map(team => team.index === 3 ? { ...team, race: 1 } : team) };
  const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT")).filter(unit => unit.index === 0 || unit.index === 8);
  const tags = new Uint8Array(64);
  tags[(8 - 1 - 3) * 8 + 3] = 19;
  const session = new CampaignSession({ ...base, source, units, tags, browserAi: createBrowserAiSelectorConfiguration(source) });
  advance(session, 1, 16);
  const entity = session.snapshot.world.entities.find(entity => entity.team === 3 && entity.unitType === 8)!;
  assert.ok(entity);
  const result = session.step({ clockMilliseconds: 272, reservations: [{ slot: entity.rawSlot!, generation: entity.generation, tileX: 3, tileY: 3 }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(session.snapshot.world.exomoney[0], 152);
  assert.equal(session.snapshot.controller.runtime.lives[19], 0);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("adapted TRO all original effect actions execute with their exact arguments", () => {
  const options = control("0 norm 1 (0)\nend");
  let world = new CampaignSession(options).snapshot.world;
  const adapter = createCampaignWorldAdapter(undefined, undefined, createBrowserAiSelectorOwner(options.browserAi!, options.source));
  let count = 0;
  for (const [faction, missions] of [["HUMAN", [4, 5, 6, 9, 12, 15]], ["ALIEN", [5, 7, 8, 9, 10, 12, 15]]] as const) {
    for (const mission of missions) {
      const script = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}${String(mission).padStart(2, "0")}.TRO`, import.meta.url), "utf8");
      for (const block of parseTriggerScript(script)) for (const [actionIndex, action] of block.actions.entries()) {
        if (!["ally", "vision", "dfiddle", "nopickup", "aimsg"].includes(action.name)) continue;
        const decoded = decodeMissionWorldAction(action, adapted);
        assert.ok(decoded.ok);
        const result = adapter.prepare(world, [{ id: `source:${count++}`, triggerId: block.id, actionIndex, action, command: decoded.value }]);
        assert.ok(result.ok, JSON.stringify(result));
        world = result.value.world;
        assert.deepEqual(world.adaptedTro!.events.at(-1)!.sourceAction, action);
      }
    }
  }
  assert.ok(count > 30);
  assert.equal(world.adaptedTro!.events.length, count);
  const planned = { id: "invalid", triggerId: 0, actionIndex: 0, action: { name: "ally", arguments: [0, 1, 0] },
    command: { kind: "ally", team: 0, otherTeam: 1, enabled: 1 } } as const;
  assert.equal(adapter.prepare(world, [planned]).ok, false);
  assert.equal(createCampaignWorldAdapter().prepare(world, [{ ...planned, command: { ...planned.command, enabled: 0 } }]).ok, false);
  for (const mode of [0, 1, 2, 4, 5]) {
    const changed = { ...world, aiSelectors: { ...world.aiSelectors!, modes: world.aiSelectors!.modes.map((value, team) => team === 1 ? mode : value) } };
    const action = { name: "aimsg", arguments: [1, 2, 3, 8] };
    const decoded = decodeMissionWorldAction(action, adapted);
    assert.ok(decoded.ok);
    const result = adapter.prepare(changed, [{ id: `mode:${mode}`, triggerId: 0, actionIndex: 0, action, command: decoded.value }]);
    assert.equal(result.ok, mode !== 5);
    if (result.ok) assert.deepEqual(result.value.world.adaptedTro!.aiGroupWeights, world.adaptedTro!.aiGroupWeights);
  }
});

test("adapted TRO original thirteen session openings retain source and report every remaining failure", () => {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
  const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());
  const rows = [];
  for (const [faction, missions] of [["HUMAN", [4, 5, 6, 9, 12, 15]], ["ALIEN", [5, 7, 8, 9, 10, 12, 15]]] as const) {
    for (const number of missions) {
      const mission = `${faction}${String(number).padStart(2, "0")}`;
      const file = (extension: string) => read(`SCENARIO/${faction}/${mission}.${extension}`);
      const source = parseScenario(file("SCN").toString());
      const triggers = parseTriggerScript(file("TRO").toString());
      const map = parseMapBundle(file("MAP"), file("MTG"), file("PTH"));
      let ticks = 0;
      let failure: unknown = null;
      let session: CampaignSession | undefined;
      try {
        session = new CampaignSession({ sessionId: `tro-${mission}`, ...adapted, source,
          browserAi: createBrowserAiSelectorConfiguration(source), units, weapons, triggers,
          messages: parseMissionMessages(file("MSG").toString()), map, pathGrid: map.pathGrid, tags: map.tagGrid,
          resourceScales: "configured-startup", commanders: [{ team: 0, unitType: faction === "HUMAN" ? 69 : 73,
            sprite: faction === "HUMAN" ? "TRSC" : "GRAY" }],
          directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1 });
        for (let tick = 1; tick <= 16; tick++) {
          const result = session.step({ clockMilliseconds: tick * 16 });
          if (!result.ok) { failure = result.diagnostics; break; }
          ticks = tick;
        }
        assert.deepEqual(session.snapshot.world.source, source);
        assert.deepEqual(session.snapshot.controller.blocks, triggers);
      } catch (error) { failure = String(error); }
      rows.push({ mission, ticks, failure, effects: session?.snapshot.world.adaptedTro?.events ?? [],
        commands: session?.journal.flatMap(entry => entry.commands) ?? [] });
    }
  }
  const report = { scope: "Actual unmodified source CampaignSession construction and 16 natural ticks; no view or strategy execution", rows };
  if (process.env.DC_ADAPTED_TRO_OPENINGS) writeFileSync(process.env.DC_ADAPTED_TRO_OPENINGS, JSON.stringify(report, null, 2) + "\n");
  assert.equal(rows.length, 13);
  const blocked = rows.filter(row => row.failure !== null);
  assert.deepEqual(blocked.map(row => row.mission), ["HUMAN09", "HUMAN12", "ALIEN07", "ALIEN08", "ALIEN10", "ALIEN12"]);
  for (const row of blocked) assert.match(String(row.failure), /requires native type-37 coordinate queue and selector-6 state/);
  assert.ok(rows.filter(row => row.failure === null).every(row => row.ticks === 16));
});

test("adapted TRO t reads the trip entity type, not elapsed time", () => {
  const inputs = { ...adapted, cycleCounter: 10000, clockMilliseconds: 50000, buildingSlots: {}, triggeringUnitType: 8 };
  assert.deepEqual(evaluateTriggerCondition("((S==3)&&(t==8))", {}, inputs, 3), { ok: true, value: 1 });
  assert.deepEqual(evaluateTriggerCondition("((S==3)&&(t==8))", {}, { ...inputs, triggeringUnitType: 9 }, 3), { ok: true, value: 0 });
  assert.equal(evaluateTriggerCondition("(t==8)", {}, { ...inputs, triggeringUnitType: undefined }).ok, false);
  assert.equal(evaluateTriggerCondition("(t==8)", {}, { ...inputs, runtimeProfile: undefined }, 3).ok, false);
});

test("adapted TRO exomoney preserves original parser byte truncation, strict gate unchanged", () => {
  for (const [source, value] of [[0, 0], [255, 255], [256, 0], [920, 152], [10000, 16], [2147483647, 255], [-1, 255]]) {
    const action = { name: "exomoney", arguments: [4, source] };
    assert.deepEqual(decodeMissionWorldAction(action, adapted), { ok: true, value: { kind: "exomoney", team: 4, value } });
    if (source > 255) assert.equal(decodeMissionWorldAction(action).ok, false);
  }
});

test("adapted TRO native five-pair reinforcement stream accepts omitted pairs and zero-only extra padding", () => {
  for (const name of ["reinforce", "reinforce2"]) {
    for (const tail of [[], [0], [0, 0], [0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]) {
      const result = decodeMissionWorldAction({ name, arguments: [3, 0, 65, 8, 1, ...tail] }, adapted);
      assert.equal(result.ok, true);
      if (result.ok && (result.value.kind === "reinforce" || result.value.kind === "reinforce2")) {
        assert.deepEqual(result.value.groups, [{ unitType: 8, count: 1 }, ...Array.from({ length: 4 }, () => ({ unitType: 0, count: 0 }))]);
      }
    }
    for (const tail of [[8], [0, 0, 0, 0, 0, 0, 0, 0, 8, 1]]) {
      assert.equal(decodeMissionWorldAction({ name, arguments: [3, 0, 65, 8, 1, ...tail] }, adapted).ok, false);
    }
    assert.equal(decodeMissionWorldAction({ name, arguments: [3, 0, 65, 8, 1] }).ok, false);
  }
});

test("adapted TRO H09 literal &&== follows native omitted operand stack without source replacement", () => {
  const original = parseTriggerScript(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN09.TRO", import.meta.url), "utf8"));
  const condition = original.find(block => block.id === 1)!.condition;
  assert.ok(condition.includes("b(1,3)&&==0"));
  const inputs = { ...adapted, cycleCounter: 0, clockMilliseconds: 0,
    buildingSlots: Object.fromEntries([1, 2].flatMap(team => Array.from({ length: 5 }, (_, slot) => [`${team},${slot}`, 0]))) };
  assert.deepEqual(evaluateTriggerCondition(condition, { "4,3": 0 }, inputs), { ok: true, value: 0 });
  assert.deepEqual(evaluateTriggerCondition(condition, { "4,3": 12 }, inputs), { ok: true, value: 1 });
  assert.deepEqual(evaluateTriggerCondition("(1&&==0)", {}, inputs), { ok: true, value: 0 });
  assert.deepEqual(evaluateTriggerCondition("(0&&==0)", {}, inputs), { ok: true, value: 1 });
  assert.equal(evaluateTriggerCondition(condition, { "4,3": 12 }, { ...inputs, runtimeProfile: undefined }).ok, false);
});