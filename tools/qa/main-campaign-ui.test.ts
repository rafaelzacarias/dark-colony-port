import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { campaignConstructionPolicy, campaignResultAction, loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { campaignMissionSelection } from "../../src/ui/campaign-mission-picker";

const source = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const functionNames = new Set([
  "activeMission", "resetMissionControls", "hideCampaignUi", "showCampaignLauncher",
  "refreshMissionSave", "startCampaign", "updateSkirmishStats", "cancelMissionDrag",
  "checkpointRuntimeProfile",
]);
const functions = parsed.statements.filter((statement) => ts.isFunctionDeclaration(statement)
  && statement.name && functionNames.has(statement.name.text)).map((statement) => statement.getText(parsed)).join("\n");
const handlers = parsed.statements.filter((statement) => ts.isExpressionStatement(statement)
  && /^(exitCampaign|saveMissionButton|continueMissionButton|missionResultAction|element<HTMLButtonElement>\("#mission-result-exit"\))\.addEventListener/.test(statement.getText(parsed)))
  .map((statement) => statement.getText(parsed)).join("\n");
const keyboardHandler = parsed.statements.find((statement) => ts.isExpressionStatement(statement)
  && statement.getText(parsed).startsWith('window.addEventListener("keydown",'))!.getText(parsed);

const resizeSource = parsed.statements.filter((statement) =>
  (ts.isFunctionDeclaration(statement) && statement.name?.text === "layoutMissionShell")
  || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && declaration.name.text === "missionResizeObserver"))
  || (ts.isExpressionStatement(statement)
    && /^(missionResizeObserver\?\.observe\(|window\.addEventListener\("(?:resize|pagehide)",)/.test(statement.getText(parsed))))
  .map((statement) => statement.getText(parsed)).join("\n");

function resizeHarness(observerAvailable = true) {
  const ui = harness();
  const bounds = { width: 1200, height: 900 };
  const calls = { bounds: 0, draw: 0, radar: 0, musicDisposals: 0, audioDisposals: 0 };
  const observers: FakeResizeObserver[] = [];
  const listeners = new Map<string, (event: { persisted?: boolean }) => void>();
  class FakeResizeObserver {
    targets: unknown[] = [];
    disconnects = 0;
    constructor(readonly callback: () => void) { observers.push(this); }
    observe(target: unknown) { this.targets.push(target); }
    disconnect() { this.disconnects += 1; this.targets = []; }
    notify() { if (this.targets.length) this.callback(); }
  }
  ui.context.previewStage.getBoundingClientRect = () => { calls.bounds += 1; return bounds; };
  ui.context.window = {
    addEventListener(type: string, callback: (event: { persisted?: boolean }) => void) { listeners.set(type, callback); },
  };
  if (observerAvailable) ui.context.ResizeObserver = FakeResizeObserver;
  ui.context.drawFrame = () => { calls.draw += 1; };
  ui.context.updateMissionRadar = () => { calls.radar += 1; };
  ui.context.missionMusic.dispose = () => { calls.musicDisposals += 1; };
  ui.context.audio.dispose = () => { calls.audioDisposals += 1; };
  runInContext(ts.transpileModule(resizeSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, ui.context);
  return { ...ui, bounds, calls, observers,
    shellStyle: ui.element("missionShell").style as { transform?: string },
    dispatch(type: string, event: { persisted?: boolean } = {}) {
      assert.ok(listeners.has(type));
      listeners.get(type)!(event);
    },
  };
}

function keyboardHarness() {
  const ui = harness();
  const calls: unknown[][] = [];
  class FakeElement {
    constructor(readonly tagName: string, readonly isContentEditable = false) {}
  }
  let keydown!: (event: KeyboardEvent) => void;
  ui.context.HTMLElement = FakeElement;
  ui.context.window = { addEventListener(_type: string, handler: typeof keydown) { keydown = handler; } };
  ui.context.setMissionOrder = (order: string) => calls.push(["order", order]);
  ui.context.stepFrame = (step: number) => calls.push(["frame", step]);
  runInContext(ts.transpileModule(keyboardHandler, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, ui.context);
  return { ...ui, calls, FakeElement,
    async startMission() {
      await ui.start("alien");
      Object.assign(ui.views[0], {
        stopSelected: () => calls.push(["stop"]),
        selectAllPlayerUnits: () => calls.push(["all"]),
        selectVisibleInfantry: () => calls.push(["infantry"]),
        panByCells: (horizontal: number, vertical: number) => calls.push(["pan", horizontal, vertical]),
      });
    },
    press(key: string, modifiers: Partial<KeyboardEvent> = {}, path: unknown[] = []) {
      const event = { key, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
        ...modifiers, composedPath: () => path,
        preventDefault() { this.defaultPrevented = true; } };
      keydown(event as KeyboardEvent);
      return event;
    },
  };
}

function node() {
  const listeners = new Map<string, () => unknown>();
  return {
    hidden: false, disabled: false, textContent: "", title: "", src: "", style: {},
    parentElement: { hidden: false },
    classList: { add() {}, remove() {} },
    setAttribute() {}, replaceChildren() {},
    addEventListener(type: string, callback: () => unknown) { listeners.set(type, callback); },
    async click() { if (!this.hidden && !this.disabled) await listeners.get("click")?.(); },
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function harness() {
  const nodes = new Map<string, ReturnType<typeof node>>();
  const element = (name: string) => {
    if (!nodes.has(name)) nodes.set(name, node());
    return nodes.get(name)!;
  };
  const views: FakeMission[] = [];
  const loads: { faction: string; number: number; runtimeProfile?: "browser-adapted" }[] = [];
  const constructions: unknown[] = [];
  const restores: unknown[] = [];
  const radars: { disposals: number; dispose(): void }[] = [];
  let nextInitialization: ReturnType<typeof deferred> | undefined;
  class FakeMission {
    disposals = 0;
    missionDiagnostic: string | null = null;
    missionOutcome: { ready: boolean; resultCode: number; reasonCode: number } | null = null;
    terrainImage = {};
    selectedIds = [1];
    movementStance = "assault";
    orderMode = "assault";
    simulation = { snapshot: { units: [{ id: 1, health: 100, activity: "idle" }] } };
    playerFaction: string;
    initialization = nextInitialization;
    constructor(_canvas: unknown, _stage: unknown, readonly callbacks: { onStats(stats: unknown): void },
      readonly mission: { faction: string; runtimeProfile?: "browser-adapted"; scenario: { title: string; outcomes: unknown[] } }) {
      this.playerFaction = mission.faction;
      nextInitialization = undefined;
      views.push(this);
    }
    static restore(...args: [...ConstructorParameters<typeof FakeMission>, unknown]) {
      restores.push(args[4]);
      return new FakeMission(args[0], args[1], args[2], args[3]);
    }
    async initialize() { await this.initialization?.promise; }
    dispose() { this.disposals += 1; }
    resetClock() {}
    render() { this.callbacks.onStats(this.stats()); }
    stats() { return { tick: 16, selectedCell: "1,1", daylight: "DAY", selectedState: "IDLE",
      healthAndResources: "100", selectedCount: 1, missionDiagnostic: this.missionDiagnostic }; }
    isOwnedUnit() { return true; }
    checkpoint() { return { faction: this.playerFaction, session: { options: {
      ...(this.mission.runtimeProfile ? { runtimeProfile: this.mission.runtimeProfile } : {}),
    } } }; }
  }
  const saved = { version: 1, faction: "human", missionNumber: 1, savedAt: "2026-09-21T00:00:00Z",
    checkpoint: { original: true }, controlGroups: Array.from({ length: 10 }, () => []) };
  const writes: unknown[] = [];
  const music = { starts: 0, stops: 0, stop() { this.stops += 1; }, prepareFromGesture() {},
    async start() { this.starts += 1; } };
  const context = createContext({
    console, Error, Date, String, SIMULATION_TICKS_PER_SECOND: 20,
    assetMode: "campaign", gameSessionMode: null, campaignFaction: null, campaignMissionNumber: 1,
    campaignRuntimeProfile: undefined,
    loadingToken: 0, pendingMission: null, skirmish: null, radar: null, savedMission: saved,
    diagnosticCleanupMission: undefined,
    missionDragStart: null, missionDragMoved: false, missionPointer: null,
    metadata: null, animationMetadata: null, activeSequence: null, atlasImage: null,
    MissionView: FakeMission, missionMusic: music,
    audio: { stops: 0, stopAll() { this.stops += 1; }, async unlock() {} },
    controlGroups: { reset() {}, restore() {}, state: { groups: saved.controlGroups } },
    campaignFactionButtons: [node(), node()], element,
    campaignMissionPicker: { setDisabled(disabled: boolean) { element("picker").disabled = disabled; } },
    constructionPanel: { reset() {} }, baseTabs: node(), baseTab: "build", failedLegacyImport: null,
    Option: class {}, document: { createElement: () => node() },
    updateMissionProduction() {}, updateMissionCursor() {}, updateMissionRadar() {}, updateDeploymentControl() {},
    layoutMissionShell() {}, renderArchiveList() {}, stopMedia() {}, setPlayback() {}, configureArchiveBrowser() {},
    campaignResultAction,
    campaignConstructionPolicy,
    async loadCampaignMission(faction: string, number: number, runtimeProfile?: "browser-adapted", construction?: unknown) {
      loads.push({ faction, number, runtimeProfile });
      constructions.push(construction);
      if (number === 3) throw new Error("unsupported mission 3");
      const title = `${faction}${String(number).padStart(2, "0")}`;
      return { faction, runtimeProfile, scenario: { title, source: { path: `${title}.SCN` }, outcomes: [] },
        briefing: { objectives: ["Survive"], plainText: "Survive" } };
    },
    async readMissionSave() { return saved; }, async writeMissionSave(value: unknown) { writes.push(value); },
    createRadar() {
      const radar = { disposals: 0, dispose() { this.disposals += 1; } };
      radars.push(radar);
      return radar;
    },
  });
  for (const name of ["missionProduction", "productionChoices", "legacyPortraitImage", "saveMissionStatus",
    "saveMissionButton", "missionMusicControl", "radarCanvas", "missionCanvas", "selectionBox", "missionMessage",
    "missionResult", "missionResultAction", "campaignLauncher", "campaignControls", "missionShell", "objectivesPanel",
    "assetLab", "previewPanel", "canvas", "datasetTitle", "archivePath", "archiveName", "encodingBadge", "animationState",
    "frameLabel", "anchorLabel", "atlasLabel", "paletteLabel", "payloadLabel", "frameSize", "frameAnchor", "atlasSize",
    "paletteScale", "payloadSize", "frameWatermark", "archiveSummary", "decoderStatus", "loadState", "continueMissionButton",
    "continueStatus", "previewStage", "campaignFactionLabel", "legacyMissionName", "objectivesList", "missionResultTitle",
    "missionResultDetail", "moveUnits", "campaignSelection", "legacyTick", "exitCampaign"]) context[name] = element(name);
  runInContext(ts.transpileModule(`${functions}\n${handlers}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  const drag = { cancellations: 0 };
  const cancelMissionDrag = context.cancelMissionDrag;
  context.cancelMissionDrag = () => { drag.cancellations += 1; cancelMissionDrag(); };
  return { context, element, views, loads, constructions, restores, radars, saved, writes, music, drag,
    deferInitialization() { nextInitialization = deferred(); return nextInitialization; },
    start(faction: string, number = 1) { return context.startCampaign(faction, number) as Promise<void>; },
    async exit() { await element("#mission-result-exit").click(); await Promise.resolve(); },
    async settle() { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); },
  };
}

test("mission picker main wiring preserves strict M01, selected adapted profiles, construction and quick starts", async () => {
  const declaration = parsed.statements.find((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((entry) => entry.name.getText(parsed) === "campaignMissionPicker"));
  assert.ok(declaration);
  for (const [faction, number] of [["human", 1], ["alien", 1], ["human", 7], ["alien", 15], ["alien", 10]] as const) {
    const ui = harness();
    let launch!: (selection: ReturnType<typeof campaignMissionSelection>) => void;
    ui.context.createCampaignMissionPicker = (_host: unknown, callback: typeof launch) => {
      launch = callback;
      return ui.context.campaignMissionPicker;
    };
    runInContext(ts.transpileModule(declaration.getText(parsed), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText, ui.context);
    launch(campaignMissionSelection(faction, number));
    assert.equal(ui.element("picker").disabled, true);
    await ui.settle();
    assert.deepEqual(ui.loads, [{ faction, number, runtimeProfile: number === 1 ? undefined : "browser-adapted" }]);
    assert.deepEqual(ui.constructions[0], campaignConstructionPolicy(faction, number, number === 1 ? undefined : "browser-adapted"));
    assert.equal(ui.element("picker").disabled, false);
    assert.equal(ui.element("missionResult").hidden, true, ui.element("decoderStatus").textContent);
    assert.equal(ui.element("campaignControls").hidden, false);
    await ui.exit();
    assert.equal(ui.element("campaignLauncher").hidden, false);
    assert.equal(ui.writes.length, 0);
  }
  assert.match(source, /button\.addEventListener\("click", \(\) => void startCampaign\(button\.dataset\.campaignFaction as Faction\)\)/);
  assert.match(source, /data-campaign-faction="human"/);
  assert.match(source, /data-campaign-faction="alien"/);
});

for (const faction of ["human", "alien"] as const) {
  test(`${faction} Next starts adapted mission 02 and Save/Continue retains its profile`, async () => {
    const ui = harness();
    await ui.start(faction);
    assert.deepEqual(ui.loads, [{ faction, number: 1, runtimeProfile: undefined }]);
    assert.equal(ui.context.campaignRuntimeProfile, undefined);
    assert.equal(ui.element("campaignFactionLabel").textContent, `${faction.toUpperCase()}01`);
    assert.equal(ui.element("legacyMissionName").hidden, true);
    assert.equal(ui.element("encodingBadge").textContent, "20 TPS");
    ui.views[0].missionOutcome = { ready: true, resultCode: 0, reasonCode: 0 };
    ui.views[0].render();
    assert.equal(ui.element("missionResultAction").textContent, "NEXT MISSION");
    await ui.element("missionResultAction").click();
    await ui.settle();
    assert.deepEqual(ui.loads[1], { faction, number: 2, runtimeProfile: "browser-adapted" });
    assert.equal(ui.context.campaignMissionNumber, 2);
    assert.equal(ui.context.campaignRuntimeProfile, "browser-adapted");
    assert.equal(ui.context.skirmish, ui.views[1]);
    assert.equal(ui.element("missionResult").hidden, true);
    assert.equal(ui.element("campaignControls").hidden, false);
    assert.equal(ui.element("legacyMissionName").hidden, false);
    assert.equal(ui.element("legacyMissionName").textContent, "BROWSER ADAPTED");
    assert.match(ui.element("campaignFactionLabel").title, /BROWSER ADAPTED/);
    assert.equal(ui.element("encodingBadge").textContent, "20 TPS / BROWSER ADAPTED");
    await ui.element("saveMissionButton").click();
    assert.equal(ui.writes.length, 1);
    const saved = JSON.parse(JSON.stringify(ui.writes[0]));
    assert.equal(saved.version, 1);
    assert.equal(saved.faction, faction);
    assert.equal(saved.missionNumber, 2);
    assert.equal(saved.checkpoint.session.options.runtimeProfile, "browser-adapted");
    ui.context.readMissionSave = async () => saved;
    await ui.exit();
    await ui.element("continueMissionButton").click();
    await ui.settle();
    assert.deepEqual(ui.loads[2], { faction, number: 2, runtimeProfile: "browser-adapted" });
    assert.equal(ui.restores[0], saved.checkpoint);
    assert.equal(ui.context.skirmish, ui.views[2]);
    assert.equal(ui.element("legacyMissionName").hidden, false);
    await ui.start(faction);
    assert.equal(ui.element("legacyMissionName").hidden, true);
    assert.equal(ui.element("campaignFactionLabel").textContent, `${faction.toUpperCase()}01`);
    assert.equal(ui.element("encodingBadge").textContent, "20 TPS");
  });

  test(`${faction} real mission 02 loader metadata survives JSON checkpoint and independent reload`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string) => {
      assert.ok(input.startsWith("/assets/generated/"));
      return new Response(await readFile(new URL(`../../public${input}`, import.meta.url)));
    });
    const ui = harness();
    const loaded: Awaited<ReturnType<typeof loadCampaignMission>>[] = [];
    ui.context.loadCampaignMission = async (...args: Parameters<typeof loadCampaignMission>) => {
      const mission = await loadCampaignMission(...args);
      loaded.push(mission);
      return mission;
    };
    await ui.start(faction, 2);
    assert.equal(ui.element("missionResult").hidden, true, ui.element("missionResultDetail").textContent);
    assert.equal(ui.views.length, 1);
    const mission = loaded[0];
    assert.equal(ui.views[0].mission, mission);
    assert.equal(mission.runtimeProfile, "browser-adapted");
    assert.ok(mission.browserAi);
    assert.ok(mission.browserEconomy);
    assert.ok(mission.sourceProduction?.production);
    const canvas = { width: 512, height: 452, getContext: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
    const callbacks = { onStats() {}, onUnitsChanged() {} };
    const view = new MissionView(canvas, {} as HTMLElement, callbacks, mission);
    assert.equal(view.missionDiagnostic, undefined);
    const saved = JSON.parse(JSON.stringify(view.checkpoint()));
    assert.equal(saved.version, 1);
    assert.equal(saved.session.options.runtimeProfile, "browser-adapted");
    assert.ok(saved.browserAi);
    assert.ok(saved.economy);
    const reloaded = await loadCampaignMission(faction, 2, ui.context.checkpointRuntimeProfile(saved));
    const restored = MissionView.restore(canvas, {} as HTMLElement, callbacks, reloaded, saved);
    assert.deepEqual(restored.checkpoint(), saved);
    restored.dispose();
    view.dispose();
    await assert.rejects(loadCampaignMission(faction, 2), /Unsupported mission/);
  });
}

test("Continue uses the exact checkpoint profile for older strict and adapted higher missions", async () => {
  for (const runtimeProfile of [undefined, "browser-adapted"] as const) {
    for (const diagnostic of [false, true]) {
      const ui = harness();
      const checkpoint = { session: { options: runtimeProfile ? { runtimeProfile } : {} } };
      ui.context.readMissionSave = async () => ({ ...ui.saved, missionNumber: 11, checkpoint });
      await ui.exit();
      await ui.element("continueMissionButton").click();
      await ui.settle();
      assert.deepEqual(ui.loads[0], { faction: "human", number: 11, runtimeProfile });
      assert.equal(ui.restores[0], checkpoint);
      assert.equal(ui.context.campaignRuntimeProfile, runtimeProfile);
      assert.equal(ui.element("legacyMissionName").hidden, runtimeProfile === undefined);
      if (diagnostic) ui.views[0].missionDiagnostic = "Stopped";
      else ui.views[0].missionOutcome = { ready: true, resultCode: 1, reasonCode: 0 };
      ui.views[0].render();
      assert.equal(ui.element("missionResultAction").textContent, "RETRY MISSION");
      await ui.element("missionResultAction").click();
      await ui.settle();
      assert.deepEqual(ui.loads[1], { faction: "human", number: 11, runtimeProfile });
      assert.equal(ui.restores.length, 1);
      assert.equal(ui.context.skirmish, ui.views[1]);
      await ui.start("human", 11);
      assert.deepEqual(ui.loads[2], { faction: "human", number: 11, runtimeProfile: "browser-adapted" });
    }
  }
});

test("unknown checkpoint profiles fail visibly without fallback or save replacement", async () => {
  const ui = harness();
  ui.context.readMissionSave = async () => ({ ...ui.saved, missionNumber: 2,
    checkpoint: { session: { options: { runtimeProfile: "unknown" } } } });
  await ui.exit();
  await ui.element("continueMissionButton").click();
  await ui.settle();
  assert.equal(ui.loads.length, 0);
  assert.equal(ui.views.length, 0);
  assert.equal(ui.element("missionResult").hidden, false);
  assert.match(ui.element("missionResultDetail").textContent, /Unknown saved campaign runtime profile/);
  assert.equal(ui.writes.length, 0);
});

test("mission container resize synchronously fits the 640x480 shell without a window event or scene work", async () => {
  const ui = resizeHarness();
  await ui.start("alien");
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(1.875)");
  assert.equal(ui.observers.length, 1);
  assert.deepEqual(ui.observers[0].targets, [ui.element("previewStage")]);
  let renders = 0;
  ui.views[0].render = () => { renders += 1; };
  const mission = ui.context.skirmish;
  const snapshot = JSON.stringify(ui.views[0].simulation.snapshot);
  const checkpoint = JSON.stringify(ui.views[0].checkpoint());
  const token = ui.context.loadingToken;
  const radarCalls = ui.calls.radar;
  const musicStarts = ui.music.starts;
  const musicStops = ui.music.stops;
  Object.assign(ui.bounds, { width: 390, height: 844 });
  ui.observers[0].notify();
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(0.609375)");
  assert.equal(640 * 0.609375, 390);
  assert.equal(480 * 0.609375, 292.5);
  for (let callback = 0; callback < 20; callback += 1) ui.observers[0].notify();
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(0.609375)");
  ui.bounds.height = 240;
  ui.observers[0].notify();
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(0.5)");
  Object.assign(ui.bounds, { width: 1200, height: 900 });
  ui.observers[0].notify();
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(1.875)");
  assert.equal(ui.calls.draw, 0);
  assert.equal(ui.calls.radar, radarCalls);
  assert.equal(renders, 0);
  assert.equal(ui.context.skirmish, mission);
  assert.equal(JSON.stringify(ui.views[0].simulation.snapshot), snapshot);
  assert.equal(JSON.stringify(ui.views[0].checkpoint()), checkpoint);
  assert.equal(ui.context.loadingToken, token);
  assert.equal(ui.views.length, 1);
  assert.equal(ui.radars.length, 1);
  assert.equal(ui.music.starts, musicStarts);
  assert.equal(ui.music.stops, musicStops);
  assert.equal(ui.context.savedMission, ui.saved);
  assert.equal(ui.writes.length, 0);
});

test("mission container resize ignores a hidden shell and reuses one observer on the next mission", async () => {
  const ui = resizeHarness();
  await ui.start("alien");
  await ui.exit();
  assert.equal(ui.element("missionShell").hidden, true);
  const previousTransform = ui.shellStyle.transform;
  const boundsReads = ui.calls.bounds;
  Object.assign(ui.bounds, { width: 390, height: 844 });
  ui.observers[0].notify();
  assert.equal(ui.shellStyle.transform, previousTransform);
  assert.equal(ui.calls.bounds, boundsReads);
  await ui.start("human");
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(0.609375)");
  ui.bounds.height = 240;
  ui.observers[0].notify();
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(0.5)");
  assert.equal(ui.observers.length, 1);
  assert.equal(ui.observers[0].targets.length, 1);
  assert.equal(ui.observers[0].disconnects, 0);
  assert.equal(ui.calls.draw, 0);
  assert.equal(ui.writes.length, 0);
});

test("mission resize retains the window fallback and tolerates an unavailable ResizeObserver", async () => {
  const ui = resizeHarness(false);
  await ui.start("alien");
  assert.equal(ui.observers.length, 0);
  Object.assign(ui.bounds, { width: 390, height: 844 });
  ui.dispatch("resize");
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(0.609375)");
  assert.equal(ui.calls.draw, 1);
  ui.dispatch("pagehide", { persisted: false });
  assert.equal(ui.calls.musicDisposals, 1);
  assert.equal(ui.calls.audioDisposals, 1);
  assert.equal(ui.writes.length, 0);
});

test("mission resize observer survives persisted pagehide and disconnects on final pagehide", async () => {
  const ui = resizeHarness();
  await ui.start("alien");
  ui.dispatch("pagehide", { persisted: true });
  assert.equal(ui.observers[0].disconnects, 0);
  assert.equal(ui.calls.musicDisposals, 0);
  assert.equal(ui.calls.audioDisposals, 0);
  assert.equal(ui.views[0].disposals, 1);
  await ui.start("human");
  Object.assign(ui.bounds, { width: 390, height: 844 });
  ui.observers[0].notify();
  assert.equal(ui.shellStyle.transform, "translate(-50%, -50%) scale(0.609375)");
  assert.equal(ui.observers.length, 1);
  ui.dispatch("pagehide", { persisted: false });
  assert.equal(ui.observers[0].disconnects, 1);
  assert.equal(ui.observers[0].targets.length, 0);
  assert.equal(ui.calls.musicDisposals, 1);
  assert.equal(ui.calls.audioDisposals, 1);
  assert.equal(ui.views[1].disposals, 1);
  assert.equal(ui.writes.length, 0);
});

test("startup failure exposes a result exit and restores Continue without overwriting the Human save", async () => {
  const ui = harness();
  await ui.start("alien", 3);
  assert.equal(ui.element("loadState").hidden, true);
  assert.equal(ui.element("missionShell").hidden, false);
  assert.equal(ui.element("missionResult").hidden, false);
  assert.match(ui.element("missionResultDetail").textContent, /UNSUPPORTED MISSION ALIEN 03/);
  await ui.exit();
  assert.equal(ui.element("campaignLauncher").hidden, false);
  assert.equal(ui.element("continueMissionButton").hidden, false);
  assert.equal(ui.element("continueMissionButton").disabled, false);
  assert.equal(ui.context.savedMission, ui.saved);
  assert.equal(ui.writes.length, 0);
});

test("older strict mission 02 rejection remains visible with an actionable exit, not a spinner", async (context) => {
  context.mock.method(globalThis, "fetch", async (input: string) => {
    assert.ok(input.startsWith("/assets/generated/"));
    return new Response(await readFile(new URL(`../../public${input}`, import.meta.url)));
  });
  for (const faction of ["human", "alien"]) {
    const ui = harness();
    ui.context.loadCampaignMission = loadCampaignMission;
    await ui.context.startCampaign(faction, 2, { session: { options: {} } });
    assert.equal(ui.element("loadState").hidden, true);
    assert.equal(ui.element("missionShell").hidden, false);
    assert.equal(ui.element("missionResult").hidden, false);
    assert.equal(ui.element("#mission-result-exit").disabled, false);
    assert.match(ui.element("missionResultDetail").textContent,
      new RegExp(`Unsupported mission ${faction.toUpperCase()}/${faction.toUpperCase()}02:`));
    assert.equal(ui.views.length, 0);
    await ui.exit();
    assert.equal(ui.element("campaignLauncher").hidden, false);
    assert.equal(ui.element("continueMissionButton").disabled, false);
    assert.equal(ui.context.savedMission, ui.saved);
    assert.equal(ui.writes.length, 0);
  }
});

test("failed initialization disposes pending view and can start Alien fresh after Human selection", async () => {
  const ui = harness();
  await ui.start("human");
  const human = ui.views[0];
  const pending = ui.deferInitialization();
  const failed = ui.start("alien");
  await ui.settle();
  ui.views[1].missionDiagnostic = "Unsupported carrier at startup";
  pending.resolve();
  await failed;
  assert.equal(human.disposals, 1);
  assert.equal(ui.views[1].disposals, 1);
  assert.equal(ui.context.pendingMission, null);
  assert.equal(ui.context.skirmish, null);
  assert.equal(ui.radars[0].disposals, 1);
  assert.equal(ui.element("radarCanvas").hidden, true);
  assert.match(ui.element("missionResultDetail").textContent, /Unsupported carrier at startup/);
  await ui.exit();
  await ui.start("alien");
  const alien = ui.views[2];
  assert.equal(ui.context.skirmish, alien);
  assert.equal(ui.context.campaignFaction, "alien");
  assert.equal(ui.element("campaignFactionLabel").textContent, "ALIEN01");
  assert.match(ui.element("legacyPortraitImage").src, /ACOM\.png$/);
  assert.equal(ui.element("campaignControls").hidden, false);
  assert.equal(ui.element("radarCanvas").hidden, false);
  assert.equal(ui.element("missionResult").hidden, true);
  assert.equal(ui.element("saveMissionButton").disabled, false);
  assert.equal(ui.context.savedMission, ui.saved);
  assert.equal(ui.writes.length, 0);
  const label = ui.element("campaignSelection").textContent;
  human.callbacks.onStats({ ...human.stats(), selectedCount: 99 });
  assert.equal(ui.element("campaignSelection").textContent, label);
});

test("late pending completion cannot replace or dispose the newer faction or restart its music", async () => {
  for (const rejectOld of [false, true]) {
    const ui = harness();
    const pending = ui.deferInitialization();
    const oldStart = ui.start("human");
    await ui.settle();
    const human = ui.views[0];
    await ui.start("alien");
    const alien = ui.views[1];
    if (rejectOld) pending.reject(new Error("Old Human initialization failed"));
    else pending.resolve();
    await oldStart;
    assert.ok(human.disposals >= 1);
    assert.equal(alien.disposals, 0);
    assert.equal(ui.context.skirmish, alien);
    assert.equal(ui.context.pendingMission, null);
    assert.equal(ui.context.campaignFaction, "alien");
    assert.equal(ui.element("campaignFactionLabel").textContent, "ALIEN01");
    assert.equal(ui.element("missionResult").hidden, true);
    assert.equal(ui.element("continueMissionButton").disabled, false);
    assert.equal(ui.radars.length, 1);
    assert.equal(ui.radars[0].disposals, 0);
    assert.equal(ui.music.starts, 1);
  }
});

for (const readyOutcome of [false, true]) test(`runtime diagnostic stays visible and retries fresh (ready outcome: ${readyOutcome})`, async () => {
  const ui = harness();
  await ui.start("alien");
  const failed = ui.views[0];
  ui.element("objectivesPanel").hidden = false;
  failed.missionDiagnostic = "Unsupported carrier at tick 16";
  failed.missionOutcome = readyOutcome ? { ready: true, resultCode: 0, reasonCode: 0 } : null;
  const assertDiagnosticCleanup = (mission: typeof failed) => {
    const musicStops = ui.music.stops;
    const audioStops = ui.context.audio.stops;
    const dragCancellations = ui.drag.cancellations;
    ui.context.missionDragStart = { x: 1, y: 1 };
    ui.context.missionDragMoved = true;
    ui.element("selectionBox").hidden = false;
    ui.element("decoderStatus").textContent = mission.missionDiagnostic!;
    for (let frame = 0; frame < 120; frame += 1) {
      mission.callbacks.onStats({ ...mission.stats(), missionMessage: "Ordinary mission message" });
      assert.equal(ui.element("missionResultDetail").textContent, mission.missionDiagnostic);
      assert.equal(ui.element("missionMessage").textContent, "MISSION STOPPED");
      assert.equal(ui.element("missionMessage").title, mission.missionDiagnostic);
    }
    assert.equal(ui.music.stops - musicStops, 1);
    assert.equal(ui.context.audio.stops - audioStops, 1);
    assert.equal(ui.drag.cancellations - dragCancellations, 1);
    assert.equal(ui.context.missionDragStart, null);
    assert.equal(ui.context.missionDragMoved, false);
    assert.equal(ui.element("selectionBox").hidden, true);
  };
  assertDiagnosticCleanup(failed);
  assert.equal(ui.element("missionResult").hidden, false);
  assert.equal(ui.element("objectivesPanel").hidden, true);
  assert.equal(ui.element("missionResultTitle").textContent, "MISSION STOPPED");
  assert.equal(ui.element("missionResultDetail").textContent, failed.missionDiagnostic);
  assert.equal(failed.disposals, 0);
  assert.equal(ui.element("missionMusicControl").hidden, true);
  assert.equal(ui.element("missionResultAction").hidden, false);
  assert.equal(ui.element("missionResultAction").textContent, "RETRY MISSION");
  const diagnostic = ui.element("missionResultDetail").textContent;
  failed.render();
  assert.equal(ui.element("missionResultDetail").textContent, diagnostic);
  const musicStops = ui.music.stops;
  const audioStops = ui.context.audio.stops;
  const dragCancellations = ui.drag.cancellations;
  failed.missionDiagnostic = "A newer runtime diagnostic";
  failed.render();
  assert.equal(ui.element("missionResultDetail").textContent, failed.missionDiagnostic);
  assert.equal(ui.element("missionMessage").title, failed.missionDiagnostic);
  assert.equal(ui.music.stops, musicStops);
  assert.equal(ui.context.audio.stops, audioStops);
  assert.equal(ui.drag.cancellations, dragCancellations);
  await ui.element("saveMissionButton").click();
  assert.equal(ui.writes.length, 0);
  await ui.element("missionResultAction").click();
  await ui.settle();
  assert.equal(failed.disposals, 1);
  assert.equal(ui.radars[0].disposals, 1);
  assert.equal(ui.context.skirmish, ui.views[1]);
  assert.equal(ui.context.campaignFaction, "alien");
  assert.equal(ui.element("missionResult").hidden, true);
  assert.equal(ui.element("saveMissionButton").disabled, false);
  assert.equal(ui.context.savedMission, ui.saved);
  assert.equal(ui.element("continueMissionButton").disabled, false);
  ui.views[1].missionDiagnostic = diagnostic;
  assertDiagnosticCleanup(ui.views[1]);
  await ui.exit();
  assert.equal(ui.element("campaignLauncher").hidden, false);
  assert.equal(ui.element("continueMissionButton").disabled, false);
  assert.equal(ui.context.diagnosticCleanupMission, undefined);
  await ui.start("human");
  ui.views[2].missionDiagnostic = diagnostic;
  assertDiagnosticCleanup(ui.views[2]);
  assert.equal(ui.context.savedMission, ui.saved);
  assert.equal(ui.writes.length, 0);
});

test("Continue after startup failure restores Human even after a fresh Alien mission", async () => {
  const ui = harness();
  await ui.start("alien");
  await ui.start("alien", 3);
  await ui.exit();
  assert.match(ui.element("continueMissionButton").textContent, /CONTINUE HUMAN 01/);
  await ui.element("continueMissionButton").click();
  await ui.settle();
  assert.equal(ui.views.length, 2);
  assert.equal(ui.context.skirmish, ui.views[1]);
  assert.equal(ui.context.campaignFaction, "human");
  assert.equal(ui.element("campaignFactionLabel").textContent, "HUMAN01");
  assert.match(ui.element("legacyPortraitImage").src, /HCOM\.png$/);
  assert.equal(ui.element("missionResult").hidden, true);
  assert.equal(ui.writes.length, 0);
});

test("launcher reset cancels pending initialization without republishing its view, radar or music", async () => {
  const ui = harness();
  const pending = ui.deferInitialization();
  const start = ui.start("human");
  await ui.settle();
  ui.context.showCampaignLauncher();
  pending.resolve();
  await start;
  await ui.settle();
  assert.ok(ui.views[0].disposals >= 1);
  assert.equal(ui.context.pendingMission, null);
  assert.equal(ui.context.skirmish, null);
  assert.equal(ui.element("campaignLauncher").hidden, false);
  assert.equal(ui.element("continueMissionButton").disabled, false);
  assert.equal(ui.element("radarCanvas").hidden, true);
  assert.equal(ui.element("missionShell").hidden, true);
  assert.equal(ui.element("loadState").hidden, true);
  assert.equal(ui.radars.length, 0);
  assert.equal(ui.music.starts, 0);
});

test("failure after view installation disposes the active view and leaves an actionable diagnostic", async () => {
  const ui = harness();
  ui.context.createRadar = () => { throw new Error("Radar setup failed"); };
  await ui.start("alien");
  assert.equal(ui.views[0].disposals, 1);
  assert.equal(ui.context.skirmish, null);
  assert.equal(ui.context.pendingMission, null);
  assert.equal(ui.element("radarCanvas").hidden, true);
  assert.equal(ui.element("missionResult").hidden, false);
  assert.match(ui.element("missionResultDetail").textContent, /Radar setup failed/);
  assert.equal(ui.music.starts, 0);
  await ui.exit();
  assert.equal(ui.element("campaignLauncher").hidden, false);
  assert.equal(ui.element("continueMissionButton").disabled, false);
});

test("a late save completion or failure cannot disable or relabel the fresh Alien HUD", async () => {
  for (const rejectSave of [false, true]) {
    const ui = harness();
    const pending = deferred();
    ui.context.writeMissionSave = async (save: unknown) => { ui.writes.push(save); await pending.promise; };
    await ui.start("human");
    const save = ui.element("saveMissionButton").click();
    assert.equal(ui.element("saveMissionButton").disabled, true);
    assert.equal(ui.element("saveMissionStatus").textContent, "SAVING");
    await ui.element("exitCampaign").click();
    await ui.start("alien");
    if (rejectSave) pending.reject(new Error("Old save failed"));
    else pending.resolve();
    await save;
    assert.equal(ui.element("saveMissionButton").disabled, false);
    assert.equal(ui.element("saveMissionStatus").textContent, "");
    assert.equal(ui.element("saveMissionStatus").title, "");
    assert.equal(ui.element("campaignFactionLabel").textContent, "ALIEN01");
    assert.equal(ui.writes.length, 1);
    assert.equal((ui.writes[0] as { faction: string }).faction, "human");
  }
});

test("mission shortcuts ignore Ctrl/Meta/Alt commands and arrows without preventing browser defaults", async () => {
  const ui = keyboardHarness();
  await ui.startMission();
  for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
    for (const key of ["s", "S", "p", "P", "m", "M", "w", "j", "F2",
      "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      assert.equal(ui.press(key, { [modifier]: true }).defaultPrevented, false, `${modifier}+${key}`);
      assert.deepEqual(ui.calls, []);
      assert.equal(ui.element("objectivesPanel").hidden, true);
    }
  }
  assert.equal(ui.press("a", { altKey: true }).defaultPrevented, false);
  assert.deepEqual(ui.calls, []);
});

test("plain mission shortcuts still issue orders, stop, select infantry, toggle objectives and pan", async () => {
  const ui = keyboardHarness();
  await ui.startMission();
  for (const key of ["s", "p", "m", "a", "w", "F2", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    assert.equal(ui.press(key).defaultPrevented, true, key);
  }
  assert.deepEqual(ui.calls, [["stop"], ["order", "patrol"], ["order", "move"], ["order", "assault"],
    ["order", "waypoints"], ["infantry"], ["pan", -4, 0], ["pan", 4, 0], ["pan", 0, 4], ["pan", 0, -4]]);
  assert.equal(ui.press("j").defaultPrevented, true);
  assert.equal(ui.element("objectivesPanel").hidden, false);
  assert.equal(ui.press("j").defaultPrevented, true);
  assert.equal(ui.element("objectivesPanel").hidden, true);
});

test("mission shortcuts retain Ctrl/Meta+A and modified Escape handling", async () => {
  const ui = keyboardHarness();
  await ui.startMission();
  for (const modifier of ["ctrlKey", "metaKey"] as const) {
    for (const key of ["a", "A"]) assert.equal(ui.press(key, { [modifier]: true }).defaultPrevented, true);
  }
  assert.deepEqual(ui.calls, [["all"], ["all"], ["all"], ["all"]]);
  for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
    ui.element("objectivesPanel").hidden = false;
    assert.equal(ui.press("Escape", { [modifier]: true }).defaultPrevented, false);
    assert.equal(ui.element("objectivesPanel").hidden, true);
    assert.equal(ui.context.skirmish, ui.views[0]);
  }
  ui.press("Escape", { metaKey: true });
  assert.equal(ui.element("campaignLauncher").hidden, false);
  assert.equal(ui.context.skirmish, null);
});

test("mission shortcuts skip editing focus and already handled key events", async () => {
  const ui = keyboardHarness();
  await ui.startMission();
  for (const target of [new ui.FakeElement("INPUT"), new ui.FakeElement("TEXTAREA"),
    new ui.FakeElement("SELECT"), new ui.FakeElement("DIV", true)]) {
    for (const key of ["s", "p", "m", "a", "w", "j", "F2", "ArrowLeft", "Escape"]) {
      assert.equal(ui.press(key, {}, [target]).defaultPrevented, false);
    }
    for (const modifier of ["ctrlKey", "metaKey"] as const) {
      assert.equal(ui.press("a", { [modifier]: true }, [target]).defaultPrevented, false);
    }
  }
  ui.press("s", { defaultPrevented: true });
  assert.deepEqual(ui.calls, []);
  assert.equal(ui.context.skirmish, ui.views[0]);
  assert.equal(ui.element("objectivesPanel").hidden, true);
});