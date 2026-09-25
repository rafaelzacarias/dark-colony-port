// First export a real H02 checkpoint with DC_FIRING_CHECKPOINT=... and mission-firing-visibility.test.ts.
// node tools/qa/firing-visibility-browser.mjs <checkpoint.json> <screenshot.png> [baseUrl]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const [checkpointPath, screenshotPath, base = "http://127.0.0.1:5173/"] = process.argv.slice(2);
assert.ok(checkpointPath && screenshotPath, "Pass an exported checkpoint and screenshot path");
const save = JSON.parse(readFileSync(checkpointPath, "utf8"));
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__firingView = () => skirmish;
      MissionView.prototype.update = function() {};` });
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__firingView && !document.querySelector("#campaign-launcher").inert);
  await page.evaluate(async save => {
    const { writeMissionSave } = await import("/src/mission-save.ts");
    await writeMissionSave(save);
  }, save);
  await page.reload();
  await page.locator("#continue-mission").waitFor({ state: "visible" });
  await page.locator("#continue-mission").click();
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
  const rendering = await page.evaluate(() => {
    const view = window.__firingView(), checkpoint = view.checkpoint();
    const reveal = checkpoint.state.combatReveals.find(entry => entry.team === 0);
    const actor = view.simulation.snapshot.units.find(actor => actor.id === reveal.id);
    view.setCameraCenter(actor.cellX + 0.5, actor.cellY + 0.5);
    view.replaceSelection(view.simulation.snapshot.units.filter(unit => view.isOwnedUnit(unit.id)).map(unit => unit.id));
    view.setOrderMode("assault");
    const bounds = view.canvas.getBoundingClientRect();
    const cursor = view.cursorAt(bounds.left + 256 * bounds.width / 512, bounds.top + 210 * bounds.height / 452);
    const canvas = document.querySelector("#mission-canvas"), context = canvas.getContext("2d");
    const drawImage = context.drawImage, fillRect = context.fillRect, events = [];
    context.fillRect = function(...args) {
      if (this.fillStyle.startsWith("rgba(3, 4, 3,")) events.push("fog");
      return fillRect.apply(this, args);
    };
    context.drawImage = function(...args) {
      if (args.length === 9) {
        const [, , , , , x, y, width, height] = args;
        const transform = this.getTransform();
        const start = transform.transformPoint({ x, y }), end = transform.transformPoint({ x: x + width, y: y + height });
        if (width < 128 && height < 128 && Math.min(start.x, end.x) < 272 && Math.max(start.x, end.x) > 240
          && Math.min(start.y, end.y) < 242 && Math.max(start.y, end.y) > 194) {
          events.push("shooter");
        }
      }
      return drawImage.apply(this, args);
    };
    try { view.render(); }
    finally { context.drawImage = drawImage; context.fillRect = fillRect; }
    return { tick: view.simulation.snapshot.tick, id: actor.id, cursor,
      visible: view.visibility[actor.cellY * view.grid.width + actor.cellX],
      firstShooter: events.indexOf("shooter"), lastFog: events.lastIndexOf("fog") };
  });
  assert.equal(rendering.visible, 1);
  assert.equal(rendering.cursor, "attack", "revealed sprites remain targetable");
  assert.ok(rendering.lastFog >= 0 && rendering.firstShooter > rendering.lastFog,
    `The full shooter must be drawn after fog: ${JSON.stringify(rendering)}`);
  await page.screenshot({ path: screenshotPath });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...rendering, screenshotPath }));
} finally { await browser.close(); }
