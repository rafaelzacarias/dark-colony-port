import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  AmbientAudioScheduler,
  ambientAudioData,
  parseAmbientFile,
  parseSlistAmbientBindings,
  resolveAmbientSoundCue,
  type AmbientAudioData,
  type AmbientBiomeProfile,
} from "../../src/audio/ambient";
import { type MediaAudioIndex } from "../../src/audio/cues";
import { legacyCueCatalog } from "../../src/audio/legacy-cues";

const readRepoFile = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url));

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const mediaIndex: MediaAudioIndex = JSON.parse(
  readRepoFile("public/assets/generated/media/index.json").toString("utf8"),
);

const publishedAmbientJson: AmbientAudioData = JSON.parse(
  readRepoFile("public/assets/data/ambient-audio.json").toString("utf8"),
);

test("ambient-audio.json schema, source SHA-256 hashes, SLIST AMB bindings, and parsed .AMB profiles match raw CD files", () => {
  assert.equal(publishedAmbientJson.schemaVersion, 1);
  assert.deepEqual(publishedAmbientJson, ambientAudioData);

  const expectedSources = {
    desert: "raw_cd/DC/SOUND/DESERT.AMB",
    jungle: "raw_cd/DC/SOUND/JUNGLE.AMB",
    atlantis: "raw_cd/DC/SOUND/ATLANTIS.AMB",
    slist: "raw_cd/DC/SOUND/SLIST.DAT",
  } as const;

  for (const [key, expectedPath] of Object.entries(expectedSources) as [keyof typeof expectedSources, string][]) {
    const sourceEntry = publishedAmbientJson.sources[key];
    assert.equal(sourceEntry.path, expectedPath);
    const rawBytes = readRepoFile(sourceEntry.path);
    assert.equal(sourceEntry.sha256, sha256Hex(rawBytes), `SHA-256 mismatch for ${sourceEntry.path}`);
  }

  const slistRaw = readRepoFile(publishedAmbientJson.sources.slist.path).toString("utf8");
  assert.deepEqual(publishedAmbientJson.slistBindings, {
    "98": [60, 58, 59, 57],
    "99": [57, 58, 59],
  });
  assert.deepEqual(parseSlistAmbientBindings(slistRaw), publishedAmbientJson.slistBindings);

  for (const profile of ["desert", "jungle", "atlantis"] as const) {
    const rawAmb = readRepoFile(publishedAmbientJson.sources[profile].path).toString("utf8");
    const parsed = parseAmbientFile(rawAmb);
    assert.deepEqual(publishedAmbientJson.profiles[profile], parsed, `Profile mismatch for ${profile}`);
    assert.ok(parsed.length > 0);
    assert.ok(parsed.every((record) => (record.tod === 0 || record.tod === 1) && record.soundIds.length > 0));
  }
});

test("parseAmbientFile deterministically parses comments and rejects malformed rows", () => {
  const sample = [
    "%tod   btype   sounds -1",
    "%day water sounds",
    "0       3       20 23 61 61 -1",
    "%night wind",
    "1       10      19 60 60 -1",
  ].join("\r\n");

  const parsed = parseAmbientFile(sample);
  assert.deepEqual(parsed, [
    { tod: 0, btype: 3, soundIds: [20, 23, 61, 61], comment: "%day water sounds" },
    { tod: 1, btype: 10, soundIds: [19, 60, 60], comment: "%night wind" },
  ]);
  assert.deepEqual(parseAmbientFile(sample), parsed);

  assert.throws(() => parseAmbientFile("2 3 20 -1"), /Invalid AMB tod/);
  assert.throws(() => parseAmbientFile("0 -1 20 -1"), /Invalid AMB btype/);
  assert.throws(() => parseAmbientFile("0 3 20 23"), /Invalid AMB terminator/);
  assert.throws(() => parseAmbientFile("0 3 -1"), /Invalid AMB terminator/);
});

test("every soundId across DESERT.AMB, JUNGLE.AMB, ATLANTIS.AMB, and SLIST.DAT AMB rows resolves to extracted media files on disk", () => {
  const allSoundIds = new Set<number>();

  for (const ids of Object.values(publishedAmbientJson.slistBindings)) {
    for (const id of ids) allSoundIds.add(id);
  }
  for (const profile of ["desert", "jungle", "atlantis"] as const) {
    for (const record of publishedAmbientJson.profiles[profile]) {
      for (const id of record.soundIds) allSoundIds.add(id);
    }
  }

  assert.equal(allSoundIds.size, 25);

  for (const soundId of [...allSoundIds].sort((a, b) => a - b)) {
    const cue = resolveAmbientSoundCue(soundId, legacyCueCatalog, mediaIndex);
    assert.ok(cue, `Failed to resolve ambient soundId ${soundId}`);
    assert.equal(cue.soundId, soundId);
    assert.ok(cue.source.endsWith(".WAV"));
    assert.ok(cue.candidates.length >= 2, `Expected Ogg and WAV candidates for soundId ${soundId}`);
    assert.ok(cue.candidates[0].endsWith(".ogg"));
    assert.ok(cue.candidates[1].endsWith(".wav"));

    for (const candidateUrl of cue.candidates) {
      const diskUrl = new URL(`../../public${candidateUrl}`, import.meta.url);
      assert.ok(existsSync(diskUrl), `Missing extracted media file on disk: public${candidateUrl}`);
      const fileBytes = readFileSync(diskUrl);
      assert.ok(fileBytes.byteLength > 0, `Empty extracted media file: public${candidateUrl}`);
    }
  }

  assert.equal(resolveAmbientSoundCue(-1, legacyCueCatalog, mediaIndex), undefined);
  assert.equal(resolveAmbientSoundCue(9999, legacyCueCatalog, mediaIndex), undefined);
});

test("AmbientAudioScheduler transitions cleanly between day (tod=0) and night (tod=1) cues across desert, jungle, and atlantis without RNG", () => {
  const profiles: readonly AmbientBiomeProfile[] = ["desert", "jungle", "atlantis"];
  const scheduler = new AmbientAudioScheduler({
    intervalTicks: 20,
    data: publishedAmbientJson,
    catalog: legacyCueCatalog,
    mediaIndex,
  });

  for (const profile of profiles) {
    scheduler.reset();

    // Day (daylightPermille >= 500 -> tod = 0)
    const dayCue1 = scheduler.step({ profile, tick: 0, daylightPermille: 1000 });
    assert.ok(dayCue1, `Expected day cue 1 for ${profile}`);
    assert.equal(dayCue1.profile, profile);
    assert.equal(dayCue1.tod, 0);
    assert.equal(dayCue1.bindingSource, "amb");
    assert.ok(dayCue1.candidates.length >= 2);

    // Within tick interval -> suppressed
    const suppressedDay = scheduler.step({ profile, tick: 10, daylightPermille: 750 });
    assert.equal(suppressedDay, undefined);

    // Next interval at day boundary (daylightPermille = 500 -> tod = 0)
    const dayCue2 = scheduler.step({ profile, tick: 20, daylightPermille: 500 });
    assert.ok(dayCue2, `Expected day cue 2 for ${profile}`);
    assert.equal(dayCue2.tod, 0);

    // Transition to night (daylightPermille < 500 -> tod = 1)
    const nightCue1 = scheduler.step({ profile, tick: 40, daylightPermille: 499 });
    assert.ok(nightCue1, `Expected night cue 1 for ${profile}`);
    assert.equal(nightCue1.profile, profile);
    assert.equal(nightCue1.tod, 1);
    assert.ok(nightCue1.candidates.length >= 2);

    if (profile === "atlantis") {
      // ATLANTIS.AMB has only tod=0 records, so night cleanly transitions to SLIST AMB 98 carrier
      assert.equal(nightCue1.bindingSource, "slist");
      assert.equal(nightCue1.slistId, 98);
      assert.ok(publishedAmbientJson.slistBindings["98"].includes(nightCue1.soundId));
    } else {
      assert.equal(nightCue1.bindingSource, "amb");
      const nightProfileSoundIds = new Set(
        publishedAmbientJson.profiles[profile]
          .filter((r) => r.tod === 1)
          .flatMap((r) => r.soundIds),
      );
      assert.ok(nightProfileSoundIds.has(nightCue1.soundId));
    }

    // Transition back to day (tod = 0)
    const backToDayCue = scheduler.step({ profile, tick: 60, daylightPermille: 850 });
    assert.ok(backToDayCue, `Expected return-to-day cue for ${profile}`);
    assert.equal(backToDayCue.tod, 0);
    assert.equal(backToDayCue.bindingSource, "amb");
  }

  // Verify btype filtering and explicit SLIST AMB 98/99 carrier matching
  scheduler.reset();
  const spiderDay = scheduler.step({ profile: "jungle", tick: 0, daylightPermille: 900, btypes: [21] });
  assert.ok(spiderDay);
  assert.equal(spiderDay.btype, 21);
  assert.equal(spiderDay.tod, 0);
  assert.equal(spiderDay.comment, "%day spider");

  const slistCarrier99 = scheduler.step({ profile: "desert", tick: 20, daylightPermille: 900, btypes: [99] });
  assert.ok(slistCarrier99);
  assert.equal(slistCarrier99.bindingSource, "slist");
  assert.equal(slistCarrier99.slistId, 99);
  assert.ok(publishedAmbientJson.slistBindings["99"].includes(slistCarrier99.soundId));
});
