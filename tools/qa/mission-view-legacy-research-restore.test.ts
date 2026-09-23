import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TestContext } from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";

const callbacks = { onStats() {}, onUnitsChanged() {} };
const json = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;

function installAssets(context: TestContext) {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
    return new Response(readFileSync(new URL(`../../public${url}`, import.meta.url)));
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

test("legacy research restore: reviewer adapted H01 missing source field reproducer", async context => {
  installAssets(context);
  const mission = await loadCampaignMission("human", 1, "browser-adapted");
  const { browserResearch: _research, ...legacyMission } = mission;
  assert.ok(_research);
  const original = new MissionView(canvas(), {} as HTMLElement, callbacks, legacyMission);
  let restored: MissionView | undefined;
  try {
    assert.equal(original.missionDiagnostic, undefined);
    const saved = json(original.checkpoint());
    assert.equal(Object.hasOwn(JSON.parse(saved.sourceIdentity), "browserResearch"), false);
    for (const browserResearch of [{ ..._research }, { ..._research, sourceTablesCanonical: "forged" }]) {
      const forgedMission = { ...mission, browserResearch };
      assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, forgedMission, saved), /source\/profile mismatch/);
      assert.throws(() => new MissionView(canvas(), {} as HTMLElement, callbacks, forgedMission), /source\/profile mismatch/);
    }
    restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
    assert.deepEqual(restored.checkpoint(), saved);
    assert.deepEqual(restored.mission, legacyMission);
  } finally {
    original.dispose();
    restored?.dispose();
  }
});

for (const [faction, number, oldProduction] of [
  ["human", 2, false], ["alien", 2, false], ["human", 5, false], ["human", 5, true], ["human", 7, false],
] as const) {
  test(`legacy research restore: ${faction}${number} oldProduction=${oldProduction} exact JSON and 60 ticks`, async context => {
    installAssets(context);
    const mission = await loadCampaignMission(faction, number, "browser-adapted");
    const unchanged = JSON.stringify(mission);
    const { browserResearch: _research, ...withoutResearch } = mission;
    let legacyMission = withoutResearch;
    if (oldProduction) {
      assert.ok(mission.sourceProduction?.production?.adaptedUnitProfiles);
      assert.ok(mission.sourceProduction.production.adaptedUpgrades);
      const { adaptedUnitProfiles: _profiles, adaptedUpgrades: _upgrades, ...production } = mission.sourceProduction.production;
      legacyMission = { ...withoutResearch, sourceProduction: { ...mission.sourceProduction, production } };
    }
    const original = new MissionView(canvas(), {} as HTMLElement, callbacks, legacyMission);
    const views = [original];
    try {
      assert.equal(original.missionDiagnostic, undefined);
      original.update(0);
      for (let tick = 1; tick <= 3; tick++) original.update(tick * 50);
      assert.equal(original.missionDiagnostic, undefined);
      const saved = json(original.checkpoint());
      assert.equal(saved.simulation.tick, 3);
      assert.equal(Object.hasOwn(JSON.parse(saved.sourceIdentity), "browserResearch"), false);
      const restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
      views.push(restored);
      assert.deepEqual(restored.checkpoint(), saved);
      assert.deepEqual(restored.mission, legacyMission);
      assert.deepEqual(restored.checkpoint().session!.options, saved.session!.options);
      assert.deepEqual(restored.checkpoint().session!.options.commanders, saved.session!.options.commanders);
      if (number === 7) {
        assert.ok(saved.research, "pre-fix marker mission has active research from production dependencies");
        assert.deepEqual(restored.researchDiscovery, original.researchDiscovery);
      }
      for (const view of [original, restored]) { view.resetClock(); view.update(0); }
      for (let tick = 1; tick <= 60; tick++) {
        original.update(tick * 50);
        restored.update(tick * 50);
        assert.equal(original.missionDiagnostic, undefined);
        assert.equal(restored.missionDiagnostic, undefined);
      }
      const continued = json(restored.checkpoint());
      assert.equal(continued.simulation.tick, 63);
      assert.equal(continued.sourceIdentity, saved.sourceIdentity);
      assert.deepEqual(continued.session!.options, saved.session!.options);
      assert.deepEqual(continued, json(original.checkpoint()));
      const restoredAgain = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, continued);
      views.push(restoredAgain);
      assert.deepEqual(json(restoredAgain.checkpoint()), continued);
      const pinnedRestore = MissionView.restore(canvas(), {} as HTMLElement, callbacks, restored.mission, continued);
      views.push(pinnedRestore);
      assert.deepEqual(json(pinnedRestore.checkpoint()), continued);
      assert.equal(JSON.stringify(mission), unchanged, "current authenticated source unchanged");
    } finally { for (const view of views) view.dispose(); }
  });
}

test("legacy research restore: exact source authentication rejects present bad config and unrelated changes", async context => {
  installAssets(context);
  const mission = await loadCampaignMission("human", 7, "browser-adapted");
  const { browserResearch: _research, ...legacyMission } = mission;
  const original = new MissionView(canvas(), {} as HTMLElement, callbacks, legacyMission);
  const fresh = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  try {
    assert.equal(original.missionDiagnostic, undefined);
    assert.equal(fresh.missionDiagnostic, undefined);
    const saved = json(original.checkpoint());
    const current = json(fresh.checkpoint());
    assert.ok(JSON.parse(current.sourceIdentity).browserResearch);
    const currentRestored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, current);
    try {
      assert.equal(currentRestored.mission, mission);
      assert.deepEqual(currentRestored.checkpoint(), current);
    } finally { currentRestored.dispose(); }
    for (const mutate of [
      (source: Record<string, any>) => { source.unexpected = true; },
      (source: Record<string, any>) => { delete source.browserEconomy; },
      (source: Record<string, any>) => { source.scenario.source.sha256 = "0".repeat(64); },
      (source: Record<string, any>) => { source.browserResearch = null; },
      (source: Record<string, any>) => { source.browserResearch = { ...mission.browserResearch, unexpected: true }; },
      (source: Record<string, any>) => {
        const tables = JSON.parse(mission.browserResearch!.sourceTablesCanonical);
        tables.dependencies[0].cost++;
        source.browserResearch = { ...mission.browserResearch, sourceTablesCanonical: JSON.stringify(tables) };
      },
      (source: Record<string, any>) => {
        source.browserResearch = { ...mission.browserResearch, sourceCanonical: "forged" };
      },
    ]) {
      for (const baseline of [saved, current]) {
        const invalid = json(baseline);
        const source = JSON.parse(invalid.sourceIdentity);
        mutate(source);
        Object.assign(invalid, { sourceIdentity: canonical(source) });
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, invalid),
          /Invalid MissionView checkpoint/);
      }
    }
    for (const mutate of [
      (copy: typeof saved) => { Object.assign(copy.session!.options, { browserResearch: mission.browserResearch }); },
      (copy: typeof saved) => { Object.assign(copy.session!.options, { fixedStepMilliseconds: 51 }); },
      (copy: typeof saved) => { Object.assign(copy.session!.options, { commanders: [] }); },
      (copy: typeof saved) => { Reflect.deleteProperty(copy.session!.options.production!, "adaptedCollectorProfiles"); },
    ]) {
      const invalid = json(saved);
      mutate(invalid);
      assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, invalid),
        /Invalid MissionView checkpoint/);
    }
    const forgedMission = { ...mission, browserResearch: { ...mission.browserResearch! } };
    assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, forgedMission, saved),
      /source\/profile mismatch|research profile owner/);
  } finally { original.dispose(); fresh.dispose(); }
});

test("legacy research restore: strict H01 unchanged through JSON and 60 ticks", async context => {
  installAssets(context);
  const mission = await loadCampaignMission("human", 1);
  assert.equal(Object.hasOwn(mission, "browserResearch"), false);
  const original = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  let restored: MissionView | undefined;
  try {
    assert.equal(original.missionDiagnostic, undefined);
    const saved = json(original.checkpoint());
    restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
    assert.equal(restored.mission, mission);
    assert.deepEqual(restored.checkpoint(), saved);
    for (const view of [original, restored]) { view.resetClock(); view.update(0); }
    for (let tick = 1; tick <= 60; tick++) {
      original.update(tick * 50); restored.update(tick * 50);
      assert.equal(original.missionDiagnostic, undefined);
      assert.equal(restored.missionDiagnostic, undefined);
    }
    assert.equal(restored.simulation.snapshot.tick, 60);
    assert.deepEqual(restored.checkpoint(), original.checkpoint());
  } finally { original.dispose(); restored?.dispose(); }
});