import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNativeConstructionHost, receiveNativeConstruction, visitNativeConstruction,
  nativeConstructionRegisteredSlots, nativeConstructionRaw, type NativeConstructionConfiguration } from "../../src/engine/native-construction-host";

export const cityProof = JSON.parse(process.env.DC_SESSION_CITY_TRACE ? readFileSync(process.env.DC_SESSION_CITY_TRACE, "utf8")
  : execFileSync("python3", ["-B", new URL("campaign-session-city-native.py", import.meta.url).pathname], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));

export function cityConfiguration(golden: any): NativeConstructionConfiguration {
  const profile = (unitType: number, build = false) => {
    const binding = golden.profiles.bindings.find((item: any) => item.unitType === unitType);
    const state = build ? binding.constructionState : binding.standState;
    return { id: state.name, source: state.source,
      sha256: golden.profiles.sources.find((item: any) => item.source === state.source).sha256,
      first: state.first, last: state.last, directions: Array.from({ length: 32 }, () => [...state.delays]) };
  };
  const bytes = new DataView(Uint8Array.from(golden.beforeTeam).buffer);
  return { sourceSha256: cityProof.sha256, team: 1, race: golden.race, base: { x: 32, y: 32 }, map: { width: 128, height: 128 },
    fixedSlots: Array.from({ length: 15 }, (_, slot) => slot < 2 ? { nativeId: 15 + slot,
      unitType: 16 + golden.race * 12 + slot, health: bytes.getInt32(0x3c + slot * 4, true) } : null),
    footprint: [[33, 32], [34, 32], [33, 33], [34, 33]].map(([x, y]) => ({ x, y, occupant: 1023 })),
    profiles: { stand: profile(20 + golden.race * 12), build: profile(20 + golden.race * 12, true), auxiliary: profile(92 + golden.race) } };
}

export function relocatedRaw(actor: any): number[] {
  const raw = Uint8Array.from(actor.raw), bytes = new DataView(raw.buffer);
  if (actor.status) for (const offset of [0x14, 0x1c, 0x24]) bytes.setUint32(offset,
    actor.type * 280 + (offset === 0x14 && actor.animation.state.includes("BUILD") ? 0x98 : 0x90), true);
  return [...raw];
}

for (const golden of cityProof.cases) test(`CITY raw220 race ${golden.race}: constructors and every native visit`, () => {
  let host = receiveNativeConstruction(createNativeConstructionHost(cityConfiguration(golden)), "raw-receipt");
  for (const [index, expected] of golden.trace.entries()) {
    if (index) host = visitNativeConstruction(host, { sequence: index - 1, counter: 4, mainHealth: 2400,
      auxiliaryHealth: host.actors[6]?.health ?? 0, registeredSlots: nativeConstructionRegisteredSlots(host) });
    assert.deepEqual([...nativeConstructionRaw(host, 3)], relocatedRaw(expected.main), `main ${index}`);
    assert.deepEqual([...nativeConstructionRaw(host, 6)], relocatedRaw(expected.auxiliary), `auxiliary ${index}`);
  }
});