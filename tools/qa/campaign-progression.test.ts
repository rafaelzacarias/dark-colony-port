import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { campaignMissionStem, campaignResultAction, campaignPreflight, loadCampaignMission,
  loadCampaignResourceOptions, type CampaignMissionData } from "../../src/game-data";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseScenario } from "../extractors/data/scenario";
import { parseLegacyDamageMatrix } from "../../src/engine/legacy-balance";

test("campaign paths default to 01 and remain within each numbered source campaign", () => {
  for (const faction of ["human", "alien"] as const) {
    assert.equal(campaignMissionStem(faction), `${faction.toUpperCase()}/${faction.toUpperCase()}01`);
    for (let mission = 1; mission <= 15; mission++) {
      assert.equal(campaignMissionStem(faction, mission),
        `${faction.toUpperCase()}/${faction.toUpperCase()}${String(mission).padStart(2, "0")}`);
    }
  }
  for (const invalid of [0, -1, 16, 1.5, NaN, Infinity]) {
    assert.throws(() => campaignMissionStem("human", invalid), RangeError);
  }
});

test("results offer next only for ready success, retry failures, and stop at 15", () => {
  for (let mission = 1; mission <= 15; mission++) {
    assert.equal(campaignResultAction(mission, null), null);
    assert.equal(campaignResultAction(mission, { ready: false, resultCode: 0 }), null);
    assert.deepEqual(campaignResultAction(mission, { ready: true, resultCode: 0 }),
      mission === 15 ? null : { kind: "next", missionNumber: mission + 1 });
    for (const resultCode of [1, 2, 255]) {
      assert.equal(campaignResultAction(mission, { ready: false, resultCode }), null);
      assert.deepEqual(campaignResultAction(mission, { ready: true, resultCode }), { kind: "retry", missionNumber: mission });
    }
  }
});

const publicRoot = new URL("../../public/", import.meta.url);

async function diskFetch(input: string): Promise<Response> {
  try {
    return new Response(await readFile(new URL(input.slice(1), publicRoot)));
  } catch {
    return new Response(null, { status: 404, statusText: "Not Found" });
  }
}

test("source campaign corpus separates TRO/palette preflight (10/30) from full loader admission (4/30)", async (context) => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string) => {
    requests.push(input);
    return diskFetch(input);
  });
  const index = JSON.parse(await readFile(new URL("assets/generated/data/index.json", publicRoot), "utf8"));
  const supported: string[] = [];
  const expectedPreflight: string[] = [];
  const resourceRejections: Record<string, string> = {
    "HUMAN/HUMAN03": "Source resource: unproved SCN resource mapping",
    "HUMAN/HUMAN07": '[{"code":"missing-input","message":"Placement 38 requires native type-37 coordinate queue and selector-6 state"}]',
    "HUMAN/HUMAN08": '[{"code":"missing-input","message":"Placement 45 requires native type-37 coordinate queue and selector-6 state"}]',
    "HUMAN/HUMAN13": '[{"code":"missing-input","message":"Placement 32 requires native type-37 coordinate queue and selector-6 state"}]',
    "ALIEN/ALIEN03": "Source resource: unproved SCN resource mapping",
    "ALIEN/ALIEN13": '[{"code":"missing-input","message":"Placement 46 requires native type-37 coordinate queue and selector-6 state"}]',
  };
  const nativeDamageMatrix = parseLegacyDamageMatrix(await readFile(
    new URL("../../raw_cd/DC/GAMESTAT/MBULLET.TXT", import.meta.url), "ascii"));
  for (const faction of ["human", "alien"] as const) {
    const prefix = faction.toUpperCase();
    assert.deepEqual(index.files.scenarios.filter(({ source }: { source: string }) =>
      new RegExp(`^${prefix}/${prefix}\\d{2}\\.SCN$`).test(source)).map(({ source }: { source: string }) => source),
    Array.from({ length: 15 }, (_, offset) => `${campaignMissionStem(faction, offset + 1)}.SCN`));
    for (let mission = 1; mission <= 15; mission++) {
      const stem = campaignMissionStem(faction, mission);
      const triggers = await (await diskFetch(`/assets/generated/data/triggers/${stem}.json`)).json();
      const scenario = await (await diskFetch(`/assets/generated/data/scenarios/${stem}.json`)).json();
      const preflight = campaignPreflight(scenario, triggers.blocks);
      if (preflight.length === 0) expectedPreflight.push(stem);
      const source = await readFile(new URL(`../../raw_cd/DC/SCENARIO/${stem}.TRO`, import.meta.url), "utf8");
      assert.deepEqual(triggers.blocks, parseTriggerScript(source), `${stem} must retain all source TRO actions`);
      requests.length = 0;
      const rejection = preflight.length ? preflight.join("; ") : resourceRejections[stem];
      if (rejection) {
        if (!preflight.length) assert.ok(scenario.placementRows.some((row: number[]) => row[2] === 40),
          `${stem} must reach the source-resource handoff`);
        await assert.rejects(loadCampaignMission(faction, mission === 1 ? undefined : mission),
          { name: "Error", message: `Unsupported mission ${stem}: ${rejection}` });
        context.diagnostic(`${stem}: ${rejection}`);
      } else {
        const loaded = await loadCampaignMission(faction, mission === 1 ? undefined : mission);
        assert.equal(loaded.scenario.source.path, `${stem}.SCN`);
        assert.equal(loaded.scenario.id.toUpperCase(), `${prefix}${String(mission).padStart(2, "0")}`);
        assert.ok(loaded.briefing.plainText.length > 0);
        assert.ok(loaded.scenario.outcomes?.length);
        assert.deepEqual(loaded.damageMatrix, nativeDamageMatrix);
        assert.deepEqual(loaded.triggers, triggers.blocks);
        assert.equal(loaded.sourceResource, undefined);
        supported.push(stem);
      }
      if (mission !== 1) assert.ok(!requests.some((url) => url.includes(`${prefix}01`)));
    }
  }
  assert.deepEqual(expectedPreflight, ["HUMAN/HUMAN01", "HUMAN/HUMAN03", "HUMAN/HUMAN07", "HUMAN/HUMAN08",
    "HUMAN/HUMAN11", "HUMAN/HUMAN13", "ALIEN/ALIEN01", "ALIEN/ALIEN03", "ALIEN/ALIEN13", "ALIEN/ALIEN14"]);
  assert.deepEqual(supported, ["HUMAN/HUMAN01", "HUMAN/HUMAN11", "ALIEN/ALIEN01", "ALIEN/ALIEN14"]);
  assert.deepEqual(expectedPreflight.filter((stem) => !supported.includes(stem)).sort(), Object.keys(resourceRejections).sort());
  context.diagnostic(`Pure TRO/palette preflight (${expectedPreflight.length}/30): ${expectedPreflight.join(", ")}`);
  context.diagnostic(`Full source loader admission, not live acceptance (${supported.length}/30): ${supported.join(", ")}`);
});

test("invalid mission numbers reject before any fetch", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  for (const invalid of [0, 16, -1, 1.5, NaN, Infinity, "02" as unknown as number]) {
    await assert.rejects(loadCampaignMission("human", invalid), RangeError);
  }
  await assert.rejects(loadCampaignMission("other" as "human"), RangeError);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("preflight rejects dormant unsupported TRO actions, conditions, and palette constraints", async () => {
  const scenario = await (await diskFetch("/assets/generated/data/scenarios/HUMAN/HUMAN01.json")).json();
  const block = { id: 1, mode: "norm", flag: 0, condition: "(c>32000)", actions: [{ name: "ai", arguments: [0, 1] }] };
  assert.match(campaignPreflight(scenario, [block]).join(";"), /TRO 1: ai/);
  assert.match(campaignPreflight(scenario, [{ ...block, condition: "(t(0)==1)", actions: [] }]).join(";"), /Unsupported operand/);
  assert.deepEqual(campaignPreflight(scenario, [{ ...block, flag: null, actions: [] }]), []);
  assert.deepEqual(campaignPreflight(scenario, parseTriggerScript(
    "0 norm (1)\nsetarray 0 (c+45)\nend\n1 norm 1 (c>s(0,2,0))\nsetlifes 0 1\nend")), []);
  assert.match(campaignPreflight(scenario, parseTriggerScript(
    "0 norm 0 (1)\nsetarray 800 1\nend")).join(";"), /setarray/);
  assert.deepEqual(campaignPreflight(scenario, parseTriggerScript(
    "0 norm 0 (1)\nnewrate 0 1 2\nsetarray 0 (c+45)\nsetlifes 0 0\nend")), []);
  assert.match(campaignPreflight(scenario, [{ ...block, actions: [{ name: "bail", arguments: [0] }] }]).join(";"), /two integer arguments/);
  assert.match(campaignPreflight(scenario, [{ ...block, actions: [{ name: "setlifes", arguments: [2, 1] }] }]).join(";"), /undefined setlifes target/);
  for (const bank of ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]) {
    assert.deepEqual(campaignPreflight({ ...scenario, terrainBank: `${bank.toLowerCase()}.bts` }, []), []);
  }
  for (const bank of ["CUSTOM.BTS", "PALETTE.BTS", "../DESERT.BTS", "/DESERT.BTS", "folder/DESERT.BTS", "DESERT"]) {
    assert.match(campaignPreflight({ ...scenario, terrainBank: bank }, []).join(";"), /Unverified mission terrain palette/);
  }
  assert.match(campaignPreflight({ ...scenario, rawHeader: ["", "2"] }, []).join(";"), /palette phase/);
  assert.match(campaignPreflight({ ...scenario, teams: [] }, []).join(";"), /eight native SCN team slots/);
});

test("missing mission assets fail explicitly without defaulting to a different mission", async (context) => {
  const stem = "HUMAN/HUMAN01";
  for (const missing of ["data/index.json", `data/scenarios/${stem}.json`, `data/triggers/${stem}.json`,
    `data/messages/${stem}.json`, `data/briefings/${stem}.json`, `maps/${stem}.json`,
    "data/damage-matrix.json", "terrain/DESERT.json", "indexed/index.json", "indexed/index.sha256",
    "indexed/palettes/DESERT.json", "indexed/palettes/DESERT.palette.rgb8", "indexed/palettes/DESERT.rmp.r8"]) {
    await context.test(missing, async (subtest) => {
      subtest.mock.method(globalThis, "fetch", async (input: string) => input === `/assets/generated/${missing}`
        ? new Response(null, { status: 404 }) : diskFetch(input));
      await assert.rejects(loadCampaignMission("human"), (error: Error) =>
        error.message.includes(`Unsupported mission ${stem}`) && error.message.includes(missing));
    });
  }
});

test("loader rejects wrong source identity, missing index entries, and corrupt runtime resources", async (context) => {
  const cases = [
    { path: "data/index.json", mutate: (value: any) => { value.files.scenarios = []; }, expected: /Missing indexed source/ },
    { path: "data/index.json", mutate: (value: any) => { delete value.files.damageMatrix; }, expected: /Missing indexed MBULLET/ },
    { path: "data/index.json", mutate: (value: any) => { value.files.damageMatrix = "other.json"; }, expected: /Missing indexed MBULLET/ },
    { path: "data/scenarios/HUMAN/HUMAN01.json", mutate: (value: any) => { value.id = "human02"; }, expected: /Source scenario identity does not match requested mission/ },
    { path: "data/scenarios/HUMAN/HUMAN01.json", mutate: (value: any) => { value.source.path = "HUMAN/HUMAN02.SCN"; }, expected: /Source scenario identity does not match requested mission/ },
    { path: "data/scenarios/HUMAN/HUMAN01.json", mutate: (value: any) => { value.outcomes = []; }, expected: /missing source outcome/ },
    { path: "data/messages/HUMAN/HUMAN01.json", mutate: (value: any) => { value.messages = []; }, expected: /missing source message/ },
    { path: "maps/HUMAN/HUMAN01.json", mutate: (value: any) => { value.width = 0; }, expected: /map dimensions/ },
    { path: "maps/HUMAN/HUMAN01.json", mutate: (value: any) => { value.files.pathGrid = "absent.pth"; }, expected: /absent.pth/ },
  ];
  for (const fixture of cases) await context.test(String(fixture.expected), async (subtest) => {
    subtest.mock.method(globalThis, "fetch", async (input: string) => {
      const response = await diskFetch(input);
      if (input !== `/assets/generated/${fixture.path}`) return response;
      const value = await response.json();
      fixture.mutate(value);
      return Response.json(value);
    });
    await assert.rejects(loadCampaignMission("human"), fixture.expected);
  });
  await context.test("palette byte lengths", async (subtest) => {
    subtest.mock.method(globalThis, "fetch", async (input: string) => input.endsWith("DESERT.rmp.r8")
      ? new Response(new Uint8Array(1)) : diskFetch(input));
    await assert.rejects(loadCampaignMission("alien"), /Indexed asset size\/hash mismatch/);
  });
});

const paletteHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function sourceMissionFixture(faction: "human" | "alien", missionNumber: number): Promise<CampaignMissionData> {
  const stem = campaignMissionStem(faction, missionNumber), prefix = faction.toUpperCase();
  const json = async (path: string) => (await diskFetch(`/assets/generated/${path}`)).json();
  const bytes = async (path: string) => new Uint8Array(await (await diskFetch(`/assets/generated/${path}`)).arrayBuffer());
  const words = async (path: string) => {
    const buffer = Buffer.from(await bytes(path));
    return Uint16Array.from({ length: buffer.length / 2 }, (_, index) => buffer.readUInt16LE(index * 2));
  };
  const map = await json(`maps/${stem}.json`);
  return { faction, map, scenario: await json(`data/scenarios/${stem}.json`),
    triggers: (await json(`data/triggers/${stem}.json`)).blocks,
    messages: (await json(`data/messages/${stem}.json`)).messages,
    briefing: await json(`data/briefings/${stem}.json`), units: (await json("data/units.json")).records,
    weapons: (await json("data/weapons.json")).records,
    terrain: await json(`terrain/${map.terrainBank.split(".")[0].toUpperCase()}.json`), terrainAtlasUrl: "unused-in-node",
    tileReferences: await words(`maps/${prefix}/${map.files.tileReferences}`),
    tileRecordIndices: await words(`maps/${prefix}/${map.files.tileRecordIndices}`),
    attributes: await words(`maps/${prefix}/${map.files.attributes}`),
    pathGrid: await bytes(`maps/${prefix}/${map.files.pathGrid}`), tags: await bytes(`maps/${prefix}/${map.files.tags}`) };
}

test("source-free first missions retain raw SCN identity and omit the resource-only gate", async (context) => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string) => { requests.push(input); return diskFetch(input); });
  for (const faction of ["human", "alien"] as const) {
    requests.length = 0;
    const mission = await loadCampaignMission(faction);
    const original = await readFile(new URL(`../../raw_cd/DC/SCENARIO/${campaignMissionStem(faction)}.SCN`, import.meta.url));
    assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), original);
    assert.equal(mission.scenario.source.sha256, paletteHash(original));
    assert.ok(!mission.scenario.placementRows.some((row) => row[2] === 40));
    assert.equal(mission.sourceResource, undefined);
    assert.ok(!requests.some((path) => /\/animations\/(VENT|EXPL|SLUG)\.json$/.test(path)));
    await assert.rejects(loadCampaignResourceOptions(mission),
      { message: "Source resource: unproved SCN resource mapping" });
  }
});

test("resource-only mission02 fixtures verify pinned raw SCNs and FIN hashes without admitting their TRO", async (context) => {
  context.mock.method(globalThis, "fetch", diskFetch);
  const pins = {
    human: { hash: "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab", slots: [166, 167, 168, 169] },
    alien: { hash: "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e", slots: [190, 191, 192] },
  };
  for (const faction of ["human", "alien"] as const) await context.test(faction, async (subtest) => {
    const original = await sourceMissionFixture(faction, 2);
    const raw = await readFile(new URL(`../../raw_cd/DC/SCENARIO/${campaignMissionStem(faction, 2)}.SCN`, import.meta.url));
    assert.deepEqual(Buffer.from(original.scenario.rawScenario!, "base64"), raw);
    assert.equal(paletteHash(raw), pins[faction].hash);
    assert.equal(original.scenario.source.sha256, pins[faction].hash);
    assert.deepEqual(campaignPreflight(original.scenario, original.triggers),
      [`TRO ${faction === "human" ? 17 : 0}: ai: native policy scheduling owner required`]);
    const mission = { ...original, triggers: [] };
    const options = await loadCampaignResourceOptions(mission);
    assert.equal(options.evidence.scenarioSha256, pins[faction].hash);
    assert.equal(options.missionAdmission, "not-evaluated");
    assert.deepEqual(options.resourceLifecycle.bindings.map(({ slot }) => slot), pins[faction].slots);
    const cases: { name: string; tamper: (value: CampaignMissionData) => CampaignMissionData; expected: string }[] = [
      { name: "missing raw SCN", tamper: (value) => ({ ...value, scenario: { ...value.scenario, rawScenario: undefined } }),
        expected: "Missing original SCN bytes for resources" },
      { name: "raw hash", tamper: (value) => ({ ...value, scenario: { ...value.scenario,
        rawScenario: Buffer.concat([raw, Buffer.from("\r\n")]).toString("base64") } }),
        expected: "Source production: raw SCN hash mismatch" },
      { name: "metadata hash", tamper: (value) => ({ ...value, scenario: { ...value.scenario,
        source: { ...value.scenario.source, sha256: "0".repeat(64) } } }),
        expected: "Source production: raw SCN hash mismatch" },
      { name: "parsed SCN tamper", tamper: (value) => ({ ...value, scenario: { ...value.scenario, title: "Tampered title" } }),
        expected: "Source production: mission title differs from full SCN" },
      { name: "self-consistent but unpinned raw SCN", tamper: (value) => {
        const changed = Buffer.concat([raw, Buffer.from("\r\n")]);
        return { ...value, scenario: { ...value.scenario, rawScenario: changed.toString("base64"),
          source: { ...value.scenario.source, sha256: paletteHash(changed) } } };
      }, expected: "Source resource: unproved SCN resource mapping" },
    ];
    for (const fixture of cases) await subtest.test(fixture.name, async () => {
      await assert.rejects(loadCampaignResourceOptions(fixture.tamper(mission)), { message: fixture.expected });
    });
    for (const stem of ["VENT", "EXPL", "SLUG"]) await subtest.test(`${stem} payload hash`, async () => {
      await assert.rejects(loadCampaignResourceOptions(mission, async (url) => {
        const bytes = new Uint8Array(await (await diskFetch(url)).arrayBuffer());
        if (url === `/assets/generated/animations/${stem}.json`) bytes[0] ^= 1;
        return bytes;
      }), { message: `Source resource: ${stem} generated FIN hash mismatch` });
    });
  });
});

test("previous preflight-only resource missions cannot initialize without resource ownership", async (context) => {
  for (const [faction, missionNumber] of [["human", 3], ["human", 7], ["human", 8], ["human", 13],
    ["alien", 3], ["alien", 13]] as const) {
    const mission = await sourceMissionFixture(faction, missionNumber);
    const result = initializeCampaignSession({ sessionId: `${mission.scenario.id}:browser`, source: mission.scenario,
      units: mission.units, weapons: mission.weapons, triggers: mission.triggers, messages: mission.messages,
      map: mission.map, pathGrid: mission.pathGrid, tags: mission.tags,
      commanders: [{ team: 0, unitType: faction === "human" ? 69 : 73, sprite: faction === "human" ? "TRSC" : "GRAY" }],
      directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1 });
    assert.equal(result.ok, false, `${mission.scenario.id} must not become playable by omitting sourceResource`);
    if (!result.ok) {
      context.diagnostic(`${mission.scenario.id} without resource ownership: ${JSON.stringify(result.diagnostics)}`);
      assert.deepEqual(result.diagnostics, [{ code: "missing-input",
        message: faction === "alien" && missionNumber === 13
          ? "Placement 46 requires native type-37 coordinate queue and selector-6 state"
          : "Type 40 requires explicit bounded resource initialization" }]);
    }
  }
});

async function syntheticPaletteScenario(terrainBank: string) {
  const original = await (await diskFetch("/assets/generated/data/scenarios/HUMAN/HUMAN01.json")).json();
  const originalBytes = Buffer.from(original.rawScenario, "base64");
  const lines = originalBytes.toString("ascii").split(/\r?\n/);
  lines[0] = terrainBank;
  const bytes = Buffer.from(lines.join("\r\n"), "ascii");
  const parsed = parseScenario(bytes.toString("ascii"));
  const scenario = { ...original, ...parsed, source: { ...original.source, sha256: paletteHash(bytes) },
    rawScenario: bytes.toString("base64") };
  assert.equal(paletteHash(originalBytes), original.source.sha256);
  assert.deepEqual({ ...parsed, terrainBank: original.terrainBank }, parseScenario(originalBytes.toString("ascii")));
  assert.equal(scenario.source.path, "HUMAN/HUMAN01.SCN");
  assert.deepEqual(scenario.outcomes, original.outcomes);
  return scenario;
}

test("campaign loader rejects missing, corrupt, and inconsistent raw SCN before indexed fetches", async (context) => {
  const cases: { name: string; mutate: (value: any) => void; expected: RegExp }[] = [
    { name: "missing raw SCN", mutate: (value) => { delete value.rawScenario; }, expected: /Missing original SCN bytes for production/ },
    { name: "non-string raw SCN", mutate: (value) => { value.rawScenario = null; }, expected: /Missing original SCN bytes for production/ },
    { name: "bad base64", mutate: (value) => { value.rawScenario = "!not-base64!"; }, expected: /Invalid character/ },
    { name: "source hash", mutate: (value) => { value.source.sha256 = "0".repeat(64); }, expected: /Source production: raw SCN hash mismatch/ },
    { name: "raw bytes", mutate: (value) => {
      value.rawScenario = Buffer.from(`${Buffer.from(value.rawScenario, "base64").toString("ascii")}\r\n`, "ascii").toString("base64");
    }, expected: /Source production: raw SCN hash mismatch/ },
    { name: "id case differs from raw SCN", mutate: (value) => { value.id = value.id.toUpperCase(); }, expected: /Source production: mission id differs from full SCN/ },
    { name: "title", mutate: (value) => { value.title = "Synthetic mismatched title"; }, expected: /Source production: mission title differs from full SCN/ },
    { name: "terrain case differs from raw SCN", mutate: (value) => { value.terrainBank = value.terrainBank.toUpperCase(); }, expected: /Source production: mission terrainBank differs from full SCN/ },
    { name: "raw header", mutate: (value) => { value.rawHeader[0] = "2 5"; }, expected: /Source production: mission rawHeader differs from full SCN/ },
    { name: "placements", mutate: (value) => { value.placementRows.push([0, 1, 2]); }, expected: /Source production: mission placementRows differs from full SCN/ },
    { name: "team money", mutate: (value) => { value.teams[0].money += 1; }, expected: /Source production: mission team 0 money differs from full SCN/ },
  ];
  for (const fixture of cases) await context.test(fixture.name, async (subtest) => {
    const requests: string[] = [];
    subtest.mock.method(globalThis, "fetch", async (input: string) => {
      requests.push(input);
      const response = await diskFetch(input);
      if (input !== "/assets/generated/data/scenarios/HUMAN/HUMAN01.json") return response;
      const value = await response.json();
      fixture.mutate(value);
      return Response.json(value);
    });
    await assert.rejects(loadCampaignMission("human"), fixture.expected);
    assert.ok(!requests.some((path) => path.includes("/indexed/")));
  });
});

async function campaignPaletteFixture(bank: string, options: {
  manifest?: (value: any) => void; metadata?: (value: any) => void;
  corrupt?: "checksum" | "metadata" | "display" | "remap";
} = {}) {
  const scenario = await syntheticPaletteScenario(`${bank.toLowerCase()}.bts`);
  const root = "/assets/generated/indexed/";
  const manifest = await (await diskFetch(`${root}index.json`)).json();
  const metadataPath = `palettes/${bank}.json`;
  const metadata = await (await diskFetch(`${root}${metadataPath}`)).json();
  const files = new Map<string, Uint8Array>();
  for (const descriptor of [metadata.display, metadata.remap]) {
    files.set(`${root}${descriptor.path}`, new Uint8Array(await (await diskFetch(`${root}${descriptor.path}`)).arrayBuffer()));
  }
  options.metadata?.(metadata);
  const metadataBytes = Buffer.from(JSON.stringify(metadata));
  files.set(`${root}${metadataPath}`, metadataBytes);
  Object.assign(manifest.outputs.find((entry: any) => entry.path === metadataPath), {
    bytes: metadataBytes.length, sha256: paletteHash(metadataBytes),
  });
  options.manifest?.(manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  files.set(`${root}index.json`, manifestBytes);
  files.set(`${root}index.sha256`, Buffer.from(`${paletteHash(manifestBytes)}  index.json\n`));
  if (options.corrupt) {
    const path = options.corrupt === "checksum" ? "index.sha256" : options.corrupt === "metadata" ? metadataPath
      : metadata[options.corrupt].path;
    files.get(`${root}${path}`)![0] ^= 1;
  }
  const requests: string[] = [];
  return { requests, fetch: async (input: string) => {
    requests.push(input);
    const bytes = files.get(input);
    if (bytes) return new Response(Uint8Array.from(bytes).buffer);
    if (input === "/assets/generated/data/scenarios/HUMAN/HUMAN01.json") return Response.json(scenario);
    if (input === "/assets/generated/maps/HUMAN/HUMAN01.json") {
      const value = await (await diskFetch(input)).json();
      return Response.json({ ...value, terrainBank: `${bank.toLowerCase()}.bts` });
    }
    if (input === `/assets/generated/terrain/${bank}.json`) return diskFetch("/assets/generated/terrain/DESERT.json");
    return diskFetch(input);
  } };
}

for (const bank of ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]) {
  test(`${bank} campaign loader selects published palette and rejects corrupt publication`, async (context) => {
    await context.test("selected palette succeeds with a synthetic SCN and fixed map fixture", async (subtest) => {
      const fixture = await campaignPaletteFixture(bank);
      subtest.mock.method(globalThis, "fetch", fixture.fetch);
      const loaded = await loadCampaignMission("human");
      assert.equal(loaded.scenario.terrainBank, `${bank.toLowerCase()}.bts`);
      const bytes = Buffer.from(loaded.scenario.rawScenario!, "base64");
      const parsed = parseScenario(bytes.toString("ascii"));
      assert.equal(loaded.scenario.source.sha256, paletteHash(bytes));
      assert.equal(loaded.scenario.source.path, "HUMAN/HUMAN01.SCN");
      for (const field of ["id", "title", "terrainBank", "rawHeader", "teams", "placementRows"] as const) {
        assert.deepEqual(loaded.scenario[field], parsed[field]);
      }
      assert.ok(loaded.damageMatrix);
      for (const suffix of ["json", "palette.rgb8", "rmp.r8"]) {
        assert.ok(fixture.requests.includes(`/assets/generated/indexed/palettes/${bank}.${suffix}`));
      }
      assert.ok(fixture.requests.filter((path) => path.includes("indexed/palettes/"))
        .every((path) => path.includes(`/palettes/${bank}.`)));
    });
    const cases: { name: string; options: Parameters<typeof campaignPaletteFixture>[1]; expected: RegExp; payload?: boolean }[] = [
      { name: "missing verification", options: { manifest: (value) => { delete value.verifiedInitialPalettes; } }, expected: /unverified initial palette/ },
      { name: "unverified bank", options: { manifest: (value) => { value.verifiedInitialPalettes = []; } }, expected: /unverified initial palette/ },
      { name: "missing bank", options: { manifest: (value) => { value.palettes = []; } }, expected: /Missing indexed palette/ },
      { name: "metadata path traversal", options: { manifest: (value) => {
        const entry = value.palettes.find((entry: any) => entry.name === bank);
        value.outputs.find((output: any) => output.path === entry.metadata).path = "../outside.json";
        entry.metadata = "../outside.json";
      } }, expected: /indexed-root-relative/ },
      { name: "unverified metadata", options: { metadata: (value) => { value.verifiedInitialUse = false; } }, expected: /palette schema mismatch/ },
      { name: "wrong identity", options: { metadata: (value) => { value.name = "PALETTE"; } }, expected: /palette schema mismatch/ },
      { name: "wrong schema", options: { metadata: (value) => { value.schemaVersion = 2; } }, expected: /palette schema mismatch/ },
      { name: "wrong dimensions", options: { metadata: (value) => { value.display.width = 255; } }, expected: /texture descriptor mismatch/ },
      { name: "wrong format", options: { metadata: (value) => { value.remap.format = "RGB8UI"; } }, expected: /texture descriptor mismatch/ },
      { name: "descriptor hash", options: { metadata: (value) => { value.remap.sha256 = "0".repeat(64); } }, expected: /texture descriptor mismatch/ },
      { name: "descriptor size", options: { metadata: (value) => { value.display.bytes = 1; } }, expected: /texture descriptor mismatch/ },
      { name: "missing output", options: { manifest: (value) => {
        value.outputs = value.outputs.filter((entry: any) => entry.path !== `palettes/${bank}.rmp.r8`);
      } }, expected: /texture descriptor mismatch/ },
      { name: "checksum", options: { corrupt: "checksum" }, expected: /checksum mismatch/ },
      { name: "metadata hash", options: { corrupt: "metadata" }, expected: /size\/hash mismatch/ },
      { name: "display payload", options: { corrupt: "display" }, expected: /size\/hash mismatch/, payload: true },
      { name: "remap payload", options: { corrupt: "remap" }, expected: /size\/hash mismatch/, payload: true },
    ];
    for (const fixtureCase of cases) await context.test(fixtureCase.name, async (subtest) => {
      const fixture = await campaignPaletteFixture(bank, fixtureCase.options);
      subtest.mock.method(globalThis, "fetch", fixture.fetch);
      await assert.rejects(loadCampaignMission("human"), fixtureCase.expected);
      if (!fixtureCase.payload) assert.ok(!fixture.requests.some((path) => /\.(rgb8|r8)$/.test(path)));
    });
  });
}

test("campaign loader rejects unknown banks and mismatched SCN/map before indexed fetches", async (context) => {
  for (const bank of ["CUSTOM.BTS", "PALETTE.BTS", "../DESERT.BTS", "/DESERT.BTS", "folder/DESERT.BTS", "DESERT", "mismatch"]) {
    await context.test(bank, async (subtest) => {
      const requests: string[] = [];
      const scenario = await syntheticPaletteScenario(bank === "mismatch" ? "DESERT.BTS" : bank);
      subtest.mock.method(globalThis, "fetch", async (input: string) => {
        requests.push(input);
        if (input === "/assets/generated/data/scenarios/HUMAN/HUMAN01.json") return Response.json(scenario);
        const response = await diskFetch(input);
        if (input === "/assets/generated/maps/HUMAN/HUMAN01.json") {
          const value = await response.json();
          value.terrainBank = bank === "mismatch" ? "JUNGLE.BTS" : bank;
          return Response.json(value);
        }
        return response;
      });
      await assert.rejects(loadCampaignMission("human"), bank === "mismatch" ? /terrain bank mismatch/ : /Unverified mission terrain palette/);
      assert.ok(!requests.some((path) => path.includes("/indexed/")));
    });
  }
});

test("live loader rejects unverified or corrupt MBULLET matrix data", async (context) => {
  const cases: { name: string; mutate: (value: any) => void; expected: RegExp }[] = [
    { name: "schema", mutate: (value) => { value.schemaVersion = 2; }, expected: /matrix schema/ },
    { name: "source path", mutate: (value) => { value.source.path = "OTHER/MBULLET.TXT"; }, expected: /matrix source/ },
    { name: "source checksum", mutate: (value) => { value.source.sha256 = "0".repeat(64); }, expected: /matrix source/ },
    { name: "missing source", mutate: (value) => { delete value.source; }, expected: /matrix source/ },
    { name: "inconsistent Q8", mutate: (value) => { value.coefficients[0][0] += 1; }, expected: /Q8 coefficients/ },
  ];
  for (const field of ["percentages", "coefficients"]) {
    cases.push(
      { name: `${field} missing`, mutate: (value) => { delete value[field]; }, expected: /9x10/ },
      { name: `${field} row count`, mutate: (value) => { value[field].pop(); }, expected: /9x10/ },
      { name: `${field} extra row`, mutate: (value) => { value[field].push(value[field][0]); }, expected: /9x10/ },
      { name: `${field} column count`, mutate: (value) => { value[field][0].pop(); }, expected: /9x10/ },
      { name: `${field} null row`, mutate: (value) => { value[field][0] = null; }, expected: /9x10/ },
    );
    for (const invalid of [-1, 0.5, 32768, "64", null]) {
      cases.push({ name: `${field} invalid ${JSON.stringify(invalid)}`,
        mutate: (value) => { value[field][0][0] = invalid; }, expected: /9x10/ });
    }
  }
  for (const fixture of cases) await context.test(fixture.name, async (subtest) => {
    subtest.mock.method(globalThis, "fetch", async (input: string) => {
      const response = await diskFetch(input);
      if (input !== "/assets/generated/data/damage-matrix.json") return response;
      const value = await response.json();
      fixture.mutate(value);
      return Response.json(value);
    });
    await assert.rejects(loadCampaignMission("human"), fixture.expected);
  });
});