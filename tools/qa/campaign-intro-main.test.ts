import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import ts from "typescript";
import { shouldShowCampaignIntro } from "../../src/ui/campaign-intro";

const main = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("main.ts", main, ts.ScriptTarget.Latest, true);
const launch = parsed.statements.find((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "startCampaign")!;
const source = launch.getText(parsed);
const constructorBoundary = source.indexOf("    pendingMission = nextSkirmish;");
assert.ok(constructorBoundary > source.indexOf("await showCampaignIntro"));
const executable = ts.transpileModule(source.slice(0, constructorBoundary) + "\n} catch (error) { throw error; } }", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness() {
  let finishIntro: (decision: "deploy" | "cancel") => void = () => { throw new Error("Intro not started"); };
  let finishLoad: (mission: unknown) => void = () => { throw new Error("Load not started"); };
  const events: string[] = [];
  const node = () => ({ hidden: false, disabled: false, textContent: "", classList: { remove() {} } });
  class View {
    constructor() { events.push("construct"); }
    static restore() { events.push("restore"); return new View(); }
    static importLegacy() { events.push("import"); return { view: new View() }; }
  }
  const context = vm.createContext({
    assetMode: "campaign", loadingToken: 0, skirmish: null, gameSessionMode: null,
    resetMissionControls() {}, cancelCampaignIntro() { events.push("abort-previous"); }, cancelCinematic() {},
    audio: undefined, missionMusic: undefined, campaignFactionButtons: [node(), node()],
    campaignMissionPicker: { setDisabled() {} }, checkpointRuntimeProfile() {},
    campaignConstructionPolicy() {},
    loadCampaignMission() { events.push("load"); return new Promise((resolve) => { finishLoad = resolve; }); },
    shouldShowCampaignIntro,
    showCampaignIntro() { events.push("intro"); return new Promise<"deploy" | "cancel">((resolve) => { finishIntro = resolve; }); },
    showCampaignLauncher() { events.push("launcher"); }, MissionView: View,
    missionCanvas: {}, previewStage: {}, updateSkirmishStats() {}, renderArchiveList() {},
    ...Object.fromEntries(["missionResult", "missionResultAction", "missionShell", "campaignControls", "objectivesPanel",
      "assetLab", "campaignLauncher", "continueMissionButton", "loadState"].map((name) => [name, node()])),
  });
  vm.runInContext(executable, context);
  return {
    events, context,
    start: (...args: unknown[]) => (context.startCampaign as (...args: unknown[]) => Promise<void>)(...args),
    loaded: async () => { finishLoad({ briefing: { rawText: "full briefing", plainText: "full briefing" } }); await setImmediate(); },
    finish: (decision: "deploy" | "cancel") => finishIntro(decision),
  };
}

test("main intro integration: load first, no view or ticks until deployment", async () => {
  const run = harness();
  const pending = run.start("human");
  assert.deepEqual(run.events, ["abort-previous", "load"]);
  await run.loaded();
  assert.deepEqual(run.events, ["abort-previous", "load", "intro"]);
  run.finish("deploy");
  await pending;
  assert.deepEqual(run.events, ["abort-previous", "load", "intro", "construct"]);
});

test("main intro integration: cancel or superseded token never constructs a view", async () => {
  for (const stale of [false, true]) {
    const run = harness();
    const pending = run.start("human", 1);
    await run.loaded();
    if (stale) run.context.loadingToken += 1;
    run.finish(stale ? "deploy" : "cancel");
    await pending;
    assert.equal(run.events.includes("construct"), false);
    assert.equal(run.events.includes("launcher"), !stale);
  }
});

test("main intro integration: saved/imported/retry/next/alien/later launches bypass intro", async () => {
  for (const args of [
    ["human", 1, {}], ["human", 1, {}, undefined, undefined, {}],
    ["human", 1, undefined, undefined, undefined, undefined, "retry"],
    ["human", 1, undefined, undefined, undefined, undefined, "next"],
    ["alien", 1], ["human", 2],
  ]) {
    const run = harness();
    const pending = run.start(...args);
    await run.loaded();
    await pending;
    assert.equal(run.events.includes("intro"), false);
    assert.equal(run.events.includes("construct"), true);
  }
});

test("main intro integration: picker/faction fresh routes, explicit retries and HMR cancellation remain wired", () => {
  assert.match(main, /createCampaignMissionPicker[\s\S]*?startCampaign\(faction, missionNumber, undefined, undefined, \{ runtimeProfile \}\)/);
  assert.match(main, /startCampaign\(button.dataset.campaignFaction as Faction\)/);
  assert.match(main, /undefined, "retry"/);
  assert.match(main, /undefined, action.missionNumber === campaignMissionNumber \? "retry" : "next"/);
  assert.match(main, /function showCampaignLauncher\(\): void \{\s+cancelCampaignIntro\(\)/);
  assert.match(main, /function showCampaignLauncher\(\)[\s\S]*?continueMissionButton.disabled = false/);
  assert.match(main, /\(import\.meta as ImportMeta & \{ hot\?: \{ dispose\(callback: \(\) => void\): void \} \}\)\.hot\s+\?\.dispose\(\(\) => \{\s+\+\+loadingToken;\s+cancelCampaignIntro\(\);\s+cancelCinematic\(\);/);
  assert.match(main, /mobileControls\?\.dispose\(\);\s+mobileMenu\?\.dispose\(\);/);
  assert.match(main, /id="mission-mute"[^>]*checked/);
});

test("opening movie is opt-in, with no webdriver-only startup exception", () => {
  const initialize = parsed.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "initialize")!;
  assert.doesNotMatch(initialize.getText(parsed), /showCinematic|INTRO_CINEMATIC|webdriver/);
  assert.match(main, /"#play-intro"\)\.addEventListener\("click", \(\) => void showCinematic\(INTRO_CINEMATIC\)\)/);
});