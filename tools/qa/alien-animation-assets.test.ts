import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { missionAnimationArchives, missionVisualSprites } from "../../src/mission-view";
import { createFinFrameLookup, createFinSelector, TRSC_GRAY_VISUAL_DIRECTIONS,
  type FinAction, type FinAnimationData } from "../../src/render/fin-animation";
import { composeFinSample, createFinSourceSampler } from "../../src/render/fin-composition";
import { parseFin } from "../extractors/animations/fin";
import { parseUnitStats } from "../extractors/data/tables";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(read(`public/assets/generated/${path}`).toString());

for (const [sprite, type, actions] of [
  ["BEAC", 84, ["Stand", "Die"]],
  ["BEEK", 95, ["Stand"]],
  ["ATRIL", 11, ["Stand", "Move", "Attack", "Die"]],
] as const) test(`source asset fixture: ${sprite} type ${type} selects and composes original FIN banks`, () => {
  const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString());
  assert.equal(units[type].sprite, sprite);
  assert.deepEqual(json("data/units.json").records[type], units[type]);
  const archives = missionAnimationArchives(sprite);
  assert.deepEqual(archives, [sprite === "BEEK" ? "BEAC" : sprite]);
  const generated = json(`animations/${archives[0]}.json`);
  const source = read(`raw_cd/DC/ANIMATE/${generated.source.path}`);
  assert.equal(createHash("sha256").update(source).digest("hex"), generated.source.sha256);
  const parsed = parseFin(source);
  assert.deepEqual(generated.states, parsed.states);
  assert.deepEqual(generated.timeline, parsed.timeline);
  const animation = generated as FinAnimationData;
  const selector = createFinSelector(animation, { prefix: sprite,
    directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" });
  const sample = createFinSourceSampler(animation);
  const names = [...new Set(animation.timeline.flatMap(frame => frame.children.map(child => child.sprite.toUpperCase())))];
  for (const name of names) {
    const image = read(`public/assets/generated/sprites/SPRITES/${name}.png`);
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  const lookup = createFinFrameLookup(Object.fromEntries(names.map(name => [name, json(`sprites/SPRITES/${name}.json`)])));
  for (const action of actions as readonly FinAction[]) {
    for (const direction of Object.keys(TRSC_GRAY_VISUAL_DIRECTIONS) as (keyof typeof TRSC_GRAY_VISUAL_DIRECTIONS)[]) {
      const selection = selector.select(action, direction);
      assert.ok(selection, `${sprite}:${action}:${direction}`);
      assert.equal(selection.action, action, `${sprite}:${action} must not silently select Stand`);
      const parts = composeFinSample(sample(selection, 0), lookup);
      assert.ok(parts.length > 0, `${selection.state.name}: empty first composition`);
      assert.ok(parts.every(part => part.frame && !part.diagnostics.includes("missing-atlas-frame")), selection.state.name);
    }
  }
});

test("visual-discovery fixture: newtype BEAC is preloaded without replacing source ATRIL", () => {
  const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString());
  const mission = { units, scenario: { placementRows: [[0, 0, 11]], teams: [] }, triggers: [] } as unknown as Parameters<typeof missionVisualSprites>[0];
  assert.ok(!missionVisualSprites(mission).includes("BEAC"));
  const changed = { ...mission, triggers: [{ id: 1, mode: "norm", flag: 1, condition: "(c>0)",
    actions: [{ name: "newtype", arguments: [0, 95, 84], raw: "newtype 0 95 84" }] }] } as unknown as Parameters<typeof missionVisualSprites>[0];
  const before = JSON.stringify(changed);
  const sprites = missionVisualSprites(changed);
  assert.ok(sprites.includes("BEAC"));
  assert.ok(sprites.includes("ATRIL"));
  assert.equal(JSON.stringify(changed), before);
});