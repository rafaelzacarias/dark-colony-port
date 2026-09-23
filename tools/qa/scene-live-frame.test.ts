import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseMapBundle } from "../extractors/maps/map";

const root = new URL("../../", import.meta.url);

function sourceMission(faction: "HUMAN" | "ALIEN"): CampaignMissionData {
  const read = (path: string) => readFileSync(new URL(path, root));
  const json = (path: string) => JSON.parse(read(`public/assets/generated/${path}`).toString());
  const stem = `${faction}/${faction}01`;
  const original = (extension: string) => read(`raw_cd/DC/SCENARIO/${stem}.${extension}`);
  const bundle = parseMapBundle(original("MAP"), original("MTG"), original("PTH"));
  const map = json(`maps/${stem}.json`);
  const records = read(`public/assets/generated/maps/${faction}/${map.files.tileRecordIndices}`);
  return {
    faction: faction === "HUMAN" ? "human" : "alien", map,
    scenario: { ...json(`data/scenarios/${stem}.json`), ...parseScenario(original("SCN").toString()) },
    triggers: [], messages: [], briefing: json(`data/briefings/${stem}.json`),
    units: parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString()),
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    tileReferences: bundle.tileReferences, attributes: bundle.attributes, pathGrid: bundle.pathGrid, tags: bundle.tagGrid,
    tileRecordIndices: Uint16Array.from({ length: records.length / 2 }, (_, index) => records.readUInt16LE(index * 2)),
  };
}

test("real source-backed render shares one snapshot across visibility and all FIN draws", async (context) => {
  const draws: unknown[][] = [];
  const fills: number[][] = [];
  const warnings: string[] = [];
  const drawing = {
    setTransform() {}, clearRect() {}, fillRect(...args: number[]) { fills.push(args); },
    strokeRect() {}, beginPath() {}, ellipse() {}, stroke() {},
    save() {}, restore() {}, translate() {}, scale() {}, moveTo() {}, lineTo() {}, fillText() {}, setLineDash() {},
    drawImage(...args: unknown[]) { draws.push(args); },
    measureText(text: string) { return { width: text.length * 6 }; },
    createImageData(width: number, height: number) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData() {},
  };
  const canvas = () => ({ width: 512, height: 452,
    getContext: (kind: string) => kind === "2d" ? drawing : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }),
  }) as unknown as HTMLCanvasElement;
  class FixtureImage {
    decoding = "";
    #load: (() => void) | undefined;
    addEventListener(event: string, listener: () => void) { if (event === "load") this.#load = listener; }
    set src(_path: string) { queueMicrotask(() => this.#load?.()); }
  }
  for (const [key, value] of Object.entries({ Image: FixtureImage, document: { createElement: canvas } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    context.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  context.mock.method(globalThis, "fetch", async (url: string) => {
    assert.ok(url.startsWith("/assets/generated/"));
    return new Response(readFileSync(new URL(`public${url}`, root)));
  });
  context.mock.method(console, "warn", (...args: unknown[]) => warnings.push(String(args[0])));
  const measurements: { faction: string; units: number; snapshotReads: number; spriteDraws: number }[] = [];
  for (const faction of ["HUMAN", "ALIEN"] as const) {
    const view = new MissionView(canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, sourceMission(faction));
    context.after(() => view.dispose());
    assert.equal(view.missionDiagnostic, undefined);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    context.mock.method(view, "isOwnedUnit", () => true);
    const units = view.simulation.snapshot.units;
    const density = (center: typeof units[number]) => units.filter((unit) =>
      Math.abs(unit.cellX - center.cellX) < 7 && Math.abs(unit.cellY - center.cellY) < 6).length;
    const focus = units.reduce((best, unit) => density(unit) > density(best) ? unit : best);
    view.setCameraCenter(focus.cellX + 0.5, focus.cellY + 0.5);
    const readSnapshot = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(view.simulation), "snapshot")!.get!;
    let snapshotReads = 0;
    Object.defineProperty(view.simulation, "snapshot", { configurable: true, get() {
      snapshotReads += 1;
      assert.equal(snapshotReads, 1, "a frame must not fetch a second simulation snapshot");
      return readSnapshot.call(this);
    } });
    draws.length = 0;
    fills.length = 0;
    view.render();
    assert.equal(snapshotReads, 1);
    const spriteDraws = draws.filter(([image]) => !(image instanceof FixtureImage));
    assert.ok(spriteDraws.length > 1, `${faction}: multiple palette-backed FIN draws must execute`);
    assert.ok(spriteDraws.every((args) => args.length === 9), "atlas crop arguments remain intact");
    assert.ok(fills.filter((args) => args[3] === 2).length > 1, "unit health overlays must still draw separately");
    measurements.push({ faction, units: readSnapshot.call(view.simulation).units.length,
      snapshotReads, spriteDraws: spriteDraws.length });
    Reflect.deleteProperty(view.simulation, "snapshot");
  }
  assert.ok(warnings.some((warning) => warning.includes("native-cross-entity-child-sorting-unimplemented")));
  assert.notEqual(measurements[0].units, measurements[1].units);
  context.diagnostic(JSON.stringify(measurements));
});