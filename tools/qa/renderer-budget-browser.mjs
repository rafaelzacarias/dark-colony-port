// node tools/qa/renderer-budget-browser.mjs <saved-mission.json> <outputStem> [baseUrl]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const [input, out, base = "http://127.0.0.1:5173/"] = process.argv.slice(2);
assert.ok(input && out, "Pass a real saved mission and output stem");
const save = JSON.parse(readFileSync(input, "utf8"));
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal"] });
const report = { fixtureParity: [], parity: [], samples: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => report.errors.push(error.message));
  await page.addInitScript(() => {
    window.__readbacks = { active: false, calls: 0, milliseconds: 0, pixels: 0 };
    const read = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      const start = performance.now(), image = read.apply(this, args);
      if (window.__readbacks.active) {
        window.__readbacks.calls++;
        window.__readbacks.milliseconds += performance.now() - start;
        window.__readbacks.pixels += image.width * image.height;
      }
      return image;
    };
  });
  await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__renderBudget = { get view() { return skirmish; },
        start: save => startCampaign(save.faction, save.missionNumber, save.checkpoint, save.controlGroups) };` });
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__renderBudget && !document.querySelector("#campaign-launcher").inert);
  await page.evaluate(save => window.__renderBudget.start(save), save);
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 180000 });
  report.parity = await page.evaluate(async () => {
    const source = await (await fetch("/src/mission-view.ts")).text();
    const moduleUrl = source.match(/from\s+["']([^"']*\/mode1-canvas\.ts[^"']*)["']/)?.[1];
    if (!moduleUrl) throw new Error("Cannot resolve the active mode1 module");
    const api = await import(moduleUrl);
    const { setPaletteBodyMirror } = api;
    const qa = window.__renderBudget, view = qa.view;
    qa.setBodyMirror = setPaletteBodyMirror;
    qa.paletteApi = api;
    qa.update = view.update;
    view.update = () => {};
    const context = view.canvas.getContext("2d"), results = [];
    const camera = view.cameraView;
    const center = { x: camera.x + camera.width / 2, y: camera.y + camera.height / 2 };
    const capture = () => context.getImageData(0, 0, 512, 452).data;
    // A camera change drains the prior tick's asynchronous terrain readback before comparing the same frame.
    view.setCameraCenter(center.x + 0.125, center.y);
    for (const [x, y] of [[0, 0], [0.03125, 0.015625], [2.2, -1.1], [-3.75, 2.125]]) {
      view.setCameraCenter(center.x + x, center.y + y);
      for (let warm = 0; warm < 5; warm++) view.render();
      setPaletteBodyMirror(false);
      view.render(); const firstReference = capture();
      view.render(); const reference = capture();
      const baselineChanges = reference.reduce((count, value, index) => count + Number(value !== firstReference[index]), 0);
      const baselineRenderer = view.terrainRendererStatus;
      setPaletteBodyMirror(true);
      view.render(); const optimized = capture();
      let differences = 0; const first = [];
      for (let offset = 0; offset < reference.length; offset++) if (reference[offset] !== optimized[offset]) {
        differences++;
        if (first.length < 5) first.push({ offset, before: reference[offset], after: optimized[offset] });
      }
      results.push({ x, y, differences, first, baselineChanges, baselineRenderer, optimizedRenderer: view.terrainRendererStatus });
    }
    view.setCameraCenter(center.x, center.y);
    return results;
  });
  assert.ok(report.parity.every(sample => sample.differences === 0), JSON.stringify(report.parity));
  report.fixtureParity = await page.evaluate(async () => {
    const { beginMode1ShadowFrame, endMode1ShadowFrame, mirroredRegion, registerNativePaletteImage,
      drawMirroredPaletteBody } = window.__renderBudget.paletteApi;
    const { RemapTable } = await import("/src/render/palette.ts");
    const { composeFinSample, drawFinComposition } = await import("/src/render/fin-composition.ts");
    const { remapSpritePixels } = await import("/src/render/mission-sprites.ts");
    const palette = Uint8Array.from({ length: 768 }, (_, index) => (index * 37 + 11) & 255);
    const table = new Uint8Array(3 * 65536);
    for (let selector = 0; selector < 8; selector++) for (let index = 0; index < 256; index++) {
      table[2 * 65536 + (128 + selector) * 256 + index] = (index + selector * 17) & 255;
    }
    const remap = new RemapTable(table), sourceWidth = 11, sourceHeight = 13;
    const indices = Uint8Array.from({ length: sourceWidth * sourceHeight }, (_, index) => (index * 3) & 255);
    const coverage = Uint8Array.from(indices, (_, index) => Number(index % 3 !== 0));
    const results = [];
    for (const selector of [0, 3, 7]) {
      const image = document.createElement("canvas"); image.width = sourceWidth; image.height = sourceHeight;
      const ctx = image.getContext("2d"), data = ctx.createImageData(sourceWidth, sourceHeight);
      data.data.set(remapSpritePixels(indices, coverage, remap, palette, selector));
      ctx.putImageData(data, 0, 0);
      registerNativePaletteImage(image, { width: sourceWidth, height: sourceHeight, indices, coverage, palette, remap, selector });
      for (const mode of [0, 1]) for (const mirrored of [false, true]) for (const [x, y] of [[-2, -3], [6, 7], [91, 90]]) {
        for (const masked of [false, true]) {
          const child = { sprite: "fixture", frame: 0, x: 0, y: 0, flags: 16, layer: 0, valueA: mode, valueB: Number(mirrored) };
          const frame = { index: 0, x: 2, y: 3, width: 7, height: 8, anchorX: 2, anchorY: 0, empty: false };
          const part = composeFinSample({ children: [child], timelineIndex: 0, finished: false }, () => frame)[0];
          const origin = { x: x - part.x, y: y - part.y };
          const clips = masked ? Array.from({ length: 8 }, (_, row) => ({
            x: row % 3, y: row, width: 7 - row % 3, height: 1,
          })) : [{ x: 0, y: 0, width: 7, height: 8 }];
          const draw = optimized => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 96;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.imageSmoothingEnabled = false;
            context.fillStyle = "#192b37"; context.fillRect(0, 0, 96, 96);
            beginMode1ShadowFrame(context);
            mirroredRegion(context, { x: 0, y: 0, width: 96, height: 96 });
            // A foreign RGB draw must be synchronized before the native body's transparent holes are preserved.
            context.fillStyle = "#5b6d81"; context.fillRect(4, 5, 12, 12);
            if (optimized) {
              if (!drawMirroredPaletteBody({ context, image, part, body: { topLeft: { x, y }, clips } })) {
                throw new Error("Expected indexed-body fast path");
              }
            } else {
              context.save(); context.beginPath();
              for (const span of clips) context.rect(x + span.x, y + span.y, span.width, span.height);
              context.clip(); drawFinComposition(context, [part], () => image, origin, 1); context.restore();
            }
            endMode1ShadowFrame(context);
            return context.getImageData(0, 0, 96, 96).data;
          };
          const reference = draw(false), optimized = draw(true);
          let differences = 0;
          for (let i = 0; i < reference.length; i++) if (reference[i] !== optimized[i]) differences++;
          results.push({ selector, mode, mirrored, x, y, masked, differences });
        }
      }
    }
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#293b47"; context.fillRect(0, 0, 32, 32);
    beginMode1ShadowFrame(context);
    mirroredRegion(context, { x: 0, y: 0, width: 32, height: 32 });
    const child = { sprite: "guard", frame: 0, x: 0, y: 0, flags: 16, layer: 0, valueA: 0, valueB: 0 };
    const frame = { index: 0, x: 0, y: 0, width: 7, height: 8, anchorX: 0, anchorY: 0, empty: false };
    const part = composeFinSample({ children: [child], timelineIndex: 0, finished: false }, () => frame)[0];
    const image = document.createElement("canvas"); image.width = sourceWidth; image.height = sourceHeight;
    registerNativePaletteImage(image, { width: sourceWidth, height: sourceHeight, indices, coverage, palette, remap, selector: 0 });
    const body = { topLeft: { x: 4, y: 4 }, clips: [{ x: 0, y: 0, width: 7, height: 8 }] };
    for (const guard of ["alpha", "transform", "effect", "bounds", "clip"]) {
      context.save();
      const before = context.getImageData(0, 0, 32, 32).data;
      if (guard === "alpha") context.globalAlpha = 0.5;
      if (guard === "transform") context.translate(0.5, 0);
      const candidate = guard === "effect" ? { ...part, child: { ...child, valueA: 5 } }
        : guard === "bounds" ? { ...part, frame: { ...frame, x: -1 } } : part;
      const clipping = guard === "clip" ? { ...body, clips: [{ x: -1, y: 0, width: 7, height: 8 }] } : body;
      const drawn = drawMirroredPaletteBody({ context, image, part: candidate, body: clipping });
      const after = context.getImageData(0, 0, 32, 32).data;
      let differences = 0;
      for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) differences++;
      context.restore();
      if (drawn) throw new Error(`Unsupported ${guard} entered the fast path`);
      results.push({ guard, differences });
    }
    endMode1ShadowFrame(context);
    return results;
  });
  assert.ok(report.fixtureParity.every(sample => sample.differences === 0), JSON.stringify(report.fixtureParity));
  for (const configuration of [
    { enabled: false, name: "reference", duration: 5000 },
    { enabled: true, name: "optimized", duration: 15000 },
    { enabled: true, name: "panning", duration: 6000 },
    { enabled: true, name: "formation", duration: 6000 },
  ]) {
    const result = await page.evaluate(configuration => new Promise(resolve => {
      const { enabled, name, duration } = configuration;
      const qa = window.__renderBudget, view = qa.view, work = [], intervals = [];
      qa.setBodyMirror(enabled);
      let frames = 0;
      view.update = function(time) {
        const start = performance.now();
        if (name === "panning") this.panByCells((Math.floor(frames / 90) % 2 ? -1 : 1) * 0.1, 0, false);
        qa.update.call(this, time);
        work.push(performance.now() - start);
        frames++;
      };
      view.resetClock();
      if (name === "formation") {
        const camera = view.cameraView;
        const target = { x: Math.floor(camera.x + camera.width / 2) + 4, y: Math.floor(camera.y + camera.height / 2) + 3 };
        if (!view.grid.isPassable(target.x, target.y)) throw new Error("Formation target must be passable");
        view.selectAllPlayerUnits(); view.setOrderMode("move");
        const bounds = view.canvas.getBoundingClientRect();
        view.commandAt(bounds.left + (target.x + 0.5 - camera.x) * 32 * bounds.width / 512,
          bounds.top + (camera.y + camera.height - target.y - 0.5) * 32 * bounds.height / 452);
      }
      Object.assign(window.__readbacks, { active: true, calls: 0, milliseconds: 0, pixels: 0 });
      let previous, first;
      const tick = time => {
        first ??= time;
        if (previous !== undefined) intervals.push(time - previous);
        previous = time;
        if (time - first < duration) { requestAnimationFrame(tick); return; }
        window.__readbacks.active = false;
        const summary = values => {
          const sorted = [...values].sort((a, b) => a - b);
          return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
            median: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)],
            p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1),
            overBudget: values.filter(value => value > 1000 / 60).length };
        };
        resolve({ name, enabled, tick: view.simulation.snapshot.tick, fps: 1000 / summary(intervals).mean,
          work: summary(work), intervals: summary(intervals), readbacks: { ...window.__readbacks },
          missedFrames: intervals.filter(interval => interval > 25).length,
          diagnostic: view.missionDiagnostic ?? null });
      };
      requestAnimationFrame(tick);
    }), configuration);
    report.samples.push(result);
  }
  await page.screenshot({ path: `${out}.png` });
  assert.deepEqual(report.errors, []);
  assert.ok(report.samples.every(sample => sample.diagnostic === null));
  assert.ok(report.samples[1].readbacks.calls / report.samples[1].work.count
    < report.samples[0].readbacks.calls / report.samples[0].work.count);
  for (const sample of report.samples.filter(sample => sample.enabled)) {
    assert.ok(sample.work.p95 < 1000 / 60, `${sample.name}: 95% of live frame work must fit the 60 FPS budget`);
    assert.ok(sample.fps >= 59.5, `${sample.name}: expected sustained 60 FPS, got ${sample.fps}`);
  }
} catch (error) {
  report.errors.push(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  writeFileSync(`${out}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ out, ...report }, null, 2));
