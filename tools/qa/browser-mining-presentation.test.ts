import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { SUBCELLS_PER_CELL } from "../../src/engine";
import { MissionView, missionAnimationArchives, missionMiningVisualType, missionUnitAction } from "../../src/mission-view";
import { composeFinSample, createFinFrameLookup, createFinSelector, createFinSourceSampler,
  TRSC_GRAY_VISUAL_DIRECTIONS, type FinAnimationData, type FinAtlasFrame } from "../../src/render";
import { nativePaletteImage } from "../../src/render/mode1-canvas";
import { adaptedGoldExtractorIndices } from "../../src/render/mission-sprites";
import { installSourceRender } from "./fixtures/source-render";

const read = (path: string) => readFileSync(new URL(`../../public/assets/generated/${path}`, import.meta.url));
const json = <Value>(path: string): Value => JSON.parse(read(path).toString());
const callbacks = { onStats() {}, onUnitsChanged() {} };

function sourceVisual(sprite: "EDPLY" | "SDPL") {
  const archive = sprite === "EDPLY" ? "EXPL" : "SLUG";
  assert.deepEqual(missionAnimationArchives(sprite), [archive]);
  const animation = json<FinAnimationData>(`animations/${archive}.json`);
  const metadata = json<{ frames: FinAtlasFrame[] }>(`sprites/SPRITES/${archive}.json`);
  const selector = createFinSelector(animation, { prefix: sprite,
    directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" });
  const selection = selector.select("Stand", "S")!;
  assert.ok(selection.state.name.startsWith(`${sprite}STAND`));
  const sample = createFinSourceSampler(animation);
  const frames = new Set<number>();
  for (let tick = 0; tick < 40; tick++) {
    for (const child of sample(selection, tick).children) {
      if (child.sprite.toUpperCase() === archive) frames.add(child.frame);
    }
  }
  assert.ok(frames.size > 0);
  return { archive, animation, metadata, selector, selection, sample, frames };
}

test("mining presentation source: deployed Stand uses original EXPL/SLUG children and existing PNGs", () => {
  for (const sprite of ["EDPLY", "SDPL"] as const) {
    const source = sourceVisual(sprite);
    const names = new Set(source.animation.timeline.flatMap(entry => entry.children.map(child => child.sprite.toUpperCase())));
    const atlases = Object.fromEntries([...names].map(name => {
      const png = read(`sprites/SPRITES/${name}.png`);
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      return [name, json<{ frames: FinAtlasFrame[] }>(`sprites/SPRITES/${name}.json`)];
    }));
    const lookup = createFinFrameLookup(atlases);
    for (const direction of ["S", "SE", "SW", "N"] as const) {
      const selection = source.selector.select("Stand", direction)!;
      assert.ok(selection.state.name.startsWith(`${sprite}STAND`));
      for (let tick = 0; tick < 40; tick++) {
        const parts = composeFinSample(source.sample(selection, tick), lookup);
        assert.ok(parts.some(part => part.child.sprite.toUpperCase() === source.archive));
        assert.ok(parts.every(part => part.frame && !part.diagnostics.includes("missing-atlas-frame")));
        assert.ok(parts.every(part => part.child.sprite.toUpperCase() !== sprite), "no invented deployed atlas");
      }
    }
  }
});

for (const faction of ["human", "alien"] as const) {
  test(`mining presentation actual ${faction.toUpperCase()}02: extraction draw, guards, Stop and unchanged save`, async context => {
    const renderer = installSourceRender();
    const requests: string[] = [];
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      requests.push(url);
      return new Response(read(url.slice("/assets/generated/".length)));
    });
    const views: MissionView[] = [];
    try {
      const typeId = faction === "human" ? 6 : 14;
      const deployedType = faction === "human" ? 47 : 48;
      const sprite = faction === "human" ? "EDPLY" : "SDPL";
      const source = sourceVisual(sprite);
      const indexed = json<{ indices: { path: string }; coverage: { path: string } }>(`indexed/sprites/SPRITES/${source.archive}.json`);
      const indices = read(`indexed/${indexed.indices.path}`), coverage = read(`indexed/${indexed.coverage.path}`);
      const drawn: number[] = [];
      const selectors = new Set<number>();
      const drawing = renderer.canvas().getContext("2d")!;
      const matching = new WeakMap<CanvasImageSource, boolean>();
      context.mock.method(drawing, "drawImage", (image: CanvasImageSource, ...coordinates: number[]) => {
        if (!matching.has(image)) {
          const atlas = nativePaletteImage(image);
          const expectedIndices = atlas && faction === "human"
            ? Buffer.from(adaptedGoldExtractorIndices(indices, atlas.palette, atlas.remap)) : indices;
          matching.set(image, !!atlas && expectedIndices.equals(atlas.indices) && coverage.equals(atlas.coverage));
        }
        if (!matching.get(image)) return;
        selectors.add(nativePaletteImage(image)!.selector);
        const [left, top, width, height] = coordinates;
        const frame = source.metadata.frames.find(frame => frame.x === left && frame.y === top
          && frame.width === width && frame.height === height);
        assert.ok(frame, "draw rectangle matches original atlas metadata");
        drawn.push(frame.index);
      });
      const mission = await loadCampaignMission(faction, 2, "browser-adapted");
      const originalSource = JSON.stringify(mission);
      assert.equal(mission.units.find(stat => stat.index === deployedType)?.sprite, sprite);
      const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
      views.push(view);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      renderer.setEnabled(false);
      let clock = 0;
      view.update(clock);
      const step = () => {
        assert.ok(view.simulation.snapshot.tick < 260, "bounded original opening");
        view.update(clock += 50);
        assert.equal(view.missionDiagnostic, undefined);
      };
      while (!view.browserEconomyState!.harvesters.some(actor => actor.team === 0)) step();
      const actor = view.browserEconomyState!.harvesters.find(actor => actor.team === 0)!;
      const id = view.browserEconomyState!.bindings.find(binding => binding.key === actor.key)!.simulationId;
      const unit = () => view.simulation.snapshot.units.find(unit => unit.id === id)!;
      const order = () => view.browserEconomyState!.orders.find(order => order.simulationId === id);
      const center = (target: MissionView) => {
        const camera = target.cameraView;
        const halfWidth = camera.width / 2, halfHeight = camera.height / 2;
        const centerX = Math.max(halfWidth, Math.min(target.grid.width - halfWidth, unit().xSubcells / SUBCELLS_PER_CELL));
        const centerY = Math.max(halfHeight, Math.min(target.grid.height - halfHeight, unit().ySubcells / SUBCELLS_PER_CELL));
        target.panByCells(centerX - camera.x - halfWidth, centerY - camera.y - halfHeight);
      };
      const render = (target = view) => {
        center(target);
        const beforeFirst = target.checkpoint();
        renderer.setEnabled(true);
        target.render();
        const before = target.checkpoint();
        assert.deepEqual({ ...before, state: { ...before.state, animationStates: beforeFirst.state.animationStates } },
          beforeFirst, "first render changes only the existing animation cache");
        drawn.length = 0;
        target.render();
        renderer.setEnabled(false);
        assert.deepEqual(target.checkpoint(), before, "drawing must not mutate any saved state");
        assert.ok(drawn.length > 0, "original collector atlas was drawn");
        return [...drawn];
      };
      assert.ok(render().every(frame => !source.frames.has(frame)), "idle uses mobile source art");
      const vent = view.resourceSources.filter(node => node.status === 1 && (node.rate ?? 0) > 0 && (node.remaining ?? 0) > 0
        && view.visibility[(node.position.y >> 8) * view.grid.width + (node.position.x >> 8)])
        .sort((left, right) => Math.abs((left.position.x >> 8) - unit().cellX) + Math.abs((left.position.y >> 8) - unit().cellY)
          - Math.abs((right.position.x >> 8) - unit().cellX) - Math.abs((right.position.y >> 8) - unit().cellY))[0];
      assert.ok(vent);
      view.replaceSelection([id]);
      const camera = view.cameraView;
      view.commandAt((vent.position.x / 256 - camera.x) * 32,
        (camera.y + camera.height - vent.position.y / 256) * 32);
      assert.equal(order()?.phase, "moving");
      step();
      assert.ok(render().every(frame => !source.frames.has(frame)), "moving does not deploy");
      while (order()?.phase !== "extracting") step();
      const economy = view.browserEconomyState!;
      const live = unit();
      assert.equal(missionMiningVisualType(live, typeId, economy), deployedType);
      assert.equal(live.activity, "idle");
      const originalEconomy = structuredClone(economy), originalUnit = structuredClone(live);
      for (const invalid of [undefined, { ...economy, orders: [] }, { ...economy, bindings: [] },
        { ...economy, harvesters: [] }, { ...economy, rates: {} }, { ...economy, remaining: {} },
        { ...economy, rates: { ...economy.rates, [vent.key]: 0 } },
        { ...economy, remaining: { ...economy.remaining, [vent.key]: 0 } },
        { ...economy, orders: economy.orders.map(entry => ({ ...entry, phase: "moving" as const })) },
        { ...economy, orders: economy.orders.map(entry => ({ ...entry, target: { ...entry.target, x: entry.target.x + 1 } })) }]) {
        assert.equal(missionMiningVisualType(live, typeId, invalid), undefined);
      }
      for (const invalid of [{ ...live, health: 0 }, { ...live, activity: "die" as const },
        { ...live, activity: "move" as const }, { ...live, activity: "attack" as const },
        { ...live, movementPlane: "air" as const }, { ...live, team: 7 },
        { ...live, xSubcells: live.xSubcells + 1 }, { ...live, ySubcells: live.ySubcells + 1 }]) {
        assert.equal(missionMiningVisualType(invalid, typeId, economy), undefined);
      }
      assert.equal(missionMiningVisualType(live, 0, economy), undefined);
      assert.equal(missionMiningVisualType(live, typeId === 6 ? 14 : 6, economy), undefined);
      assert.equal(missionUnitAction({ ...live, activity: "die" }, live), "Die");
      assert.equal(missionUnitAction({ ...live, activity: "move" }, live), "Move");
      assert.deepEqual(economy, originalEconomy);
      assert.deepEqual(live, originalUnit);
      assert.ok(render().some(frame => source.frames.has(frame)), `${sprite} Stand child reaches drawImage`);
      if (faction === "human") assert.deepEqual([...selectors], [2], "player extractor uses original gold palette ramp");
      const saved = view.checkpoint();
      const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
        JSON.parse(JSON.stringify(saved)));
      views.push(restored);
      await restored.initialize();
      assert.equal(restored.missionDiagnostic, undefined);
      assert.deepEqual(restored.checkpoint(), saved, "initialized JSON restore remains exact");
      assert.ok(render(restored).some(frame => source.frames.has(frame)), "restored extraction draws deployed child");
      view.stopSelected();
      assert.equal(order(), undefined);
      assert.ok(render().every(frame => !source.frames.has(frame)), "Stop immediately restores mobile source art");
      step();
      assert.ok(render().every(frame => !source.frames.has(frame)), "idle after Stop remains mobile");
      assert.equal(view.unitName(id), source.archive, "simulation source type is unchanged");
      assert.equal(unit().maxHealth, live.maxHealth);
      assert.equal(JSON.stringify(mission), originalSource);
      assert.ok(requests.includes("/assets/generated/animations/EXPL.json"));
      assert.ok(requests.includes("/assets/generated/animations/SLUG.json"));
      assert.ok([...requests, ...renderer.evidence().images].every(url => !/\/(EDPLY|SDPL)\.(json|png)$/.test(url)),
        "no invented deployed FIN or PNG requests");
      context.diagnostic(JSON.stringify({ faction, sprite, archive: source.archive, deployedFrames: [...source.frames],
        tick: view.simulation.snapshot.tick, evidence: "original source assets and recorded Node NullCanvas draws; no browser pixels" }));
    } finally {
      for (const view of views) view.dispose();
      renderer.dispose();
    }
  });
}