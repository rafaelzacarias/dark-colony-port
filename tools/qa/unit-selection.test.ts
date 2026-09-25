import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { finBodyBounds, composeFinSample, type FinCompositionPart } from "../../src/render/fin-composition";
import { createFinFrameLookup, createFinSelector, type FinAnimationData } from "../../src/render/fin-animation";
import { createFinSourceSampler } from "../../src/render/fin-composition";
import { TRSC_GRAY_VISUAL_DIRECTIONS } from "../../src/render";
import { sourceUnitIsCommander } from "../../src/engine/browser-casualty-pickup";
import { loadReleaseMission } from "./fixtures/release-mission";
import { installSourceRender } from "./fixtures/source-render";

const read = (path: string) => readFileSync(new URL(`../../public/assets/generated/${path}`, import.meta.url), "utf8");

test("FIN body bounds include body/shadow frames but exclude muzzle flashes, effects, and empty frames", () => {
  const part = (mode: number, x: number, y: number, width: number, height: number): FinCompositionPart => ({
    x, y, mirrored: false, diagnostics: [],
    child: { sprite: "TRSC", frame: 0, flags: 16, layer: 0, x: 0, y: 0, valueA: mode, valueB: 0 },
    frame: { index: 0, x: 0, y: 0, width, height, anchorX: 0, anchorY: 0, empty: false },
  });
  const parts = [part(0, -10, -40, 20, 40), part(1, -16, -25, 32, 23),
    part(3, -100, -150, 200, 200), part(5, -80, -200, 160, 160), part(0, -90, -90, 0, 0)];
  assert.deepEqual(finBodyBounds(parts, { x: 100, y: 200 }), { left: 84, top: 160, right: 116, bottom: 200 });
  assert.deepEqual(finBodyBounds(parts, { x: 10, y: 20 }, 0.5), { left: 2, top: 0, right: 18, bottom: 20 });
  assert.equal(finBodyBounds(parts.slice(2), { x: 0, y: 0 }), undefined);
  assert.deepEqual(finBodyBounds([{ ...parts[0], mirrored: true }], { x: 100, y: 200 }),
    { left: 90, top: 160, right: 110, bottom: 200 });
});

for (const faction of ["human", "alien"] as const) test(`${faction}: select the visible body at CSS scale; commander star is persistent`, async context => {
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url))));
  const canvas = renderer.canvas();
  const bounds = { left: 30, top: 50, width: 512, height: 452 };
  context.mock.method(canvas, "getBoundingClientRect", () => ({ ...bounds, x: bounds.left, y: bounds.top,
    right: bounds.left + bounds.width, bottom: bounds.top + bounds.height, toJSON: () => bounds }));
  let view: MissionView | undefined;
  try {
    const mission = await loadReleaseMission(faction, 10);
    view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    view.update(0);
    for (let tick = 1; tick <= 800; tick++) {
      if (tick % 16 === 1 && view.checkpoint().state.unitStats.some(stat => sourceUnitIsCommander(stat.type)
        && view!.isOwnedUnit(stat.id))) break;
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined);
    }
    const commanderStat = view.checkpoint().state.unitStats.find(stat => sourceUnitIsCommander(stat.type) && view!.isOwnedUnit(stat.id));
    assert.ok(commanderStat);
    const commander = view.simulation.snapshot.units.find(unit => unit.id === commanderStat.id)!;
    const sprite = mission.units.find(stat => stat.index === commanderStat.type)!.sprite;
    const animation: FinAnimationData = JSON.parse(read(`animations/${sprite}.json`));
    const sprites = [...new Set(animation.timeline.flatMap(frame => frame.children.map(child => child.sprite)))];
    const lookup = createFinFrameLookup(Object.fromEntries(sprites.map(name => [name, JSON.parse(read(`sprites/SPRITES/${name}.json`))])));
    const selector = createFinSelector(animation, { prefix: sprite, directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" });
    const sample = createFinSourceSampler(animation);
    view.setCameraCenter(commander.xSubcells / 1024, commander.ySubcells / 1024);
    renderer.setEnabled(true);
    const drawing = canvas.getContext("2d")!;
    let stars = 0;
    drawing.fill = () => { if (drawing.fillStyle === "#f2ce65") stars++; };
    const present = () => { stars = 0; view!.render(); assert.equal(stars, 1, "one persistent star over the living player commander"); };
    present();
    const body = () => {
      const state = view!.checkpoint().state.animationStates.find(state => state.id === commander.id)!;
      const selected = selector.select(state.action, state.facing)!;
      const origin = { x: (commander.xSubcells / 1024 - view!.cameraView.x) * 32,
        y: (view!.cameraView.y + view!.cameraView.height - commander.ySubcells / 1024) * 32 };
      return { box: finBodyBounds(composeFinSample(sample(selected, view!.simulation.snapshot.tick - state.since), lookup), origin)!,
        origin };
    };
    for (const scale of [1, 0.5, 1.5]) {
      bounds.width = 512 * scale; bounds.height = 452 * scale;
      view.clearSelection();
      present();
      const { box, origin } = body();
      const left = (box.left + box.right) / 2 - 2, right = left + 4;
      const top = box.top + 2, bottom = box.top + Math.min(12, (box.bottom - box.top) / 2);
      assert.ok(bottom < origin.y, "drag covers the upper body without including the unit's ground position");
      const client = (x: number, y: number) => ({ x: bounds.left + x * scale, y: bounds.top + y * scale });
      const start = client(left, top), end = client(right, bottom);
      view.selectUnitsInClientRect(end.x, end.y, start.x, start.y);
      assert.ok(view.selectedIds.includes(commander.id), `upper-body rectangle selects at ${scale}x`);
      present();
      view.clearSelection();
      const point = client((left + right) / 2, (top + bottom) / 2);
      assert.equal(view.cursorAt(point.x, point.y), "select");
      view.commandAt(point.x, point.y);
      assert.ok(view.selectedIds.includes(commander.id), `body click selects at ${scale}x`);
      present();
      view.panByCells(2, 0);
    }
    const saved = view.checkpoint();
    present();
    assert.deepEqual(view.checkpoint(), saved, "bounds and stars are presentation-only, not saved game mutations");
    renderer.setEnabled(false);
    const attacker = view.simulation.addUnit({ faction: faction === "human" ? "alien" : "human", team: 7, movementPlane: "air",
      cell: { x: commander.cellX, y: commander.cellY }, weapon: { damage: commander.health, rangeCells: 2, cooldownTicks: 1 } });
    view.simulation.queue({ type: "attack", unitIds: [attacker], targetId: commander.id });
    view.simulation.advance();
    view.simulation.removeUnit(attacker);
    renderer.setEnabled(true);
    stars = 0; view.render();
    assert.equal(stars, 0, "dead commanders do not retain a star");
  } finally { view?.dispose(); renderer.dispose(); }
});
