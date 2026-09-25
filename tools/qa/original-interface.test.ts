import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { baseMenuEntries, CONSTRUCTION_INTERFACE_IDS } from "../../src/ui/base-menu";
import { CAMPAIGN_CINEMATICS, INTRO_CINEMATIC, outcomeCinematic } from "../../src/ui/cinematics";
import { MAINE_MENU_BUTTONS, MAINE_TABS } from "../../src/ui/original-interface";

const root = new URL("../../", import.meta.url);
const raw = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root), "latin1").replace(/\r/g, "");

function parseMaine() {
  const text = new Map<number, string>();
  const buttons = new Map<number, { x: number; y: number; w: number; h: number; frame: number }>();
  const pictures = new Map<number, number>();
  for (const line of raw("INTRFACE/MAINE").split("\n")) {
    if (/^\s*%/.test(line)) continue;
    const message = line.match(/^textmsg\s+(\d+)\s+(.*)$/);
    if (message) { text.set(Number(message[1]), message[2].trim()); continue; }
    const button = line.match(/^(?:count|pushb|checkb)\s+(\d+)\s+\d+\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)/);
    if (button) {
      const [, id, x, y, w, h, frame] = button.map(Number);
      buttons.set(id, { x, y, w, h, frame });
      continue;
    }
    const picture = line.match(/^picture\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (picture) pictures.set(Number(picture[1]), Number(picture[2]));
  }
  return { text, buttons, pictures };
}

test("original interface: every menu button matches INTRFACE/MAINE geometry, frame and label", () => {
  const maine = parseMaine();
  for (const [id, [x, y, frame, label]] of Object.entries(MAINE_MENU_BUTTONS)) {
    const source = maine.buttons.get(Number(id));
    assert.ok(source, `MAINE button ${id}`);
    assert.deepEqual({ x, y, frame, label, w: 59, h: 41 },
      { x: source.x, y: source.y, frame: source.frame, label: maine.text.get(Number(id)), w: source.w, h: source.h });
  }
  for (const [index, tab] of MAINE_TABS.entries()) {
    assert.deepEqual([maine.buttons.get(index)!.x, maine.buttons.get(index)!.w], [tab.x, tab.width]);
    assert.equal(maine.pictures.get(index + 3), tab.frame);
  }
  assert.deepEqual(maine.buttons.get(19), { x: 516, y: 422, w: 86, h: 27, frame: -1 });
});

test("original interface: every DEPEND action the menu can offer maps to a MAINE button", () => {
  const dependencies = JSON.parse(readFileSync(new URL("public/assets/generated/data/dependencies.json", root), "utf8")) as {
    records: { id: number; interfaceId: number; rawFields: number[] }[];
  };
  for (const record of dependencies.records) {
    assert.ok(MAINE_MENU_BUTTONS[record.interfaceId], `dependency ${record.id} interface ${record.interfaceId}`);
    if (record.rawFields[0] === 0) assert.equal(CONSTRUCTION_INTERFACE_IDS[record.id], record.interfaceId);
  }
  assert.equal(Object.keys(CONSTRUCTION_INTERFACE_IDS).length, dependencies.records.filter(record => record.rawFields[0] === 0).length);
});

test("base menu: shared cells show the next actionable building or upgrade level", () => {
  const construction = (dependency: number, status: string, requestEnabled: boolean, action = "purchase") => ({
    team: 0, slot: 3, action, dependency, unitType: 20, label: "Science laboratory", status, busy: 0, latch: 0,
    visits: 0, health: 400, submitting: false, completionVisits: 120, cost: 2000, credits: 5000, timing: "adapted",
    requestEnabled, reason: requestEnabled ? "" : "Source prerequisites",
  });
  const production = (dependency: number, interfaceId: number, nativeState: 0 | 1 | 2) => ({
    dependency, interfaceId, kind: "upgrade", nativeState, supported: true, pending: 0, queued: 0,
    maxAdditional: nativeState === 1 ? 1 : 0, canDispatch: false, canReleasePending: false, cost: 1000, unitType: 0,
    credits: 5000, costAccumulator: 0, producerNativeSlot: 2, sprite: "TRSC", enabled: nativeState === 1, submitting: false,
  });
  const mission = {
    mission: {}, purchaseProduction: () => false, purchaseConstruction: () => false,
    constructionMenu: [construction(2, "complete", false), construction(4, "unbuilt", true, "upgrade")],
    productionMenu: [production(44, 110, 0), production(45, 111, 1), production(9, 89, 1)].map((choice, index) =>
      index === 2 ? { ...choice, kind: "unit", queued: 2, pending: 1, maxAdditional: 14 } : choice),
  } as unknown as Parameters<typeof baseMenuEntries>[0];
  const entries = baseMenuEntries(mission);
  assert.deepEqual(entries.map(entry => [entry.key, entry.tab, entry.x, entry.y, entry.frame]).sort(),
    [["c:4", "build", 577, 276, 26], ["p:45", "research", 518, 112, 27], ["p:9", "build", 518, 153, 6]]);
  assert.equal(entries.find(entry => entry.key === "p:9")!.count, 3);
});

test("cinematics: victory and defeat AVIs match GAMESTAT scene tables and ship in the media index", () => {
  const media = JSON.parse(readFileSync(new URL("public/assets/generated/media/index.json", root), "utf8")) as {
    entries: { kind: string; source: string; outputs: { path: string; mimeType: string }[] }[];
  };
  const videos = new Map(media.entries.filter(entry => entry.kind === "video").map(entry => [entry.source, entry.outputs]));
  for (const [faction, file] of [["human", "HSCENE.TXT"], ["alien", "GSCENE.TXT"]] as const) {
    const lines = raw(`GAMESTAT/${file}`).split("\n").map(line => line.trim());
    const avis = lines.filter(line => /^avi\/.+\.avi$/i.test(line)).map(line => line.slice(4, -4).toUpperCase());
    assert.equal(avis.length, 30);
    assert.deepEqual(CAMPAIGN_CINEMATICS[faction].flat(), avis);
    for (let mission = 1; mission <= 15; mission++) {
      assert.equal(outcomeCinematic(faction, mission, 0), avis[(mission - 1) * 2]);
      assert.equal(outcomeCinematic(faction, mission, 1), avis[(mission - 1) * 2 + 1]);
    }
  }
  for (const name of [INTRO_CINEMATIC, ...Object.values(CAMPAIGN_CINEMATICS).flat(2)]) {
    const outputs = videos.get(`AVI/${name}.AVI`);
    assert.ok(outputs, name);
    assert.deepEqual(outputs.map(output => output.path).sort(), [`video/AVI/${name}.mp4`, `video/AVI/${name}.webm`]);
  }
  assert.equal(outcomeCinematic("human", 15, 0), "HENDING");
  assert.equal(outcomeCinematic("alien", 15, 0), "AENDING");
  assert.equal(outcomeCinematic("human", 16, 0), undefined);
});
