import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { default: playwright } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js").href);
const directory = await mkdtemp(join(tmpdir(), "dc-fixed-construction-browser-"));
const report = { directory, errors: [], layouts: [] };
const browser = await playwright.chromium.launch({ headless: false,
  executablePath: process.env.CHROMIUM_EXECUTABLE
    ?? join(homedir(), "Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
  args: ["--use-angle=metal"] });
const deadline = setTimeout(() => { void browser.close(); }, 90000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && response.url().includes("/assets/")) report.errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(process.env.LIVE_QA_URL ?? "http://127.0.0.1:5173/");
  await page.getByRole("heading", { name: "Choose a mission", exact: true }).waitFor();
  report.initial = await page.evaluate(async () => {
    const { loadCampaignMission, campaignConstructionPolicy } = await import("/src/game-data.ts");
    const { MissionView } = await import("/src/mission-view.ts");
    const { createConstructionPanel } = await import("/src/ui/construction-panel.ts");
    const mission = await loadCampaignMission("human", 10, "browser-adapted", campaignConstructionPolicy("human", 10, "browser-adapted"));
    const shell = document.querySelector("#mission-shell").cloneNode(true);
    const stage = document.createElement("div");
    stage.dataset.constructionReview = "true";
    stage.style.cssText = "position:fixed;inset:0;z-index:10000;background:#000;overflow:hidden";
    stage.append(shell);
    document.body.append(stage);
    document.documentElement.style.overflow = "hidden";
    shell.hidden = false;
    shell.querySelector("#campaign-controls").hidden = false;
    shell.querySelector(".legacy-portrait").hidden = true;
    shell.querySelector("#mission-base-tabs").hidden = false;
    const canvas = shell.querySelector("#mission-canvas");
    canvas.hidden = false;
    const view = new MissionView(canvas, stage, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    if (view.missionDiagnostic) throw Error(view.missionDiagnostic);
    const region = shell.querySelector("#mission-construction");
    region.replaceChildren();
    const panel = createConstructionPanel(region, () => true);
    panel.render(view);
    const resize = () => { shell.style.transform = `translate(-50%, -50%) scale(${Math.min(stage.clientWidth / 640, stage.clientHeight / 480)})`; };
    resize();
    window.addEventListener("resize", resize);
    window.__constructionQA = { view, region, panel, shell, stage, resize };
    return { credits: view.resourceWorkflow.credits[0], choices: view.constructionMenu };
  });
  assert.equal(report.initial.choices.length, 4);
  assert.equal(report.initial.choices.find(choice => choice.slot === 4).requestEnabled, false);
  const review = page.locator("[data-construction-review]");
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    report.layouts.push(await page.evaluate(() => {
      const { region, shell, resize } = window.__constructionQA;
      resize();
      const choices = region.querySelector(".construction-choices");
      const rows = [...choices.children];
      for (const element of region.querySelectorAll("strong,span,button")) {
        if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) throw Error(`Text overflow: ${element.textContent}`);
      }
      choices.scrollTop = choices.scrollHeight;
      const last = rows.at(-1).getBoundingClientRect();
      const bounds = choices.getBoundingClientRect();
      if (last.bottom > bounds.bottom + 1 || last.top < bounds.top - 1) throw Error("Last choice unreachable");
      if (region.getBoundingClientRect().bottom > shell.querySelector(".legacy-command-grid").getBoundingClientRect().top + 1) throw Error("Commands overlap");
      if (choices.scrollWidth > choices.clientWidth) throw Error("Horizontal list overflow");
      const canvas = shell.querySelector("canvas#mission-canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 80) colored++;
      if (colored < 1000) throw Error("Blank mission art");
      return { width: innerWidth, height: innerHeight, colored, scrollHeight: choices.scrollHeight, listHeight: choices.clientHeight, overlaps: false };
    }));
    await page.screenshot({ path: join(directory, `construction-${viewport.width}.png`) });
  }
  await review.getByRole("button", { name: "Build science laboratory", exact: true }).click();
  assert.match(await review.locator('[data-construction-choice="2"] .construction-state').textContent(), /queued/i);
  report.purchase = await page.evaluate(() => {
    const { view, panel } = window.__constructionQA;
    view.resetClock(); view.update(0); view.update(50); panel.render(view);
    if (view.missionDiagnostic) throw Error(view.missionDiagnostic);
    return { credits: view.resourceWorkflow.credits[0], slot: view.campaignSnapshot.browserConstruction.slots[3],
      bindings: view.nativeBindings.filter(binding => binding.slot === 3).length };
  });
  assert.equal(report.purchase.credits, report.initial.credits - 2000);
  assert.equal(report.purchase.slot.phase, "building");
  assert.equal(report.purchase.bindings, 1);
  assert.equal(await review.getByRole("button", { name: "Build science laboratory", exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(directory, "construction-paid-mobile.png") });
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