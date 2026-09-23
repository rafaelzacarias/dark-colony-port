import { createElement as createIcon, Play } from "lucide";
import type { Faction } from "../engine";
import { campaignMissionStem } from "../game-data";

export function campaignMissionSelection(faction: Faction, missionNumber: number) {
  const stem = campaignMissionStem(faction, missionNumber);
  return {
    faction, missionNumber, stem,
    sourceId: stem.slice(stem.lastIndexOf("/") + 1),
    runtimeProfile: missionNumber === 1 ? undefined : "browser-adapted" as const,
  };
}

export function createCampaignMissionPicker(host: HTMLElement,
  launch: (selection: ReturnType<typeof campaignMissionSelection>) => void) {
  let faction: Faction = "human";
  host.classList.add("campaign-mission-picker");
  host.innerHTML = `
    <fieldset class="mission-picker-factions">
      <legend>Faction</legend>
      <label><input type="radio" name="mission-picker-faction" value="human" checked />Human</label>
      <label><input type="radio" name="mission-picker-faction" value="alien" />Alien</label>
    </fieldset>
    <div class="mission-picker-choice">
      <label for="campaign-mission-select">Mission</label>
      <div class="mission-picker-launch">
        <select id="campaign-mission-select" aria-describedby="campaign-mission-profile"></select>
        <button type="button" data-mission-launch aria-label="Launch HUMAN01" title="Launch HUMAN01"></button>
      </div>
      <output id="campaign-mission-profile" aria-live="polite"></output>
    </div>`;
  const select = host.querySelector<HTMLSelectElement>("select")!;
  const button = host.querySelector<HTMLButtonElement>("[data-mission-launch]")!;
  const badge = host.querySelector<HTMLOutputElement>("output")!;
  button.append(createIcon(Play, { width: 20, height: 20, "aria-hidden": "true" }));
  const selection = () => campaignMissionSelection(faction, Number(select.value));
  const update = () => {
    const selected = selection();
    badge.textContent = selected.runtimeProfile ? "BROWSER ADAPTED" : "SOURCE STRICT";
    button.title = `Launch ${selected.sourceId}`;
    button.setAttribute("aria-label", button.title);
  };
  const populate = () => {
    const number = select.value || "1";
    select.replaceChildren(...Array.from({ length: 15 }, (_, index) => {
      const selected = campaignMissionSelection(faction, index + 1);
      return new Option(selected.sourceId, String(selected.missionNumber));
    }));
    select.value = number;
    update();
  };
  host.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      campaignMissionSelection(input.value as Faction, 1);
      faction = input.value as Faction;
      populate();
    });
  });
  select.addEventListener("change", update);
  button.addEventListener("click", () => { if (!button.disabled) launch(selection()); });
  populate();
  return {
    setDisabled(disabled: boolean) {
      host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")
        .forEach((control) => { control.disabled = disabled; });
    },
  };
}