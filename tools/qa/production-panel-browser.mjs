import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE
  ?? "/tmp/darkcolony-browser-harness-20260918/node_modules/playwright-core/index.js";
const executablePath = process.env.CHROMIUM_EXECUTABLE
  ?? join(homedir(), "Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium");
const { default: playwright } = await import(pathToFileURL(modulePath).href);
const directory = await mkdtemp(join(tmpdir(), "dc-production-browser-"));
const report = { directory, portraits: [], screens: [], errors: [], scope: "Portraits and production UI, not campaign completion" };
const browser = await playwright.chromium.launch({ executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const deadline = setTimeout(() => { void browser.close(); }, 90000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && response.url().includes("/assets/")) {
      report.errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(process.env.LIVE_QA_URL ?? "http://127.0.0.1:5173/");
  await page.getByRole("heading", { name: "Choose a mission", exact: true }).waitFor();
  for (const faction of ["human", "alien"]) {
    const pixels = await page.evaluate(async faction => {
      const { productionPanelReview } = await import("/tools/qa/production-panel.browser.ts");
      window.__productionPortraitQA = await productionPanelReview(faction, 3);
      return window.__productionPortraitQA.pixels;
    }, faction);
    report.portraits.push({ faction, mission: 3, pixels });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(async () => {
        const layout = window.__productionPortraitQA.layout();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return layout;
      });
      assert.deepEqual({ width: layout.width, height: layout.height }, viewport);
      report.screens.push({ faction, ...layout });
      await page.screenshot({ path: join(directory, `${faction}03-${viewport.width}-collector.png`) });
      await page.evaluate(() => {
        const choices = window.__productionPortraitQA.choices;
        choices.scrollTop = choices.scrollHeight;
      });
      await page.screenshot({ path: join(directory, `${faction}03-${viewport.width}-combat.png`) });
    }
    await page.evaluate(() => {
      const review = window.__productionPortraitQA;
      const button = review.choices.querySelector('[data-production-kind="upgrade"] button:not(:disabled)')
        ?? review.choices.querySelector("button:not(:disabled)");
      button.click();
      if (!review.view.productionMenu.some(choice => choice.submitting)) throw new Error("Purchase not submitted");
      if (button.closest("[data-production-choice]").querySelector(".production-queue").textContent !== "PENDING") throw new Error("Pending UI missing");
      review.dispose();
      delete window.__productionPortraitQA;
      if (document.querySelector("[data-production-review]")) throw new Error("Review leaked DOM");
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: /01 Human Mission/ }).click();
  await page.locator("#mission-shell:not([hidden])").waitFor();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const screen = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bounds = document.querySelector("#mission-shell").getBoundingClientRect();
      const canvas = document.querySelector("#mission-canvas");
      const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let offset = 0; offset < rgba.length; offset += 4) {
        if (rgba[offset + 3] && rgba[offset] + rgba[offset + 1] + rgba[offset + 2] > 80) colored += 1;
      }
      return { width: innerWidth, height: innerHeight, bounds: bounds.toJSON(), colored,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(screen.colored > 1000, "Original main screen must contain source artwork");
    assert.ok(screen.bounds.left >= -1 && screen.bounds.right <= viewport.width + 1);
    assert.ok(screen.bounds.top >= -1 && screen.bounds.bottom <= viewport.height + 1);
    assert.equal(screen.overflow, false);
    report.screens.push({ originalMainHuman01: true, ...screen });
    await page.screenshot({ path: join(directory, `original-human01-${viewport.width}.png`) });
  }
  await page.getByRole("button", { name: "MISSIONS", exact: true }).click();
  await page.getByRole("heading", { name: "Choose a mission", exact: true }).waitFor();
  assert.deepEqual(report.errors, []);
  report.cleanLauncher = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}