import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { createServer } from "vite";
import { Buffer as BrowserBuffer } from "buffer/index.js";
import { MissionView } from "../../src/mission-view";
import { transportHostState } from "../../src/engine/transport-host";
import { createNativeCombatMissionFixture, nativeCombatInput, nativeCombatPacket } from "./fixtures/native-combat-mission";
import { createNativeCombatBrowserFixture, createNativeCombatBrowserHarness } from "./fixtures/native-combat-browser";

const root = new URL("../../", import.meta.url);
const diskFetch: typeof fetch = async input => {
  const path = String(input);
  assert.ok(path.startsWith("/raw_cd/DC/") || path.startsWith("/assets/generated/"), path);
  const relative = path.startsWith("/assets/") ? `public${path}` : path.slice(1);
  return new Response(Uint8Array.from(await readFile(new URL(relative, root))));
};

test("browser fixture bundles without Node externals and bootstraps Buffer before parsers", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("fixtures/native-combat-browser.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", target: "es2022", format: "iife", globalName: "NativeCombatQA", metafile: true });
  assert.ok(Object.values(result.metafile!.outputs).every(output => output.imports.length === 0));
  assert.ok(!Object.keys(result.metafile!.inputs).some(path => /node:|(?:^|\/)native-combat-mission\.ts$/.test(path)));
  const context = createContext({ console, TextEncoder, TextDecoder });
  runInContext(result.outputFiles[0].text, context);
  assert.equal(runInContext("typeof Buffer", context), "undefined", "import alone must not install globals");
  await runInContext("NativeCombatQA.bootstrapNativeCombatBrowser()", context);
  assert.equal(runInContext("Buffer.from([29, 0]).readUInt16LE(0)", context), 29);
});

test("browser fixture reports missing original dev assets explicitly", async () => {
  await assert.rejects(createNativeCombatBrowserFixture(async () => new Response("missing", { status: 404 })),
    /QA source fetch 404: \/raw_cd\/DC\/ANIM.DAT.*local Vite dev server/);
});

test("browser typed player bridge queues normal input and consumes only supplied frames", async () => {
  const previousFetch = globalThis.fetch;
  const canvas = { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
  let harness: Awaited<ReturnType<typeof createNativeCombatBrowserHarness>> | undefined;
  try {
    globalThis.fetch = diskFetch;
    harness = await createNativeCombatBrowserHarness(canvas, {} as HTMLElement, undefined, "queued-player-input");
    assert.throws(() => harness!.advanceTo(1), /explicit clock/);
    for (let counter = 1; counter <= 16; counter++) harness.advancePlayerFrame({
      clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0 },
    });
    const id = harness.focusOwnedTroop(true);
    harness.view.selectUnit(id);
    harness.view.setOrderMode("move");
    harness.view.commandAt(320, 226);
    assert.equal(harness.commandStatus.pending?.command.type, "MoveOnly");
    assert.equal(harness.queueNativePlayerOrder({ type: "Stop" }).ok, false);
    assert.throws(() => harness!.advancePlayerFrame(harness!.frameInput(harness!.view.campaignSnapshot!)), /additional input receipt/);
    harness.advancePlayerFrame({ clockMilliseconds: 272, nativeAiFrame: { counter: 17, task6Budget: 0 } });
    assert.equal(harness.commandStatus.pending, null);
    assert.equal(harness.queueNativePlayerOrder({ type: "Stop" }).ok, true);
    harness.advancePlayerFrame({ clockMilliseconds: 288, nativeAiFrame: { counter: 18, task6Budget: 0 } });
    assert.equal(harness.commandStatus.pending, null);
    assert.equal(harness.view.simulation.checkpoint().commands.length, 0);
  } finally {
    harness?.dispose();
    globalThis.fetch = previousFetch;
  }
});

test("Vite serves original raw bytes and transforms the QA-only browser entry", async () => {
  const server = await createServer({ root: fileURLToPath(root), configFile: false,
    server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of ["/raw_cd/DC/DC.EXE", "/raw_cd/DC/ANIM.DAT", "/raw_cd/DC/ANIMATE/TRSC.FIN",
      "/raw_cd/DC/SPRITES/TRSC.SPR", "/raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN", "/assets/generated/animations/TRSC.json"]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200, path);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(await (await diskFetch(path)).arrayBuffer()), path);
    }
    const entry = await fetch(`${origin}/tools/qa/fixtures/native-combat-browser.ts`);
    assert.equal(entry.status, 200);
    const code = await entry.text();
    assert.match(code, /createNativeCombatBrowserHarness/);
    assert.doesNotMatch(code, /__vite-browser-external|node:fs/);
  } finally { await server.close(); }
});

test("browser fetched bytes/config match Node; bounded caller hit, owned camera, fresh restore and rollback", async context => {
  const expected = await createNativeCombatMissionFixture();
  const previousFetch = globalThis.fetch, previousBuffer = globalThis.Buffer;
  const canvas = { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
  let harness: Awaited<ReturnType<typeof createNativeCombatBrowserHarness>> | undefined;
  try {
    globalThis.fetch = diskFetch;
    Object.defineProperty(globalThis, "Buffer", { value: BrowserBuffer, writable: true, configurable: true });
    harness = await createNativeCombatBrowserHarness(canvas, {} as HTMLElement);
    assert.deepEqual(harness.mission, expected.mission);
    assert.deepEqual(harness.initial, expected.initial);
    assert.deepEqual([harness.column, harness.row], [expected.column, expected.row]);
    assert.equal(harness.initial.entities.length, 21);
    for (const [url, digest] of Object.entries(harness.sourceHashes)) {
      const response = await diskFetch(url);
      assert.equal(createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex"), digest, url);
    }
    assert.ok(Object.keys(harness.sourceHashes).some(url => url.endsWith("/DC.EXE")));
    assert.ok(Object.keys(harness.sourceHashes).some(url => url.endsWith("/TRSC.SPR")));
    context.diagnostic(`byte/config parity: ${Object.keys(harness.sourceHashes).length} source URLs; 21 original actors`);
    const nodeView = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, expected.mission);
    assert.deepEqual(harness.checkpoint(), nodeView.checkpoint(), "normal team 0 camera, ownership and fog match Node");
    nodeView.dispose();
    assert.throws(() => harness!.advanceTo(96), /through 95/);
    harness.advanceTo(16);
    const host = transportHostState(harness.view.campaignSnapshot!.world);
    const dynamic = host.slots.filter(actor => actor?.key.startsWith("transport:"));
    assert.equal(dynamic.length, 2);
    const source = dynamic.find(actor => actor!.team === 0)!, target = dynamic.find(actor => actor!.team === 5)!;
    assert.deepEqual(harness.frameInput(harness.view.campaignSnapshot!), nativeCombatInput(harness.view.campaignSnapshot!,
      [nativeCombatPacket(source.slot, harness.column + 2, harness.row, 7)]));
    const fog = harness.view.visibility, world = harness.view.campaignSnapshot;
    const focused = harness.focusOwnedTroop(true);
    assert.ok(harness.view.isOwnedUnit(focused));
    assert.deepEqual(harness.view.visibility, fog);
    assert.deepEqual(harness.view.campaignSnapshot, world);
    harness.advanceTo(57);
    assert.deepEqual(harness.frameInput(harness.view.campaignSnapshot!), nativeCombatInput(harness.view.campaignSnapshot!,
      [nativeCombatPacket(target.slot, harness.column, harness.row)]));
    harness.advanceTo(87);
    const hit = transportHostState(harness.view.campaignSnapshot!.world);
    assert.equal(hit.slots[target.slot]!.health, 775);
    assert.equal(harness.view.campaignSnapshot!.world.entities.length, 23);
    for (const original of expected.initial.entities) assert.ok(harness.view.campaignSnapshot!.world.entities.some(actor => actor.key === original.key));
    assert.deepEqual([hit.nativeCombat!.journal.flatMap(entry => entry.spawns).length,
      hit.nativeCombat!.journal.flatMap(entry => entry.impacts).length, hit.nativeCombat!.journal.flatMap(entry => entry.reclaimed).length], [1, 1, 1]);
    context.diagnostic("frame87: one launch/impact/reclaim, HP800->775; all original actors retained");
    const saved = JSON.parse(JSON.stringify(harness.checkpoint()));
    const oldView = harness.view;
    await harness.restore(saved);
    assert.notEqual(harness.view, oldView);
    assert.deepEqual(harness.checkpoint(), saved);
    harness.advanceTo(88);
    const reacted = transportHostState(harness.view.campaignSnapshot!.world).slots[target.slot]!.nativeAiTask!.raw;
    assert.deepEqual([reacted[0xc7], reacted[0xc8], reacted[0xc9], reacted[0x22]], [0, 1, 1, 1]);
    harness.advanceTo(95);
    const before = harness.checkpoint();
    assert.throws(() => harness!.view.advanceNativeCombat(harness!.frameInput(harness!.view.campaignSnapshot!)), /unsupported source native allocation/);
    assert.deepEqual(harness.checkpoint(), before);
    context.diagnostic("fresh-provider restore, reaction and frame96 atomic rollback passed");
  } finally {
    harness?.dispose();
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, "Buffer", { value: previousBuffer, writable: true, configurable: true });
  }
});