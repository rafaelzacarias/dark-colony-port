import type { SimulationSnapshot, UnitSnapshot } from "./simulation";

export const BROWSER_INCOME_INTERCEPTION_SOURCE = Object.freeze({
  scope: "browser-adapted-income-interception-v2", mobileType: 4, deployedType: 77,
  mobileSprite: "SARG", deployedSprite: "SARGSTL", stolenPercent: 50,
  requiresDeployment: true, requiresVisibility: true, radius: null,
  acquisition: "DC.EXE 0x417944 ordered-ground-scan-11-22",
  settlement: "DC.EXE 0x413780 per-cycle-truncated-halves",
  briefing: "DC/SCENARIO/HUMAN/HUMAN10.TXT",
  executableSha256: "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
  gameStatSha256: "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629",
  evidenceSha256: "b8990a2a38c8e913722570e7600a9b06696286fa2bd7502d754c444e78872246",
  liveVisibility: "adapted-team-fog/native-bit-layout",
  // DC.EXE 0x417d0d-0x417d33 deploys 4->77 and 12->78 through the same completion; 0x417dfa/0x417dff scan for both.
  alienMobileType: 12, alienDeployedType: 78, alienMobileSprite: "PSYC", alienDeployedSprite: "PSYCSTL",
} as const);

export interface BrowserIncomeCollector {
  readonly key: string; readonly slot: number; readonly generation: number; readonly team: number;
}
export interface BrowserIncomeInterceptor extends BrowserIncomeCollector {
  readonly simulationId: number; readonly typeId: 4 | 12;
}
export type BrowserIncomeInterceptionAction =
  | { readonly type: "deploy"; readonly actor: BrowserIncomeInterceptor }
  | { readonly type: "undeploy"; readonly key: string; readonly generation: number };
export interface BrowserIncomeInterceptionFrame {
  readonly tick: number; readonly width: number; readonly height: number;
  readonly groundWords: readonly number[];
  readonly teamVisibilityMasks: readonly number[];
  readonly collectors: readonly (BrowserIncomeCollector & {
    readonly simulationId: number; readonly currentType: 47 | 48;
  })[];
}
interface Partner extends BrowserIncomeCollector {
  readonly simulationId: number; readonly currentType: 47 | 48;
  readonly acquiredTick: number; readonly cell: number;
  readonly groundWord: number; readonly visibilityWord: number;
  readonly visibilityMask: number;
  readonly xSubcells: number; readonly ySubcells: number;
}
export interface BrowserIncomeInterceptionState {
  readonly scope: typeof BROWSER_INCOME_INTERCEPTION_SOURCE.scope;
  readonly policy: "ordered-source-cells/persistent-partner/truncated-halves";
  readonly deployments: readonly (BrowserIncomeInterceptor & {
    readonly xSubcells: number; readonly ySubcells: number;
    readonly acquired: boolean; readonly partner?: Partner;
  })[];
  readonly ledger: readonly {
    readonly collectorKey: string; readonly collectorSlot: number; readonly collectorGeneration: number;
    readonly collectorTeam: number; readonly interceptorKey: string; readonly interceptorSlot: number;
    readonly interceptorGeneration: number; readonly interceptorTeam: number;
    readonly gross: number; readonly stolen: number; readonly dissipated: number;
  }[];
}
function requireInterception(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`Browser income interception: ${message}`);
}
function integer(value: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function identity(actor: BrowserIncomeCollector): boolean {
  return typeof actor.key === "string" && actor.key.length > 0 && integer(actor.slot, 799)
    && integer(actor.generation) && integer(actor.team, 7);
}
export function initializeBrowserIncomeInterception(): BrowserIncomeInterceptionState {
  return { scope: BROWSER_INCOME_INTERCEPTION_SOURCE.scope,
    policy: "ordered-source-cells/persistent-partner/truncated-halves", deployments: [], ledger: [] };
}
export function activateBrowserIncomeInterception(state: BrowserIncomeInterceptionState,
  snapshot: SimulationSnapshot, action: BrowserIncomeInterceptionAction): BrowserIncomeInterceptionState {
  if (action.type === "undeploy") {
    requireInterception(typeof action.key === "string" && integer(action.generation), "invalid undeploy identity");
    return { ...state, deployments: state.deployments.filter(actor =>
      actor.key !== action.key || actor.generation !== action.generation) };
  }
  requireInterception(action.type === "deploy", "unknown deployment action");
  const actor = action.actor;
  const unit = snapshot.units.find(entry => entry.id === actor.simulationId);
  requireInterception(identity(actor) && (actor.typeId === 4 || actor.typeId === 12) && integer(actor.simulationId)
    && unit && unit.team === actor.team && unit.faction === (actor.typeId === 4 ? "human" : "alien") && unit.health > 0
    && unit.movementPlane !== "air" && !unit.resourceActor && unit.activity === "idle",
  "deployment requires a live idle ground source SARGE or PSYC");
  requireInterception(!state.deployments.some(entry => entry.key === actor.key
    || entry.slot === actor.slot || entry.simulationId === actor.simulationId), "duplicate deployment");
  return { ...state, deployments: [...state.deployments,
    { ...actor, xSubcells: unit.xSubcells, ySubcells: unit.ySubcells, acquired: false }]
    .sort((left, right) => left.slot - right.slot) };
}
export function observeBrowserIncomeInterception(state: BrowserIncomeInterceptionState,
  snapshot: SimulationSnapshot, frame?: BrowserIncomeInterceptionFrame): BrowserIncomeInterceptionState {
  if (frame) requireInterception(frame.tick === snapshot.tick && integer(frame.width) && frame.width > 0
    && integer(frame.height) && frame.height > 0 && frame.groundWords.length === frame.width * frame.height
    && frame.groundWords.every(word => integer(word, 0xffffffff))
    && frame.teamVisibilityMasks.length === 8 && frame.teamVisibilityMasks.every(mask => integer(mask, 0xffffffff))
    && frame.collectors.every(actor => identity(actor) && integer(actor.simulationId)
      && (actor.currentType === 47 || actor.currentType === 48))
    && new Set(frame.collectors.map(actor => actor.slot)).size === frame.collectors.length,
  "stale or invalid source ground frame");
  if (frame) for (const collector of frame.collectors) {
    const unit = snapshot.units.find(entry => entry.id === collector.simulationId);
    requireInterception(unit && unit.team === collector.team && unit.health > 0 && unit.movementPlane !== "air"
      && !unit.resourceActor && unit.cellX >= 0 && unit.cellY >= 0
      && unit.cellX < frame.width && unit.cellY < frame.height
      && (frame.groundWords[unit.cellY * frame.width + unit.cellX] & 1023) === collector.slot,
    "inconsistent deployed collector ground binding");
  }
  const live = state.deployments.filter(actor => {
    const unit = snapshot.units.find(entry => entry.id === actor.simulationId);
    if (!unit || unit.health <= 0 || unit.team !== actor.team) return false;
    if (!actor.partner || !frame) return true;
    return frame.collectors.some(collector => collector.key === actor.partner!.key
      && collector.slot === actor.partner!.slot && collector.generation === actor.partner!.generation
      && collector.simulationId === actor.partner!.simulationId && collector.currentType === actor.partner!.currentType
      && snapshot.units.some(target => target.id === collector.simulationId && target.health > 0));
  });
  const occupied = new Set(live.flatMap(actor => actor.partner ? [actor.partner.slot] : []));
  const deployments = live.map(actor => {
    if (actor.acquired || !frame) return actor;
    const thief = snapshot.units.find(unit => unit.id === actor.simulationId)!;
    let partner: Partner | undefined;
    search: for (let band = 0; band <= 11; band++) {
      for (let offset = -22; offset <= 22; offset++) {
        for (const [column, row] of [[thief.cellX - band, thief.cellY + offset],
          [thief.cellX + band, thief.cellY + offset], [thief.cellX + offset, thief.cellY - band],
          [thief.cellX + offset, thief.cellY + band]]) {
          if (column < 0 || row < 0 || column >= frame.width || row >= frame.height) continue;
          const cell = row * frame.width + column, groundWord = frame.groundWords[cell];
          const collector = frame.collectors.find(entry => entry.slot === (groundWord & 1023));
          if (!collector || collector.team === actor.team) continue;
          const unit = snapshot.units.find(entry => entry.id === collector.simulationId);
          if (!unit || unit.health <= 0 || unit.team !== collector.team || unit.movementPlane === "air") continue;
          const visibilityWord = frame.groundWords[unit.cellY * frame.width + unit.cellX];
          if (!(visibilityWord & frame.teamVisibilityMasks[actor.team])) continue;
          if (!occupied.has(collector.slot)) {
            partner = { ...collector, acquiredTick: snapshot.tick, cell, groundWord, visibilityWord,
              visibilityMask: frame.teamVisibilityMasks[actor.team], xSubcells: unit.xSubcells, ySubcells: unit.ySubcells };
            occupied.add(collector.slot);
          }
          break search;
        }
      }
    }
    return { ...actor, acquired: true, ...(partner ? { partner } : {}) };
  });
  return { ...state, deployments };
}
export function splitBrowserInterceptedIncome(state: BrowserIncomeInterceptionState,
  snapshot: SimulationSnapshot, _frame: BrowserIncomeInterceptionFrame | undefined,
  collector: BrowserIncomeCollector, unit: UnitSnapshot, amount: number): {
    state: BrowserIncomeInterceptionState; retained: number; stolen: number; interceptorTeam?: number;
  } {
  requireInterception(integer(amount) && identity(collector), "invalid settlement");
  const interceptor = state.deployments.find(actor => actor.partner?.key === collector.key
    && actor.partner.slot === collector.slot && actor.partner.generation === collector.generation
    && actor.partner.simulationId === unit.id
    && snapshot.units.some(thief => thief.id === actor.simulationId && thief.health > 0));
  if (!interceptor || amount === 0 || unit.health <= 0) return { state, retained: amount, stolen: 0 };
  const ledger = [...state.ledger];
  const index = ledger.findIndex(entry => entry.collectorKey === collector.key
    && entry.collectorGeneration === collector.generation && entry.interceptorKey === interceptor.key
    && entry.interceptorGeneration === interceptor.generation);
  const previous = ledger[index], stolen = Math.floor(amount / 2);
  requireInterception(integer((previous?.gross ?? 0) + amount), "settlement overflow");
  const entry = { collectorKey: collector.key, collectorSlot: collector.slot, collectorGeneration: collector.generation,
    collectorTeam: collector.team, interceptorKey: interceptor.key, interceptorSlot: interceptor.slot,
    interceptorGeneration: interceptor.generation, interceptorTeam: interceptor.team,
    gross: (previous?.gross ?? 0) + amount, stolen: (previous?.stolen ?? 0) + stolen,
    dissipated: (previous?.dissipated ?? 0) + amount % 2 };
  if (index < 0) ledger.push(entry); else ledger[index] = entry;
  return { state: { ...state, ledger }, retained: stolen, stolen, interceptorTeam: interceptor.team };
}
export function validateBrowserIncomeInterception(state: BrowserIncomeInterceptionState,
  collectors: readonly BrowserIncomeCollector[], earned: Readonly<Record<number, number>>): void {
  requireInterception(state.scope === BROWSER_INCOME_INTERCEPTION_SOURCE.scope
    && state.policy === "ordered-source-cells/persistent-partner/truncated-halves"
    && Array.isArray(state.deployments) && Array.isArray(state.ledger), "invalid checkpoint policy");
  const partners = new Set<number>();
  let previousSlot = -1;
  for (const actor of state.deployments) {
    requireInterception(identity(actor) && (actor.typeId === 4 || actor.typeId === 12) && integer(actor.simulationId)
      && integer(actor.xSubcells) && integer(actor.ySubcells) && typeof actor.acquired === "boolean"
      && Object.hasOwn(earned, actor.team) && actor.slot > previousSlot
      && !collectors.some(collector => collector.key === actor.key || collector.slot === actor.slot),
    "invalid checkpoint deployment");
    previousSlot = actor.slot;
    const partner = actor.partner;
    if (partner) {
      requireInterception(actor.acquired && identity(partner) && integer(partner.simulationId)
        && (partner.currentType === 47 || partner.currentType === 48)
        && integer(partner.acquiredTick) && integer(partner.cell) && integer(partner.groundWord, 0xffffffff)
        && integer(partner.visibilityWord, 0xffffffff) && (partner.groundWord & 1023) === partner.slot
        && integer(partner.visibilityMask, 0xffffffff) && Boolean(partner.visibilityWord & partner.visibilityMask)
        && integer(partner.xSubcells) && integer(partner.ySubcells)
        && collectors.some(collector => collector.key === partner.key && collector.slot === partner.slot
          && collector.generation === partner.generation) && !partners.has(partner.slot), "invalid checkpoint partner");
      partners.add(partner.slot);
    }
  }
  requireInterception(new Set(state.deployments.map(actor => actor.key)).size === state.deployments.length
    && new Set(state.deployments.map(actor => actor.simulationId)).size === state.deployments.length, "duplicate checkpoint deployment");
  const pairs = new Set<string>(), accounted: Record<number, number> = {};
  for (const entry of state.ledger) {
    const pair = JSON.stringify([entry.collectorKey, entry.collectorGeneration, entry.interceptorKey, entry.interceptorGeneration]);
    requireInterception(collectors.some(actor => actor.key === entry.collectorKey && actor.slot === entry.collectorSlot
      && actor.generation === entry.collectorGeneration && actor.team === entry.collectorTeam)
      && identity({ key: entry.interceptorKey, slot: entry.interceptorSlot, generation: entry.interceptorGeneration, team: entry.interceptorTeam })
      && Object.hasOwn(earned, entry.interceptorTeam) && integer(entry.gross) && entry.gross > 0
      && integer(entry.stolen) && integer(entry.dissipated) && entry.gross === entry.stolen * 2 + entry.dissipated
      && !pairs.has(pair), "invalid checkpoint split ledger");
    pairs.add(pair);
    accounted[entry.collectorTeam] = (accounted[entry.collectorTeam] ?? 0) + entry.stolen;
    accounted[entry.interceptorTeam] = (accounted[entry.interceptorTeam] ?? 0) + entry.stolen;
  }
  requireInterception(Object.entries(accounted).every(([team, amount]) => integer(amount)
    && amount <= earned[Number(team)]), "split ledger exceeds credited income");
}