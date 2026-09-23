import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { additionalMissionAnimationArchives } from "../../src/engine/mission-animation-archives";
import { createCampaignWorld } from "../../src/engine/campaign-world";
import { createFinSelector, createFinFrameLookup, TRSC_GRAY_VISUAL_DIRECTIONS,
  type FinAnimationData, type FinAtlasFrame, type CompassDirection } from "../../src/render/fin-animation";
import { parseFin } from "../extractors/animations/fin";
import { parseUnitStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseMap } from "../extractors/maps/map";

const root = new URL("../../", import.meta.url);
const raw = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root));
const json = (path: string) => JSON.parse(readFileSync(new URL(`public/assets/generated/${path}`, root), "utf8"));
const manifest = raw("ANIM.DAT").toString("ascii").trim().split(/\r?\n/)
  .map(name => name.replace(/\.fin$/i, "").toUpperCase());
const originals = new Map(manifest.map(name => [name, parseFin(raw(`ANIMATE/${name}.FIN`))]));
const units = parseUnitStats(raw("GAMESTAT/GAMESTAT.TXT").toString("ascii"));
const prefixes = [...new Set(units.map(unit => unit.sprite))]
  .sort((left, right) => right.length - left.length);
const belongsTo = (name: string, sprite: string) => sprite === "T" ? /^T(?:STAND|DIE|BLOOD)/.test(name)
  : prefixes.find(prefix => name.startsWith(prefix)) === sprite;
const directionalStand: Readonly<Record<string, readonly number[]>> = {
  EDPLY: [14, 2], SDPL: [14, 2], SARGSTL: [14, 10, 6, 2], PSYCSTL: [2, 14], BEAC: [2, 14], BEEK: [2, 14],
};
const visiblePrefixes = [...new Set(units.filter(unit => unit.index <= 98 && unit.index !== 37).map(unit => unit.sprite))];
const selectedArchives = (sprite: string) => additionalMissionAnimationArchives(sprite) ?? [sprite];
const allSelectedArchives = [...new Set(visiblePrefixes.flatMap(sprite => [...selectedArchives(sprite)]))];

function merged(archives: readonly string[]): FinAnimationData {
  const states: FinAnimationData["states"][number][] = [];
  const timeline: FinAnimationData["timeline"][number][] = [];
  for (const archive of archives) {
    const animation = originals.get(archive)!;
    const offset = timeline.length;
    states.push(...animation.states.map(state => ({ ...state,
      firstTimelineIndex: state.firstTimelineIndex + offset, lastTimelineIndex: state.lastTimelineIndex + offset })));
    timeline.push(...animation.timeline);
  }
  return { states, timeline };
}

for (const sprite of visiblePrefixes)
  test(`${sprite}: complete original prefix states and first-match precedence`, () => {
  const archives = additionalMissionAnimationArchives(sprite) ?? [sprite];
  const expected = new Map<string, unknown>();
  const actual = new Map<string, unknown>();
  for (const archive of manifest) {
    const original = originals.get(archive)!;
    for (const state of original.states) {
      if (!belongsTo(state.name, sprite) || state.validRange === false || expected.has(state.name)) continue;
      expected.set(state.name, original.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1));
    }
  }
  for (const archive of archives) {
    assert.ok(manifest.includes(archive), `${archive} must be loaded by ANIM.DAT`);
    const original = originals.get(archive)!;
    const generated = json(`animations/${archive}.json`);
    assert.equal(generated.source.sha256, createHash("sha256").update(raw(`ANIMATE/${archive}.FIN`)).digest("hex"));
    assert.deepEqual(generated.states, original.states);
    assert.deepEqual(generated.timeline, original.timeline);
    for (const state of original.states) {
      if (!belongsTo(state.name, sprite) || state.validRange === false) continue;
      const frames = original.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1);
      if (actual.has(state.name)) assert.deepEqual(frames, actual.get(state.name), `${state.name} conflicting duplicate`);
      else actual.set(state.name, frames);
    }
  }
  if (directionalStand[sprite]) {
    assert.deepEqual([...actual.keys()].filter(name => name.startsWith(`${sprite}STAND`)),
      directionalStand[sprite].map(direction => `${sprite}STAND${direction}`));
  } else assert.ok(actual.has(`${sprite}STAND0`));
  assert.deepEqual(actual, expected);
});

test("aliases: raw GAMESTAT identities, hidden marker and unknown names remain unchanged", () => {
  assert.deepEqual(json("data/units.json").records, units);
  assert.deepEqual(units.filter(unit => unit.sprite === "HMINE").map(unit => unit.index), [45, 46]);
  assert.deepEqual(additionalMissionAnimationArchives("HMINE"), ["ENGI"]);
  assert.deepEqual(additionalMissionAnimationArchives("T"), ["TURR"]);
  for (const sprite of ["POOP", "UNKNOWN", "toString", "constructor", "robopod"]) {
    assert.equal(additionalMissionAnimationArchives(sprite), undefined);
  }
});

test("aliases: every parsed generated FIN index entry preserves its raw states and timeline", () => {
  const index = json("animations/index.json");
  let parsed = 0;
  for (const entry of index.entries) {
    if (entry.status !== "parsed") continue;
    const bytes = raw(`ANIMATE/${entry.source}`);
    const original = parseFin(bytes);
    const generated = json(`animations/${entry.metadata}`);
    assert.equal(entry.sourceSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(generated.source.sha256, entry.sourceSha256);
    assert.deepEqual(generated.states, original.states);
    assert.deepEqual(generated.timeline, original.timeline);
    parsed += 1;
  }
  assert.equal(parsed, index.parsedCount);
  assert.equal(parsed, 164);
});

test("aliases: selected FIN declarations and timeline children have authentic SPR, PNG and indexed frames", context => {
  const sprites = new Map<string, { frames: readonly FinAtlasFrame[] }>();
  for (const archive of allSelectedArchives) {
    const animation = originals.get(archive)!;
    const names = new Set([...animation.spriteNames, ...animation.timeline.flatMap(frame => frame.children.map(child => child.sprite))]);
    for (const name of names) {
      const sprite = name.toUpperCase();
      if (sprites.has(sprite)) continue;
      const metadata = json(`sprites/SPRITES/${sprite}.json`);
      const indexed = json(`indexed/sprites/SPRITES/${sprite}.json`);
      const digest = createHash("sha256").update(raw(`SPRITES/${sprite}.SPR`)).digest("hex");
      assert.equal(metadata.source.sha256, digest, sprite);
      assert.equal(indexed.source.sha256, digest, sprite);
      const image = readFileSync(new URL(`public/assets/generated/sprites/SPRITES/${sprite}.png`, root));
      assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", sprite);
      assert.equal(image.readUInt32BE(16), indexed.atlas.width, sprite);
      assert.equal(image.readUInt32BE(20), indexed.atlas.height, sprite);
      for (const frame of metadata.frames as FinAtlasFrame[]) {
        assert.ok(frame.x >= 0 && frame.y >= 0 && frame.x + frame.width <= indexed.atlas.width
          && frame.y + frame.height <= indexed.atlas.height, `${sprite}:${frame.index}`);
        const sourceFrame = indexed.frames.find((candidate: FinAtlasFrame) => candidate.index === frame.index);
        assert.ok(sourceFrame, `${sprite}:${frame.index}`);
        for (const field of ["x", "y", "width", "height", "anchorX", "anchorY", "empty"] as const) {
          assert.equal(frame[field], sourceFrame[field], `${sprite}:${frame.index}:${field}`);
        }
      }
      for (const plane of [indexed.indices, indexed.coverage]) {
        const bytes = readFileSync(new URL(`public/assets/generated/indexed/${plane.path}`, root));
        assert.equal(bytes.length, plane.bytes, sprite);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), plane.sha256, sprite);
      }
      sprites.set(sprite, metadata);
    }
  }
  const lookup = createFinFrameLookup(Object.fromEntries(sprites));
  for (const archive of allSelectedArchives) for (const frame of originals.get(archive)!.timeline) {
    for (const child of frame.children) assert.ok(lookup(child.sprite, child.frame), `${archive}:${child.sprite}:${child.frame}`);
  }
  context.diagnostic(`${allSelectedArchives.length} selected FINs; ${sprites.size} authentic child SPR families`);
});

test("aliases: merged offsets, duplicate precedence and directional action fallback match the native registry", context => {
  const native = merged(manifest);
  const absentFire: string[] = [];
  for (const sprite of visiblePrefixes) {
    const animation = merged(selectedArchives(sprite));
    const seen = new Map<string, FinAnimationData["timeline"]>();
    for (const state of animation.states) {
      if (state.validRange === false) continue;
      const frames = animation.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1);
      const previous = seen.get(state.name);
      if (previous) assert.deepEqual(frames, previous, `${sprite}:${state.name} conflicting archive duplicate`);
      else seen.set(state.name, frames);
    }
    const options = { prefix: sprite, directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" as const };
    const selector = createFinSelector(animation, options);
    const nativeSelector = createFinSelector(native, options);
    for (const direction of Object.keys(TRSC_GRAY_VISUAL_DIRECTIONS) as CompassDirection[]) {
      for (const action of ["Stand", "Move", "Attack", "Die"] as const) {
        const actual = selector.select(action, direction);
        const expected = nativeSelector.select(action, direction);
        assert.equal(actual?.state.name, expected?.state.name, `${sprite}:${action}:${direction}`);
        assert.equal(actual?.action, expected?.action, `${sprite}:${action}:${direction}`);
        assert.equal(actual?.fallback, expected?.fallback, `${sprite}:${action}:${direction}`);
        if (action === "Stand") assert.ok(actual, `${sprite}:${direction} requires a living state`);
        if (actual && expected) assert.deepEqual(
          animation.timeline.slice(actual.state.firstTimelineIndex, actual.state.lastTimelineIndex + 1),
          native.timeline.slice(expected.state.firstTimelineIndex, expected.state.lastTimelineIndex + 1));
      }
    }
    if (nativeSelector.select("Attack", "S")?.action === "Stand") absentFire.push(sprite);
  }
  assert.ok(absentFire.includes("T") && absentFire.includes("HMINE"));
  context.diagnostic(`Native FIRE absent, existing Stand fallback retained: ${absentFire.join(", ")}`);
});

test("aliases: all original SCN placement types and campaign-world counterparts resolve living source states", context => {
  const paths = readdirSync(new URL("raw_cd/DC/SCENARIO/", root), { recursive: true, encoding: "utf8" })
    .filter(path => path.toUpperCase().endsWith(".SCN")).sort();
  const loadedTypes = new Set<number>();
  const campaignFailures: string[] = [];
  let campaignWorlds = 0;
  let worlds = 0;
  for (const path of paths) {
    const source = parseScenario(raw(`SCENARIO/${path}`).toString("ascii"));
    const map = parseMap(raw(`SCENARIO/${path.replace(/\.SCN$/i, ".MAP")}`));
    const world = createCampaignWorld({ sessionId: `fin-census:${path}`, source, units, messages: [],
      runtimeProfile: "browser-adapted", placementInitialization: { firstSlot: 152, mode: 0 },
      resourceInitialization: { firstSlot: 152, width: map.width, height: map.height, scales: { rateScale: 256, reserveScale: 256 } } });
    const campaign = /^(HUMAN\/HUMAN|ALIEN\/ALIEN)(0[1-9]|1[0-5])\.SCN$/i.test(path);
    const types = source.placementRows.map(row => row[2]);
    if (world.ok) {
      worlds += 1;
      if (campaign) campaignWorlds += 1;
      types.push(...world.value.entities.map(entity => entity.unitType),
        ...world.value.placementState.renatSources.map(entry => entry.unitType),
        ...(world.value.coordinateQueues ?? []).flatMap(queue => queue.captured.map(entry => entry.unitType)));
    } else if (campaign) campaignFailures.push(`${path}: ${JSON.stringify(world.diagnostics)}`);
    for (const type of types) {
      if (type > 98 || type === 37) continue;
      loadedTypes.add(type);
      const sprite = units[type].sprite;
      const selector = createFinSelector(merged(selectedArchives(sprite)), {
        prefix: sprite, directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source",
      });
      assert.ok(selector.select("Stand", "S"), `${path}:${type}:${sprite}`);
    }
  }
  assert.equal(paths.length, 108);
  assert.deepEqual(campaignFailures, []);
  assert.equal(campaignWorlds, 30);
  assert.ok(loadedTypes.has(45) && loadedTypes.has(46));
  context.diagnostic(`${paths.length} original SCNs; ${worlds} worlds; ${campaignWorlds} campaign worlds; ${loadedTypes.size} visible placement types`);
});