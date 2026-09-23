import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CampaignSession, createCampaignSession, type CampaignSessionInput, type CampaignSessionOptions,
  type CampaignSessionState } from "../../src/engine/campaign-session.ts";
import { sourceDayNightFromHeader } from "../../src/engine/source-day-night.ts";
import { transportHostState, type ResourceHostBinding, type ResourceHostOptions } from "../../src/engine/transport-host.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseScenario, type ScenarioDefinition } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

interface NativeEntity {
  id: number; type: number; status: number; hp: number; activeSlot: number; direction: number;
  task: number; taskDepth: number; taskWords: number[]; pendingOrder: number; order: number;
  animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 | 3 };
}
interface NativeVisit {
  update: number; counter: number; source: NativeEntity; extractor: NativeEntity;
  credits: number; income: number; cycles: number; tileFlag: number; ground: number;
}
interface NativeCase {
  race: number; trace: NativeVisit[]; runtimeInterceptions: string[];
  animations: ResourceHostOptions["animations"];
  profiles: { sources: { source: string; sha256: string }[]; bindings: {
    unitType: number; standBank: number; deployBank: number; deathBank: number;
    deathVariants: number; removalHoldField: number; selectedWeapon: number;
  }[] };
}

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT"));
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT"));
const sources = ["HUMAN", "ALIEN"].map((race) => parseScenario(read(`SCENARIO/${race}/${race}02.SCN`)));
const nativeTrace = JSON.parse(process.env.DC_RESOURCE_LIFECYCLE_TRACE
  ? readFileSync(process.env.DC_RESOURCE_LIFECYCLE_TRACE, "utf8")
  : execFileSync("python3", ["tools/research/resource-lifecycle-20260919.py"], {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  })) as { sha256: string; sourceHashes: Record<string, string>; cases: NativeCase[];
    lowHealth: NativeCase[]; cancellations: NativeCase[] };

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected resource session success");
  return result.value;
}

function binding(entity: NativeEntity, slot: number): ResourceHostBinding {
  return { slot, generation: 0, state: {
    direction: entity.direction, pendingOrder: entity.pendingOrder, order: entity.order,
    animation: { profile: String(entity.animation.bank), frame: entity.animation.frame,
      delay: entity.animation.delay, mode: entity.animation.mode },
    stack: [{ opcode: 1, words: entity.taskWords.slice(0, 3) }], released: false,
  } };
}

function fixture(source: ScenarioDefinition, row = source.placementRows.find((entry) => entry[2] === 40 && entry[3] > 0)!,
  owner = 0, native = nativeTrace.cases.find((entry) => entry.race === source.teams[owner].race)!): CampaignSessionOptions {
  const initial = native.trace[0];
  return {
    sessionId: `${source.id}:isolated-source:synthetic-extractor:${owner}`,
    source: { ...source, placementRows: [row, [row[0], row[1], initial.extractor.type, owner, initial.extractor.hp]] },
    units, weapons, triggers: [], messages: [], map: { width: 128, height: 128 },
    pathGrid: new Uint8Array(128 * 128).fill(1), tags: new Uint8Array(128 * 128),
    commanders: [source.teams[0].race === 0 ? { team: 0, unitType: 69, sprite: "TRSC" }
      : { team: 0, unitType: 73, sprite: "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
    resourceScales: { rateScale: 256, reserveScale: 256 }, resourceInitialIncome: Array(8).fill(0),
    resourceLifecycle: { animations: native.animations,
      types: native.profiles.bindings.map((profile) => ({ unitType: profile.unitType, stand: String(profile.standBank),
        deploy: String(profile.deployBank), death: String(profile.deathBank), deathVariants: profile.deathVariants,
        removalHoldField: profile.removalHoldField, selectedWeapon: profile.selectedWeapon | 0 })),
      bindings: [binding(initial.source, 152), binding(initial.extractor, 153)] },
  };
}

function frameSource(source: ScenarioDefinition): NonNullable<CampaignSessionInput["resourceFrameSource"]> {
  return { teams: source.teams.map(({ index, ai }) => ({ index, ai })),
    aiMultipliers: [256, 320, 384, 512, 0, 192, -256, -21474836], localTeam: 0, cancellationGate: 0 };
}

function step(session: CampaignSession, source: ScenarioDefinition, extra: Partial<CampaignSessionInput> = {}) {
  return unwrap(session.step({ clockMilliseconds: (session.snapshot.cycleCounter + 1) * 16,
    resourceFrameSource: frameSource(source), ...extra }));
}

function rejectUnchanged(session: CampaignSession, input: CampaignSessionInput, message: RegExp) {
  const before = session.snapshot;
  const journal = session.journal;
  const checkpoint = session.checkpoint();
  const result = session.step(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.diagnostics.map((entry) => entry.message).join("; "), message);
  assert.deepEqual(session.snapshot, before);
  assert.deepEqual(session.journal, journal);
  assert.deepEqual(session.checkpoint(), checkpoint);
}

test("session fixture fingerprints executable, both original SCNs and exact constructor/FIN evidence", () => {
  const digest = (path: string) => createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex");
  assert.equal(nativeTrace.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(digest("raw_cd/DC/DC.EXE"), nativeTrace.sha256);
  for (const [path, hash] of Object.entries(nativeTrace.sourceHashes)) assert.equal(digest(`raw_cd/DC/${path}`), hash, path);
  for (const race of ["HUMAN", "ALIEN"]) assert.ok(nativeTrace.sourceHashes[`SCENARIO/${race}/${race}02.SCN`]);
  for (const native of [...nativeTrace.cases, ...nativeTrace.lowHealth, ...nativeTrace.cancellations]) {
    assert.deepEqual(native.runtimeInterceptions, []);
    for (const entry of native.profiles.sources) assert.equal(digest(entry.source), entry.sha256);
  }
});

for (const source of sources) {
  test(`${source.id}: every original resource row preserves source state and credits each session update`, () => {
    for (const row of source.placementRows.filter((entry) => entry[2] === 40)) {
      const options = fixture(source, row);
      const session = unwrap(createCampaignSession(options));
      const initial = session.snapshot;
      assert.deepEqual(initial.sourceDayNight, sourceDayNightFromHeader(source.rawHeader));
      assert.deepEqual(initial.world.exomoney, Object.fromEntries(source.teams.map(({ index, money }) => [index, money])));
      const sourceEntity = initial.world.entities.find(({ rawSlot }) => rawSlot === 152)!;
      assert.deepEqual([sourceEntity.tileX, sourceEntity.tileY, sourceEntity.unitType, sourceEntity.team,
        sourceEntity.resource!.rateWord, sourceEntity.health], [row[0], row[1], 40, 8, row[3], row[4]]);
      for (let team = 0; team < 8; team += 1) assert.equal(initial.controller.runtime.statistics[`${team},1`], 0);
      if (row[3] === 0) {
        rejectUnchanged(session, { clockMilliseconds: 16, resourceFrameSource: frameSource(source) }, /general mobile idle\/wait/);
        continue;
      }
      let payouts = 0;
      for (let update = 1; update <= 48; update += 1) {
        const frame = step(session, source);
        const counter: number = initial.sourceDayNight!.elapsed + update;
        const pulse = (counter & 15) === 0 ? 1 : 0;
        payouts += pulse;
        assert.equal(frame.sourceDayNight!.elapsed, counter);
        assert.equal(transportHostState(frame.world).resourceLifecycle!.nativePhaseCounter, counter);
        assert.equal(frame.world.exomoney[0], source.teams[0].money + payouts * row[3]);
        assert.equal(frame.world.statistics["0,1"], payouts * row[3]);
        assert.equal(frame.controller.runtime.statistics["0,1"], payouts * row[3]);
        assert.equal(frame.controller.runtime.statistics["0,5"], pulse);
        assert.equal(transportHostState(frame.world).slots[152]!.health, row[4] - payouts * row[3]);
        assert.equal(frame.world.entities.find(({ rawSlot }) => rawSlot === 153)!.unitType, source.teams[0].race === 0 ? 47 : 48);
      }
    }
  });

  test(`${source.id}: actual nonlocal AI and zero colony gate consume scaled reserve without credit`, () => {
    const owner = source.teams.find(({ ai }) => ai !== 0)!.index;
    const options = fixture(source, undefined, owner);
    const session = unwrap(createCampaignSession(options));
    const initial = session.snapshot;
    const row = options.source.placementRows[0];
    let payouts = 0;
    for (let update = 1; update <= 32; update += 1) {
      const frame = step(session, source);
      if ((frame.sourceDayNight!.elapsed & 15) === 0) payouts += 1;
      const amount = Math.trunc(row[3] * frameSource(source).aiMultipliers[owner] / 256);
      assert.equal(transportHostState(frame.world).slots[152]!.health, row[4] - payouts * amount);
      assert.equal(frame.world.exomoney[owner], initial.world.exomoney[owner]);
      assert.equal(frame.controller.runtime.statistics[`${owner},1`], 0);
      assert.equal(frame.controller.runtime.statistics[`${owner},5`], 0);
      assert.equal(frame.entry.requests.some(({ type }) => type === "resource-unit-sound"), false);
    }
  });

  test(`${source.id}: JSON checkpoint in deployment replays exact state and next 100 updates`, () => {
    const options = fixture(source);
    const session = unwrap(createCampaignSession(options));
    for (let update = 0; update < 20; update += 1) step(session, source);
    assert.equal(transportHostState(session.snapshot.world).slots[153]!.resourceTask!.animation.mode, 1);
    const checkpoint = session.checkpoint();
    assert.equal(checkpoint.state.cycleCounter, 20);
    assert.equal("inputs" in checkpoint, false);
    assert.deepEqual(checkpoint.options.source.rawHeader, source.rawHeader);
    assert.deepEqual(Object.keys(checkpoint.options.map).sort(), ["height", "width"]);
    assert.ok(Array.isArray(checkpoint.options.resourceLifecycle!.animations[0].directions[0]));
    const restored = CampaignSession.restore(JSON.parse(JSON.stringify(checkpoint)));
    assert.deepEqual(restored.snapshot, session.snapshot);
    assert.deepEqual(restored.journal, []);
    for (let update = 0; update < 100; update += 1) assert.deepEqual(step(restored, source), step(session, source));
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    const missing = JSON.parse(JSON.stringify(checkpoint));
    delete missing.state.sourceDayNight;
    assert.throws(() => CampaignSession.restore(missing), /saved source clock/);
    const clock = JSON.parse(JSON.stringify(checkpoint));
    clock.state.sourceDayNight.elapsed = 1;
    assert.throws(() => CampaignSession.restore(clock), /clock does not match/);
    const blend = JSON.parse(JSON.stringify(checkpoint));
    blend.state.sourceDayNight.blend = (blend.state.sourceDayNight.blend + 1) % 257;
    assert.throws(() => CampaignSession.restore(blend), /clock blend/);
    const profile = JSON.parse(JSON.stringify(checkpoint));
    profile.state.world.transportState.resourceLifecycle.animations[0].directions[0][0] ^= 1;
    assert.throws(() => CampaignSession.restore(profile), /source profiles/);
    const payload = JSON.parse(JSON.stringify(checkpoint));
    payload.state.world.transportState.slots[153].resourceTask.stack.at(-1).words[0] = 799;
    assert.throws(() => CampaignSession.restore(payload), /payload/);
    assert.throws(() => CampaignSession.restore({ ...checkpoint, inputs: [] }), /unknown field/);
  });
}

test("opt-in admission requires explicit clock, incomes, money, FIN banks and task bindings", () => {
  const source = sources[0];
  const options = fixture(source);
  for (const invalid of [
    { resourceInitialIncome: undefined }, { resourceInitialIncome: [0] }, { resourceInitialIncome: Array(8).fill(2147483648) },
    { source: { ...options.source, rawHeader: undefined } }, { source: { ...options.source, rawHeader: [] } },
    { source: { ...options.source, teams: options.source.teams.map((team) => ({ ...team, money: undefined })) } },
    { resourceLifecycle: { ...options.resourceLifecycle!, bindings: [] } },
    { resourceLifecycle: { ...options.resourceLifecycle!, animations: [] } },
  ]) assert.equal(createCampaignSession({ ...options, ...invalid }).ok, false);
  const ordinary = unwrap(createCampaignSession({ ...options, resourceLifecycle: undefined }));
  assert.equal(ordinary.snapshot.sourceDayNight, undefined);
  rejectUnchanged(ordinary, { clockMilliseconds: 16 }, /lifecycle are not integrated/);
  rejectUnchanged(ordinary, { clockMilliseconds: 16, resourceFrameSource: frameSource(source) }, /opt-in/);
  const session = unwrap(createCampaignSession(options));
  rejectUnchanged(session, { clockMilliseconds: 16 }, /complete native frame source/);
  rejectUnchanged(session, { clockMilliseconds: 16, resourceFrameSource: { ...frameSource(source), aiMultipliers: [] } }, /multipliers/);
});

test("source phase boundary, full32 income wrap and live AI inputs do not use trigger ticks", () => {
  const source = sources[0];
  const options = fixture(source);
  const session = unwrap(createCampaignSession({ ...options, resourceInitialIncome: Array(8).fill(2147483647),
    source: { ...options.source, rawHeader: [source.rawHeader[0], "0", "64", "63", "16"] } }));
  const input = { ...frameSource(source), teams: source.teams.map(({ index, ai }) => ({ index, ai: index === 0 ? 1 : ai })),
    aiMultipliers: Array(8).fill(512), localTeam: 1 };
  const rate = options.source.placementRows[0][3] * 2;
  const first = step(session, source, { resourceFrameSource: input });
  assert.equal(first.cycleCounter, 1);
  assert.equal(first.sourceDayNight!.elapsed, 64);
  assert.equal(first.world.exomoney[0], source.teams[0].money + rate);
  assert.equal(first.controller.runtime.statistics["0,1"], (2147483647 + rate) | 0);
  assert.equal(first.entry.requests.some(({ type }) => type === "resource-unit-sound"), false);
  const rollover = step(session, source, { resourceFrameSource: input });
  assert.deepEqual(rollover.sourceDayNight, { phase: 1, cycleLength: 64, elapsed: 0, transitionTicks: 16, blend: 0 });
  assert.equal(rollover.world.exomoney[0], source.teams[0].money + rate * 2);
  assert.equal(rollover.controller.runtime.statistics["0,5"], 1);
  assert.equal(step(session, source).controller.runtime.statistics["0,5"], 0);
});

test("colony death refreshes HP before settlement and full32 HP 65536 remains a credit gate", () => {
  const source = sources[0];
  const options = fixture(source);
  const teams = options.source.teams.map((team) => team.index !== 0 ? team : { ...team,
    cityRows: team.cityRows.map((row, index) => index === 0 ? [row[0], 65536, ...row.slice(2)] : row) });
  const configured = { ...options, source: { ...options.source, teams,
    rawHeader: [source.rawHeader[0], "0", "64", "15", "16"] } };
  const alive = step(unwrap(createCampaignSession(configured)), source);
  assert.equal(alive.world.buildingSlots["0,0"], 65536);
  assert.equal(alive.controller.runtime.statistics["0,1"], options.source.placementRows[0][3]);
  const session = unwrap(createCampaignSession(configured));
  const dead = step(session, source, { updates: [{ type: "combat-death", slot: 0, generation: 0 }] });
  assert.equal(dead.world.buildingSlots["0,0"], 0);
  assert.equal(dead.world.exomoney[0], source.teams[0].money);
  assert.equal(dead.controller.runtime.statistics["0,1"], 0);
  assert.equal(dead.controller.runtime.statistics["0,5"], 0);
  assert.equal(transportHostState(dead.world).slots[152]!.health,
    options.source.placementRows[0][4] - options.source.placementRows[0][3]);
});

function assertNativeState(state: CampaignSessionState, visit: NativeVisit, initialMoney: number, initialNativeMoney: number) {
  const host = transportHostState(state.world);
  for (const expected of [visit.source, visit.extractor]) {
    const record = host.slots[expected.id]!;
    const label = `update ${visit.update} slot ${expected.id}`;
    assert.deepEqual([record.unitType, record.status, record.health >>> 0], [expected.type, expected.status, expected.hp], label);
    assert.equal(host.registry[expected.id] === null, expected.activeSlot === 65535, label);
    const task = record.resourceTask!;
    assert.deepEqual([task.direction, task.pendingOrder, task.order, task.stack.length - 1, task.stack.at(-1)!.opcode],
      [expected.direction, expected.pendingOrder, expected.order, expected.taskDepth, expected.task], label);
    assert.deepEqual(record.taskWords, expected.taskWords.slice(0, record.taskWords.length), label);
    assert.deepEqual(task.animation, { profile: String(expected.animation.bank), frame: expected.animation.frame,
      delay: expected.animation.delay, mode: expected.animation.mode }, label);
    const bytes = state.world.entityBytes!;
    const offset = expected.id * 220;
    const payload = bytes[offset + 0x3a + expected.taskDepth * 2];
    assert.equal(bytes[offset + 0x38], expected.taskDepth, label);
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset + 0x46 + payload * 2, true), record.taskWords[0], label);
  }
  assert.equal(state.world.exomoney[0], initialMoney + visit.credits - initialNativeMoney);
  assert.equal(state.controller.runtime.statistics["0,1"], visit.income);
  assert.equal(state.controller.runtime.statistics["0,5"], visit.cycles);
  assert.equal(state.world.statistics["0,1"], visit.income);
  assert.equal(host.resourceTileFlags[5 * 128 + 5], visit.tileFlag);
  assert.equal(host.ground[5 * 128 + 5], visit.ground === 1023 ? -1 : visit.ground);
}

for (const source of sources) test(`${source.id}: exact native low-HP fixture settles, depletes and unregisters on removal visit 150`, () => {
  const native = nativeTrace.lowHealth.find(({ race }) => race === source.teams[0].race)!;
  const options = fixture(source, [5, 5, 40, 22, native.trace[0].source.hp], 0, native);
  let session = unwrap(createCampaignSession({ ...options,
    source: { ...options.source, rawHeader: [source.rawHeader[0], "0", "6300", "0", "75"] } }));
  let removingAt = -1;
  for (const visit of native.trace.slice(1)) {
    const frame = step(session, source);
    assertNativeState(frame, visit, source.teams[0].money, native.trace[0].credits);
    const host = transportHostState(frame.world);
    if (host.slots[152]!.status === 10 && removingAt < 0) {
      removingAt = visit.update;
      assert.equal(host.slots[152]!.taskWords[0], 0);
      rejectUnchanged(session, { clockMilliseconds: 999, resourceFrameSource: frameSource(source),
        updates: [{ type: "complete-removal", slot: 152, generation: 0 }] }, /Resource-owned updates/);
    }
    if (visit.update === removingAt + 149) assert.equal(host.slots[152]!.status, 10);
    if (host.slots[152]!.status === 0) assert.equal(visit.update - removingAt, 150);
    assert.equal(frame.entry.requests.some(({ type }) => type === "combat-death"), false);
    if (visit.update === removingAt + 20) {
      const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
      assert.deepEqual(restored.snapshot, session.snapshot);
      session = restored;
    }
  }
  assert.ok(removingAt > 0);
  const finished = step(session, source);
  assert.equal(finished.world.entities.some(({ rawSlot }) => rawSlot === 152 || rawSlot === 153), false);
  assert.deepEqual(transportHostState(finished.world).slots[152]!.taskWords, [150, 0]);
});

test("pending cancellation respects mode gate and released mobile idle continuation remains unsupported", () => {
  const source = sources[0];
  const session = unwrap(createCampaignSession(fixture(source)));
  step(session, source);
  const orders = [{ slot: 153, generation: 0, pendingOrder: 1, order: 13 }];
  const gated = step(session, source, { resourceFrameSource: { ...frameSource(source), cancellationGate: 1, orders } });
  assert.equal(transportHostState(gated.world).slots[153]!.task, "extraction");
  assert.equal(transportHostState(gated.world).slots[153]!.resourceTask!.pendingOrder, 1);
  const cancelled = step(session, source);
  assert.deepEqual(transportHostState(cancelled.world).slots[153]!.taskWords, [50]);
  assert.equal(transportHostState(cancelled.world).slots[153]!.resourceTask!.pendingOrder, 0);
  assert.equal(transportHostState(cancelled.world).slots[153]!.resourceTask!.order, 255);
  let released = false;
  for (let update = 0; update < 100 && !released; update += 1) {
    const frame = step(session, source);
    released = frame.entry.requests.some(({ type }) => type === "resource-task-released");
  }
  assert.equal(released, true);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.deepEqual(restored.snapshot, session.snapshot);
  rejectUnchanged(session, { clockMilliseconds: 999, resourceFrameSource: frameSource(source) }, /general mobile idle continuation/);
  rejectUnchanged(restored, { clockMilliseconds: 999, resourceFrameSource: frameSource(source),
    updates: [{ type: "combat-death", slot: 153, generation: 0 }] }, /Resource-owned updates/);
});

test("host, trigger and post-dispatch failures roll back clock, funds, requests and replay history", () => {
  const source = sources[0];
  const options = fixture(source);
  const session = unwrap(createCampaignSession(options));
  rejectUnchanged(session, { clockMilliseconds: 16, resourceFrameSource: { ...frameSource(source),
    orders: [{ slot: 153, generation: 99, pendingOrder: 1, order: 13 }] } }, /Stale or invalid resource order/);
  rejectUnchanged(session, { clockMilliseconds: 16, resourceFrameSource: frameSource(source),
    reservations: [{ slot: 799, generation: 0, tileX: 0, tileY: 0 }] }, /Invalid reservation unit/);
  const first = step(session, source);
  assert.equal(first.entry.requests.filter(({ type }) => type === "resource-unit-sound").length, 1);
  for (const update of [
    { type: "position" as const, slot: 153, generation: 0, position: { x: 128, y: 128 } },
    { type: "combat-death" as const, slot: 153, generation: 0 },
    { type: "complete-removal" as const, slot: 152, generation: 0 },
  ]) rejectUnchanged(session, { clockMilliseconds: 32, resourceFrameSource: frameSource(source), updates: [update] }, /Resource-owned updates/);
  const row = options.source.placementRows[0];
  const triggered = unwrap(createCampaignSession({ ...options,
    source: { ...options.source, rawHeader: [source.rawHeader[0], "0", "6300", "8", "75"] },
    triggers: parseTriggerScript(`1 norm 1 (c==0)\nnewtype ${row[0]} ${row[1]} 84\nend\n`) }));
  for (let update = 0; update < 7; update += 1) step(triggered, source);
  rejectUnchanged(triggered, { clockMilliseconds: 128, resourceFrameSource: frameSource(source) }, /resource-owned task|resource lifecycle is unsupported/);
});