import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats } from "../extractors/data/tables";
import { createCampaignWorld } from "../../src/engine/campaign-world";
import { initializeAiSelectors, prepareAiSelector } from "../../src/engine/ai-command-selector";
import { authenticateLegacyNativeSchedulerSource } from "../../src/engine/legacy-native-scheduler";
import { createNativeSchedulerHostConfiguration, NativeSchedulerHost,
  type NativeSchedulerBoundary } from "../../src/engine/native-scheduler-host";
import { createSourceNativePolicy } from "../../src/engine/source-native-policy";

type Snapshot = Omit<NativeSchedulerBoundary, "scope" | "game" | "aiState" | "policies" | "groundCells"> & {
  game: string; aiState: string; groundCells: number[];
  policies: { team: number; address: number; bytes: string }[];
};
type Policy = { counter: number; team: number; packets: string[]; after: { policyAddress: number }; ruleTable: string;
  navigation: { width: number; height: number; families: number[]; nextFamily: string };
  inputs: { types: string; weapons: string; dependencies: string; cityDependencies: number[];
    matrix: number[][]; neighbors: string } };
type Capture = { mission: string; runtimeCoreInterceptions: unknown[]; acceptance: { completeWorldHistory: boolean };
  suffixes: { counter: number; before: Snapshot; after: Snapshot; outgoing: string[] }[];
  fullPolicies: Policy[];
  events: { phase: string; counter: number; tick: number; value: number }[] };
const root = new URL("../../", import.meta.url);
const decode = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
const source = await authenticateLegacyNativeSchedulerSource(readFileSync(new URL("raw_cd/DC/DC.EXE", root)));
function capture(name: string, args: string[]): Capture {
  const path = process.env[name];
  return JSON.parse(path ? readFileSync(path, "utf8") : execFileSync("python3", ["-B",
    "tools/qa/native-scheduler-host-native.py", ...args], { cwd: root, encoding: "utf8", maxBuffer: 96 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } }));
}
const fresh = capture("DC_NATIVE_SCHEDULER_HOST_FRESH_TRACE", ["--updates", "32", "--counters", "1,4,16,32"]);
const late = capture("DC_NATIVE_SCHEDULER_HOST_TRACE", ["--updates", "1200", "--counters", "1160,1184,1192"]);
const human = capture("DC_NATIVE_SCHEDULER_HOST_HUMAN_TRACE", ["--mission", "HUMAN", "--updates", "4", "--counters", "4"]);
function boundary(snapshot: Snapshot): NativeSchedulerBoundary {
  return { ...snapshot, scope: "explicit-native-post-projectile-boundary", game: decode(snapshot.game),
    aiState: decode(snapshot.aiState), groundCells: Uint32Array.from(snapshot.groundCells),
    policies: snapshot.policies.map(policy => ({ ...policy, bytes: decode(policy.bytes) })) };
}
function configuration(capture: Capture) {
  const faction = capture.mission.startsWith("HUMAN") ? "HUMAN" : "ALIEN";
  const scenario = parseScenario(readFileSync(new URL(`raw_cd/DC/SCENARIO/${faction}/${capture.mission}.SCN`, root), "utf8"));
  const first = capture.fullPolicies[0];
  const sourceNativePolicy = first ? [createSourceNativePolicy({ source, team: first.team, policyAddress: first.after.policyAddress,
    tables: { ...first.inputs, types: decode(first.inputs.types), weapons: decode(first.inputs.weapons),
      dependencies: decode(first.inputs.dependencies), neighbors: decode(first.inputs.neighbors), ruleTable: decode(first.ruleTable) },
    navigation: { ...first.navigation, families: Uint8Array.from(first.navigation.families), nextFamily: decode(first.navigation.nextFamily) },
  })] : [];
  return createNativeSchedulerHostConfiguration({ source, scenario, globalMode: 0, sourceNativePolicy });
}
function timing(capture: Capture, counter: number) {
  const events = capture.events.filter(event => event.counter === counter);
  return { endTick: events.find(event => event.phase === "timing-clock-return")!.tick,
    ...((counter & 31) === 0 ? { feedbackTick: events.find(event => event.phase === "feedback-clock-return")!.tick } : {}) };
}

for (const [label, trace] of [["fresh", fresh], ["activation", late]] as const) {
  test(`host ${label}: complete native suffix bytes, current selectors, policy heap and timing requests`, () => {
    assert.deepEqual(trace.runtimeCoreInterceptions, []);
    assert.equal(trace.acceptance.completeWorldHistory, true);
    assert.equal(trace.suffixes.length, label === "fresh" ? 4 : 3);
    const config = configuration(trace);
    let draws = 0, actorPackets = 0, feedback = 0;
    for (const suffix of trace.suffixes) {
      const initial = boundary(suffix.before), host = new NativeSchedulerHost(config, initial);
      const before = structuredClone(initial);
      const result = host.transactPostProjectile(timing(trace, suffix.counter));
      if (!result.ok) assert.fail(JSON.stringify(result));
      assert.deepEqual(result.state, boundary(suffix.after), `all native boundary bytes at ${suffix.counter}`);
      assert.deepEqual(host.snapshot, boundary(suffix.after));
      assert.deepEqual(initial, before);
      assert.equal(result.admitted, false);
      assert.equal(result.executableWholeGame, false);
      assert.deepEqual(result.phases, ["ai-local-enter", "ai", "ai-local-exit", "timing",
        ...((suffix.counter & 31) === 0 ? ["timing-feedback"] : [])]);
      for (const call of result.calls) {
        draws += call.selection.draws.length;
        actorPackets += call.packets.filter(packet => packet.kind === "actor-order" && packet.orders.some(order =>
          order.mode === 5 || order.slots.length > 0)).length;
      }
      const events = trace.events.filter(event => event.counter === suffix.counter);
      assert.deepEqual(result.requests.map(request => request.value), events.filter(event =>
        event.phase === "period-packet" || event.phase === "latency-packet").map(event => event.value));
      const emittedActorPackets = result.calls.flatMap(call => call.packets.map(packet => Buffer.from(packet.packet).toString("hex")));
      assert.deepEqual(emittedActorPackets, trace.fullPolicies.filter(policy => policy.counter === suffix.counter)
        .flatMap(policy => policy.packets));
      assert.equal(result.requests.length + emittedActorPackets.length, suffix.outgoing.length);
      feedback += result.requests.length;
      const committed = host.snapshot;
      result.state.game.fill(255);
      result.state.groundCells.fill(0);
      assert.deepEqual(host.snapshot, committed);
      assert.equal(host.transactPostProjectile(timing(trace, suffix.counter)).ok, false);
      assert.deepEqual(host.snapshot, committed);
    }
    assert.ok(draws > 0);
    assert.ok(feedback > 0);
    if (label === "activation") assert.ok(actorPackets > 0);
  });
}

test("host: late timing failure rolls back policy allocation, packets, shared RNG and all world bytes", () => {
  const suffix = late.suffixes.find(suffix => suffix.counter === 1160)!;
  const config = configuration(late), initial = boundary(suffix.before), host = new NativeSchedulerHost(config, initial);
  const failed = host.transactPostProjectile({ endTick: -1 });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.phase, "timing");
  assert.equal(host.completed, false);
  assert.deepEqual(host.snapshot, initial);
  const retried = host.transactPostProjectile(timing(late, suffix.counter));
  assert.equal(retried.ok, true);
  assert.deepEqual(host.snapshot, boundary(suffix.after));
});

test("host: source identity, frozen configuration, selector owner readiness and full-cycle rejection", () => {
  const config = configuration(late), initial = boundary(late.suffixes[0].before);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.sourceNativePolicy), true);
  assert.equal(Object.isFrozen(config.sourceNativePolicy[0]), true);
  assert.throws(() => new NativeSchedulerHost({ ...config }, initial), /original frozen configuration identity/);
  const scenario = parseScenario(readFileSync(new URL("raw_cd/DC/SCENARIO/ALIEN/ALIEN02.SCN", root), "utf8"));
  assert.throws(() => createNativeSchedulerHostConfiguration({ source, scenario, globalMode: 0,
    sourceNativePolicy: [{ ...config.sourceNativePolicy[0] }] }), /original owner\/source identity/);
  const host = new NativeSchedulerHost(config, initial);
  const readiness = host.wholeCycleReadiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.blockers[0].phase, "census");
  assert.ok(readiness.blockers.some(blocker => blocker.phase === "registered-actors" && blocker.type === 40));
  assert.ok(readiness.blockers.some(blocker => blocker.phase === "registered-actors" && blocker.type === 28));
  assert.equal(host.transactWholeCycle().ok, false);
  assert.deepEqual(host.snapshot, initial);
  assert.equal(host.completed, false);
});

test("host: current mode 3 requires its concrete team owner; no fake mode-4 readiness", () => {
  const initial = boundary(late.suffixes[0].before), config = configuration(fresh);
  const host = new NativeSchedulerHost(config, initial);
  const result = host.transactPostProjectile(timing(late, late.suffixes[0].counter));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.phase, "ai");
    assert.equal(result.team, 1);
    assert.match(result.message, /Missing sourceNativePolicy owner/);
  }
  assert.deepEqual(host.snapshot, initial);
});

test("host: missing periodic feedback input rejects the entire native suffix", () => {
  const suffix = fresh.suffixes.find(suffix => suffix.counter === 32)!;
  const initial = boundary(suffix.before), host = new NativeSchedulerHost(configuration(fresh), initial);
  const result = host.transactPostProjectile({ endTick: timing(fresh, suffix.counter).endTick });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.phase, "timing-feedback");
  assert.deepEqual(host.snapshot, initial);
});

test("host HUMAN02: actual initial mode-3 team, registered types and selector readiness fail closed", () => {
  assert.equal(human.acceptance.completeWorldHistory, true);
  assert.deepEqual(human.runtimeCoreInterceptions, []);
  const initial = boundary(human.suffixes[0].before), host = new NativeSchedulerHost(configuration(human), initial);
  const rejected = host.transactPostProjectile(timing(human, 4));
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.phase, "ai");
    assert.equal(rejected.team, 3);
    assert.match(rejected.message, /Missing sourceNativePolicy owner/);
  }
  const readiness = host.wholeCycleReadiness();
  assert.ok(readiness.blockers.some(blocker => blocker.phase === "registered-actors" && blocker.type === 16));
  assert.ok(readiness.blockers.some(blocker => blocker.phase === "registered-actors" && blocker.type === 40));
  assert.ok(readiness.blockers.some(blocker => blocker.phase === "ai" && blocker.team === 4));
  const scenario = parseScenario(readFileSync(new URL("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN", root), "utf8"));
  const result = createCampaignWorld({ sessionId: "native-scheduler-readiness", source: scenario, messages: [],
    placementInitialization: { firstSlot: 152, mode: 0 },
    resourceInitialization: { width: 96, height: 84, firstSlot: 152, scales: { rateScale: 256, reserveScale: 256 } },
    units: parseUnitStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root), "utf8")) });
  if (!result.ok) assert.fail(JSON.stringify(result.diagnostics));
  const selectors = initializeAiSelectors(scenario), world = { ...result.value, aiSelectors: selectors };
  const planned = { id: "unadmitted-source-selector", triggerId: 17, actionIndex: 1,
    action: { name: "ai", arguments: [2, 4] }, command: { kind: "ai" as const, team: 2, mode: 4 } };
  const before = structuredClone(world);
  assert.equal(host.selectorOwner.isReady({ world, planned, selectors }), false);
  assert.throws(() => prepareAiSelector(world, planned, host.selectorOwner), /scheduling owner is not ready/);
  assert.deepEqual(world, before);
  assert.deepEqual(host.snapshot, initial);
  assert.equal(host.completed, false);
});

test("host: frozen public owner and unshared boundary requirements cannot be bypassed", () => {
  const config = configuration(fresh), initial = boundary(fresh.suffixes[0].before);
  const host = new NativeSchedulerHost(config, initial);
  assert.equal(Object.isFrozen(host), true);
  initial.game.fill(0);
  assert.deepEqual(host.snapshot, boundary(fresh.suffixes[0].before));
  const shared = new Uint8Array(new SharedArrayBuffer(initial.game.length));
  shared.set(boundary(fresh.suffixes[0].before).game);
  assert.throws(() => new NativeSchedulerHost(config, { ...initial, game: shared }), /unshared current-world/);
});