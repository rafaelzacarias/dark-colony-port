import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { deflateSync } from "node:zlib";
import { scienceConstructionFixtureLabel, scienceNativeSourceSha256 } from "./science-construction";

const { values } = parseArgs({ options: { inputtrace: { type: "string" }, output: { type: "string" } } });
assert.ok(values.inputtrace, "Usage: node --import tsx tools/qa/fixtures/generate-science-native-inputs.mts --inputtrace /path/to/original-oracle.json [--output /path/to/fixture.json]");
const proof = JSON.parse(readFileSync(values.inputtrace, "utf8"));
assert.equal(proof.sha256, scienceNativeSourceSha256);
const stateInput = (state: any) => state === null ? null : ({ name: state.name, source: state.source,
  first: state.first, last: state.last, delays: state.delays });
const byteInput = (bytes: unknown, length: number) => {
  assert.ok(Array.isArray(bytes) && bytes.length === length);
  assert.ok(bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255));
  return bytes;
};
const cases = [0, 1].map(race => {
  const matches = proof.cases.filter((candidate: any) => candidate.race === race);
  assert.equal(matches.length, 1);
  const golden = matches[0];
  const bindings = [race * 8, 20 + race * 12, 92 + race].map(unitType => {
    const binding = golden.profiles.bindings.find((candidate: any) => candidate.unitType === unitType);
    assert.ok(binding);
    return { unitType, constructionState: stateInput(binding.constructionState), standState: stateInput(binding.standState) };
  });
  const sourceNames = new Set(bindings.flatMap(binding => [binding.standState?.source, binding.constructionState?.source]).filter(Boolean));
  const sources = golden.profiles.sources.filter((source: any) => sourceNames.has(source.source))
    .map((source: any) => {
      assert.equal(createHash("sha256").update(readFileSync(new URL(`../../../${source.source}`, import.meta.url))).digest("hex"), source.sha256);
      return { source: source.source, sha256: source.sha256 };
    });
  assert.equal(sources.length, sourceNames.size);
  return { race, profiles: { bindings, sources }, types: byteInput(golden.types, 110 * 280),
    beforeTeam: byteInput(golden.beforeTeam, 3632),
    aiBefore: { entities: byteInput(golden.aiBefore.entities, 800 * 220), policy: byteInput(golden.aiBefore.policy, 27712) },
    dependencies: byteInput(golden.dependencies, 110 * 52), cityDependencies: golden.cityDependencies };
});
const payload = Buffer.from(JSON.stringify({ sha256: proof.sha256, cases }));
const envelope = { schema: "science-native-inputs-v1", label: scienceConstructionFixtureLabel,
  sourceSha256: proof.sha256, inputSha256: createHash("sha256").update(payload).digest("hex"),
  encoding: "deflate-base64", payload: deflateSync(payload, { level: 9 }).toString("base64") };
const output = JSON.stringify(envelope, null, 2) + "\n";
writeFileSync(values.output ?? new URL("./science-native-inputs.json", import.meta.url), output);
console.log(JSON.stringify({ label: envelope.label, sourceSha256: envelope.sourceSha256,
  inputSha256: envelope.inputSha256, inputBytes: payload.length, fixtureBytes: Buffer.byteLength(output) }));