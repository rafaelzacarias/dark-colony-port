/// <reference lib="dom" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NativeMissionMusic, NATIVE_MISSION_SOUNDTRACK, type StreamingMedia } from "../../src/audio/native-mission-music";
import { resolveAudioAsset, type MediaAudioIndex } from "../../src/audio/cues";

const mediaIndex: MediaAudioIndex = JSON.parse(readFileSync(new URL("../../public/assets/generated/media/index.json", import.meta.url), "utf8"));

class FakeMedia extends EventTarget implements StreamingMedia {
  src = "";
  muted = false;
  volume = 1;
  loop = false;
  preload: StreamingMedia["preload"] = "";
  paused = true;
  ended = false;
  error: MediaError | null = null;
  calls: string[] = [];
  readonly listeners = new Set<EventListenerOrEventListenerObject>();
  pending?: Promise<void>;
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (callback) this.listeners.add(callback);
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (callback) this.listeners.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  play(): Promise<void> {
    this.calls.push(this.src);
    this.paused = false;
    this.ended = false;
    this.error = null;
    return this.pending ?? Promise.resolve();
  }
  pause(): void { this.paused = true; this.dispatchEvent(new Event("pause")); }
  load(): void { this.ended = false; this.error = null; }
  removeAttribute(name: string): void { if (name === "src") this.src = ""; }
  end(): void { this.ended = true; this.paused = true; this.dispatchEvent(new Event("ended")); }
  fail(): void { this.error = { code: 2, message: "failed" } as MediaError; this.dispatchEvent(new Event("error")); }
}

function fixture(muted = false) {
  const media = new FakeMedia();
  let allocations = 0;
  const music = new NativeMissionMusic(mediaIndex, { muted, mediaFactory: () => { allocations++; return media; } });
  return { music, media, allocations: () => allocations };
}

async function flush() { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); }

test("native physical tracks map exactly to converted Ogg outputs", () => {
  assert.equal(NATIVE_MISSION_SOUNDTRACK.repeat, "none");
  assert.deepEqual(NATIVE_MISSION_SOUNDTRACK.sources, ["CDDA/TRACK02", "CDDA/TRACK03", "CDDA/TRACK04", "CDDA/TRACK05"]);
  for (const source of NATIVE_MISSION_SOUNDTRACK.sources) {
    assert.equal(resolveAudioAsset(mediaIndex, source), `/assets/generated/media/cd/${source.slice(5)}.ogg`);
  }
});

test("silent construction; natural sequential completion and strict update-driven restart", async () => {
  const { music, media, allocations } = fixture();
  assert.equal(allocations(), 0);
  music.update(12000);
  assert.equal(media.calls.length, 0);
  await music.start();
  music.update(5000);
  music.update(5001);
  for (let track = 2; track <= 5; track++) {
    assert.equal(media.src, `/assets/generated/media/cd/TRACK0${track}.ogg`);
    assert.equal(media.loop, false);
    media.end();
    await flush();
  }
  assert.equal(music.state, "completed");
  assert.equal(media.calls.length, 4);
  music.update(10001);
  assert.equal(media.calls.length, 4);
  music.update(10002);
  await flush();
  assert.equal(media.calls.length, 5);
  assert.equal(media.src, "/assets/generated/media/cd/TRACK02.ogg");
  assert.equal(allocations(), 1);
});

test("pause and media error block; only explicit retry restarts at 02", async () => {
  for (const event of ["pause", "error"]) {
    const { music, media } = fixture();
    await music.start();
    if (event === "pause") media.pause(); else media.fail();
    await flush();
    assert.equal(music.state, "blocked");
    music.update(12000);
    assert.equal(media.calls.length, 1);
    assert.equal(media.src, "");
    await music.retryFromGesture();
    assert.equal(media.calls.length, 2);
    assert.equal(media.src, "/assets/generated/media/cd/TRACK02.ogg");
  }
});

test("mute silences current track, blocks next boundary, and unmute does not auto-retry", async () => {
  const { music, media } = fixture();
  await music.start();
  music.setMuted(true);
  assert.equal(media.muted, true);
  media.end();
  await flush();
  assert.equal(music.state, "blocked");
  music.setMuted(false);
  music.update(12000);
  assert.equal(media.calls.length, 1);
  await music.retryFromGesture();
  assert.equal(media.calls.length, 2);
  music.stop();
  music.update(24000);
  assert.equal(await music.retryFromGesture(), false);
  assert.equal(media.src, "");
});

test("muted deployment does not allocate or prime media", async () => {
  const { music, media, allocations } = fixture(true);
  music.prepareFromGesture();
  assert.equal(await music.start(), false);
  assert.equal(music.state, "blocked");
  assert.equal(media.calls.length, 0);
  assert.equal(allocations(), 0);
});

test("muting at disc end blocks polling even after unmute", async () => {
  const { music, media } = fixture();
  await music.start();
  for (let track = 2; track < 5; track++) { media.end(); await flush(); }
  music.setMuted(true);
  media.end();
  await flush();
  assert.equal(music.state, "blocked");
  music.setMuted(false);
  music.update(12000);
  assert.equal(media.calls.length, 4);
  await music.retryFromGesture();
  assert.equal(media.calls.length, 5);
});

test("poll timestamp survives replacement and idle updates do not move it", async () => {
  const { music, media } = fixture();
  await music.start();
  music.update(12000);
  music.stop();
  music.update(15000);
  await music.start();
  for (let track = 2; track <= 5; track++) { media.end(); await flush(); }
  music.update(17000);
  assert.equal(media.calls.length, 5);
  music.update(17001);
  await flush();
  assert.equal(media.calls.length, 6);
});

test("play rejection blocks without polling retries or retained source", async () => {
  const { music, media } = fixture();
  media.pending = Promise.reject(new Error("NotAllowedError"));
  assert.equal(await music.start(), false);
  assert.equal(music.state, "blocked");
  music.update(12000);
  assert.equal(media.calls.length, 1);
  assert.equal(media.src, "");
  media.pending = undefined;
  const retry = music.retryFromGesture();
  assert.equal(media.calls.length, 2);
  assert.equal(await retry, true);
});

test("gesture priming calls play synchronously and cannot clear a replacement stream", async () => {
  const { music, media, allocations } = fixture();
  let resolve!: () => void;
  media.pending = new Promise<void>((done) => { resolve = done; });
  music.prepareFromGesture();
  assert.ok(media.calls[0].startsWith("data:audio/wav;base64,"));
  media.pending = undefined;
  await music.start();
  resolve();
  await flush();
  assert.equal(media.src, "/assets/generated/media/cd/TRACK02.ogg");
  assert.equal(music.state, "playing");
  assert.equal(allocations(), 1);
});

test("exit and replacement cancel delayed plays; stale events cannot advance", async () => {
  const { music, media, allocations } = fixture();
  let resolve!: () => void;
  media.pending = new Promise<void>((done) => { resolve = done; });
  const old = music.start();
  music.stop();
  assert.equal(media.src, "");
  media.pending = undefined;
  await music.start();
  resolve();
  assert.equal(await old, false);
  media.dispatchEvent(new Event("ended"));
  await flush();
  assert.equal(media.calls.length, 2);
  assert.equal(music.state, "playing");
  music.dispose();
  media.end();
  music.update(12000);
  assert.equal(await music.start(), false);
  assert.equal(music.state, "disposed");
  assert.equal(media.src, "");
  assert.equal(allocations(), 1);
});

test("repeated runs retain one element and at most three media listeners; teardown clears both", async () => {
  const { music, media, allocations } = fixture();
  for (let cycle = 0; cycle < 40; cycle++) {
    await music.start();
    assert.equal(media.listeners.size, 3);
    for (let track = 2; track <= 5; track++) {
      media.end();
      await flush();
      assert.equal(media.listeners.size, track === 5 ? 0 : 3);
    }
    music.stop();
    assert.equal(media.src, "");
    assert.equal(media.paused, true);
    assert.equal(media.listeners.size, 0);
  }
  assert.equal(allocations(), 1);
  music.dispose();
  music.prepareFromGesture();
  assert.equal(await music.retryFromGesture(), false);
  assert.equal(media.listeners.size, 0);
  assert.equal(allocations(), 1);
});

test("cancelled gesture priming has no continuation after exit", async () => {
  const { music, media } = fixture();
  let resolve!: () => void;
  media.pending = new Promise<void>((done) => { resolve = done; });
  music.prepareFromGesture();
  music.stop();
  resolve();
  await flush();
  assert.equal(music.state, "idle");
  assert.equal(media.src, "");
  assert.equal(media.calls.length, 1);
  music.update(12000);
  assert.equal(media.calls.length, 1);
});

test("first stopped poll skips 0, 4999 and 5000 and restarts at 5001", async () => {
  const { music, media } = fixture();
  await music.start();
  for (let track = 2; track <= 5; track++) { media.end(); await flush(); }
  for (const now of [0, 4999, 5000]) music.update(now);
  assert.equal(media.calls.length, 4);
  music.update(5001);
  await flush();
  assert.equal(media.calls.length, 5);
  music.update(12000);
  assert.equal(media.calls.length, 5);
});

test("an initial Ogg decoder failure retries the PCM-derived MP3 once on the same element", async () => {
  const { music, media, allocations } = fixture();
  const play = media.play.bind(media);
  media.play = () => {
    const result = play();
    if (!media.src.endsWith(".ogg")) return result;
    media.error = { code: 4, message: "no supported streams" } as MediaError;
    media.dispatchEvent(new Event("error"));
    return Promise.reject(new Error("NotSupportedError"));
  };
  assert.equal(await music.start(), true);
  assert.equal(media.src, "/assets/generated/media/cd/TRACK02.mp3");
  assert.equal(music.state, "playing");
  assert.equal(allocations(), 1);
  assert.equal(media.listeners.size, 3);
  media.end();
  await flush();
  assert.equal(media.src, "/assets/generated/media/cd/TRACK03.mp3");
  music.stop();
  assert.equal(media.listeners.size, 0);
  assert.equal(media.src, "");
});

test("a failed fallback blocks without retrying codecs indefinitely", async () => {
  const { music, media } = fixture();
  const play = media.play.bind(media);
  media.play = () => {
    void play();
    media.error = { code: 3, message: "decode failed" } as MediaError;
    media.dispatchEvent(new Event("error"));
    return Promise.reject(new Error("NotSupportedError"));
  };
  assert.equal(await music.start(), false);
  assert.equal(music.state, "blocked");
  assert.equal(media.calls.length, 2);
  assert.equal(media.listeners.size, 0);
});