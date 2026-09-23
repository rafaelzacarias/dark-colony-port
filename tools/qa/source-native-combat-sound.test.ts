import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSourceNativeCombatSoundProof, isAuthenticatedSourceNativeCombatSoundProof } from "../../src/engine/source-native-combat-options";

const raw = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
const assets = () => ({ executable: raw("DC.EXE"), soundTable: raw("SOUND/SOUND2.DAT"), bindings: raw("SOUND/SLIST.DAT") });
const boundary = () => ({ policy: "explicit-caller-boundary" as const,
  state: { descriptor: [4, 0, 0, 28, 90, 153, 154, 0, 0, 0, 0, 0, 0], randomSeed: 1 },
  initialized: true, disabled: false, listener: { x: 0, y: 0 } });

test("sound provider authenticates bytes and requires explicit caller state, never a mission default", async () => {
  const caller = boundary(), source = assets();
  const pending = createSourceNativeCombatSoundProof(source, caller);
  caller.state.randomSeed = 99; source.soundTable.fill(0);
  const proof = await pending;
  assert.equal(proof.policy, "explicit-caller-boundary");
  assert.equal(proof.initial.randomSeed, 1);
  assert.deepEqual(proof.configuration.sounds.map(row => row.id), [28, 90, 153, 154]);
  assert.ok(isAuthenticatedSourceNativeCombatSoundProof(proof));
  assert.equal(isAuthenticatedSourceNativeCombatSoundProof(structuredClone(proof)), false);
  assert.ok(Object.isFrozen(proof.initial.descriptor));
  await assert.rejects(createSourceNativeCombatSoundProof(source, boundary()), /source hash mismatch/);
  await assert.rejects(createSourceNativeCombatSoundProof(assets(), { ...boundary(), state: undefined! }), /plain data/);
  await assert.rejects(createSourceNativeCombatSoundProof(assets(), { ...boundary(), policy: undefined! }), /plain data/);
});