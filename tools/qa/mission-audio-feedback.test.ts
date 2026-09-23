import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { MissionAudioFeedback } from "../../src/audio/mission-feedback";
import type { AudioCue, WebAudioManager } from "../../src/audio";

const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

test("HUMAN01 audio: committed frames only, no repeated frame dispatch, source selection and reload cleanup", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url))));
  const mission = await loadCampaignMission("human", 1, "browser-adapted");
  const calls: AudioCue[] = [];
  const audio = { play: async (cue: AudioCue) => { calls.push(cue); return undefined; } } as unknown as WebAudioManager;
  const present = context.mock.method(MissionAudioFeedback.prototype, "present");
  const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission, audio);
  let restored: MissionView | undefined;
  try {
    assert.equal(view.missionDiagnostic, undefined);
    view.update(0);
    for (let tick = 1; tick <= 200; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined);
    }
    assert.equal(present.mock.callCount(), 200, "silent staged candidates must not present audio");
    const before = calls.length;
    view.render(); view.update(10000); view.render();
    assert.equal(present.mock.callCount(), 200);
    assert.equal(calls.length, before);
    const saved = view.checkpoint();
    const troop = saved.state.unitStats.find(entry => entry.type === 0
      && saved.state.unitTeams.some(team => team.id === entry.id && team.team === 0));
    assert.ok(troop, "original startup delivers player troopers");
    view.selectUnit(troop.id);
    assert.equal(calls.at(-1)!.assetId, "SOUND/TRP1SEL.WAV");
    const response = calls.at(-1)!;
    view.dispose();
    assert.equal(response.signal!.aborted, true);
    const after = calls.length;
    restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)), audio);
    assert.equal(calls.length, after, "restore must not replay saved audio history");
    assert.deepEqual(restored.checkpoint(), saved);
    restored.update(10000); restored.render();
    assert.equal(calls.length, after);
  } finally {
    view.dispose(); restored?.dispose();
  }
});