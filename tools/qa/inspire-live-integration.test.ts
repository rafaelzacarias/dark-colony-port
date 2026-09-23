import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NavigationGrid } from "../../src/engine/grid";
import { LEGACY_INSPIRE_NATIVE_RANDOM_TABLE, verifiedLegacyInspireDeployFin } from "../../src/engine/legacy-inspire";
import { VERIFIED_NATIVE_ORDINARY_COEFFICIENTS } from "../../src/engine/legacy-balance";
import { DeterministicSimulation, type NativeInspireAdapter, type NativeInspireIdentity,
  type NativeInspireRegistration } from "../../src/engine/simulation";
import { parseFin } from "../extractors/animations/fin";
import { parseUnitStats } from "../extractors/data/tables";

const source = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
const sourceHash = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b";

function fixture(options: { charge?: number; typeId?: number; elapsed?: number; cycle?: number;
  recipientsFirst?: boolean; recipientTimer?: number } = {}) {
  const ground = new Uint32Array(9).fill(1023);
  const air = new Uint16Array(9).fill(1023);
  const order: NativeInspireIdentity[] = [];
  const shared = { randomIndex: 0 };
  const transitions: { slot: number; task: string; charge: number }[] = [];
  const adapter: NativeInspireAdapter = {
    readRegisteredOrder: () => order,
    readPositionQ8: () => ({ xQ8: 384, yQ8: 384 }),
    readOccupancy: () => ({ width: 3, height: 3, ground, air }),
    readRandomIndex: () => shared.randomIndex,
    commitRandomIndex: (index) => { shared.randomIndex = index; },
    afterEntityUpdate: () => {},
    onTaskTransition: (identity, task) => {
      const state = sim.snapshot.nativeInspire!.find((entry) => entry.slot === identity.slot)!;
      transitions.push({ slot: identity.slot, task, charge: state.charge });
    },
  };
  const sim = new DeterministicSimulation(new NavigationGrid(4, 4), {
    sourceDayNightHeader: ["0", "0", String(options.cycle ?? 10000), String(options.elapsed ?? 1), "1"],
    nativeInspire: adapter,
  });
  const caster = sim.addUnit({ faction: "human", team: 1, cell: { x: 0, y: 0 }, maxHealth: 800 });
  const recipient = sim.addUnit({ faction: "human", team: 1, cell: { x: 1, y: 1 }, weapon: {
    damage: 100, cooldownTicks: 1, rangeCells: 4, sourceDamage: {
      mode: "verified-native-ordinary", coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS,
      sourceTypeIndex: 0, sourceTypeFaction: 0, weaponId: 1,
    },
  } });
  const register = (registration: NativeInspireRegistration) => {
    sim.registerNativeInspireEntity(registration);
    order.push({ slot: registration.slot, generation: registration.generation });
  };
  const typeId = options.typeId ?? 69;
  register({ slot: 152, generation: 1, unitId: caster, typeId, team: 1, primaryWeapon: 5,
    multiplierQ8: typeId === 70 ? 358 : 332, charge: options.charge ?? 255, timer: 0, casterSlot: 0 });
  register({ slot: 153, generation: 1, unitId: recipient, typeId: 0, team: 1, primaryWeapon: 1,
    multiplierQ8: 0, charge: 64, timer: options.recipientTimer ?? 0, casterSlot: 152 });
  if (options.recipientsFirst) order.reverse();
  ground[4] = 153;
  const cast = () => sim.queue({ type: "inspire", unitIds: [caster], team: 1 });
  return { sim, caster, recipient, cast, shared, ground, air, order, transitions, register, adapter };
}

test("live RNG table matches all 256 executable dwords at 0x478e04", () => {
  const executable = source("DC.EXE");
  assert.equal(createHash("sha256").update(executable).digest("hex"), sourceHash);
  const pe = executable.readUInt32LE(60);
  const optional = pe + 24;
  const imageBase = executable.readUInt32LE(optional + 28);
  const sections = optional + executable.readUInt16LE(pe + 20);
  let found = false;
  for (let index = 0; index < executable.readUInt16LE(pe + 6); index++) {
    const section = sections + index * 40;
    const relative = 0x478e04 - imageBase - executable.readUInt32LE(section + 12);
    if (relative < 0 || relative + 1024 > executable.readUInt32LE(section + 16)) continue;
    const start = executable.readUInt32LE(section + 20) + relative;
    assert.deepEqual(LEGACY_INSPIRE_NATIVE_RANDOM_TABLE,
      Array.from({ length: 256 }, (_, index) => executable.readUInt32LE(start + index * 4)));
    found = true;
  }
  assert.ok(found);
});

test("real FIN stand fallback is one frame; shared higher-level FINs do not widen activation", () => {
  const rows = parseUnitStats(source("GAMESTAT/GAMESTAT.TXT").toString("ascii"));
  for (const [typeId, stem] of [[69, "TRSC"], [73, "GRAY"]] as const) {
    assert.equal(verifiedLegacyInspireDeployFin(typeId), stem);
    const fin = parseFin(source(`ANIMATE/${stem}.FIN`));
    const states = fin.states.filter((state) => state.name.startsWith(`${stem}STAND`));
    assert.equal(states.length, 8);
    assert.ok(states.every((state) => state.validRange && state.firstTimelineIndex === state.lastTimelineIndex));
    assert.ok(fin.states.every((state) => !state.name.includes("DEPLOY")));
    for (let level = 0; level < 4; level++) assert.equal(rows[typeId + level].sprite, stem);
  }
  for (const typeId of [0, 70, 71, 72, 74, 75, 76]) assert.equal(verifiedLegacyInspireDeployFin(typeId), null);
});

test("selected command waits two entity updates for both verified caster types", () => {
  for (const typeId of [69, 73]) {
    const { sim, caster, recipient, cast, shared } = fixture({ typeId });
    const randomState = sim.random.state;
    cast();
    assert.equal(sim.nativeInspireState(caster)!.animationMode, 0);
    sim.advance();
    assert.equal(sim.nativeInspireState(caster)!.animationMode, 1);
    assert.equal(sim.nativeInspireState(caster)!.charge, 255);
    assert.equal(sim.nativeInspireState(recipient)!.timer, 0);
    sim.advance();
    assert.deepEqual(sim.inspireEvents.map((event) => event.type), ["continue", "clear", "effect"]);
    const scan = sim.inspireEvents.at(-1)!.scan!;
    assert.deepEqual(scan.writes.map((write) => write.timer), [34, 21, 31, 31]);
    assert.equal(scan.writes.length, 4);
    assert.equal(scan.coordinateVisits, 1804);
    assert.equal(shared.randomIndex, 4);
    assert.equal(sim.nativeInspireState(recipient)!.casterSlot, 152);
    assert.equal(sim.nativeInspireState(caster)!.charge, 0);
    assert.equal(sim.random.state, randomState);
  }
});

test("UI charge >32 differs from executor >=32; charge is not cleared on rejection", () => {
  for (const charge of [0, 31, 32, 33, 254, 255]) {
    const { sim, caster, cast } = fixture({ charge });
    const snapshot = sim.nativeInspireState(caster)!;
    assert.equal(snapshot.uiChargeReady, charge > 32);
    assert.equal(snapshot.deployChargeReady, charge >= 32);
    cast();
    sim.advance();
    assert.equal(sim.nativeInspireState(caster)!.animationMode, charge >= 32 ? 1 : 0);
    assert.equal(sim.nativeInspireState(caster)!.charge, charge);
    sim.advance();
    assert.equal(sim.nativeInspireState(caster)!.charge, charge >= 32 ? 0 : charge);
  }
});

test("native scan uses same-team armed targets, excludes caster, and keeps duplicate ground/air writes", () => {
  const { sim, caster, recipient, cast, ground, air, register } = fixture();
  register({ slot: 154, generation: 1, unitId: null, typeId: 0, team: 2, primaryWeapon: 1,
    multiplierQ8: 0, charge: 0, timer: 0, casterSlot: 0 });
  register({ slot: 155, generation: 1, unitId: null, typeId: 0, team: 1, primaryWeapon: -1,
    multiplierQ8: 0, charge: 0, timer: 0, casterSlot: 0 });
  ground[0] = 152;
  ground[1] = 154;
  air[1] = 155;
  air[4] = 0x400 | 153;
  cast();
  sim.advance();
  sim.advance();
  const scan = sim.inspireEvents.at(-1)!.scan!;
  assert.deepEqual(scan.writes.map((write) => write.targetSlot), Array(6).fill(153));
  assert.deepEqual(scan.writes.map((write) => write.timer), [34, 21, 31, 31, 31, 22]);
  assert.equal(scan.coordinateVisits, 83);
  assert.equal(scan.remainingBudget, 0);
  assert.equal(sim.nativeInspireState(caster)!.timer, 0);
  assert.equal(sim.nativeInspireState(recipient)!.timer, 22);
  assert.ok(sim.snapshot.nativeInspire!.filter((entry) => entry.slot >= 154).every((entry) => entry.timer === 0));
});

test("queued stop continues before clear and cannot cancel the committed effect", () => {
  const { sim, caster, cast, transitions } = fixture();
  cast();
  sim.advance();
  sim.queue({ type: "stop", unitIds: [caster] });
  sim.advance();
  assert.deepEqual(sim.inspireEvents.map((event) => [event.type, event.charge]),
    [["continue", 255], ["clear", 0], ["effect", 0]]);
  assert.deepEqual(transitions.map((entry) => [entry.task, entry.charge]), [["deploy", 255], ["idle", 255]]);
  sim.advance();
  assert.equal(sim.inspireEvents.length, 0);
});

test("queued redeploy schedules at old charge, then completes at zero on update three", () => {
  const { sim, caster, recipient, cast, shared, transitions } = fixture();
  cast();
  sim.advance();
  cast();
  sim.advance();
  assert.deepEqual(sim.inspireEvents.map((event) => [event.type, event.charge]),
    [["continue", 255], ["deploy", 255], ["clear", 0], ["effect", 0]]);
  assert.equal(sim.nativeInspireState(caster)!.animationMode, 1);
  sim.advance();
  assert.deepEqual(sim.inspireEvents.map((event) => event.type), ["continue", "clear", "effect"]);
  assert.equal(shared.randomIndex, 8);
  assert.equal(sim.nativeInspireState(recipient)!.timer, 24);
  assert.deepEqual(transitions.map((entry) => [entry.task, entry.charge]), [["deploy", 255], ["deploy", 255], ["idle", 0]]);
});

test("source elapsed reset includes zero, and entity order controls same-update timer decrement", () => {
  for (const recipientsFirst of [false, true]) {
    const { sim, caster, recipient, cast } = fixture({ elapsed: 46, cycle: 47, recipientsFirst });
    cast();
    sim.advance();
    sim.advance();
    assert.equal(sim.sourceDayNight!.elapsed, 0);
    assert.equal(sim.sourceDayNight!.phase, 1);
    assert.equal(sim.nativeInspireState(recipient)!.timer, recipientsFirst ? 31 : 30);
    assert.equal(sim.nativeInspireState(caster)!.charge, 0);
  }
  const { sim, caster, recipient } = fixture({ elapsed: 47, cycle: 47, charge: 31, recipientTimer: 1 });
  sim.advance();
  assert.equal(sim.nativeInspireState(caster)!.charge, 32);
  assert.equal(sim.nativeInspireState(recipient)!.timer, 0);
  assert.equal(sim.nativeInspireState(recipient)!.casterSlot, 152);
  assert.equal(sim.nativeInspireState(recipient)!.liveMultiplierQ8, 256);
  assert.equal(sim.nativeInspireState(recipient)!.centersAim, false);
});

test("32-counter recharge and 16-counter duration do not use generic ticks", () => {
  const { sim, caster, recipient } = fixture({ elapsed: 15, charge: 0, recipientTimer: 35 });
  sim.advance();
  assert.equal(sim.nativeInspireState(caster)!.charge, 0);
  assert.equal(sim.nativeInspireState(recipient)!.timer, 34);
  for (let count = 0; count < 16; count++) sim.advance();
  assert.equal(sim.nativeInspireState(caster)!.charge, 1);
  assert.equal(sim.nativeInspireState(recipient)!.timer, 33);
  for (let count = 0; count < 32 * 32; count++) sim.advance();
  assert.equal(sim.nativeInspireState(caster)!.charge, 33);
  assert.equal(sim.nativeInspireState(recipient)!.timer, 0);
});

test("verified base hit reads retained caster record, then new generation at the same slot", () => {
  const { sim, caster, recipient, cast, order } = fixture();
  const enemy = sim.addUnit({ faction: "alien", team: 2, cell: { x: 2, y: 1 }, maxHealth: 1000,
    sourceDefense: { sourceTypeIndex: 0, targetClass: 0, armorFactor: 256 } });
  cast();
  sim.advance();
  sim.advance();
  sim.queue({ type: "attack", unitIds: [recipient], targetId: enemy });
  sim.advance();
  assert.equal(sim.combatEvents[0].damage, 32);
  assert.deepEqual(sim.sourceDamageDiagnostics, []);
  sim.removeUnit(caster);
  order.splice(order.findIndex((entry) => entry.slot === 152), 1);
  sim.advance();
  assert.equal(sim.combatEvents[0].damage, 32);
  const retainedTimer = sim.nativeInspireState(recipient)!.timer;
  sim.registerNativeInspireEntity({ slot: 152, generation: 2, unitId: null, typeId: 0, team: 2,
    primaryWeapon: 1, multiplierQ8: 0, charge: 64, timer: 0, casterSlot: 0 });
  assert.equal(sim.nativeInspireState(recipient)!.liveMultiplierQ8, 0);
  assert.equal(sim.nativeInspireState(recipient)!.timer, retainedTimer);
  sim.advance();
  assert.equal(sim.combatEvents[0].damage, 0);
  assert.deepEqual(sim.sourceDamageDiagnostics, []);
});

test("missing adapter/order, stale generation, unsupported FIN/actions and foreign selection fail closed", () => {
  const plain = new DeterministicSimulation(new NavigationGrid(2, 2));
  plain.queue({ type: "inspire", unitIds: [], team: 1 });
  assert.throws(() => plain.advance(), /adapter/);
  const absent = fixture();
  absent.order.length = 0;
  assert.throws(() => absent.sim.advance(), /incomplete/);
  const stale = fixture();
  stale.order[0] = { slot: 152, generation: 0 };
  assert.throws(() => stale.sim.advance(), /stale/);
  const unsupported = fixture({ typeId: 70 });
  unsupported.cast();
  unsupported.sim.advance();
  assert.equal(unsupported.sim.inspireEvents[0].reason, "unsupported-native-inspire-type-or-task");
  const busy = fixture();
  busy.cast();
  busy.sim.advance();
  busy.sim.queue({ type: "move", unitIds: [busy.caster], target: { x: 1, y: 0 } });
  assert.throws(() => busy.sim.advance(), /unsupported command/);
  const foreign = fixture();
  foreign.sim.queue({ type: "inspire", unitIds: [foreign.caster, foreign.recipient], team: 2 });
  foreign.sim.advance();
  assert.equal(foreign.sim.inspireEvents.length, 0);
});

test("caster death keeps its type multiplier; same-generation type changes are read live", () => {
  const { sim, caster, recipient, cast } = fixture();
  cast();
  sim.advance();
  sim.advance();
  const killer = sim.addUnit({ faction: "alien", team: 2, cell: { x: 0, y: 1 },
    weapon: { damage: 800, rangeCells: 4, cooldownTicks: 1 } });
  sim.queue({ type: "attack", unitIds: [killer], targetId: caster });
  sim.advance();
  assert.equal(sim.snapshot.units.find((unit) => unit.id === caster)!.activity, "die");
  assert.ok(sim.nativeInspireState(recipient)!.timer > 0);
  assert.equal(sim.nativeInspireState(recipient)!.liveMultiplierQ8, 332);
  sim.updateNativeInspireType({ slot: 152, generation: 1 }, { typeId: 70, primaryWeapon: 5, multiplierQ8: 358 });
  assert.equal(sim.nativeInspireState(recipient)!.liveMultiplierQ8, 358);
  assert.throws(() => sim.updateNativeInspireType({ slot: 152, generation: 0 },
    { typeId: 0, primaryWeapon: 1, multiplierQ8: 0 }), /stale/);
});

test("native lifecycle goldens: both casters, stop, redeploy and both allocation orders at reset", () => {
  interface NativeTraceCase {
    accepted: boolean;
    runtimeIntercepts: unknown[];
    trace: { stage: string; rngIndex: number; slots: Record<string, {
      id: number; timer: number; charge: number; animation: { mode: number };
    }> }[];
    writes: { update: number; eip: string; field: string; after: number }[];
  }
  const report: { exeSha256: string; cases: NativeTraceCase[] } | null = process.env.DC_INSPIRE_NATIVE_TRACE
    ? JSON.parse(readFileSync(process.env.DC_INSPIRE_NATIVE_TRACE, "utf8")) : null;
  if (report) {
    assert.equal(report.exeSha256, sourceHash);
    assert.equal(report.cases.length, 6);
    assert.ok(report.cases.every((entry) => entry.accepted && entry.runtimeIntercepts.length === 0));
  }
  const cases = [
    { queued: 0, reset: false, recipientsFirst: false },
    { queued: 1, reset: false, recipientsFirst: false },
    { queued: 13, reset: false, recipientsFirst: false },
    { queued: 0, reset: true, recipientsFirst: false },
    { queued: 0, reset: true, recipientsFirst: true },
  ];
  for (const [caseIndex, scenario] of cases.entries()) {
    const ground = new Uint32Array(128 * 128).fill(1023);
    const air = new Uint16Array(128 * 128).fill(1023);
    const definitions = {
      caster69: { typeId: 69, x: 32, y: 32 }, ground69: { typeId: 0, x: 32, y: 33 },
      air69: { typeId: 5, x: 33, y: 32 }, caster73: { typeId: 73, x: 80, y: 80 },
      ground73: { typeId: 0, x: 80, y: 81 },
    };
    type Name = keyof typeof definitions;
    const names: Name[] = scenario.recipientsFirst
      ? ["ground69", "air69", "ground73", "caster69", "caster73"]
      : ["caster69", "ground69", "air69", "caster73", "ground73"];
    const order = names.map((_, index) => ({ slot: 152 + index, generation: 1 }));
    const unitIds = {} as Record<Name, number>;
    let randomIndex = 0;
    const sim = new DeterministicSimulation(new NavigationGrid(128, 128), {
      sourceDayNightHeader: ["0", "0", scenario.reset ? "47" : "10000", scenario.reset ? "46" : "1", "1"],
      nativeInspire: {
        readRegisteredOrder: () => order,
        readPositionQ8: ({ slot }) => {
          const entity = definitions[names[slot - 152]];
          return { xQ8: entity.x * 256 + 128, yQ8: entity.y * 256 + 128 };
        },
        readOccupancy: () => ({ width: 128, height: 128, ground, air }),
        readRandomIndex: () => randomIndex,
        commitRandomIndex: (index) => { randomIndex = index; },
        onTaskTransition: () => {},
        afterEntityUpdate: ({ slot }) => {
          const isCaster = definitions[names[slot - 152]].typeId >= 69;
          const tick = sim.snapshot.tick;
          if ((tick === 0 && !isCaster) || (tick === 2 && isCaster && scenario.queued !== 13)) {
            randomIndex = (randomIndex + 1) & 255;
          }
        },
      },
    });
    for (const [index, name] of names.entries()) {
      const entity = definitions[name];
      const slot = 152 + index;
      unitIds[name] = sim.addUnit({ faction: "human", team: 1, cell: { x: entity.x, y: entity.y } });
      sim.registerNativeInspireEntity({ slot, generation: 1, unitId: unitIds[name], typeId: entity.typeId,
        team: 1, primaryWeapon: 1, multiplierQ8: entity.typeId >= 69 ? 332 : 0,
        charge: entity.typeId >= 69 ? 255 : 64, timer: 0, casterSlot: 0 });
      (name === "air69" ? air : ground)[entity.y * 128 + entity.x] = slot;
    }
    const selected = [unitIds.caster69, unitIds.caster73];
    sim.queue({ type: "inspire", unitIds: selected, team: 1 });
    sim.advance();
    assert.equal(randomIndex, 3);
    assert.ok(selected.every((id) => sim.nativeInspireState(id)!.animationMode === 1));
    if (scenario.queued === 1) sim.queue({ type: "stop", unitIds: selected });
    if (scenario.queued === 13) sim.queue({ type: "inspire", unitIds: selected, team: 1 });
    for (const update of [2, 3]) {
      sim.advance();
      const effects = sim.inspireEvents.filter((event) => event.type === "effect");
      const writes = effects.flatMap((event) => event.scan!.writes);
      const timers = writes.map((write) => write.timer);
      assert.deepEqual(timers, update === 2 ? [31, 31, 22, 31, 24, 26, 33, 35, 32]
        : scenario.queued === 13 ? [32, 21, 27, 21, 35, 21, 34, 26, 22] : []);
      const expectedTimers = update === 3 && scenario.queued === 13 ? [21, 35, 22]
        : scenario.reset && !scenario.recipientsFirst ? [25, 23, 31] : [26, 24, 32];
      assert.deepEqual((["ground69", "air69", "ground73"] as const)
        .map((name) => sim.nativeInspireState(unitIds[name])!.timer), expectedTimers);
      assert.equal(randomIndex, update === 2 ? 12 : scenario.queued === 13 ? 21 : 14);
      const expectedMode = update === 2 ? scenario.queued === 13 ? 1 : 2 : scenario.queued === 13 ? 2 : 0;
      assert.ok(selected.every((id) => sim.nativeInspireState(id)!.animationMode === expectedMode));
      if (report) {
        const nativeCase = report.cases[caseIndex];
        const nativeWrites = nativeCase.writes.filter((write) => write.update === update && write.eip === "0x417310");
        assert.deepEqual(writes.map((write) => [write.targetSlot, write.timer]),
          nativeWrites.map((write) => [Number(write.field.split(".")[0]), write.after]));
        const nativeStage = nativeCase.trace.find((entry) => entry.stage === (update === 2 ? "first-effect-returned" : "following-update"))!;
        assert.equal(randomIndex, nativeStage.rngIndex);
        for (const name of names) {
          const state = sim.nativeInspireState(unitIds[name])!;
          const native = nativeStage.slots[name];
          assert.deepEqual([state.slot, state.charge, state.timer, state.animationMode],
            [native.id, native.charge, native.timer, native.animation.mode]);
        }
      }
    }
  }
});