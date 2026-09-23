import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WebAudioManager, legacyCueCatalog, resolveAudioAsset, resolveUnitCue, spatialAudio, type MediaAudioIndex } from "../../src/audio";
import type { AudioCue } from "../../src/audio";
import { createMissionAudioFeedback, MissionAudioFeedback } from "../../src/audio/mission-feedback";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";

const media: MediaAudioIndex = JSON.parse(readFileSync(new URL("../../public/assets/generated/media/index.json", import.meta.url), "utf8"));

test("audio feedback: trooper death uses only verified DEA assets", () => {
  const cues = [0, 1, 2, 3].map(variant => resolveUnitCue(legacyCueCatalog, { type: "unit-death", unitType: 0 }, variant)!);
  assert.deepEqual(cues.map(cue => cue.soundId), [28, 90, 153, 154]);
  for (const cue of cues) {
    assert.deepEqual(cue.evidence, { file: "SOUND/SLIST.DAT", group: "DEA", id: 0 });
    assert.ok(resolveAudioAsset(media, cue.assetId));
  }
  assert.equal(resolveUnitCue(legacyCueCatalog, { type: "unit-death", unitType: 69 }), undefined);
  assert.equal(resolveUnitCue(legacyCueCatalog, { type: "unit-death", unitType: 999 }), undefined);
});

function feedback() {
  let now = 0;
  const calls: AudioCue[] = [];
  const owner = new MissionAudioFeedback({ play: async cue => { calls.push(cue); return undefined; } }, () => now);
  return { owner, calls, advance: () => { now += 150; } };
}

test("audio feedback: bounded deterministic source voice variation and response admission", () => {
  const { owner, calls, advance } = feedback();
  for (const [type, unitType, ids] of [
    ["unit-selected", 0, [81, 83]], ["unit-move", 0, [105, 106, 107]],
    ["unit-selected", 69, [192, 193]], ["unit-move", 69, [188, 189, 190, 191]],
  ] as const) {
    const before = calls.length;
    for (let variant = 0; variant <= ids.length; variant++) { owner.response(type, unitType); advance(); }
    assert.deepEqual(calls.slice(before).map(cue => cue.assetId), [...ids, ids[0]].map(id => legacyCueCatalog.sounds.find(sound => sound.id === id)!.source));
    for (const cue of calls.slice(before)) assert.ok(resolveAudioAsset(media, cue.assetId));
  }
  owner.response("unit-move", 0);
  const previous = calls.at(-1)!;
  const count = calls.length;
  owner.response("unit-move", 0);
  assert.equal(calls.length, count);
  assert.equal(previous.signal!.aborted, true);
  advance();
  owner.response("unit-selected", 999);
  assert.equal(calls.length, count);
  owner.dispose();
});

const frame = {
  tick: 1,
  shots: [{ type: "shot", tick: 0, attackerId: 1, targetId: 2, damage: 1 }] as const,
  deaths: [{ type: "death", tick: 0, targetId: 2 }] as const,
  actors: new Map([[1, { unitType: 0, weaponId: 1, x: 1, y: 2 }], [2, { unitType: 0, weaponId: 1, x: -4, y: 3 }]]),
  listener: { x: 0, y: 0, halfWidth: 8, audibleRadius: 24 },
};

test("audio feedback: one shot and death per committed frame, spatial victim, no inferred impact", () => {
  const { owner, calls } = feedback();
  owner.present(frame);
  owner.present(frame);
  owner.present({ ...frame, tick: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].assetId, "SOUND/TRPWEA.WAV");
  assert.equal(calls[1].assetId, resolveUnitCue(legacyCueCatalog, { type: "unit-death", unitType: 0 })!.assetId);
  assert.deepEqual(calls[1].position, { x: -4, y: 3 });
  assert.deepEqual(calls[1].listener, frame.listener);
  owner.dispose();
  assert.ok(calls.every(cue => cue.signal!.aborted));
});

test("audio feedback: reload cancels old voices, ignores history and admits only new events", () => {
  const { owner, calls } = feedback();
  owner.present(frame);
  owner.response("unit-selected", 0);
  owner.reset(1);
  assert.ok(calls.every(cue => cue.signal!.aborted));
  owner.present(frame);
  assert.equal(calls.length, 3);
  owner.present({ ...frame, tick: 2, shots: [], deaths: [{ type: "death", tick: 1, targetId: 2 }] });
  assert.equal(calls.length, 4);
  owner.dispose();
  owner.present({ ...frame, tick: 3 });
  owner.response("unit-selected", 0);
  assert.equal(calls.length, 4);
});

test("audio feedback: strict native and silent candidates never acquire a generic audio owner", () => {
  const calls: AudioCue[] = [];
  const audio = { play: async (cue: AudioCue) => { calls.push(cue); return undefined; } };
  assert.equal(createMissionAudioFeedback(audio, true), undefined);
  assert.equal(createMissionAudioFeedback(undefined, false), undefined);
  assert.deepEqual(calls, []);
});

test("audio feedback: real generic lethal receipts do not replay on repeated frames or restored history", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 8));
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, weapon: { damage: 100, rangeCells: 3, cooldownTicks: 1 } });
  const victim = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 }, maxHealth: 1 });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: victim });
  simulation.advance();
  assert.equal(simulation.deathEvents.length, 1);
  const { owner, calls } = feedback();
  const present = (current: DeterministicSimulation) => owner.present({ tick: current.snapshot.tick,
    shots: current.combatEvents, deaths: current.deathEvents, listener: frame.listener,
    actors: new Map(current.snapshot.units.map(unit => [unit.id, { unitType: unit.faction === "human" ? 0 : 8,
      weaponId: 1, x: unit.xSubcells / 1024, y: unit.ySubcells / 1024 }])) });
  present(simulation); present(simulation);
  assert.equal(calls.length, 2);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  owner.reset(restored.snapshot.tick);
  present(restored);
  restored.advance(); present(restored);
  assert.equal(calls.length, 2);
  owner.dispose();
});

class Param {
  value = 0;
  setValueAtTime(value: number) { this.value = value; }
}

class Node {
  connect() {}
  disconnect() {}
}

class Source extends Node {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

function webAudio(muted = false) {
  const sources: Source[] = [];
  const gains: Param[] = [];
  const panners: Param[] = [];
  const buffer = { length: 16, numberOfChannels: 1 } as AudioBuffer;
  let requests = 0;
  const context = {
    state: "running", sampleRate: 44100, currentTime: 0, destination: new Node(),
    createGain() { const gain = new Param(); gains.push(gain); return Object.assign(new Node(), { gain }); },
    createStereoPanner() { const pan = new Param(); panners.push(pan); return Object.assign(new Node(), { pan }); },
    createBufferSource() { const source = new Source(); sources.push(source); return source; },
    createBuffer: () => buffer,
    decodeAudioData: async () => buffer,
    resume: async () => {}, close: async () => {},
  };
  const manager = new WebAudioManager({ mediaIndex: media, muted,
    contextFactory: () => context as unknown as AudioContext,
    fetch: async () => { requests++; return new Response(new Uint8Array([1])); } });
  return { manager, context, sources, gains, panners, buffer, requests: () => requests };
}

test("audio feedback: muted requests create no effect sources or fetches", async () => {
  const { manager, sources, requests } = webAudio(true);
  await manager.unlock();
  const owner = new MissionAudioFeedback(manager);
  owner.response("unit-selected", 0);
  owner.present(frame);
  await Promise.resolve();
  assert.equal(requests(), 0);
  assert.equal(sources.length, 1, "only the existing silent unlock buffer");
  assert.equal(manager.stats.activeVoices, 0);
  owner.dispose();
  await manager.dispose();
});

test("audio feedback: reselection and reload cancel late decode before output", async () => {
  for (const cancel of ["response", "reload", "dispose", "mute"] as const) {
    const { manager, context, sources, buffer } = webAudio();
    await manager.unlock();
    let decode!: (value: AudioBuffer) => void;
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    context.decodeAudioData = () => { began(); return new Promise(resolve => { decode = resolve; }); };
    const plays: Promise<unknown>[] = [];
    const owner = new MissionAudioFeedback({ play: cue => {
      const pending = manager.play(cue); plays.push(pending); return pending;
    } }, () => 0);
    owner.response("unit-selected", 0);
    await started;
    if (cancel === "response") owner.response("unit-selected", 0);
    if (cancel === "reload") owner.reset(0);
    if (cancel === "dispose") owner.dispose();
    if (cancel === "mute") manager.setMuted(true);
    decode(buffer);
    await Promise.all(plays);
    assert.equal(sources.length, 1, cancel);
    assert.equal(manager.stats.activeVoices, 0, cancel);
    owner.dispose();
    await manager.dispose();
  }
});

test("audio feedback: active responses never overlap effects and disposal stops only owned voices", async () => {
  const { manager, sources, gains, panners } = webAudio();
  await manager.unlock();
  const other = await manager.play({ assetId: "SOUND/TRPWEA.WAV" });
  const plays: Promise<unknown>[] = [];
  let now = 0;
  const owner = new MissionAudioFeedback({ play: cue => {
    const pending = manager.play(cue); plays.push(pending); return pending;
  } }, () => now);
  owner.response("unit-selected", 0);
  await Promise.all(plays);
  const first = sources.at(-1)!;
  now = 150;
  owner.response("unit-move", 0);
  await Promise.all(plays);
  assert.equal(first.stopped, true);
  assert.equal(manager.stats.activeVoices, 2);
  owner.present({ ...frame, shots: [] });
  await Promise.all(plays);
  const spatial = spatialAudio({ x: -4, y: 3 }, frame.listener);
  assert.equal(panners.at(-1)!.value, spatial.pan);
  assert.equal(gains.at(-1)!.value, spatial.gain);
  owner.dispose();
  assert.equal(manager.stats.activeVoices, 1);
  assert.equal(other!.active, true);
  await manager.dispose();
});