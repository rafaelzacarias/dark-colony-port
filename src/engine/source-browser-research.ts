import { assetUrl } from "../asset-url";
import type { CampaignMissionData } from "../game-data";
import type { DependencyRecord } from "../../tools/extractors/data/tables";
import { createBrowserResearchConfiguration } from "./browser-research";

const DEPEND_HASH = "a5d620693198f650a4bcc265d5908de2a6e31241611d43907c138833420410ec";

export async function loadSourceBrowserResearchConfiguration(mission: CampaignMissionData,
  loadBytes = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new TypeError(`Browser research: cannot load ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }) {
  const bytes = await loadBytes(assetUrl("/assets/generated/data/dependencies.json"));
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== DEPEND_HASH) throw new TypeError("Browser research: source DEPEND hash mismatch");
  const dependencies = JSON.parse(new TextDecoder().decode(bytes)) as { records: DependencyRecord[] };
  const { rawScenario: _rawScenario, ...source } = mission.scenario;
  return createBrowserResearchConfiguration({ runtimeProfile: "browser-adapted",
    activation: "source-city-slot4-health", scienceOwner: "campaign-session-city", source,
    units: mission.units, dependencies: dependencies.records });
}