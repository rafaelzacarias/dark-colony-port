// node tools/qa/start-menu-browser.mjs [outputStem] [baseUrl]
// Uses the same existing Playwright/Chromium installation as mobile-mission-browser.mjs.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const out = process.argv[2] ?? `/tmp/dc-start-menu-${Date.now()}`;
const base = process.argv[3] ?? "http://127.0.0.1:5173/";
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal", "--autoplay-policy=no-user-gesture-required"] });
const report = { checks: [], errors: [] };
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function openPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(error.message));
  // The real startup policy must also hold outside webdriver detection.
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      globalThis.__startMenuQa = {
        get view() { return skirmish; },
        get groups() { return controlGroups.state.groups; },
        readMissionSave,
        factory: indexedDB,
      };
      const originalRestore = MissionView.restore;
      MissionView.restore = function(...args) {
        const view = originalRestore.apply(this, args);
        globalThis.__startMenuQa.restored = view.checkpoint();
        return view;
      };` });
  });
  await page.goto(base);
  await ready(page);
  return page;
}

async function ready(page) {
  await page.waitForFunction(() => window.__startMenuQa && !document.querySelector("#campaign-launcher").inert);
  assert.equal(await page.locator(".cinematic-player").count(), 0);
  assert.equal(await page.locator(".topbar").isVisible(), false);
}

async function checkLayout(page, label) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight + 1,
    buttons: [...document.querySelectorAll('[data-menu-screen="home"] button:not([hidden])')].map(button => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
  }));
  assert.equal(layout.overflow, false, label);
  for (const button of layout.buttons) {
    assert.ok(button.width >= 44 && button.height >= 44 && button.left >= 0, `${label}: target size`);
    assert.ok(button.right <= page.viewportSize().width + 1 && button.top >= 0
      && button.bottom <= page.viewportSize().height + 1, `${label}: clipped button`);
  }
  await page.screenshot({ path: `${out}-${label}.png` });
}

async function openGameOptions(page, mobile) {
  if (mobile) await page.locator('[data-mobile-action="options"]').click();
  else await page.locator('[data-original-tab="options"]').click();
}

async function openSave(page, mobile) {
  await openGameOptions(page, mobile);
  await page.locator(mobile ? '[data-mobile-option="save"]' : "#save-mission").click();
  await page.locator('[data-save-slot="slot-1"]').waitFor({ state: "visible" });
}

try {
  for (const mobile of [false, true]) {
    const label = mobile ? "phone" : "desktop";
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      ...(mobile ? { userAgent: iphone, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await openPage(context);
    await checkLayout(page, label);
    if (mobile) {
      for (const [width, height] of [[320, 568], [844, 390], [568, 320]]) {
        await page.setViewportSize({ width, height });
        await checkLayout(page, `${label}-${width}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.locator('[data-menu-load]').click();
    await page.getByText("No saved games yet.", { exact: false }).waitFor();
    assert.equal(await page.locator(".save-slots button:disabled").count(), 3);
    await page.locator("[data-save-close]").click();
    await page.locator('[data-menu-open="options"]').focus();
    await page.keyboard.press("Space");
    await page.locator("#menu-sound").waitFor({ state: "visible" });
    await page.locator("#menu-sound").click();
    assert.equal(await page.locator("#menu-sound").getAttribute("aria-pressed"), "true");
    await page.locator("#menu-sound").click();
    await page.keyboard.press("Escape");
    await page.locator('[data-menu-open="new"]').click();
    await page.screenshot({ path: `${out}-${label}-new-game.png` });
    if (mobile) {
      await page.locator(".mission-select-details summary").click();
      await page.selectOption("#campaign-mission-select", "10");
      await page.locator("[data-mission-launch]").click();
    } else await page.locator('#campaign-launcher [data-campaign-faction="alien"]').click();
    await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
    await page.waitForFunction(() => window.__startMenuQa.view.simulation.snapshot.tick >= 2);
    if (mobile) {
      await page.waitForFunction(() => {
        const view = window.__startMenuQa.view;
        return view.simulation.snapshot.units.some(unit => view.isOwnedUnit(unit.id));
      });
      await page.evaluate(() => {
        const view = window.__startMenuQa.view;
        view.selectAllPlayerUnits();
        view.setCameraCenter(view.grid.width / 2, view.grid.height / 2);
      });
      await page.locator("#mission-canvas").focus();
      await page.keyboard.press("g");
      await page.keyboard.press("1");
      assert.ok(await page.evaluate(() => window.__startMenuQa.groups[1].length > 0));
    }
    await openSave(page, mobile);
    const tick = await page.evaluate(() => window.__startMenuQa.view.simulation.snapshot.tick);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__startMenuQa.view.simulation.snapshot.tick), tick, "Save menu pauses mission");
    await page.locator('[data-save-slot="slot-1"]').click();
    await page.locator("#mission-save-menu").waitFor({ state: "hidden" });
    const first = await page.evaluate(() => window.__startMenuQa.readMissionSave(undefined, "slot-1"));
    assert.equal(first.faction, mobile ? "human" : "alien");
    assert.equal(first.checkpoint.simulation.tick, tick);

    await openSave(page, mobile);
    page.once("dialog", dialog => dialog.dismiss());
    await page.locator('[data-save-slot="slot-1"]').click();
    assert.deepEqual(await page.evaluate(() => window.__startMenuQa.readMissionSave(undefined, "slot-1")), first);
    await page.locator('[data-save-slot="slot-2"]').click();
    await page.locator("#mission-save-menu").waitFor({ state: "hidden" });
    const second = await page.evaluate(() => window.__startMenuQa.readMissionSave(undefined, "slot-2"));
    assert.ok(second);

    // A failed write stays visible and leaves both committed slots intact.
    await openSave(page, mobile);
    await page.screenshot({ path: `${out}-${label}-save-slots.png` });
    await page.evaluate(() => Object.defineProperty(window, "indexedDB", {
      configurable: true, get() { throw new Error("Storage denied for QA"); },
    }));
    await page.locator('[data-save-slot="slot-3"]').click();
    await page.locator(".save-menu-status[data-error=true]").waitFor();
    assert.match(await page.locator(".save-menu-status").textContent(), /Storage denied/);
    await page.evaluate(() => Object.defineProperty(window, "indexedDB", {
      configurable: true, value: window.__startMenuQa.factory,
    }));
    assert.deepEqual(await page.evaluate(() => window.__startMenuQa.readMissionSave(undefined, "slot-1")), first);
    assert.deepEqual(await page.evaluate(() => window.__startMenuQa.readMissionSave(undefined, "slot-2")), second);
    assert.equal(await page.evaluate(() => window.__startMenuQa.readMissionSave(undefined, "slot-3")), null);
    await page.locator("[data-save-close]").click();

    await page.reload();
    await ready(page);
    await page.locator("#continue-mission").waitFor({ state: "visible" });
    if (mobile) {
      await page.setViewportSize({ width: 568, height: 320 });
      await checkLayout(page, "phone-landscape-continue");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.locator("[data-menu-load]").click();
    await page.locator('[data-save-slot="slot-1"]').click();
    await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
    assert.deepEqual(await page.evaluate(() => window.__startMenuQa.restored), first.checkpoint);
    assert.deepEqual(await page.evaluate(() => window.__startMenuQa.groups), first.controlGroups);
    await openGameOptions(page, mobile);
    page.once("dialog", dialog => dialog.accept());
    await page.locator(mobile ? '[data-mobile-option="exit"]' : "#exit-campaign").click();
    await ready(page);
    await page.locator("#continue-mission").waitFor({ state: "visible" });
    await page.locator("#continue-mission").click();
    await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
    assert.deepEqual(await page.evaluate(() => window.__startMenuQa.restored), second.checkpoint);

    await openGameOptions(page, mobile);
    page.once("dialog", dialog => dialog.accept());
    await page.locator(mobile ? '[data-mobile-option="load"]' : "#load-mission").click();
    await page.locator('[data-save-slot="slot-1"]').click();
    await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
    assert.deepEqual(await page.evaluate(() => window.__startMenuQa.restored), first.checkpoint);
    await page.screenshot({ path: `${out}-${label}-restored.png` });
    report.checks.push(`${label}: menu, empty slots, sound, launch, pause, independent manual saves, overwrite cancellation, storage failure, reload, exact Load/Continue restore, in-game load`);
    await context.close();
  }
  const context = await browser.newContext();
  const page = await openPage(context);
  await page.evaluate(() => Object.defineProperty(window, "indexedDB", {
    configurable: true, get() { throw new Error("Storage unavailable for QA"); },
  }));
  await page.locator("[data-menu-load]").click();
  await page.locator("[data-save-retry]").waitFor({ state: "visible" });
  assert.match(await page.locator(".save-menu-status").textContent(), /Storage unavailable/);
  await page.evaluate(() => Object.defineProperty(window, "indexedDB", { value: window.__startMenuQa.factory }));
  await page.locator("[data-save-retry]").click();
  await page.getByText("No saved games yet.", { exact: false }).waitFor();
  await page.locator("[data-save-close]").click();
  await page.locator('[data-menu-open="options"]').click();
  await page.locator("#play-intro").click();
  await page.locator(".cinematic-player[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".cinematic-player").waitFor({ state: "hidden" });
  await page.locator("#open-asset-browser").click();
  assert.equal(await page.locator(".topbar").isVisible(), true);
  await page.locator('[data-mode="campaign"]').click();
  await ready(page);
  report.checks.push("Storage retry, explicit introduction playback, extras and main-menu return");
  await context.close();
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.errors.push(String(error?.stack ?? error));
} finally {
  writeFileSync(`${out}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ out, ...report }, null, 2));
process.exitCode = report.errors.length ? 1 : 0;
