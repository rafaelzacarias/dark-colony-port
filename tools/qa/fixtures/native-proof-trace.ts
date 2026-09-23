import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const captures = new Map<string, string>();

export function nativeProofTrace(path: string | undefined, probe: string, args: readonly string[] = []): string {
  if (path !== undefined) return path;
  const key = JSON.stringify([probe, args]);
  const cached = captures.get(key);
  if (cached) return cached;
  const directory = mkdtempSync(join(tmpdir(), "dc-native-proof-"));
  process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "trace.jsonl"), descriptor = openSync(output, "wx");
  try {
    const result = spawnSync("python3", ["-B", join(root, "tools/qa", probe), ...args], {
      cwd: root, encoding: "utf8", stdio: ["ignore", descriptor, "pipe"],
      env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH,
        "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") },
    });
    assert.equal(result.status, 0, `${probe}: ${result.error?.message ?? result.stderr}`);
  } finally {
    closeSync(descriptor);
  }
  captures.set(key, output);
  return output;
}

export function nativeType8ContinuationTraces(): string[] {
  const explicit = process.env.DC_NATIVE_TYPE8_CONTINUATION_TRACE;
  if (explicit !== undefined) return explicit.split(":");
  return ["ALIEN02", "ALIEN01"].map(mission => nativeProofTrace(undefined,
    "native-type8-continuation-native.py", ["--mission", mission, "--limit", "400"]));
}