// node tools/qa/unit-selection-browser.mjs <outputStem> [baseUrl]
import assert from "node:assert/strict";

const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const [out = `/tmp/dc-unit-selection-${Date.now()}`, base = "http://127.0.0.1:5173/"] = process.argv.slice(2);
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal"] });
const errors = [], checks = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {}) });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nwindow.__unitView = () => skirmish;` });
    });
    await page.goto(base);
    await page.locator('[data-menu-open="new"]').click();
    await page.locator(".mission-select-details summary").click();
    await page.selectOption("#campaign-mission-select", "10");
    await page.locator("[data-mission-launch]").click();
    await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
    await page.waitForFunction(() => {
      const view = window.__unitView();
      return view.checkpoint().state.unitStats.some(stat => stat.type >= 69 && stat.type <= 76 && view.isOwnedUnit(stat.id));
    });
    const commanderId = await page.evaluate(() => {
      const view = window.__unitView();
      view.update = () => {};
      const id = view.checkpoint().state.unitStats.find(stat => stat.type >= 69 && stat.type <= 76 && view.isOwnedUnit(stat.id)).id;
      const unit = view.simulation.snapshot.units.find(unit => unit.id === id);
      view.setCameraCenter(unit.xSubcells / 1024, unit.ySubcells / 1024);
      view.clearSelection();
      return id;
    });
    for (const [label, size] of mobile
      ? [["phone-portrait", { width: 390, height: 844 }], ["phone-landscape", { width: 844, height: 390 }]]
      : [["desktop", { width: 1280, height: 900 }]]) {
      await page.setViewportSize(size);
      const body = await page.evaluate(async id => {
        const { finBodyBounds, composeFinSample, createFinSourceSampler } = await import("/src/render/fin-composition.ts");
        const { createFinFrameLookup, createFinSelector } = await import("/src/render/fin-animation.ts");
        const { TRSC_GRAY_VISUAL_DIRECTIONS } = await import("/src/render/index.ts");
        const view = window.__unitView(), unit = view.simulation.snapshot.units.find(unit => unit.id === id);
        view.render();
        const state = view.checkpoint().state.animationStates.find(state => state.id === id);
        const animation = await (await fetch("/assets/generated/animations/TRSC.json")).json();
        const names = [...new Set(animation.timeline.flatMap(frame => frame.children.map(child => child.sprite)))];
        const atlases = await Promise.all(names.map(async name =>
          [name, await (await fetch(`/assets/generated/sprites/SPRITES/${name}.json`)).json()]));
        const selection = createFinSelector(animation, { prefix: "TRSC", directions: TRSC_GRAY_VISUAL_DIRECTIONS,
          layerOrder: "source" }).select(state.action, state.facing);
        const origin = { x: (unit.xSubcells / 1024 - view.cameraView.x) * 32,
          y: (view.cameraView.y + view.cameraView.height - unit.ySubcells / 1024) * 32 };
        const box = finBodyBounds(composeFinSample(createFinSourceSampler(animation)(selection,
          view.simulation.snapshot.tick - state.since), createFinFrameLookup(Object.fromEntries(atlases))), origin);
        const bounds = document.querySelector("#mission-canvas").getBoundingClientRect();
        const client = (x, y) => ({ x: bounds.left + x * bounds.width / 512, y: bounds.top + y * bounds.height / 452 });
        const x = (box.left + box.right) / 2;
        return { box, origin, start: client(x - 4, box.top + 2), end: client(x + 4, box.top + 12),
          point: client(x, box.top + 7) };
      }, commanderId);
      assert.ok(body.box.top + 12 < body.origin.y);
      await page.evaluate(() => window.__unitView().clearSelection());
      await page.mouse.move(body.start.x, body.start.y);
      await page.mouse.down();
      await page.mouse.move(body.end.x, body.end.y, { steps: 5 });
      await page.mouse.up();
      assert.ok(await page.evaluate(id => window.__unitView().selectedIds.includes(id), commanderId), `${label}: upper-body drag`);
      await page.evaluate(() => window.__unitView().clearSelection());
      if (mobile) await page.touchscreen.tap(body.point.x, body.point.y);
      else await page.mouse.click(body.point.x, body.point.y);
      assert.ok(await page.evaluate(id => window.__unitView().selectedIds.includes(id), commanderId), `${label}: body click/tap`);
      await page.evaluate(() => window.__unitView().clearSelection());
      const goldPixels = await page.evaluate(({ origin, box }) => {
        const drawing = document.querySelector("#mission-canvas").getContext("2d");
        const pixels = drawing.getImageData(Math.round(origin.x) - 8, Math.round(box.top) - 22, 16, 16).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i + 1] > 140 && pixels[i + 2] < 140) count++;
        return count;
      }, body);
      assert.ok(goldPixels > 10, `${label}: unselected commander has a visible gold star`);
      if (mobile) await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}-${label}.png` });
      checks.push({ label, goldPixels });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }));
} finally { await browser.close(); }
