/// <reference lib="dom" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCueCatalog, parseSoundBindings, parseSoundTable, resolveAudioAsset, resolveAudioCandidates, resolveUnitCue, spatialAudio, type MediaAudioIndex } from "../../src/audio/cues";
import { MissionSoundtrack, WebAudioManager, legacyCueCatalog, type AudioManagerOptions } from "../../src/audio";

const soundText = readFileSync(new URL("../../raw_cd/DC/SOUND/SOUND2.DAT", import.meta.url), "utf8");
const media: MediaAudioIndex = JSON.parse(readFileSync(new URL("../../public/assets/generated/media/index.json", import.meta.url), "utf8"));
const bindingText = readFileSync(new URL("../../raw_cd/DC/SOUND/SLIST.DAT", import.meta.url), "utf8");
const catalog = createCueCatalog(soundText, bindingText);

test("SOUND2 deterministically resolves all 200 source records to Ogg assets", () => {
  const sounds = parseSoundTable(soundText);
  assert.equal(sounds.length, 200);
  assert.deepEqual(sounds, parseSoundTable(soundText));
  assert.deepEqual(sounds[81], { id: 81, source: "SOUND/TRP1SEL.WAV", parameters: [1, 1, 0, 0] });
  for (const sound of sounds) assert.ok(resolveAudioAsset(media, sound.source), sound.source);
  assert.equal(resolveAudioAsset(media, "unmapped"), undefined);
});

test("SOUND2 rejects malformed, duplicate and truncated input", () => {
  assert.throws(() => parseSoundTable("0 nope\n*"));
  assert.throws(() => parseSoundTable("0 a.wav 1 1 0 0\n0 b.wav 1 1 0 0\n*"));
  assert.throws(() => parseSoundTable("0 a.wav 1 1 0 0"));
});

test("SLIST resolves unit selection, acknowledgments and weapon fire without guessing filenames", () => {
  assert.equal(resolveUnitCue(catalog, { type: "unit-selected", unitType: 0 })?.assetId, "SOUND/TRP1SEL.WAV");
  assert.equal(resolveUnitCue(catalog, { type: "unit-selected", unitType: 0 }, 1)?.assetId, "SOUND/TRP3SEL.WAV");
  assert.equal(resolveUnitCue(catalog, { type: "unit-move", unitType: 8 }, 3)?.assetId, "SOUND/GRAY4ACK.WAV");
  assert.equal(resolveUnitCue(catalog, { type: "unit-attack", weaponId: 1 })?.assetId, "SOUND/TRPWEA.WAV");
  assert.equal(resolveUnitCue(catalog, { type: "unit-selected", unitType: 73 })?.assetId, "SOUND/GCACK2.WAV");
  assert.equal(resolveUnitCue(catalog, { type: "unit-selected", unitType: 999 }), undefined);
  assert.equal(resolveUnitCue(catalog, { type: "unit-attack", weaponId: -1 }), undefined);
  assert.equal(resolveUnitCue(catalog, { type: "unit-move", unitType: 0 }, NaN), undefined);
  assert.deepEqual(catalog.bindings.find((binding) => binding.group === "GUN" && binding.id === 1)?.soundIds, [91, 92, 93, 92, 92, 92, 92]);
  assert.throws(() => parseSoundBindings("0 SEL 81"));
  assert.throws(() => createCueCatalog(soundText, "0 SEL 999 -1"));
});

test("position uses camera-relative pan and radial attenuation", () => {
  const listener = { x: 0, y: 0, halfWidth: 10, audibleRadius: 20 };
  assert.deepEqual(spatialAudio({ x: 0, y: 0 }, listener), { pan: 0, gain: 1 });
  assert.deepEqual(spatialAudio({ x: 10, y: 0 }, listener), { pan: 1, gain: 0.5 });
  assert.deepEqual(spatialAudio({ x: -30, y: 0 }, listener), { pan: -1, gain: 0 });
  assert.deepEqual(spatialAudio({ x: NaN, y: 0 }, listener), { pan: 0, gain: 0 });
});

test("bundled cue catalog exactly matches source tables and hashes", () => {
  assert.deepEqual(legacyCueCatalog.sounds, catalog.sounds);
  assert.deepEqual(legacyCueCatalog.bindings, catalog.bindings);
  for (const source of legacyCueCatalog.provenance) {
    const bytes = readFileSync(new URL(`../../raw_cd/DC/${source.file}`, import.meta.url));
    assert.equal(source.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  assert.ok(catalog.sounds.every((sound) => !/\/(H1|G1)\./.test(sound.source)));
});

class FakeParam {
  value = 0;
  setValueAtTime(value: number) { this.value = value; }
}

class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode) { this.connections.push(node); }
  disconnect() { this.connections = []; this.disconnected = true; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakePanner extends FakeNode { pan = new FakeParam(); }

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  stopped = false;
  started = false;
  constructor(private readonly events: string[], private readonly failStart: () => boolean) { super(); }
  start() {
    this.events.push("start");
    if (this.failStart()) throw new Error("start failed");
    this.started = true;
  }
  stop() { this.stopped = true; }
  finish() { this.onended?.(); }
}

function buffer(length = 16, channels = 1): AudioBuffer {
  return { length, numberOfChannels: channels } as AudioBuffer;
}

class FakeContext {
  state: AudioContextState = "suspended";
  sampleRate = 44100;
  currentTime = 0;
  destination = new FakeNode();
  events: string[] = [];
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  decodeCount = 0;
  closeCount = 0;
  failStart = false;
  failResume = false;
  decode: (encoded: ArrayBuffer) => Promise<AudioBuffer> = async () => buffer();
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createStereoPanner() { const node = new FakePanner(); this.panners.push(node); return node; }
  createBufferSource() {
    const source = new FakeSource(this.events, () => this.failStart);
    this.sources.push(source);
    return source;
  }
  createBuffer(channels: number, length: number) { return buffer(length, channels); }
  async decodeAudioData(encoded: ArrayBuffer) { this.decodeCount++; return this.decode(encoded); }
  async resume() {
    this.events.push("resume");
    if (this.failResume) throw new Error("gesture required");
    this.state = "running";
  }
  async close() { this.state = "closed"; this.closeCount++; }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function fixture(options: Partial<AudioManagerOptions> = {}) {
  const context = new FakeContext();
  const requests: string[] = [];
  let contexts = 0;
  const manager = new WebAudioManager({
    mediaIndex: media,
    contextFactory: () => { contexts++; return context as unknown as AudioContext; },
    fetch: async (url) => { requests.push(String(url)); return new Response(new Uint8Array([1])); },
    ...options,
  });
  return { manager, context, requests, contextCount: () => contexts };
}

const selected = { assetId: "SOUND/TRP1SEL.WAV", priority: 70 };
const moved = { assetId: "SOUND/TRP1ACK.WAV", priority: 70 };
const fired = { assetId: "SOUND/TRPWEA.WAV", priority: 40 };

const fallbackMedia: MediaAudioIndex = { entries: [{ kind: "audio", source: selected.assetId, outputs: [
  { path: "audio/SOUND/TRP1SEL.ogg", mimeType: "audio/ogg" },
  { path: "audio/SOUND/TRP1SEL.wav", mimeType: "audio/wav" },
] }] };

test("candidate resolution is export-only, Ogg first, bounded and rejects escaping paths", () => {
  const entry = fallbackMedia.entries[0];
  assert.deepEqual(resolveAudioCandidates(fallbackMedia, selected.assetId, "/generated/"), ["/generated/audio/SOUND/TRP1SEL.ogg", "/generated/audio/SOUND/TRP1SEL.wav"]);
  assert.deepEqual(resolveAudioCandidates({ entries: [{ ...entry, outputs: [entry.outputs[1]] }] }, selected.assetId), ["/assets/generated/media/audio/SOUND/TRP1SEL.wav"]);
  assert.deepEqual(resolveAudioCandidates({ entries: [{ ...entry, outputs: [entry.outputs[0]] }] }, selected.assetId), ["/assets/generated/media/audio/SOUND/TRP1SEL.ogg"]);
  assert.deepEqual(resolveAudioCandidates(fallbackMedia, "SOUND/MISSING.WAV"), []);
  for (const unsafe of ["../raw_cd/DC/SOUND/TRP1SEL.WAV", "/raw_cd/DC/SOUND/TRP1SEL.WAV", "https://host/audio.wav", "%2e%2e/audio.wav", "..\\audio.wav"]) {
    assert.deepEqual(resolveAudioCandidates({ entries: [{ ...entry, outputs: [{ path: unsafe, mimeType: "audio/wav" }] }] }, selected.assetId), []);
  }
  assert.equal(resolveAudioCandidates({ entries: [{ ...entry, outputs: [...entry.outputs].reverse().concat(entry.outputs) }] }, selected.assetId).length, 2);
});

test("fetch, HTTP and body failures never trigger codec fallback", async () => {
  for (const failure of ["fetch", "http", "body"]) {
    let requests = 0;
    const { manager, context } = fixture({ mediaIndex: fallbackMedia, fetch: async () => {
      requests++;
      if (failure === "fetch") throw new DOMException("Canceled", "AbortError");
      if (failure === "http") return new Response(null, { status: 404 });
      return { ok: true, arrayBuffer: async () => { throw new Error("body failed"); } } as unknown as Response;
    } });
    await manager.unlock();
    assert.equal(await manager.play(selected), undefined);
    assert.equal(requests, 1);
    assert.equal(context.decodeCount, 0);
    assert.equal(manager.stats.pendingLoads, 0);
    await manager.dispose();
  }
});

test("two decode failures exhaust candidates exactly once; successful oversized decode does not retry", async () => {
  for (const reject of [true, false]) {
    const { manager, context, requests } = fixture({ mediaIndex: fallbackMedia, maxCacheBytes: 63 });
    context.decode = async () => {
      if (reject) throw new Error("unsupported");
      return buffer();
    };
    await manager.unlock();
    assert.equal(await manager.play(selected), undefined);
    assert.equal(requests.length, reject ? 2 : 1);
    assert.equal(context.decodeCount, reject ? 2 : 1);
    assert.equal(manager.stats.cacheBytes, 0);
    assert.equal(manager.stats.pendingLoads, 0);
    await manager.dispose();
  }
});

test("stopAll or disposal during rejected decode prevents any fallback fetch", async () => {
  for (const dispose of [false, true]) {
    const decoded = deferred<AudioBuffer>();
    const started = deferred<void>();
    const { manager, context, requests } = fixture({ mediaIndex: fallbackMedia });
    context.decode = () => { started.resolve(); return decoded.promise; };
    await manager.unlock();
    const pending = manager.play(selected);
    await started.promise;
    if (dispose) await manager.dispose();
    else manager.stopAll();
    decoded.reject(new Error("codec"));
    assert.equal(await pending, undefined);
    assert.equal(requests.length, 1);
    assert.equal(manager.stats.pendingLoads, 0);
    assert.equal(manager.stats.cacheBytes, 0);
    await manager.dispose();
  }
});

test("fallback decode keeps the shared load slot occupied until cancellation settles", async () => {
  const decoded = deferred<AudioBuffer>();
  const started = deferred<void>();
  const { manager, context, requests } = fixture({ mediaIndex: { entries: [...fallbackMedia.entries, ...media.entries.filter((entry) => entry.source === moved.assetId)] }, maxPendingLoads: 1 });
  context.decode = () => {
    if (context.decodeCount === 1) return Promise.reject(new Error("Opus unavailable"));
    started.resolve();
    return decoded.promise;
  };
  await manager.unlock();
  const controller = new AbortController();
  const pending = manager.play({ ...selected, signal: controller.signal });
  await started.promise;
  const shared = manager.play(selected);
  controller.abort();
  assert.equal(await manager.play(moved), undefined);
  assert.equal(manager.stats.pendingLoads, 1);
  decoded.resolve(buffer());
  assert.equal(await pending, undefined);
  assert.ok(await shared);
  assert.equal(requests.length, 2);
  assert.equal(manager.stats.cacheBytes, 64);
  await manager.dispose();
});

test("decode rejection retries the exported WAV once within a shared load and caches the result", async () => {
  const { manager, context, requests } = fixture({ mediaIndex: fallbackMedia, maxPendingLoads: 1 });
  context.decode = async () => {
    assert.equal(manager.stats.pendingLoads, 1);
    if (context.decodeCount === 1) throw new Error("Opus unavailable");
    return buffer();
  };
  await manager.unlock();
  const voices = await Promise.all([manager.play(selected), manager.play(selected)]);
  assert.ok(voices.every(Boolean));
  assert.deepEqual(requests, ["/assets/generated/media/audio/SOUND/TRP1SEL.ogg", "/assets/generated/media/audio/SOUND/TRP1SEL.wav"]);
  assert.equal(context.decodeCount, 2);
  assert.equal(manager.stats.cacheBytes, 64);
  assert.ok(await manager.play(selected));
  assert.equal(requests.length, 2);
  await manager.dispose();
});

test("actual published Opus bytes fall back to hash-verified original PCM bytes under fake codec rejection", async () => {
  const entry = media.entries.find((candidate) => candidate.source === selected.assetId)!;
  const requests: string[] = [];
  const { manager, context } = fixture({ fetch: async (url) => {
    const requested = String(url);
    requests.push(requested);
    const output = entry.outputs.find((candidate) => requested === `/assets/generated/media/${candidate.path}`);
    assert.ok(output);
    const encoded = readFileSync(new URL(`../../public/assets/generated/media/${output.path}`, import.meta.url));
    return new Response(new Uint8Array(encoded));
  } });
  context.decode = async (encoded) => {
    const bytes = Buffer.from(encoded);
    if (bytes.toString("ascii", 0, 4) === "OggS") {
      assert.ok(bytes.includes(Buffer.from("OpusHead")));
      throw new DOMException("Opus decoder unavailable", "EncodingError");
    }
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    assert.deepEqual(bytes, readFileSync(new URL(`../../raw_cd/DC/${selected.assetId}`, import.meta.url)));
    return buffer();
  };
  await manager.unlock();
  assert.ok(await manager.play(selected));
  assert.equal(requests.length, 2);
  assert.equal(context.decodeCount, 2);
  assert.equal(manager.stats.pendingLoads, 0);
  await manager.dispose();
});

test("construction and locked playback are silent; gesture starts silent buffer before resume", async () => {
  const { manager, context, requests, contextCount } = fixture();
  assert.equal(contextCount(), 0);
  assert.equal(await manager.play(selected), undefined);
  assert.equal(contextCount(), 0);
  const unlocked = manager.unlock();
  assert.deepEqual(context.events, ["start", "resume"]);
  assert.equal(context.sources[0].buffer?.length, 1);
  assert.equal(await unlocked, true);
  assert.equal(requests.length, 0);
  context.sources[0].finish();
  assert.equal(context.sources[0].disconnected, true);
  assert.equal(await manager.play({ assetId: "missing" }), undefined);
  assert.equal(requests.length, 0);
  await manager.dispose();
});

test("shared loads decode once, wire gain/panner, and release nodes on end", async () => {
  const { manager, context, requests } = fixture();
  await manager.unlock();
  const voices = await Promise.all([manager.play(selected), manager.play(selected)]);
  assert.equal(requests.length, 1);
  assert.equal(context.decodeCount, 1);
  assert.equal(manager.stats.activeVoices, 2);
  assert.deepEqual(context.sources[1].connections, [context.gains[1]]);
  assert.deepEqual(context.gains[1].connections, [context.panners[0]]);
  assert.deepEqual(context.panners[0].connections, [context.gains[0]]);
  context.sources[1].finish();
  assert.equal(voices[0]?.active, false);
  assert.equal(context.sources[1].buffer, null);
  assert.equal(context.panners[0].disconnected, true);
  voices[1]?.stop();
  voices[1]?.stop();
  assert.equal(manager.stats.activeVoices, 0);
  await manager.dispose();
});

test("LRU cache is bounded by both decoded bytes and entry count", async () => {
  for (const options of [{ maxCacheBytes: 128 }, { maxCacheEntries: 2 }]) {
    const { manager, requests } = fixture(options);
    await manager.unlock();
    (await manager.play(selected))?.stop();
    (await manager.play(moved))?.stop();
    (await manager.play(selected))?.stop();
    (await manager.play(fired))?.stop();
    assert.equal(manager.stats.cacheEntries, 2);
    assert.equal(manager.stats.cacheBytes, 128);
    (await manager.play(selected))?.stop();
    assert.equal(requests.length, 3);
    (await manager.play(moved))?.stop();
    assert.equal(requests.length, 4);
    await manager.dispose();
  }
});

test("oversized decoded buffers are neither retained nor played", async () => {
  const { manager, context } = fixture({ maxCacheBytes: 63 });
  await manager.unlock();
  assert.equal(await manager.play(selected), undefined);
  assert.equal(context.decodeCount, 1);
  assert.equal(manager.stats.cacheBytes, 0);
  assert.equal(manager.stats.activeVoices, 0);
  await manager.dispose();
});

test("priority drops low voices and steals the oldest lowest-priority voice at capacity", async () => {
  const { manager } = fixture({ maxVoices: 2 });
  await manager.unlock();
  const first = await manager.play(fired);
  const second = await manager.play(fired);
  assert.equal(await manager.play({ ...moved, priority: 1 }), undefined);
  const response = await manager.play(selected);
  assert.equal(first?.active, false);
  assert.equal(second?.active, true);
  assert.equal(response?.active, true);
  await manager.play(selected);
  assert.equal(second?.active, false);
  assert.equal(manager.stats.activeVoices, 2);
  await manager.dispose();
});

test("gain/mute are reversible and voice position can follow the camera", async () => {
  const { manager, context } = fixture({ muted: true });
  await manager.unlock();
  manager.setGain(0.4);
  assert.equal(context.gains[0].gain.value, 0);
  assert.equal(await manager.play(selected), undefined);
  manager.setMuted(false);
  assert.equal(context.gains[0].gain.value, 0.4);
  const listener = { x: 0, y: 0, halfWidth: 10, audibleRadius: 20 };
  const voice = await manager.play({ ...selected, gain: 0.8, loop: true, position: { x: 10, y: 0 }, listener });
  assert.equal(context.panners[0].pan.value, 1);
  assert.equal(context.gains[1].gain.value, 0.4);
  assert.equal(context.sources[1].loop, true);
  voice?.setPosition({ x: -10, y: 0 }, listener);
  assert.equal(context.panners[0].pan.value, -1);
  manager.setMuted(true);
  assert.equal(context.gains[0].gain.value, 0);
  manager.setGain(100);
  manager.setMuted(false);
  assert.equal(context.gains[0].gain.value, 1);
  await manager.dispose();
});

test("stopAll cancels pending fetches, and stale requests cannot start or refill the cache", async () => {
  const response = deferred<Response>();
  let signal: AbortSignal | undefined;
  const { manager } = fixture({ fetch: async (_url, options) => { signal = options?.signal ?? undefined; return response.promise; } });
  await manager.unlock();
  const pending = manager.play(selected);
  manager.stopAll();
  assert.equal(signal?.aborted, true);
  response.resolve(new Response(new Uint8Array([1])));
  assert.equal(await pending, undefined);
  assert.equal(manager.stats.cacheEntries, 0);
  assert.equal(manager.stats.pendingLoads, 0);
  await manager.dispose();
});

test("pending-load/play limits remain bounded while an uncancellable decode finishes", async () => {
  const decoded = deferred<AudioBuffer>();
  const started = deferred<void>();
  const { manager, context, requests } = fixture({ maxPendingLoads: 1, maxPendingPlays: 2 });
  context.decode = () => { started.resolve(); return decoded.promise; };
  await manager.unlock();
  const first = manager.play(selected);
  await started.promise;
  assert.equal(await manager.play(moved), undefined);
  const duplicate = manager.play(selected);
  assert.equal(await manager.play(selected), undefined);
  assert.equal(manager.stats.pendingPlays, 2);
  manager.stopAll();
  assert.equal(await manager.play(moved), undefined);
  decoded.resolve(buffer());
  assert.deepEqual(await Promise.all([first, duplicate]), [undefined, undefined]);
  assert.equal(manager.stats.cacheBytes, 0);
  assert.equal(manager.stats.pendingPlays, 0);
  assert.equal(requests.length, 1);
  await manager.dispose();
});

test("fetch and decode failures are contained and retryable", async () => {
  let attempts = 0;
  const { manager, context } = fixture({ fetch: async () => {
    attempts++;
    if (attempts === 1) throw new Error("network");
    return new Response(new Uint8Array([1]), { status: attempts === 2 ? 404 : 200 });
  } });
  await manager.unlock();
  assert.equal(await manager.play(selected), undefined);
  assert.equal(await manager.play(selected), undefined);
  context.decode = async () => { throw new Error("codec"); };
  assert.equal(await manager.play(selected), undefined);
  context.decode = async () => buffer();
  assert.ok(await manager.play(selected));
  assert.equal(manager.stats.pendingLoads, 0);
  await manager.dispose();
});

test("start failure disconnects nodes; unlock failures can be retried", async () => {
  const { manager, context } = fixture();
  context.failResume = true;
  assert.equal(await manager.unlock(), false);
  assert.equal(context.sources[0].disconnected, true);
  context.failResume = false;
  assert.equal(await manager.unlock(), true);
  context.failStart = true;
  assert.equal(await manager.play(selected), undefined);
  assert.equal(manager.stats.activeVoices, 0);
  assert.equal(context.panners[0].disconnected, true);
  await manager.dispose();
});

test("disposal stops loops, closes owned context, clears buffers and forbids restart", async () => {
  const { manager, context } = fixture();
  await manager.unlock();
  const voice = await manager.play({ ...selected, loop: true });
  await manager.dispose();
  await manager.dispose();
  assert.equal(voice?.active, false);
  assert.equal(context.closeCount, 1);
  assert.equal(context.gains[0].disconnected, true);
  assert.equal(manager.stats.cacheBytes, 0);
  assert.equal(await manager.unlock(), false);
  assert.equal(await manager.play(selected), undefined);
});

test("disposal during decode cannot resurrect playback or cached data", async () => {
  const decoded = deferred<AudioBuffer>();
  const started = deferred<void>();
  const { manager, context } = fixture();
  context.decode = () => { started.resolve(); return decoded.promise; };
  await manager.unlock();
  const pending = manager.play(selected);
  await started.promise;
  await manager.dispose();
  decoded.resolve(buffer());
  assert.equal(await pending, undefined);
  assert.equal(manager.stats.cacheEntries, 0);
  assert.equal(manager.stats.activeVoices, 0);
});

test("invalid limits fail early", () => {
  assert.throws(() => fixture({ maxVoices: 0 }), RangeError);
  assert.throws(() => fixture({ maxCacheBytes: Infinity }), RangeError);
  assert.throws(() => fixture({ maxPendingLoads: 1.5 }), RangeError);
});

test("voice completion distinguishes natural end, stop, abort and priority eviction", async () => {
  const { manager, context } = fixture({ maxVoices: 1 });
  await manager.unlock();
  const ended = await manager.play(selected);
  context.sources[1].finish();
  assert.equal(await ended?.finished, "ended");
  const stopped = await manager.play(selected);
  manager.stopAll();
  assert.equal(await stopped?.finished, "stopped");
  const controller = new AbortController();
  const aborted = await manager.play({ ...selected, signal: controller.signal });
  controller.abort();
  assert.equal(await aborted?.finished, "stopped");
  assert.equal(aborted?.active, false);
  const stolen = await manager.play(fired);
  await manager.play(selected);
  assert.equal(await stolen?.finished, "stopped");
  await manager.dispose();
});

test("per-play cancellation suppresses stale decode without cancelling a shared cue load", async () => {
  const decoded = deferred<AudioBuffer>();
  const started = deferred<void>();
  const { manager, context, requests } = fixture();
  context.decode = () => { started.resolve(); return decoded.promise; };
  await manager.unlock();
  const controller = new AbortController();
  const pending = manager.play({ ...selected, signal: controller.signal });
  await started.promise;
  const shared = manager.play(selected);
  controller.abort();
  assert.equal(await manager.play({ ...moved, signal: controller.signal }), undefined);
  decoded.resolve(buffer());
  assert.equal(await pending, undefined);
  assert.ok(await shared);
  assert.equal(requests.length, 1);
  assert.equal(manager.stats.activeVoices, 1);
  await manager.dispose();
});

test("scheduler respects gesture unlock and mute, with no automatic retry after a muted boundary", async () => {
  const { manager, context, requests } = fixture();
  const scheduler = new MissionSoundtrack(manager, media);
  const policy = { kind: "explicit-playlist", sources: ["CDDA/TRACK03"], repeat: "all" } as const;
  assert.equal(await scheduler.start(policy), false);
  assert.equal(requests.length, 0);
  await manager.unlock();
  assert.equal(await scheduler.start(policy), true);
  manager.setMuted(true);
  assert.equal(context.gains[0].gain.value, 0);
  context.sources[1].finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduler.state, "blocked");
  manager.setMuted(false);
  assert.equal(manager.stats.activeVoices, 0);
  assert.equal(requests.length, 1);
  assert.equal(await scheduler.start(policy), true);
  scheduler.stop();
  manager.stopAll();
  await Promise.resolve();
  assert.equal(scheduler.state, "idle");
  assert.equal(manager.stats.activeVoices, 0);
  await manager.dispose();
});

test("mission exit aborts pending soundtrack fetch and cannot restart audio on completion", async () => {
  const response = deferred<Response>();
  let signal: AbortSignal | undefined;
  const { manager } = fixture({ fetch: async (_url, options) => {
    signal = options?.signal ?? undefined;
    return response.promise;
  } });
  const scheduler = new MissionSoundtrack(manager, media);
  await manager.unlock();
  const pending = scheduler.start({ kind: "explicit-playlist", sources: ["CDDA/TRACK03"], repeat: "all" });
  scheduler.stop();
  manager.stopAll();
  assert.equal(signal?.aborted, true);
  response.resolve(new Response(new Uint8Array([1])));
  assert.equal(await pending, false);
  assert.equal(scheduler.state, "idle");
  assert.equal(manager.stats.activeVoices, 0);
  assert.equal(manager.stats.cacheBytes, 0);
  await manager.dispose();
});

test("long CD PCM requires an explicit larger cache; scheduling never raises the budget", async () => {
  for (const maxCacheBytes of [32 * 1024 * 1024, 96 * 1024 * 1024]) {
    const { manager, context } = fixture({ maxCacheBytes });
    context.decode = async () => buffer(8_738_856, 2);
    const scheduler = new MissionSoundtrack(manager, media);
    await manager.unlock();
    const started = await scheduler.start({ kind: "explicit-playlist", sources: ["CDDA/TRACK05"], repeat: "none" });
    assert.equal(started, maxCacheBytes > 69_910_848);
    assert.ok(manager.stats.cacheBytes <= maxCacheBytes);
    assert.equal(manager.stats.activeVoices, started ? 1 : 0);
    scheduler.dispose();
    await manager.dispose();
  }
});