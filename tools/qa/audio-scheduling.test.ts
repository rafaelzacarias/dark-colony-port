/// <reference lib="dom" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionSoundtrack, resolveAudioAsset, type AudioCue, type AudioVoice, type MediaAudioIndex, type SoundtrackPolicy } from "../../src/audio";

const media: MediaAudioIndex = JSON.parse(readFileSync(new URL("../../public/assets/generated/media/index.json", import.meta.url), "utf8"));
const policy: SoundtrackPolicy = { kind: "explicit-playlist", sources: ["CDDA/TRACK05", "CDDA/TRACK02"], repeat: "none" };

function makeVoice() {
  let finish!: (reason: "ended" | "stopped") => void;
  const voice: AudioVoice = {
    active: true,
    finished: new Promise((resolve) => { finish = resolve; }),
    stop() { finish("stopped"); },
    setPosition() {},
  };
  return { voice, finish: () => finish("ended") };
}

function fixture() {
  const calls: AudioCue[] = [];
  const voices: ReturnType<typeof makeVoice>[] = [];
  const audio = { play: async (cue: AudioCue): Promise<AudioVoice | undefined> => {
    calls.push(cue);
    const next = makeVoice();
    voices.push(next);
    cue.signal?.addEventListener("abort", () => next.voice.stop(), { once: true });
    return next.voice;
  } };
  return { calls, voices, audio, scheduler: new MissionSoundtrack(audio, media) };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); }

test("converted CD identities resolve to existing hash-verified Ogg outputs, not mission assignments", () => {
  const index = JSON.parse(readFileSync(new URL("../../public/assets/generated/media/index.json", import.meta.url), "utf8"));
  const tracks = index.entries.filter((entry: { source: string }) => entry.source.startsWith("CDDA/"));
  assert.deepEqual(tracks.map((entry: { source: string }) => entry.source), ["CDDA/TRACK02", "CDDA/TRACK03", "CDDA/TRACK04", "CDDA/TRACK05"]);
  for (const track of tracks) {
    const output = track.outputs.find((candidate: { mimeType: string }) => candidate.mimeType === "audio/ogg");
    assert.equal(resolveAudioAsset(media, track.source), `/assets/generated/media/${output.path}`);
    const bytes = readFileSync(new URL(`../../public/assets/generated/media/${output.path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), output.sha256);
  }
});

test("construction is silent; explicit order advances only on natural end and completes", async () => {
  const { scheduler, calls, voices } = fixture();
  assert.equal(calls.length, 0);
  assert.equal(scheduler.state, "idle");
  assert.equal(await scheduler.start(policy), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].assetId, "CDDA/TRACK05");
  assert.equal(calls[0].priority, 10);
  assert.equal(calls[0].gain, 0.25);
  assert.equal(calls[0].loop, false);
  voices[0].finish();
  await flush();
  assert.equal(calls[1].assetId, "CDDA/TRACK02");
  voices[1].finish();
  await flush();
  assert.equal(scheduler.state, "completed");
  assert.equal(calls.length, 2);
});

test("explicit repeat wraps; replacement and stop invalidate old callbacks", async () => {
  const { scheduler, calls, voices } = fixture();
  await scheduler.start({ ...policy, sources: ["CDDA/TRACK03"], repeat: "all" });
  voices[0].finish();
  await flush();
  assert.equal(calls.length, 2);
  await scheduler.start(policy);
  assert.equal(calls[1].signal?.aborted, true);
  voices[1].finish();
  await flush();
  assert.equal(calls.length, 3);
  scheduler.stop();
  voices[2].finish();
  await flush();
  assert.equal(calls[2].signal?.aborted, true);
  assert.equal(calls.length, 3);
  assert.equal(scheduler.state, "idle");
});

test("invalid or oversized playlists fail closed without partial playback", async () => {
  const { scheduler, calls } = fixture();
  for (const sources of [[], ["https://example.org/music.ogg"], ["CDDA/TRACK02", "CDDA/TRACK99"], Array(33).fill("CDDA/TRACK02")]) {
    assert.equal(await scheduler.start({ ...policy, sources }), false);
    assert.equal(scheduler.state, "blocked");
  }
  assert.equal(calls.length, 0);
});

test("unavailable audio or stolen voices block without retrying or skipping tracks", async () => {
  const { scheduler, audio, calls, voices } = fixture();
  await scheduler.start(policy);
  voices[0].voice.stop();
  await flush();
  assert.equal(scheduler.state, "blocked");
  assert.equal(calls.length, 1);
  audio.play = async () => undefined;
  assert.equal(await scheduler.start(policy), false);
  assert.equal(scheduler.state, "blocked");
  audio.play = async () => { throw new Error("unavailable"); };
  assert.equal(await scheduler.start(policy), false);
  assert.equal(scheduler.state, "blocked");
});

test("exit during pending load cancels intent and stops a late voice; disposal is terminal", async () => {
  let resolve!: (voice: AudioVoice) => void;
  let signal: AbortSignal | undefined;
  const scheduler = new MissionSoundtrack({ play: (cue) => {
    signal = cue.signal;
    return new Promise((done) => { resolve = done; });
  } }, media);
  const pending = scheduler.start(policy);
  assert.equal(scheduler.state, "loading");
  scheduler.dispose();
  scheduler.dispose();
  assert.equal(signal?.aborted, true);
  const late = makeVoice();
  resolve(late.voice);
  assert.equal(await pending, false);
  assert.equal(await late.voice.finished, "stopped");
  assert.equal(scheduler.state, "disposed");
  assert.equal(await scheduler.start(policy), false);
});

test("playlist is snapshotted so caller mutations cannot alter a running schedule", async () => {
  const { scheduler, calls, voices } = fixture();
  const sources = [...policy.sources];
  await scheduler.start({ ...policy, sources });
  sources[1] = "CDDA/TRACK99";
  voices[0].finish();
  await flush();
  assert.equal(calls[1].assetId, "CDDA/TRACK02");
  scheduler.stop();
});