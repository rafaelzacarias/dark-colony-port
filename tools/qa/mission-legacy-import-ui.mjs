import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js";
const executablePath = process.env.CHROMIUM_EXECUTABLE
  ?? join(homedir(), "Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium");
const { default: playwright } = await import(pathToFileURL(modulePath).href);
const directory = await mkdtemp(join(tmpdir(), "dc-legacy-import-ui-"));
const report = { directory, checks: [], errors: [], scope: "Real main UI, controlled H05 tick-2 legacy fixture; isolated IndexedDB" };
const browser = await playwright.chromium.launch({ executablePath, headless: true });
const deadline = setTimeout(() => { void browser.close(); }, 180000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => report.errors.push(error.message));
  const url = process.env.LIVE_QA_URL ?? "http://127.0.0.1:5173/";
  const rawSave = () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("dark-colony-mission-save", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("missions", "readonly");
        const request = transaction.objectStore("missions").get("latest");
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  await page.goto(url);
  await page.locator("[data-campaign-faction]").first().waitFor();
  await page.evaluate(async () => {
    const { loadCampaignMission } = await import("/src/game-data.ts");
    const { MissionView } = await import("/src/mission-view.ts");
    const { writeMissionSave } = await import("/src/mission-save.ts");
    const mission = await loadCampaignMission("human", 5, "browser-adapted");
    const view = new MissionView(document.createElement("canvas"), document.createElement("div"),
      { onStats() {}, onUnitsChanged() {} }, mission);
    try {
      view.update(0); view.update(50); view.update(100);
      if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
      const checkpoint = view.checkpoint();
      delete checkpoint.session.replayPolicy;
      for (let team = 0; team < 8; team++) {
        checkpoint.session.state.world.statistics[`${team},6`] = 0;
        checkpoint.session.state.controller.runtime.statistics[`${team},6`] = 0;
      }
      await writeMissionSave({ version: 1, faction: "human", missionNumber: 5,
        savedAt: "2026-09-23T00:00:00.000Z", checkpoint, controlGroups: Array.from({ length: 10 }, () => []) });
    } finally { view.dispose(); }
  });
  const original = await rawSave();
  const continueSaved = async () => {
    await page.reload();
    await page.getByRole("button", { name: "CONTINUE HUMAN 05", exact: true }).click();
    await page.locator("#mission-result:not([hidden])").waitFor();
    await page.getByRole("button", { name: "Import legacy save", exact: true }).waitFor();
  };
  await continueSaved();
  assert.match(await page.locator("#mission-result-detail").innerText(), /complete source caller replay/);
  assert.equal(await rawSave(), original);
  report.checks.push("strict restore fails; original raw IndexedDB value unchanged");
  page.once("dialog", async dialog => {
    report.cancelWarning = dialog.message();
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Import legacy save", exact: true }).click();
  assert.match(report.cancelWarning, /acknowledge this ambiguity/);
  assert.equal(await rawSave(), original);
  assert.equal(await page.locator("#mission-result").isVisible(), true);
  report.checks.push("cancelled explicit acknowledgement leaves failure view and raw save unchanged");
  await page.screenshot({ path: join(directory, "failure-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.getByRole("button", { name: "Import legacy save", exact: true }).boundingBox();
  assert.ok(bounds && bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: join(directory, "failure-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  page.once("dialog", async dialog => {
    report.acceptWarning = dialog.message();
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Import legacy save", exact: true }).click();
  await page.getByText("IMPORTED / UNSAVED", { exact: true }).waitFor();
  assert.match(report.acceptWarning, /stored save stays unchanged until I choose Save/);
  assert.equal(await rawSave(), original);
  assert.match(await page.locator("#save-mission-status").getAttribute("title"), /Explicit legacy import/);
  report.checks.push("confirmed import succeeds; notice exposed; raw save still unchanged");
  await page.screenshot({ path: join(directory, "imported-unsaved.png") });
  await page.locator("#save-mission").click();
  await page.getByText("SAVED", { exact: true }).waitFor();
  const current = JSON.parse(await rawSave());
  assert.equal(current.checkpoint.session.replayPolicy, "current-population-v1");
  assert.deepEqual(current.controlGroups, JSON.parse(original).controlGroups);
  report.checks.push("only explicit Save replaces storage with current checkpoint and preserved control groups");
  const rejected = JSON.parse(original);
  rejected.checkpoint.session.state.controller.revision++;
  await page.evaluate(async save => {
    const { writeMissionSave } = await import("/src/mission-save.ts");
    await writeMissionSave(save);
  }, rejected);
  const rejectedBytes = await rawSave();
  await continueSaved();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Import legacy save", exact: true }).click();
  await page.locator("#mission-result-detail").filter({ hasText: "legacy-authentication-failed" }).waitFor();
  assert.match(await page.locator("#mission-result-detail").innerText(), /controller.revision/);
  assert.equal(await rawSave(), rejectedBytes);
  assert.equal(await page.locator("#mission-result-action").isVisible(), false);
  report.checks.push("rejected import shows source path; raw save unchanged; no automatic retry");
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}