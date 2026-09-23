import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputDirectory = "/tmp/dc-human02-final-assault-xg3kSr";
const hardCapMs = 1200000;
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fileHash = (path: string) => sha256(readFileSync(path));
const json = (directory: string, name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2));
const filesUnder = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesUnder(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []).sort();
const protectedHashes = () => Object.fromEntries([
  ...filesUnder(join(root, "src")), ...filesUnder(join(root, "tools/qa/fixtures")),
  join(root, "tools/qa/human02-final-assault.ts"), ...filesUnder(inputDirectory),
  ...["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension => join(root, `raw_cd/DC/SCENARIO/HUMAN/HUMAN02.${extension}`)),
].map(path => [path, fileHash(path)]));

type ViewCheckpoint = ReturnType<MissionView["checkpoint"]>;
type Event = { kind: string; tick: number; data: unknown };

async function verify(directory: string) {
  const startedAt = performance.now();
  const emit = (kind: string, detail: object = {}) => {
    const event = { kind, elapsedMs: Math.round(performance.now() - startedAt), ...detail };
    appendFileSync(join(directory, "verification-journal.jsonl"), `${JSON.stringify(event)}\n`);
    console.log(JSON.stringify(event));
  };
  const readInput = (name: string) => JSON.parse(readFileSync(join(inputDirectory, name), "utf8"));
  const pending = readInput("pending-win.json") as { sourceHash: string; tick: number; checkpoint: ViewCheckpoint };
  const ready = readInput("checkpoint.json") as { sourceHash: string; view: ViewCheckpoint; strategy: { tick: number; faction: string; intent: string } };
  const compatibility = readInput("compatibility.json") as { currentSourceHash: string; rawHashes: Record<string, string>; runtimeHashes: Record<string, string> };
  const result = readInput("result.json") as { status: string; tick: number; objective: { value: number }; outcome: unknown };
  const journal = readFileSync(join(inputDirectory, "journal.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as Event);
  const actions = journal.filter(event => event.kind === "action" && event.tick >= pending.tick);
  json(directory, "public-commands-after-pending.json", actions);
  assert.equal(actions.length, 0, "Post-pending public commands exist: command-free proof is not sufficient; inspect the saved command journal");
  assert.equal(pending.tick, 21064);
  assert.equal(ready.strategy.tick, 21265);
  assert.equal(ready.strategy.tick - pending.tick, 201);
  assert.equal(ready.strategy.faction, "human");
  assert.equal(ready.strategy.intent, "win");
  assert.equal(result.status, "WIN");
  assert.equal(result.tick, ready.strategy.tick);
  assert.equal(result.objective.value, 27);
  assert.deepEqual(result.outcome, { resultCode: 0, reasonCode: 1, ready: true });
  assert.deepEqual(pending.checkpoint.state.outcome, { resultCode: 0, reasonCode: 1, ready: false });
  assert.deepEqual(ready.view.state.outcome, result.outcome);
  for (const [extension, expected] of Object.entries(compatibility.rawHashes)) {
    assert.equal(fileHash(join(root, `raw_cd/DC/SCENARIO/HUMAN/HUMAN02.${extension}`)), expected, `Original ${extension} hash`);
  }
  for (const [path, expected] of Object.entries(compatibility.runtimeHashes)) {
    assert.equal(fileHash(join(root, path)), expected, `Recorded runtime hash: ${path}`);
  }
  const renderer = installSourceRender();
  const originalFetch = globalThis.fetch;
  const fetchedHashes: Record<string, string> = {};
  let view: MissionView | undefined;
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
    const path = join(root, `public${url}`);
    const bytes = readFileSync(path);
    const actual = sha256(bytes);
    if (fetchedHashes[path]) assert.equal(actual, fetchedHashes[path], `Asset changed during load: ${path}`);
    fetchedHashes[path] = actual;
    return new Response(bytes);
  };
  try {
    const mission = await loadCampaignMission("human", 2, "browser-adapted");
    const sourceHash = sha256(JSON.stringify(mission));
    assert.equal(sourceHash, pending.sourceHash);
    assert.equal(sourceHash, ready.sourceHash);
    assert.equal(sourceHash, compatibility.currentSourceHash);
    const raw = (extension: string) => readFileSync(join(root, `raw_cd/DC/SCENARIO/HUMAN/HUMAN02.${extension}`));
    assert.equal(mission.scenario.source.sha256, sha256(raw("SCN")));
    assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), raw("SCN"));
    assert.deepEqual(mission.triggers, parseTriggerScript(raw("TRO").toString()));
    renderer.setEnabled(false);
    emit("restore-start", { tick: pending.tick, sourceHash, publicCommandsAfterPending: actions.length });
    const restoreStartedAt = performance.now();
    view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, pending.checkpoint);
    const restoreMs = performance.now() - restoreStartedAt;
    emit("restore-returned", { restoreMs });
    assert.ok(isDeepStrictEqual(view.checkpoint(), pending.checkpoint), "Full pending checkpoint must round-trip exactly before initialize");
    emit("pending-round-trip-exact");
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.simulation.snapshot.tick, pending.tick);
    assert.equal(view.missionStatistics["2,3"], 27);
    assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: 1, ready: false });
    view.resetClock();
    view.update(0);
    assert.equal(view.simulation.snapshot.tick, pending.tick);
    let firstReadyTick: number | undefined;
    for (let offset = 1; offset <= 201; offset++) {
      view.update(offset * 50);
      assert.equal(view.missionDiagnostic, undefined, `Diagnostic at offset ${offset}`);
      assert.equal(view.simulation.snapshot.tick, pending.tick + offset, `Tick at offset ${offset}`);
      assert.equal(view.missionStatistics["2,3"], 27);
      assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: 1, ready: offset === 201 });
      if (view.missionOutcome?.ready && firstReadyTick === undefined) firstReadyTick = view.simulation.snapshot.tick;
      if (offset % 25 === 0 || offset === 201) emit("continuation", { offset, tick: view.simulation.snapshot.tick, outcome: view.missionOutcome });
    }
    const actual = view.checkpoint();
    const exactReadyCheckpoint = isDeepStrictEqual(actual, ready.view);
    const comparisons = Object.fromEntries(Object.keys(ready.view).map(key => [key,
      isDeepStrictEqual(actual[key as keyof ViewCheckpoint], ready.view[key as keyof ViewCheckpoint]) ]));
    json(directory, "checkpoint-comparison.json", { exactReadyCheckpoint, comparisons,
      actualHash: sha256(JSON.stringify(actual)), expectedHash: sha256(JSON.stringify(ready.view)) });
    assert.ok(exactReadyCheckpoint, "Complete ready MissionView checkpoint must match saved expected state exactly");
    assert.equal(firstReadyTick, 21265);
    assert.equal(sha256(JSON.stringify(mission)), sourceHash);
    for (const [path, expected] of Object.entries(fetchedHashes)) assert.equal(fileHash(path), expected, `Loaded asset unchanged: ${path}`);
    json(directory, "proof.json", { judge: "PASS", milestone: "HUMAN02 browser-adapted original outcome only; not full campaign or browser presentation",
      inputDirectory, sourceHash, fromTick: pending.tick, readyTick: firstReadyTick, updates: 201,
      pendingRoundTripExact: true, readyCheckpointExact: true, objective: view.missionStatistics["2,3"],
      outcome: view.missionOutcome, publicCommandsAfterPending: actions.length, restoreMs,
      elapsedMs: performance.now() - startedAt, originalRuntimeHashesUnchanged: true, originalRawHashesUnchanged: true });
    emit("proof-complete", { readyTick: firstReadyTick, exactReadyCheckpoint });
  } finally {
    view?.dispose();
    renderer.dispose();
    globalThis.fetch = originalFetch;
    json(directory, "loaded-asset-hashes.json", fetchedHashes);
  }
}

if (process.argv[2] === "--run") {
  const directory = process.argv[3];
  assert.ok(directory?.startsWith("/tmp/dc-human02-pending-ready-verify-"));
  try { await verify(directory); }
  catch (error) {
    json(directory, "failure.json", { message: error instanceof Error ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  }
} else {
  const directory = mkdtempSync("/tmp/dc-human02-pending-ready-verify-");
  const before = protectedHashes();
  json(directory, "protected-before.json", before);
  const log = join(directory, "run.log");
  const output = openSync(log, "wx");
  const startedAt = Date.now();
  console.log(JSON.stringify({ kind: "bounded-verification-start", directory, log, parentPid: process.pid, hardCapMs }));
  process.on("SIGINT", () => {});
  const executionOptions: SpawnSyncOptions & { detached: boolean } = {
    cwd: root, stdio: ["ignore", output, output], detached: true, timeout: hardCapMs, killSignal: "SIGKILL",
  };
  const execution = spawnSync(process.execPath, ["--import", join(root, "node_modules/tsx/dist/loader.mjs"),
    fileURLToPath(import.meta.url), "--run", directory], executionOptions);
  closeSync(output);
  if (execution.pid) {
    try { process.kill(-execution.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  const after = protectedHashes();
  json(directory, "protected-after.json", after);
  const protectedFilesUnchanged = isDeepStrictEqual(before, after);
  let childAlive = false;
  if (execution.pid) {
    try { process.kill(execution.pid, 0); childAlive = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  const passed = execution.status === 0 && protectedFilesUnchanged && !childAlive;
  const summary = { judge: passed ? "PASS" : "NOT VERIFIED", directory, log, parentPid: process.pid,
    childPid: execution.pid, code: execution.status, signal: execution.signal, error: execution.error?.message,
    elapsedMs: Date.now() - startedAt, hardCapMs, protectedFilesUnchanged, protectedFileCount: Object.keys(before).length, childAlive };
  json(directory, "run-summary.json", summary);
  console.log(JSON.stringify(summary));
  process.exitCode = passed ? 0 : 1;
}