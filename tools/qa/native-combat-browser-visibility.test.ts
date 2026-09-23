import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createNativeCombatBrowserHarness } from "./fixtures/native-combat-browser";
import { validateSourceNativeVisibilityHostConfiguration } from "../../src/engine/source-native-visibility-host";

test("browser visibility fixture: real byte sources, explicit phase and fresh authenticated restore (Node only)", async () => {
  const previousFetch = globalThis.fetch;
  const requested: string[] = [];
  let harness: Awaited<ReturnType<typeof createNativeCombatBrowserHarness>> | undefined;
  try {
    globalThis.fetch = async input => {
      const path = String(input);
      assert.ok(path.startsWith("/raw_cd/DC/") || path.startsWith("/assets/generated/"));
      requested.push(path);
      return new Response(Uint8Array.from(await readFile(new URL(`../../${path.startsWith("/assets/") ? `public${path}` : path.slice(1)}`, import.meta.url))));
    };
    harness = await createNativeCombatBrowserHarness({ width: 512, height: 452, getContext: () => null } as unknown as HTMLCanvasElement,
      {} as HTMLElement, undefined, "queued-player-input", { localTeam: 0, localMask: 0x42000000, daylight: 256, crtSeed: 1 });
    const visibility = harness.mission.sourceNativeCombat!.options.nativeCombat.visibility!;
    validateSourceNativeVisibilityHostConfiguration(visibility);
    assert.equal(visibility.localMask, 0x42000000);
    assert.equal(visibility.daylight, 256);
    assert.ok(requested.includes("/raw_cd/DC/SCENARIO/DESERT.BTS"));
    assert.ok(harness.sourceHashes["/raw_cd/DC/SCENARIO/DESERT.BTS"]);
    assert.equal(harness.initial.entities.length, 21);
    const bytes = harness.view.campaignSnapshot!.world.entityBytes!;
    const excludedProducerSlots = Array.from({ length: 800 }, (_, slot) => slot).filter(slot => bytes[slot * 220 + 0x2c]
      && bytes[slot * 220 + 7] <= 7 && ![1, 2].includes(bytes[slot * 220 + 0xcb]));
    const frame = harness.advanceNativeVisibility({ visibilityFrame: { sequence: 1, counter: 0, producerSlots: [], excludedProducerSlots } });
    assert.equal(frame.cycleCounter, 0);
    assert.equal(frame.visibilityEvent.executed, true);
    assert.deepEqual(harness.view.visibility, Uint8Array.from(frame.visibility.groundWords, word => Number(Boolean(word & visibility.localMask))));
    assert.deepEqual(harness.view.explored, Uint8Array.from(frame.visibility.groundWords, word => word >>> 31));
    const before = harness.checkpoint();
    await harness.restore(before);
    assert.deepEqual(harness.checkpoint(), before);
    const fresh = harness.view.mission.sourceNativeCombat!.options.nativeCombat.visibility!;
    validateSourceNativeVisibilityHostConfiguration(fresh);
    assert.notEqual(fresh, visibility);
    assert.deepEqual(fresh, visibility);
    assert.equal(harness.commandStatus.visibility, "authenticated-native-ground-mask");
    assert.throws(() => harness!.advanceTo(1), /explicit clock/);
  } finally {
    harness?.dispose();
    globalThis.fetch = previousFetch;
  }
});