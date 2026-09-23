import { createElement as createIcon, Plus, Shield, Sword } from "lucide";
import type { MissionView } from "../mission-view";

type Producer = Pick<MissionView, "mission" | "productionMenu" | "purchaseProduction" | "renderProductionPortrait">;

export function productionChoicePresentation(mission: Pick<Producer, "mission">, choice: Producer["productionMenu"][number]) {
  if (choice.kind !== "upgrade") return { name: choice.sprite, action: `Produce ${choice.sprite}`, icon: Plus };
  const record = mission.mission.sourceProduction!.production!.records.find(entry => entry.id === choice.dependency)!;
  const channel = record.rawFields[2] === 0 ? "weapon" : "armor";
  const level = record.rawFields[3];
  return { name: `${choice.sprite} ${channel} ${level}`,
    action: `Upgrade ${channel}: ${choice.sprite}, level ${level}`, icon: channel === "weapon" ? Sword : Shield };
}

export function createProductionPanel(elements: {
  readonly region: HTMLElement;
  readonly portrait: HTMLElement;
  readonly credits: HTMLElement;
  readonly choices: HTMLElement;
}, isEnabled: (mission: Producer) => boolean) {
  elements.choices.tabIndex = 0;
  elements.choices.setAttribute("role", "group");
  elements.choices.setAttribute("aria-label", "Production choices");
  elements.choices.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "].includes(event.key)) {
      event.stopPropagation();
    }
  });
  let current: Producer | null = null;
  const render = (mission: Producer) => {
    current = mission;
    const menu = mission.productionMenu;
    elements.region.hidden = menu.length === 0;
    elements.portrait.hidden = menu.length > 0;
    if (!menu.length) { elements.choices.replaceChildren(); return; }
    elements.credits.textContent = String(menu[0].credits);
    for (const stale of Array.from(elements.choices.querySelectorAll<HTMLElement>("[data-production-choice]"))) {
      if (!menu.some((choice) => String(choice.dependency) === stale.dataset.productionChoice)) stale.remove();
    }
    for (const choice of menu) {
      const presentation = productionChoicePresentation(mission, choice);
      let row = elements.choices.querySelector<HTMLElement>(`[data-production-choice="${choice.dependency}"]`);
      if (!row) {
        row = document.createElement("div");
        row.className = "production-choice";
        row.dataset.productionChoice = String(choice.dependency);
        row.dataset.productionKind = choice.kind;
        const portrait = document.createElement(choice.kind === "upgrade" ? "div" : "canvas");
        if (portrait instanceof HTMLCanvasElement) {
          portrait.width = 48; portrait.height = 48;
          portrait.setAttribute("aria-label", choice.sprite);
        } else {
          portrait.className = "production-upgrade-icon";
          portrait.setAttribute("aria-hidden", "true");
          portrait.append(createIcon(presentation.icon, { width: 28, height: 28 }));
        }
        const name = document.createElement("strong");
        const cost = document.createElement("span");
        cost.className = "production-cost";
        const queued = document.createElement("span");
        queued.className = "production-queue";
        const purchase = document.createElement("button");
        purchase.type = "button";
        purchase.dataset.productionBuy = String(choice.dependency);
        purchase.append(createIcon(presentation.icon, { width: 16, height: 16, "aria-hidden": "true" }));
        purchase.addEventListener("click", () => {
          if (!current || !isEnabled(current)) return;
          current.purchaseProduction(choice.dependency);
          render(current);
        });
        row.append(portrait, name, cost, queued, purchase);
        elements.choices.append(row);
      }
      const button = row.querySelector<HTMLButtonElement>("button")!;
      row.querySelector("strong")!.textContent = presentation.name;
      row.querySelector(".production-cost")!.textContent = `${choice.cost} PETRA`;
      button.setAttribute("aria-label", presentation.action);
      button.disabled = !choice.enabled || !isEnabled(mission);
      button.title = choice.submitting ? "Purchase pending" : choice.nativeState !== 1 ? "Source restriction"
        : choice.maxAdditional === 0 ? "Insufficient credits or queue full" : `${presentation.action}: ${choice.cost} PETRA`;
      row.querySelector(".production-queue")!.textContent = choice.submitting || choice.pending > 0 ? "PENDING"
        : choice.kind === "upgrade" ? "" : `QUEUED ${choice.queued}`;
      const canvas = row.querySelector("canvas");
      if (canvas) mission.renderProductionPortrait(canvas, choice.dependency);
    }
  };
  return { render, reset() { current = null; elements.choices.replaceChildren(); elements.region.hidden = true; elements.portrait.hidden = false; } };
}