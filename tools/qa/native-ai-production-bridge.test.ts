import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNativeAiProductionConfiguration, receiveNativeAiPaidProduction,
  advanceNativeAiProductionFin, visitNativeAiProduction,
  type NativeAiProductionWorld } from "../../src/engine/native-ai-production-bridge";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const configuration = createNativeAiProductionConfiguration({ executable: read("raw_cd/DC/DC.EXE"),
  dependencies: read("raw_cd/DC/GAMESTAT/DEPEND.TXT"), gameStat: read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"),
  humanProducer: read("public/assets/generated/animations/HUBU.json"),
  alienProducer: read("public/assets/generated/animations/ALBU.json") });

function fixture() {
  const world: NativeAiProductionWorld = { game: new Uint8Array(0x471b0), groundCells: new Uint32Array(16).fill(1023),
    populations: Array(8).fill(0), rngCursor: 217, width: 4, height: 4 };
  const bytes = new DataView(world.game.buffer), offset = 0xb98 + 0xe30;
  bytes.setInt32(offset + 0x14, 650, true);
  bytes.setInt32(offset + 0x18, 100, true);
  return { world, receipt: { phase: "ai-demand-prepaid-unit" as const, team: 1, dependency: 9,
    packet: Uint8Array.of(7, 0, 10, 0, 1, 1, 0), creditsBefore: 1000, creditsAfter: 650,
    expectedAccounting: 100, expectedQueueLength: 0 } };
}

test("paid receipt only appends FIFO/accounting, never double-debits, allocates or reserves", async () => {
  const { world, receipt } = fixture(), before = structuredClone(world);
  const owner = await configuration;
  const result = receiveNativeAiPaidProduction(owner, world, receipt);
  assert.deepEqual(world, before);
  assert.equal(result.charged, 0);
  assert.equal(result.allocatedSlot, null);
  assert.equal(result.queueAfter, 1);
  assert.equal(new DataView(result.world.game.buffer).getInt32(0xb98 + 0xe30 + 0x14, true), 650);
  assert.equal(new DataView(result.world.game.buffer).getInt32(0xb98 + 0xe30 + 0x18, true), 450);
  assert.deepEqual(result.world.groundCells, world.groundCells);
  assert.equal(result.rngAfter, 217);
  assert.throws(() => receiveNativeAiPaidProduction(owner, result.world, receipt), /stale queue/);
});

test("paid receipt rejects unsupported/free/count/stale inputs atomically", async () => {
  const owner = await configuration, { world, receipt } = fixture(), before = structuredClone(world);
  for (const packet of [Uint8Array.of(7, 0, 10, 1, 1, 1, 0), Uint8Array.of(7, 0, 10, 0, 1, 0, 0),
    Uint8Array.of(7, 0, 10, 0, 1, 2, 0), Uint8Array.of(7, 0, 9, 3, 0, 1, 0)]) {
    assert.throws(() => receiveNativeAiPaidProduction(owner, world, { ...receipt, packet }));
  }
  assert.throws(() => receiveNativeAiPaidProduction(owner, world, { ...receipt, creditsBefore: 650 }), /prepaid/);
  assert.throws(() => receiveNativeAiPaidProduction({ ...owner }, world, receipt), /identity/);
  assert.deepEqual(world, before);
});

test("producer reserves real exit1022 then waits for FIN; cap refunds without allocation", async () => {
  const owner = await configuration, { world, receipt } = fixture();
  const bytes = new DataView(world.game.buffer), offset = 0xb98 + 0xe30, actor = 0x7d28 + 16 * 220;
  bytes.setInt32(offset + 0x2c, 1, true); bytes.setInt32(offset + 0x30, 3, true);
  bytes.setInt32(0x528, 10, true); bytes.setInt32(actor + 12, 4800, true);
  bytes.setInt16(0x468ec + 32, 16, true);
  world.game[actor + 6] = 17; world.game[actor + 7] = 1;
  world.game[actor + 0x2c] = 1; world.game[actor + 0x1a] = 1; world.game[offset + 0x108] = 1;
  const paid = receiveNativeAiPaidProduction(owner, world, receipt).world;
  const visit = (current: NativeAiProductionWorld) => ({ phase: "producer-handler-entry" as const, slot: 16,
    expectedCounter: 0, expectedRaw: current.game.slice(actor, actor + 220) });
  const reserved = visitNativeAiProduction(owner, paid, visit(paid));
  assert.equal(reserved.action, "reserved");
  assert.equal(reserved.world.groundCells[1], 1022);
  assert.equal(reserved.allocatedSlot, null);
  let current = reserved.world;
  for (let index = 0; index < 22; index++) current = advanceNativeAiProductionFin(owner, current, visit(current)).world;
  assert.equal(current.game[actor + 0x2a], 2);
  const before = structuredClone(current);
  assert.throws(() => visitNativeAiProduction(owner, current, visit(current)), /constructor provider/);
  assert.deepEqual(current, before);
  const capped = { ...paid, populations: [0, 10, 0, 0, 0, 0, 0, 0] };
  const refund = visitNativeAiProduction(owner, capped, visit(capped));
  assert.equal(refund.action, "cap-refund");
  assert.equal(refund.world.groundCells[1], 1023);
  assert.equal(new DataView(refund.world.game.buffer).getInt32(offset + 0x14, true), 1000);
  assert.equal(new DataView(refund.world.game.buffer).getInt32(offset + 0x18, true), 100);
  assert.equal(new DataView(refund.world.game.buffer).getUint16(offset + 0x110, true), 0);
});