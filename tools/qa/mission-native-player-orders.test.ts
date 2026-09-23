import assert from "node:assert/strict";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { transportHostState } from "../../src/engine/transport-host";
import { createNativeCombatMissionFixture, nativeCombatInput, nativeCombatPacket } from "./fixtures/native-combat-mission";

const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement, callbacks = { onStats() {}, onUnitsChanged() {} };

test("MissionView queued native input: normal Move/Stop, exact save, explicit frame and rollback", async () => {
  const fixture = await createNativeCombatMissionFixture();
  const mission = { ...fixture.mission, sourceNativeCombat: { ...fixture.mission.sourceNativeCombat!,
    playerCommands: { scope: "bounded-semantic-queue" as const, localTeam: 0 as const } } };
  const view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  for (let counter = 1; counter <= 16; counter++) view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  const source = transportHostState(view.campaignSnapshot!.world).slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 0)!;
  const binding = view.nativeBindings.find(entry => entry.slot === source.slot)!;
  view.setCameraCenter(fixture.column, fixture.row);
  view.clearSelection();
  view.commandAt(256, 226);
  assert.deepEqual(view.selectedIds, [binding.simulationId]);
  const before = view.campaignSnapshot, simulation = view.simulation.checkpoint();
  view.setOrderMode("move");
  assert.equal(view.cursorAt(256 + 2 * 32, 226), "move");
  assert.equal(view.cursorAt(256 + 4 * 32, 226), "blocked");
  view.commandAt(256 + 2 * 32, 226);
  const saved = view.checkpoint();
  assert.equal(saved.state.nativeCommand?.command.type, "MoveOnly");
  assert.deepEqual(saved.state.nativeCommand?.command, { type: "MoveOnly", destination: { column: fixture.column + 2, row: fixture.row } });
  assert.deepEqual(view.campaignSnapshot, before);
  assert.deepEqual(view.simulation.checkpoint(), simulation);
  view.stopSelected();
  assert.match(view.nativeCommandStatus.diagnostic!, /pending/);
  assert.deepEqual(view.checkpoint(), saved, "second command cannot replace pending intent");
  view.update(100000);
  assert.deepEqual(view.checkpoint(), saved, "wallclock cannot consume intent");
  const frame = nativeCombatInput(view.campaignSnapshot!);
  assert.throws(() => view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!, [nativeCombatPacket(source.slot, fixture.column + 1, fixture.row)])), /receipt/);
  assert.deepEqual(view.checkpoint(), saved);
  assert.equal(view.nativeCommandMenu.every(entry => !entry.enabled), true);
  assert.throws(() => view.advanceNativeCombat({ ...frame, nativeAiFrame: { ...frame.nativeAiFrame, counter: -1 } }));
  assert.deepEqual(view.checkpoint(), saved);
  const providers = await fixture.recreateProviders();
  const external = { ...mission, sourceNativeCombat: { ...mission.sourceNativeCombat, options: { ...mission.sourceNativeCombat.options, ...providers } } };
  const restored = MissionView.restore(canvas(), stage, callbacks, external, JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  view.advanceNativeCombat(frame); restored.advanceNativeCombat(frame);
  assert.deepEqual(restored.checkpoint(), view.checkpoint());
  assert.equal(view.checkpoint().state.nativeCommand, undefined);
  const committed = view.checkpoint().session!.state.nativeAiInputs!.at(-1)!;
  assert.deepEqual(committed.nativeAiFrame, frame.nativeAiFrame);
  assert.equal(committed.clockMilliseconds, frame.clockMilliseconds);
  assert.equal(committed.nativeAiReceipt!.id, saved.state.nativeCommand!.id);
  assert.deepEqual(committed.nativeAiReceipt!.packets, [nativeCombatPacket(source.slot, fixture.column + 2, fixture.row)]);
  assert.equal(transportHostState(view.campaignSnapshot!.world).slots[source.slot]!.nativeAiTask!.raw[0x39], 2);
  view.stopSelected();
  assert.equal(view.checkpoint().state.nativeCommand?.command.type, "Stop");
  view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  assert.equal(view.checkpoint().state.nativeCommand, undefined);
  assert.equal(view.simulation.checkpoint().commands.length, 0);
  view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  assert.equal(view.checkpoint().session!.state.nativeAiInputs!.filter(input => input.nativeAiReceipt?.id === saved.state.nativeCommand!.id).length, 1);
});

test("MissionView bounded attack-move: free A endpoint, typed target binding, clicked enemy rejection and late rollback", async () => {
  const fixture = await createNativeCombatMissionFixture();
  const mission = { ...fixture.mission, sourceNativeCombat: { ...fixture.mission.sourceNativeCombat!,
    playerCommands: { scope: "bounded-semantic-queue" as const, localTeam: 0 as const } } };
  const view = new MissionView(canvas(), stage, callbacks, mission);
  for (let counter = 1; counter <= 79; counter++) {
    const state = view.campaignSnapshot!, host = transportHostState(state.world);
    const actor = host.slots.find(entry => entry?.key.startsWith("transport:") && entry.team === (counter === 58 ? 5 : 0));
    const packets = counter === 17 ? [nativeCombatPacket(actor!.slot, fixture.column + 2, fixture.row, 7)]
      : counter === 58 ? [nativeCombatPacket(actor!.slot, fixture.column, fixture.row)] : undefined;
    view.advanceNativeCombat(nativeCombatInput(state, packets));
  }
  const host = transportHostState(view.campaignSnapshot!.world);
  const source = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 0)!;
  const target = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 5)!;
  const sourceColumn = source.position.x >>> 8, sourceRow = source.position.y >>> 8;
  const targetColumn = target.position.x >>> 8, targetRow = target.position.y >>> 8;
  view.replaceSelection([view.nativeBindings.find(entry => entry.slot === source.slot)!.simulationId]);
  view.setCameraCenter(sourceColumn, sourceRow);
  assert.equal(view.visibility[targetRow * view.grid.width + targetColumn], 1);
  const beforeSparse = view.checkpoint();
  const sparse = view.queueNativePlayerOrder({ type: "Attack", destination: { column: sourceColumn + 1, row: sourceRow },
    target: { slot: target.slot, key: target.key, generation: target.generation, raw: Array<number>(220) } });
  assert.equal(sparse.ok, false);
  assert.deepEqual(view.checkpoint(), beforeSparse);
  view.setOrderMode("assault");
  view.commandAt(256 + (targetColumn - sourceColumn) * 32, 226 - (targetRow - sourceRow) * 32);
  assert.equal(Boolean(view.nativeCommandStatus.pending), false);
  assert.match(view.nativeCommandStatus.diagnostic!, /clicked-target/);
  view.commandAt(288, 226);
  const pending = view.nativeCommandStatus.pending;
  assert.ok(pending, view.nativeCommandStatus.diagnostic);
  assert.deepEqual(pending.command, { type: "Attack", destination: { column: sourceColumn + 1, row: sourceRow },
    target: { slot: target.slot, key: target.key, generation: target.generation, raw: [...target.nativeAiTask!.raw] } });
  const saved = view.checkpoint();
  const restored = MissionView.restore(canvas(), stage, callbacks, mission, JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  restored.advanceNativeCombat(nativeCombatInput(restored.campaignSnapshot!));
  assert.deepEqual(restored.checkpoint(), view.checkpoint());
  while (view.nativeCombatFrameState.cycleCounter < 95) view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  const after = transportHostState(view.campaignSnapshot!.world);
  assert.ok(after.slots[target.slot]!.health < target.health);
  assert.equal(after.slots[source.slot]!.nativeAiTask!.raw[0x36], 0);
  assert.equal(after.slots[source.slot]!.nativeAiTask!.raw[0x39], 7);
  assert.equal(view.queueNativePlayerOrder({ type: "Stop" }).ok, true);
  const beforeFailure = view.checkpoint();
  assert.throws(() => view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!)), /unsupported source native allocation/);
  assert.deepEqual(view.checkpoint(), beforeFailure);
  assert.equal(view.nativeCommandStatus.pending!.command.type, "Stop");
  assert.equal(view.simulation.checkpoint().commands.length, 0);
});

test("MissionView queued native guards: schema, source/generation/raw identity and opt-in", async () => {
  const fixture = await createNativeCombatMissionFixture();
  const mission = { ...fixture.mission, sourceNativeCombat: { ...fixture.mission.sourceNativeCombat!,
    playerCommands: { scope: "bounded-semantic-queue" as const, localTeam: 0 as const } } };
  const view = new MissionView(canvas(), stage, callbacks, mission);
  for (let counter = 1; counter <= 16; counter++) view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  const host = transportHostState(view.campaignSnapshot!.world);
  const source = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 0)!;
  const target = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 5)!;
  view.replaceSelection([view.nativeBindings.find(entry => entry.slot === source.slot)!.simulationId]);
  const baseline = view.checkpoint();
  const hidden = view.queueNativePlayerOrder({ type: "Attack", destination: { column: fixture.column + 1, row: fixture.row },
    target: { slot: target.slot, key: target.key, generation: target.generation, raw: [...target.nativeAiTask!.raw] } });
  assert.equal(hidden.ok, false);
  assert.match(view.nativeCommandStatus.diagnostic!, /Hidden|acquisition/);
  assert.deepEqual(view.checkpoint(), baseline);
  view.setOrderMode("patrol");
  assert.equal(view.orderMode, "context");
  assert.match(view.nativeCommandStatus.diagnostic!, /unproved/);
  assert.equal(view.queueNativePlayerOrder({ type: "Stop" }).ok, true);
  const saved = view.checkpoint();
  for (const change of [
    (copy: typeof saved) => { Object.assign(copy.state.nativeCommand!, { frame: { counter: 17 } }); },
    (copy: typeof saved) => { Object.assign(copy.state.nativeCommand!, { sourceId: "foreign" }); },
    (copy: typeof saved) => { Object.assign(copy.state.nativeCommand!, { id: "reused" }); },
    (copy: typeof saved) => { Object.assign(copy.state.nativeCommand!.selected, { generation: 999 }); },
    (copy: typeof saved) => { (copy.state.nativeCommand!.selected.raw as number[])[9] ^= 1; },
    (copy: typeof saved) => { Object.assign(copy.state.nativeCommand!.command, { target: 1 }); },
  ]) {
    const copy = structuredClone(saved); change(copy);
    assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, copy), /unknown field|Stale/);
  }
  const oldView = new MissionView(canvas(), stage, callbacks, fixture.mission);
  assert.equal(oldView.queueNativePlayerOrder({ type: "Stop" }).ok, false);
  assert.throws(() => oldView.stopSelected(), /native receipt/);
  const oldSaved = oldView.checkpoint();
  oldSaved.state.nativeCommand = saved.state.nativeCommand;
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks, fixture.mission, oldSaved), /opt-in/);
});