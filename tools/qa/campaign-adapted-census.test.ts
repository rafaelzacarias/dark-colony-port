import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { loadReleaseMission } from "./fixtures/release-mission";
import { MissionView, missionVisualSprites, missionAnimationArchives } from "../../src/mission-view";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMap } from "../extractors/maps/map";
import { projectLegacyColony } from "../../src/engine/legacy-colony";
import { unitOptionsFromLegacy, defenseOptionsFromLegacy, type LegacyUnitStat } from "../../src/engine/legacy-balance";
import { auditMissionTriggerSupport } from "../../src/engine/mission-controller";
import { installSourceRender } from "./fixtures/source-render";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { legacyStaticOccupancyFieldsFromSource, projectLegacyStaticOccupancy } from "../../src/engine/legacy-static-occupancy";
import { CampaignSession } from "../../src/engine/campaign-session";

const root = new URL("../../", import.meta.url);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const scenarioHash = (value: string | undefined) => {
  assert.ok(typeof value === "string", "Original raw SCN must remain present");
  return hash(Buffer.from(value, "base64"));
};
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const counts = (values: readonly (string | number)[]) => values.reduce<Record<string, number>>((result, value) => {
  result[value] = (result[value] ?? 0) + 1;
  return result;
}, {});
type LoadedMission = Awaited<ReturnType<typeof loadCampaignMission>>;
type Row = Record<string, any>;

const visualAudits = new Map<string, Row>();
const failureOwner = (message: string) => message.includes("unproved SCN resource mapping")
  ? "src/engine/source-resource-options.ts:loadSourceResourceOptions"
  : message.includes("type-37") ? "src/engine/campaign-world.ts:initializeCampaignPlacements"
  : message.includes("Unsupported operand") ? "src/engine/trigger-runtime.ts:parseCondition"
  : message.includes("missing source message") ? "src/game-data.ts:loadCampaignMission"
  : message.includes("TRO") ? "src/engine/mission-controller.ts:decodeMissionWorldAction"
  : message.includes("dimensions") ? "src/game-data.ts:loadCampaignMissionSource"
  : message.includes("not passable") ? "src/engine/simulation.ts:DeterministicSimulation.addUnit"
  : message.includes("impassable") ? "src/engine/simulation.ts:DeterministicSimulation.addStaticTarget"
  : "src/mission-view.ts:MissionView";
function auditVisual(sprite: string, manifestPaths: Set<string>): Row {
  const cached = visualAudits.get(sprite);
  if (cached) return cached;
  const archives = missionAnimationArchives(sprite);
  const missing: string[] = [];
  const sourceAbsent: string[] = [];
  const children = new Set<string>();
  const check = (path: string) => {
    const present = existsSync(new URL(path, root));
    if (!present) missing.push(path);
    return present;
  };
  for (const archive of archives) {
    const source = `DC/ANIMATE/${archive}.FIN`;
    if (!manifestPaths.has(source)) sourceAbsent.push(source);
    const path = `public/assets/generated/animations/${archive}.json`;
    if (check(path)) for (const entry of json(path).timeline) for (const child of entry.children) children.add(child.sprite.toUpperCase());
  }
  for (const child of children) {
    check(`public/assets/generated/sprites/SPRITES/${child}.json`);
    check(`public/assets/generated/sprites/SPRITES/${child}.png`);
    const path = `public/assets/generated/indexed/sprites/SPRITES/${child}.json`;
    if (check(path)) {
      const metadata = json(path);
      check(`public/assets/generated/indexed/${metadata.indices.path}`);
      check(`public/assets/generated/indexed/${metadata.coverage.path}`);
    }
  }
  const result = { sprite, archives, children: [...children].sort(), missing, sourceAbsent,
    classification: missing.length ? sourceAbsent.length ? "alias/source outside manifest graph" : "generated asset missing" : "available" };
  visualAudits.set(sprite, result);
  return result;
}

test("campaign adapted census: all 30 original missions, strict 01, real initialize and natural 32/200", async context => {
  const started = performance.now();
  const rows: Row[] = [];
  const manifest = json("asset_manifest.json");
  const manifestFiles: Row[] = manifest.files;
  const manifestPaths = new Set<string>(manifestFiles.map(entry => entry.path));
  const sourceIndex = json("public/assets/generated/data/index.json");
  const units: (LegacyUnitStat & { readonly rawTail: readonly number[] })[] = json("public/assets/generated/data/units.json").records;
  const weapons = json("public/assets/generated/data/weapons.json").records;
  const dependencies = json("public/assets/generated/data/dependencies.json").records;
  const outputStem = process.env.DC_ADAPTED_CENSUS_OUTPUT ?? "docs/campaign-adapted-census-20260922";
  const judge = process.env.DC_OPENINGS_JUDGE === "1";
  const lateTick = judge ? Number(process.env.DC_OPENINGS_LATE_TICK ?? 1200) : 200;
  assert.ok(Number.isSafeInteger(lateTick) && lateTick >= 200);
  const auditedPaths = judge ? [
    ...readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => /\.(ts|css)$/.test(path)).map(path => `src/${path}`),
    ...readdirSync(new URL("tools/extractors/", root), { recursive: true }).map(String).filter(path => /\.ts$/.test(path)).map(path => `tools/extractors/${path}`),
    ...readdirSync(new URL("docs/", root)).filter(path => /^campaign-adapted-census.*\.(json|md)$/.test(path)).map(path => `docs/${path}`),
  ].sort() : [];
  const auditedHashesBefore = Object.fromEntries(auditedPaths.map(path => [path, hash(readFileSync(new URL(path, root)))]));
  const sourceHashesBefore = Object.fromEntries(manifestFiles.filter(entry =>
    /^DC\/SCENARIO\/(HUMAN|ALIEN)\/\1\d{2}\.(SCN|TRO|MAP)$/.test(entry.path))
    .map(entry => [entry.path, hash(readFileSync(new URL(`raw_cd/${entry.path}`, root)))]));
  let placementCalls: Row[] = [];
  let unitCalls: Row[] = [];
  let latestFrame: ReturnType<CampaignSession["stepForBrowserView"]> | undefined;
  const originalBrowserStep = CampaignSession.prototype.stepForBrowserView;
  const browserStepMock = context.mock.method(CampaignSession.prototype, "stepForBrowserView", function (
    this: CampaignSession, input: Parameters<typeof originalBrowserStep>[0],
  ) {
    latestFrame = originalBrowserStep.call(this, input);
    return latestFrame;
  });
  const originalAddUnit = DeterministicSimulation.prototype.addUnit;
  context.mock.method(DeterministicSimulation.prototype, "addUnit", function (
    this: DeterministicSimulation, options: Parameters<typeof originalAddUnit>[0],
  ) {
    const call: Row = { options: structuredClone(options), tick: this.snapshot.tick };
    unitCalls.push(call);
    try {
      call.simulationId = originalAddUnit.call(this, options);
      return call.simulationId;
    } catch (error) {
      call.firstThrow = { message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null };
      call.partialSimulation = this.snapshot;
      call.grid = { width: this.grid.width, height: this.grid.height,
        cost: this.grid.costs[this.grid.index(options.cell.x, options.cell.y)] };
      if (latestFrame?.ok) {
        call.sessionRequests = structuredClone(latestFrame.value.entry.requests);
        call.frameActors = structuredClone(latestFrame.value.world.entities.filter(actor =>
          actor.team === options.team && actor.tileX === options.cell.x && actor.tileY === options.cell.y));
      }
      call.overlappingStatics = this.snapshot.staticTargets.filter(target =>
        placementCalls.some(placement => placement.simulationId === target.id
          && placement.options.footprint?.some((cell: { x: number; y: number }) =>
            cell.x === options.cell.x && cell.y === options.cell.y)));
      throw error;
    }
  });
  const originalAddStaticTarget = DeterministicSimulation.prototype.addStaticTarget;
  context.mock.method(DeterministicSimulation.prototype, "addStaticTarget", function (
    this: DeterministicSimulation, options: Parameters<typeof originalAddStaticTarget>[0],
  ) {
    const call: Row = { options: structuredClone(options) };
    placementCalls.push(call);
    try {
      call.simulationId = originalAddStaticTarget.call(this, options);
      return call.simulationId;
    } catch (error) {
      call.firstThrow = { message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null };
      call.partialSimulation = this.snapshot;
      throw error;
    }
  });
  const fetched = new Set<string>();
  const failedAssets = new Set<string>();
  const cache = new Map<string, Uint8Array>();
  let cacheBytes = 0;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."), path);
    fetched.add(path);
    try {
      let bytes = cache.get(path);
      if (!bytes) {
        bytes = readFileSync(new URL(`public${path}`, root));
        if (cacheBytes + bytes.byteLength <= 64 * 1024 * 1024) {
          cache.set(path, bytes);
          cacheBytes += bytes.byteLength;
        }
      }
      return new Response(Uint8Array.from(bytes).buffer);
    } catch (error) {
      failedAssets.add(path);
      throw error;
    }
  });
  const rendering = installSourceRender();
  const gl = new Proxy({
    NO_ERROR: 0, drawingBufferWidth: 512, drawingBufferHeight: 452,
    isContextLost: () => false, getError: () => 0, getParameter: () => 16384,
    getShaderParameter: () => true, getProgramParameter: () => true,
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => ({})) });
  context.mock.method(document, "createElement", () => {
    const canvas = rendering.canvas();
    const getContext = canvas.getContext.bind(canvas);
    Object.assign(canvas, {
      getContext: (type: string) => type === "webgl2" ? gl : getContext(type as "2d"),
      addEventListener() {}, removeEventListener() {},
    });
    return canvas;
  });
  const snapshot = (view: MissionView) => {
    const simulation = view.simulation.snapshot;
    const world = view.campaignSnapshot?.world;
    const actors = world?.entities ?? [];
    return {
      tick: simulation.tick, diagnostic: view.missionDiagnostic ?? null, outcome: view.missionOutcome,
      worldHash: world ? hash(JSON.stringify(world)) : null,
      controller: view.campaignSnapshot?.controller ?? null,
      actors: actors.length, actorsByTeam: counts(actors.map(actor => actor.team)),
      actorTypes: counts(actors.map(actor => actor.unitType)),
      sourceActors: actors.map(actor => ({ key: actor.key, slot: actor.rawSlot, team: actor.team,
        generation: actor.generation, type: actor.unitType, health: actor.health, sourceRow: actor.sourceRow,
        tileX: actor.tileX, tileY: actor.tileY })),
      adaptedTro: world?.adaptedTro ?? null,
      scenarioMarkers: world?.scenarioMarkers ?? [],
      coordinateQueues: world?.coordinateQueues ?? [],
      casualtyOwner: world?.browserCasualtyPickup ?? null,
      economy: view.browserEconomyState ?? null,
      staticWeaponOwnership: actors.flatMap(actor => {
        const unit = units.find(candidate => candidate.index === actor.unitType);
        if (!unit || unit.movementSpeed !== 0 || !unit.weapons.some(weapon => weapon >= 0)) return [];
        const binding = view.nativeBindings.find(candidate => candidate.key === actor.key);
        const target = simulation.staticTargets.find(candidate => candidate.id === binding?.simulationId);
        return [{ key: actor.key, slot: actor.rawSlot, team: actor.team, type: actor.unitType,
          simulationId: binding?.simulationId ?? null, weapon: target?.weapon ?? null, mine: target?.mine ?? null,
          status: !target ? "unverified-not-registered" : target.weapon ? "source-weapon-owned; bounded execution only"
            : target.mine ? "adapted-mine-owner-present; detonation-not-certified"
            : [45, 46].includes(actor.unitType) ? "behavior-fail-missing-mine-detonation" : "missing-static-weapon-owner" }];
      }),
      unsupportedStaticWeapons: actors.flatMap(actor => {
        const unit = units.find(candidate => candidate.index === actor.unitType);
        const binding = view.nativeBindings.find(candidate => candidate.key === actor.key);
        const target = simulation.staticTargets.find(candidate => candidate.id === binding?.simulationId);
        return unit && unit.movementSpeed === 0 && unit.weapons[0] >= 0 && target && !target.weapon && !target.mine ? [{
          key: actor.key, team: actor.team, type: actor.unitType, sprite: unit.sprite, weapon: unit.weapons[0],
          owner: "src/mission-view.ts:MissionView.#registerEntity",
          cause: [45, 46].includes(actor.unitType) ? "Missing dedicated mine detonation/splash owner (nonfatal behavior failure)"
            : "Armed source static actor has no registered weapon execution" }] : [];
      }),
      playerActors: actors.filter(actor => actor.team === 0).length,
      mobileActors: simulation.units.length, staticActors: simulation.staticTargets.length,
      resources: simulation.resources,
      nonzeroStatistics: Object.fromEntries(Object.entries(view.missionStatistics).filter(([, value]) => value !== 0)),
      selectors: world?.aiSelectors ?? null,
      strategy: view.browserAiState?.strategy ?? null,
      credits: world?.exomoney ?? null,
      journalEntries: view.campaignJournal.length,
      requests: counts(view.campaignJournal.flatMap(frame => frame.requests.map(request => request.type))),
      combatEvents: view.simulation.combatEvents,
    };
  };
  try {
    for (const faction of ["human", "alien"] as const) for (let number = 1; number <= 15; number++) {
      const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}${String(number).padStart(2, "0")}`;
      const row: Row = { stem, faction, number, profile: number === 1 ? "strict" : "browser-adapted",
        load: false, initialize: false, step32: false, step200: false, firstFailure: null, phases: Object.create(null) };
      rows.push(row);
      const missionStarted = performance.now();
      fetched.clear(); failedAssets.clear();
      placementCalls = [];
      unitCalls = [];
      latestFrame = undefined;
      let view: MissionView | undefined;
      let restored: MissionView | undefined;
      let mission: LoadedMission | undefined;
      let stage = "source-inventory";
      let expectedTriggerHash: string | undefined;
      const observedSelectors = new Map<string, Row>();
      const observeSelectors = () => {
        const world = view?.campaignSnapshot?.world;
        if (!world || row.profile !== "browser-adapted") return;
        for (const [team, selector] of (world.aiSelectors?.modes ?? []).entries()) {
          const actors = world.entities.filter(actor => actor.team === team && actor.health > 0);
          const key = `${team}:${selector}`;
          const strategy = view!.browserAiState?.strategy;
          const decisions = strategy?.teams.find(candidate => candidate.team === team)?.decisions ?? 0;
          const entry = observedSelectors.get(key) ?? { team, selector,
            firstTick: view!.simulation.snapshot.tick, firstDecisions: decisions, decisionsDuringMode: 0,
            configured: mission?.browserAi?.teams.some(candidate => candidate.team === team) ?? false,
            owner: "src/engine/browser-campaign-ai.ts:computeBrowserCampaignAi" };
          entry.decisionsDuringMode += Math.max(0, decisions - (entry.lastDecisions ?? decisions));
          entry.lastDecisions = decisions;
          entry.lastTick = view!.simulation.snapshot.tick;
          entry.actorCount = actors.length;
          entry.actorOrderStates = Object.keys(strategy?.actors ?? {}).filter(identity =>
            actors.some(actor => identity.startsWith(`${actor.key}:`))).length;
          entry.status = !entry.configured || !strategy ? "missing-configuration-or-execution-owner"
            : selector === 0 || selector === 4 ? "configured-idle; no-strategy-orders-expected"
            : entry.decisionsDuringMode > 0 ? "strategy-decisions-observed; not-fullgame-certified"
            : "unverified-no-decision-observed";
          observedSelectors.set(key, entry);
        }
      };
      const warningStart = rendering.evidence().warnings.length;
      try {
        const scenario = json(`public/assets/generated/data/scenarios/${stem}.json`);
        const triggers = json(`public/assets/generated/data/triggers/${stem}.json`);
        const map = json(`public/assets/generated/maps/${stem}.json`);
        const rawScenario = Buffer.from(scenario.rawScenario, "base64");
        const parsed = parseScenario(rawScenario.toString("latin1"));
        const originalScenario = readFileSync(new URL(`raw_cd/DC/SCENARIO/${stem}.SCN`, root));
        const originalTriggers = readFileSync(new URL(`raw_cd/DC/SCENARIO/${stem}.TRO`, root));
        const originalMap = readFileSync(new URL(`raw_cd/DC/SCENARIO/${stem}.MAP`, root));
        const parsedMap = parseMap(originalMap);
        const manifestEntry = sourceIndex.files.scenarios.find((entry: Row) => entry.source === `${stem}.SCN`);
        assert.ok(manifestEntry, "Every original campaign must be in the actual data manifest");
        assert.equal(hash(originalScenario), scenario.source.sha256);
        assert.equal(hash(rawScenario), hash(originalScenario));
        assert.equal(hash(originalTriggers), triggers.source.sha256);
        assert.equal(hash(originalMap), map.source.map.sha256);
        assert.deepEqual(parseTriggerScript(originalTriggers.toString("latin1")), triggers.blocks);
        assert.deepEqual([parsedMap.width, parsedMap.height], [map.width, map.height]);
        const sourceProof = ["SCN", "TRO", "MAP"].map(extension => {
          const path = `DC/SCENARIO/${stem}.${extension}`;
          const entry = manifestFiles.find(candidate => candidate.path === path);
          const actualHash = hash(readFileSync(new URL(`raw_cd/${path}`, root)));
          assert.equal(entry?.sha256, actualHash, path);
          return { path, sha256: actualHash, manifestMatch: true };
        });
        expectedTriggerHash = hash(JSON.stringify(triggers.blocks));
        row.source = { scenario: scenario.source, triggers: triggers.source,
          manifestEntry, sourceProof, originalTroParsedEqual: true,
          rawScenarioHash: hash(rawScenario), rawScenarioHashMatches: hash(rawScenario) === scenario.source.sha256,
          triggerBlocksHash: expectedTriggerHash, triggerBlocks: triggers.blocks.length,
          ...(judge ? { triggerInventory: triggers.blocks } : {}),
          triggerActions: counts(triggers.blocks.flatMap((block: Row) => block.actions.map((action: Row) => action.name))),
          dimensions: { width: map.width, height: map.height, source: map.source,
            originalMapWidth: parsedMap.width, originalMapHeight: parsedMap.height,
            withinNativeByteDimensions: map.width <= 255 && map.height <= 255 },
          placementRows: parsed.placementRows.length,
          placementActorsByTeam: counts(parsed.placementRows.map(placement => placement[3])),
          placementTypes: counts(parsed.placementRows.map(placement => placement[2])),
          teams: parsed.teams, selectorCounts: counts(parsed.teams.map(team => team.ai)),
          credits: parsed.teams.map(team => team.money),
          troDiagnostics: auditMissionTriggerSupport(triggers.blocks, { browserAi: true,
            ...(number > 1 ? { runtimeProfile: "browser-adapted" as const } : {}) }).map(diagnostic => ({
            ...diagnostic, owner: failureOwner(diagnostic.message),
            sourceBlock: triggers.blocks.find((block: Row) => block.id === diagnostic.triggerId) })),
          startupSelectors: parsed.teams.map(team => ({
            team: team.index, selector: team.ai,
            status: "source-inventory-only; see observedSelectors for configuration/execution evidence",
            placementCount: parsed.placementRows.filter(placement => placement[3] === team.index).length,
            reinforcementBlocks: triggers.blocks.filter((block: Row) => block.actions.some((action: Row) =>
              ["reinforce", "reinforce2"].includes(action.name) && action.arguments[0] === team.index)).map((block: Row) => block.id) })),
          aiActions: triggers.blocks.flatMap((block: Row) => block.actions.filter((action: Row) => action.name === "ai")
            .map((action: Row) => ({ block: block.id, condition: block.condition, arguments: action.arguments }))),
          specialPlacements: parsed.placementRows.flatMap((placement, index) => placement[2] === 37 || placement[3] === -1
            ? [{ index, row: placement, kind: placement[3] === -1 ? "RENAT" : "type-37" }] : []) };
        const typeOrigins = new Map<number, string[]>();
        const addType = (type: number, origin: string) => typeOrigins.set(type, [...(typeOrigins.get(type) ?? []), origin]);
        parsed.placementRows.forEach((placement, index) => {
          addType(placement[2], `placement:${index}:team:${placement[3]}`);
          const unit = units.find(candidate => candidate.index === placement[2]);
          const team = parsed.teams[placement[3]];
          if (unit && team && unit.faction !== team.race && unit.rawTail[20] >= 0) {
            addType(unit.rawTail[20], `race-adapted-placement:${index}:sourceType:${placement[2]}`);
          }
        });
        for (const building of projectLegacyColony(parsed.teams, units).buildings) addType(building.unitType, `CITY:${building.nativeId}`);
        for (const block of triggers.blocks) for (const [index, action] of block.actions.entries()) {
          const origin = `TRO:${block.id}:action:${index}:${action.name}`;
          if (action.name === "newtype") addType(Number(action.arguments[2]), origin);
          if (["reinforce", "reinforce2"].includes(action.name)) for (let group = 3; group + 1 < action.arguments.length; group += 2) {
            if (Number(action.arguments[group + 1]) > 0) addType(Number(action.arguments[group]), origin);
          }
        }
        for (const type of [92, 93]) addType(type, "view:auxiliary");
        row.source.dynamicUnitDependencies = dependencies.filter((record: Row) => record.rawFields[0] === 1)
          .map((record: Row) => {
            const unit = units.find(candidate => candidate.index === record.rawFields[1]);
            return { dependencyId: record.id, unitType: record.rawFields[1],
              requirements: record.dependencies, sprite: unit?.sprite,
              visual: unit ? auditVisual(unit.sprite, manifestPaths) : null,
              scope: "potential production dependency, not an injected or observed actor" };
          });
        row.source.unitInventory = [...typeOrigins].map(([type, origins]) => {
          const unit = units.find(candidate => candidate.index === type);
          if (!unit) return { type, origins, error: "Missing source unit table entry" };
          let adapterError: string | null = null;
          try {
            defenseOptionsFromLegacy(unit, 0);
            if (unit.movementSpeed > 0 && ![6, 14].includes(type)) unitOptionsFromLegacy(unit, weapons);
          } catch (error) { adapterError = error instanceof Error ? error.message : String(error); }
          return { type, origins, sprite: unit.sprite, faction: unit.faction, movementSpeed: unit.movementSpeed,
            weapons: unit.weapons, adapterError, adapterProbe: "generic level-zero helper; not actor admission",
            armedStaticSource: unit.movementSpeed === 0 && unit.weapons.some(weapon => weapon >= 0),
            visual: auditVisual(unit.sprite, manifestPaths) };
        });
        stage = "loader";
        mission = await loadReleaseMission(faction, number);
        row.load = true;
        row.phases.loader = { completed: true, firstThrow: null, entityCount: null,
          statistics: null, reason: "Loader returns mission configuration; live entities/statistics begin at constructor",
          actualProfile: mission.runtimeProfile ?? "strict-native" };
        assert.equal(mission.runtimeProfile ?? "strict-native", number === 1 ? "strict-native" : "browser-adapted");
        assert.equal(hash(JSON.stringify(mission.triggers)), expectedTriggerHash, "Full original TRO must be retained");
        assert.equal(scenarioHash(mission.scenario.rawScenario), row.source.rawScenarioHash);
        row.requiredVisualSprites = missionVisualSprites(mission);
        row.requiredVisualAudit = row.requiredVisualSprites.map((sprite: string) => auditVisual(sprite, manifestPaths));
        row.productionTypes = mission.sourceProduction?.production?.sourceProfiles.map(profile => profile.unitType) ?? [];
        row.inventoryVisualOmissions = row.source.unitInventory.filter((unit: Row) =>
          unit.sprite && !row.requiredVisualSprites.includes(unit.sprite)).map((unit: Row) => ({
          type: unit.type, sprite: unit.sprite, origins: unit.origins }));
        row.strategy = mission.browserAi?.strategy ?? null;
        stage = "constructor";
        view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
        row.startup = snapshot(view);
        row.phases.constructor = { completed: !view.missionDiagnostic, snapshot: row.startup, firstThrow: null };
        observeSelectors();
        if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
        stage = "initialize-assets";
        await view.initialize();
        row.afterInitialize = snapshot(view);
        if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
        row.initialize = true;
        row.phases[stage] = { completed: true, snapshot: row.afterInitialize, firstThrow: null };
        row.terrainRenderer = view.terrainRendererStatus;
        stage = "natural-steps";
        view.update(0);
        for (let tick = 1; tick <= 200; tick++) {
          row.attemptedFrame = tick;
          view.update(tick * 50);
          browserStepMock.mock.resetCalls();
          observeSelectors();
          if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
          if (tick === 32 || tick === 200) {
            row[`at${tick}`] = snapshot(view);
            row[`step${tick}`] = view.simulation.snapshot.tick === tick;
          }
          if (view.missionOutcome?.ready) {
            row.terminal = snapshot(view);
            break;
          }
        }
        row.phases[stage] = { completed: row.step200, snapshot: snapshot(view), firstThrow: null };
        if (judge && row.step200) {
          stage = "checkpoint-restore";
          const saved = JSON.parse(JSON.stringify(view.checkpoint()));
          row.checkpoint = { tick: 200, restored: false, continuation100: false,
            sourceIdentityHash: hash(saved.sourceIdentity), savedHash: hash(JSON.stringify(saved)) };
          restored = MissionView.restore(rendering.canvas(), {} as HTMLElement,
            { onStats() {}, onUnitsChanged() {} }, mission, saved);
          assert.deepEqual(restored.checkpoint(), saved, "Complete JSON checkpoint must restore exactly");
          await restored.initialize();
          assert.deepEqual(restored.checkpoint(), saved, "Asset initialization must retain restored state");
          restored.update(200 * 50);
          row.checkpoint.restored = true;
          stage = "continuation-100";
          for (let tick = 201; tick <= 300; tick++) {
            view.update(tick * 50);
            browserStepMock.mock.resetCalls();
            restored.update(tick * 50);
            browserStepMock.mock.resetCalls();
            observeSelectors();
            assert.equal(view.missionDiagnostic ?? null, null);
            assert.equal(restored.missionDiagnostic ?? null, null);
          }
          const continued = view.checkpoint();
          assert.deepEqual(restored.checkpoint(), continued, "Full actor/world/owner continuation must match");
          assert.equal(view.simulation.snapshot.tick, 300);
          assert.equal(hash(continued.sourceIdentity), row.checkpoint.sourceIdentityHash);
          row.checkpoint.continuation100 = true;
          row.checkpoint.continuedHash = hash(JSON.stringify(continued));
          row.checkpoint.restoredContinuedHash = hash(JSON.stringify(restored.checkpoint()));
          row.checkpoint.worldHash = hash(JSON.stringify(continued.session?.state.world));
          row.at300 = snapshot(view);
          row.phases[stage] = { completed: true, snapshot: row.at300, firstThrow: null };
          restored.dispose();
          restored = undefined;
          stage = "late-natural-steps";
          const lateStarted = performance.now();
          for (let tick = 301; tick <= lateTick; tick++) {
            row.attemptedFrame = tick;
            view.update(tick * 50);
            browserStepMock.mock.resetCalls();
            observeSelectors();
            if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
            if (view.missionOutcome?.ready) break;
          }
          row.late = { targetTick: lateTick, reached: view.simulation.snapshot.tick === lateTick,
            elapsedMilliseconds: Math.round(performance.now() - lateStarted), snapshot: snapshot(view) };
          row.phases[stage] = { completed: row.late.reached, snapshot: row.late.snapshot, firstThrow: null };
        }
      } catch (error) {
        row.firstFailure = { stage, tick: view?.simulation.snapshot.tick ?? null,
          message: error instanceof Error ? error.message : String(error),
          owner: failureOwner(error instanceof Error ? error.message : String(error)),
          stack: error instanceof Error ? error.stack : null };
        row.phases[stage] = { completed: false, firstThrow: row.firstFailure,
          snapshot: view ? snapshot(view) : null };
      } finally {
        browserStepMock.mock.resetCalls();
        if (view) row.final = snapshot(view);
        for (const phase of ["loader", "constructor", "initialize-assets", "natural-steps"]) {
          row.phases[phase] ??= { completed: false, attempted: false, firstThrow: null,
            snapshot: null, reason: "Blocked by an earlier phase" };
        }
        row.observedSelectors = [...observedSelectors.values()];
        const selectorFailure = row.observedSelectors.some((entry: Row) =>
          entry.status === "missing-configuration-or-execution-owner"
          || row.step200 && [1, 2, 3].includes(entry.selector) && entry.lastTick - entry.firstTick >= 20
            && entry.decisionsDuringMode === 0);
        row.visualCoverageOmissions = (row.inventoryVisualOmissions ?? []).filter((entry: Row) =>
          row.final?.sourceActors.some((actor: Row) => actor.type === entry.type)
            && !(row.profile === "browser-adapted" && entry.type === 37));
        const visualFailure = row.visualCoverageOmissions.length > 0;
        const staticWeaponFailure = row.profile === "browser-adapted" &&
          [row.startup, row.at32, row.at200, row.final].some(state => state?.unsupportedStaticWeapons.length > 0);
        row.compatibility = row.firstFailure ? "failed" : selectorFailure ? "failed-unsupported-selector"
          : visualFailure ? "failed-visual-coverage" : staticWeaponFailure ? "failed-static-weapon-adapter" : "bounded-runtime-only";
        row.ready32 = row.step32 && !selectorFailure && !visualFailure && !staticWeaponFailure;
        row.ready200 = row.step200 && !selectorFailure && !visualFailure && !staticWeaponFailure;
        row.fullGameCertified = false;
        row.staticPlacementCalls = placementCalls;
        row.unitAdmissionFailures = unitCalls.filter(call => call.firstThrow);
        for (const call of [...placementCalls, ...row.unitAdmissionFailures]) if (call.firstThrow) {
          call.sourceActors = row.final?.sourceActors.filter((actor: Row) =>
            actor.tileX === call.options.cell.x && actor.tileY === call.options.cell.y
              && actor.team === call.options.team).map((actor: Row) => ({ ...actor,
                sourceStat: units.find(unit => unit.index === actor.type),
                occupancy: actor.slot >= 120 ? projectLegacyStaticOccupancy({ slot: actor.slot, owner: actor.team,
                  tileX: actor.tileX, tileY: actor.tileY, width: row.source.dimensions.width,
                  height: row.source.dimensions.height,
                  ...legacyStaticOccupancyFieldsFromSource(units.find(unit => unit.index === actor.type)!) }) : null })) ?? [];
          call.sourceActorMatchScope = "Committed source actors at the requested team/cell; failed staged spawn may not be committed";
          call.rejectedActors = (call.frameActors ?? call.sourceActors).filter((actor: Row) =>
            (units.find(unit => unit.index === (actor.unitType ?? actor.type))?.movementSpeed ?? 0) > 0)
            .map((actor: Row) => {
              const type = actor.unitType ?? actor.type, slot = actor.rawSlot ?? actor.slot;
              const stat = units.find(unit => unit.index === type)!;
              return { key: actor.key, slot, generation: actor.generation ?? null, team: actor.team,
                type, sourceRow: actor.sourceRow, sprite: stat.sprite, sourceStat: stat,
                occupancy: slot >= 120 ? projectLegacyStaticOccupancy({ slot, owner: actor.team,
                  tileX: call.options.cell.x, tileY: call.options.cell.y, width: row.source.dimensions.width,
                  height: row.source.dimensions.height, ...legacyStaticOccupancyFieldsFromSource(stat) }) : null };
            });
          call.overlappingSourceActors = (call.overlappingStatics ?? []).map((target: Row) => {
            const binding = view?.nativeBindings.find(candidate => candidate.simulationId === target.id);
            return { target, binding, actor: row.final?.sourceActors.find((actor: Row) => actor.key === binding?.key) ?? null };
          });
          call.repairConstraint = "Determine original actor occupancy plane/footprint; do not bypass generic collisions";
        }
        const firstAdmissionThrow = [...row.unitAdmissionFailures, ...placementCalls.filter(call => call.firstThrow)][0];
        if (row.firstFailure && firstAdmissionThrow) {
          row.firstFailure.diagnosticStack = row.firstFailure.stack;
          row.firstFailure.stack = firstAdmissionThrow.firstThrow.stack;
          row.firstFailure.sourceAdmission = firstAdmissionThrow;
        }
        if (mission) {
          row.unmodified = { triggers: hash(JSON.stringify(mission.triggers)) === expectedTriggerHash,
            rawScenario: scenarioHash(mission.scenario.rawScenario) === row.source.rawScenarioHash };
        }
        row.fetched = [...fetched].sort();
        row.failedAssets = [...failedAssets].sort();
        row.poopFetches = row.fetched.filter((path: string) => /POOP/i.test(path));
        row.warnings = rendering.evidence().warnings.slice(warningStart);
        row.elapsedMilliseconds = Math.round(performance.now() - missionStarted);
        restored?.dispose();
        view?.dispose();
        context.diagnostic(`${stem}: ${JSON.stringify({ load: row.load, initialize: row.initialize,
          step32: row.step32, step200: row.step200, failure: row.firstFailure?.message })}`);
        if (judge) writeFileSync(new URL(`${outputStem}.progress.json`, root),
          JSON.stringify({ generatedAt: new Date().toISOString(), missions: rows }, null, 2));
      }
    }
  } finally {
    rendering.dispose();
    const summary: Record<string, Record<string, number>> = Object.fromEntries(["all", "human", "alien"].map(faction => {
      const selected = rows.filter(row => faction === "all" || row.faction === faction);
      return [faction, { total: selected.length, ...Object.fromEntries(["load", "initialize", "step32", "step200", "ready32", "ready200"]
        .map(stage => [stage, selected.filter(row => row[stage]).length])) }];
    }));
    const sourceHashesAfter = Object.fromEntries(Object.keys(sourceHashesBefore).map(path =>
      [path, hash(readFileSync(new URL(`raw_cd/${path}`, root)))]));
    const auditedHashesAfter = Object.fromEntries(auditedPaths.map(path => [path, hash(readFileSync(new URL(path, root)))]));
    const openingPass = rows.length === 30 && rows.every(row => row.step200 && row.checkpoint?.continuation100
      && !row.at200?.diagnostic && !row.at300?.diagnostic && row.failedAssets.length === 0);
    const report = { schemaVersion: 2, generatedAt: new Date().toISOString(),
      ...(judge ? { verdict: { openingMilestone: openingPass ? "PASS" : "FAIL", fullGame: "FAIL" },
        checkpointSummary: { restored: rows.filter(row => row.checkpoint?.restored).length,
          continuation100: rows.filter(row => row.checkpoint?.continuation100).length },
        lateSummary: { targetTick: lateTick, reached: rows.filter(row => row.late?.reached).length } } : {}),
      scope: "Actual original loader + MissionView.initialize + natural update(50ms), no injected orders or source edits",
      limitations: ["Canvas2D/WebGL/Image stubs: real source assets read, no GPU/native parity claim",
        judge ? `200 ticks + JSON restore + 100 identical continuation ticks; natural extension to ${lateTick}, not campaign completion`
          : "200 ticks only: no campaign completion or late-trigger coverage claim",
        "Census assertions verify coverage/integrity, not admission of every mission"],
      elapsedMilliseconds: Math.round(performance.now() - started), cacheBytes, summary,
      fullGameCertified: false,
      auditIntegrity: { before: auditedHashesBefore, after: auditedHashesAfter,
        changed: auditedPaths.filter(path => auditedHashesBefore[path] !== auditedHashesAfter[path]) },
      sourceIntegrity: { files: Object.keys(sourceHashesBefore).length, before: sourceHashesBefore,
        after: sourceHashesAfter, unchanged: JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter) },
      manifests: { assetManifestSha256: hash(readFileSync(new URL("asset_manifest.json", root))),
        dataIndexSha256: hash(readFileSync(new URL("public/assets/generated/data/index.json", root))) },
      dependencyTable: dependencies,
      type52: { definition: units.find(unit => unit.index === 52),
        visual: auditVisual(units.find(unit => unit.index === 52)!.sprite, manifestPaths) },
      rendering: rendering.evidence(), missions: rows };
    writeFileSync(new URL(`${outputStem}.json`, root), `${JSON.stringify(report, null, 2)}\n`);
    const markdown = ["# Latest Adapted Campaign Census", "", `Generated: ${report.generatedAt}`, "",
      ...(judge ? [`Opening milestone: ${report.verdict!.openingMilestone}. Full game: FAIL.`, "",
        `Checkpoint restores: ${report.checkpointSummary!.restored}/30; identical 100-tick continuations: ${report.checkpointSummary!.continuation100}/30; natural tick ${lateTick}: ${report.lateSummary!.reached}/30.`, ""] : []),
      report.scope, "", ...report.limitations.map(value => `- ${value}`),
      "- Strict mission 01; explicit browser-adapted missions 02-15. No manufactured actors or commands.",
      "- Successful census assertions are not mission behavior passes or full-game certification.", "",
      `Totals: ${summary.all.load}/30 loaded; ${summary.all.initialize}/30 asset initialized; ${summary.all.step200}/30 reached frame 200; ${summary.all.ready200}/30 without a currently observed bounded blocker.`, "",
      `Source SCN/TRO/MAP files compared before/after: ${report.sourceIntegrity.files}; unchanged: ${report.sourceIntegrity.unchanged}.`, "",
      "| Mission | Load | Asset init | Frame 200 | Compatibility | First failure |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows.map(row => `| ${row.stem} | ${row.load} | ${row.initialize} | ${row.step200} | ${row.compatibility} | ${String(row.firstFailure?.message ?? "none").replaceAll("|", "\\|")} |`),
      "", "## Remaining Blocks", "",
      ...rows.filter(row => row.firstFailure).map(row => `- Fatal ${row.stem}: ${row.firstFailure.stage}, tick ${row.firstFailure.tick}: ${row.firstFailure.message} (${row.firstFailure.owner}).`),
      ...rows.flatMap(row => row.unitAdmissionFailures.map((call: Row) =>
        `- Placement ${row.stem}: rejected addUnit at (${call.options.cell.x},${call.options.cell.y}), tick ${call.tick}; rejected source actors ${call.rejectedActors.map((actor: Row) => `${actor.key}, slot ${actor.slot}, type ${actor.type}/${actor.sprite}, plane ${actor.occupancy?.plane ?? "colony"}`).join("; ") || "not identified (see original stack/options)"}; overlapping static actors ${call.overlappingSourceActors.map((entry: Row) => `${entry.actor?.key ?? "unbound"}, slot ${entry.actor?.slot ?? "unknown"}, type ${entry.actor?.type ?? "unknown"}`).join("; ") || "none"}.`)),
      ...rows.filter(row => row.final?.unsupportedStaticWeapons.length && row.profile === "browser-adapted")
        .map(row => `- Nonfatal behavior ${row.stem}: ${[...new Set(row.final.unsupportedStaticWeapons.map((actor: Row) => `${actor.type}: ${actor.cause}`))].join("; ")}.`),
      ...rows.filter(row => row.observedSelectors.some((entry: Row) => entry.status.startsWith("missing") || entry.status.startsWith("unverified")))
        .map(row => `- Selector evidence incomplete ${row.stem}: see per-team observedSelectors; enum membership is not execution proof.`),
      "- Full-game outcomes, late TRO execution, native parity, mine detonation and spy-visible type37 presentation are not certified by 200 natural frames.",
      "- Placement repairs must prove the source actor type/slot and ground/air occupancy plane; generic collision skipping is not an acceptable fix.", "",
      "Exact phase snapshots, statistics, first thrown stacks, static-call arguments/source actors, selector decisions and original hashes are in the companion JSON.", ""];
    writeFileSync(new URL(`${outputStem}.md`, root), markdown.join("\n"));
    context.diagnostic(JSON.stringify(summary));
    assert.equal(report.sourceIntegrity.files, 90);
    assert.ok(report.sourceIntegrity.unchanged, "All original SCN/TRO/MAP hashes must remain unchanged");
  }
  assert.equal(rows.length, 30);
  assert.ok(rows.every(row => row.source), "Every manifest source must be inventoried even when loading fails");
  assert.ok(rows.filter(row => row.load).every(row => row.unmodified.triggers && row.unmodified.rawScenario));
  assert.ok(rows.filter(row => row.number === 1).every(row => row.step200), "Known strict 01 missions must survive 200 steps");
});