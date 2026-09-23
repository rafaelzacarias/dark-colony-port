import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { transportHostState } from "../../src/engine/transport-host";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseMapBundle } from "../extractors/maps/map";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";

const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());

function options(faction: "HUMAN" | "ALIEN" = "HUMAN", mission = "02", adapted = true): CampaignSessionOptions {
  const asset = (extension: string) => read(`SCENARIO/${faction}/${faction}${mission}.${extension}`);
  const source = parseScenario(asset("SCN").toString());
  const map = parseMapBundle(asset("MAP"), asset("MTG"), asset("PTH"));
  return { sessionId: `${faction}${mission}:casualty`, source, units, weapons,
    ...(adapted ? { runtimeProfile: "browser-adapted" as const, browserAi: createBrowserAiSelectorConfiguration(source) } : {}),
    messages: parseMissionMessages(asset("MSG").toString()), triggers: parseTriggerScript(asset("TRO").toString()),
    map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: source.teams.map(team => ({ team: team.index, unitType: team.race === 1 ? 73 : 69,
      sprite: team.race === 1 ? "GRAY" : "TRSC" })),
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 50,
    orientationSteps: 1, resourceScales: "configured-startup" };
}

function advance(session: CampaignSession, extra: Omit<CampaignSessionInput, "clockMilliseconds"> = {}) {
  const state = session.runtimeProfile === "browser-adapted" ? session.browserViewSnapshot : session.snapshot;
  const input = { clockMilliseconds: state.world.clockMilliseconds + 50, ...extra };
  const result = session.runtimeProfile === "browser-adapted" ? session.stepForBrowserView(input) : session.step(input);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result));
  return result.value;
}

function readyCommander(session: CampaignSession) {
  let state: Pick<ReturnType<typeof advance>, "world" | "cycleCounter"> = session.snapshot;
  for (let tick = 0; tick < 500; tick++) {
    const commander = state.world.entities.find(actor => actor.rawSlot === state.world.commanderSlots[0] && actor.health > 0);
    if (commander && (state.cycleCounter & 7) === 7) return { state, commander };
    state = advance(session);
  }
  throw new Error("Original script did not deliver the selected commander");
}

test("session casualty: original M02 death owns pickup and in-flight replay", () => {
  for (const faction of ["HUMAN", "ALIEN"] as const) {
    const session = new CampaignSession(options(faction));
    const { state: initial, commander: victim } = readyCommander(session);
    assert.deepEqual(initial.world.browserCasualtyPickup, { runtimeProfile: "browser-adapted" });
    assert.equal(victim.unitType, faction === "HUMAN" ? 69 : 73);
    const carrierId = transportHostState(session.snapshot.world).reducer.nextId;
    const updates = [{ type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation }];
    advance(session, { updates });
    const state = session.snapshot, host = transportHostState(state.world);
    const casualty = host.browserCasualties![0];
    assert.deepEqual(casualty, { slot: victim.rawSlot, generation: victim.generation,
      lossId: JSON.stringify([initial.world.sessionId, victim.key, victim.generation]),
      carrierId, disposition: "scheduled", collected: false });
    assert.equal(host.reducer.carriers.find(carrier => carrier.id === carrierId)!.type, faction === "HUMAN" ? 92 : 93);
    assert.equal(host.registry[victim.rawSlot!], victim.key);
    assert.equal(state.world.entities.find(actor => actor.key === victim.key)!.health, 0);
    assert.equal(state.controller.runtime.statistics[`0,0,${victim.unitType}`], 1);
    assert.equal(state.controller.runtime.bail, null);
    const saved = session.checkpoint();
    assert.equal(session.step({ clockMilliseconds: state.world.clockMilliseconds + 50,
      updates: [{ ...updates[0], type: "complete-removal" }] }).ok, false);
    assert.deepEqual(session.checkpoint(), saved);
    const restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored.checkpoint(), saved);
    for (const candidate of [session, restored]) advance(candidate, { updates });
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    assert.equal(transportHostState(session.snapshot.world).requests.filter(request => request.type === "combat-death").length, 1);
  }
});

test("session casualty: original M02 recovery waits over 720 ticks and never resets losses or grants victory", context => {
  for (const faction of ["HUMAN", "ALIEN"] as const) {
    const configuration = options(faction);
    const session = new CampaignSession(configuration);
    const { commander: victim } = readyCommander(session);
    const death = { type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation };
    let frame = advance(session, { updates: [death] });
    const deathTick = frame.cycleCounter;
    const threshold = (deathTick >>> 4) + 45;
    assert.equal(frame.controller.runtime.statistics["0,2,0"], threshold);
    const expectedRecoveryTick = (threshold + 1) * 16;
    assert.ok(expectedRecoveryTick - deathTick > 720);
    let collectionTick = 0, recoveryTick = 0;
    const pickupRequests = [];
    while (frame.cycleCounter < deathTick + 1100) {
      const pickup = frame.entry.requests.find(request => request.type === "casualty-picked-up" && request.slot === death.slot);
      if (pickup) {
        collectionTick = frame.cycleCounter;
        pickupRequests.push(pickup);
        const host = transportHostState(session.snapshot.world);
        assert.equal(host.registry[death.slot], null);
        assert.equal(host.slots[death.slot]!.health, 0);
        assert.equal(host.browserCasualties![0].collected, true);
        assert.ok(frame.entry.requests.some(request => request.type === "unregister" && request.slot === death.slot));
        assert.ok(!frame.world.entities.some(actor => actor.key === victim.key));
        const checkpoint = session.checkpoint();
        const restored = CampaignSession.restore(JSON.parse(JSON.stringify(checkpoint)));
        assert.deepEqual(restored.checkpoint(), checkpoint);
        frame = advance(session, { updates: [death] });
        assert.deepEqual(advance(restored, { updates: [death] }), frame);
      }
      if (frame.entry?.commands.some(command => command.command.kind === "reinforce"
        && command.command.groups.some(group => group.unitType === victim.unitType))) {
        recoveryTick = frame.cycleCounter;
        assert.equal(recoveryTick, expectedRecoveryTick);
      }
      assert.equal(frame.controller.runtime.statistics[`0,0,${victim.unitType}`], 1);
      assert.equal(frame.controller.runtime.bail, null);
      const replacement = frame.world.entities.find(actor => actor.team === 0 && actor.unitType === victim.unitType && actor.health > 0);
      if (replacement) {
        assert.ok(collectionTick > deathTick && collectionTick < expectedRecoveryTick);
        assert.ok(recoveryTick > 0);
        assert.notEqual(replacement.key, victim.key);
        assert.equal(frame.world.commanderSlots[0], replacement.rawSlot);
        assert.equal(replacement.health, victim.maxHealth);
        assert.equal(replacement.maxHealth, victim.maxHealth);
        assert.equal(replacement.team, victim.team);
        assert.ok(replacement.tileX >= 0 && replacement.tileX < configuration.map.width);
        assert.ok(replacement.tileY >= 0 && replacement.tileY < configuration.map.height);
        assert.equal(pickupRequests.length, 1);
        context.diagnostic(JSON.stringify({ faction, deathTick, collectionTick, recoveryTick,
          replacementTick: frame.cycleCounter, originalSlot: victim.rawSlot, replacementSlot: replacement.rawSlot }));
        const secondDeath = { type: "combat-death" as const, slot: replacement.rawSlot!, generation: replacement.generation };
        frame = advance(session, { updates: [secondDeath] });
        for (let tick = 0; tick < 850; tick++) {
          assert.equal(frame.controller.runtime.statistics[`0,0,${victim.unitType}`], 2);
          assert.equal(frame.controller.runtime.bail, null);
          assert.ok(!frame.entry.commands.some(command => command.command.kind === "reinforce"
            && command.command.groups.some(group => group.unitType === victim.unitType)));
          assert.ok(!frame.world.entities.some(actor => actor.unitType === victim.unitType && actor.team === 0 && actor.health > 0));
          frame = advance(session);
        }
        assert.equal(Object.keys(session.snapshot.controller.consumedLosses).length, 2);
        const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
        assert.deepEqual(restored.checkpoint(), session.checkpoint());
        assert.deepEqual(advance(restored), advance(session));
        break;
      }
      frame = advance(session);
    }
    assert.ok(recoveryTick > 0, "Original recovery command must execute");
    assert.equal(transportHostState(session.snapshot.world).browserCasualties!.length, 2);
  }
});

test("session casualty: strict checkpoint schema and replay reject owner and identity tampering", () => {
  const session = new CampaignSession(options());
  const { commander } = readyCommander(session);
  advance(session, { updates: [{ type: "combat-death", slot: commander.rawSlot!, generation: commander.generation }] });
  const saved = session.checkpoint();
  for (const mutate of [
    (value: typeof saved) => { Reflect.deleteProperty(value.state.world, "browserCasualtyPickup"); },
    (value: typeof saved) => { Object.assign(value.state.world.browserCasualtyPickup!, { runtimeProfile: "strict-native" }); },
    (value: typeof saved) => { Object.assign(value.state.world.transportState.browserCasualties![0], { disposition: "revived" }); },
    (value: typeof saved) => { Object.assign(value.state.world.transportState.browserCasualties![0], { carrierId: 0 }); },
    (value: typeof saved) => { Object.assign(value.state.world.transportState.browserCasualties![0], { carrierId: 99 }); },
    (value: typeof saved) => { Object.assign(value.state.world.transportState.browserCasualties![0], { generation: 99 }); },
    (value: typeof saved) => { Object.assign(value.state.world.transportState.browserCasualties![0], { lossId: "invented" }); },
    (value: typeof saved) => { value.state.world.transportState.browserCasualties![0].collected = true; },
    (value: typeof saved) => { value.state.world.transportState.registry[commander.rawSlot!] = null; },
    (value: typeof saved) => { Object.assign(value.state.aiSelectorInputs!.at(-1)!, { updates: [] }); },
  ]) {
    const tampered = structuredClone(saved);
    mutate(tampered);
    assert.throws(() => CampaignSession.restore(tampered));
  }
  const strict = new CampaignSession(options("HUMAN", "01", false)).checkpoint();
  for (const inject of [
    (value: typeof strict) => { Object.assign(value.state.world, { browserCasualtyPickup: { runtimeProfile: "browser-adapted" } }); },
    (value: typeof strict) => { value.state.world.transportState.browserCasualties = []; },
    (value: typeof strict) => { value.state.world.transportState.requests.push({ type: "casualty-picked-up", slot: 152, generation: 0, carrierId: 1 }); },
  ]) {
    const tampered = structuredClone(strict);
    inject(tampered);
    assert.throws(() => CampaignSession.restore(tampered), /browser-adapted ownership/);
  }
});

test("session casualty: original M01 still loses immediately in strict and adapted profiles", () => {
  for (const faction of ["HUMAN", "ALIEN"] as const) for (const adapted of [false, true]) {
    const session = new CampaignSession(options(faction, "01", adapted));
    const { commander } = readyCommander(session);
    const frame = advance(session, { updates: [{ type: "combat-death", slot: commander.rawSlot!, generation: commander.generation }] });
    assert.equal(frame.controller.runtime.bail!.resultCode, 1);
    assert.equal(frame.controller.runtime.statistics[`0,0,${commander.unitType}`], 1);
    const host = transportHostState(session.snapshot.world);
    assert.equal(host.browserCasualties?.length ?? 0, adapted ? 1 : 0);
    assert.equal(host.registry[commander.rawSlot!], commander.key);
    assert.equal(Boolean(frame.world.browserCasualtyPickup), adapted);
    assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
  }
});

test("session casualty: original AL08 nopickup suppresses team6 but preserves scripted abduct", () => {
  const session = new CampaignSession(options("ALIEN", "08"));
  const { state, commander } = readyCommander(session);
  assert.equal(state.world.adaptedTro!.noPickup[6], 1);
  const victim = state.world.entities.find(actor => actor.team === 6 && actor.unitType >= 69 && actor.unitType <= 72)!;
  assert.ok(victim);
  const frame = advance(session, { updates: [{ type: "combat-death", slot: victim.rawSlot!, generation: victim.generation }] });
  const host = transportHostState(session.snapshot.world), casualty = host.browserCasualties![0];
  assert.equal(casualty.disposition, "suppressed");
  assert.equal(casualty.carrierId, null);
  assert.equal(frame.controller.runtime.statistics[`6,0,${victim.unitType}`], 1);
  assert.ok(frame.entry.commands.some(command => command.command.kind === "abduct"));
  assert.ok(host.reducer.carriers.some(carrier => carrier.commanderSlot === commander.rawSlot && carrier.team === 0));
  assert.ok(!host.reducer.carriers.some(carrier => carrier.commanderSlot === victim.rawSlot));
  advance(session, { updates: [{ type: "complete-removal", slot: victim.rawSlot!, generation: victim.generation }] });
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});