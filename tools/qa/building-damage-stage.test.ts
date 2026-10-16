import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legacyColonySlotOffsetForUnitType } from "../../src/engine/legacy-colony";
import { loadCampaignMission } from "../../src/game-data";
import { buildingDamageStage, MissionView, missionAnimationArchives } from "../../src/mission-view";
import { composeFinSample, createFinFrameLookup, createFinSelector, createFinSourceSampler,
  TRSC_GRAY_VISUAL_DIRECTIONS, type FinAnimationData, type FinAtlasFrame } from "../../src/render";
import { installSourceRender } from "./fixtures/source-render";

test("structure damage stages follow DC.EXE 0x414314 thresholds (11/16 and 5/16 of maximum HP)", () => {
  // EXCOPOD 4800 HP: STAND above 3300, BURN above 1500, SCRCH at or below 1500.
  assert.equal(buildingDamageStage(4800, 4800), "stand");
  assert.equal(buildingDamageStage(3301, 4800), "stand");
  assert.equal(buildingDamageStage(3300, 4800), "burn");
  assert.equal(buildingDamageStage(1501, 4800), "burn");
  assert.equal(buildingDamageStage(1500, 4800), "scorch");
  assert.equal(buildingDamageStage(1, 4800), "scorch");
  // Integer shifts truncate like the original: 2400 * 11 >> 4 = 1650, 2400 * 5 >> 4 = 750.
  assert.equal(buildingDamageStage(1651, 2400), "stand");
  assert.equal(buildingDamageStage(1650, 2400), "burn");
  assert.equal(buildingDamageStage(750, 2400), "scorch");
});

test("DC.EXE 0x444C58 colony slot offsets map Human pods 16..22 and Alien hives 28..35", () => {
  const expected = [
    [[16, 28], { slot: 0, offsetX: -64, offsetY: 15 }],
    [[17, 29], { slot: 1, offsetX: 0, offsetY: 0 }],
    [[18, 19, 30, 31], { slot: 2, offsetX: 32, offsetY: 64 }],
    [[20, 21, 32, 33], { slot: 3, offsetX: 64, offsetY: 10 }],
    [[22, 34, 35], { slot: 4, offsetX: -32, offsetY: 65 }],
  ] as const;
  for (const [types, offset] of expected) {
    for (const unitType of types) {
      assert.deepEqual(legacyColonySlotOffsetForUnitType(unitType), offset, `unitType ${unitType}`);
    }
  }
  for (const nonColony of [0, 15, 23, 27, 36, 40, 41, 42, 81]) {
    assert.equal(legacyColonySlotOffsetForUnitType(nonColony), undefined);
  }
});

test("MissionView renders 5 Human pods and 5 Alien hives from the shared 0x444C58 base origin while keeping pod-centered health bars", async () => {
  const rendering = installSourceRender();
  const originalFetch = globalThis.fetch;
  const publicRoot = new URL("../../public/", import.meta.url);
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    return new Response(readFileSync(new URL(url.slice(1), publicRoot)));
  };
  try {
    for (const [faction, unitTypes, primaryAtlas] of [
      ["human", [16, 17, 18, 20, 22], "HUBU"],
      ["alien", [28, 29, 30, 32, 34], "ALBU"],
    ] as const) {
      const baseMission = await loadCampaignMission(faction, 1);
      const baseX = 20, baseY = 20;
      const teams = baseMission.scenario.teams.map((team, index) => index === 0 ? {
        ...team,
        coordinateRows: [team.coordinateRows[0], [baseX, baseY]] as const,
        cityRows: [[1, -1, 1, -1, 1, -1, 1, -1, 1, -1], ...team.cityRows.slice(1)],
      } : team);
      const mission = { ...baseMission, triggers: [], scenario: { ...baseMission.scenario, teams, placementRows: [] } };
      const view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
      try {
        await view.initialize();
        assert.equal(view.missionDiagnostic, undefined);
        view.setCameraCenter(baseX, baseY);
        const beforeCheckpoint = view.checkpoint();
        const colonyObjects = beforeCheckpoint.state.staticObjects.filter(
          object => object.entity.team === 0 && unitTypes.includes(object.type as never),
        );
        assert.equal(colonyObjects.length, 5);

        const atlas: { frames: FinAtlasFrame[] } = JSON.parse(
          readFileSync(new URL(`assets/generated/sprites/SPRITES/${primaryAtlas}.json`, publicRoot), "utf8"),
        );
        const lookup = createFinFrameLookup({ [primaryAtlas]: atlas });
        const drawing = rendering.canvas().getContext("2d")!;
        let tx = 0, ty = 0;
        const drawnPlacements: { frame: number; dx: number; dy: number }[] = [];
        const healthBars: { x: number; y: number; width: number; height: number }[] = [];
        const originalTranslate = drawing.translate;
        const originalDrawImage = drawing.drawImage;
        const originalFillRect = drawing.fillRect;
        drawing.translate = (x: number, y: number) => {
          tx += x; ty += y;
          return (originalTranslate as (...args: unknown[]) => unknown).call(drawing, x, y);
        };
        drawing.save = () => { tx = 0; ty = 0; };
        drawing.drawImage = ((image: CanvasImageSource, ...coordinates: number[]) => {
          if (image !== view.terrainImage && coordinates.length === 8 && coordinates[4] === 0 && coordinates[5] === 0) {
            const [left, top, width, height] = coordinates;
            const frame = atlas.frames.find(entry => entry.x === left && entry.y === top && entry.width === width && entry.height === height);
            if (frame) drawnPlacements.push({ frame: frame.index, dx: tx, dy: ty });
          }
          return (originalDrawImage as (...args: unknown[]) => unknown).call(drawing, image, ...coordinates);
        }) as CanvasRenderingContext2D["drawImage"];
        drawing.fillRect = (x: number, y: number, width: number, height: number) => {
          if (drawing.fillStyle === "rgba(0,0,0,.72)" && height === 3) {
            healthBars.push({ x, y, width, height });
          }
          return (originalFillRect as (...args: unknown[]) => unknown).call(drawing, x, y, width, height);
        };

        view.render();
        assert.deepEqual(view.checkpoint(), beforeCheckpoint, "rendering colony origin correction must not mutate checkpoint state");

        const baseScreenX = 256, baseScreenY = 226;
        for (const object of colonyObjects) {
          const offset = legacyColonySlotOffsetForUnitType(object.type)!;
          assert.equal(object.entity.x + 0.5, baseX + offset.offsetX / 32);
          assert.equal(object.entity.y + 0.5, baseY + offset.offsetY / 32);
          const sprite = mission.units.find(unit => unit.index === object.type)!.sprite;
          const archives = missionAnimationArchives(sprite).map(name =>
            JSON.parse(readFileSync(new URL(`assets/generated/animations/${name}.json`, publicRoot), "utf8")) as FinAnimationData);
          const states: FinAnimationData["states"][number][] = [], timeline: FinAnimationData["timeline"][number][] = [];
          for (const archive of archives) {
            const indexOffset = timeline.length;
            states.push(...archive.states.map(state => ({ ...state,
              firstTimelineIndex: state.firstTimelineIndex + indexOffset,
              lastTimelineIndex: state.lastTimelineIndex + indexOffset })));
            timeline.push(...archive.timeline);
          }
          const animation: FinAnimationData = { states, timeline };
          const selection = createFinSelector(animation, { prefix: sprite, directions: TRSC_GRAY_VISUAL_DIRECTIONS,
            layerOrder: "source" }).select("Stand", "S")!;
          const sample = createFinSourceSampler(animation)(selection, 0);
          const parts = composeFinSample(sample, lookup).filter(part => part.child.sprite.toUpperCase() === primaryAtlas && part.frame);
          assert.ok(parts.length > 0);
          for (const part of parts) {
            assert.ok(
              drawnPlacements.some(entry => entry.frame === part.frame!.index
                && entry.dx === Math.round(baseScreenX + part.x)
                && entry.dy === Math.round(baseScreenY + part.y)),
              `${faction} ${sprite} frame ${part.frame!.index} must render from shared colony origin (${baseScreenX}, ${baseScreenY})`,
            );
          }
          const podScreenX = baseScreenX + offset.offsetX;
          assert.ok(
            healthBars.some(bar => Math.abs((bar.x + bar.width / 2) - podScreenX) <= 1),
            `${faction} ${sprite} health bar must remain horizontally centered on pod screenX ${podScreenX}`,
          );
        }
      } finally {
        view.dispose();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    rendering.dispose();
  }
});

