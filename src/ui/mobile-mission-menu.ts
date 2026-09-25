import type { BaseMenuEntry } from "./base-menu";
import { loadMainButtonAtlas, paintMainButtonFrame, type MainButtonAtlas } from "./original-interface";

export interface MobileMissionMenuState {
  readonly title: string;
  readonly entries: readonly BaseMenuEntry[];
  readonly credits?: number;
  readonly objectives: readonly string[];
  readonly enabled: boolean;
  readonly muted: boolean;
  readonly saveDisabled: boolean;
  readonly saveStatus: string;
}

type MobileMenuTab = "build" | "research" | "options";

export function createMobileMissionMenu(parent: HTMLElement, callbacks: {
  readonly onPurchase: (key: string) => { readonly ok: boolean; readonly message: string };
  readonly onSave: () => void;
  readonly onLoad: () => void;
  readonly onToggleMute: () => void;
  readonly onExit: () => void;
  readonly onClose: () => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "mobile-mission-menu";
  dialog.id = "mobile-mission-menu";
  dialog.setAttribute("aria-labelledby", "mobile-menu-title");
  dialog.innerHTML = `
    <header class="mobile-menu-heading">
      <div><p>FIELD COMMAND</p><h2 id="mobile-menu-title">Base operations</h2></div>
      <button type="button" data-mobile-menu-close aria-label="Close command menu">Close</button>
    </header>
    <div class="mobile-menu-resources"><span data-mobile-credits></span><span>Battle continues while open</span></div>
    <nav class="mobile-menu-tabs" aria-label="Command menu">
      <button type="button" data-mobile-tab="build">Build</button>
      <button type="button" data-mobile-tab="research">Research</button>
      <button type="button" data-mobile-tab="options">Mission</button>
    </nav>
    <div class="mobile-menu-body">
      <p class="mobile-menu-hint">Tap an available item to order one. Costs are deducted when the order is accepted.</p>
      <div class="mobile-build-cards"></div>
      <p class="mobile-menu-empty" hidden>No orders available for this mission.</p>
      <section class="mobile-mission-options" hidden>
        <h3>Mission objectives</h3>
        <ul class="mobile-objectives"></ul>
        <div class="mobile-option-buttons">
          <button type="button" data-mobile-option="save">Save game</button>
          <button type="button" data-mobile-option="load">Load game</button>
          <button type="button" data-mobile-option="mute" aria-pressed="true">Sound off</button>
          <button type="button" data-mobile-option="exit">Main menu</button>
        </div>
        <output class="mobile-save-status" role="status"></output>
      </section>
    </div>
    <output class="mobile-order-status" role="status"></output>
  `;
  parent.append(dialog);
  const controller = new AbortController();
  const { signal } = controller;
  const query = <T extends Element>(selector: string) => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing mobile menu element: ${selector}`);
    return element;
  };
  const title = query<HTMLElement>("#mobile-menu-title");
  const credits = query<HTMLElement>("[data-mobile-credits]");
  const cards = query<HTMLElement>(".mobile-build-cards");
  const hint = query<HTMLElement>(".mobile-menu-hint");
  const empty = query<HTMLElement>(".mobile-menu-empty");
  const options = query<HTMLElement>(".mobile-mission-options");
  const objectives = query<HTMLElement>(".mobile-objectives");
  const save = query<HTMLButtonElement>('[data-mobile-option="save"]');
  const mute = query<HTMLButtonElement>('[data-mobile-option="mute"]');
  const status = query<HTMLOutputElement>(".mobile-order-status");
  const saveStatus = query<HTMLOutputElement>(".mobile-save-status");
  let tab: MobileMenuTab = "build";
  let state: MobileMissionMenuState | undefined;
  let objectivesKey = "";
  let previousFocus: Element | null = null;
  let atlas: MainButtonAtlas | undefined;
  let atlasRequested = false;

  function text(element: Element, value: string): void {
    if (element.textContent !== value) element.textContent = value;
  }

  function render(): void {
    if (!state || !dialog.open) return;
    text(title, tab === "options" ? state.title : tab === "research" ? "Research" : "Base operations");
    text(credits, state.credits === undefined ? "No base economy" : `${state.credits.toLocaleString()} PETRA`);
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-mobile-tab]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mobileTab === tab));
    }
    const building = tab !== "options";
    cards.hidden = !building;
    hint.hidden = !building;
    options.hidden = building;
    const shown = state.entries.filter(entry => entry.tab === tab);
    empty.hidden = !building || shown.length > 0;
    for (const child of Array.from(cards.children)) {
      if (child instanceof HTMLElement && !shown.some(entry => entry.key === child.dataset.mobilePurchase)) child.remove();
    }
    for (const entry of shown) {
      let button = cards.querySelector<HTMLButtonElement>(`[data-mobile-purchase="${entry.key}"]`);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.mobilePurchase = entry.key;
        button.innerHTML = "<span class=\"mobile-build-kind\"></span><span class=\"mobile-build-icon\" aria-hidden=\"true\"></span><strong></strong><span class=\"mobile-build-cost\"></span><small></small>";
        cards.append(button);
      }
      const icon = button.querySelector<HTMLElement>(".mobile-build-icon")!;
      icon.hidden = !atlas;
      if (atlas) paintMainButtonFrame(icon, atlas, entry.frame);
      const name = entry.text.replace(/\s+\d+\s*$/, "").replace(/\s+/g, " ").trim();
      const reason = entry.submitting ? "Order pending" : entry.progress
        ? `Building ${Math.floor(100 * entry.progress.value / Math.max(1, entry.progress.max))}%`
        : entry.state === 0 ? "Complete" : entry.reason || (entry.count ? `${entry.count} queued` : "Tap to order");
      text(button.querySelector(".mobile-build-kind")!, entry.kind);
      text(button.querySelector("strong")!, name);
      text(button.querySelector(".mobile-build-cost")!, `${entry.cost.toLocaleString()} PETRA`);
      text(button.querySelector("small")!, reason);
      button.disabled = !state.enabled || !entry.enabled || entry.submitting || entry.maxStage < 1;
      button.setAttribute("aria-label", `${name}, ${entry.cost} PETRA, ${reason}`);
    }
    const nextObjectivesKey = JSON.stringify(state.objectives);
    if (objectivesKey !== nextObjectivesKey) {
      objectivesKey = nextObjectivesKey;
      objectives.replaceChildren(...state.objectives.map(objective => {
        const item = document.createElement("li");
        item.textContent = objective;
        return item;
      }));
    }
    save.disabled = !state.enabled || state.saveDisabled;
    mute.disabled = !state.enabled;
    mute.setAttribute("aria-pressed", String(state.muted));
    text(mute, state.muted ? "Sound off" : "Sound on");
    text(saveStatus, state.saveStatus);
  }

  function close(): void {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.hasAttribute("data-mobile-menu-close")) { close(); return; }
    const nextTab = button.dataset.mobileTab;
    if (nextTab === "build" || nextTab === "research" || nextTab === "options") {
      tab = nextTab;
      status.value = "";
      render();
      return;
    }
    if (!state?.enabled) return;
    const purchase = button.dataset.mobilePurchase;
    if (purchase) {
      const result = callbacks.onPurchase(purchase);
      status.value = result.message;
      status.dataset.error = String(!result.ok);
      return;
    }
    switch (button.dataset.mobileOption) {
      case "save": callbacks.onSave(); break;
      case "load": callbacks.onLoad(); break;
      case "mute": callbacks.onToggleMute(); break;
      case "exit": close(); callbacks.onExit(); break;
    }
  }, { signal });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }, { signal });
  dialog.addEventListener("close", () => {
    callbacks.onClose();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  }, { signal });

  return {
    get isOpen() { return dialog.open; },
    get buildOpen() { return dialog.open && tab !== "options"; },
    open(next: MobileMenuTab, nextState: MobileMissionMenuState): void {
      tab = next;
      state = nextState;
      status.value = "";
      if (!dialog.open) {
        previousFocus = document.activeElement;
        dialog.showModal();
      }
      render();
      if (!atlasRequested) {
        atlasRequested = true;
        void loadMainButtonAtlas().then(loaded => {
          if (signal.aborted) return;
          atlas = loaded;
          render();
        }, error => {
          if (!signal.aborted) {
            console.warn("Mobile build icons unavailable", error);
            status.value = "Build icons unavailable; text orders are still available.";
          }
        });
      }
    },
    update(nextState: MobileMissionMenuState): void { state = nextState; render(); },
    close,
    dispose(): void { close(); controller.abort(); dialog.remove(); },
  };
}
