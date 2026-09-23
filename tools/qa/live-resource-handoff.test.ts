import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignResourceHandoff, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { sourceResourceProfiles } from "../../src/engine/source-resource-options";
import { transportHostState, type ResourceHostBinding } from "../../src/engine/transport-host";

const generated = new URL("../../public/assets/generated/", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, generated)).toString());
const source = json("data/scenarios/HUMAN/HUMAN02.json");
const originalBytes = readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN", import.meta.url));
const originalHash = createHash("sha256").update(originalBytes).digest("hex");
const sourceRow = source.placementRows.find((row: number[]) => row[2] === 40 && row[3] === 22);
const metadata = Object.fromEntries(["VENT", "EXPL", "SLUG"].map((stem) => [stem, json(`animations/${stem}.json`)]));
const profiles = sourceResourceProfiles(metadata as Parameters<typeof sourceResourceProfiles>[0]);
const frameSource = { teams: source.teams.map(({ index }: { index: number }) => ({ index, ai: 0 })),
  aiMultipliers: Array(8).fill(256), localTeam: 0, cancellationGate: 0 };
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));

function fixture(race: 0 | 1, sourceFirst = true) {
  assert.equal(originalHash, source.source.sha256);
  assert.deepEqual(sourceRow, [69, 48, 40, 22, 12000]);
  const sourceSlot = sourceFirst ? 152 : 153, mobileSlot = sourceFirst ? 153 : 152;
  const binding = (slot: number, profile: string, direction: number): ResourceHostBinding => ({ slot, generation: 0,
    state: { direction, animation: { profile, frame: 0, delay: 0, mode: 0 }, pendingOrder: 0, order: 0,
      released: false, stack: [{ opcode: 1, words: [65535, 0, 0] }] } });
  const mobile = binding(mobileSlot, race === 0 ? "EXPLSTAND" : "SLUGSTAND", race === 0 ? 160 : 128);
  const mobileRow = [sourceRow[0], sourceRow[1], race === 0 ? 6 : 14, 0, 800];
  const map = json("maps/HUMAN/HUMAN02.json");
  const pathGrid = Uint8Array.from(readFileSync(new URL(`maps/HUMAN/${map.files.pathGrid}`, generated)));
  const options: CampaignSessionOptions = {
    sessionId: `EXPLICIT-SYNTHETIC-SAME-TILE-HANDOFF-${race}-${sourceFirst}`,
    source: { id: source.id, rawHeader: source.rawHeader, placementRows: sourceFirst ? [sourceRow, mobileRow] : [mobileRow, sourceRow],
      teams: source.teams.map((team: object) => ({ ...team, race })) },
    units: json("data/units.json").records, weapons: json("data/weapons.json").records,
    triggers: [], messages: [], map: { width: 96, height: 84 }, pathGrid, tags: new Uint8Array(96 * 84),
    commanders: [{ team: 0, unitType: race === 0 ? 69 : 73, sprite: race === 0 ? "TRSC" : "GRAY" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1,
    resourceScales: { rateScale: 256, reserveScale: 256 }, resourceInitialIncome: Array(8).fill(0),
    resourceLifecycle: { ...profiles, bindings: [binding(sourceSlot, "VENTSTAND", 0)] },
  };
  return { session: new CampaignSession(options), mobile, mobileSlot, sourceSlot };
}

function transfer(session: CampaignSession, slot: number, action: CampaignResourceHandoff["action"],
  state: CampaignResourceHandoff["state"]): CampaignResourceHandoff {
  const world = session.snapshot.world;
  return { action, evidence: "explicit synthetic constructor/native resource release fixture; not movement admission",
    expected: transportHostState(world).slots[slot]!,
    rawEntity: Array.from(world.entityBytes!.slice(slot * 220, (slot + 1) * 220)), state };
}

function step(session: CampaignSession, resourceHandoffs?: readonly CampaignResourceHandoff[]) {
  return session.step({ clockMilliseconds: (session.snapshot.cycleCounter + 1) * 50,
    resourceFrameSource: frameSource, ...(resourceHandoffs ? { resourceHandoffs } : {}) });
}

test("incoming source binding rejects stale identity, raw state, duplicate slots and unknown task fields atomically", () => {
  const { session, mobile, mobileSlot } = fixture(0);
  const handoff = transfer(session, mobileSlot, "bind", mobile.state);
  for (const alter of [
    (entry: CampaignResourceHandoff) => { entry.expected.generation++; },
    (entry: CampaignResourceHandoff) => { entry.expected.key += "stale"; },
    (entry: CampaignResourceHandoff) => { Object.assign(entry.expected.position, { x: entry.expected.position.x + 1 }); },
    (entry: CampaignResourceHandoff) => { (entry.rawEntity as number[])[9]++; },
    (entry: CampaignResourceHandoff) => { Object.assign(entry.state, { unknown: true }); },
    (entry: CampaignResourceHandoff) => { entry.state.pendingOrder = 1; },
  ]) {
    const saved = session.checkpoint(), journal = session.journal;
    const changed = clone(handoff); alter(changed);
    assert.equal(step(session, [changed]).ok, false);
    assert.deepEqual(session.checkpoint(), saved);
    assert.deepEqual(session.journal, journal);
  }
  const saved = session.checkpoint();
  assert.equal(step(session, [handoff, handoff]).ok, false);
  assert.deepEqual(session.checkpoint(), saved);
  assert.equal(session.step({ clockMilliseconds: 50, resourceHandoffs: [handoff],
    resourceFrameSource: { ...frameSource, aiMultipliers: [] } }).ok, false);
  assert.deepEqual(session.checkpoint(), saved, "later frame failure rolls back a valid binding");
});

for (const race of [0, 1] as const) {
  test(`race ${race}: incoming bind, canonical income, deployed restore, cancellation and exact idle release`, () => {
    const { session, mobile, mobileSlot, sourceSlot } = fixture(race);
    const bound = step(session, [transfer(session, mobileSlot, "bind", mobile.state)]);
    assert.ok(bound.ok, JSON.stringify(bound));
    for (let update = 1; update < 48; update++) assert.ok(step(session).ok);
    const host = transportHostState(session.snapshot.world);
    assert.equal(host.slots[mobileSlot]!.unitType, race === 0 ? 47 : 48);
    assert.equal(host.slots[sourceSlot]!.team, 8);
    assert.ok(session.snapshot.world.statistics["0,1"] > 0);
    assert.equal(session.snapshot.world.exomoney[0], source.teams[0].money + session.snapshot.world.statistics["0,1"]);
    const restored = CampaignSession.restore(clone(session.checkpoint()));
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    const bad = clone(session.checkpoint());
    (bad.state.world.entityBytes as number[])[mobileSlot * 220 + 9] ^= 1;
    assert.throws(() => CampaignSession.restore(bad), /raw resource/);
    const beforeCancel = session.checkpoint();
    const cancel = (generation: number) => ({ clockMilliseconds: (session.snapshot.cycleCounter + 1) * 50,
      resourceFrameSource: { ...frameSource, orders: [{ slot: mobileSlot, generation, pendingOrder: 1, order: 13 }] } });
    assert.equal(session.step(cancel(1)).ok, false);
    assert.deepEqual(session.checkpoint(), beforeCancel);
    const cancellation = cancel(0);
    assert.deepEqual(session.step(cancellation), restored.step(cancellation));
    for (let visits = 0; !transportHostState(session.snapshot.world).slots[mobileSlot]!.resourceTask!.released; visits++) {
      assert.ok(visits < 80);
      assert.deepEqual(step(session), step(restored));
    }
    const released = transportHostState(session.snapshot.world).slots[mobileSlot]!;
    assert.equal(released.unitType, race === 0 ? 6 : 14);
    const beforeRelease = session.checkpoint();
    assert.equal(step(session).ok, false, "released host must be acknowledged before another visit");
    assert.deepEqual(session.checkpoint(), beforeRelease);
    const handoff = transfer(session, mobileSlot, "release", released.resourceTask!);
    const wrong = clone(handoff); wrong.state.direction ^= 1;
    assert.equal(step(session, [wrong]).ok, false);
    assert.deepEqual(session.checkpoint(), beforeRelease);
    assert.equal(session.step({ clockMilliseconds: 2500, resourceHandoffs: [handoff],
      resourceFrameSource: { ...frameSource, aiMultipliers: [] } }).ok, false);
    assert.deepEqual(session.checkpoint(), beforeRelease);
    assert.deepEqual(step(session, [handoff]), step(restored, [handoff]));
    const returned = transportHostState(session.snapshot.world).slots[mobileSlot]!;
    assert.equal(returned.resourceTask, undefined);
    assert.equal(returned.key, released.key);
    assert.equal(returned.generation, released.generation);
    assert.deepEqual(returned.position, released.position);
    assert.equal(returned.task, "unit");
    assert.deepEqual(CampaignSession.restore(clone(session.checkpoint())).checkpoint(), session.checkpoint());
    assert.equal(transportHostState(session.snapshot.world).directionCursor, 0);
  });

  test(`race ${race}: mobile-first idle and proven movement wait stack remain explicit atomic host gates`, () => {
    const { session, mobile, mobileSlot } = fixture(race, false);
    const saved = session.checkpoint();
    const bound = step(session, [transfer(session, mobileSlot, "bind", mobile.state)]);
    assert.equal(bound.ok, false);
    if (!bound.ok) assert.match(bound.diagnostics[0].message, /general mobile idle\/wait/);
    assert.deepEqual(session.checkpoint(), saved);
    const nativeWait = clone(mobile.state);
    Object.assign(nativeWait, { stack: [{ opcode: 1, words: [65535, 800, 0] }, { opcode: 3, words: [7, 800] }] });
    assert.equal(step(session, [transfer(session, mobileSlot, "bind", nativeWait)]).ok, false);
    assert.deepEqual(session.checkpoint(), saved, "never truncate the proven native wait task");
  });
}

test("original source SCN bytes remain unchanged", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN", import.meta.url)))
    .digest("hex"), originalHash);
});