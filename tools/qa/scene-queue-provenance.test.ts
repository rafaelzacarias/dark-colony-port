import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nativeOrdinarySceneSubmissionWord, nativeScenePosition } from "../../src/render/scene-composition";
import { SUBCELLS_PER_CELL } from "../../src/engine/constants";
import { parseFin } from "../extractors/animations/fin";

const native = JSON.parse(execFileSync("python3", [new URL("../research/scene-queue-provenance-20260919.py", import.meta.url).pathname], {
  encoding: "utf8", env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH,
    "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") },
}));

test("native counter resets to entity Q8 Y rounded down to eight, then decrements per child", () => {
  for (const fixture of native.counter.resets) {
    if (fixture.seed > 65535) continue;
    assert.deepEqual([0, 1, 2].map((ordinal) => nativeOrdinarySceneSubmissionWord(fixture.seed, ordinal)), fixture.submissions);
  }
  assert.equal(native.counter.fullQueueLeavesCounterUnchanged, true);
  assert.equal(nativeOrdinarySceneSubmissionWord(0, 1), 0xffffffff);
  for (const [position, ordinal] of [[-1, 0], [65536, 0], [0, -1], [0, 800], [1.5, 0], [0, 0.5]]) {
    assert.throws(() => nativeOrdinarySceneSubmissionWord(position, ordinal), RangeError);
  }
});

test("native ordinary dispatcher visits all raw slots before column-major map objects", () => {
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  for (const fixture of native.dispatch) {
    const source = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${fixture.scenario.slice(0, -2)}/${fixture.scenario}.SCN`, import.meta.url));
    assert.equal(createHash("sha256").update(source).digest("hex"), fixture.sourceSha256);
    assert.equal(fixture.visitedSlots, 800);
    assert.deepEqual(fixture.activeSlots, Array.from({ length: fixture.scenario === "HUMAN02" ? 18 : 41 }, (_, index) => index + 152));
    assert.deepEqual(fixture.mapCells, [[1, 2], [1, 3], [2, 2], [2, 3], [3, 2], [3, 3]]);
    assert.equal(fixture.renderAdmissionVerified, false);
  }
});

test("host Q10 rounding precedes native eighth-pixel projection at half-Q8 and pixel boundaries", () => {
  for (const fixture of native.counter.q10Projection) {
    const nativeQ8 = Math.round(fixture.q10 * 256 / SUBCELLS_PER_CELL);
    assert.equal(nativeQ8, fixture.q8);
    assert.deepEqual(nativeScenePosition(nativeQ8, nativeQ8, 0, 32768),
      { x: fixture.x, y: fixture.y, heightOffset: 0 });
  }
  assert.equal(native.counter.q10Projection.find((fixture: { q10: number }) => fixture.q10 === 2).q8, 1);
  assert.equal(nativeScenePosition(128, 128, 0, 32768).y, 4079);
});

test("original FIN file child order and Q8 origins match actual native caller queue records", () => {
  assert.equal(SUBCELLS_PER_CELL, 1024);
  for (const fixture of native.children) {
    const source = readFileSync(new URL(`../../${fixture.source}`, import.meta.url));
    assert.equal(createHash("sha256").update(source).digest("hex"), fixture.sha256);
    const children = parseFin(source).timeline[fixture.timeline].children;
    assert.equal(children.length, fixture.children.length);
    assert.equal(fixture.runtimeInterceptions, 0);
    const [originX, originY, originHeight] = fixture.originQ8;
    const xSubcells = originX * SUBCELLS_PER_CELL / 256;
    const ySubcells = originY * SUBCELLS_PER_CELL / 256;
    const xQ8 = Math.round(xSubcells * 256 / SUBCELLS_PER_CELL);
    const yQ8 = Math.round(ySubcells * 256 / SUBCELLS_PER_CELL);
    children.forEach((child, sourceChildOrdinal) => {
      const queued = fixture.children[sourceChildOrdinal];
      assert.equal(child.sprite, queued.sprite);
      assert.equal(child.frame, queued.frame);
      assert.equal(child.x, queued.childX);
      assert.equal(child.y, queued.childY);
      assert.equal(nativeOrdinarySceneSubmissionWord(yQ8, sourceChildOrdinal), queued.submissionWord);
      const signedWord = (value: number) => (value << 16) >> 16;
      assert.deepEqual(nativeScenePosition(xQ8 + signedWord(child.x * 8), yQ8 + signedWord(-child.y * 8),
        originHeight, fixture.mapHeightQ8), { x: queued.x, y: queued.y, heightOffset: queued.heightOffset });
    });
  }
});