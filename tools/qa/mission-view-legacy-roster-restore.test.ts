import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { loadSourceProductionOptions } from "../../src/engine/source-production-options";
import { MissionView } from "../../src/mission-view";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const callbacks = { onStats() {}, onUnitsChanged() {} };
const json = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;

for (const faction of ["human", "alien"] as const) {
  test(`legacy roster restore ${faction}03: controlled old loader config, exact 100 ticks and save again`, async context => {
    const views: MissionView[] = [];
    const loadBytes = async (url: string) => {
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      return read(`public${url}`);
    };
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(await loadBytes(String(input))));
    try {
      const mission = await loadCampaignMission(faction, 3, "browser-adapted");
      const sourceHash = hash(JSON.stringify(mission));
      const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}03`;
      const rawHashes = Object.fromEntries(["SCN", "TRO", "MAP", "MTG", "PTH"].map(extension =>
        [extension, hash(read(`raw_cd/DC/SCENARIO/${stem}.${extension}`))]));
      assert.equal(mission.scenario.source.sha256, rawHashes.SCN);
      const legacySource = await loadSourceProductionOptions({ sessionId: `${mission.scenario.id}:browser`, mission,
        rawScenario: Buffer.from(mission.scenario.rawScenario!, "base64"),
        configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: faction === "human" ? 0 : 1 },
        adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 120 }, loadBytes });
      assert.ok(mission.sourceProduction?.production?.adaptedUnitProfiles?.length);
      assert.ok(mission.sourceProduction.production.adaptedUpgrades);
      const { adaptedUnitProfiles: _profiles, adaptedUpgrades: _upgrades, ...expectedProduction } = mission.sourceProduction.production;
      assert.deepEqual(legacySource.production, expectedProduction, "old config omits both optional roster and upgrades");
      const legacyMission = { ...mission, sourceProduction: { ...mission.sourceProduction, production: legacySource.production } };
      const original = new MissionView(canvas(), {} as HTMLElement, callbacks, legacyMission);
      views.push(original);
      original.update(0);
      for (let tick = 1; tick <= 4; tick++) original.update(tick * 50);
      assert.equal(original.missionDiagnostic, undefined);
      assert.equal(original.simulation.snapshot.tick, 4);
      const saved = json(original.checkpoint());
      assert.equal(Object.hasOwn(saved.session!.options.production!, "adaptedUnitProfiles"), false);
      assert.equal(Object.hasOwn(saved.session!.options.production!, "adaptedUpgrades"), false);
      const restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
      views.push(restored);
      assert.deepEqual(restored.checkpoint(), saved);
      assert.deepEqual(restored.mission, legacyMission, "restart source must retain the original production profile");
      for (const view of [original, restored]) { view.resetClock(); view.update(0); }
      for (let tick = 1; tick <= 100; tick++) {
        original.update(tick * 50);
        restored.update(tick * 50);
        assert.equal(original.missionDiagnostic, undefined);
        assert.equal(restored.missionDiagnostic, undefined);
      }
      assert.equal(restored.simulation.snapshot.tick, 104);
      assert.deepEqual(restored.checkpoint(), original.checkpoint(), "whole checkpoint after 100 ticks");
      const savedAgain = json(restored.checkpoint());
      assert.equal(Object.hasOwn(savedAgain.session!.options.production!, "adaptedUnitProfiles"), false);
      assert.equal(Object.hasOwn(savedAgain.session!.options.production!, "adaptedUpgrades"), false);
      const restoredAgain = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, savedAgain);
      views.push(restoredAgain);
      assert.deepEqual(restoredAgain.checkpoint(), savedAgain);
      const restart = new MissionView(canvas(), {} as HTMLElement, callbacks, restored.mission);
      const legacyRestart = new MissionView(canvas(), {} as HTMLElement, callbacks, legacyMission);
      views.push(restart, legacyRestart);
      assert.deepEqual(restart.checkpoint(), legacyRestart.checkpoint(), "fresh restart uses the pinned legacy source");
      for (const mutate of [
        (copy: typeof saved) => { Reflect.deleteProperty(copy.session!.options.production!, "adaptedCollectorProfiles"); },
        (copy: typeof saved) => { Reflect.deleteProperty(copy.session!.options.production!, "sourceProfiles"); },
        (copy: typeof saved) => { Object.assign(copy.session!.options, { fixedStepMilliseconds: 51 }); },
        (copy: typeof saved) => { Object.assign(copy.session!.options, { commanders: [] }); },
        (copy: typeof saved) => { Object.assign(copy.session!.options, { runtimeProfile: "strict-native" }); },
      ]) {
        const invalid = json(saved);
        mutate(invalid);
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, invalid), /Invalid MissionView checkpoint/);
      }
      const changedMission = { ...mission, messages: [...mission.messages, { id: 9999, text: "unrelated source edit" }] };
      assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, changedMission, saved), /Invalid MissionView checkpoint/);
      assert.equal(hash(JSON.stringify(mission)), sourceHash, "current loader mission unchanged");
      for (const [extension, before] of Object.entries(rawHashes)) {
        assert.equal(hash(read(`raw_cd/DC/SCENARIO/${stem}.${extension}`)), before, `${extension} unchanged`);
      }
    } finally {
      for (const view of views) view.dispose();
    }
  });

  test(`legacy roster restore ${faction}: current profiles remain exact and M01/M02 stay unchanged`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      return new Response(read(`public${url}`));
    });
    const views: MissionView[] = [];
    try {
      for (const missionNumber of [1, 2, 3]) {
        const mission = await loadCampaignMission(faction, missionNumber, "browser-adapted");
        const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
        views.push(view);
        assert.equal(view.missionDiagnostic, undefined);
        const saved = json(view.checkpoint());
        const restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
        views.push(restored);
        assert.equal(restored.mission, mission, "current mission needs no legacy pin");
        assert.deepEqual(restored.checkpoint(), saved);
        if (missionNumber < 3) {
          assert.equal(Object.hasOwn(saved.session!.options.production ?? {}, "adaptedUnitProfiles"), false);
          assert.equal(Object.hasOwn(saved.session!.options.production ?? {}, "adaptedUpgrades"), false);
          continue;
        }
        assert.ok(saved.session!.options.production!.adaptedUpgrades);
        const profiles = saved.session!.options.production!.adaptedUnitProfiles!;
        assert.ok(profiles.length > 0);
        for (const replacement of [[], null, undefined,
          profiles.slice(1),
          profiles.map((profile, index) => index === 0 ? { ...profile, completionVisits: profile.completionVisits + 1 } : profile),
          profiles.map(profile => ({ ...profile, unexpected: true })),
        ]) {
          const invalid = json(saved);
          Object.assign(invalid.session!.options.production!, { adaptedUnitProfiles: replacement });
          assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, invalid), /Invalid MissionView checkpoint/);
        }
        const removed = json(saved);
        Reflect.deleteProperty(removed.session!.options.production!, "adaptedUnitProfiles");
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, removed), /Invalid MissionView checkpoint/,
          "deleting profiles from a current source identity must not downgrade it");
        const inconsistent = json(saved);
        Reflect.deleteProperty(inconsistent.session!.state.production!, "adaptedUnitProfiles");
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, inconsistent),
          "session replay must still authenticate profile state");
      }
      const strictMission = await loadCampaignMission(faction, 1);
      const strictView = new MissionView(canvas(), {} as HTMLElement, callbacks, strictMission);
      views.push(strictView);
      assert.equal(strictView.missionDiagnostic, undefined);
      const strictSaved = json(strictView.checkpoint());
      const strictRestored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, strictMission, strictSaved);
      views.push(strictRestored);
      assert.equal(strictRestored.mission, strictMission);
      assert.deepEqual(strictRestored.checkpoint(), strictSaved);
    } finally {
      for (const view of views) view.dispose();
    }
  });
}