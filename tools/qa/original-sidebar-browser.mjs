// Headed-Chromium check of the original MAINE sidebar and of commando-mission launches against a running dev server.
// Replaces the pre-sidebar scripts (browser-construction-browser.mjs, construction-panel-browser.mjs,
// production-panel.browser.ts), which target the removed #mission-production/#mission-construction panels.
// Usage: node tools/qa/original-sidebar-browser.mjs [outputStem] [baseUrl]
// Env: DC_PLAYWRIGHT_CORE (playwright-core index.js), DC_CHROMIUM (browser executable).
import { writeFileSync } from "node:fs";

const pw = (await import(process.env.DC_PLAYWRIGHT_CORE ?? "/tmp/dc-production-portrait-browser-qa/node_modules/playwright-core/index.js")).default;
const out = process.argv[2] ?? `/tmp/dc-original-sidebar-${Date.now()}`;
const base = process.argv[3] ?? "http://localhost:5173/";
const browser = await pw.chromium.launch({ headless: false,
  executablePath: process.env.DC_CHROMIUM ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  args: ["--use-angle=metal", "--window-position=2400,1200", "--autoplay-policy=no-user-gesture-required"] });
const report = { errors: [], layouts: [], launches: [] };

async function launch(context, mission) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.goto(base);
  await page.locator("#campaign-launcher").waitFor({ state: "visible" });
  if (await page.evaluate(() => !!document.querySelector(".cinematic-player"))) await page.keyboard.press("Escape");
  await page.locator('[data-menu-open="new"]').click();
  await page.locator(".mission-select-details summary").click();
  await page.locator(`#campaign-mission-picker input[value="${mission.startsWith("ALIEN") ? "alien" : "human"}"]`).check();
  await page.selectOption("#campaign-mission-picker select", { label: mission });
  await page.locator("#campaign-mission-picker button[data-mission-launch]").click();
  await page.locator("#campaign-controls").waitFor({ state: "visible", timeout: 120000 });
  return { page, errors };
}

try {
  for (const [label, viewport, extra] of [["desktop", { width: 1280, height: 900 }, {}],
    ["mobile", { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const context = await browser.newContext({ viewport, ...extra });
    const { page, errors } = await launch(context, "HUMAN10");
    await page.locator('[data-original-tab="build"]').click();
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".original-base-grid button")].map(button => button.getBoundingClientRect());
      const overlaps = [];
      for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i], b = buttons[j];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) overlaps.push([i, j]);
      }
      return { grid: buttons.length, overlaps, build: !!document.querySelector("#mission-build"),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    await page.locator("#mission-shell").screenshot({ path: `${out}-${label}-build.png` });
    report.layouts.push({ label, layout, errors });
    await context.close();
  }
  for (const mission of ["HUMAN06", "HUMAN11", "HUMAN14", "ALIEN05", "ALIEN09", "ALIEN14"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await launch(context, mission);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${out}-${mission}.png` });
    report.launches.push({ mission, errors });
    await context.close();
  }
} catch (error) {
  report.errors.push(String(error?.stack ?? error));
} finally {
  writeFileSync(`${out}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
const failed = report.errors.length || report.layouts.some(entry => entry.errors.length || entry.layout.overlaps.length || entry.layout.overflow)
  || report.launches.some(entry => entry.errors.length);
console.log(JSON.stringify({ out, failed: Boolean(failed) }));
process.exitCode = failed ? 1 : 0;
