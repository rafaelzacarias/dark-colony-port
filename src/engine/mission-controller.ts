import {
  auditTriggerSupport,
  createTriggerRuntimeState,
  evaluateTriggerCondition,
  recordTriggerVictimLoss,
  stepTriggerRuntime,
  type RuntimeTriggerBlock,
  type TriggerBail,
  type TriggerDiagnostic,
  type TriggerEvent,
  type TriggerInputs,
  type TriggerResult,
  type TriggerRuntimeState,
} from "./trigger-runtime";

export type MissionWorldCommand =
  | { readonly kind: "ai"; readonly team: number; readonly mode: number }
  | { readonly kind: "ally" | "vision"; readonly team: number; readonly otherTeam: number; readonly enabled: 0 | 1 }
  | { readonly kind: "dfiddle"; readonly team: number; readonly dependency: number; readonly restricted: 0 | 1 }
  | { readonly kind: "nopickup"; readonly team: number }
  | { readonly kind: "aimsg"; readonly team: number; readonly selector: 1 | 2 | 3 | 4; readonly value: number }
  | { readonly kind: "reinforce" | "reinforce2"; readonly team: number; readonly tileX: number; readonly tileY: number; readonly groups: readonly { readonly unitType: number; readonly count: number }[] }
  | { readonly kind: "newrate"; readonly rate: number; readonly tileX: number; readonly tileY: number }
  | { readonly kind: "newtype"; readonly tileX: number; readonly tileY: number; readonly newType: number }
  | { readonly kind: "msg"; readonly presentationCode: number; readonly reserved: 0; readonly messageId: number; readonly parameter3: number; readonly parameter4: number }
  | { readonly kind: "waypoint"; readonly tileX: number; readonly tileY: number; readonly points: readonly { readonly tileX: number; readonly tileY: number }[] }
  | { readonly kind: "exomoney"; readonly team: number; readonly value: number }
  | { readonly kind: "abduct"; readonly selectedSide: number; readonly carrierSide: number };

export interface MissionVictimLoss {
  readonly id: string;
  readonly victimTeam: number;
  readonly victimType: number;
}

export interface MissionControllerState<Block extends RuntimeTriggerBlock = RuntimeTriggerBlock> {
  readonly blocks: readonly Block[];
  readonly runtime: TriggerRuntimeState;
  readonly consumedLosses: Readonly<Record<string, MissionVictimLoss>>;
  readonly revision: number;
}

export interface MissionActionTrace {
  readonly triggerId: number;
  readonly actionIndex: number;
  readonly action: RuntimeTriggerBlock["actions"][number];
}

export interface PlannedMissionCommand extends MissionActionTrace {
  readonly id: string;
  readonly command: MissionWorldCommand;
  readonly statistics?: Readonly<Record<string, number>>;
}

export interface MissionPlan<Block extends RuntimeTriggerBlock = RuntimeTriggerBlock> {
  readonly base: MissionControllerState<Block>;
  readonly next: MissionControllerState<Block> | null;
  readonly commands: readonly PlannedMissionCommand[];
  readonly trace: readonly MissionActionTrace[];
  readonly fired: readonly number[];
  readonly diagnostics: readonly TriggerDiagnostic[];
  readonly pendingEvaluation: { readonly triggerId: number; readonly condition: string; readonly afterCommandIds: readonly string[] } | null;
}

export interface MissionCommandReceipt {
  readonly commandId: string;
  readonly disposition: "scheduled" | "applied" | "verified-no-match" | "verified-inactive-target";
}

export interface MissionWorldAdapter<World> {
  readonly aiSelector?: true;
  readonly browserAi?: true;
  readonly runtimeProfile?: "browser-adapted";
  prepare(world: World, commands: readonly PlannedMissionCommand[]): TriggerResult<{
    readonly world: World;
    readonly receipts: readonly MissionCommandReceipt[];
  }>;
}

export interface MissionTransactionAdapter<World> extends MissionWorldAdapter<World> {
  feedback(world: World, runtime: TriggerRuntimeState, inputs: TriggerInputs): TriggerResult<{
    readonly world: World;
    readonly statistics: Readonly<Record<string, number>>;
    readonly buildingSlots: TriggerInputs["buildingSlots"];
  }>;
}

export type MissionStartupHandlers<World> = Partial<Record<MissionWorldCommand["kind"],
  (world: World, planned: PlannedMissionCommand) => TriggerResult<{
    readonly world: World;
    readonly disposition: MissionCommandReceipt["disposition"];
  }>>>;

export function createMissionStartupAdapter<World>(handlers: MissionStartupHandlers<World>): MissionWorldAdapter<World> {
  const ownedHandlers = { ...handlers };
  return {
    prepare(world, commands) {
      const receipts: MissionCommandReceipt[] = [];
      let staged = world;
      for (const planned of commands) {
        const handler = ownedHandlers[planned.command.kind];
        if (!handler) return { ok: false, diagnostics: [{ code: "missing-input",
          message: `No startup adapter for ${planned.command.kind}`, triggerId: planned.triggerId, actionIndex: planned.actionIndex }] };
        const prepared = handler(staged, planned);
        if (!prepared.ok) return prepared;
        staged = prepared.value.world;
        receipts.push({ commandId: planned.id, disposition: prepared.value.disposition });
      }
      return { ok: true, value: { world: staged, receipts } };
    },
  };
}

function invalid(message: string): TriggerDiagnostic {
  return { code: "invalid-input", message };
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
}

export function isMissionRuntimeAction(action: RuntimeTriggerBlock["actions"][number]): boolean {
  return action.name === "bail" || action.name === "setlifes" || action.name === "setarray";
}

export interface MissionSelectorCapabilities {
  readonly aiSelector?: true;
  readonly browserAi?: true;
  readonly runtimeProfile?: "browser-adapted";
}

export function hasEnabledMissionTrip(state: MissionControllerState, triggerId: number): boolean {
  return state.blocks.some(block => block.id === triggerId && block.mode === "trip"
    && boundedInteger(state.runtime.lives[block.id], 255) && state.runtime.lives[block.id] > 0);
}

export function auditMissionTriggerSupport(blocks: readonly RuntimeTriggerBlock[], options?: MissionSelectorCapabilities): readonly TriggerDiagnostic[] {
  const diagnostics = auditTriggerSupport(blocks.map((block) => ({ ...block,
    actions: block.actions.filter(isMissionRuntimeAction),
  })), options).map((entry) => {
    const block = blocks.find(({ id }) => id === entry.triggerId);
    const indexes = block?.actions.flatMap((action, index) => isMissionRuntimeAction(action) ? [index] : []);
    return { ...entry, actionIndex: entry.actionIndex === undefined ? undefined : indexes?.[entry.actionIndex] };
  });
  for (const block of blocks) block.actions.forEach((action, actionIndex) => {
    if (action.name === "setlifes" && !blocks.some(({ id }) => id === action.arguments[0])) {
      diagnostics.push({ code: "missing-input", message: `undefined setlifes target ${action.arguments[0]}`,
        triggerId: block.id, actionIndex });
    }
    if (isMissionRuntimeAction(action)) return;
    if (action.name === "ai" && !options?.aiSelector && !options?.browserAi) {
      diagnostics.push({ code: "unsupported-action", message: "ai: native policy scheduling owner required",
        triggerId: block.id, actionIndex });
      return;
    }
    const decoded = decodeMissionWorldAction(action, options);
    if (!decoded.ok) diagnostics.push(...decoded.diagnostics.map((entry) => ({ ...entry, triggerId: block.id, actionIndex })));
  });
  return diagnostics;
}

function readsWorldFeedback(expression: string): boolean {
  const remaining = expression.replace(/\bs\s*\(\s*[0-7]\s*,\s*(?:3\s*|[02]\s*,\s*\d+\s*)\)/g, "0");
  return /\b[bs]\s*\(/.test(remaining);
}

export function decodeMissionWorldAction(action: RuntimeTriggerBlock["actions"][number], options?: MissionSelectorCapabilities): TriggerResult<MissionWorldCommand> {
  const args = action.arguments;
  const unsupported = (message: string): TriggerResult<MissionWorldCommand> => ({
    ok: false,
    diagnostics: [{ code: "unsupported-action", message }],
  });
  if (options?.runtimeProfile === "browser-adapted") {
    if (action.name === "ally" || action.name === "vision") {
      const enabled = args[2] ?? (action.name === "vision" && args.length === 2 ? 0 : undefined);
      if ((args.length === 3 || action.name === "vision" && args.length === 2)
        && boundedInteger(args[0], 7) && boundedInteger(args[1], 7) && (enabled === 0 || enabled === 1)) {
        return { ok: true, value: { kind: action.name, team: args[0], otherTeam: args[1], enabled } };
      }
      return unsupported(`${action.name}: expected two teams and a relation bit`);
    }
    if (action.name === "dfiddle" && args.length === 3 && boundedInteger(args[0], 7)
      && boundedInteger(args[1], 109) && (args[2] === 0 || args[2] === 1)) {
      return { ok: true, value: { kind: "dfiddle", team: args[0], dependency: args[1], restricted: args[2] } };
    }
    if (action.name === "nopickup" && args.length === 1 && boundedInteger(args[0], 7)) {
      return { ok: true, value: { kind: "nopickup", team: args[0] } };
    }
    if (action.name === "aimsg" && args.length === 4 && boundedInteger(args[0], 7) && args[1] === 2
      && boundedInteger(args[2], 4) && args[2] > 0 && typeof args[3] === "number"
      && Number.isInteger(args[3]) && args[3] >= -32768 && args[3] <= 32767) {
      return { ok: true, value: { kind: "aimsg", team: args[0], selector: args[2] as 1 | 2 | 3 | 4, value: args[3] } };
    }
  }
  if (action.name === "exomoney" && options?.runtimeProfile === "browser-adapted") {
    if (args.length !== 2 || !boundedInteger(args[0], 7) || typeof args[1] !== "number"
      || !Number.isInteger(args[1]) || args[1] < -2147483648 || args[1] > 2147483647) {
      return unsupported("exomoney: expected team and int32 source literal");
    }
    return { ok: true, value: { kind: "exomoney", team: args[0], value: args[1] & 255 } };
  }
  if (action.name === "ai") {
    if (args.length !== 2 || !boundedInteger(args[0], 7) || typeof args[1] !== "number"
      || !Number.isInteger(args[1]) || args[1] < 0 || args[1] > 4) {
      return unsupported("ai: only literal team 0..7 and callback selector 0..4 are supported; signed invalid words remain unsupported");
    }
    return { ok: true, value: { kind: "ai", team: args[0], mode: args[1] } };
  }
  if (!["reinforce", "reinforce2", "newtype", "newrate", "abduct", "msg", "waypoint", "exomoney"].includes(action.name)) {
    return unsupported(`${action.name}: argument parsing and world semantics are not verified by this controller`);
  }
  if (args.some((value) => !boundedInteger(value, 255))) {
    return unsupported(`${action.name}: only literal byte arguments are supported`);
  }
  const values = args as readonly number[];
  if (action.name === "newrate" && values.length === 3) {
    return { ok: true, value: { kind: "newrate", rate: values[0], tileX: values[1], tileY: values[2] } };
  }
  if (action.name === "msg" && values.length === 5 && values[1] === 0 && values[2] < 30) {
    return { ok: true, value: { kind: "msg", presentationCode: values[0], reserved: 0,
      messageId: values[2], parameter3: values[3], parameter4: values[4] } };
  }
  if (action.name === "exomoney" && values.length === 2 && values[0] < 8) {
    return { ok: true, value: { kind: "exomoney", team: values[0], value: values[1] } };
  }
  if (action.name === "waypoint" && values[2] >= 1 && values[2] <= 8 && values.length === 3 + values[2] * 2) {
    return { ok: true, value: { kind: "waypoint", tileX: values[0], tileY: values[1],
      points: Array.from({ length: values[2] }, (_, index) => ({ tileX: values[3 + index * 2], tileY: values[4 + index * 2] })) } };
  }
  if (action.name === "newtype" && values.length === 3 && values[2] <= 109) {
    return { ok: true, value: { kind: "newtype", tileX: values[0], tileY: values[1], newType: values[2] } };
  }
  if (action.name === "abduct" && values.length === 2 && values.every((value) => value < 8)) {
    return { ok: true, value: { kind: "abduct", selectedSide: values[0], carrierSide: values[1] } };
  }
  if ((action.name === "reinforce" || action.name === "reinforce2") &&
    (values.length === 11 || values.length === 13 || options?.runtimeProfile === "browser-adapted"
      && values.length >= 5 && values.length <= 15 && (values.length % 2 === 1 || values.at(-1) === 0)
      && values.slice(13).every(value => value === 0)) && values[0] < 8) {
    const groups = Array.from({ length: 5 }, (_, index) => ({
      unitType: values[3 + index * 2] ?? 0,
      count: values[4 + index * 2] ?? 0,
    }));
    if (groups.some(({ unitType }) => unitType > 109)) return unsupported(`${action.name}: type outside verified table`);
    if (action.name === "reinforce" && groups[0].unitType === 0 && groups[0].count === 0) {
      return unsupported("reinforce: special first-word zero payload is not ordinary delivery");
    }
    return { ok: true, value: { kind: action.name, team: values[0], tileX: values[1], tileY: values[2], groups } };
  }
  return unsupported(`${action.name}: unsupported argument shape or range`);
}

export function createMissionController<Block extends RuntimeTriggerBlock>(
  blocks: readonly Block[],
  statistics: Readonly<Record<string, number>>,
): TriggerResult<MissionControllerState<Block>> {
  const ownedBlocks = structuredClone(blocks);
  const runtime = createTriggerRuntimeState(ownedBlocks, statistics);
  if (!runtime.ok) return runtime;
  return { ok: true, value: { blocks: ownedBlocks, runtime: runtime.value, consumedLosses: {}, revision: 0 } };
}

export function planMissionStep<Block extends RuntimeTriggerBlock>(
  state: MissionControllerState<Block>,
  inputs: TriggerInputs,
  event: TriggerEvent,
  losses: readonly MissionVictimLoss[] = [],
  options?: MissionSelectorCapabilities,
): MissionPlan<Block> {
  const commands: PlannedMissionCommand[] = [];
  const trace: MissionActionTrace[] = [];
  const fired: number[] = [];
  const diagnostics: TriggerDiagnostic[] = [];
  let pendingEvaluation: MissionPlan<Block>["pendingEvaluation"] = null;
  let runtime = state.runtime;
  const consumedLosses = { ...state.consumedLosses };
  const result = (next: MissionControllerState<Block> | null): MissionPlan<Block> => ({
    base: state, next, commands, trace, fired, diagnostics, pendingEvaluation,
  });
  if (!boundedInteger(inputs.clockMilliseconds, 4294967295) ||
      !Number.isInteger(inputs.cycleCounter) || inputs.cycleCounter < -2147483648 || inputs.cycleCounter > 2147483647) {
    diagnostics.push(invalid("Supply an int32 cycle counter and uint32 millisecond clock"));
    return result(null);
  }
  const validated = createTriggerRuntimeState(state.blocks, runtime.statistics);
  if (!validated.ok) {
    diagnostics.push(...validated.diagnostics);
    return result(null);
  }
  if (event.kind === "trip" && (!boundedInteger(event.team, 7) || !state.blocks.some(({ id }) => id === event.triggerId))) {
    diagnostics.push(invalid("Trip requires a known trigger ID and a team in 0..7"));
    return result(null);
  }
  for (const loss of losses) {
    if (loss.id.length === 0) {
      diagnostics.push(invalid("Victim-loss event requires a stable nonempty ID"));
      return result(null);
    }
    const previous = Object.hasOwn(consumedLosses, loss.id) ? consumedLosses[loss.id] : undefined;
    if (previous) {
      if (previous.victimTeam !== loss.victimTeam || previous.victimType !== loss.victimType) {
        diagnostics.push(invalid(`Conflicting victim-loss event ID ${loss.id}`));
        return result(null);
      }
      continue;
    }
    const recorded = recordTriggerVictimLoss(runtime.statistics, loss.victimTeam, loss.victimType);
    if (!recorded.ok) {
      diagnostics.push(...recorded.diagnostics);
      return result(null);
    }
    runtime = { ...runtime, statistics: recorded.value };
    Object.defineProperty(consumedLosses, loss.id, { value: { ...loss }, enumerable: true, configurable: true });
  }
  for (const block of [...state.blocks].sort((left, right) => left.id - right.id)) {
    if (!boundedInteger(runtime.lives[block.id], 255)) {
      diagnostics.push({ ...invalid("Missing or invalid remaining lives"), triggerId: block.id });
      return result(null);
    }
    if (runtime.lives[block.id] === 0 || (event.kind === "normal"
      ? block.mode !== "norm" : block.mode !== "trip" || block.id !== event.triggerId)) continue;
    const worldWrites = commands.filter(({ command }) => ["exomoney", "newtype", "reinforce2"].includes(command.kind));
    if (worldWrites.length > 0 && readsWorldFeedback(block.condition)) {
      pendingEvaluation = { triggerId: block.id, condition: block.condition, afterCommandIds: worldWrites.map(({ id }) => id) };
      return result(null);
    }
    const condition = evaluateTriggerCondition(block.condition, runtime.statistics, { ...inputs,
      runtimeProfile: options?.runtimeProfile, triggeringUnitType: event.kind === "trip" ? event.unitType : undefined }, event.kind === "trip" ? event.team : undefined);
    if (!condition.ok) {
      diagnostics.push(...condition.diagnostics.map((entry) => ({ ...entry, triggerId: block.id })));
      return result(null);
    }
    if (condition.value === 0) continue;
    fired.push(block.id);
    const entryRuntime = runtime;
    const vmActions: RuntimeTriggerBlock["actions"][number][] = [];
    const vmIndexes: number[] = [];
    const stepVm = (): boolean => {
      const vmBlocks = state.blocks.map((candidate) => candidate.id === block.id
        ? { ...candidate, mode: "trip", condition: "1", actions: vmActions }
        : { ...candidate, mode: "norm" });
      const stepped = stepTriggerRuntime(vmBlocks, entryRuntime, { ...inputs, runtimeProfile: options?.runtimeProfile },
        { kind: "trip", triggerId: block.id, team: event.kind === "trip" ? event.team : 0,
          unitType: event.kind === "trip" ? event.unitType : undefined });
      if (!stepped.ok) {
        diagnostics.push(...stepped.diagnostics.map((entry) => ({ ...entry,
          actionIndex: entry.actionIndex === undefined ? undefined : vmIndexes[entry.actionIndex],
        })));
        return false;
      }
      runtime = stepped.value.state;
      return true;
    };
    for (let actionIndex = block.actions.length - 1; actionIndex >= 0; actionIndex -= 1) {
      const action = block.actions[actionIndex];
      const origin = { triggerId: block.id, actionIndex, action };
      trace.push(origin);
      if (isMissionRuntimeAction(action)) {
        if (action.name === "setarray") {
          const expression = action.arguments.slice(1).join(" ");
          const precedingWrites = commands.filter(({ command }) => ["exomoney", "newtype", "reinforce2"].includes(command.kind));
          if (precedingWrites.length > 0 && readsWorldFeedback(expression)) {
            pendingEvaluation = { triggerId: block.id, condition: expression, afterCommandIds: precedingWrites.map(({ id }) => id) };
            return result(null);
          }
        }
        vmActions.unshift(action);
        vmIndexes.unshift(actionIndex);
        if (!stepVm()) return result(null);
        continue;
      }
      const decoded: TriggerResult<MissionWorldCommand> = action.name === "ai" && !options?.aiSelector && !options?.browserAi
        ? { ok: false, diagnostics: [{ code: "unsupported-action", message: "ai: native policy scheduling owner required" }] }
        : decodeMissionWorldAction(action, options);
      if (!decoded.ok) {
        diagnostics.push(...decoded.diagnostics.map((entry) => ({ ...entry, triggerId: block.id, actionIndex })));
      } else {
        commands.push({ ...origin, id: `${state.revision}:${block.id}:${actionIndex}`, command: decoded.value,
          statistics: { ...runtime.statistics } });
      }
    }
    if (diagnostics.length > 0) return result(null);
    if (vmActions.length === 0 && !stepVm()) return result(null);
  }
  return result({ ...state, runtime, consumedLosses, revision: state.revision + 1 });
}

export function executeMissionTransaction<Block extends RuntimeTriggerBlock, World>(
  state: MissionControllerState<Block>,
  inputs: TriggerInputs,
  event: TriggerEvent,
  world: World,
  adapter: MissionTransactionAdapter<World>,
  losses: readonly MissionVictimLoss[] = [],
): TriggerResult<{
  readonly state: MissionControllerState<Block>;
  readonly world: World;
  readonly commands: readonly PlannedMissionCommand[];
  readonly receipts: readonly MissionCommandReceipt[];
  readonly trace: readonly MissionActionTrace[];
  readonly fired: readonly number[];
}> {
  const initialized = planMissionStep({ ...state, blocks: state.blocks.map((block) => ({ ...block,
    condition: "0", actions: [] })) }, inputs, event, losses);
  if (!initialized.next) return { ok: false, diagnostics: initialized.diagnostics };
  let runtime = structuredClone(initialized.next.runtime);
  // Most cycles fire no world command; the world is only copied before the first adapter.prepare.
  let staged = world, stagedIsCopy = false;
  let stagedInputs = { ...structuredClone(inputs), runtimeProfile: adapter.runtimeProfile,
    triggeringUnitType: event.kind === "trip" ? event.unitType : undefined };
  const commands: PlannedMissionCommand[] = [];
  const receipts: MissionCommandReceipt[] = [];
  const trace: MissionActionTrace[] = [];
  const fired: number[] = [];
  for (const block of [...state.blocks].sort((left, right) => left.id - right.id)) {
    if (runtime.lives[block.id] === 0 || (event.kind === "normal"
      ? block.mode !== "norm" : block.mode !== "trip" || block.id !== event.triggerId)) continue;
    const condition = evaluateTriggerCondition(block.condition, runtime.statistics, stagedInputs,
      event.kind === "trip" ? event.team : undefined);
    if (!condition.ok) return { ok: false, diagnostics: condition.diagnostics.map((entry) => ({ ...entry, triggerId: block.id })) };
    if (condition.value === 0) continue;
    fired.push(block.id);
    for (let actionIndex = block.actions.length - 1; actionIndex >= 0; actionIndex -= 1) {
      const action = block.actions[actionIndex];
      const origin = { triggerId: block.id, actionIndex, action };
      const atAction = (diagnostics: readonly TriggerDiagnostic[]): TriggerResult<never> => ({ ok: false,
        diagnostics: diagnostics.map((entry) => ({ ...entry, triggerId: block.id, actionIndex })) });
      trace.push(origin);
      if (isMissionRuntimeAction(action)) {
        const actionBlocks = state.blocks.map((candidate) => ({ ...candidate,
          mode: candidate.id === block.id ? block.mode : event.kind === "normal" ? "trip" : "norm",
          condition: "1", actions: candidate.id === block.id ? [action] : [] }));
        const stepped = stepTriggerRuntime(actionBlocks, { ...runtime,
          lives: { ...runtime.lives, [block.id]: 1 } }, stagedInputs, event);
        if (!stepped.ok) return atAction(stepped.diagnostics);
        const selfRearm = action.name === "setlifes" && action.arguments[0] === block.id;
        runtime = { ...stepped.value.state, lives: { ...stepped.value.state.lives,
          [block.id]: selfRearm ? (stepped.value.state.lives[block.id] + 1) & 255 : runtime.lives[block.id] } };
      } else {
        if (action.name === "ai" && !adapter.aiSelector && !adapter.browserAi) return atAction([{ code: "unsupported-action",
          message: "ai: native policy scheduling owner required" }]);
        const decoded = decodeMissionWorldAction(action, adapter);
        if (!decoded.ok) return atAction(decoded.diagnostics);
        const planned: PlannedMissionCommand = { ...origin, id: `${state.revision}:${block.id}:${actionIndex}`,
          command: decoded.value, statistics: { ...runtime.statistics } };
        if (!stagedIsCopy) { staged = structuredClone(staged); stagedIsCopy = true; }
        const prepared = adapter.prepare(staged, structuredClone([planned]));
        if (!prepared.ok) return atAction(prepared.diagnostics);
        const acceptedReceipts = snapshotReceipts([planned], prepared.value.receipts);
        if (acceptedReceipts === null) {
          return atAction([invalid("Adapter must account for every command in order with a valid disposition")]);
        }
        const feedback = adapter.feedback(prepared.value.world, runtime, stagedInputs);
        if (!feedback.ok) return atAction(feedback.diagnostics);
        staged = feedback.value.world;
        runtime = { ...runtime, statistics: { ...feedback.value.statistics } };
        stagedInputs = { ...stagedInputs, buildingSlots: feedback.value.buildingSlots };
        commands.push(planned);
        receipts.push(...acceptedReceipts);
      }
    }
    runtime = { ...runtime, lives: { ...runtime.lives, [block.id]: (runtime.lives[block.id] - 1) & 255 } };
  }
  return { ok: true, value: { state: { ...state, runtime, consumedLosses: initialized.next.consumedLosses,
    revision: state.revision + 1 }, world: staged, commands, receipts, trace, fired } };
}

function snapshotReceipts(commands: readonly PlannedMissionCommand[], receipts: unknown): MissionCommandReceipt[] | null {
  try {
    if (!Array.isArray(receipts) || receipts.length !== commands.length) return null;
    const accepted: MissionCommandReceipt[] = [];
    for (let index = 0; index < commands.length; index += 1) {
      if (!Object.hasOwn(receipts, index)) return null;
      const receipt: unknown = receipts[index];
      if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt) ||
          !Object.hasOwn(receipt, "commandId") || !Object.hasOwn(receipt, "disposition")) return null;
      const { commandId, disposition } = receipt as { commandId: unknown; disposition: unknown };
      const planned = commands[index];
      const allowed = planned.command.kind === "reinforce" ? ["scheduled"]
        : planned.command.kind === "abduct" ? ["scheduled", "verified-inactive-target"]
        : planned.command.kind === "newtype" || planned.command.kind === "waypoint" ? ["applied", "verified-no-match"] : ["applied"];
      if (typeof commandId !== "string" || commandId !== planned.id ||
          typeof disposition !== "string" || !allowed.includes(disposition)) return null;
      accepted.push({ commandId, disposition: disposition as MissionCommandReceipt["disposition"] });
    }
    return accepted;
  } catch {
    return null;
  }
}

export function commitMissionPlan<Block extends RuntimeTriggerBlock, World>(
  current: MissionControllerState<Block>,
  plan: MissionPlan<Block>,
  world: World,
  adapter: MissionWorldAdapter<World>,
): TriggerResult<{ readonly state: MissionControllerState<Block>; readonly world: World; readonly receipts: readonly MissionCommandReceipt[] }> {
  if (plan.base !== current) return { ok: false, diagnostics: [invalid("Stale mission plan; replan against current state")] };
  if (plan.pendingEvaluation !== null) return { ok: false, diagnostics: [{ code: "missing-input",
    message: "Pending condition requires ordered world feedback before commit", triggerId: plan.pendingEvaluation.triggerId }] };
  if (plan.next === null || plan.diagnostics.length > 0) return { ok: false, diagnostics: plan.diagnostics };
  const unownedAi = !adapter.aiSelector && !adapter.browserAi && plan.commands.find(({ command }) => command.kind === "ai");
  if (unownedAi) return { ok: false, diagnostics: [{ code: "unsupported-action", message: "ai: native policy scheduling owner required",
    triggerId: unownedAi.triggerId, actionIndex: unownedAi.actionIndex }] };
  const prepared = adapter.prepare(world, structuredClone(plan.commands));
  if (!prepared.ok) return prepared;
  const receipts = snapshotReceipts(plan.commands, prepared.value.receipts);
  if (receipts === null) return { ok: false, diagnostics: [invalid("Adapter must account for every command in order with a valid disposition")] };
  return { ok: true, value: { state: plan.next, world: prepared.value.world, receipts } };
}

export function missionBailDeadlineExceeded(bail: TriggerBail | null, clockMilliseconds: number): TriggerResult<boolean> {
  if (!boundedInteger(clockMilliseconds, 4294967295)) return { ok: false, diagnostics: [invalid("Clock must be uint32 milliseconds")] };
  return { ok: true, value: bail !== null && ((bail.deadlineMilliseconds - clockMilliseconds) >>> 0) > 0x80000000 };
}