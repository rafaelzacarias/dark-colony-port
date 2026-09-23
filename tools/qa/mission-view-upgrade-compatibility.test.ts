import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";

const callbacks = { onStats() {}, onUnitsChanged() {} };
const json = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;

for (const faction of ["human", "alien"] as const) {
  for (const legacyRoster of [false, true]) {
    test(`upgrade compatibility ${faction}03: absent upgrades, legacy roster ${legacyRoster}, pinned full-match continuation`, async context => {
      context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
        new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url))));
      const loaded = await loadCampaignMission(faction, 3, "browser-adapted");
      assert.deepEqual(loaded.sourceProduction?.production?.adaptedUpgrades, { runtimeProfile: "browser-adapted" });
      const mission = { ...loaded, sourceProduction: { ...loaded.sourceProduction!,
        production: { ...loaded.sourceProduction!.production!, adaptedUpgrades: { runtimeProfile: "browser-adapted" as const } } } };
      const original = JSON.stringify(mission);
      const { adaptedUpgrades: _upgrades, ...withoutUpgrades } = mission.sourceProduction.production;
      const { adaptedUnitProfiles: _roster, ...withoutRoster } = withoutUpgrades;
      const legacyMission = { ...mission, sourceProduction: { ...mission.sourceProduction,
        production: legacyRoster ? withoutRoster : withoutUpgrades } };
      const views: MissionView[] = [];
      try {
        const view = new MissionView(canvas(), {} as HTMLElement, callbacks, legacyMission);
        views.push(view);
        assert.equal(view.missionDiagnostic, undefined);
        view.update(0);
        for (let tick = 1; tick <= 4; tick++) view.update(tick * 50);
        const saved = json(view.checkpoint());
        assert.equal(Object.hasOwn(saved.session!.options.production!, "adaptedUpgrades"), false);
        const restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
        views.push(restored);
        assert.deepEqual(restored.checkpoint(), saved);
        assert.deepEqual(restored.mission, legacyMission);
        assert.equal(restored.productionMenu.some(choice => choice.kind === "upgrade"), false);
        for (const current of [view, restored]) { current.resetClock(); current.update(0); }
        for (let tick = 1; tick <= 16; tick++) {
          view.update(tick * 50); restored.update(tick * 50);
          assert.equal(view.missionDiagnostic, undefined);
          assert.equal(restored.missionDiagnostic, undefined);
        }
        assert.deepEqual(restored.checkpoint(), view.checkpoint());
        const again = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, json(restored.checkpoint()));
        views.push(again);
        assert.deepEqual(again.checkpoint(), restored.checkpoint());
        const restart = new MissionView(canvas(), {} as HTMLElement, callbacks, restored.mission);
        const oldRestart = new MissionView(canvas(), {} as HTMLElement, callbacks, legacyMission);
        views.push(restart, oldRestart);
        assert.deepEqual(restart.checkpoint(), oldRestart.checkpoint());
        for (const mutate of [
          (copy: typeof saved) => { Object.assign(copy.session!.options.production!, { adaptedUpgrades: null }); },
          (copy: typeof saved) => { Object.assign(copy.session!.options.production!, { adaptedUpgrades: { runtimeProfile: "strict-native" } }); },
          (copy: typeof saved) => { Object.assign(copy.session!.options, { fixedStepMilliseconds: 51 }); },
          (copy: typeof saved) => { Reflect.deleteProperty(copy.session!.options.production!, "adaptedCollectorProfiles"); },
        ]) {
          const invalid = json(saved); mutate(invalid);
          assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, invalid));
        }
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks,
          { ...mission, messages: [...mission.messages, { id: 9999, text: "changed source" }] }, saved));
        const fresh = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
        views.push(fresh);
        const current = json(fresh.checkpoint());
        Reflect.deleteProperty(current.session!.options.production!, "adaptedUpgrades");
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, current),
          "marker deletion cannot downgrade a current pinned source identity");
        assert.equal(JSON.stringify(mission), original);
      } finally { for (const view of views) view.dispose(); }
    });
  }

  test(`upgrade compatibility ${faction}: M01 M02 and strict profiles retain absent marker`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
      new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url))));
    for (const [number, profile] of [[1, undefined], [1, "browser-adapted"], [2, "browser-adapted"]] as const) {
      const mission = await loadCampaignMission(faction, number, profile);
      assert.equal(Object.hasOwn(mission.sourceProduction?.production ?? {}, "adaptedUpgrades"), false);
      const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
      let restored: MissionView | undefined;
      try {
        assert.equal(view.missionDiagnostic, undefined);
        const saved = json(view.checkpoint());
        assert.equal(Object.hasOwn(saved.session!.options.production ?? {}, "adaptedUpgrades"), false);
        assert.equal(Object.hasOwn(saved.session!.state.production ?? {}, "adaptedUpgrades"), false);
        restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
        assert.equal(restored.mission, mission);
        assert.deepEqual(restored.checkpoint(), saved);
        assert.equal(view.productionMenu.some(choice => choice.kind === "upgrade"), false);
      } finally { view.dispose(); restored?.dispose(); }
    }
  });
}