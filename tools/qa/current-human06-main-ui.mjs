import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import playwright from "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js";

const root = "/tmp/dc-current-human06-20260923-1790171065933/human/";
const pending = JSON.parse(await readFile(root + "pending-win.json", "utf8"));
const ready = JSON.parse(await readFile(root + "checkpoint.json", "utf8"));
const proof = JSON.parse(await readFile(root + "proof.json", "utf8"));
const directory = await mkdtemp("/tmp/dc-h06-main-ui-");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const withoutRenderAnimations = value => {
  const copy = structuredClone(value);
  delete copy.state.animationStates;
  return copy;
};
const report = { directory, started: new Date().toISOString(), errors: [], stages: [], layouts: [] };
const browser = await playwright.chromium.connectOverCDP("http://127.0.0.1:9333");
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const deadline = setTimeout(() => void context.close(), 240000);
let page;
const record = async (name, data) => {
  report.stages.push({ name, data, time: new Date().toISOString() });
  await writeFile(directory + "/report.json", JSON.stringify(report, null, 2));
  console.log(name);
};
try {
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("dialog", dialog => {
    if (/^Overwrite save slot|^Return to the main menu/.test(dialog.message())) void dialog.accept();
    else { report.errors.push("Unexpected dialog: " + dialog.message()); void dialog.dismiss(); }
  });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#campaign-launcher").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(async () => (await import("/src/mission-save.ts")).readMissionSave()), null);
  await page.evaluate(async checkpoint => {
    const { writeMissionSave } = await import("/src/mission-save.ts");
    await writeMissionSave({ version: 1, faction: "human", missionNumber: 6,
      savedAt: new Date().toISOString(), checkpoint });
  }, pending.view);
  await page.reload();
  await page.locator("#continue-mission").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    const main = [...document.scripts].find(script => /\/src\/main\.ts/.test(script.src));
    const text = await (await fetch(main.src)).text();
    const modulePath = text.match(/from\s+["']([^"']*\/mission-view\.ts[^"']*)["']/)?.[1];
    if (!modulePath) throw Error("Cannot resolve actual main MissionView import");
    const { MissionView } = await import(modulePath);
    const update = MissionView.prototype.update;
    const reset = MissionView.prototype.resetClock;
    const probe = window.__h06MainQA = { view: null, update, reset, time: 0, updates: 0 };
    MissionView.prototype.resetClock = function () { probe.view = this; probe.time = 0; return reset.call(this); };
    MissionView.prototype.update = function () { probe.view = this; };
  });
  await page.locator("#continue-mission").click();
  await page.locator("#mission-shell").waitFor({ state: "visible", timeout: 90000 });
  const restored = await page.evaluate(() => window.__h06MainQA.view.checkpoint());
  assert.deepEqual(withoutRenderAnimations(restored), withoutRenderAnimations(pending.view));
  await record("Continue restored genuine pending H06; only render animation state differs", { hash: hash(restored), outcome: restored.state.outcome,
    renderedAnimations: restored.state.animationStates, inputAnimations: pending.view.state.animationStates });
  await page.evaluate(() => {
    const probe = window.__h06MainQA;
    probe.reset.call(probe.view);
    probe.update.call(probe.view, 0);
    for (let index = 0; index < 201; index++) {
      probe.time += 50;
      probe.update.call(probe.view, probe.time);
      probe.updates++;
      if (probe.view.missionDiagnostic) throw Error(probe.view.missionDiagnostic);
    }
  });
  const final = await page.evaluate(() => window.__h06MainQA.view.checkpoint());
  assert.deepEqual(withoutRenderAnimations(final), withoutRenderAnimations(ready.view));
  assert.equal(hash(ready.view), proof.expectedHash);
  assert.equal(await page.locator("#mission-result-title").textContent(), "MISSION COMPLETE");
  assert.equal(await page.locator("#mission-result-action").textContent(), "NEXT MISSION");
  await page.screenshot({ path: directory + "/h06-victory-desktop.png" });
  await record("201 normal updates reached ready WIN and main result controls", { hash: hash(final), nodeProofHash: proof.expectedHash,
    exactExceptRenderAnimations: true, outcome: final.state.outcome });
  await page.locator("#mission-result-action").click();
  await page.waitForFunction(() => !document.querySelector("#mission-shell").hidden && window.__h06MainQA.view?.mission?.scenario?.source?.path?.includes("HUMAN07"), { timeout: 60000 });
  const launched = await page.evaluate(() => {
    const probe = window.__h06MainQA;
    probe.update.call(probe.view, 0);
    return { label: document.querySelector("#campaign-faction").textContent,
      source: probe.view.mission.scenario.source.path, checkpoint: probe.view.checkpoint(),
      construction: probe.view.constructionMenu, diagnostic: probe.view.missionDiagnostic ?? null };
  });
  assert.equal(launched.label, "HUMAN");
  assert.match(launched.source, /HUMAN07/);
  assert.equal(launched.diagnostic, null);
  assert.ok(launched.construction.length > 0);
  await record("Main NEXT MISSION loaded original H07 with construction", { ...launched, checkpoint: hash(launched.checkpoint) });
  await page.locator('[data-original-tab="options"]').click();
  await page.locator("#save-mission").click();
  await page.locator('[data-save-slot="slot-1"]').click();
  await page.waitForFunction(() => document.querySelector("#save-mission-status").textContent === "SAVED");
  const saved = await page.evaluate(async () => (await import("/src/mission-save.ts")).readMissionSave());
  assert.equal(saved.missionNumber, 7);
  assert.deepEqual(saved.checkpoint, launched.checkpoint);
  await page.locator("#exit-campaign").click();
  await page.reload();
  await page.locator("#continue-mission").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    const main = [...document.scripts].find(script => /\/src\/main\.ts/.test(script.src));
    const text = await (await fetch(main.src)).text();
    const modulePath = text.match(/from\s+["']([^"']*\/mission-view\.ts[^"']*)["']/)[1];
    const { MissionView } = await import(modulePath);
    const update = MissionView.prototype.update;
    const reset = MissionView.prototype.resetClock;
    const probe = window.__h06MainQA = { view: null, update, reset, time: 0 };
    MissionView.prototype.resetClock = function () { probe.view = this; return reset.call(this); };
    MissionView.prototype.update = function () { probe.view = this; };
  });
  await page.locator("#continue-mission").click();
  await page.locator("#mission-shell").waitFor({ state: "visible", timeout: 60000 });
  const loaded = await page.evaluate(() => window.__h06MainQA.view.checkpoint());
  assert.deepEqual(loaded, saved.checkpoint);
  await record("H07 UI Save, Exit, page reload, Continue exact", { hash: hash(loaded), label: await page.locator("#campaign-faction").textContent() });
  await page.locator("#select-all-units").click();
  const interaction = await page.evaluate(() => {
    const probe = window.__h06MainQA;
    probe.reset.call(probe.view); probe.update.call(probe.view, 0);
    for (let index = 1; index <= 100; index++) probe.update.call(probe.view, index * 50);
    return { selected: document.querySelector("#campaign-selection").textContent,
      diagnostic: probe.view.missionDiagnostic ?? null, tick: probe.view.simulation.snapshot.tick };
  });
  await page.locator("#select-all-units").click();
  interaction.selectedAfterDelivery = await page.locator("#campaign-selection").textContent();
  assert.equal(interaction.diagnostic, null);
  assert.match(interaction.selectedAfterDelivery, /^[1-9]\d* SELECTED$/);
  await record("Reloaded H07 interactive and 100 normal updates", interaction);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => {
      window.__h06MainQA.view.render();
      const canvas = document.querySelector("#mission-canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 80) colored++;
      const bounds = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const shell = bounds("#mission-shell");
      const visibleImport = [...document.querySelectorAll("button,[role=status]")].filter(element => /import/i.test(element.textContent) && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden").map(element => element.textContent);
      return { viewport: { width: innerWidth, height: innerHeight }, colored, shell,
        canvas: bounds("#mission-canvas"), save: bounds("#save-mission"), exit: bounds("#exit-campaign"),
        visibleImport, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(layout.colored > 1000);
    assert.equal(layout.visibleImport.length, 0);
    assert.ok(layout.shell.x >= -1 && layout.shell.right <= viewport.width + 1);
    assert.ok(layout.shell.y >= -1 && layout.shell.bottom <= viewport.height + 1);
    assert.ok(layout.save.bottom <= layout.canvas.y + 1 || layout.save.x >= layout.canvas.right - 1 || layout.save.right <= layout.canvas.x + 1 || layout.save.y >= layout.canvas.bottom - 1);
    report.layouts.push(layout);
    await page.screenshot({ path: directory + `/h07-${viewport.width}.png` });
  }
  assert.deepEqual(report.errors, []);
  report.result = "PASS";
} catch (error) {
  report.result = "FAIL";
  report.failure = error.stack ?? String(error);
  if (page && !page.isClosed()) {
    report.ui = await page.locator("body").innerText().catch(() => "unavailable");
    await page.screenshot({ path: directory + "/failure.png", timeout: 5000 }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await context.close();
  report.isolatedContextClosed = true;
  report.finished = new Date().toISOString();
  await writeFile(directory + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
process.exit(process.exitCode ?? 0);