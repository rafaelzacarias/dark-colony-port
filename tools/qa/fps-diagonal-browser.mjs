// node tools/qa/fps-diagonal-browser.mjs <outputStem> [baseUrl]
import assert from "node:assert/strict";
const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const [out = `/tmp/dc-fps-diagonal-${Date.now()}`, base = "http://127.0.0.1:5173/"] = process.argv.slice(2);
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal"] });
const report = [], errors = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {}) });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}
        window.__fpsQa = { get view() { return skirmish; },
          restore: checkpoint => MissionView.restore(missionCanvas, previewStage,
            { onStats() {}, onUnitsChanged() {} }, skirmish.mission, checkpoint) };` });
    });
    await page.goto(base);
    await page.locator('[data-menu-open="new"]').click();
    await page.locator(".mission-select-details summary").click();
    await page.selectOption("#campaign-mission-select", "10");
    await page.locator("[data-mission-launch]").click();
    await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
    await page.waitForFunction(() => /^FPS \d+ AVG \d+ LOW \d+$/.test(document.querySelector("#frame-statistics").textContent));
    await page.waitForFunction(() => window.__fpsQa.view.simulation.snapshot.units.some(unit =>
      window.__fpsQa.view.isOwnedUnit(unit.id) && !unit.resourceActor && unit.movementPlane !== "air" && unit.health > 0));
    const movement = await page.evaluate(async () => {
      const { findPath } = await import("/src/engine/pathfinding.ts");
      const view = window.__fpsQa.view, update = view.update;
      view.update = function() { this.render(); };
      view.resetClock(); update.call(view, 0);
      const snapshot = view.simulation.snapshot, options = [];
      for (const unit of snapshot.units.filter(unit => view.isOwnedUnit(unit.id) && !unit.resourceActor &&
        unit.movementPlane !== "air" && unit.health > 0)) {
        const occupied = new Set(snapshot.units.filter(other => other.id !== unit.id && other.health > 0)
          .map(other => view.grid.index(other.cellX, other.cellY)));
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const target = { x: unit.cellX + dx * 3, y: unit.cellY + dy * 3 };
          const path = findPath(view.grid, { x: unit.cellX, y: unit.cellY }, target, { diagonal: true, blocked: occupied });
          if (path?.length === 4 && path.every((point, index) => index === 0 ||
            Math.abs(point.x - path[index - 1].x) === 1 && Math.abs(point.y - path[index - 1].y) === 1)) {
            options.push({ unit, target });
          }
        }
      }
      if (!options.length) throw new Error("No clear source-backed diagonal move is available");
      const { unit, target } = options[0];
      view.replaceSelection([unit.id]); view.setOrderMode("move");
      view.setCameraCenter(target.x + 0.5, target.y + 0.5);
      const bounds = view.canvas.getBoundingClientRect(), camera = view.cameraView;
      view.commandAt(bounds.left + (target.x + 0.5 - camera.x) * 32 * bounds.width / 512,
        bounds.top + (camera.y + camera.height - target.y - 0.5) * 32 * bounds.height / 452);
      const deltas = [];
      for (let frame = 1; frame <= 8; frame++) {
        const before = view.simulation.snapshot.units.find(actor => actor.id === unit.id);
        update.call(view, frame * 50);
        const after = view.simulation.snapshot.units.find(actor => actor.id === unit.id);
        deltas.push([after.xSubcells - before.xSubcells, after.ySubcells - before.ySubcells]);
      }
      const saved = view.checkpoint();
      const restored = window.__fpsQa.restore(JSON.parse(JSON.stringify(saved)));
      const exactRestore = JSON.stringify(restored.checkpoint()) === JSON.stringify(saved);
      restored.dispose();
      return { id: unit.id, target, deltas, policy: saved.simulation.groundMovement, exactRestore, tick: saved.simulation.tick };
    });
    assert.equal(movement.policy, "eight-way-v1");
    assert.equal(movement.exactRestore, true);
    assert.ok(movement.deltas.filter(([x, y]) => x !== 0 && y !== 0).length >= 3, JSON.stringify(movement));
    await page.waitForTimeout(1200);
    const fps = await page.locator("#frame-statistics").textContent();
    assert.match(fps, /^FPS \d+ AVG \d+ LOW \d+$/);
    assert.ok(Number(fps.match(/^FPS (\d+)/)[1]) > 20, fps);
    assert.match(await page.locator("#frame-statistics").getAttribute("title"), /Frame time: [\d.]+ ms/);
    for (const [width, height] of mobile ? [[390, 844], [844, 390], [320, 568]] : [[1280, 900]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => {
        const bounds = selector => {
          const element = document.querySelector(selector), box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, bottom: box.bottom,
            clipped: element.scrollWidth > element.clientWidth + 1 };
        };
        return { fps: bounds("#frame-statistics"), tick: bounds("#legacy-tick"),
          message: bounds("#mission-message"), shell: bounds("#mission-shell") };
      });
      assert.ok(layout.message.right <= layout.fps.x && layout.fps.right <= layout.tick.x, JSON.stringify(layout));
      assert.equal(layout.fps.clipped, false);
      assert.ok(layout.tick.right <= layout.shell.right && layout.fps.bottom <= layout.shell.bottom);
      await page.screenshot({ path: `${out}-${width}x${height}.png` });
    }
    report.push({ mobile, movement, fps });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ report, errors }));
} finally { await browser.close(); }
