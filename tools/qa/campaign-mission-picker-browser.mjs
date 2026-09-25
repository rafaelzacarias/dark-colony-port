import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { default: playwright } = await import(process.env.PLAYWRIGHT_MODULE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js");
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const output = await mkdtemp(artifacts + "campaign-picker-");
const browser = await playwright.chromium.connectOverCDP(process.env.DC_BROWSER_CDP ?? "http://127.0.0.1:9333");
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const report = { output, errors: [], layouts: [], missions: [], clock: "Controlled normal MissionView updates; not an FPS test" };
const deadline = setTimeout(() => void context.close(), 240000);
try {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("dialog", dialog => {
    if (/^Return to the main menu|^Overwrite save slot/.test(dialog.message())) void dialog.accept();
    else { report.errors.push(`Unexpected dialog: ${dialog.message()}`); void dialog.dismiss(); }
  });
  await page.goto(process.env.DC_BROWSER_URL ?? "http://127.0.0.1:5173/");
  await page.locator("#campaign-launcher").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(async () => (await import("/src/mission-save.ts")).readMissionSave()), null);
  assert.equal(await page.locator("#campaign-mission-select").inputValue(), "1");
  assert.equal(await page.locator("#campaign-mission-profile").textContent(), "SOURCE STRICT");
  assert.equal(await page.locator("#campaign-launcher [data-campaign-faction]").count(), 2);
  await page.evaluate(async () => {
    const main = [...document.scripts].find(script => /\/src\/main\.ts/.test(script.src));
    const source = await (await fetch(main.src)).text();
    const path = source.match(/from\s+["']([^"']*\/mission-view\.ts[^"']*)["']/)?.[1];
    if (!path) throw Error("Actual MissionView import not found");
    const { MissionView } = await import(path);
    const probe = window.__pickerQA = { view: null, update: MissionView.prototype.update, reset: MissionView.prototype.resetClock };
    MissionView.prototype.update = function () { probe.view = this; };
    MissionView.prototype.resetClock = function () { probe.view = this; return probe.reset.call(this); };
  });
  const readSave = () => page.evaluate(async () => (await import("/src/mission-save.ts")).readMissionSave());
  const layout = async name => {
    const data = await page.evaluate(() => {
      const host = document.querySelector("#campaign-launcher");
      const rect = element => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      };
      const controls = [...host.querySelectorAll("select, button, fieldset label")]
        .filter(element => !element.hidden && element.getClientRects().length).map(rect);
      return { viewport: innerWidth, width: document.documentElement.scrollWidth, host: rect(host), controls,
        portraits: [...host.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0) };
    });
    assert.ok(data.width <= data.viewport, JSON.stringify(data));
    assert.equal(data.portraits, true);
    for (const control of data.controls) {
      assert.ok(control.left >= data.host.left && control.right <= data.host.right, JSON.stringify(data));
      assert.ok(control.top >= data.host.top && control.bottom <= data.host.bottom, JSON.stringify(data));
    }
    for (let first = 0; first < data.controls.length; first += 1) {
      for (let second = first + 1; second < data.controls.length; second += 1) {
        const left = data.controls[first], right = data.controls[second];
        assert.ok(Math.min(left.right, right.right) - Math.max(left.left, right.left) <= 1
          || Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) <= 1, "Launcher controls overlap");
      }
    }
    report.layouts.push({ name, ...data });
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  };
  await layout("launcher-desktop");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await layout(`launcher-mobile-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  let saved;
  for (const [faction, number, sourceId] of [["human", "7", "HUMAN07"], ["alien", "15", "ALIEN15"]]) {
    await page.locator('[data-menu-open="new"]').click();
    if (!await page.locator(".mission-select-details").evaluate(details => details.open)) {
      await page.locator(".mission-select-details summary").click();
    }
    await page.locator(`input[name="mission-picker-faction"][value="${faction}"]`).check();
    const options = await page.locator("#campaign-mission-select option").allTextContents();
    assert.deepEqual(options, Array.from({ length: 15 }, (_, index) => `${faction.toUpperCase()}${String(index + 1).padStart(2, "0")}`));
    await page.locator("#campaign-mission-select").selectOption(number);
    assert.equal(await page.locator("#campaign-mission-profile").textContent(), "BROWSER ADAPTED");
    await page.getByRole("button", { name: `Launch ${sourceId}`, exact: true }).click();
    await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 90000 });
    const loaded = await page.evaluate(() => {
      const probe = window.__pickerQA;
      probe.reset.call(probe.view);
      for (let tick = 0; tick <= 4; tick += 1) probe.update.call(probe.view, tick * 50);
      probe.view.render();
      const canvas = document.querySelector("#mission-canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 80) colored++;
      const checkpoint = probe.view.checkpoint();
      return { source: probe.view.mission.scenario.source.path, diagnostic: probe.view.missionDiagnostic ?? null,
        profile: checkpoint.session.options.runtimeProfile, construction: checkpoint.session.options.browserConstruction,
        colored, tick: probe.view.simulation.snapshot.tick };
    });
    assert.match(loaded.source, new RegExp(`${sourceId}\\.SCN$`));
    assert.equal(loaded.diagnostic, null);
    assert.equal(loaded.profile, "browser-adapted");
    assert.equal(loaded.construction.policy.completionVisits, 120);
    assert.deepEqual(loaded.construction.supportedSlots, [1, 2, 3, 4]);
    assert.ok(loaded.colored > 1000);
    report.missions.push({ sourceId, ...loaded });
    await page.screenshot({ path: `${output}/${sourceId.toLowerCase()}-desktop.png` });
    if (faction === "human") {
      await page.locator('[data-original-tab="options"]').click();
      await page.locator("#save-mission").click();
      await page.locator('[data-save-slot="slot-1"]').click();
      await page.waitForFunction(() => document.querySelector("#save-mission-status").textContent === "SAVED");
      saved = await readSave();
      assert.equal(saved.missionNumber, 7);
    } else {
      assert.deepEqual(await readSave(), saved);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${output}/alien15-mobile.png`, fullPage: true });
    }
    await page.locator('[data-original-tab="options"]').click();
    await page.locator("#exit-campaign").click();
    await page.locator("#campaign-launcher").waitFor({ state: "visible" });
    assert.equal(await page.locator("#campaign-mission-select").inputValue(), number);
  }
  await page.locator("#continue-mission").waitFor({ state: "visible" });
  assert.equal(await page.locator("#continue-mission").textContent(), "CONTINUE HUMAN 07");
  await layout("launcher-mobile-continue");
  await page.locator("#continue-mission").click();
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 90000 });
  const restored = await page.evaluate(() => window.__pickerQA.view.checkpoint());
  assert.deepEqual(restored, saved.checkpoint);
  assert.deepEqual(await readSave(), saved);
  report.continueExact = true;
  await page.locator('[data-original-tab="options"]').click();
  await page.locator("#exit-campaign").click();
  await page.locator('[data-menu-open="new"]').click();
  await page.locator('#campaign-launcher [data-campaign-faction="alien"]').click();
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 90000 });
  const quickStart = await page.evaluate(() => ({ source: window.__pickerQA.view.mission.scenario.source.path,
    profile: window.__pickerQA.view.checkpoint().session.options.runtimeProfile }));
  assert.match(quickStart.source, /ALIEN01\.SCN$/);
  assert.equal(quickStart.profile, undefined);
  assert.deepEqual(await readSave(), saved);
  report.quickStart = quickStart;
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  console.log(JSON.stringify(report));
}