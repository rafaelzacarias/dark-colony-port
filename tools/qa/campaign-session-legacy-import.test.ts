import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionCheckpoint, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { CURRENT_CAMPAIGN_REPLAY_POLICY, LegacyCampaignImportError, campaignReplayDifferences,
  isPopulationReplayDifference } from "../../src/engine/campaign-session-legacy-import";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { parseScenario } from "../extractors/data/scenario";
import { parseMapBundle } from "../extractors/maps/map";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";

const consent = { policy: "legacy-unmaintained-population-v0", acknowledgeAmbiguousUnversionedSave: true } as const;
const root = new URL("../../", import.meta.url).pathname;

function options(script = ""): CampaignSessionOptions {
  const read = (path: string) => readFileSync(root + path);
  const asset = (extension: string) => read(`raw_cd/DC/SCENARIO/ALIEN/ALIEN02.${extension}`);
  const source = parseScenario(asset("SCN").toString());
  const map = parseMapBundle(asset("MAP"), asset("MTG"), asset("PTH"));
  return { sessionId: "legacy-import-control", source, map, pathGrid: map.pathGrid, tags: map.tagGrid,
    units: parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString()),
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    triggers: parseTriggerScript(script), messages: [], commanders: [{ team: 0, unitType: 73, sprite: "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 50,
    orientationSteps: 1, resourceScales: "configured-startup" };
}

function legacyFixture(script = "", ticks = 2) {
  const session = new CampaignSession(options(script));
  for (let tick = 1; tick <= ticks; tick++) assert.ok(session.stepForBrowserView({ clockMilliseconds: tick * 50 }).ok);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  delete saved.replayPolicy;
  for (let team = 0; team < 8; team++) {
    saved.state.world.statistics[`${team},6`] = 0;
    saved.state.controller.runtime.statistics[`${team},6`] = 0;
  }
  return saved;
}

test("legacy import: explicit consent, full old authentication, current marker and exact current restore", () => {
  const old = legacyFixture(), original = JSON.stringify(old);
  assert.throws(() => CampaignSession.restore(old), /complete source caller replay/);
  assert.throws(() => CampaignSession.importLegacy(old, undefined!), /explicit acknowledgement/);
  const result = CampaignSession.importLegacy(old, consent);
  assert.equal(JSON.stringify(old), original);
  assert.equal(result.checkpoint.replayPolicy, CURRENT_CAMPAIGN_REPLAY_POLICY);
  assert.ok(result.differences.length > 0 && result.differences.every(isPopulationReplayDifference));
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(result.checkpoint)));
  assert.deepEqual(restored.checkpoint(), result.checkpoint);
  for (const session of [result.session, restored]) assert.ok(session.stepForBrowserView({ clockMilliseconds: 150 }).ok);
  assert.deepEqual(restored.checkpoint(), result.session.checkpoint());
  assert.throws(() => CampaignSession.importLegacy(result.checkpoint, consent), /only unversioned/);
  const unversionedCurrent = JSON.parse(JSON.stringify(result.checkpoint));
  delete unversionedCurrent.replayPolicy;
  const restoredUnversioned = CampaignSession.restore(unversionedCurrent);
  assert.deepEqual(restoredUnversioned.checkpoint(), unversionedCurrent);
  const forkedUnversioned = restoredUnversioned.fork();
  assert.deepEqual(forkedUnversioned.checkpoint(), unversionedCurrent);
  for (const session of [restoredUnversioned, forkedUnversioned]) {
    assert.ok(session.stepForBrowserView({ clockMilliseconds: 150 }).ok);
    assert.equal(Object.hasOwn(session.checkpoint(), "replayPolicy"), false);
  }
  assert.deepEqual(restoredUnversioned.checkpoint(), forkedUnversioned.checkpoint());
  assert.deepEqual(CampaignSession.restore(restoredUnversioned.checkpoint()).checkpoint(), restoredUnversioned.checkpoint());
  assert.throws(() => CampaignSession.importLegacy(unversionedCurrent, consent), /legacy-authentication-failed/);
});

test("legacy import: no marked stale-zero fallback, unknown policies, state/source/history tampering", () => {
  const current = CampaignSession.importLegacy(legacyFixture(), consent).checkpoint;
  const stale = JSON.parse(JSON.stringify(current));
  for (let team = 0; team < 8; team++) stale.state.world.statistics[`${team},6`] = stale.state.controller.runtime.statistics[`${team},6`] = 0;
  assert.throws(() => CampaignSession.restore(stale));
  assert.throws(() => CampaignSession.importLegacy(stale, consent), /only unversioned/);
  assert.throws(() => CampaignSession.restore({ ...current, replayPolicy: "legacy-unmaintained-population-v0" }));
  assert.throws(() => CampaignSession.restore({ ...current, replayPolicy: "future" }));
  for (const mutate of [
    (saved: ReturnType<typeof legacyFixture>) => saved.state.controller.revision++,
    (saved: ReturnType<typeof legacyFixture>) => saved.state.world.entities[0].health--,
    (saved: ReturnType<typeof legacyFixture>) => saved.state.world.statistics["0,6"] = 1,
    (saved: ReturnType<typeof legacyFixture>) => saved.state.aiSelectorInputs.pop(),
    (saved: ReturnType<typeof legacyFixture>) => saved.state.aiSelectorInputs.at(-1).clockMilliseconds++,
    (saved: ReturnType<typeof legacyFixture>) => saved.options.source.id += "-tampered",
    (saved: ReturnType<typeof legacyFixture>) => saved.state.extra = 1,
  ]) {
    const saved = legacyFixture();
    mutate(saved);
    assert.throws(() => CampaignSession.importLegacy(saved, consent));
  }
});

test("legacy import: rejects source branch divergence even when final states reconverge", () => {
  const script = "1 norm 1 (1)\nsetlifes 1 1\nend";
  const saved = legacyFixture(script, 16);
  const condition = "(s(0,6)==0)";
  saved.options.triggers[0].condition = saved.state.controller.blocks[0].condition = condition;
  assert.throws(() => CampaignSession.importLegacy(saved, consent), (error: unknown) => {
    assert.ok(error instanceof LegacyCampaignImportError);
    assert.equal(error.code, "behavior-diverged");
    assert.equal(error.cycleCounter, 8);
    assert.match(error.message, /Restart this mission/);
    return true;
  });
});

test("legacy import diagnostic: exact paths preserve missing fields and array ordering", () => {
  assert.deepEqual(campaignReplayDifferences({ array: [1, 2], absent: undefined }, { array: [2, 1] }), [
    { path: ["array", "0"], saved: 1, replayed: 2 },
    { path: ["array", "1"], saved: 2, replayed: 1 },
    { path: ["absent"], saved: undefined, replayed: undefined },
  ]);
});

test("legacy import diagnostic: actual healthy H05/A05 complete current replay", {
  skip: !process.env.DC_LEGACY_DIAGNOSTIC_OUTPUT,
}, () => {
  const reports = [];
  for (const [mission, path] of [
    ["H05", "/tmp/dc-m05-opening-1790145350338/human/checkpoint.json"],
    ["A05", "/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json"],
  ]) {
    const original = readFileSync(path);
    const checkpoint = JSON.parse(original.toString()).view.session;
    const started = performance.now();
    const session = new CampaignSession({ ...checkpoint.options,
      pathGrid: Uint8Array.from(checkpoint.options.pathGrid), tags: Uint8Array.from(checkpoint.options.tags) });
    for (const input of checkpoint.state.aiSelectorInputs) {
      const result = session.stepForBrowserView(input);
      assert.ok(result.ok, JSON.stringify(result));
    }
    const differences = campaignReplayDifferences(checkpoint.state, session.checkpoint().state);
    reports.push({ mission, path, sha256: createHash("sha256").update(original).digest("hex"),
      tick: checkpoint.state.cycleCounter, elapsedMs: performance.now() - started, differences });
    assert.deepEqual(readFileSync(path), original);
  }
  writeFileSync(process.env.DC_LEGACY_DIAGNOSTIC_OUTPUT!, JSON.stringify(reports, null, 2));
});

test("legacy import actual: H05/A05 bounded authentication and current checkpoint restore", {
  skip: !process.env.DC_LEGACY_IMPORT_OUTPUT,
}, () => {
  const output = process.env.DC_LEGACY_IMPORT_OUTPUT!;
  const reports = [];
  for (const [mission, path] of [
    ["H05", "/tmp/dc-m05-opening-1790145350338/human/checkpoint.json"],
    ["A05", "/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json"],
  ]) {
    const original = readFileSync(path);
    const checkpoint: CampaignSessionCheckpoint = JSON.parse(original.toString()).view.session;
    const started = performance.now();
    let outcome;
    try {
      const imported = CampaignSession.importLegacy(checkpoint, consent);
      assert.ok(imported.differences.every(isPopulationReplayDifference));
      const restored = CampaignSession.restore(JSON.parse(JSON.stringify(imported.checkpoint)));
      assert.deepEqual(restored.checkpoint(), imported.checkpoint);
      const checkpointPath = `${output}-${mission}-current-session.json`;
      writeFileSync(checkpointPath, JSON.stringify(imported.checkpoint));
      outcome = { status: "migrated", checkpointPath, currentRestoreExact: true, differences: imported.differences };
    } catch (error) {
      if (!(error instanceof LegacyCampaignImportError)) throw error;
      outcome = { status: "rejected", code: error.code, message: error.message,
        divergenceTick: error.cycleCounter, differences: error.differences };
    }
    assert.deepEqual(readFileSync(path), original);
    reports.push({ mission, path, tick: checkpoint.state.cycleCounter, elapsedMs: performance.now() - started,
      inputSha256: createHash("sha256").update(original).digest("hex"), ...outcome });
    writeFileSync(`${output}-report.json`, JSON.stringify(reports, null, 2));
  }
  assert.equal(reports[0].status, "migrated");
  assert.equal(reports[1].status, "rejected");
});