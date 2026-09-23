import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { missionAnimationArchives, missionVisualSprites, MissionView } from "../../src/mission-view";
import { createFinFrameLookup, createFinSelector, TRSC_GRAY_VISUAL_DIRECTIONS,
  type FinAnimationData, type FinAtlasFrame } from "../../src/render/fin-animation";
import { parseFin } from "../extractors/animations/fin";
import { parseUnitStats } from "../extractors/data/tables";
import { loadScienceNativeInput } from "./fixtures/science-construction";
import { installSourceRender } from "./fixtures/source-render";

const root = new URL("../../public/assets/generated/", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const checkedArchives = new Set<string>();
const checkedSprites = new Map<string, { frames: readonly FinAtlasFrame[] }>();

function spriteMetadata(name: string) {
  const dependency = name.toUpperCase();
  let metadata = checkedSprites.get(dependency);
  if (!metadata) {
    metadata = json(`sprites/SPRITES/${dependency}.json`) as { frames: readonly FinAtlasFrame[] };
    const image = readFileSync(new URL(`sprites/SPRITES/${dependency}.png`, root));
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", dependency);
    const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
    assert.ok(width > 0 && height > 0, dependency);
    for (const frame of metadata.frames) assert.ok(frame.x >= 0 && frame.y >= 0
      && frame.x + frame.width <= width && frame.y + frame.height <= height, `${dependency}:${frame.index} atlas bounds`);
    checkedSprites.set(dependency, metadata);
  }
  return metadata;
}

function checkArchive(name: string) {
  if (checkedArchives.has(name)) return;
  const generated = json(`animations/${name}.json`);
  const bytes = readFileSync(new URL(`../../raw_cd/DC/ANIMATE/${name}.FIN`, import.meta.url));
  assert.equal(generated.source.sha256, createHash("sha256").update(bytes).digest("hex"), `${name} source hash`);
  const original = parseFin(bytes);
  assert.deepEqual(generated.states, original.states, `${name} preserves every source state`);
  assert.deepEqual(generated.timeline, original.timeline, `${name} preserves source timeline and children`);
  for (const frame of generated.timeline as FinAnimationData["timeline"]) for (const child of frame.children) {
    const lookup = createFinFrameLookup({ [child.sprite]: spriteMetadata(child.sprite) });
    assert.ok(lookup(child.sprite, child.frame), `${name} missing ${child.sprite}:${child.frame}`);
  }
  checkedArchives.add(name);
}

function checkBodyCollisions(sprite: string) {
  const animation = mergedAnimation(sprite);
  const seen = new Map<string, typeof animation.states[number]>();
  for (const state of animation.states) {
    const key = state.name.toUpperCase();
    if (!key.startsWith(sprite) || state.validRange === false) continue;
    const first = seen.get(key);
    if (first) {
      const frames = (entry: typeof state) => animation.timeline
        .slice(entry.firstTimelineIndex, entry.lastTimelineIndex + 1)
        .map(frame => ({ field2: frame.field2, children: frame.children }));
      assert.deepEqual(frames(first), frames(state), `${sprite}:${key} conflicting first-match archives ${first.archive}/${state.archive}`);
    } else seen.set(key, state);
  }
}

function mergedAnimation(sprite: string) {
  const states: (FinAnimationData["states"][number] & { archive: string })[] = [];
  const timeline: FinAnimationData["timeline"][number][] = [];
  for (const archive of missionAnimationArchives(sprite)) {
    const animation = json(`animations/${archive}.json`) as FinAnimationData;
    const offset = timeline.length;
    states.push(...animation.states.map(state => ({ ...state, archive,
      firstTimelineIndex: state.firstTimelineIndex + offset,
      lastTimelineIndex: state.lastTimelineIndex + offset })));
    timeline.push(...animation.timeline);
  }
  return { states, timeline };
}

for (const [sprite, required] of [
  ["T", { TSTAND0: "TURR", TSTAND12: "TURR", TSTAND15: "TURR", TDIE14: "TURR" }],
  ["SAUC", { MIDDLE: "SAUC", SAUCSTAND0: "SAWS" }],
  ["DROP", { DROPMOVE0: "DROP", DROPSTAND0: "DROP" }],
] as const) test(`${sprite}: reinforcement and science states retain their source archive and SPR frames`, () => {
  const animation = mergedAnimation(sprite);
  for (const [name, archive] of Object.entries(required)) {
    const state = animation.states.find(state => state.name === name && state.validRange !== false);
    assert.ok(state, `${sprite}:${name} missing from ${missionAnimationArchives(sprite).join(",")}`);
    assert.equal(state.archive, archive, `${sprite}:${name} first-match source precedence`);
    const frames = animation.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1);
    assert.ok(frames.length > 0, `${sprite}:${name} empty timeline`);
    for (const frame of frames) {
      assert.ok(frame.children.length > 0, `${sprite}:${name} empty composition`);
      for (const child of frame.children) {
        const dependency = child.sprite.toUpperCase();
        const lookup = createFinFrameLookup({ [dependency]: spriteMetadata(dependency) });
        assert.ok(lookup(dependency, child.frame), `${sprite}:${name} missing ${dependency} frame ${child.frame}`);
      }
    }
  }
});

test("T: original type 41 retains TURR states, composition and source archives", context => {
  const raw = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const units = parseUnitStats(raw("GAMESTAT/GAMESTAT.TXT").toString("ascii"));
  assert.deepEqual(units.filter(unit => unit.sprite === "T").map(unit => unit.index), [41]);
  assert.deepEqual(json("data/units.json").records[41], units[41]);
  assert.equal(units[41].movementSpeed, 0);
  assert.deepEqual(missionAnimationArchives("T"), ["TURR"]);
  assert.ok(raw("ANIM.DAT").toString("ascii").split(/\r?\n/).some(line => /(?:^|[\\/])TURR\.FIN$/i.test(line.trim())));
  checkArchive("TURR");
  checkBodyCollisions("T");
  const animation = mergedAnimation("T");
  const selector = createFinSelector(animation, { prefix: "T", directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" });
  assert.equal(selector.select("Stand", "S")?.state.name, "TSTAND0");
  const stand = animation.states.find(state => state.name === "TSTAND0")!;
  assert.deepEqual([stand.firstTimelineIndex, stand.lastTimelineIndex], [81, 82]);
  assert.deepEqual(animation.timeline[81].children.map(child => [child.sprite, child.frame]), [["turr", 35], ["turr", 36]]);
  const nativeStand = animation.states.find(state => state.name === "TSTAND12")!;
  assert.deepEqual([nativeStand.firstTimelineIndex, nativeStand.lastTimelineIndex], [89, 90]);
  assert.deepEqual(animation.timeline[89].children.map(child => [child.sprite, child.frame]), [["turr", 35], ["turr", 40]]);
  for (const path of ["GAMESTAT/GAMESTAT.TXT", "ANIM.DAT", "ANIMATE/TURR.FIN", "SPRITES/TURR.SPR"]) {
    const sha256 = createHash("sha256").update(raw(path)).digest("hex");
    if (path === "SPRITES/TURR.SPR") assert.equal(json("sprites/SPRITES/TURR.json").source.sha256, sha256);
    context.diagnostic(`${path} sha256=${sha256}`);
  }
});

for (const faction of ["alien", "human"] as const) test(`${faction.toUpperCase()}01: admitted visual archives and generated SPR dependencies`, async context => {
  const rendering = installSourceRender();
  const previousFetch = globalThis.fetch;
  let view: MissionView | undefined;
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."), path);
    return new Response(readFileSync(new URL(`../../public${path}`, import.meta.url)));
  };
  try {
    const mission = await loadCampaignMission(faction);
    const sprites = missionVisualSprites(mission);
    assert.ok(sprites.includes("SAUC") && sprites.includes("DROP"));
    const archives = new Set(sprites.flatMap(sprite => [...missionAnimationArchives(sprite)]));
    for (const name of archives) checkArchive(name);
    for (const sprite of sprites) checkBodyCollisions(sprite);
    view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    view.update(0);
    const carrierSprite = faction === "alien" ? "SAUC" : "DROP";
    for (let tick = 1; tick <= 40 && !view.carrierVisuals.some(carrier => carrier.sprite === carrierSprite); tick += 1) {
      view.update(tick * 50);
    }
    assert.equal(view.missionDiagnostic, undefined);
    assert.ok(view.carrierVisuals.some(carrier => carrier.sprite === carrierSprite), `${faction} opening carrier must spawn`);
    assert.ok(rendering.evidence().spriteDraws > 0);
    context.diagnostic(`${sprites.length} sprites; ${archives.size} archives: ${[...archives].join(", ")}`);
  } finally {
    view?.dispose();
    globalThis.fetch = previousFetch;
    rendering.dispose();
  }
});

for (const race of [0, 1] as const) test(`source science race ${race}: native bound states, offsets and first-match precedence`, async context => {
  const input = await loadScienceNativeInput(url => readFileSync(url));
  const golden = input.cases.find(candidate => candidate.race === race)!;
  const units = json("data/units.json").records as { index: number; sprite: string }[];
  const types = [20 + race * 12, 92 + race];
  let count = 0;
  for (const unitType of types) {
    const sprite = units.find(unit => unit.index === unitType)!.sprite;
    const binding = golden.profiles.bindings.find(binding => binding.unitType === unitType)!;
    const animation = mergedAnimation(sprite);
    for (const archive of missionAnimationArchives(sprite)) checkArchive(archive);
    checkBodyCollisions(sprite);
    for (const expected of [binding.standState, binding.constructionState]) {
      if (!expected) continue;
      const archive = expected.source.split("/").at(-1)!.replace(/\.FIN$/, "");
      const source = json(`animations/${archive}.json`) as FinAnimationData;
      const state = animation.states.find(state => state.name === expected.name && state.validRange !== false);
      assert.ok(state, `${sprite}:${expected.name} missing ${archive}`);
      assert.equal(state.archive, archive, `${sprite}:${expected.name} native pointer binding precedence`);
      assert.deepEqual(animation.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1),
        source.timeline.slice(expected.first, expected.last + 1), `${sprite}:${expected.name} merged offsets`);
      if (expected === binding.standState) {
        const selector = createFinSelector(animation, { prefix: sprite, directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" });
        assert.equal(selector.select("Stand", "S")?.state, state, `${sprite} body selector source binding`);
      }
      count += 1;
    }
  }
  context.diagnostic(`${count} native science bindings; all source states retained, including non-body states`);
});