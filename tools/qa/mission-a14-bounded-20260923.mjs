import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const driver = `${root}tools/qa/campaign-13-15.ts`;
const hash = value => createHash("sha256").update(value).digest("hex");
const digest = path => hash(readFileSync(path));
const read = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const alive = pid => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
};

async function worker(output) {
  const started = Date.now(), deadline = started + 290000;
  const directory = `${output}/A14`;
  mkdirSync(directory);
  const loaded = {};
  const hook = registerHooks({ load(url, context, nextLoad) {
    const path = url.startsWith("file:") ? fileURLToPath(url) : "";
    const tracked = path.startsWith(root) && !path.includes("/node_modules/") && /\.[cm]?[jt]s$/.test(path);
    const bytes = tracked ? readFileSync(path) : null;
    const result = nextLoad(url, context);
    if (tracked) {
      const relative = path.slice(root.length);
      const destination = `${output}/loaded-source/${relative}`;
      mkdirSync(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
      writeFileSync(destination, bytes);
      loaded[relative] = { rawHash: hash(bytes), afterLoadHash: digest(path),
        evaluatedHash: result.source == null ? null : hash(result.source), url };
      assert.equal(loaded[relative].rawHash, loaded[relative].afterLoadHash, `Changed during load: ${relative}`);
      write(`${output}/loaded-modules.json`, loaded);
    }
    return result;
  } });
  let renderer, restoreFetch, view, failure, proof, playElapsedMs;
  try {
    process.argv = [process.execPath, driver, "--worker", "--case=A14", `--output=${directory}`, "--allowance=180000"];
    await import(pathToFileURL(driver).href);
    playElapsedMs = Date.now() - started;
    write(`${output}/play-finished.json`, { elapsedMs: playElapsedMs, pid: process.pid });
    process.send?.({ kind: "play-finished", elapsedMs: playElapsedMs });
    const result = read(`${directory}/result.json`);
    const ready = read(`${directory}/checkpoint.json`), pending = read(`${directory}/pending-win.json`);
    if (result?.outcome?.ready !== true || result.outcome.resultCode !== 0) return;
    assert.ok(playElapsedMs <= 180000, "Play budget exceeded");
    assert.ok(Date.now() < deadline - 5000, "No proof allowance remains");
    const [{ loadCampaignMission }, { MissionView }, { installSourceRender }] = await Promise.all([
      import("../../src/game-data.ts"), import("../../src/mission-view.ts"), import("./fixtures/source-render.ts"),
    ]);
    const source = read(`${directory}/source.json`);
    const integrity = read(`${directory}/integrity.json`);
    assert.deepEqual(integrity.changedAssets, []);
    assert.deepEqual(integrity.changedSources, []);
    assert.equal(pending.sourceHash, source.sourceHash);
    assert.equal(ready.sourceHash, source.sourceHash);
    assert.ok(read(`${directory}/campaign-journal.json`).some(entry => entry.fired.includes(source.win.id)));
    const proofAssets = {};
    restoreFetch = globalThis.fetch;
    globalThis.fetch = async input => {
      const path = String(input);
      assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
      const bytes = readFileSync(`${root}public${path}`);
      proofAssets[path] = hash(bytes);
      assert.equal(proofAssets[path], integrity.fetched[path], `Proof asset drift: ${path}`);
      return new Response(bytes);
    };
    renderer = installSourceRender();
    renderer.setEnabled(false);
    const mission = await loadCampaignMission("alien", 14, "browser-adapted");
    assert.equal(mission.scenario.source.sha256, source.sources.SCN);
    assert.deepEqual(mission.triggers, source.triggers);
    view = MissionView.restore(renderer.canvas(), {}, { onStats() {}, onUnitsChanged() {} }, mission,
      JSON.parse(JSON.stringify(pending.view)));
    assert.deepEqual(view.checkpoint(), pending.view);
    await view.initialize();
    assert.equal(view.missionOutcome?.resultCode, 0);
    assert.equal(view.missionOutcome?.ready, false);
    view.resetClock(); view.update(0);
    const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
    assert.equal(ticks, 201);
    for (let offset = 1; offset <= ticks; offset++) {
      assert.ok(Date.now() < deadline - 2000, "Proof budget exhausted");
      view.update(offset * 50);
      assert.equal(view.missionDiagnostic, undefined);
    }
    const actual = view.checkpoint();
    assert.deepEqual(actual, ready.view);
    assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: 1, ready: true });
    write(`${directory}/restored-ready.json`, { sourceHash: source.sourceHash, view: actual });
    proof = { exact: true, sameProcess: true, pid: process.pid, fromTick: pending.view.simulation.tick,
      toTick: actual.simulation.tick, updates: ticks, expectedHash: hash(JSON.stringify(ready.view)),
      actualHash: hash(JSON.stringify(actual)), proofAssets, elapsedMs: Date.now() - started - playElapsedMs };
    write(`${directory}/proof.json`, proof);
  } catch (error) { failure = error.stack ?? String(error); }
  finally {
    view?.dispose(); renderer?.dispose();
    if (restoreFetch) globalThis.fetch = restoreFetch;
    hook.deregister();
    const drift = Object.entries(loaded).filter(([path, entry]) => !existsSync(`${root}${path}`) || digest(`${root}${path}`) !== entry.rawHash)
      .map(([path, entry]) => ({ path, loaded: entry.rawHash, current: existsSync(`${root}${path}`) ? digest(`${root}${path}`) : null }));
    const revision = hash(JSON.stringify(Object.entries(loaded).sort(([left], [right]) => left.localeCompare(right))));
    const result = read(`${directory}/result.json`), integrity = read(`${directory}/integrity.json`);
    const source = read(`${directory}/source.json`);
    const changedSources = source ? Object.entries(source.sources).filter(([extension, value]) =>
      digest(`${root}raw_cd/DC/SCENARIO/ALIEN/ALIEN14.${extension}`) !== value).map(([extension]) => extension) : [];
    const changedAssets = Object.entries(integrity?.fetched ?? {}).filter(([path, value]) =>
      digest(`${root}public${path}`) !== value).map(([path]) => path);
    const accepted = !failure && proof?.exact === true && changedSources.length === 0 && changedAssets.length === 0;
    write(`${output}/worker-result.json`, { accepted, status: accepted ? "EXACT_READY_WIN" : result?.status ?? "RUNTIME_BLOCKER",
      mission: "A14", mode: "Node/NullCanvas; no browser", loadedRuntimeRevision: revision, loadedModules: Object.keys(loaded).length,
      drift, currentRuntimeClaim: false, changedSources, changedAssets, playElapsedMs, elapsedMs: Date.now() - started,
      pid: process.pid, result, proof, failure });
    process.exitCode = accepted ? 0 : 1;
  }
}

async function supervise() {
  const output = mkdtempSync("/tmp/dc-a14-bounded-20260923-");
  const started = Date.now();
  write(`${output}/launch.json`, { output, supervisorPid: process.pid, started, playCapMs: 180000, totalCapMs: 300000,
    childCapMs: 295000, mission: "A14", driverHash: digest(driver), fresh: true, noBrowser: true });
  console.log(JSON.stringify({ kind: "A14_START", output, supervisorPid: process.pid }));
  const descriptor = openSync(`${output}/worker.log`, "wx");
  let child, exit, deadlinePhase = "play", deadlineHit;
  let timer;
  try {
    child = spawn(process.execPath, ["--import", `${root}node_modules/tsx/dist/loader.mjs`, fileURLToPath(import.meta.url),
      "--a14-worker", output], { cwd: root, stdio: ["ignore", descriptor, descriptor, "ipc"] });
    const enforce = () => { deadlineHit = deadlinePhase; child.kill("SIGKILL"); };
    timer = setTimeout(enforce, Math.max(1, 180000 - (Date.now() - started)));
    child.on("message", message => {
      if (message.kind !== "play-finished" || deadlineHit) return;
      clearTimeout(timer);
      deadlinePhase = "proof";
      timer = setTimeout(enforce, Math.max(1, 295000 - (Date.now() - started)));
    });
    exit = await new Promise(resolve => {
      child.once("error", error => resolve({ code: null, signal: null, error: error.message }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);
  } finally { closeSync(descriptor); }
  const receipt = { pid: child.pid, ...exit, deadlineHit, reaped: !alive(child.pid) };
  const workerResult = read(`${output}/worker-result.json`);
  const summary = { ...workerResult, output, receipt, supervisorPid: process.pid, elapsedMs: Date.now() - started,
    accepted: workerResult?.accepted === true && receipt.code === 0 && receipt.reaped && Date.now() - started <= 300000,
    status: workerResult?.status ?? "HARD_DEADLINE", ownedWorkersAlive: alive(child.pid) ? [child.pid] : [] };
  write(`${output}/summary.json`, summary);
  console.log(JSON.stringify({ kind: "A14_FINISH", ...summary }));
  process.exitCode = summary.accepted ? 0 : 1;
}

if (process.argv.includes("--a14-worker")) await worker(process.argv.at(-1));
else if (process.argv.includes("--run")) await supervise();