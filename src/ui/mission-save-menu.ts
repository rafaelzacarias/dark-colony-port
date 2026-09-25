import { listMissionSaves, readMissionSave, type MissionSaveSlot, type SavedMission } from "../mission-save";

export function createMissionSaveMenu(parent: HTMLElement, callbacks: {
  readonly onSave: (slot: MissionSaveSlot) => Promise<void>;
  readonly onLoad: (save: SavedMission) => void;
  readonly onClose: () => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "game-dialog";
  dialog.id = "mission-save-menu";
  dialog.setAttribute("aria-labelledby", "mission-save-title");
  dialog.innerHTML = `
    <header><div><p>MISSION ARCHIVE</p><h2 id="mission-save-title">Load game</h2></div>
      <button type="button" data-save-close aria-label="Close saved games">Close</button></header>
    <p class="save-menu-hint"></p>
    <div class="save-slots"></div>
    <p class="save-menu-status" role="status" aria-live="polite"></p>
    <button type="button" data-save-retry hidden>Retry</button>
    <p class="save-menu-note">The mission is paused while this menu is open.
      Manual saves only. Stored in this browser on this device.
      Clearing site data removes saved games.</p>`;
  parent.append(dialog);
  const title = dialog.querySelector<HTMLElement>("h2")!;
  const hint = dialog.querySelector<HTMLElement>(".save-menu-hint")!;
  const slots = dialog.querySelector<HTMLElement>(".save-slots")!;
  const status = dialog.querySelector<HTMLElement>(".save-menu-status")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-save-close]")!;
  const retry = dialog.querySelector<HTMLButtonElement>("[data-save-retry]")!;
  let mode: "save" | "load" = "load";
  let generation = 0;
  let busy = false;
  let previousFocus: Element | null = null;

  function setBusy(value: boolean): void {
    busy = value;
    dialog.setAttribute("aria-busy", String(value));
    closeButton.disabled = value;
    for (const button of slots.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = value || (mode === "load" && button.dataset.empty === "true");
    }
  }

  function fail(error: unknown): void {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.error = "true";
  }

  async function refresh(): Promise<void> {
    const token = ++generation;
    slots.replaceChildren();
    retry.hidden = true;
    status.textContent = "Reading saved games...";
    delete status.dataset.error;
    setBusy(true);
    try {
      const entries = await listMissionSaves();
      if (token !== generation || !dialog.open) return;
      for (const { slot, save } of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.saveSlot = slot;
        button.dataset.empty = String(save === null);
        const number = document.createElement("span");
        number.className = "save-slot-number";
        number.textContent = slot.slice(-1).padStart(2, "0");
        const label = document.createElement("strong");
        label.textContent = save ? `${save.faction === "human" ? "Human" : "Alien"} campaign / Mission ${save.missionNumber}` : "Empty slot";
        const date = document.createElement("small");
        date.textContent = save ? new Date(save.savedAt).toLocaleString() : "No saved game";
        button.append(number, label, date);
        button.addEventListener("click", async () => {
          if (busy) return;
          if (mode === "save" && save && !window.confirm(`Overwrite save slot ${slot.slice(-1)}?`)) return;
          setBusy(true);
          status.textContent = mode === "save" ? "Saving mission..." : "Loading saved game...";
          delete status.dataset.error;
          try {
            if (mode === "save") await callbacks.onSave(slot);
            else {
              // Read again so a save made by another tab since opening is not silently ignored.
              const selected = await readMissionSave(indexedDB, slot);
              if (!selected) throw new Error("This slot is now empty. Close and reopen saved games.");
              if (token !== generation || !dialog.open) return;
              setBusy(false);
              dialog.close();
              callbacks.onLoad(selected);
              return;
            }
            if (token === generation && dialog.open) {
              setBusy(false);
              dialog.close();
            }
          } catch (error) {
            if (token === generation && dialog.open) fail(error);
          } finally {
            if (token === generation) setBusy(false);
          }
        });
        slots.append(button);
      }
      status.textContent = mode === "load" && entries.every(entry => entry.save === null)
        ? "No saved games yet. Start a campaign, then choose Save game from the mission menu." : "";
    } catch (error) {
      if (token === generation && dialog.open) { fail(error); retry.hidden = false; }
    } finally {
      if (token === generation) setBusy(false);
    }
  }

  closeButton.addEventListener("click", () => dialog.close());
  retry.addEventListener("click", () => void refresh());
  dialog.addEventListener("cancel", event => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    ++generation;
    callbacks.onClose();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  });
  return {
    get isOpen() { return dialog.open; },
    open(nextMode: "save" | "load"): void {
      if (dialog.open) return;
      mode = nextMode;
      title.textContent = mode === "save" ? "Save game" : "Load game";
      hint.textContent = mode === "save" ? "Choose a slot. Existing saves ask for confirmation before being replaced."
        : "Choose a saved mission to resume.";
      previousFocus = document.activeElement;
      dialog.showModal();
      void refresh();
    },
    dispose(): void { ++generation; dialog.close(); dialog.remove(); },
  };
}
