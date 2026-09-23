import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCampaignMission } from "../../src/game-data";
import { stepCampaignWorld } from "../../src/engine/campaign-world";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { createMissionController } from "../../src/engine/mission-controller";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { parseMissionMessages } from "../extractors/data/messages";
import { parseTriggerScript } from "../extractors/data/triggers";

const root = new URL("../../", import.meta.url);
const sourceRoot = new URL("raw_cd/DC/SCENARIO/HUMAN/", root);
const bytes = (filename: string) => readFileSync(new URL(filename, root));
const json = (filename: string) => JSON.parse(bytes(filename).toString("utf8"));
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const messagesPath = "public/assets/generated/data/messages/HUMAN/HUMAN05.json";
const source = (extension: string) => readFileSync(new URL(`HUMAN05.${extension}`, sourceRoot));
async function diskFetch(input: string): Promise<Response> {
  try {
    return new Response(bytes(`public${input}`));
  } catch {
    return new Response(null, { status: 404 });
  }
}

test("HUMAN05 messages: full original native table equals parser and published JSON", () => {
  const trace = process.env.DC_HUMAN05_MESSAGES_NATIVE_TRACE;
  const native = JSON.parse(trace ? readFileSync(trace, "utf8") : execFileSync("python3", ["-B",
    fileURLToPath(new URL("tools/qa/human05-messages-native.py", root))], { encoding: "utf8",
    env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH ??
      "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } }));
  const original = source("MSG");
  assert.equal(hash(original), "882d5020a7bdf427c8637c0724655dbb7ea0befbd13088a0df895571827f84f0");
  assert.equal(native.sourceSha256, hash(original));
  assert.equal(native.executableSha256, hash(bytes("raw_cd/DC/DC.EXE")));
  const envelope = json(messagesPath);
  assert.deepEqual(envelope.source, { path: "HUMAN/HUMAN05.MSG", sha256: hash(original) });
  assert.deepEqual(parseMissionMessages(original.toString("ascii")), native.messages);
  assert.deepEqual(envelope.messages, native.messages);
  assert.deepEqual(native.scannedIds, Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(native.arguments, [0, 0, 5, 3, 3]);
  assert.deepEqual(native.absentEntryDiagnostic, ["0x44d93d"]);
  assert.equal(native.queue.text, envelope.messages[4].text);
  assert.equal(native.queue.presentationCode, 0);
  assert.equal(native.queue.count, 1);
  const manifest = json("asset_manifest.json");
  for (const extension of ["SCN", "TRO", "MSG", "001", "002"]) {
    const entry = manifest.files.find((file: { path: string }) => file.path === `DC/SCENARIO/HUMAN/HUMAN05.${extension}`);
    assert.ok(entry, extension);
    assert.equal(hash(source(extension)), entry.sha256, extension);
  }
});

test("HUMAN05 messages: adapted loader preserves full source and distinguishes outcome files", async context => {
  context.mock.method(globalThis, "fetch", diskFetch);
  const loaded = await loadCampaignMission("human", 5, "browser-adapted");
  assert.deepEqual(loaded.messages, parseMissionMessages(source("MSG").toString("ascii")));
  assert.deepEqual(loaded.triggers, parseTriggerScript(source("TRO").toString("ascii")));
  assert.deepEqual(Buffer.from(loaded.scenario.rawScenario!, "base64"), source("SCN"));
  assert.deepEqual(readdirSync(sourceRoot).filter(filename => /^HUMAN05\.\d{3}$/.test(filename)).sort(),
    ["HUMAN05.001", "HUMAN05.002"]);
  assert.deepEqual(loaded.scenario.outcomes?.map(outcome => outcome.reasonCode), [1, 2]);
  const outcomes = json("public/assets/generated/data/scenarios/HUMAN/HUMAN05.json").outcomes;
  assert.deepEqual(outcomes.map((outcome: { source: { path: string } }) => outcome.source.path),
    ["HUMAN/HUMAN05.001", "HUMAN/HUMAN05.002"]);
  assert.equal(loaded.messages.find(message => message.id === 5)?.text, "WARNING...WARNING...WARNING...");
});

test("HUMAN05 messages: actual source msg action retains text, parameters and applied receipt", async context => {
  context.mock.method(globalThis, "fetch", diskFetch);
  const loaded = await loadCampaignMission("human", 5, "browser-adapted");
  const actions = parseTriggerScript(source("TRO").toString("ascii")).flatMap(block => block.actions);
  const action = actions.find(entry => entry.name === "msg" && entry.arguments[2] === 5)!;
  assert.deepEqual(action.arguments, [0, 0, 5, 3, 3]);
  const initialized = initializeCampaignSession(sourceBrowserCampaignSessionOptions(loaded));
  const controller = createMissionController([{ id: 1, mode: "norm", flag: 1, condition: "(1)", actions: [action] }], {});
  assert.ok(initialized.ok, JSON.stringify(initialized));
  assert.ok(controller.ok, JSON.stringify(controller));
  const result = stepCampaignWorld(controller.value, initialized.value.world,
    { cycleCounter: 16, clockMilliseconds: 123456 }, { kind: "normal" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.receipts.map(receipt => receipt.disposition), ["applied"]);
  assert.equal(result.value.world.messages.length, 1);
  const { commandId, ...message } = result.value.world.messages[0];
  assert.equal(typeof commandId, "string");
  assert.deepEqual(message, { messageId: 5, text: "WARNING...WARNING...WARNING...", presentationCode: 0,
    parameter3: 3, parameter4: 3, clockMilliseconds: 123456, initialValue: 31 });
});

test("HUMAN05 messages: missing source guard remains strict in both runtime profiles", async context => {
  for (const runtimeProfile of [undefined, "browser-adapted"] as const) {
    await context.test(runtimeProfile ?? "strict default", async subtest => {
      const mission = runtimeProfile ? 5 : 1;
      const identifier = runtimeProfile ? 5 : 1;
      const target = `/assets/generated/data/messages/HUMAN/HUMAN${String(mission).padStart(2, "0")}.json`;
      subtest.mock.method(globalThis, "fetch", async (input: string) => {
        const response = await diskFetch(input);
        if (input !== target) return response;
        const envelope = await response.json();
        envelope.messages = envelope.messages.filter((message: { id: number }) => message.id !== identifier);
        return Response.json(envelope);
      });
      await assert.rejects(loadCampaignMission("human", mission, runtimeProfile),
        new RegExp(`missing source message ${identifier}`));
    });
  }
});