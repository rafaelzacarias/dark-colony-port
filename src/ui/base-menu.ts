import type { MissionView } from "../mission-view";
import { loadMainButtonAtlas, MAINBUT_DIGIT_FRAME, MAINE_MENU_BUTTONS, MAINE_TABS, paintMainButtonFrame,
  type MainButtonAtlas, type MaineTab } from "./original-interface";

type Menu = Pick<MissionView, "mission" | "productionMenu" | "constructionMenu" | "purchaseProduction" | "purchaseConstruction">;

// DEPEND.TXT interfaceId for construction dependencies, used when the mission carries no production catalog.
export const CONSTRUCTION_INTERFACE_IDS: Readonly<Record<number, number>> = {
  0: 206, 1: 80, 2: 81, 3: 82, 4: 85, 5: 86, 6: 83, 14: 205, 15: 41, 16: 42, 17: 43, 18: 97, 19: 98, 20: 44,
};

export interface BaseMenuEntry {
  readonly key: string;
  readonly source: "production" | "construction";
  readonly kind: "unit" | "upgrade" | "building";
  readonly dependency: number;
  readonly interfaceId: number;
  readonly tab: "build" | "research";
  readonly x: number;
  readonly y: number;
  readonly frame: number;
  readonly text: string;
  readonly cost: number;
  /** 0 completed, 1 available, 2 blocked: the DEPEND eligibility codes. */
  readonly state: 0 | 1 | 2;
  readonly enabled: boolean;
  readonly submitting: boolean;
  readonly maxStage: number;
  readonly count: number;
  readonly reason: string;
  readonly progress?: { readonly value: number; readonly max: number };
}

function interfaceIdFor(mission: Menu, dependency: number): number | undefined {
  const records = mission.mission.sourceProduction?.production?.records as readonly { id: number; interfaceId?: number }[] | undefined;
  return records?.find(record => record.id === dependency)?.interfaceId ?? CONSTRUCTION_INTERFACE_IDS[dependency];
}

/** Resolves every offered action to its original MAINE cell; cells shared by a building and its upgrade show the next actionable level. */
export function baseMenuEntries(mission: Menu): BaseMenuEntry[] {
  const entries: BaseMenuEntry[] = [];
  const construction = mission.constructionMenu.filter((choice): choice is Extract<typeof choice, { cost: number }> => "cost" in choice);
  for (const choice of construction) {
    const interfaceId = interfaceIdFor(mission, choice.dependency);
    const button = interfaceId === undefined ? undefined : MAINE_MENU_BUTTONS[interfaceId];
    if (!button) continue;
    const complete = choice.status === "complete";
    entries.push({ key: `c:${choice.dependency}`, source: "construction", kind: "building", dependency: choice.dependency,
      interfaceId: interfaceId!, tab: "build", x: button[0], y: button[1], frame: button[2], text: button[3], cost: choice.cost,
      state: complete ? 0 : choice.requestEnabled ? 1 : 2, enabled: choice.requestEnabled, submitting: choice.submitting,
      maxStage: choice.requestEnabled ? 1 : 0, count: 0, reason: complete ? "Complete" : choice.reason,
      ...(choice.status === "constructing" ? { progress: { value: choice.visits, max: choice.completionVisits } } : {}) });
  }
  for (const choice of mission.productionMenu) {
    if (entries.some(entry => entry.dependency === choice.dependency)) continue;
    const button = MAINE_MENU_BUTTONS[choice.interfaceId];
    if (!button || choice.kind === "unknown") continue;
    const reason = choice.submitting ? "Purchase pending" : choice.nativeState === 0 ? "Complete"
      : choice.nativeState !== 1 ? "Source restriction" : choice.maxAdditional === 0 ? "Insufficient PETRA or queue full" : "";
    entries.push({ key: `p:${choice.dependency}`, source: "production", kind: choice.kind, dependency: choice.dependency,
      interfaceId: choice.interfaceId, tab: choice.kind === "upgrade" ? "research" : "build",
      x: button[0], y: button[1], frame: button[2], text: button[3], cost: choice.cost, state: choice.nativeState,
      enabled: choice.enabled, submitting: choice.submitting, maxStage: choice.kind === "unit" ? choice.maxAdditional : Math.min(1, choice.maxAdditional),
      count: choice.kind === "unit" ? choice.queued + choice.pending : 0, reason });
  }
  const cells = new Map<string, BaseMenuEntry[]>();
  for (const entry of entries) {
    const cell = `${entry.tab}:${entry.x},${entry.y}`;
    cells.set(cell, [...cells.get(cell) ?? [], entry]);
  }
  return [...cells.values()].map(candidates => candidates.find(entry => entry.state === 1)
    ?? candidates.find(entry => entry.state === 2) ?? candidates.at(-1)!);
}

export function createBaseMenu(root: HTMLElement, options: {
  readonly isEnabled: (mission: Menu) => boolean;
  readonly onTabChange: (tab: MaineTab) => void;
}) {
  let atlas: MainButtonAtlas | undefined;
  let current: Menu | undefined;
  let tab: MaineTab = "build";
  let entries: BaseMenuEntry[] = [];
  const staged = new Map<string, number>();
  const commits: string[] = [];

  const tabIndicator = document.createElement("div");
  tabIndicator.className = "original-tab-indicator";
  tabIndicator.setAttribute("aria-hidden", "true");
  const tabs = document.createElement("div");
  tabs.className = "original-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Sidebar tabs");
  for (const definition of MAINE_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.dataset.originalTab = definition.id;
    button.title = definition.label;
    button.setAttribute("aria-label", definition.label);
    button.style.left = `${definition.x}px`;
    button.style.width = `${definition.width}px`;
    button.addEventListener("click", () => {
      tab = definition.id;
      options.onTabChange(tab);
      if (current) render(current);
    });
    tabs.append(button);
  }
  const grid = document.createElement("div");
  grid.className = "original-base-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Building and research menu");
  const info = document.createElement("output");
  info.className = "original-menu-info";
  const build = document.createElement("button");
  build.type = "button";
  build.id = "mission-build";
  build.title = "Push to build";
  build.setAttribute("aria-label", "Push to build");
  const credits = document.createElement("output");
  credits.id = "mission-credits";
  credits.className = "original-credits";
  root.append(tabIndicator, tabs, grid, info, build, credits);

  function setTab(next: MaineTab): void {
    tab = next;
  }

  const stagedTotal = () => [...staged.values()].reduce((sum, count) => sum + count, 0);
  const describe = (entry: BaseMenuEntry) => entry.reason ? `${entry.text} · ${entry.reason}` : entry.text;

  function stage(key: string, delta: 1 | -1): void {
    const entry = entries.find(candidate => candidate.key === key);
    if (!entry || !current || !options.isEnabled(current)) return;
    const next = (staged.get(key) ?? 0) + delta;
    if (next < 0) return;
    if (delta > 0 && next > entry.maxStage) {
      info.value = entry.kind === "unit" && entry.enabled ? "Too many units" : describe(entry);
      return;
    }
    if (next === 0) staged.delete(key); else staged.set(key, next);
    info.value = describe(entry);
    render(current);
  }

  build.addEventListener("click", () => {
    if (!current || !options.isEnabled(current) || stagedTotal() === 0) return;
    for (const [key, count] of staged) for (let index = 0; index < count; index++) commits.push(key);
    staged.clear();
    render(current);
  });

  // Production and construction accept one pending request per committed frame, so queued BUILD orders drain across renders.
  function drain(mission: Menu): void {
    if (!commits.length || !options.isEnabled(mission)) return;
    const key = commits[0];
    const pending = key.startsWith("p:") ? mission.productionMenu.some(choice => choice.submitting)
      : mission.constructionMenu.some(choice => "submitting" in choice && choice.submitting);
    if (pending) return;
    commits.shift();
    const dependency = Number(key.slice(2));
    if (key.startsWith("p:") ? mission.purchaseProduction(dependency) : mission.purchaseConstruction(dependency)) return;
    commits.splice(0, commits.length, ...commits.filter(candidate => candidate !== key));
    info.value = baseMenuEntries(mission).find(entry => entry.key === key)?.reason || "Unavailable";
  }

  function paintDigits(value: number): void {
    const digits = String(Math.max(0, Math.min(999999, Math.floor(value))));
    while (credits.children.length < digits.length) credits.append(document.createElement("span"));
    while (credits.children.length > digits.length) credits.lastElementChild!.remove();
    [...digits].forEach((digit, index) => paintMainButtonFrame(credits.children[index] as HTMLElement, atlas!, MAINBUT_DIGIT_FRAME + Number(digit)));
  }

  function render(mission: Menu): { readonly tab: MaineTab; readonly buildEntries: number } {
    current = mission;
    if (!atlas) {
      void loadMainButtonAtlas().then(loaded => { atlas = loaded; if (current) render(current); }, error => { info.value = String(error); });
      entries = [];
      return { tab, buildEntries: 0 };
    }
    drain(mission);
    entries = baseMenuEntries(mission);
    for (const key of [...staged.keys()]) if (!entries.some(entry => entry.key === key && entry.maxStage > 0)) staged.delete(key);
    paintMainButtonFrame(tabIndicator, atlas, MAINE_TABS.find(definition => definition.id === tab)!.frame);
    for (const button of Array.from(tabs.querySelectorAll<HTMLButtonElement>("button"))) {
      button.setAttribute("aria-selected", String(button.dataset.originalTab === tab));
    }
    const shown = entries.filter(entry => entry.tab === tab);
    grid.hidden = shown.length === 0;
    for (const stale of Array.from(grid.querySelectorAll<HTMLElement>("[data-menu-key]"))) {
      if (!shown.some(entry => entry.key === stale.dataset.menuKey)) stale.remove();
    }
    for (const entry of shown) {
      let button = grid.querySelector<HTMLButtonElement>(`[data-menu-key="${entry.key}"]`);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.menuKey = entry.key;
        const count = document.createElement("span");
        count.className = "original-menu-count";
        const progress = document.createElement("progress");
        button.append(count, progress);
        const key = entry.key;
        button.addEventListener("click", () => stage(key, 1));
        button.addEventListener("contextmenu", event => { event.preventDefault(); stage(key, -1); });
        button.addEventListener("pointerenter", () => {
          const hovered = entries.find(candidate => candidate.key === key);
          if (hovered) info.value = describe(hovered);
        });
        button.addEventListener("pointerleave", () => { info.value = ""; });
        grid.append(button);
      }
      button.dataset.menuKind = entry.kind;
      button.dataset.menuState = String(entry.state);
      if (entry.source === "production") button.dataset.productionBuy = String(entry.dependency);
      else button.dataset.constructionBuy = String(entry.dependency);
      button.style.left = `${entry.x}px`;
      button.style.top = `${entry.y}px`;
      paintMainButtonFrame(button, atlas, entry.frame);
      button.setAttribute("aria-label", `${entry.text.replace(/\s+/g, " ")} PETRA${entry.reason ? `, ${entry.reason}` : ""}`);
      button.title = describe(entry).replace(/\s+/g, " ");
      button.disabled = !options.isEnabled(mission);
      button.setAttribute("aria-disabled", String(entry.maxStage === 0 && !staged.has(entry.key)));
      const stagedCount = staged.get(entry.key) ?? 0;
      const count = button.querySelector<HTMLElement>(".original-menu-count")!;
      const shownCount = entry.count + stagedCount + commits.filter(candidate => candidate === entry.key).length;
      count.textContent = shownCount > 0 ? String(shownCount) : "";
      count.classList.toggle("staged", stagedCount > 0);
      count.classList.toggle("building", entry.kind !== "unit");
      const progress = button.querySelector("progress")!;
      progress.hidden = !entry.progress;
      if (entry.progress) { progress.max = entry.progress.max; progress.value = entry.progress.value; }
    }
    build.disabled = stagedTotal() === 0 || !options.isEnabled(mission);
    build.dataset.staged = String(stagedTotal());
    const balance = mission.productionMenu[0]?.credits
      ?? mission.constructionMenu.find((choice): choice is Extract<typeof choice, { credits: number }> => "credits" in choice)?.credits;
    credits.hidden = balance === undefined;
    credits.setAttribute("aria-label", balance === undefined ? "" : `PETRA ${balance}`);
    if (balance !== undefined) paintDigits(balance);
    return { tab, buildEntries: entries.filter(entry => entry.tab === "build").length };
  }

  return {
    render,
    get tab() { return tab; },
    setTab,
    reset() {
      current = undefined;
      tab = "build";
      entries = [];
      staged.clear();
      commits.length = 0;
      grid.replaceChildren();
      info.value = "";
      credits.hidden = true;
      build.disabled = true;
    },
  };
}
