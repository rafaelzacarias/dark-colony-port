import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseMissionBriefing } from "../extractors/data/briefing";
import { introVisibleCharacters, reduceCampaignIntro, shouldShowCampaignIntro,
  campaignIntroTokens, type IntroState } from "../../src/ui/campaign-intro";

test("intro fake clock: wall time, finish then advance, terminal actions", () => {
  let state: IntroState = { stage: "overview", startedAt: 100, complete: false };
  assert.equal(introVisibleCharacters(state, 1100, 200), 35);
  assert.equal(introVisibleCharacters(state, 0, 200), 0);
  state = reduceCampaignIntro(state, "advance", 1100, 200);
  assert.equal(state.stage, "overview");
  assert.equal(introVisibleCharacters(state, 1100, 200), 200);
  state = reduceCampaignIntro(state, "advance", 1100, 200);
  assert.equal(state.stage, "briefing");
  assert.equal(introVisibleCharacters(state, 1100, 100), 0);
  state = reduceCampaignIntro(state, "advance", 5100, 100);
  assert.equal(state.stage, "deploy");
  assert.equal(reduceCampaignIntro(state, "cancel", 5100, 100), state);
  assert.equal(reduceCampaignIntro({ ...state, stage: "overview" }, "skip", 0, 100).stage, "deploy");
  assert.equal(reduceCampaignIntro({ ...state, stage: "briefing" }, "cancel", 0, 100).stage, "cancel");
});

test("intro gate: only fresh HUMAN01, never saves, imports, retries or later missions", () => {
  assert.equal(shouldShowCampaignIntro("human", 1, "fresh"), true);
  for (const reason of ["continue", "import", "retry", "next"] as const) {
    assert.equal(shouldShowCampaignIntro("human", 1, reason), false);
  }
  assert.equal(shouldShowCampaignIntro("human", 1, "fresh", {}), false);
  assert.equal(shouldShowCampaignIntro("alien", 1, "fresh"), false);
  assert.equal(shouldShowCampaignIntro("human", 2, "fresh"), false);
});

test("intro assets: exact source hash, complete parser text, literal title and verified nonempty crops", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const asset = JSON.parse(read("public/assets/data/campaign-intro-human.json").toString());
  const source = read(asset.source.path);
  assert.equal(createHash("sha256").update(source).digest("hex"), asset.source.sha256);
  assert.deepEqual(asset.tokens, campaignIntroTokens(source.toString()));
  assert.equal(asset.tokens.map((token: { text: string }) => token.text).join(""), parseMissionBriefing(source.toString()).plainText);
  const scene = read(asset.scene.source);
  assert.equal(createHash("sha256").update(scene).digest("hex"), asset.scene.sha256);
  assert.match(scene.toString(), new RegExp(`human/human01.scn\\r?\\n${asset.scene.title}\\r?\\n${asset.scene.location}`));
  assert.equal(asset.scene.title, "RED LANDING");
  assert.equal(asset.scene.location, "CHRYSE BASIN");
  const briefing = JSON.parse(read(`public${asset.scene.briefing}`).toString());
  assert.equal(briefing.source.sha256, asset.scene.briefingSourceSha256);
  assert.equal(createHash("sha256").update(read(`raw_cd/DC/SCENARIO/${briefing.source.path}`)).digest("hex"), briefing.source.sha256);
  assert.equal(campaignIntroTokens(briefing.rawText).map((token) => token.text).join(""), briefing.plainText);
  assert.match(briefing.plainText, /TRANSMISSION OUT/);
  for (const art of [asset.art.portrait, asset.art.globe]) {
    const metadata = JSON.parse(read(`public${art.atlas.replace(/\.png$/, ".json")}`).toString());
    const frame = metadata.frames[art.frame];
    assert.equal(frame.empty, false);
    assert.deepEqual([frame.x, frame.y, frame.width, frame.height], art.crop);
    assert.ok(read(`public${art.atlas}`).length > 0);
  }
  assert.equal(asset.art.portrait.frame, 1);
  assert.equal(asset.art.globe.frame, 20);
  assert.ok(read(`public${asset.art.overview}`).length > 0);
  assert.ok(read(`public${asset.art.briefing}`).length > 0);
});