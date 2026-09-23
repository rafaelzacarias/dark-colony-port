import { aiSelectorSourceCanonical, initializeAiSelectors, isAiSelectorMode, writeOriginalAiSelector,
  type AiSelectorEvent, type AiSelectorState } from "./ai-command-selector";
import type { CampaignWorld } from "./campaign-world";
import type { PlannedMissionCommand } from "./mission-controller";
import { computeBrowserCampaignAi, initializeBrowserCampaignAi, restoreBrowserCampaignAi,
  type BrowserCampaignAiConfiguration, type BrowserCampaignAiObservation, type BrowserCampaignAiState,
  type BrowserCampaignAiOrder } from "./browser-campaign-ai";

export type CampaignRuntimeProfile = "strict-native" | "browser-adapted";

export interface BrowserAiSelectorConfiguration {
  readonly scope: "source-browser-selector";
  readonly sourceId: string;
  readonly sourceCanonical: string;
  readonly profileId: "browser-adapted-v1";
  readonly processor: {
    readonly kind: "browser-ai-strategy-v1";
    readonly phase: "view-before-generic-engine";
    readonly stateOwner: "mission-view";
  };
}

export interface BrowserAiSelectorOwner {
  readonly configuration: BrowserAiSelectorConfiguration;
}

const owners = new WeakSet<BrowserAiSelectorOwner>();

function requireBrowser(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`browser-adapted: ${message}`);
}

export function createBrowserAiSelectorConfiguration(source: CampaignWorld["source"]): BrowserAiSelectorConfiguration {
  const selectors = initializeAiSelectors(source);
  requireBrowser(selectors.modes.every(isAiSelectorMode), "all eight source selectors must be modes 0..4");
  const definition = source as CampaignWorld["source"] & { readonly rawHeader?: readonly string[];
    readonly title?: string; readonly terrainBank?: string };
  requireBrowser(Array.isArray(definition.rawHeader) && definition.rawHeader.every(line => typeof line === "string")
    && typeof definition.title === "string" && typeof definition.terrainBank === "string",
  "complete parsed SCN header required");
  for (const team of source.teams) {
    const record = team as unknown as Record<string, unknown>;
    requireBrowser(["enabled", "money", "ai", "teamColor", "race"].every(key => Number.isInteger(record[key]))
      && ["dependencies", "allies", "aiSlots"].every(key => Array.isArray(record[key]) && record[key].every(Number.isInteger))
      && (record.allies as unknown[]).length === 8
      && ["coordinateRows", "cityRows"].every(key => Array.isArray(record[key])
        && record[key].every(row => Array.isArray(row) && row.every(Number.isInteger))),
    "complete parsed SCN team records required");
  }
  return { scope: "source-browser-selector", sourceId: source.id, sourceCanonical: aiSelectorSourceCanonical(source),
    profileId: "browser-adapted-v1", processor: { kind: "browser-ai-strategy-v1",
      phase: "view-before-generic-engine", stateOwner: "mission-view" } };
}

export function validateBrowserAiSelectorConfiguration(configuration: BrowserAiSelectorConfiguration,
  source: CampaignWorld["source"]): void {
  requireBrowser(aiSelectorSourceCanonical(configuration as unknown as CampaignWorld["source"])
    === aiSelectorSourceCanonical(createBrowserAiSelectorConfiguration(source) as unknown as CampaignWorld["source"]),
  "complete source fingerprint and explicit view strategy processor configuration required");
}

export function createBrowserAiSelectorOwner(configuration: BrowserAiSelectorConfiguration,
  source: CampaignWorld["source"]): BrowserAiSelectorOwner {
  validateBrowserAiSelectorConfiguration(configuration, source);
  const owned = structuredClone(configuration);
  Object.freeze(owned.processor);
  const owner = Object.freeze({ configuration: Object.freeze(owned) });
  owners.add(owner);
  return owner;
}

export function prepareBrowserAiSelector(world: CampaignWorld, planned: PlannedMissionCommand,
  owner: BrowserAiSelectorOwner): CampaignWorld {
  requireBrowser(owners.has(owner), "browser selector capability required");
  validateBrowserAiSelectorConfiguration(owner.configuration, world.source);
  const command = planned.command, selectors = world.aiSelectors;
  const initialModes = initializeAiSelectors(world.source).initialModes;
  requireBrowser(command.kind === "ai" && Number.isInteger(command.team) && command.team >= 0 && command.team < 8
    && isAiSelectorMode(command.mode), "literal team 0..7 and selector 0..4 required");
  requireBrowser(selectors && selectors.sourceId === world.source.id && selectors.modes.length === 8
    && selectors.modes.every(isAiSelectorMode)
    && selectors.initialModes.every((mode, team) => mode === initialModes[team])
    && selectors.initialModes.length === 8, "source selector state mismatch");
  requireBrowser(!selectors.events.some(event => event.commandId === planned.id), "duplicate selector command");
  const event: AiSelectorEvent = { commandId: planned.id, triggerId: planned.triggerId, actionIndex: planned.actionIndex,
    action: structuredClone(planned.action), team: command.team, before: selectors.modes[command.team], after: command.mode,
    profileId: owner.configuration.profileId, globalMode: 0 };
  return { ...world, aiSelectors: { ...selectors, modes: writeOriginalAiSelector(selectors.modes, command.team, command.mode),
    events: [...selectors.events, event] } };
}

export interface BrowserCampaignProjection {
  readonly runtimeProfile: "browser-adapted";
  readonly configuration: BrowserAiSelectorConfiguration;
  readonly cycleCounter: number;
  readonly selectors: AiSelectorState;
  readonly money: Readonly<Record<number, number>>;
  readonly statistics: Readonly<Record<string, number>>;
}

export function projectBrowserCampaign(configuration: BrowserAiSelectorConfiguration, world: CampaignWorld,
  cycleCounter: number): BrowserCampaignProjection {
  validateBrowserAiSelectorConfiguration(configuration, world.source);
  requireBrowser(world.aiSelectors, "initialized selectors required");
  const projection: BrowserCampaignProjection = structuredClone({ runtimeProfile: "browser-adapted", configuration, cycleCounter,
    selectors: world.aiSelectors, money: world.exomoney, statistics: world.statistics });
  const freeze = (value: object): void => {
    for (const entry of Object.values(value)) if (entry !== null && typeof entry === "object") freeze(entry);
    Object.freeze(value);
  };
  freeze(projection);
  return projection;
}

export interface BrowserCampaignViewState {
  readonly version: 1;
  readonly runtimeProfile: "browser-adapted";
  readonly sourceCanonical: string;
  readonly sourceCycle: number;
  readonly strategy: BrowserCampaignAiState;
}

function validateStrategy(projection: BrowserCampaignProjection, strategy: BrowserCampaignAiConfiguration): void {
  requireBrowser(projection.runtimeProfile === "browser-adapted" && strategy.profile === "browser-adapted"
    && strategy.strategy === "source-objectives-v1" && strategy.sourceId === projection.configuration.sourceId,
  "matching browser strategy source required");
  const source = JSON.parse(projection.configuration.sourceCanonical) as CampaignWorld["source"];
  validateBrowserAiSelectorConfiguration(projection.configuration, source);
  const teams = source.teams as readonly { readonly index: number; readonly ai?: number;
    readonly allies?: readonly number[]; readonly aiSlots?: readonly number[] }[];
  requireBrowser(strategy.teams.length === 8 && strategy.teams.every((team, index) => team.team === teams[index].index
    && team.selector === teams[index].ai && JSON.stringify(team.allies) === JSON.stringify(teams[index].allies)
    && JSON.stringify(team.aiSlots) === JSON.stringify(teams[index].aiSlots)), "strategy differs from source teams");
}

export function initializeBrowserCampaignView(projection: BrowserCampaignProjection,
  strategy: BrowserCampaignAiConfiguration, seed = 1): BrowserCampaignViewState {
  validateStrategy(projection, strategy);
  return { version: 1, runtimeProfile: "browser-adapted", sourceCanonical: projection.configuration.sourceCanonical,
    sourceCycle: projection.cycleCounter, strategy: initializeBrowserCampaignAi(strategy, seed) };
}

export function restoreBrowserCampaignView(projection: BrowserCampaignProjection,
  strategy: BrowserCampaignAiConfiguration, saved: BrowserCampaignViewState): BrowserCampaignViewState {
  validateStrategy(projection, strategy);
  requireBrowser(saved && Object.keys(saved).sort().join() === "runtimeProfile,sourceCanonical,sourceCycle,strategy,version"
    && saved.version === 1 && saved.runtimeProfile === "browser-adapted"
    && saved.sourceCanonical === projection.configuration.sourceCanonical
    && Number.isSafeInteger(saved.sourceCycle) && saved.sourceCycle >= 0 && saved.sourceCycle <= projection.cycleCounter,
  "invalid view checkpoint or source fingerprint");
  return { ...saved, strategy: restoreBrowserCampaignAi(strategy, saved.strategy) };
}

export function planBrowserCampaignViewFrame(projection: BrowserCampaignProjection,
  strategy: BrowserCampaignAiConfiguration, previous: BrowserCampaignViewState,
  observation: Omit<BrowserCampaignAiObservation, "selectors">): {
    readonly state: BrowserCampaignViewState;
    readonly commands: readonly BrowserCampaignAiOrder[];
  } {
  const saved = restoreBrowserCampaignView(projection, strategy, previous);
  requireBrowser(observation.snapshot.tick > saved.strategy.lastTick, "browser strategy already planned for this view frame");
  const plan = computeBrowserCampaignAi(strategy, saved.strategy, { ...observation, selectors: projection.selectors.modes });
  return { state: { ...saved, sourceCycle: projection.cycleCounter, strategy: plan.state }, commands: plan.commands };
}