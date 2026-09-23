import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { campaignConstructionPolicy, loadCampaignMission } from "../../src/game-data";
import { MissionView, type MissionViewCheckpoint } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import { campaignReplayDifferences, isPopulationReplayDifference, LegacyCampaignImportError } from "../../src/engine/campaign-session-legacy-import";
import { installSourceRender } from "./fixtures/source-render";

const consent = { policy: "legacy-unmaintained-population-v0", acknowledgeAmbiguousUnversionedSave: true } as const;
const callbacks = { onStats() {}, onUnitsChanged() {} };
const root = new URL("../../public/", import.meta.url);
const fetchSource: typeof fetch = async input => {
  const path = String(input);
  assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
  return new Response(readFileSync(new URL(path.slice(1), root)));
};
const json = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));

test("legacy view: consent, independent source authentication, outer guards and old capability pins", async context => {
  context.mock.method(globalThis, "fetch", fetchSource);
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  const views: MissionView[] = [];
  try {
    const loaded = await loadCampaignMission("human", 5, "browser-adapted");
    const { adaptedUnitProfiles: _profiles, adaptedUpgrades: _upgrades, ...production } = loaded.sourceProduction!.production!;
    const mission = { ...loaded, sourceProduction: { ...loaded.sourceProduction!, production } };
    const initial = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(initial);
    assert.equal(initial.missionDiagnostic, undefined);
    initial.update(0); initial.update(50); initial.update(100);
    const saved = json(initial.checkpoint());
    delete (saved.session as { replayPolicy?: string }).replayPolicy;
    for (let team = 0; team < 8; team++) {
      Object.assign(saved.session!.state.world.statistics, { [`${team},6`]: 0 });
      Object.assign(saved.session!.state.controller.runtime.statistics, { [`${team},6`]: 0 });
    }
    const original = JSON.stringify(saved);
    const restore = (checkpoint: unknown) => MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, loaded, checkpoint);
    const importView = (checkpoint: unknown) => {
      const result = MissionView.importLegacy(renderer.canvas(), {} as HTMLElement, callbacks, loaded, checkpoint, consent);
      views.push(result.view);
      return result;
    };
    assert.throws(() => restore(saved), /complete source caller replay/);
    assert.throws(() => MissionView.importLegacy(renderer.canvas(), {} as HTMLElement, callbacks, loaded, saved, undefined!), /explicit acknowledgement/);
    const importer = context.mock.method(CampaignSession, "importLegacy");
    const sourceMismatch = json(saved);
    (sourceMismatch as { sourceIdentity: string }).sourceIdentity += " ";
    assert.throws(() => importView(sourceMismatch), /enum/);
    const optionsMismatch = json(saved);
    (optionsMismatch.session!.options as { sessionId: string }).sessionId += "-changed";
    assert.throws(() => importView(optionsMismatch), /session source\/options/);
    assert.equal(importer.mock.callCount(), 0);
    importer.mock.restore();
    for (const mutate of [
      (checkpoint: MissionViewCheckpoint) => Object.assign(checkpoint.state.bindings[0], { key: "changed" }),
      (checkpoint: MissionViewCheckpoint) => {
        const key = Object.keys(checkpoint.economy!.rates)[0];
        Object.assign(checkpoint.economy!.rates, { [key]: checkpoint.economy!.rates[key] + 1 });
      },
      (checkpoint: MissionViewCheckpoint) => (checkpoint.browserAi as { sourceCycle: number }).sourceCycle++,
      (checkpoint: MissionViewCheckpoint) => checkpoint.state.selectedIds.push(999999),
    ]) {
      const changed = json(saved); mutate(changed);
      assert.throws(() => importView(changed));
    }
    const imported = importView(saved);
    assert.match(imported.notice, /Explicit legacy import/);
    assert.equal(imported.checkpoint.session!.replayPolicy, "current-population-v1");
    assert.deepEqual({ ...imported.checkpoint, session: null }, { ...saved, session: null });
    assert.ok(imported.differences.length > 0 && imported.differences.every(isPopulationReplayDifference));
    const restored = restore(json(imported.checkpoint)); views.push(restored);
    assert.deepEqual(restored.checkpoint(), imported.checkpoint);
    assert.throws(() => importView(imported.checkpoint), /only unversioned/);
    const diagnostic = json(saved); diagnostic.state.diagnostic = "Preserved prior diagnostic";
    assert.equal(importView(diagnostic).view.missionDiagnostic, diagnostic.state.diagnostic);
    assert.equal(JSON.stringify(saved), original);
  } finally {
    views.forEach(view => view.dispose());
    renderer.dispose();
  }
});

test("legacy view actual: H05 outer import, exact current restore plus 100 ticks; A05 rejected", {
  skip: !process.env.DC_LEGACY_VIEW_OUTPUT,
}, async context => {
  context.mock.method(globalThis, "fetch", fetchSource);
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  const views: MissionView[] = [];
  const reports: unknown[] = [];
  const output = process.env.DC_LEGACY_VIEW_OUTPUT!;
  try {
    for (const [faction, path] of [
      ["human", "/tmp/dc-m05-opening-1790145350338/human/checkpoint.json"],
      ["alien", "/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json"],
    ] as const) {
      const bytes = readFileSync(path), original = JSON.parse(bytes.toString());
      const saved: MissionViewCheckpoint = original.view;
      const started = performance.now();
      const mission = await loadCampaignMission(faction, 5, "browser-adapted",
        campaignConstructionPolicy(faction, 5, "browser-adapted", saved));
      if (faction === "alien") {
        assert.throws(() => MissionView.importLegacy(renderer.canvas(), {} as HTMLElement, callbacks, mission, saved, consent), error => {
          assert.ok(error instanceof LegacyCampaignImportError);
          assert.equal(error.code, "legacy-authentication-failed");
          reports.push({ faction, status: "rejected", code: error.code, differences: error.differences });
          return true;
        });
      } else {
        assert.equal(saved.simulation.tick, 1000);
        const imported = MissionView.importLegacy(renderer.canvas(), {} as HTMLElement, callbacks, mission, saved, consent);
        views.push(imported.view);
        assert.equal(imported.view.missionDiagnostic, undefined);
        assert.deepEqual({ ...imported.checkpoint, session: null }, { ...saved, session: null });
        assert.deepEqual(imported.checkpoint.session!.options, saved.session!.options);
        assert.deepEqual(imported.checkpoint.session!.state.aiSelectorInputs, saved.session!.state.aiSelectorInputs);
        assert.ok(campaignReplayDifferences(saved.session!.state, imported.checkpoint.session!.state).every(isPopulationReplayDifference));
        const rebuilt = { ...original, view: imported.view.checkpoint(), migrationNotice: imported.notice };
        writeFileSync(`${output}-H05-current-outer.json`, JSON.stringify(rebuilt));
        const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, json(rebuilt.view));
        views.push(restored);
        assert.deepEqual(restored.checkpoint(), imported.checkpoint);
        for (const view of [imported.view, restored]) {
          await view.initialize(); view.resetClock(); view.update(0);
        }
        for (let tick = 1; tick <= 100; tick++) {
          for (const view of [imported.view, restored]) { view.update(tick * 50); assert.equal(view.missionDiagnostic, undefined); }
        }
        assert.equal(restored.simulation.snapshot.tick, 1100);
        assert.deepEqual(restored.checkpoint(), imported.view.checkpoint());
        writeFileSync(`${output}-H05-current-1100.json`, JSON.stringify(restored.checkpoint()));
        reports.push({ faction, status: "imported", tick: 1000, continuationTick: 1100, exact: true,
          differences: imported.differences, notice: imported.notice });
      }
      assert.deepEqual(readFileSync(path), bytes);
      assert.equal(JSON.stringify(original.view), JSON.stringify(saved));
      reports.push({ faction, path, sha256: createHash("sha256").update(bytes).digest("hex"), unchanged: true, elapsedMs: performance.now() - started });
      writeFileSync(`${output}-report.json`, JSON.stringify(reports, null, 2));
    }
  } finally {
    views.forEach(view => view.dispose());
    renderer.dispose();
  }
});