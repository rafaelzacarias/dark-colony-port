import type { CampaignWorld } from "./campaign-world";
import type { PlannedMissionCommand } from "./mission-controller";

export interface AiSelectorConfiguration {
  readonly sourceId: string;
  readonly sourceCanonical: string;
  readonly profileId: string;
  readonly scope: "source-native-policy-scheduler";
  readonly globalMode: 0 | 3;
  readonly teams: readonly { readonly team: number; readonly modes: readonly number[] }[];
}

export interface AiSelectorEvent {
  readonly commandId: string;
  readonly triggerId: number;
  readonly actionIndex: number;
  readonly action: PlannedMissionCommand["action"];
  readonly team: number;
  readonly before: number;
  readonly after: number;
  readonly profileId: string;
  readonly globalMode: number;
}

export interface AiSelectorState {
  readonly sourceId: string;
  readonly initialModes: readonly number[];
  readonly modes: readonly number[];
  readonly events: readonly AiSelectorEvent[];
}

export interface AiSelectorSchedulingOwner {
  readonly configuration: AiSelectorConfiguration;
  isReady(context: { readonly world: CampaignWorld; readonly planned: PlannedMissionCommand;
    readonly selectors: AiSelectorState }): boolean;
}

function requireSelector(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ai: ${message}`);
}

export function isAiSelectorMode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
}

export function aiSelectorSourceCanonical(source: CampaignWorld["source"]): string {
  return JSON.stringify(source, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      requireSelector(Object.getPrototypeOf(value) === Object.prototype, "plain JSON source definition required");
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    }
    requireSelector(value === null || typeof value === "string" || typeof value === "boolean" || Array.isArray(value)
      || (typeof value === "number" && Number.isFinite(value)), "JSON source definition required");
    return value;
  });
}

export function writeOriginalAiSelector(modes: readonly number[], team: number, mode: number): readonly number[] {
  requireSelector(modes.length === 8 && modes.every(value => Number.isInteger(value)
    && value >= -2147483648 && value <= 2147483647), "eight signed selector dwords required");
  requireSelector(Number.isInteger(team) && team >= 0 && team < 8 && Number.isInteger(mode)
    && mode >= -32768 && mode <= 32767, "bounded team and signed mode word required");
  const next = [...modes];
  next[team] = mode;
  return next;
}

export function validateAiSelectorConfiguration(config: AiSelectorConfiguration): void {
  requireSelector(config && config.scope === "source-native-policy-scheduler" && typeof config.sourceId === "string"
    && config.sourceId.length > 0 && typeof config.profileId === "string" && config.profileId.length > 0,
  "explicit native policy scheduling profile required");
  requireSelector(typeof config.sourceCanonical === "string" && config.sourceCanonical.length > 0,
    "complete original source definition required");
  requireSelector(config.globalMode === 0 || config.globalMode === 3, "SCN selectors require proven global mode 0 or 3");
  requireSelector(Array.isArray(config.teams) && config.teams.length > 0
    && new Set(config.teams.map(entry => entry.team)).size === config.teams.length, "unique owned teams required");
  for (const entry of config.teams) requireSelector(Number.isInteger(entry.team) && entry.team >= 0 && entry.team < 8
    && Array.isArray(entry.modes) && entry.modes.length > 0 && entry.modes.every(isAiSelectorMode)
    && new Set(entry.modes).size === entry.modes.length, "invalid team or callback selector coverage (0..4)");
}

export function retainAiSelectorOwner(owner: AiSelectorSchedulingOwner): AiSelectorSchedulingOwner {
  validateAiSelectorConfiguration(owner.configuration);
  requireSelector(typeof owner.isReady === "function", "native policy scheduling callback required");
  const configuration = structuredClone(owner.configuration);
  for (const entry of configuration.teams) { Object.freeze(entry.modes); Object.freeze(entry); }
  Object.freeze(configuration.teams);
  Object.freeze(configuration);
  return Object.freeze({ configuration, isReady: owner.isReady.bind(owner) });
}

export function initializeAiSelectors(source: { readonly id: string;
  readonly teams: readonly { readonly index: number; readonly ai?: number }[] }): AiSelectorState {
  requireSelector(source.teams.length === 8 && source.teams.every((team, index) => team.index === index
    && Number.isInteger(team.ai) && team.ai! >= -2147483648 && team.ai! <= 2147483647),
  "all eight original SCN selector dwords required");
  const initialModes = source.teams.map(team => team.ai!);
  return { sourceId: source.id, initialModes, modes: [...initialModes], events: [] };
}

export function prepareAiSelector(world: CampaignWorld, planned: PlannedMissionCommand,
  owner?: AiSelectorSchedulingOwner): CampaignWorld {
  requireSelector(owner && typeof owner.isReady === "function", "native policy scheduling owner required; command remains unsupported");
  validateAiSelectorConfiguration(owner.configuration);
  const command = planned.command, selectors = world.aiSelectors;
  requireSelector(command.kind === "ai" && Number.isInteger(command.team) && command.team >= 0 && command.team < 8
    && isAiSelectorMode(command.mode), "literal team 0..7 and signed 16-bit selector required");
  requireSelector(selectors && selectors.sourceId === world.source.id && owner.configuration.sourceId === world.source.id
    && selectors.modes.length === 8 && aiSelectorSourceCanonical(world.source) === owner.configuration.sourceCanonical,
  "source selector state/profile mismatch");
  requireSelector(owner.configuration.teams.some(entry => entry.team === command.team && entry.modes.includes(command.mode)),
    "native policy scheduling profile does not own this team/selector");
  const previous = selectors.events.find(event => event.commandId === planned.id);
  requireSelector(!previous, "duplicate selector command");
  requireSelector(owner.isReady(structuredClone({ world, planned, selectors })) === true,
    "native policy scheduling owner is not ready");
  const modes = writeOriginalAiSelector(selectors.modes, command.team, command.mode);
  const event: AiSelectorEvent = { commandId: planned.id, triggerId: planned.triggerId, actionIndex: planned.actionIndex,
    action: structuredClone(planned.action), team: command.team, before: selectors.modes[command.team], after: command.mode,
    profileId: owner.configuration.profileId, globalMode: owner.configuration.globalMode };
  return { ...world, aiSelectors: { ...selectors, modes, events: [...selectors.events, event] } };
}