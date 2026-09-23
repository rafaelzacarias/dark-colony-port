import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { default: playwright } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js").href);
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE
  ?? join(homedir(), "Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium") });
const directory = await mkdtemp(join(tmpdir(), "dc-construction-browser-"));
const report = { directory, scope: "Actual main CONTINUE, source rendering and user construction UI; funded control is synthetic", screens: [], errors: [] };
const deadline = setTimeout(() => { void browser.close(); }, 90000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => report.errors.push(error.message));
  await page.goto(process.env.LIVE_QA_URL ?? "http://127.0.0.1:5173/");
  await page.getByRole("heading", { name: "Choose a mission", exact: true }).waitFor();
  async function prepare(enabled, funded) {
    await page.evaluate(async ({ enabled, funded }) => {
      const { loadCampaignMission } = await import("/src/game-data.ts");
      const { MissionView } = await import("/src/mission-view.ts");
      const { writeMissionSave } = await import("/src/mission-save.ts");
      const mission = await loadCampaignMission("alien", 10, "browser-adapted", enabled ? { completionVisits: 120 } : undefined);
      const canvas = document.createElement("canvas");
      const view = new MissionView(canvas, document.createElement("div"), { onStats() {}, onUnitsChanged() {} }, mission);
      view.update(0);
      view.update(50);
      if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
      const checkpoint = view.checkpoint();
      if (funded) {
        const node = mission.browserEconomy.nodes.find(node => node.amount >= 2500);
        checkpoint.economy.earned[0] = 2500;
        checkpoint.economy.remaining[node.key] -= 2500;
      }
      await writeMissionSave({ version: 1, faction: "alien", missionNumber: 10, savedAt: new Date().toISOString(), checkpoint });
      view.dispose();
    }, { enabled, funded });
    await page.reload();
    await page.getByRole("button", { name: "CONTINUE ALIEN 10", exact: true }).click();
    await page.locator("#mission-shell:not([hidden])").waitFor();
  }
  await prepare(false, false);
  assert.equal(await page.locator("#mission-construction").isVisible(), false);
  report.absentOptionPreserved = true;
  await prepare(true, false);
  const buy = page.getByRole("button", { name: "Build central base", exact: true });
  await buy.waitFor();
  assert.equal(await buy.isDisabled(), true);
  assert.match(await page.locator("#mission-construction").innerText(), /COST 2000 PETRA/);
  assert.match(await page.locator("#mission-construction").innerText(), /500 PETRA short/);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const panel = document.querySelector("#mission-construction");
      const bounds = panel.getBoundingClientRect();
      const commands = document.querySelector(".legacy-command-grid").getBoundingClientRect();
      const canvas = document.querySelector("#mission-canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset + 3] && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 80) colored++;
      return { width: innerWidth, height: innerHeight, bounds: bounds.toJSON(), commandTop: commands.top, colored,
        textFits: [...panel.querySelectorAll("span,strong,button")].every(element => element.scrollWidth <= element.clientWidth + 1),
        overflow: document.documentElement.scrollWidth > innerWidth, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight };
    });
    assert.ok(layout.colored > 1000, "Source game canvas is nonblank");
    assert.ok(layout.bounds.left >= 0 && layout.bounds.right <= viewport.width + 1);
    assert.ok(layout.bounds.bottom <= layout.commandTop + 1, "Construction must not overlap command buttons");
    assert.equal(layout.textFits, true);
    assert.equal(layout.overflow, false);
    report.screens.push(layout);
    await page.screenshot({ path: join(directory, `alien10-unfunded-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(true, true);
  await page.waitForFunction(() => !document.querySelector("[data-construction-buy]").disabled);
  await buy.click();
  await page.getByText("Under construction", { exact: true }).waitFor();
  await page.screenshot({ path: join(directory, "alien10-funded-building.png") });
  await page.locator("#mission-construction").waitFor({ state: "hidden" });
  await page.locator("#mission-production:not([hidden])").waitFor();
  assert.equal(await page.locator('[data-production-buy="21"]').isDisabled(), false);
  await page.locator("#save-mission").click();
  await page.getByText("SAVED", { exact: true }).waitFor();
  report.saved = await page.evaluate(async () => {
    const { readMissionSave } = await import("/src/mission-save.ts");
    const saved = await readMissionSave();
    const state = saved.checkpoint.session.state;
    return { construction: state.browserConstruction, credits: state.world.exomoney[0],
      staticCount: saved.checkpoint.state.bindings.filter(binding => binding.slot === 0).length,
      health: state.world.buildingSlots["0,0"], accounting: state.production.teams[0].costAccumulator };
  });
  assert.equal(report.saved.construction.phase, "ready");
  assert.equal(report.saved.credits, 2000);
  assert.equal(report.saved.staticCount, 1);
  assert.equal(report.saved.health, 4800);
  assert.equal(report.saved.accounting, 2000);
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