import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { createFinSelector, createFinSourceSampler, TRSC_GRAY_VISUAL_DIRECTIONS,
  type FinAnimationData, type FinAtlasFrame } from "../../src/render";
import { nativePaletteImage } from "../../src/render/mode1-canvas";
import { installSourceRender } from "./fixtures/source-render";

test("corpse overlay: combat death draws original Die FIN frames, hides bars and selection, leaves saves unchanged", async context => {
  const rendering = installSourceRender();
  const read = (path: string) => readFileSync(new URL(`../../public/${path}`, import.meta.url));
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    return new Response(read(url.slice(1)));
  });
  const drawing = rendering.canvas().getContext("2d")!;
  const bars: { style: string | CanvasGradient | CanvasPattern; rectangle: number[] }[] = [];
  const rings: Parameters<CanvasRenderingContext2D["ellipse"]>[] = [];
  const frames: number[] = [];
  const animation: FinAnimationData = JSON.parse(read("assets/generated/animations/GRAY.json").toString());
  const atlas: { frames: FinAtlasFrame[] } = JSON.parse(read("assets/generated/sprites/SPRITES/GRAY.json").toString());
  const indexed = JSON.parse(read("assets/generated/indexed/sprites/SPRITES/GRAY.json").toString());
  const indices = read(`assets/generated/indexed/${indexed.indices.path}`);
  const coverage = read(`assets/generated/indexed/${indexed.coverage.path}`);
  drawing.fillRect = (...rectangle: number[]) => {
    if (drawing.fillStyle === "rgba(0,0,0,.72)" || drawing.fillStyle === "#d45a4d" || drawing.fillStyle === "#70c7e9") {
      bars.push({ style: drawing.fillStyle, rectangle });
    }
  };
  drawing.ellipse = (...coordinates: Parameters<CanvasRenderingContext2D["ellipse"]>) => { rings.push(coordinates); };
  context.mock.method(drawing, "drawImage", (image: CanvasImageSource, ...coordinates: number[]) => {
    const palette = nativePaletteImage(image);
    if (!palette || !indices.equals(palette.indices) || !coverage.equals(palette.coverage)) return;
    const [left, top, width, height] = coordinates;
    const frame = atlas.frames.find(frame => frame.x === left && frame.y === top && frame.width === width && frame.height === height);
    assert.ok(frame);
    frames.push(frame.index);
  });
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("alien");
    const source = JSON.stringify(mission);
    view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    rendering.setEnabled(false);
    for (let tick = 0; tick <= 220; tick++) view.update(tick * 50);
    assert.equal(view.missionDiagnostic, undefined);
    const victim = view.simulation.snapshot.units.find(unit => view!.isOwnedUnit(unit.id))!;
    assert.ok(victim && victim.health > 0);
    const victimType = view.checkpoint().state.unitStats.find(unit => unit.id === victim.id)!.type;
    assert.equal(mission.units.find(unit => unit.index === victimType)!.sprite, "GRAY");
    view.setCameraCenter(victim.xSubcells / 1024, victim.ySubcells / 1024);
    view.replaceSelection([victim.id]);
    rendering.setEnabled(true);
    const present = () => {
      view!.render();
      const before = view!.checkpoint();
      bars.length = 0; rings.length = 0; frames.length = 0;
      view!.render();
      assert.deepEqual(view!.checkpoint(), before, "repeated drawing leaves the full save unchanged");
      return before;
    };
    present();
    const camera = view.cameraView;
    const screenX = (victim.xSubcells / 1024 - camera.x) * 32;
    const screenY = (camera.y + camera.height - victim.ySubcells / 1024) * 32;
    const victimBars = () => bars.filter(bar => bar.rectangle[0] === screenX - 12 && bar.rectangle[1] === screenY - 22.4);
    assert.deepEqual(victimBars(), [
      { style: "rgba(0,0,0,.72)", rectangle: [screenX - 12, screenY - 22.4, 24, 3] },
      { style: "#d45a4d", rectangle: [screenX - 12, screenY - 22.4, 24 * victim.health / victim.maxHealth, 2] },
    ]);
    assert.ok(rings.some(ring => ring[0] === screenX && ring[1] === screenY + 4));
    const livingBars = bars.filter(bar => !victimBars().includes(bar));
    const livingFrames = [...frames];
    rendering.setEnabled(false);
    const attacker = view.simulation.addUnit({ faction: "human", team: 1, movementPlane: "air",
      cell: { x: victim.cellX, y: victim.cellY },
      weapon: { damage: victim.health, rangeCells: 2, cooldownTicks: 1 } });
    assert.ok(view.simulation.canAutoTarget(attacker, victim.id), "fixture attacker must be hostile");
    view.simulation.queue({ type: "attack", unitIds: [attacker], targetId: victim.id });
    view.simulation.advance();
    assert.ok(view.simulation.deathEvents.some(event => event.targetId === victim.id));
    view.simulation.removeUnit(attacker);
    const corpse = view.simulation.snapshot.units.find(unit => unit.id === victim.id)!;
    assert.equal(corpse.health, 0);
    assert.equal(corpse.activity, "die");
    assert.ok(view.selectedIds.includes(victim.id), "exercise a corpse whose selection has not yet reconciled");
    const simulationBefore = view.simulation.checkpoint();
    rendering.setEnabled(true);
    const saved = present();
    assert.deepEqual(view.simulation.checkpoint(), simulationBefore);
    assert.deepEqual(victimBars(), [], "no black background or colored health fill on corpses");
    assert.equal(rings.some(ring => ring[0] === screenX && ring[1] === screenY + 4), false);
    assert.deepEqual(bars, livingBars, "other living unit overlays are unchanged");
    const state = saved.state.animationStates.find(state => state.id === victim.id)!;
    assert.equal(state.action, "Die");
    assert.equal(state.facing, "S");
    const selection = createFinSelector(animation, { prefix: "GRAY", directions: TRSC_GRAY_VISUAL_DIRECTIONS,
      layerOrder: "source" }).select("Die", state.facing)!;
    assert.ok(selection);
    assert.equal(selection.action, "Die", "direction fallback must retain the original death action");
    assert.equal(selection.state.name, "GRAYDIEA2");
    const sample = createFinSourceSampler(animation)(selection, saved.simulation.tick - state.since);
    const deathFrames = sample.children.filter(child => child.sprite.toUpperCase() === "GRAY").map(child => child.frame);
    assert.ok(deathFrames.length > 0);
    for (const frame of deathFrames) {
      assert.ok(!livingFrames.includes(frame), `source corpse frame ${frame} was absent before death`);
      assert.ok(frames.includes(frame), `source corpse frame ${frame} still drawn`);
    }
    assert.equal(JSON.stringify(mission), source);
    assert.equal(view.missionDiagnostic, undefined);
  } finally {
    view?.dispose();
    rendering.dispose();
  }
});