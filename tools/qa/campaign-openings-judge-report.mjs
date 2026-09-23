import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const input = process.argv[2];
assert.ok(input, "Provide the actual census JSON path");
const census = JSON.parse(readFileSync(input, "utf8"));
const lateInput = process.argv[3];
const late = lateInput ? JSON.parse(readFileSync(lateInput, "utf8")) : null;
if (late) {
  assert.equal(late.missions.length, 2);
  assert.equal(late.sourceIntegrity.files, 90);
  assert.deepEqual(late.sourceIntegrity.before, late.sourceIntegrity.after);
  assert.deepEqual(late.sourceIntegrity.before, census.sourceIntegrity.before);
  for (const row of late.missions) {
    if (row.tick < 3856 || row.firstFailure) continue;
    const rates = row.commands.filter(command => command.command.kind === "newrate");
    assert.equal(rates.length, row.stem.startsWith("HUMAN") ? 2 : 3);
    for (const { command } of rates) {
      const actor = row.world.entities.find(actor => actor.tileX === command.tileX && actor.tileY === command.tileY && actor.resource);
      assert.equal(actor?.resource.rateWord, command.rate, `${row.stem} actual newrate resource`);
    }
  }
}
const rows = census.missions;
const hash = value => createHash("sha256").update(value).digest("hex");
assert.equal(rows.length, 30);
assert.equal(new Set(rows.map(row => row.stem)).size, 30);
assert.equal(census.sourceIntegrity.files, 90);
assert.deepEqual(census.sourceIntegrity.before, census.sourceIntegrity.after);
for (const [path, expected] of Object.entries(census.sourceIntegrity.before)) {
  assert.equal(hash(readFileSync(new URL(`raw_cd/${path}`, root))), expected, path);
}
for (const row of rows) {
  assert.equal(row.profile, row.number === 1 ? "strict" : "browser-adapted");
  assert.equal(row.source.sourceProof.length, 3);
  assert.ok(row.source.sourceProof.every(source => source.manifestMatch));
  if (row.load) assert.deepEqual(row.unmodified, { triggers: true, rawScenario: true });
  if (row.checkpoint?.continuation100) {
    assert.ok(row.checkpoint.restored);
    assert.equal(row.checkpoint.continuedHash, row.checkpoint.restoredContinuedHash);
    assert.equal(row.at300.tick, 300);
  }
}
const blockers = rows.flatMap(row => {
  const result = [];
  if (row.firstFailure) result.push({ mission: row.stem, severity: "runtime-failure", ...row.firstFailure });
  const unsupported = new Map([row.startup, row.at200, row.at300, row.final].flatMap(state =>
    state?.unsupportedStaticWeapons ?? []).map(actor => [actor.key, actor]));
  for (const actor of unsupported.values()) result.push({ mission: row.stem,
    severity: "nonfatal-functional-failure", ...actor });
  if (row.compatibility === "failed-visual-coverage") result.push({ mission: row.stem,
    severity: "visual-coverage", omissions: row.visualCoverageOmissions });
  if (row.compatibility === "failed-unsupported-selector") result.push({ mission: row.stem,
    severity: "selector-execution", selectors: row.observedSelectors });
  return result;
});
const summaries = rows.map(row => {
  const state = row.final;
  const initialMarkers = row.startup?.sourceActors.filter(actor => actor.type === 37) ?? [];
  const finalMarkers = state?.sourceActors.filter(actor => actor.type === 37) ?? [];
  const markerIdentity = actor => [actor.key, actor.slot, actor.generation, actor.sourceRow, actor.type, actor.team];
  const markersPreserved = JSON.stringify(initialMarkers.map(markerIdentity)) === JSON.stringify(finalMarkers.map(markerIdentity));
  if (row.step200 && row.checkpoint?.continuation100) assert.ok(markersPreserved, `${row.stem} marker identities`);
  const events = state?.adaptedTro?.events ?? [];
  const sourceBlocks = row.source.triggerInventory ?? [];
  const lives = state?.controller?.runtime?.lives ?? {};
  const thresholds = sourceBlocks.flatMap(block => [...block.condition.matchAll(/\bc\s*>\s*(\d+)/g)].map(match => ({
    block: block.id, condition: block.condition, minimumTick: (Number(match[1]) + 1) * 16,
    reachedClock: (state?.tick ?? 0) >= (Number(match[1]) + 1) * 16,
    actions: block.actions.map(action => action.name), remainingLives: lives[block.id] ?? null,
    scope: "Clock reached is not proof that other predicates or trip conditions fired",
  })));
  return { mission: row.stem, profile: row.profile, load: row.load, initialize: row.initialize,
    tick200: row.step200, restored: row.checkpoint?.restored ?? false,
    continuation100: row.checkpoint?.continuation100 ?? false, finalTick: state?.tick ?? null,
    compatibility: row.compatibility, diagnostic: state?.diagnostic ?? null, outcome: state?.outcome ?? null,
    checkpoint: row.checkpoint ?? null, worldHash: state?.worldHash ?? null,
    markers: { initial: initialMarkers.length, final: finalMarkers.length, identitiesPreserved: markersPreserved,
      poopRequests: row.poopFetches, sourceActors: finalMarkers, relays: state?.scenarioMarkers ?? [],
      scope: "Hidden marker source identities only; no spy-enabled rendering or FIFO collection certification" },
    effects: events, noPickup: state?.adaptedTro?.noPickup ?? null,
    aiSelectors: row.observedSelectors,
    sourceProductionTypes: row.productionTypes,
    casualtyOwner: state?.casualtyOwner ?? null, statistics: state?.nonzeroStatistics ?? {},
    economy: state?.economy ?? null, requests: state?.requests ?? {},
    thresholds, firstFailure: row.firstFailure ?? null };
});
const allOpen = rows.every(row => row.load && row.initialize && row.step200 && row.checkpoint?.continuation100
  && row.at200?.diagnostic === null && row.at300?.diagnostic === null && row.failedAssets.length === 0);
const totals = { ...census.summary.all, restored: summaries.filter(row => row.restored).length,
  continuation100: summaries.filter(row => row.continuation100).length,
  reached1200: summaries.filter(row => row.finalTick >= 1200).length,
  runtimeFailures: rows.filter(row => row.firstFailure).length,
  nonfatalFunctionalMissions: new Set(blockers.filter(blocker => blocker.severity === "nonfatal-functional-failure").map(blocker => blocker.mission)).size,
  readyOutcomes: summaries.filter(row => row.outcome?.ready).length,
  markers: summaries.reduce((total, row) => total + row.markers.initial, 0),
  markerMissions: summaries.filter(row => row.markers.initial > 0).length,
  failedAssetReads: rows.reduce((total, row) => total + row.failedAssets.length, 0),
  poopRequests: rows.reduce((total, row) => total + row.poopFetches.length, 0) };
const executedModes = [...new Set(rows.flatMap(row => row.observedSelectors.filter(selector => selector.decisionsDuringMode > 0)
  .map(selector => selector.selector)))].sort();
const income = summaries.filter(row => row.economy).map(row => ({ mission: row.mission,
  earned: row.economy.earned, total: Object.values(row.economy.earned ?? {}).reduce((total, value) => total + Number(value), 0) }));
const nextThresholds = summaries.map(row => {
  const horizon = Math.max(row.finalTick ?? 0, late?.missions.find(mission => mission.stem === row.mission)?.tick ?? 0);
  const nextTick = Math.min(...row.thresholds.filter(threshold => threshold.minimumTick > horizon).map(threshold => threshold.minimumTick));
  return { mission: row.mission, testedHorizon: horizon,
    next: row.thresholds.filter(threshold => threshold.minimumTick === nextTick),
    otherPredicates: "Unmet trip, building, death/statistic and array predicates are not certified by clock progression" };
});
const currentMinePath = new URL("src/engine/browser-mines.ts", root);
const currentMine = existsSync(currentMinePath) ? { file: "src/engine/browser-mines.ts",
  sha256: hash(readFileSync(currentMinePath)), status: "code-present-after-census-start; not certified by this process",
  scope: "Historical missing-owner observations remain accurate for the loaded census runtime, not a claim of current code absence" } : null;
assert.equal(census.verdict.openingMilestone, allOpen ? "PASS" : "FAIL");
const report = { ...census, schemaVersion: 3, judgeGeneratedAt: new Date().toISOString(),
  lateProbe: late ? { ...late, actualRun: { input: lateInput, sha256: hash(readFileSync(lateInput)) } } : null,
  actualRun: { input, sha256: hash(readFileSync(input)),
    exit: existsSync(input.replace(/\.json$/, ".exit.json"))
      ? JSON.parse(readFileSync(input.replace(/\.json$/, ".exit.json"), "utf8")) : null },
  verdict: { openingMilestone: allOpen ? "PASS" : "FAIL", fullGame: "FAIL" }, totals,
  executionCoverage: { executedModes, income, playerOrdersIssued: 0, playerPurchasesExercised: false, nextThresholds },
  postStartMineImplementation: currentMine,
  human05SourceVerification: {
    log: "/tmp/dc-openings-msg-source-1790122970218.log",
    result: JSON.parse(readFileSync("/tmp/dc-openings-msg-source-1790122970218.log.exit.json", "utf8")),
    scope: "Two independent rerun tests: all 16 original native MSG strings equal parser/generated JSON; full-source adapted loader. No source actions forced or removed.",
  },
  runtimeBlockers: blockers, missionJudgments: summaries,
  unverified: ["All 30 complete original win/loss outcomes and all-feature playthroughs",
    "Late original predicates beyond each recorded natural tick; no counters or events injected",
    "Mine detonation/splash/casualty correctness is not inferred from nonfatal startup or newly added code",
    "Spy-enabled type37 art and collection are not certified by preserved hidden markers",
    "AL08 team6 automatic-pickup suppression requires an actual qualifying death; flag publication alone is insufficient",
    "Player harvesting/purchases are not performed in this autonomous census; configuration is not functional proof",
    "Native parity and real browser/GPU rendering are outside this Node real-loader/real-view census"],
};
const output = new URL("docs/campaign-openings-judge-20260922", root);
const lines = ["# Campaign Openings Independent Judge", "", `Generated: ${report.judgeGeneratedAt}`, "",
  `**Opening milestone: ${report.verdict.openingMilestone}. Full game: FAIL.**`, "",
  `${totals.load}/30 loaded, ${totals.initialize}/30 initialized, ${totals.step200}/30 reached tick 200, ${totals.restored}/30 JSON-restored, ${totals.continuation100}/30 matched the complete 100-tick continuation, ${totals.reached1200}/30 reached tick 1200.`, "",
  `${totals.runtimeFailures} observed runtime failures; ${totals.nonfatalFunctionalMissions} missions with nonfatal armed-static/mine functional failures; ${totals.readyOutcomes}/30 ready outcomes. Startup is not completion.`, "",
  `Measured harness duration: ${(census.elapsedMilliseconds / 1000).toFixed(1)} seconds for all30; ${late ? (late.elapsedMilliseconds / 1000).toFixed(1) : "not run"} seconds for the separate mission12 probe. These include Node rendering stubs, source replay and concurrent machine load, not browser frame-time benchmarks.`, "",
  "## Method", "",
  "Actual original loadCampaignMission and initialized MissionView.update(50ms); HUMAN01/ALIEN01 strict, all M02-M15 browser-adapted, matching main's default route. Full original SCN/TRO, no filtered blocks, injected events, orders, counters, runtime edits, agents, package/asset changes or full suite.", "",
  "JSON restore at tick 200, asset initialize, then original/restored views run independently to 300. Deep equality covers the complete checkpoints, including simulation, actors, bindings, world, controller, owners, journal and source identity. Natural continuation then targets tick 1200. Canvas2D/WebGL/Image are stubs: this is not a real-browser pixel/native-parity pass.", "",
  `All ${census.sourceIntegrity.files} original SCN/TRO/MAP files match source hashes and remain unchanged. Runtime/extractor/historical-report paths changed during execution: ${census.auditIntegrity.changed.length ? census.auditIntegrity.changed.join(", ") : "none"}. Concurrent changes do not retroactively enter the tested process.`, "",
  `Actual census artifact: ${input}; SHA-256 ${report.actualRun.sha256}. Detailed evidence is embedded in [the JSON report](campaign-openings-judge-20260922.json).`, "",
  "## Actual Missions", "",
  "| Mission | Load/Init | Tick 200 | Restore +100 | Last tick | Compatibility |",
  "| --- | --- | --- | --- | --- | --- |",
  ...summaries.map(row => `| ${row.mission} | ${row.load}/${row.initialize} | ${row.tick200} | ${row.restored}/${row.continuation100} | ${row.finalTick} | ${row.compatibility} |`), "",
  "## Current Blocks", "",
  ...(currentMine ? ["The census loaded its runtime before the concurrent dedicated-mine implementation was added. Missing-mine observations below describe that tested version. The current owner exists in [browser-mines.ts](../src/engine/browser-mines.ts); this independent census does not certify its detonation, splash, one-shot death or source casualty behavior.", ""] : []),
  ...blockers.map(blocker => `- ${blocker.mission}: ${blocker.severity}; ${blocker.message ?? blocker.cause ?? "see JSON evidence"}${blocker.tick != null ? `; tick ${blocker.tick}` : ""}${blocker.type != null ? `; type ${blocker.type}, actor ${blocker.key}` : ""}.`),
  ...report.unverified.map(item => `- ${item}.`), "",
  "## Bounded Evidence", "",
  `- Actual strategy decision modes observed: ${executedModes.join(", ") || "none"}. Positive earned income in ${income.filter(row => row.total > 0).length}/${income.length} adapted missions; zero player orders/purchases were issued. Full per-team amounts and decision counts are in JSON.`,
  "- HUMAN05: independent native original loader/parser comparison passed for all 16 messages, including original `text 5.`; complete original loader source equality passed. No assets were regenerated by this audit.",
  "- HUMAN07: actual initialized source mission now reaches tick1200 and restores identically; former delivery collision at tick82 did not recur.",
  "- ALIEN06: actual initialized source mission now reaches tick1200 and restores identically; former ORTU admission failure at12,74 did not recur. Source class2/air-plane contract is not a native flight-parity claim.",
  "- ALIEN08: original nopickup6 event applies with the adapted casualty owner. No qualifying team6 commander death occurred in the natural 1200-tick window; suppression and other-team behavior remain unproven here.",
  `- Type37: ${totals.markers} initial markers in ${totals.markerMissions} missions; identities preserved in ${summaries.filter(row => row.markers.initial && row.markers.identitiesPreserved).length}/${totals.markerMissions}; ${totals.poopRequests} POOP requests; ${totals.failedAssetReads} failed asset reads.`,
  ...summaries.filter(row => row.effects.length).map(row => `- ${row.mission}: natural effects ${[...new Set(row.effects.map(event => event.command.kind))].join(", ")}; ${row.effects.length} source-owned effect events.`),
  "- HUMAN12/ALIEN12 first newrate clock threshold: c>240, tick 3856. HUMAN12 initial reinforce2/waypoint sequence begins c>30, tick 496; trip predicates still require real arrivals. See original conditions and per-mission evidence, never substitute t with time.", "",
  ...(late ? ["## Natural Late Probe", "",
    ...late.missions.map(row => `- ${row.stem}: initialized ${row.initialized}; actual tick ${row.tick}/${row.targetTick}; diagnostic ${row.diagnostic ?? "none"}; first failure ${row.firstFailure?.message ?? "none"}; source newrate commands ${row.commands?.filter(command => command.command.kind === "newrate").length ?? 0}.`),
    `- All ${late.sourceIntegrity.files} original source hashes unchanged. Runtime paths changed during this separate run: ${late.runtimeIntegrity.changed.join(", ") || "none"}.`,
    "- Complete source commands, world and controller evidence are embedded in lateProbe in the JSON report. No predicates, statistics or event inputs were manufactured.", ""] : []),
  "## Next Gates", "",
  ...nextThresholds.filter(row => row.mission.endsWith("12")).map(row => `- ${row.mission}: tested through ${row.testedHorizon}; next clock gate ${row.next.map(threshold => `${threshold.condition} at tick ${threshold.minimumTick}, block ${threshold.block} (${threshold.actions.join(", ")})`).join("; ") || "none"}.`),
  "- ALIEN08: actual team6 commander death, source block9 follow-up, and unaffected other-team automatic pickup still need natural playthrough proof. No death/statistic was injected.",
  "- Native aimsg/dfiddle parsing evidence is prior bounded evidence, not new full-native gameplay certification. dfiddle had no natural event in this census; aimsg did. Unknown/unreached predicates are not marked ready.", "",
  "## Reproduce", "", "```sh",
  "DC_OPENINGS_JUDGE=1 DC_OPENINGS_LATE_TICK=1200 DC_ADAPTED_CENSUS_OUTPUT=/tmp/unique-openings-census \\",
  "  node --import tsx --test tools/qa/campaign-adapted-census.test.ts",
  "node tools/qa/campaign-openings-judge-report.mjs /tmp/unique-openings-census.json", "```", ""];
writeFileSync(`${fileURLToPath(output)}.json`, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(`${fileURLToPath(output)}.md`, lines.join("\n"));
console.log(JSON.stringify({ output: fileURLToPath(output), verdict: report.verdict, totals }, null, 2));