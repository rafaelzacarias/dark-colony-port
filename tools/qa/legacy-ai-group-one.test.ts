import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consumeLegacyAiGroupOne } from "../../src/engine/legacy-ai-active";

type Snapshot = { policy: string; entities: string; rngCursor: number; forceOrder: number };
type Golden = {
  mission: string;
  navigation: { width: number; height: number; families: string; nextFamily: string };
  rngTable: number[];
  cases: { label: string; before: Snapshot; after: Snapshot; packets: string[];
    events: ({ callback: number } | { rngCursor: number } | { packet: string })[] }[];
};
const trace = process.env.DC_AI_GROUP_ONE_TRACE ? readFileSync(process.env.DC_AI_GROUP_ONE_TRACE, "utf8")
  : execFileSync("python3", ["-B", "tools/research/ai-group-one-20260919.py"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  });
const goldens = trace.trim().split("\n").map((line) => JSON.parse(line) as Golden);
const decode = (value: string) => Buffer.from(value, "base64");
for (const golden of goldens) {
  for (const capture of golden.cases) {
    test(`${golden.mission} group-one ${capture.label}: all bytes, packets and RNG`, () => {
      const state = { ...capture.before, policy: decode(capture.before.policy), entities: decode(capture.before.entities),
        navigation: { ...golden.navigation, families: decode(golden.navigation.families),
          nextFamily: decode(golden.navigation.nextFamily) } };
      const result = consumeLegacyAiGroupOne(state, golden.rngTable);
      assert.deepEqual(state.policy, decode(capture.after.policy), "policy");
      assert.deepEqual(state.entities, decode(capture.after.entities), "entities");
      assert.equal(state.rngCursor, capture.after.rngCursor);
      assert.equal(state.forceOrder, capture.after.forceOrder);
      assert.deepEqual(result.packets.map((packet) => Buffer.from(packet).toString("hex")), capture.packets);
      assert.deepEqual(result.events.map((event) => "packet" in event
        ? { packet: Buffer.from(event.packet).toString("hex") } : event), capture.events);
      assert.equal(result.rngDraws, capture.events.filter((event) => "rngCursor" in event).length);
      assert.equal(result.admitted, false);
    });
  }
}