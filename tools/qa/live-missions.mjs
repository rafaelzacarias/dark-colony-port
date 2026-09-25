import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fallbackModule = "/tmp/darkcolony-browser-harness-20260918/node_modules/playwright-core/index.js";
const modulePath = process.env.PLAYWRIGHT_MODULE || (existsSync(fallbackModule) ? fallbackModule : "");
const executablePath = process.env.CHROMIUM_EXECUTABLE;
const baseUrl = process.env.LIVE_QA_URL || "http://127.0.0.1:5173/";
const artifactDirectory = await mkdtemp(join(tmpdir(), "darkcolony-live-missions-"));
const report = { baseUrl, artifactDirectory, checks: [], missions: {}, errors: [], failures: [] };

function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  report.checks.push({ name, actual, expected });
}

async function inspect(page, expression, argument) {
  return page.evaluate(({ source, argument }) => {
    const mission = globalThis.__liveQA.mission;
    if (!mission) throw new Error("Mission render probe did not observe a live mission");
    return (0, eval)(`(${source})`)(mission, argument);
  }, { source: expression.toString(), argument });
}

async function run() {
  assert.ok(modulePath, "Set PLAYWRIGHT_MODULE to an external playwright or playwright-core entry file");
  assert.ok(executablePath && existsSync(executablePath), "Set CHROMIUM_EXECUTABLE to an installed Chromium binary");
  const imported = await import(modulePath.startsWith("file:") ? modulePath : pathToFileURL(resolve(modulePath)).href);
  const { chromium } = imported.default ?? imported;
  const browser = await chromium.launch({ executablePath, headless: false, args: ["--use-angle=metal"] });
  try {
    for (const faction of ["human", "alien"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(15000);
      try {
        await runMission(page, faction);
      } catch (error) {
        report.failures.push({ faction, message: error.message, stack: error.stack });
        await page.screenshot({ path: join(artifactDirectory, `${faction}-failure.png`), fullPage: true }).catch(() => {});
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  check("browser/network errors", report.errors, []);
  check("mission failures", report.failures, []);
}

function installProbes() {
  const probe = globalThis.__liveQA = { audio: [], masters: [], masterChanges: [], worldDraws: [], radarDraws: [] };
  const encodedSources = new WeakMap();
  const decodedSources = new WeakMap();
  const connections = new WeakMap();
  const originalArrayBuffer = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = async function (...args) {
    const buffer = await originalArrayBuffer.apply(this, args);
    encodedSources.set(buffer, this.url);
    return buffer;
  };
  const originalDecode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (encoded, ...args) {
    const url = encodedSources.get(encoded);
    return originalDecode.call(this, encoded, ...args).then((buffer) => {
      decodedSources.set(buffer, url);
      return buffer;
    });
  };
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (destination, ...args) {
    const result = originalConnect.call(this, destination, ...args);
    const targets = connections.get(this) ?? new Set();
    targets.add(destination);
    connections.set(this, targets);
    if (this instanceof GainNode && destination instanceof AudioDestinationNode) probe.masters.push(this);
    return result;
  };
  const originalSetValue = AudioParam.prototype.setValueAtTime;
  AudioParam.prototype.setValueAtTime = function (value, time) {
    const result = originalSetValue.call(this, value, time);
    if (probe.masters.some((master) => master.gain === this)) probe.masterChanges.push({ value, time });
    return result;
  };
  const originalStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    const result = originalStart.apply(this, args);
    if (this.buffer?.length > 1) {
      const visited = new Set();
      const reachesOutput = (node) => {
        if (visited.has(node)) return false;
        visited.add(node);
        return node instanceof AudioDestinationNode || [...(connections.get(node) ?? [])].some(reachesOutput);
      };
      const samples = this.buffer.getChannelData(0);
      probe.audio.push({
        url: decodedSources.get(this.buffer), length: this.buffer.length,
        duration: this.buffer.duration, state: this.context.state,
        nonzero: samples.some((sample) => Math.abs(sample) > 0.0001),
        reachesOutput: reachesOutput(this), time: performance.now(),
      });
    }
    return result;
  };
  const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
    if (image instanceof HTMLImageElement && image.src.includes("/generated/terrain/") && args.length === 8) {
      const transform = this.getTransform();
      const left = Math.min(transform.a * args[4] + transform.e,
        transform.a * (args[4] + args[6]) + transform.e);
      const top = transform.d * args[5] + transform.f;
      const draw = [...args.slice(0, 4), left, top, args[6], args[7], transform.a < 0];
      if (this.canvas.id === "mission-canvas") probe.worldDraws.push(draw);
      else if (!this.canvas.id && args[6] === 2 && args[7] === 2) probe.radarDraws.push(draw);
    }
    return originalDraw.call(this, image, ...args);
  };
}

async function roster(page) {
  return page.locator("#archive-list button[data-unit-id]").evaluateAll((buttons) => buttons.map((button) => ({
    id: Number(button.dataset.unitId), cell: button.dataset.cell,
    selected: button.getAttribute("aria-selected") === "true",
    activity: button.querySelector("em")?.textContent,
  })));
}

async function runMission(page, faction) {
  const result = report.missions[faction] = { requests: [] };
  const responses = new Map();
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push({ faction, type: "console", message: message.text() });
  });
  page.on("pageerror", (error) => report.errors.push({ faction, type: "pageerror", message: error.message }));
  page.on("requestfailed", (request) => report.errors.push({ faction, type: "requestfailed", url: request.url(), message: request.failure()?.errorText }));
  page.on("response", (response) => {
    responses.set(new URL(response.url()).pathname, response);
    if (response.url().includes("/assets/generated/")) result.requests.push({ url: response.url(), status: response.status() });
    if (response.status() >= 400) report.errors.push({ faction, type: "http", url: response.url(), status: response.status() });
  });
  await page.addInitScript(installProbes);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.bringToFront();
  const moduleResponse = [...responses.values()].find((response) => /\/src\/mission-view\.ts(?:\?|$)/.test(response.url()));
  assert.ok(moduleResponse, "The live harness requires Vite's unbundled /src/mission-view.ts module");
  await page.evaluate(async (url) => {
    const { MissionView } = await import(url);
    const render = MissionView.prototype.render;
    MissionView.prototype.render = function (...args) {
      globalThis.__liveQA.mission = this;
      globalThis.__liveQA.worldDraws = [];
      return render.apply(this, args);
    };
  }, moduleResponse.url());
  await page.locator('[data-menu-open="new"]').click();
  await page.locator(`#campaign-launcher [data-campaign-faction="${faction}"]`).click();
  await page.locator("#mission-shell").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll("#archive-list button[data-unit-id]").length === 5);
  result.initialRoster = await roster(page);
  check(`${faction}: opening roster count`, result.initialRoster.length, 5);
  check(`${faction}: owned live units`, await inspect(page, (mission) => mission.simulation.snapshot.units.filter((unit) => mission.isOwnedUnit(unit.id) && unit.health > 0).length), 5);
  check(`${faction}: mission faction`, await inspect(page, (mission) => mission.playerFaction), faction);

  const stem = faction === "human" ? "HUMAN/HUMAN01" : "ALIEN/ALIEN01";
  const mapPath = `/assets/generated/maps/${stem}.json`;
  assert.ok(responses.has(mapPath), `${faction}: app requested source mission map`);
  const map = await responses.get(mapPath).json();
  check(`${faction}: map schema`, map.schemaVersion, 2);
  check(`${faction}: terrain layers per cell`, map.referencesPerCell, 2);
  const directory = mapPath.slice(0, mapPath.lastIndexOf("/") + 1);
  for (const layer of ["tileReferences", "tileRecordIndices", "attributes", "pathGrid", "tags"]) {
    const path = new URL(map.files[layer], new URL(directory, baseUrl)).pathname;
    assert.ok(responses.has(path), `${faction}: app requested ${layer}: ${path}`);
    const bytes = await responses.get(path).body();
    check(`${faction}: ${layer} bytes`, bytes.length, map.width * map.height * (["tileReferences", "tileRecordIndices"].includes(layer) ? 4 : layer === "attributes" ? 2 : 1));
    if (layer === "pathGrid") {
      check(`${faction}: loaded path matches response`, await inspect(page, (mission, expected) => mission.mission.pathGrid.every((family, index) => family === expected[index]), [...bytes]), true);
    }
  }
  const terrainPath = `/assets/generated/terrain/${map.terrainBank.replace(/\.bts$/i, "").toUpperCase()}.json`;
  assert.ok(responses.has(terrainPath), `${faction}: source terrain metadata requested`);
  const terrain = await responses.get(terrainPath).json();
  const atlasPath = new URL(terrain.atlas.file, new URL("/assets/generated/terrain/", baseUrl)).pathname;
  check(`${faction}: source terrain atlas requested`, responses.has(atlasPath), true);
  check(`${faction}: decoded source terrain image`, await inspect(page, (mission) => mission.terrainImage.complete && mission.terrainImage.naturalWidth === mission.mission.terrain.atlas.width), true);
  result.navigation = await inspect(page, (mission) => {
    let mismatches = 0;
    const families = {};
    mission.mission.pathGrid.forEach((family, index) => {
      families[family] = (families[family] ?? 0) + 1;
      if (mission.grid.isPassable(index % mission.grid.width, Math.floor(index / mission.grid.width)) !== (family !== 0 && family !== 255)) mismatches++;
    });
    return { mismatches, families };
  });
  check(`${faction}: PTH 0/255 blocked, other families passable`, result.navigation.mismatches, 0);

  result.terrainOrientation = await inspect(page, (mission) => {
    const { map, terrain, tileRecordIndices, attributes } = mission.mission;
    const view = mission.cameraView;
    const probe = globalThis.__liveQA;
    let worldMismatches = 0;
    let radarMismatches = 0;
    let discriminatingCells = 0;
    const matches = (draw, cellX, cellY) => {
      const offset = ((map.height - 1 - cellY) * map.width + cellX) * 2;
      const unflipped = (cellY * map.width + cellX) * 2;
      if (tileRecordIndices[offset] !== tileRecordIndices[unflipped]) discriminatingCells++;
      return [0, 1].some((layer) => {
        const tile = terrain.tiles[tileRecordIndices[offset + layer]];
        const mirrored = (attributes[offset / 2] & (layer === 0 ? 0x20 : 0x40)) !== 0;
        return tile && draw[8] === mirrored && draw.slice(0, 4).every((value, index) => value === [tile.x, tile.y, tile.width, tile.height][index]);
      });
    };
    for (const draw of probe.worldDraws) {
      const cellX = Math.round(view.x + draw[4] / 32);
      const cellY = Math.round(view.y + view.height - draw[5] / 32 - 1);
      if (!matches(draw, cellX, cellY)) worldMismatches++;
    }
    for (const draw of probe.radarDraws) if (!matches(draw, draw[4] / 2, map.height - 1 - draw[5] / 2)) radarMismatches++;
    return { worldMismatches, radarMismatches, discriminatingCells, worldDraws: probe.worldDraws.length, radarDraws: probe.radarDraws.length };
  });
  check(`${faction}: world terrain uses upward runtime Y`, result.terrainOrientation.worldMismatches, 0);
  check(`${faction}: radar preserves top-down source artwork`, result.terrainOrientation.radarMismatches, 0);
  check(`${faction}: meaningful terrain draw coverage`, result.terrainOrientation.worldDraws > 0 && result.terrainOrientation.radarDraws >= map.width * map.height && result.terrainOrientation.discriminatingCells > 0, true);

  const start = await inspect(page, (mission) => ({ tick: mission.simulation.snapshot.tick, time: performance.now() }));
  await page.waitForTimeout(5100);
  const end = await inspect(page, (mission) => ({ tick: mission.simulation.snapshot.tick, time: performance.now() }));
  result.observation = { milliseconds: end.time - start.time, ticks: end.tick - start.tick };
  check(`${faction}: observed at least five seconds`, result.observation.milliseconds >= 5000, true);
  check(`${faction}: live simulation advanced at least 75 ticks`, result.observation.ticks >= 75, true);
  check(`${faction}: five-unit roster remains alive`, (await roster(page)).length, 5);

  result.viewports = [];
  for (const width of [640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => document.querySelector("#mission-canvas").width === 512 && document.querySelector("#mission-canvas").height === 452);
    const geometry = await inspect(page, (mission) => {
      const bounds = mission.canvas.getBoundingClientRect();
      const pixels = mission.canvas.getContext("2d").getImageData(0, 0, 512, 452).data;
      let nonblank = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 60) nonblank++;
      return { backing: [mission.canvas.width, mission.canvas.height], view: mission.cameraView,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, nonblank };
    });
    check(`${faction}/${width}: invariant backing`, geometry.backing, [512, 452]);
    check(`${faction}/${width}: logical camera dimensions`, [geometry.view.width, geometry.view.height], [16, 452 / 32]);
    check(`${faction}/${width}: no horizontal overflow`, geometry.scrollWidth <= geometry.clientWidth, true);
    check(`${faction}/${width}: canvas is visible and nonblank`, geometry.bounds.width > 0 && geometry.bounds.height > 0 && geometry.nonblank > 1000, true);
    if (result.viewports.length) check(`${faction}: resizing preserves camera`, geometry.view, result.viewports[0].view);
    result.viewports.push({ width, ...geometry });
    await page.screenshot({ path: join(artifactDirectory, `${faction}-${width}.png`), fullPage: true });
  }

  const canvas = page.locator("#mission-canvas");
  await canvas.focus();
  await page.keyboard.press("F2");
  const selectedIds = await inspect(page, (mission) => mission.selectedIds);
  check(`${faction}: F2 selects five visible units`, selectedIds.length, 5);
  await page.keyboard.press("g");
  await page.keyboard.press("1");
  await canvas.click({ button: "right", position: { x: 8, y: 8 } });
  check(`${faction}: clear selection`, await inspect(page, (mission) => mission.selectedIds), []);
  await page.keyboard.press("1");
  check(`${faction}: group 1 recalls exact IDs`, await inspect(page, (mission) => mission.selectedIds), selectedIds);
  check(`${faction}: group recall reflected in roster`, (await roster(page)).filter((unit) => unit.selected).map((unit) => unit.id).sort((left, right) => left - right), selectedIds);

  result.destination = await inspect(page, (mission) => {
    const { width, height, pathGrid } = { ...mission.mission.map, pathGrid: mission.mission.pathGrid };
    const units = mission.simulation.snapshot.units.filter((unit) => mission.selectedIds.includes(unit.id));
    const occupied = new Set(mission.simulation.snapshot.units.map((unit) => unit.cellY * width + unit.cellX));
    const visibility = mission.visibility;
    const view = mission.cameraView;
    const passable = (cellX, cellY) => cellX >= 0 && cellY >= 0 && cellX < width && cellY < height && pathGrid[cellY * width + cellX] !== 0 && pathGrid[cellY * width + cellX] !== 255;
    const distances = units.map((unit) => {
      const distance = new Int32Array(width * height).fill(-1);
      const queue = [[unit.cellX, unit.cellY]];
      distance[unit.cellY * width + unit.cellX] = 0;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const [cellX, cellY] = queue[cursor];
        for (const [deltaX, deltaY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nextX = cellX + deltaX, nextY = cellY + deltaY;
          const index = nextY * width + nextX;
          if (!passable(nextX, nextY) || distance[index] !== -1) continue;
          distance[index] = distance[cellY * width + cellX] + 1;
          queue.push([nextX, nextY]);
        }
      }
      return distance;
    });
    const candidates = [];
    for (let cellY = 0; cellY < height; cellY++) for (let cellX = 0; cellX < width; cellX++) {
      const index = cellY * width + cellX;
      const logicalX = (cellX + 0.5 - view.x) * 32;
      const logicalY = (view.y + view.height - cellY - 0.5) * 32;
      const routes = distances.map((distance) => distance[index]);
      if (!passable(cellX, cellY) || occupied.has(index) || !visibility[index] || routes.some((distance) => distance < 3 || distance > 10)) continue;
      if (logicalX < 20 || logicalX > 492 || logicalY < 20 || logicalY > 432) continue;
      candidates.push({ cellX, cellY, logicalX, logicalY, family: pathGrid[index], visible: visibility[index], routes });
    }
    candidates.sort((left, right) => Math.abs(Math.max(...left.routes) - 6) - Math.abs(Math.max(...right.routes) - 6));
    return candidates[0] ?? null;
  });
  assert.ok(result.destination, `${faction}: found unoccupied, visible, reachable PTH destination`);
  check(`${faction}: destination PTH family allowed`, ![0, 255].includes(result.destination.family), true);
  check(`${faction}: destination visible and reachable from all selected units`, result.destination.visible > 0 && result.destination.routes.every((distance) => distance >= 3), true);
  const positions = (mission) => mission.simulation.snapshot.units.filter((unit) => mission.selectedIds.includes(unit.id)).map((unit) => ({ id: unit.id, x: unit.xSubcells, y: unit.ySubcells, activity: unit.activity }));
  result.beforeMove = await inspect(page, positions);
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: result.destination.logicalX * bounds.width / 512, y: result.destination.logicalY * bounds.height / 452 } });
  await page.waitForFunction((before) => {
    const mission = globalThis.__liveQA.mission;
    return before.every((old) => mission.simulation.snapshot.units.some((unit) => unit.id === old.id && (unit.xSubcells !== old.x || unit.ySubcells !== old.y)));
  }, result.beforeMove);
  result.afterMove = await inspect(page, positions);
  check(`${faction}: all five selected units displaced`, result.afterMove.filter((unit) => result.beforeMove.some((old) => old.id === unit.id && (old.x !== unit.x || old.y !== unit.y))).length, 5);
  check(`${faction}: move order still active before stop`, result.afterMove.some((unit) => unit.activity === "move"), true);
  await page.keyboard.press("s");
  await page.waitForFunction(() => {
    const mission = globalThis.__liveQA.mission;
    return mission.simulation.snapshot.units.filter((unit) => mission.selectedIds.includes(unit.id)).every((unit) => unit.activity === "idle");
  });
  const stopped = await inspect(page, positions);
  await page.waitForTimeout(450);
  check(`${faction}: S stops and holds exact unit positions`, await inspect(page, positions), stopped);

  const previousView = await inspect(page, (mission) => mission.cameraView);
  const radar = page.locator("#mission-radar");
  const radarBounds = await radar.boundingBox();
  assert.ok(radarBounds, `${faction}: radar visible`);
  await radar.click({ position: { x: radarBounds.width / 2, y: radarBounds.height / 2 } });
  const nextView = await inspect(page, (mission) => mission.cameraView);
  check(`${faction}: radar click changes camera`, JSON.stringify(previousView) !== JSON.stringify(nextView), true);
  check(`${faction}: radar center pans to map center`, Math.abs(nextView.x + nextView.width / 2 - map.width / 2) < 1 && Math.abs(nextView.y + nextView.height / 2 - map.height / 2) < 1, true);
  check(`${faction}: radar pan preserves selection`, await inspect(page, (mission) => mission.selectedIds), selectedIds);
  result.radar = { previousView, nextView };

  await canvas.focus();
  await page.keyboard.press("j");
  check(`${faction}: J opens objectives`, await page.locator("#objectives-panel").isVisible(), true);
  check(`${faction}: source objectives present`, (await page.locator("#objectives-list li").allTextContents()).filter((text) => text.trim()).length > 0, true);
  await page.keyboard.press("j");
  check(`${faction}: J closes objectives`, await page.locator("#objectives-panel").isVisible(), false);

  await page.waitForFunction(() => globalThis.__liveQA.audio.some((voice) => voice.url?.includes("/assets/generated/") && voice.nonzero && voice.reachesOutput && voice.state === "running"));
  const mute = page.locator("#mission-mute");
  await mute.check();
  check(`${faction}: mute checked`, await mute.isChecked(), true);
  check(`${faction}: master gain scheduled to mute`, await page.evaluate(() => globalThis.__liveQA.masterChanges.at(-1)?.value), 0);
  const beforeMuted = await page.evaluate(() => globalThis.__liveQA.audio.length);
  await canvas.focus();
  await page.keyboard.press("1");
  await page.waitForTimeout(350);
  check(`${faction}: muted selection starts no source voice`, await page.evaluate(() => globalThis.__liveQA.audio.length), beforeMuted);
  await mute.uncheck();
  check(`${faction}: mute unchecked`, await mute.isChecked(), false);
  check(`${faction}: master gain scheduled to restore`, await page.evaluate(() => globalThis.__liveQA.masterChanges.at(-1)?.value), 0.7);
  result.masterGainChanges = await page.evaluate(() => globalThis.__liveQA.masterChanges);
  await canvas.focus();
  await page.keyboard.press("1");
  await page.waitForFunction((count) => globalThis.__liveQA.audio.length > count, beforeMuted);
  result.audio = await page.evaluate(() => globalThis.__liveQA.audio);
  check(`${faction}: real decoded source audio reaches running output`, result.audio.every((voice) => Boolean(voice.url?.includes("/assets/generated/")) && voice.length > 1 && voice.nonzero && voice.reachesOutput && voice.state === "running"), true);
  check(`${faction}: source audio request observed`, result.audio.every((voice) => result.requests.some((request) => request.url === voice.url && request.status === 200)), true);
  await page.screenshot({ path: join(artifactDirectory, `${faction}-controls.png`), fullPage: true });
  await page.waitForLoadState("networkidle");
  check(`${faction}: no browser/network errors`, report.errors.filter((error) => error.faction === faction), []);
}

try {
  await run();
} catch (error) {
  report.failures.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  report.passed = report.failures.length === 0 && report.errors.length === 0;
  if (!report.passed) process.exitCode = 1;
  await writeFile(join(artifactDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures, errors: report.errors, artifactDirectory }, null, 2));
}