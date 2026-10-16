import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseMissionBriefing } from "../extractors/data/briefing";
import { introVisibleCharacters, reduceCampaignIntro, shouldShowCampaignIntro,
  campaignIntroTokens, campaignIntroDataPath, missionBriefingVoicePath,
  showCampaignIntro, cancelCampaignIntro, type IntroState } from "../../src/ui/campaign-intro";

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
  assert.equal(shouldShowCampaignIntro("alien", 1, "fresh", undefined, { allowAlien: true }), true);
  assert.equal(shouldShowCampaignIntro("alien", 2, "fresh", undefined, { allowAlien: true }), false);
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

test("alien intro assets: exact ASTORY/GSCENE source hashes, ALIEN01 briefing, ACOM/GLOBEG/SGREYE crops", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  assert.equal(campaignIntroDataPath("human"), "/assets/data/campaign-intro-human.json");
  assert.equal(campaignIntroDataPath("alien"), "/assets/data/campaign-intro-alien.json");
  const asset = JSON.parse(read(`public${campaignIntroDataPath("alien")}`).toString());
  assert.equal(asset.source.path, "raw_cd/DC/INTRFACE/ASTORY.TXT");
  const source = read(asset.source.path);
  assert.equal(createHash("sha256").update(source).digest("hex"), asset.source.sha256);
  assert.deepEqual(asset.tokens, campaignIntroTokens(source.toString()));
  assert.equal(asset.tokens.map((token: { text: string }) => token.text).join(""), parseMissionBriefing(source.toString()).plainText);
  const scene = read(asset.scene.source);
  assert.equal(createHash("sha256").update(scene).digest("hex"), asset.scene.sha256);
  assert.match(scene.toString(), new RegExp(`alien/alien01.scn\\r?\\n${asset.scene.title}\\r?\\n${asset.scene.location}`));
  assert.equal(asset.scene.title, "FIRST STRIKE");
  assert.equal(asset.scene.location, "CYDONIA REGION");
  assert.equal(asset.scene.speaker, "SUPREME OVERLORD");
  const briefing = JSON.parse(read(`public${asset.scene.briefing}`).toString());
  assert.equal(briefing.source.sha256, asset.scene.briefingSourceSha256);
  assert.equal(createHash("sha256").update(read(`raw_cd/DC/SCENARIO/${briefing.source.path}`)).digest("hex"), briefing.source.sha256);
  assert.equal(campaignIntroTokens(briefing.rawText).map((token) => token.text).join(""), briefing.plainText);
  assert.match(briefing.plainText, /MIND LINK BROKEN/);
  for (const art of [asset.art.portrait, asset.art.globe, asset.art.strip]) {
    const metadataPath = art.metadata ?? art.atlas.replace(/\.png$/, ".json");
    const metadata = JSON.parse(read(`public${metadataPath}`).toString());
    const frameIndex = art.frameIndex ?? art.frame;
    const frame = metadata.frames[frameIndex];
    assert.equal(frame.empty, false);
    assert.deepEqual([frame.x, frame.y, frame.width, frame.height], art.crop);
    assert.ok(read(`public${art.atlas}`).length > 0);
  }
  assert.equal(asset.art.portrait.frameIndex, 0);
  assert.equal(asset.art.globe.frameIndex, 0);
  assert.equal(asset.art.strip.frameIndex, 0);
  assert.ok(read(`public${asset.art.overview}`).length > 0);
  assert.ok(read(`public${asset.art.briefing}`).length > 0);
});

test("mission briefing voiceover paths cover all 30 missions (H1..H15.ogg and G1..G15.ogg on disk)", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  for (let missionNumber = 1; missionNumber <= 15; missionNumber += 1) {
    const humanPath = missionBriefingVoicePath("human", missionNumber);
    const alienPath = missionBriefingVoicePath("alien", missionNumber);
    assert.equal(humanPath, `/assets/generated/media/audio/MISSION/H${missionNumber}.ogg`);
    assert.equal(alienPath, `/assets/generated/media/audio/MISSION/G${missionNumber}.ogg`);
    assert.ok(read(`public${humanPath}`).length > 0);
    assert.ok(read(`public${alienPath}`).length > 0);
  }
  assert.throws(() => missionBriefingVoicePath("human", 0), RangeError);
  assert.throws(() => missionBriefingVoicePath("alien", 16), RangeError);
});

test("showCampaignIntro plays briefing voiceover on briefing stage and cleans up audio on exit", async () => {
  const alienAsset = JSON.parse(readFileSync(new URL("../../public/assets/data/campaign-intro-alien.json", import.meta.url), "utf8"));
  const alienBriefing = JSON.parse(readFileSync(new URL("../../public/assets/generated/data/briefings/ALIEN/ALIEN01.json", import.meta.url), "utf8"));
  class StubElement extends EventTarget {
    readonly children: StubElement[] = [];
    readonly selectors = new Map<string, StubElement>();
    readonly attributes = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    className = "";
    innerHTML = "";
    textContent = "";
    scrollTop = 0;
    clientHeight = 100;
    scrollHeight = 100;
    isConnected = true;
    constructor(readonly tagName = "DIV") { super(); }
    append(...children: StubElement[]) { this.children.push(...children); }
    appendChild(child: StubElement) { this.append(child); return child; }
    replaceChildren(...children: StubElement[]) { this.children.length = 0; this.append(...children); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    querySelector(selector: string): StubElement {
      if (!this.selectors.has(selector)) {
        const button = selector.match(/data-intro-action="(\w+)"/);
        const element = new StubElement(button ? "BUTTON" : "DIV");
        if (button) element.dataset.introAction = button[1];
        this.selectors.set(selector, element);
      }
      return this.selectors.get(selector)!;
    }
    querySelectorAll() { return []; }
    closest() { return this.tagName === "BUTTON" ? this : null; }
    showModal() {}
    close() {}
    remove() { this.isConnected = false; }
    focus() {}
  }
  const createdAudio: Array<{ src: string; playCalls: number; pauseCalls: number }> = [];
  class StubAudio {
    playCalls = 0;
    pauseCalls = 0;
    constructor(public src = "") {
      createdAudio.push(this);
    }
    play() {
      this.playCalls += 1;
      return Promise.reject(new Error("Autoplay blocked"));
    }
    pause() {
      this.pauseCalls += 1;
    }
    removeAttribute() {}
    load() {}
  }
  const body = new StubElement("BODY");
  const windowStub = Object.assign(new EventTarget(), { getSelection: () => null, Audio: StubAudio });
  let fetchedUrl = "";
  const globals: Record<string, unknown> = {
    HTMLElement: StubElement,
    Audio: StubAudio,
    document: {
      body, activeElement: new StubElement("BUTTON"),
      createElement: (tag: string) => new StubElement(tag.toUpperCase()),
      createElementNS: (_ns: string, tag: string) => new StubElement(tag.toUpperCase()),
      createTextNode: (text: string) => Object.assign(new StubElement("TEXT"), { textContent: text }),
    },
    window: windowStub,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    fetch: async (url: string) => {
      fetchedUrl = url;
      return { ok: true, json: async () => alienAsset };
    },
  };
  const descriptors = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try {
    const pending = showCampaignIntro({
      faction: "alien",
      missionNumber: 1,
      briefing: alienBriefing,
      isCurrent: () => true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetchedUrl, "/assets/data/campaign-intro-alien.json");
    const dialog = body.children[0];
    const scene = dialog.querySelector(".campaign-intro-scene");
    assert.equal(dialog.attributes.get("aria-label"), "Alien campaign predeployment");
    assert.equal(dialog.querySelector(".campaign-intro-speaker").textContent, "SUPREME OVERLORD");
    assert.equal(createdAudio.length, 0);
    const click = () => {
      const event = new Event("click", { cancelable: true });
      Object.defineProperty(event, "target", { value: scene });
      dialog.dispatchEvent(event);
    };
    click();
    click();
    assert.equal(scene.dataset.stage, "briefing");
    assert.equal(createdAudio.length, 1);
    assert.equal(createdAudio[0].playCalls, 1);
    click();
    click();
    assert.equal(await pending, "deploy");
    assert.ok(createdAudio[0].pauseCalls >= 1);
  } finally {
    cancelCampaignIntro();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});