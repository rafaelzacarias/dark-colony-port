import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CombatMovementOrders } from "../../src/engine/combat-movement";
import { VERIFIED_NATIVE_ORDINARY_COEFFICIENTS } from "../../src/engine/legacy-balance";
import { MissionView, type MissionViewCheckpoint } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import type { WebAudioManager } from "../../src/audio";

function mission(faction: "HUMAN" | "ALIEN"): CampaignMissionData {
  const root = new URL("../../public/assets/generated/", import.meta.url);
  const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
  const words = (path: string) => {
    const bytes = readFileSync(new URL(path, root));
    return Uint16Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readUInt16LE(index * 2));
  };
  const stem = `${faction}/${faction}01`, map = json(`maps/${stem}.json`);
  return {
    faction: faction === "HUMAN" ? "human" : "alien", map, scenario: json(`data/scenarios/${stem}.json`),
    triggers: json(`data/triggers/${stem}.json`).blocks, messages: json(`data/messages/${stem}.json`).messages,
    briefing: json(`data/briefings/${stem}.json`), units: json("data/units.json").records,
    weapons: json("data/weapons.json").records, damageMatrix: json("data/damage-matrix.json").coefficients,
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    tileReferences: words(`maps/${faction}/${map.files.tileReferences}`),
    tileRecordIndices: words(`maps/${faction}/${map.files.tileRecordIndices}`),
    attributes: words(`maps/${faction}/${map.files.attributes}`),
    tags: Uint8Array.from(readFileSync(new URL(`maps/${faction}/${map.files.tags}`, root))),
    pathGrid: Uint8Array.from(readFileSync(new URL(`maps/${faction}/${map.files.pathGrid}`, root))),
  };
}

const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };
const stage = {} as HTMLElement;
const jsonCopy = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));

function create(data: CampaignMissionData, audio?: WebAudioManager): MissionView {
  const view = new MissionView(canvas(), stage, callbacks, data, audio);
  assert.equal(view.missionDiagnostic, undefined);
  view.update(0);
  return view;
}

function step(view: MissionView, count = 1): void {
  for (let index = 0; index < count; index += 1) {
    view.update((view.simulation.snapshot.tick + 1) * 50);
    assert.equal(view.missionDiagnostic, undefined);
  }
}

function deliver(view: MissionView): void {
  for (let index = 0; index < 1000; index += 1) {
    if (view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id)).length === 5) return;
    step(view);
  }
  assert.fail("Expected five troops from native carrier");
}

function restore(view: MissionView, audio?: WebAudioManager): MissionView {
  const saved = jsonCopy(view.checkpoint());
  const restored = MissionView.restore(canvas(), stage, callbacks, view.mission, saved, audio);
  assert.deepEqual(restored.checkpoint(), saved);
  const tick = restored.simulation.snapshot.tick;
  restored.update(tick * 50);
  assert.equal(restored.simulation.snapshot.tick, tick, "first wall-clock sample must not advance");
  return restored;
}

function compareContinuation(original: MissionView, restored: MissionView, ticks = 100): void {
  for (let index = 0; index < ticks; index += 1) {
    step(original); step(restored);
    assert.deepEqual(restored.simulation.snapshot, original.simulation.snapshot, `simulation tick ${index}`);
    assert.deepEqual(restored.campaignJournal.at(-1), original.campaignJournal.at(-1), `journal tick ${index}`);
    assert.deepEqual(restored.explored, original.explored);
    assert.deepEqual(restored.nativeBindings, original.nativeBindings);
    assert.deepEqual(restored.carrierVisuals, original.carrierVisuals);
    assert.deepEqual(restored.selectedIds, original.selectedIds);
  }
  assert.deepEqual(restored.campaignSnapshot, original.campaignSnapshot);
  assert.deepEqual(restored.campaignJournal.slice(-ticks), original.campaignJournal.slice(-ticks));
  assert.deepEqual(restored.checkpoint(), original.checkpoint());
}

function clickCell(view: MissionView, point: { x: number; y: number }): void {
  const camera = view.cameraView;
  view.commandAt((point.x + 0.5 - camera.x) * 32, (camera.y + camera.height - point.y - 0.5) * 32);
}

test("guard ownership view: autonomous retention restores, invalid targets switch and stop, explicit input wins", () => {
  const source = mission("ALIEN");
  const data = { ...source, units: source.units.map(stat => stat.index === 8
    ? { ...stat, observationDay: 200, observationNight: 200 } : stat) };
  const view = create(data);
  deliver(view);
  const guard = view.checkpoint().state.unitStats.find(entry => entry.type === 8 && view.isOwnedUnit(entry.id))!.id;
  const equipment = view.simulation.checkpoint().units.find(unit => unit.id === guard)!;
  assert.ok(equipment.weapon && equipment.sourceDefense);
  view.simulation.updateUnitEquipment(guard, { sourceDefense: equipment.sourceDefense,
    weapon: { ...equipment.weapon, sourceDamage: { coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS,
      callerFactor: 256, specialFlag: false } } });
  step(view);
  const actor = (current: MissionView) => current.simulation.snapshot.units.find(unit => unit.id === guard)!;
  const invalidate = (current: MissionView, targetId: number) => {
    const sourceDefense = { targetClass: 8, armorFactor: 256 };
    const unit = current.simulation.checkpoint().units.find(unit => unit.id === targetId);
    if (unit) {
      assert.ok(unit.weapon);
      current.simulation.updateUnitEquipment(targetId, { weapon: unit.weapon, sourceDefense });
    } else current.simulation.updateStaticSourceDefense(targetId, sourceDefense);
  };
  const first = actor(view).targetId!;
  assert.ok(first);
  assert.ok(view.checkpoint().guardAttacks?.some(entry => entry.id === guard && entry.targetId === first));
  assert.equal(view.checkpoint().combatMovement.intents.some(entry => entry.id === guard), false,
    "ordinary guard attack has no interrupted assault provenance");
  const restored = restore(view);
  const manual = restore(view);
  step(view); step(restored);
  assert.equal(actor(restored).targetId, first, "restored eligible automatic target is retained");
  assert.deepEqual(restored.checkpoint(), view.checkpoint());
  for (const current of [view, restored]) {
    invalidate(current, first);
    assert.equal(current.simulation.canAutoTarget(guard, first), false);
    step(current);
    assert.notEqual(actor(current).targetId, first);
    assert.ok(actor(current).targetId, "another damageable target is selected");
    assert.ok(current.simulation.combatEvents.every(event => event.attackerId !== guard || event.targetId !== first));
    for (const target of [...current.simulation.snapshot.units, ...current.simulation.snapshot.staticTargets]) {
      if (target.faction !== current.playerFaction) invalidate(current, target.id);
    }
    const before = actor(current);
    for (let tick = 0; tick < 3; tick += 1) {
      step(current);
      assert.equal(actor(current).activity, "idle");
      assert.equal(actor(current).targetId, null);
      assert.deepEqual([actor(current).xSubcells, actor(current).ySubcells], [before.xSubcells, before.ySubcells]);
      assert.ok(current.simulation.combatEvents.every(event => event.attackerId !== guard));
      const savedActor = current.simulation.checkpoint().units.find(unit => unit.id === guard)!;
      assert.deepEqual(savedActor.path, []);
      assert.equal(savedActor.reservedDestination, null);
    }
    assert.equal(current.checkpoint().guardAttacks?.some(entry => entry.id === guard) ?? false, false);
  }
  assert.deepEqual(restored.checkpoint(), view.checkpoint());
  const target = [...manual.simulation.snapshot.units, ...manual.simulation.snapshot.staticTargets].find(target => target.id === first)!;
  invalidate(manual, first);
  manual.replaceSelection([guard]);
  manual.setCameraCenter(target.cellX + 0.5, target.cellY + 0.5);
  assert.equal(manual.visibility[manual.grid.index(target.cellX, target.cellY)], 1);
  clickCell(manual, { x: target.cellX, y: target.cellY });
  assert.ok(manual.checkpoint().combatMovement.pendingManual.includes(guard));
  assert.equal(manual.checkpoint().guardAttacks?.some(entry => entry.id === guard) ?? false, false);
  const pendingManual = restore(manual);
  for (let tick = 0; tick < 3; tick += 1) {
    step(manual); step(pendingManual);
    assert.equal(actor(manual).targetId, first, "explicit zero-damage attack must not switch");
    assert.equal(actor(pendingManual).targetId, first);
  }
  assert.deepEqual(pendingManual.checkpoint(), manual.checkpoint());
});

for (const faction of ["HUMAN", "ALIEN"] as const) test(`${faction} live waypoint draft, pending move and mid-move exploration resume for 100 ticks`, () => {
  const view = create(mission(faction));
  deliver(view);
  const units = view.simulation.snapshot.units;
  const occupied = new Set(units.map((unit) => view.grid.index(unit.cellX, unit.cellY)));
  const unit = units.find((candidate) => view.isOwnedUnit(candidate.id) && view.grid.neighbors(
    view.grid.index(candidate.cellX, candidate.cellY)).some((index) => !occupied.has(index)))!;
  assert.ok(unit);
  const first = view.grid.point(view.grid.neighbors(view.grid.index(unit.cellX, unit.cellY)).find((index) => !occupied.has(index))!);
  const second = { x: unit.cellX, y: unit.cellY };
  view.replaceSelection([unit.id]);
  view.setCameraCenter(unit.cellX + 0.5, unit.cellY + 0.5);
  view.setOrderMode("move");
  view.setOrderMode("waypoints");
  clickCell(view, first); clickCell(view, second);
  assert.deepEqual(view.plottedWaypoints, [first, second]);
  const draftRestore = restore(view);
  assert.equal(draftRestore.movementStance, "move");
  clickCell(view, second); clickCell(draftRestore, second);
  assert.equal(view.checkpoint().combatMovement.intents.find(({ id }) => id === unit.id)!.intent.pending, true);
  assert.deepEqual(draftRestore.checkpoint(), view.checkpoint());
  const pendingRestore = restore(view);
  step(view); step(pendingRestore);
  assert.deepEqual(pendingRestore.simulation.snapshot, view.simulation.snapshot);
  assert.equal(view.simulation.snapshot.units.find(({ id }) => id === unit.id)!.activity, "move");
  assert.ok(view.explored.some(Boolean));
  const movingRestore = restore(view);
  compareContinuation(view, movingRestore);
  view.stopSelected(); movingRestore.stopSelected();
  const manualRestore = restore(view);
  assert.deepEqual(manualRestore.checkpoint().combatMovement.pendingManual, [unit.id]);
  compareContinuation(view, manualRestore);
});

for (const faction of ["HUMAN", "ALIEN"] as const) test(`${faction} live attack checkpoint keeps cooldown, animation and audio event boundary for 100 ticks`, () => {
  const originalSounds: unknown[] = [], restoredSounds: unknown[] = [];
  const audio = (sounds: unknown[]) => ({ play: (cue: unknown) => { sounds.push(cue); return Promise.resolve(); } }) as unknown as WebAudioManager;
  const view = create(mission(faction), audio(originalSounds));
  deliver(view);
  const unit = view.simulation.snapshot.units.find(({ id }) => view.isOwnedUnit(id))!;
  const target = [...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets].filter((candidate) => candidate.faction !== view.playerFaction &&
    view.nativeBindings.some((binding) => binding.simulationId === candidate.id &&
      view.campaignSnapshot!.world.entities.some((entity) => entity.key === binding.key && entity.unitType === (faction === "HUMAN" ? 8 : 82))))
    .sort((left, right) => Math.abs(left.cellX - unit.cellX) + Math.abs(left.cellY - unit.cellY) -
      Math.abs(right.cellX - unit.cellX) - Math.abs(right.cellY - unit.cellY))[0];
  assert.ok(target, "source hostile target");
  const destination = view.grid.point(view.grid.neighbors(view.grid.index(target.cellX, target.cellY))[0]);
  view.replaceSelection([unit.id]);
  view.setOrderMode("move");
  clickCell(view, destination);
  for (let index = 0; index < 1500 && !view.visibility[view.grid.index(target.cellX, target.cellY)]; index += 1) step(view);
  assert.equal(view.visibility[view.grid.index(target.cellX, target.cellY)], 1, "move must reveal source target");
  view.setOrderMode("assault");
  const currentTarget = [...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets].find(({ id }) => id === target.id)!;
  clickCell(view, { x: currentTarget.cellX, y: currentTarget.cellY });
  assert.ok(view.checkpoint().combatMovement.pendingManual.includes(unit.id));
  const pendingRestore = restore(view);
  step(view); step(pendingRestore);
  assert.deepEqual(view.simulation.snapshot, pendingRestore.simulation.snapshot);
  for (let index = 0; index < 500 && !view.simulation.combatEvents.some((event) => event.attackerId === unit.id); index += 1) step(view);
  assert.ok(view.simulation.combatEvents.some((event) => event.attackerId === unit.id));
  assert.ok(view.checkpoint().state.animationStates.some((entry) => entry.id === unit.id && entry.action === "Attack"));
  const restored = restore(view, audio(restoredSounds));
  assert.deepEqual(restoredSounds, [], "restoring a shot must not play it again");
  originalSounds.length = 0;
  compareContinuation(view, restored);
  assert.deepEqual(restoredSounds, originalSounds);
  assert.ok(originalSounds.length > 0, "continuation must exercise audio presentation");
});

test("full MissionView direct restore timing at 220 and 1000 ticks", (context) => {
  const view = create(mission("HUMAN"));
  const samples: { tick: number; bytes: number; restoreMilliseconds: number }[] = [];
  for (const tick of [220, 1000]) {
    step(view, tick - view.simulation.snapshot.tick);
    const json = JSON.stringify(view.checkpoint()), saved = JSON.parse(json);
    const start = performance.now();
    const restored = MissionView.restore(canvas(), stage, callbacks, view.mission, saved);
    samples.push({ tick, bytes: Buffer.byteLength(json), restoreMilliseconds: performance.now() - start });
    assert.deepEqual(restored.checkpoint(), view.checkpoint());
    assert.deepEqual(restored.campaignJournal, []);
  }
  assert.ok(samples[1].bytes - samples[0].bytes < 4096, JSON.stringify(samples));
  context.diagnostic(JSON.stringify(samples));
});

test("pending native reservation and diagnostic checkpoint preserve their exact event boundary", () => {
  const view = create(mission("HUMAN"));
  deliver(view);
  const id = view.simulation.snapshot.units.find((unit) => view.isOwnedUnit(unit.id))!.id;
  view.recordDestinationReservation(id, 25, 59);
  assert.equal(view.checkpoint().state.pendingReservations.length, 1);
  const restored = restore(view);
  compareContinuation(view, restored);
  assert.equal(restored.campaignSnapshot!.controller.runtime.lives[7], 0);
  assert.equal(restored.checkpoint().state.pendingReservations.length, 0);
  view.recordDestinationReservation(-1, 0, 0);
  const diagnostic = restore(view);
  assert.equal(diagnostic.missionDiagnostic, view.missionDiagnostic);
  diagnostic.update(999_999);
  assert.deepEqual(diagnostic.simulation.snapshot, view.simulation.snapshot);
});

test("controlled source combat: recorded deaths, commander detachment and delayed outcome restore without replay", () => {
  const source = mission("ALIEN");
  const data: CampaignMissionData = { ...source, damageMatrix: undefined,
    weapons: source.weapons.map((weapon) => ({ ...weapon, damage: 10000, range: 200, rateOfFire: 1 })) };
  const view = create(data);
  deliver(view);
  const attacker = view.simulation.snapshot.units.find(({ id }) => view.isOwnedUnit(id))!;
  const targets = view.simulation.snapshot.staticTargets.filter((target) => view.nativeBindings.some((binding) =>
    binding.simulationId === target.id && view.campaignSnapshot!.world.entities.some((entity) =>
      entity.key === binding.key && entity.team === 1 && entity.unitType === 82)));
  assert.equal(targets.length, 11);
  view.replaceSelection([attacker.id]);
  for (const target of targets) {
    view.stopSelected();
    view.simulation.queue({ type: "attack", unitIds: [attacker.id], targetId: target.id });
    step(view);
    assert.equal(view.simulation.snapshot.staticTargets.find(({ id }) => id === target.id)!.health, 0);
  }
  assert.equal(view.checkpoint().state.recordedDeaths.length, 11);
  const afterDeaths = restore(view);
  compareContinuation(view, afterDeaths);
  for (let count = 0; count < 1000 && view.checkpoint().state.detachedIds.length === 0; count += 1) step(view);
  assert.ok(view.checkpoint().state.detachedIds.length > 0);
  assert.ok(view.missionOutcome);
  const detached = restore(view);
  compareContinuation(view, detached);
  for (let count = 0; count < 1000 && !view.missionOutcome?.ready; count += 1) { step(view); step(detached); }
  assert.equal(view.missionOutcome?.ready, true);
  assert.deepEqual(detached.campaignSnapshot, view.campaignSnapshot);
  const finished = restore(view);
  finished.update(1_000_000);
  assert.deepEqual(finished.simulation.snapshot, view.simulation.snapshot);
});

for (const faction of ["HUMAN", "ALIEN"] as const) test(`${faction} source mid-carrier JSON restore matches 100 ticks without duplicated troops or effects`, () => {
  const data = mission(faction);
  const sounds: unknown[] = [];
  const audio = { play: (cue: unknown) => { sounds.push(cue); return Promise.resolve(); } } as unknown as WebAudioManager;
  const original = create(data, audio);
  step(original, 20);
  assert.ok(original.carrierVisuals.length > 0);
  const count = sounds.length;
  const restored = restore(original, audio);
  assert.equal(sounds.length, count, "restore must not present historical effects");
  compareContinuation(original, restored);
  deliver(original); deliver(restored);
  assert.equal(restored.simulation.snapshot.units.filter(({ id }) => restored.isOwnedUnit(id)).length, 5);
  assert.deepEqual(restored.nativeBindings, original.nativeBindings);
});

test("MissionView rejects malformed JSON, bindings, source changes and mismatched nested checkpoints", () => {
  const data = mission("HUMAN"), view = create(data);
  step(view, 20);
  const saved = jsonCopy(view.checkpoint());
  const attempt = (value: unknown, source = data) => MissionView.restore(canvas(), stage, callbacks, source, value);
  const corrupt = (edit: (copy: MissionViewCheckpoint) => void) => {
    const copy = jsonCopy(saved); edit(copy); assert.throws(() => attempt(copy));
  };
  assert.throws(() => attempt(null));
  assert.throws(() => attempt({ ...saved, version: 99 }));
  assert.throws(() => attempt({ ...saved, extra: true }));
  assert.throws(() => attempt({ ...saved, get state() { throw new Error("getter must not run"); } }), /JSON data property/);
  corrupt((copy) => copy.state.bindings.push(copy.state.bindings[0]));
  corrupt((copy) => { copy.state.bindings[0] = { ...copy.state.bindings[0], generation: 999 }; });
  corrupt((copy) => { copy.state.bindings[0] = { ...copy.state.bindings[0], key: "wrong" }; });
  corrupt((copy) => { copy.state.unitStats.pop(); });
  corrupt((copy) => { copy.state.explored.pop(); });
  corrupt((copy) => { copy.state.explored[0] = 2; });
  corrupt((copy) => { copy.state.camera.x = Infinity; });
  corrupt((copy) => { copy.state.carriers[0].generation += 1; });
  corrupt((copy) => { copy.state.recordedDeaths.push(copy.state.bindings[0].simulationId); });
  corrupt((copy) => { copy.state.detachedIds.push(copy.state.bindings[0].simulationId); });
  corrupt((copy) => { copy.state.pendingReservations.push({ slot: 799, generation: 999, tileX: 0, tileY: 0 }); });
  assert.throws(() => attempt({ ...saved, session: { ...saved.session, options: { ...saved.session!.options, sessionId: "wrong" } } }));
  assert.throws(() => attempt(saved, { ...data, scenario: { ...data.scenario, id: "wrong" } }));
  assert.throws(() => attempt(saved, { ...data, scenario: { ...data.scenario, source: { ...data.scenario.source, sha256: "wrong" } } }));
  assert.throws(() => attempt(saved, { ...data, scenario: { ...data.scenario, rawHeader: [...data.scenario.rawHeader, "wrong"] } }));
  assert.throws(() => attempt(saved, { ...data, map: { ...data.map, width: data.map.width + 1 } }));
  assert.throws(() => attempt(saved, { ...data, damageMatrix: undefined }));
  const changedPath = data.pathGrid.slice(); changedPath[0] ^= 1;
  assert.throws(() => attempt(saved, { ...data, pathGrid: changedPath }));
  const restored = attempt(saved, structuredClone(data));
  saved.state.explored[0] ^= 1;
  assert.notEqual(restored.explored[0], saved.state.explored[0]);
});

test("restored rendering uses current positions, resets fractional wall-clock time and honors disposed initialization", async () => {
  const view = create(mission("HUMAN"));
  deliver(view);
  for (let count = 0; count < 500 && view.carrierVisuals.length; count += 1) step(view);
  assert.equal(view.carrierVisuals.length, 0);
  const unit = view.simulation.snapshot.units.find(({ id }) => view.isOwnedUnit(id))!;
  const occupied = new Set(view.simulation.snapshot.units.map((entry) => view.grid.index(entry.cellX, entry.cellY)));
  const destination = view.grid.point(view.grid.neighbors(view.grid.index(unit.cellX, unit.cellY)).find((index) => !occupied.has(index))!);
  view.replaceSelection([unit.id]);
  view.setCameraCenter(unit.cellX + 0.5, unit.cellY + 0.5);
  view.setOrderMode("move");
  clickCell(view, destination);
  step(view);
  view.update(view.simulation.snapshot.tick * 50 + 25);
  const saved = jsonCopy(view.checkpoint());
  const ellipses: number[][] = [];
  const context = new Proxy({
    ellipse: (...args: number[]) => { ellipses.push(args); },
    measureText: () => ({ width: 0 }),
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
  const drawingCanvas = { ...canvas(), getContext: () => context } as unknown as HTMLCanvasElement;
  let publications = 0;
  const restored = MissionView.restore(drawingCanvas, stage, { onStats() { publications += 1; }, onUnitsChanged() { publications += 1; } }, view.mission, saved);
  assert.equal(publications, 0, "factory must not render, publish or play effects before returning");
  restored.update(1_000_000);
  assert.equal(restored.simulation.snapshot.tick, saved.simulation.tick);
  const current = restored.simulation.snapshot.units.find(({ id }) => id === unit.id)!;
  const camera = restored.cameraView;
  assert.equal(ellipses.length, 1);
  assert.equal(ellipses[0][0], (current.xSubcells / 1024 - camera.x) * 32);
  assert.equal(ellipses[0][1], (camera.y + camera.height - current.ySubcells / 1024) * 32 + 4);
  restored.update(1_000_025);
  assert.equal(restored.simulation.snapshot.tick, saved.simulation.tick, "saved fractional elapsed time must not leak");
  restored.update(1_000_050);
  assert.equal(restored.simulation.snapshot.tick, saved.simulation.tick + 1);
  restored.dispose();
  const before = publications;
  await restored.initialize();
  restored.update(1_000_100);
  assert.equal(publications, before);
  assert.throws(() => restored.checkpoint(), /disposed view/);
});

test("combat movement checkpoint retains pending intents and manual suppression without aliasing", () => {
  const orders = new CombatMovementOrders();
  orders.move([1, 2], { x: 4, y: 5 }, true);
  orders.cancel([2]);
  const saved = JSON.parse(JSON.stringify(orders.checkpoint()));
  saved.intents[0].intent.interrupted = true;
  const restored = CombatMovementOrders.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved);
  saved.intents[0].intent.target.x = 9;
  assert.equal(restored.checkpoint().intents[0].intent.target.x, 4);
  assert.equal(restored.interrupted(1), true);
  assert.throws(() => CombatMovementOrders.restore({ ...saved, pendingManual: [2, 2] }));
  assert.throws(() => CombatMovementOrders.restore({ ...saved, intents: [...saved.intents, saved.intents[0]] }));
  assert.throws(() => CombatMovementOrders.restore({ ...saved, version: 2 }));
  assert.throws(() => CombatMovementOrders.restore({ ...saved, extra: true }));
});