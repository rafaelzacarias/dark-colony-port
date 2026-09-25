// node tools/qa/fire-camera-browser.mjs <outputStem> [baseUrl]
import assert from "node:assert/strict";
const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const [out = `/tmp/dc-fire-camera-${Date.now()}`, base = "http://127.0.0.1:5173/"] = process.argv.slice(2);
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal"] });
const errors = [], report = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__cameraQa = { get view() { return skirmish; }, pans: [], effects: [] };
      const pan = MissionView.prototype.panByCells;
      MissionView.prototype.panByCells = function(x, y, render) {
        window.__cameraQa.pans.push({ x, y, render, time: performance.now() });
        return pan.call(this, x, y, render);
      };` });
  });
  await page.route(/\/src\/render\/mode5-canvas\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace("export function drawBrowserMode5Canvas(", "function originalBrowserMode5(");
    await route.fulfill({ response, body: `${source}
      export function drawBrowserMode5Canvas(input) {
        const result = originalBrowserMode5(input);
        if (window.__cameraQa && result.drawn && window.__cameraQa.effects.length < 1000)
          window.__cameraQa.effects.push({ sprite: input.part.child.sprite, time: performance.now() });
        return result;
      }` });
  });
  await page.goto(base);
  await page.locator('[data-menu-open="new"]').click();
  await page.locator(".mission-select-details summary").click();
  await page.selectOption("#campaign-mission-select", "10");
  await page.locator("[data-mission-launch]").click();
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
  await page.waitForFunction(() => window.__cameraQa.effects.some(effect => effect.sprite.toUpperCase() === "GLIT"));
  await page.waitForFunction(() => window.__cameraQa.view.checkpoint().state.unitStats
    .some(stat => stat.type >= 69 && stat.type <= 76 && window.__cameraQa.view.isOwnedUnit(stat.id)));
  const effects = await page.evaluate(() => {
    const view = window.__cameraQa.view, update = view.update;
    view.update = function() { this.render(); };
    window.__cameraQa.update = update;
    const carrier = view.carrierVisuals.find(carrier => carrier.sprite === "DROP");
    if (carrier) view.setCameraCenter(carrier.position.x / 256, carrier.position.y / 256);
    return [...new Set(window.__cameraQa.effects.map(effect => effect.sprite.toUpperCase()))];
  });
  assert.ok(effects.includes("GLIT"), "real dropship exhaust reaches the effect compositor");
  await page.screenshot({ path: `${out}-flames.png` });
  await page.evaluate(() => {
    const view = window.__cameraQa.view;
    view.update = window.__cameraQa.update;
    view.resetClock();
  });
  report.push({ effects });

  const reset = async () => page.evaluate(() => {
    const view = window.__cameraQa.view;
    view.setCameraCenter(view.grid.width / 2, view.grid.height / 2);
    window.__cameraQa.pans = [];
    return view.cameraView;
  });
  await reset();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(650);
  await page.keyboard.up("ArrowRight");
  const keys = await page.evaluate(() => window.__cameraQa.pans);
  assert.ok(keys.length >= 10, `held key should move every frame, saw ${keys.length}`);
  assert.ok(keys.every(pan => pan.x > 0 && pan.x <= 0.96 && pan.y === 0 && pan.render === false));
  assert.ok(keys.some(pan => pan.x < 0.5), "sub-tile increments are visible");
  const stopped = await page.evaluate(() => window.__cameraQa.view.cameraView);
  await page.waitForTimeout(120);
  assert.deepEqual(await page.evaluate(() => window.__cameraQa.view.cameraView), stopped, "release stops immediately");
  report.push({ keyboardFrames: keys.length, maxStep: Math.max(...keys.map(pan => pan.x)) });

  const bounds = await page.locator("#mission-canvas").boundingBox();
  await reset();
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2);
  await page.waitForTimeout(500);
  await page.mouse.move(0, 0);
  const edge = await page.evaluate(() => window.__cameraQa.pans);
  assert.ok(edge.length >= 8 && edge.every(pan => pan.x > 0 && pan.x <= 0.96 && pan.y === 0));
  const edgeStopped = await page.evaluate(() => window.__cameraQa.view.cameraView);
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.__cameraQa.view.cameraView), edgeStopped);
  report.push({ edgeFrames: edge.length });

  await reset();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(80);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const blurred = await page.evaluate(() => window.__cameraQa.view.cameraView);
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.__cameraQa.view.cameraView), blurred);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(80);
  await page.locator('[data-original-tab="options"]').click();
  await page.locator("#save-mission").click();
  const paused = await page.evaluate(() => window.__cameraQa.view.cameraView);
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.__cameraQa.view.cameraView), paused, "dialog cancels panning");
  await page.keyboard.up("ArrowLeft");
  await page.locator("[data-save-close]").click();
  report.push({ cancellation: "keyup, edge leave, blur, save dialog" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ report, errors, out }));
} finally { await browser.close(); }
