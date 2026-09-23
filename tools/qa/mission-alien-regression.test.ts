import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CampaignMissionData } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";

function alienMission(): CampaignMissionData {
  const root = new URL("../../public/assets/generated/", import.meta.url);
  const bytes = (path: string) => readFileSync(new URL(path, root));
  const json = (path: string) => JSON.parse(bytes(path).toString("utf8"));
  const words = (path: string) => {
    const data = bytes(path);
    return Uint16Array.from({ length: data.length / 2 }, (_, index) => data.readUInt16LE(index * 2));
  };
  const stem = "ALIEN/ALIEN01", map = json(`maps/${stem}.json`);
  return {
    faction: "alien", map, scenario: json(`data/scenarios/${stem}.json`),
    triggers: json(`data/triggers/${stem}.json`).blocks, messages: json(`data/messages/${stem}.json`).messages,
    briefing: json(`data/briefings/${stem}.json`), units: json("data/units.json").records,
    weapons: json("data/weapons.json").records, damageMatrix: json("data/damage-matrix.json").coefficients,
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    tileReferences: words(`maps/ALIEN/${map.files.tileReferences}`),
    tileRecordIndices: words(`maps/ALIEN/${map.files.tileRecordIndices}`),
    attributes: words(`maps/ALIEN/${map.files.attributes}`),
    tags: Uint8Array.from(bytes(`maps/ALIEN/${map.files.tags}`)),
    pathGrid: Uint8Array.from(bytes(`maps/ALIEN/${map.files.pathGrid}`)),
  };
}

const renderCases = [
  ["normal", "AL01 normal initialized rendering keeps the source SAUC carrier and delivers four GRAY plus commander"],
  ["missing-state", "AL01 missing GRAY states retain warnings without debug rectangles"],
  ["unsupported-timeline", "AL01 missing GRAY timeline durations retain warnings without debug rectangles"],
  ["carrier-state", "AL01 missing SAUC state stops the mission without placeholder art"],
  ["carrier-composition", "AL01 missing SAUC composition stops the mission without placeholder art"],
] as const;

for (const [renderCase, name] of renderCases) test(name, async (context) => {
  const root = new URL("../../public/", import.meta.url);
  const fetched = new Set<string>();
  context.mock.method(globalThis, "fetch", async (url: string) => {
    fetched.add(url);
    const bytes = readFileSync(new URL(url.slice(1), root));
    if (url === "/assets/generated/animations/GRAY.json" &&
      (renderCase === "missing-state" || renderCase === "unsupported-timeline")) {
      const animation = JSON.parse(bytes.toString("utf8"));
      if (renderCase === "missing-state") animation.states = [];
      else for (const entry of animation.timeline) delete entry.field2;
      return Response.json(animation);
    }
    if (url === "/assets/generated/animations/SAUC.json" && renderCase.startsWith("carrier-")) {
      const animation = JSON.parse(bytes.toString("utf8"));
      if (renderCase === "carrier-state") animation.states = [];
      else for (const entry of animation.timeline) entry.children = [];
      return Response.json(animation);
    }
    return new Response(bytes);
  });
  const warnings: string[] = [];
  context.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); });
  let spriteDraws = 0;
  const rectangles: { color: unknown; width: number; height: number }[] = [];
  const labels: string[] = [];
  const drawing = new Proxy({
    strokeStyle: "#000000",
    strokeRect(_x: number, _y: number, width: number, height: number) {
      rectangles.push({ color: this.strokeStyle, width, height });
    },
    fillText(text: string) { labels.push(text); },
    drawImage: (image: { palette?: boolean }) => { if (image.palette) spriteDraws += 1; },
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    measureText: () => ({ width: 0 }),
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
  const canvas = () => ({ width: 512, height: 452, palette: true,
    getContext: (type: string) => type === "2d" ? drawing : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }),
  }) as unknown as HTMLCanvasElement;
  const originals = ["Image", "document"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  class SourceImage {
    width = 0;
    height = 0;
    listeners = new Map<string, () => void>();
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    set src(url: string) {
      const bytes = readFileSync(new URL(url.slice(1), root));
      this.width = bytes.readUInt32BE(16); this.height = bytes.readUInt32BE(20);
      queueMicrotask(() => this.listeners.get("load")?.());
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: SourceImage });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: canvas } });
  const view = new MissionView(canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, alienMission());
  try {
    assert.equal(view.mission.sourceNativeCombat, undefined);
    assert.equal(view.missionDiagnostic, undefined);
    await view.initialize();
    if (renderCase.startsWith("carrier-")) {
      view.update(0);
      for (let tick = 1; tick <= 1000 && !view.missionDiagnostic; tick += 1) view.update(tick * 50);
      assert.ok(view.carrierVisuals.some(carrier => carrier.sprite === "SAUC"));
      assert.equal(view.missionDiagnostic, renderCase === "carrier-state"
        ? "Unsupported carrier asset/state: SAUC:MIDDLE" : "Missing carrier composition: SAUC");
      const stoppedTick = view.simulation.snapshot.tick;
      view.update(100_000);
      assert.equal(view.simulation.snapshot.tick, stoppedTick, "carrier failure must still block simulation");
      assert.equal(view.simulation.snapshot.units.filter(unit => view.isOwnedUnit(unit.id)).length, 0,
        "failed carrier must not admit substitute troops");
      return;
    }
    assert.equal(view.missionDiagnostic, undefined);
    view.update(0);
    let delivered = false;
    for (let tick = 1; tick <= 1000; tick += 1) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
      const owned = view.simulation.snapshot.units.filter(unit => view.isOwnedUnit(unit.id));
      if (owned.length !== 5) continue;
      assert.ok(owned.every(unit => unit.faction === "alien"));
      const types = view.campaignSnapshot!.world.entities.filter(entity => entity.team === 0).map(entity => entity.unitType);
      assert.equal(types.filter(type => type === 8).length, 4);
      assert.equal(types.filter(type => type === 73).length, 1);
      assert.ok(owned.every(unit => view.visibility[unit.cellY * view.grid.width + unit.cellX] === 1));
      delivered = true;
      break;
    }
    assert.ok(delivered, "unaltered source TRO must deliver five owned troops");
    assert.ok(fetched.has("/assets/generated/animations/SAUC.json"));
    assert.ok(fetched.has("/assets/generated/animations/SAWS.json"));
    assert.ok(fetched.has("/assets/generated/animations/GRAY.json"));
    assert.ok(spriteDraws > 0, "real FIN selection/composition must draw remapped sprites");
    if (renderCase === "normal") {
      assert.ok(!warnings.some(warning => /missing-state:GRAY|unsupported-timeline:GRAY/.test(warning)), warnings.join("\n"));
    } else {
      assert.ok(warnings.some(warning => warning.includes(`[FIN renderer] ${renderCase}:GRAY:`)), warnings.join("\n"));
      if (renderCase === "unsupported-timeline") {
        assert.ok(warnings.some(warning => warning.includes("Missing source FIN duration")), warnings.join("\n"));
      }
    }
  } finally {
    view.dispose();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    assert.equal(rectangles.filter(rectangle => rectangle.color === "#ff5978").length, 0,
      "unsupported rendering must never paint red debug rectangles");
    assert.equal(rectangles.filter(({ width, height }) => (width === 8 && height === 8) ||
      (width === 24 && height === 24)).length, 0, "no replacement debug boxes");
    assert.ok(!labels.some(label => /^SAUC \w+$/.test(label)), "no carrier placeholder labels");
  }
});