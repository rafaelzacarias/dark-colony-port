import { createElement as createIcon, Hammer, ArrowUp } from "lucide";
import type { MissionView } from "../mission-view";

type Builder = Pick<MissionView, "mission" | "constructionMenu" | "productionMenu" | "purchaseConstruction">;

export function constructionChoicePresentation(choice: Extract<MissionView["constructionMenu"][number], { cost: number }>) {
  const upgrade = choice.action === "upgrade";
  return { name: `${choice.label}${upgrade ? " level 1" : ""}`,
    action: `${upgrade ? "Upgrade" : "Build"} ${choice.label.toLowerCase()}`, icon: upgrade ? ArrowUp : Hammer };
}

export function createConstructionPanel(region: HTMLElement, isEnabled: (mission: Builder) => boolean) {
  const balance = document.createElement("span");
  balance.className = "construction-balance";
  const choices = document.createElement("div");
  choices.className = "construction-choices";
  choices.tabIndex = 0;
  choices.setAttribute("aria-label", "Fixed-site build choices");
  choices.addEventListener("keydown", event => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "].includes(event.key)) event.stopPropagation();
  });
  region.append(balance, choices);
  let current: Builder | undefined;
  const render = (mission: Builder): boolean => {
    current = mission;
    const menu = mission.constructionMenu.filter(entry => "cost" in entry);
    const visible = menu.length > 0;
    region.hidden = !visible;
    if (!visible) return false;
    balance.textContent = `PETRA ${menu[0].credits}`;
    for (const stale of Array.from(choices.querySelectorAll<HTMLElement>("[data-construction-choice]"))) {
      if (!menu.some(choice => String(choice.dependency) === stale.dataset.constructionChoice)) stale.remove();
    }
    for (const choice of menu) {
      const presentation = constructionChoicePresentation(choice);
      let row = choices.querySelector<HTMLElement>(`[data-construction-choice="${choice.dependency}"]`);
      if (!row) {
        row = document.createElement("div");
        row.className = "construction-choice";
        row.dataset.constructionChoice = String(choice.dependency);
        const name = document.createElement("strong");
        const price = document.createElement("span");
        price.className = "construction-cost";
        const progress = document.createElement("progress");
        const reason = document.createElement("span");
        reason.className = "construction-state";
        const purchase = document.createElement("button");
        purchase.type = "button";
        purchase.dataset.constructionBuy = String(choice.dependency);
        purchase.append(createIcon(presentation.icon, { width: 16, height: 16, "aria-hidden": "true" }));
        purchase.addEventListener("click", () => {
          if (current && isEnabled(current)) { current.purchaseConstruction(choice.dependency); render(current); }
        });
        row.append(name, price, reason, progress, purchase);
        choices.append(row);
      }
      row.querySelector("strong")!.textContent = presentation.name;
      row.querySelector(".construction-cost")!.textContent = `${choice.cost} PETRA`;
      row.querySelector(".construction-state")!.textContent = choice.reason.startsWith("Requires level-1 laboratory")
        ? "Needs laboratory level 1" : choice.reason === "Source building already allocated" ? "Already allocated" : choice.reason || "Available";
      const progress = row.querySelector("progress")!;
      progress.setAttribute("aria-label", `${choice.label} construction progress`);
      progress.max = choice.completionVisits;
      progress.value = choice.visits;
      progress.hidden = choice.status !== "constructing" || choice.health === 0;
      const purchase = row.querySelector("button")!;
      purchase.disabled = !choice.requestEnabled || !isEnabled(mission);
      purchase.setAttribute("aria-label", presentation.action);
      purchase.title = choice.reason || `${presentation.action}: ${choice.cost} PETRA; fixed home site; ${choice.completionVisits * 0.05}s adapted construction`;
    }
    return true;
  };
  return { render, reset() { current = undefined; region.hidden = true; choices.replaceChildren(); } };
}