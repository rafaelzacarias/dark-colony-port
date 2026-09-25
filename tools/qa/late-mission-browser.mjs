// node tools/qa/late-mission-browser.mjs <saved-mission.json> <outputStem> [baseUrl]
// Profiles an actual saved mission through main.ts; no artificial ticks, counters, or actors.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const pw = (await import(process.env.DC_PLAYWRIGHT_CORE
  ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const [input, out, base = "http://127.0.0.1:5173/"] = process.argv.slice(2);
assert.ok(input && out, "Pass a saved mission envelope and an output stem");
const save = JSON.parse(readFileSync(input, "utf8"));
const browser = await pw.chromium.launch({ headless: true,
  executablePath: process.env.DC_CHROMIUM
    ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/\/src\/main\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      import { CampaignSession as QA_CampaignSession } from "/src/engine/campaign-session.ts";
      window.__lateQa = { get view() { return skirmish; }, fullCopies: 0, cloneMilliseconds: 0,
        start: save => startCampaign(save.faction, save.missionNumber, save.checkpoint, save.controlGroups) };
      const descriptor = Object.getOwnPropertyDescriptor(QA_CampaignSession.prototype, "snapshot");
      Object.defineProperty(QA_CampaignSession.prototype, "snapshot", { ...descriptor,
        get() { const start = performance.now(); const value = descriptor.get.call(this);
          window.__lateQa.fullCopies++; window.__lateQa.cloneMilliseconds += performance.now() - start;
          return value; } });` });
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__lateQa && !document.querySelector("#campaign-launcher").inert);
  await page.evaluate(save => window.__lateQa.start(save), save);
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 180000 });
  await page.waitForTimeout(500);
  const client = await page.context().newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.start");
  const result = await page.evaluate(() => new Promise(resolve => {
    const qa = window.__lateQa, view = qa.view, original = view.update;
    qa.fullCopies = qa.cloneMilliseconds = 0;
    const work = [], intervals = [];
    view.update = function(time) {
      const start = performance.now();
      original.call(this, time);
      work.push(performance.now() - start);
    };
    const start = performance.now(); let previous;
    const frame = now => {
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      if (now - start < 3500) { requestAnimationFrame(frame); return; }
      view.update = original;
      const summary = values => {
        const sorted = [...values].sort((a, b) => a - b);
        return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
          median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)] };
      };
      resolve({ tick: view.simulation.snapshot.tick, units: view.simulation.snapshot.units.length,
        fps: 1000 / summary(intervals).mean, work: summary(work), intervals: summary(intervals),
        fullCopies: qa.fullCopies, cloneMilliseconds: qa.cloneMilliseconds,
        diagnostic: view.missionDiagnostic ?? null, outcome: view.missionOutcome });
    };
    requestAnimationFrame(frame);
  }));
  const profile = await client.send("Profiler.stop");
  writeFileSync(`${out}.cpuprofile`, JSON.stringify(profile.profile));
  writeFileSync(`${out}.json`, JSON.stringify({ startTick: save.checkpoint.simulation.tick, ...result, errors }, null, 2));
  await page.screenshot({ path: `${out}.png` });
  assert.deepEqual(errors, []);
  assert.equal(result.diagnostic, null);
  console.log(JSON.stringify({ out, ...result, errors }));
} finally { await browser.close(); }
