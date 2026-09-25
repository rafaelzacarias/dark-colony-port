// Against an existing dev server. Reuses Playwright/Chromium from the other browser QA tools.
// node tools/qa/mobile-mission-browser.mjs [outputStem] [baseUrl]
// Optional: DC_PLAYWRIGHT_CORE, DC_CHROMIUM.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const out = process.argv[2] ?? `/tmp/dc-mobile-mission-${Date.now()}`;
const base = process.argv[3] ?? "http://127.0.0.1:5173/";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const ipad = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal", "--autoplay-policy=no-user-gesture-required"] });
const report = { gating: [], layouts: [], checks: [], errors: [] };

async function openPage(context) {
  const page = await context.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  // Expose existing module-local state only in this isolated QA page.
  await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      globalThis.__mobileQa = {
        get view() { return skirmish; },
        get entries() { return skirmish instanceof MissionView ? baseMenuEntries(skirmish) : []; },
        get drag() { return missionDragStart; }
      };` });
  });
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.__mobileQa));
  await page.locator("#campaign-launcher").waitFor({ state: "visible" });
  if (await page.locator(".cinematic-player[open]").count()) await page.keyboard.press("Escape");
  return page;
}

async function launch(page) {
  await page.locator('[data-menu-open="new"]').click();
  await page.locator(".mission-select-details summary").click();
  await page.locator('#campaign-mission-picker input[value="human"]').check();
  await page.selectOption("#campaign-mission-picker select", { label: "HUMAN10" });
  await page.locator("[data-mission-launch]").click();
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
}

async function layout(page, label) {
  const result = await page.evaluate(() => {
    const deck = document.querySelector("#mobile-controls").getBoundingClientRect();
    const canvas = document.querySelector("#mission-canvas").getBoundingClientRect();
    const buttons = [...document.querySelectorAll("#mobile-controls button")].map(button => {
      const rect = button.getBoundingClientRect();
      return { action: button.dataset.mobileAction, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    return {
      buttons, viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight + 1,
      overlap: Math.min(deck.right, canvas.right) > Math.max(deck.left, canvas.left) + 1
        && Math.min(deck.bottom, canvas.bottom) > Math.max(deck.top, canvas.top) + 1,
    };
  });
  assert.equal(result.overflow, false, `${label}: viewport overflow`);
  assert.equal(result.overlap, false, `${label}: deck covers battlefield`);
  for (const button of result.buttons) {
    assert.ok(button.width >= 44 && button.height >= 44, `${label}: small ${button.action} target`);
    assert.ok(button.x >= -1 && button.y >= -1 && button.x + button.width <= result.viewport.width + 1
      && button.y + button.height <= result.viewport.height + 1, `${label}: clipped ${button.action}`);
  }
  report.layouts.push({ label, ...result });
  await page.screenshot({ path: `${out}-${label}.png` });
}

try {
  for (const [label, userAgent, hasTouch] of [
    ["desktop", undefined, false],
    ["desktop-small-touch", undefined, true],
    ["ipad", ipad, true],
    ["android-tablet", android.replace(" Mobile", ""), true],
  ]) {
    const context = await browser.newContext({
      viewport: label === "desktop" ? { width: 1280, height: 900 } : { width: 390, height: 844 }, userAgent, hasTouch,
    });
    const page = await openPage(context);
    assert.equal(await page.locator("#mobile-controls").count(), 0, label);
    assert.equal(await page.locator("#mobile-mission-menu").count(), 0, label);
    assert.equal(await page.locator(".phone-controls-enabled").count(), 0, label);
    if (label === "desktop") {
      await launch(page);
      const before = await page.evaluate(() => {
        const view = window.__mobileQa.view;
        view.setCameraCenter(view.grid.width / 2, view.grid.height / 2);
        return view.cameraView.y;
      });
      await page.keyboard.press("ArrowUp");
      const after = await page.evaluate(() => window.__mobileQa.view.cameraView.y);
      assert.ok(after > before && after < before + 4, "Arrow tap moves smoothly instead of jumping four tiles");
      await page.locator("#mission-canvas").click({ position: { x: 40, y: 40 } });
      assert.equal(await page.evaluate(() => window.__mobileQa.drag), null);
      assert.equal(await page.locator("#mobile-controls").count(), 0, "Desktop gameplay unchanged");
    }
    report.gating.push(label);
    await context.close();
  }
  for (const [label, userAgent] of [["iphone", iphone], ["android", android]]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, userAgent, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const page = await openPage(context);
    assert.equal(await page.locator("#mobile-controls").isVisible(), false, "No deck on mission picker");
    await launch(page);
    await page.locator("#mobile-controls").waitFor({ state: "visible" });
    await layout(page, `${label}-portrait`);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    await layout(page, `${label}-landscape`);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(150);
    await layout(page, `${label}-small`);
    await page.setViewportSize({ width: 568, height: 320 });
    await page.waitForTimeout(150);
    await layout(page, `${label}-small-landscape`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const view = window.__mobileQa.view;
      view.setCameraCenter(view.grid.width / 2, view.grid.height / 2);
    });
    const client = await context.newCDPSession(page);
    const pan = await page.locator('[data-mobile-action="pan-up"]').boundingBox();
    const point = { x: pan.x + pan.width / 2, y: pan.y + pan.height / 2, id: 1 };
    await page.evaluate(() => {
      const view = window.__mobileQa.view;
      const render = view.render, update = view.update, pan = view.panByCells;
      const counts = { renders: 0, updates: 0, pans: 0, panDraws: 0 };
      view.render = function(...args) { counts.renders++; return render.apply(this, args); };
      view.update = function(...args) { counts.updates++; return update.apply(this, args); };
      view.panByCells = function(...args) {
        counts.pans++;
        const before = counts.renders;
        const result = pan.apply(this, args);
        counts.panDraws += counts.renders - before;
        return result;
      };
      window.__mobileQa.finishPanCounts = () => {
        view.render = render; view.update = update; view.panByCells = pan;
        return counts;
      };
    });
    const before = await page.evaluate(() => window.__mobileQa.view.cameraView.y);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForTimeout(250);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const after = await page.evaluate(() => window.__mobileQa.view.cameraView.y);
    const counts = await page.evaluate(() => window.__mobileQa.finishPanCounts());
    assert.ok(counts.pans > 1, "Held pan updates on successive animation frames");
    assert.equal(counts.panDraws, 0, "Panning does not draw an extra frame");
    assert.equal(counts.renders, counts.updates, "The animation loop still draws on every update");
    report.checks.push(`${label}: ${counts.pans} pans, ${counts.renders} renders / ${counts.updates} animation updates`);
    assert.ok(after > before + 1, "Holding Up pans north");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__mobileQa.view.cameraView.y), after, "Release stops panning");
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    const cancelled = await page.evaluate(() => window.__mobileQa.view.cameraView.y);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__mobileQa.view.cameraView.y), cancelled, "Cancel stops panning");
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const blurred = await page.evaluate(() => window.__mobileQa.view.cameraView.y);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__mobileQa.view.cameraView.y), blurred, "Blur stops panning");
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    report.checks.push(`${label}: held pan, release, cancel, blur`);

    const battlefield = await page.locator("#mission-canvas").boundingBox();
    await page.evaluate(() => {
      window.__mobileQa.touchTrace = [];
      for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture"]) {
        document.querySelector("#mission-canvas").addEventListener(type, event =>
          window.__mobileQa.touchTrace.push({ type, pointerId: event.pointerId, primary: event.isPrimary }));
      }
    });
    const firstTouch = { x: battlefield.x + 40, y: battlefield.y + 40, id: 1 };
    const secondTouch = { x: battlefield.x + 80, y: battlefield.y + 80, id: 2 };
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [firstTouch] });
    const firstPointer = await page.evaluate(() => window.__mobileQa.drag.pointerId);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [firstTouch, secondTouch] });
    assert.equal(await page.evaluate(() => window.__mobileQa.drag.pointerId), firstPointer, "Second finger does not steal selection");
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [secondTouch] });
    const release = await page.evaluate(() => ({ pointerId: window.__mobileQa.drag?.pointerId, trace: window.__mobileQa.touchTrace }));
    assert.equal(release.pointerId, firstPointer, `Second finger release does not issue orders: ${JSON.stringify(release.trace)}`);
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    assert.equal(await page.evaluate(() => window.__mobileQa.drag), null, "Canvas cancellation clears selection gesture");
    assert.equal(await page.locator("#selection-box").isVisible(), false);
    report.checks.push(`${label}: primary touch selection and cancellation`);

    await page.waitForFunction(() => window.__mobileQa.view.simulation.snapshot.units.some(unit =>
      window.__mobileQa.view.isOwnedUnit(unit.id) && unit.activity !== "die"));
    await page.evaluate(() => {
      const view = window.__mobileQa.view;
      // Keep reinforcement auto-selection from racing the individual input assertions.
      const update = view.update;
      window.__mobileQa.resumeSelectionQa = () => { view.update = update; view.resetClock(); };
      view.update = function() { this.render(); };
      const unit = view.simulation.snapshot.units.find(unit => view.isOwnedUnit(unit.id) && unit.activity !== "die");
      view.setCameraCenter(unit.cellX, unit.cellY);
    });
    const selection = await page.evaluate(() => {
      const view = window.__mobileQa.view;
      const camera = view.cameraView;
      const expected = view.simulation.snapshot.units.filter(unit => {
        const x = unit.xSubcells / 1024, y = unit.ySubcells / 1024;
        return view.isOwnedUnit(unit.id) && unit.activity !== "die"
          && x >= camera.x && x <= camera.x + camera.width && y >= camera.y && y <= camera.y + camera.height;
      }).map(unit => unit.id).sort((a, b) => a - b);
      document.querySelector('[data-mobile-action="select-screen"]').click();
      return { expected, actual: [...view.selectedIds].sort((a, b) => a - b) };
    });
    assert.ok(selection.expected.length > 0);
    assert.deepEqual(selection.actual, selection.expected, "Screen selects exactly owned living viewport units");
    await page.locator('[data-mobile-action="move"]').tap();
    assert.equal(await page.evaluate(() => window.__mobileQa.view.movementStance), "move");
    await page.locator('[data-mobile-action="assault"]').tap();
    assert.equal(await page.evaluate(() => window.__mobileQa.view.movementStance), "assault");
    await page.locator('[data-mobile-action="stop"]').tap();
    await page.locator('[data-mobile-action="clear"]').tap();
    assert.equal(await page.evaluate(() => window.__mobileQa.view.selectedIds.length), 0);
    await page.evaluate(() => window.__mobileQa.resumeSelectionQa());
    report.checks.push(`${label}: viewport selection, move, assault, stop, clear`);

    await page.locator('[data-mobile-action="build"]').tap();
    await page.locator("#mobile-mission-menu").waitFor({ state: "visible" });
    await page.screenshot({ path: `${out}-${label}-build.png` });
    const purchase = await page.evaluate(() => {
      const entry = window.__mobileQa.entries.find(entry => entry.tab === "build" && entry.enabled && entry.maxStage > 0);
      if (!entry) throw new Error("Expected an available build order");
      document.querySelector(`[data-mobile-purchase="${entry.key}"]`).click();
      return { status: document.querySelector(".mobile-order-status").textContent,
        pending: window.__mobileQa.entries.find(candidate => candidate.key === entry.key)?.submitting };
    });
    assert.match(purchase.status, /Order accepted/);
    assert.equal(purchase.pending, true);
    const cameraWhileMenu = await page.evaluate(() => window.__mobileQa.view.cameraView.y);
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(() => window.__mobileQa.view.cameraView.y), cameraWhileMenu, "Modal blocks game keyboard");
    await page.locator('[data-mobile-tab="research"]').tap();
    await page.locator('[data-mobile-tab="options"]').tap();
    assert.ok(await page.locator(".mobile-objectives li").count());
    await page.locator('[data-mobile-option="save"]').tap();
    await page.locator('[data-save-slot="slot-1"]').tap();
    await page.locator("#mission-save-menu").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelector("#save-mission-status").textContent.startsWith("SAVED"));
    assert.equal(await page.locator("#mobile-mission-menu").isVisible(), false);
    await page.locator('[data-mobile-action="options"]').tap();
    page.once("dialog", dialog => dialog.accept());
    await page.locator('[data-mobile-option="exit"]').tap();
    await page.locator("#campaign-launcher").waitFor({ state: "visible" });
    assert.equal(await page.locator("#mobile-controls").isVisible(), false);
    report.checks.push(`${label}: build purchase, research, objectives, save, modal input guard, exit cleanup`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.errors.push(String(error?.stack ?? error));
} finally {
  writeFileSync(`${out}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ out, ...report }, null, 2));
process.exitCode = report.errors.length ? 1 : 0;
