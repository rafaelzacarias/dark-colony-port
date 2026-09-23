import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { missionAnimationArchives } from "../../src/mission-view";
import { parseFin } from "../extractors/animations/fin";

test("CAM selects CAMM without changing original CAM state names or sprite children", () => {
  assert.deepEqual(missionAnimationArchives("CAM"), ["CAMM"]);
  const bytes = readFileSync(new URL("../../raw_cd/DC/ANIMATE/CAMM.FIN", import.meta.url));
  const original = parseFin(bytes);
  const animation = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/CAMM.json", import.meta.url), "utf8"));
  assert.equal(animation.source.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(animation.states, original.states);
  assert.deepEqual(animation.timeline, original.timeline);
  assert.deepEqual(original.states.map(state => state.name), ["CAMSTAND0", "CAMDIE0"]);
  for (const frame of original.timeline) for (const child of frame.children) {
    const metadata = JSON.parse(readFileSync(new URL(`../../public/assets/generated/sprites/SPRITES/${child.sprite.toUpperCase()}.json`, import.meta.url), "utf8"));
    assert.ok(metadata.frames[child.frame], `${child.sprite}:${child.frame}`);
  }
});

for (const sprite of ["BIOHIV", "WARHIVE"]) test(`${sprite} resolves its source stand bank from ALBU`, () => {
  assert.deepEqual(missionAnimationArchives(sprite), ["ALBU"]);
  const animation = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/ALBU.json", import.meta.url), "utf8"));
  const stand = animation.states.find((state: { name: string }) => state.name === `${sprite}STAND0`);
  assert.ok(stand?.validRange);
  const children = animation.timeline.slice(stand.firstTimelineIndex, stand.lastTimelineIndex + 1)
    .flatMap((frame: { children: { sprite: string }[] }) => frame.children);
  assert.ok(children.length > 0);
  for (const child of children) {
    const metadata = JSON.parse(readFileSync(new URL(`../../public/assets/generated/sprites/SPRITES/${child.sprite.toUpperCase()}.json`, import.meta.url), "utf8"));
    assert.ok(metadata.frames.length > 0);
  }
});