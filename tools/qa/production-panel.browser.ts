import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { createProductionPanel } from "../../src/ui/production-panel";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function productionPanelReview(faction: "human" | "alien", missionNumber = 3) {
  check(missionNumber >= 3, "Use an adapted mission with the expanded production roster");
  const mission = await loadCampaignMission(faction, missionNumber, "browser-adapted");
  const shell = document.querySelector<HTMLElement>("#mission-shell")!.cloneNode(true) as HTMLElement;
  const stage = document.createElement("div");
  stage.dataset.productionReview = faction;
  stage.style.cssText = "position:fixed;inset:0;z-index:10000;background:#000;overflow:hidden";
  shell.hidden = false;
  stage.append(shell);
  document.body.append(stage);
  const canvas = shell.querySelector<HTMLCanvasElement>("#mission-canvas")!;
  const controls = shell.querySelector<HTMLElement>("#campaign-controls")!;
  controls.hidden = false;
  canvas.hidden = false;
  shell.querySelector<HTMLElement>("#campaign-faction")!.textContent = mission.scenario.title.toUpperCase();
  const region = shell.querySelector<HTMLElement>("#mission-production")!;
  const choices = shell.querySelector<HTMLElement>("#production-choices")!;
  const portrait = shell.querySelector<HTMLElement>(".legacy-portrait")!;
  const credits = shell.querySelector<HTMLElement>("#production-credits")!;
  const view = new MissionView(canvas, stage, { onStats() {}, onUnitsChanged() {} }, mission);
  const panel = createProductionPanel({ region, choices, portrait, credits }, () => true);
  const resize = () => {
    shell.style.transform = `translate(-50%, -50%) scale(${Math.min(stage.clientWidth / 640, stage.clientHeight / 480)})`;
  };
  const dispose = () => {
    window.removeEventListener("resize", resize);
    panel.reset();
    view.dispose();
    stage.remove();
  };
  try {
    resize();
    window.addEventListener("resize", resize);
    await view.initialize();
    check(!view.missionDiagnostic, view.missionDiagnostic ?? "Mission initialization failed");
    panel.render(view);
    check(mission.sourceProduction?.production?.adaptedUnitProfiles?.length, "Adapted roster flag missing");
    check(mission.sourceProduction.production.adaptedUpgrades?.runtimeProfile === "browser-adapted", "Adapted upgrades flag missing");
    check(view.productionMenu.filter(choice => choice.kind === "unit").length === 6, "Expanded unit menu missing");
    check(view.productionMenu.filter(choice => choice.kind === "upgrade").length === 24, "Expanded upgrade menu missing");
    check(choices.tabIndex === 0, "Production list must accept keyboard focus");
    let escapedKeys = 0;
    const countKey = () => { escapedKeys += 1; };
    shell.addEventListener("keydown", countKey);
    for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      choices.dispatchEvent(event);
      check(!event.defaultPrevented, `Native list navigation prevented: ${key}`);
    }
    shell.removeEventListener("keydown", countKey);
    check(escapedKeys === 0, "List navigation leaked to mission keyboard controls");
    const pixels = view.productionMenu.map(choice => {
      const row = choices.querySelector<HTMLElement>(`[data-production-choice="${choice.dependency}"]`)!;
      const button = row.querySelector<HTMLButtonElement>("button")!;
      check(button.disabled === !choice.enabled, `Incorrect purchase state: ${choice.sprite}`);
      if (choice.kind === "upgrade") {
        const record = mission.sourceProduction!.production!.records.find(entry => entry.id === choice.dependency)!;
        const channel = record.rawFields[2] === 0 ? "weapon" : "armor";
        const label = `Upgrade ${channel}: ${choice.sprite}, level ${record.rawFields[3]}`;
        check(button.getAttribute("aria-label") === label, `Ambiguous upgrade action: ${label}`);
        check(row.querySelector("strong")!.textContent === `${choice.sprite} ${channel} ${record.rawFields[3]}`, "Upgrade heading missing level");
        check(!row.querySelector("canvas"), "Upgrade must not require an unadmitted unit portrait");
        check(row.querySelectorAll("svg").length === 2, "Upgrade icons missing");
        check(!row.querySelector(".production-queue")!.textContent!.includes("QUEUED"), "Upgrade mislabeled as unit queue");
        return { sprite: choice.sprite, unitType: choice.unitType, kind: choice.kind, label, icons: 2 };
      }
      check(button.getAttribute("aria-label") === `Produce ${choice.sprite}`, "Unit production action changed");
      const surface = row.querySelector("canvas")!;
      const rgba = surface.getContext("2d")!.getImageData(0, 0, surface.width, surface.height).data;
      let opaque = 0;
      let colored = 0;
      const colors = new Set<number>();
      for (let offset = 0; offset < rgba.length; offset += 4) {
        if (!rgba[offset + 3]) continue;
        opaque += 1;
        if (rgba[offset] || rgba[offset + 1] || rgba[offset + 2]) colored += 1;
        colors.add((rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2]);
      }
      check(opaque > 20 && colored > 20 && colors.size > 4, `Blank portrait: ${choice.sprite}`);
      return { sprite: choice.sprite, unitType: choice.unitType, kind: choice.kind, opaque, colored, colors: colors.size };
    });
    const layout = () => {
      resize();
      const shellBounds = shell.getBoundingClientRect();
      check(shellBounds.left >= -1 && shellBounds.top >= -1 && shellBounds.right <= innerWidth + 1
        && shellBounds.bottom <= innerHeight + 1, "Mission HUD is clipped by the viewport");
      const rows = Array.from(choices.querySelectorAll<HTMLElement>("[data-production-choice]"));
      check(getComputedStyle(choices).overflowY === "auto", "Expanded menu must scroll");
      check(choices.scrollWidth <= choices.clientWidth, "Production list overflows horizontally");
      const text = rows.flatMap(row => Array.from(row.querySelectorAll<HTMLElement>("strong,span,button")));
      for (const element of text) {
        check(element.scrollWidth <= element.clientWidth + 1, `Text width overflow: ${element.textContent}`);
        check(element.scrollHeight <= element.clientHeight + 1, `Text height overflow: ${element.textContent}`);
      }
      choices.scrollTop = choices.scrollHeight;
      const last = rows.at(-1)!;
      const listBounds = choices.getBoundingClientRect();
      const lastBounds = last.getBoundingClientRect();
      check(lastBounds.bottom <= listBounds.bottom + 1 && lastBounds.top >= listBounds.top - 1,
        "Last production choice is not fully reachable");
      const retainedScroll = choices.scrollTop;
      panel.render(view);
      check(choices.scrollTop === retainedScroll, "Panel refresh reset scroll position");
      check(choices.lastElementChild === last, "Panel refresh replaced focused rows");
      const commands = shell.querySelector<HTMLElement>(".legacy-command-grid")!.getBoundingClientRect();
      check(region.getBoundingClientRect().bottom <= commands.top + 1, "Production covers command controls");
      const result = { width: innerWidth, height: innerHeight, entries: rows.length,
        listHeight: choices.clientHeight, scrollHeight: choices.scrollHeight, lastReachable: true,
        textOverflow: false, overlapsCommands: false };
      choices.scrollTop = 0;
      return result;
    };
    const verifyReset = () => {
      panel.reset();
      check(region.hidden && !portrait.hidden && choices.children.length === 0, "Panel reset failed");
      panel.render(view);
      check(!region.hidden && portrait.hidden && choices.children.length === pixels.length, "Panel rebuild failed");
    };
    verifyReset();
    return { faction, missionNumber, pixels, layout, dispose, view, shell, choices };
  } catch (error) {
    dispose();
    throw error;
  }
}