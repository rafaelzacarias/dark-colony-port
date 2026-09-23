import type { MissionView, MissionViewCheckpoint } from "../../../src/mission-view";
import { createPlaythroughStrategy, type PlaythroughCommand, type PlaythroughStrategyState } from "./source-playthrough-strategy";

export const ALIEN_PLAYTHROUGH_SEMANTICS = "API automation; explicit 50ms clock; full render; not manual input or native real-time";
export type AlienPlaythroughOutcome = "win" | "loss";
export type AlienPlaythroughStatus = "running" | "outcome" | "limit" | "diagnostic";
export interface AlienPlaythroughAction extends PlaythroughCommand {
  client: [number, number];
  clickedCell: { x: number; y: number };
  cursor: ReturnType<MissionView["cursorAt"]>;
}
export interface AlienPlaythroughContinuation {
  version: 1;
  outcome: AlienPlaythroughOutcome;
  tick: number;
  strategy: PlaythroughStrategyState;
  commandCount: number;
  shots: number;
  deaths: number;
}
export interface AlienPlaythroughCheckpoint {
  view: MissionViewCheckpoint;
  continuation: AlienPlaythroughContinuation;
}
export interface AlienPlaythroughProgress {
  semantics: typeof ALIEN_PLAYTHROUGH_SEMANTICS;
  status: AlienPlaythroughStatus;
  success: boolean;
  tick: number;
  ticksAdvanced: number;
  phase: number;
  commandCount: number;
  actions: AlienPlaythroughAction[];
  shots: number;
  deaths: number;
  outcome: MissionView["missionOutcome"];
  diagnostic: string | null;
}
export interface AlienPlaythroughOptions {
  outcome: AlienPlaythroughOutcome;
  maxTicks?: number;
  batchTicks?: number;
  checkpointEvery?: number;
  continuation?: AlienPlaythroughContinuation;
  onCheckpoint?: (checkpoint: AlienPlaythroughCheckpoint) => void | Promise<void>;
  onProgress?: (progress: AlienPlaythroughProgress) => void | Promise<void>;
}

function integer(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${name}`);
  return value;
}

export function createAlienPlaythroughRunner(view: MissionView, options: AlienPlaythroughOptions) {
  const intent = options.outcome;
  if (intent !== "win" && intent !== "loss") throw new TypeError("Expected win or loss");
  const maxTicks = integer(options.maxTicks ?? 8000, 1, 40000, "maxTicks");
  const batchTicks = integer(options.batchTicks ?? 200, 1, 1000, "batchTicks");
  const checkpointEvery = integer(options.checkpointEvery ?? 1000, 1, 40000, "checkpointEvery");
  const onCheckpoint = options.onCheckpoint, onProgress = options.onProgress;
  if (view.mission.faction !== "alien" || view.mission.scenario.source.sha256 !==
    "3a971792a6661c6595ea22a5fa071abe12d03392ab3d8ec40c212328c1298b1e" || view.mission.triggers.length !== 9 ||
    view.mission.sourceNativeCombat || !view.mission.sourceProduction) {
    throw new TypeError("Expected default original ALIEN01 with all nine TRO blocks");
  }
  if (!view.terrainImage || !view.canvas.getContext("2d")) throw new TypeError("Initialize the rendered MissionView first");
  const saved = options.continuation ? structuredClone(options.continuation) : undefined;
  let tick = view.simulation.snapshot.tick;
  if (saved) {
    if (saved.version !== 1 || saved.outcome !== intent || saved.tick !== tick) throw new TypeError("Continuation/view mismatch");
    integer(saved.tick, 0, maxTicks, "continuation tick");
    integer(saved.commandCount, 0, 40000, "command count");
    integer(saved.shots, 0, Number.MAX_SAFE_INTEGER, "shots");
    integer(saved.deaths, 0, Number.MAX_SAFE_INTEGER, "deaths");
    integer(saved.strategy.phase, 0, 2, "phase");
    integer(saved.strategy.lastCommandTick, -1000, tick, "last command tick");
    if (typeof saved.strategy.lastSignature !== "string") throw new TypeError("Invalid command signature");
  } else if (tick !== 0) throw new TypeError("Start at tick zero, or supply the matching runner continuation");
  const strategy = createPlaythroughStrategy(intent, saved?.strategy);
  let commandCount = saved?.commandCount ?? 0, shots = saved?.shots ?? 0, deaths = saved?.deaths ?? 0;
  let time = 0, busy = false;
  view.resetClock();
  view.update(0);

  function assertClock() {
    if (view.simulation.snapshot.tick !== tick) throw new Error("View advanced outside runner; suspend the host update loop");
  }
  function status(): AlienPlaythroughStatus {
    if (view.missionDiagnostic) return "diagnostic";
    if (view.missionOutcome?.ready) return "outcome";
    return tick >= maxTicks ? "limit" : "running";
  }
  function progress(actions: AlienPlaythroughAction[] = [], ticksAdvanced = 0): AlienPlaythroughProgress {
    const currentStatus = status();
    return { semantics: ALIEN_PLAYTHROUGH_SEMANTICS, status: currentStatus,
      success: currentStatus === "outcome" && view.missionOutcome?.resultCode === (intent === "win" ? 0 : 1),
      tick, ticksAdvanced, phase: strategy.state.phase, commandCount, actions, shots, deaths,
      outcome: view.missionOutcome ? { ...view.missionOutcome } : null, diagnostic: view.missionDiagnostic ?? null };
  }
  function checkpoint(): AlienPlaythroughCheckpoint {
    assertClock();
    return JSON.parse(JSON.stringify({ view: view.checkpoint(), continuation: {
      version: 1, outcome: intent, tick, strategy: strategy.state, commandCount, shots, deaths,
    } })) as AlienPlaythroughCheckpoint;
  }
  function issue(command: PlaythroughCommand, actions: AlienPlaythroughAction[]) {
    if (command.tick !== tick || !view.grid.contains(command.point.x, command.point.y)) throw new Error("Invalid planned command");
    view.clearSelection();
    for (const id of command.ids) view.selectUnit(id, true);
    if (JSON.stringify(view.selectedIds) !== JSON.stringify([...command.ids].sort((left, right) => left - right))) {
      throw new Error("Public selection rejected a planned unit");
    }
    view.setCameraCenter(command.point.x + 0.5, command.point.y + 0.5);
    view.setOrderMode(command.mode);
    const bounds = view.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) throw new Error("Mission canvas must have a visible layout rectangle");
    const client: [number, number] = [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
    const cursor = view.cursorAt(...client);
    if (cursor === "blocked") throw new Error(`Blocked public command at tick ${tick}`);
    const camera = view.cameraView;
    const clickedCell = { x: Math.floor(camera.x + camera.width / 2), y: Math.floor(camera.y + camera.height / 2) };
    view.commandAt(...client);
    actions.push({ ...command, client, clickedCell, cursor });
    commandCount += 1;
  }
  return {
    get progress() { assertClock(); return progress(); },
    checkpoint,
    async step(count = batchTicks): Promise<AlienPlaythroughProgress> {
      integer(count, 1, 1000, "step count");
      if (busy) throw new Error("A runner step is already in progress");
      busy = true;
      const actions: AlienPlaythroughAction[] = [];
      const startTick = tick;
      try {
        assertClock();
        for (let index = 0; index < count && status() === "running"; index += 1) {
          assertClock();
          if (tick % 50 === 0) strategy.plan(view, command => issue(command, actions));
          time += 50;
          view.update(time);
          const nextTick = view.simulation.snapshot.tick;
          if (nextTick !== tick + 1) {
            if (view.missionDiagnostic) { tick = nextTick; break; }
            throw new Error(`Expected one 50ms tick after ${tick}, received ${nextTick}; check host clock ownership`);
          }
          tick = nextTick;
          shots += view.simulation.combatEvents.length;
          deaths += view.simulation.deathEvents.length;
          if (onCheckpoint && tick % checkpointEvery === 0) await onCheckpoint(checkpoint());
        }
        assertClock();
        const result = progress(actions, tick - startTick);
        await onProgress?.(result);
        assertClock();
        return result;
      } finally { busy = false; }
    },
  };
}

export async function driveAlienPlaythrough(view: MissionView, options: AlienPlaythroughOptions): Promise<AlienPlaythroughProgress> {
  const runner = createAlienPlaythroughRunner(view, options);
  let result = runner.progress;
  while (result.status === "running") {
    result = await runner.step();
    if (result.status === "running") await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return result;
}