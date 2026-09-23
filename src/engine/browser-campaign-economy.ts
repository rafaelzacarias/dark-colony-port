import type { CampaignWorld } from "./campaign-world";
import { activateBrowserIncomeInterception, initializeBrowserIncomeInterception, observeBrowserIncomeInterception,
  splitBrowserInterceptedIncome, validateBrowserIncomeInterception,
  type BrowserIncomeInterceptionAction, type BrowserIncomeInterceptionFrame,
  type BrowserIncomeInterceptionState } from "./browser-income-interception";
import { SUBCELLS_PER_CELL } from "./constants";
import type { GridPoint } from "./grid";
import { findPath } from "./pathfinding";
import type { AddResourceNodeOptions, AddUnitOptions, DeterministicSimulation } from "./simulation";

export interface BrowserEconomyProfile {
  readonly scope: "browser-adapted-economy-v1";
  readonly profileId: string;
  readonly sessionId: string;
  readonly policy: {
    readonly ticksPerSecond: 20;
    readonly extractionPeriodTicks: number;
    readonly delivery: "direct-team-credit";
    readonly timing: "adapted-not-native";
  };
  readonly initialCredits: Readonly<Record<number, number>>;
  readonly nodes: readonly (AddResourceNodeOptions & {
    readonly key: string; readonly slot: number; readonly sourceRow: number; readonly rateWord: number;
  })[];
  readonly harvesters: readonly {
    readonly key: string; readonly slot: number; readonly generation: number;
    readonly team: number; readonly typeId: 6 | 14; readonly options: AddUnitOptions;
  }[];
  readonly dropoffs: readonly { readonly team: number; readonly cell: GridPoint }[];
}

export interface BrowserEconomyBinding {
  readonly key: string;
  readonly simulationId: number;
}

export interface BrowserEconomyOrder {
  readonly simulationId: number;
  readonly nodeKey: string;
  readonly target: GridPoint;
  readonly phase: "moving" | "extracting";
  readonly progressTicks: number;
}

export interface BrowserEconomyCheckpoint {
  readonly scope: "browser-adapted-economy-v1";
  readonly profileId: string;
  readonly sessionId: string;
  readonly tick: number;
  readonly bindings: readonly BrowserEconomyBinding[];
  readonly harvesters: BrowserEconomyProfile["harvesters"];
  readonly remaining: Readonly<Record<string, number>>;
  readonly rates: Readonly<Record<string, number>>;
  readonly earned: Readonly<Record<number, number>>;
  readonly orders: readonly BrowserEconomyOrder[];
  readonly incomeInterception?: BrowserIncomeInterceptionState;
}

export interface BrowserEconomyIncome {
  readonly scope: "browser-adapted-economy-v1";
  readonly profileId: string;
  readonly sessionId: string;
  readonly team: number;
  readonly earnedTotal: number;
}

export interface BrowserEconomyIncomeLedger {
  readonly profileId: string;
  readonly sessionId: string;
  readonly earned: Readonly<Record<number, number>>;
}

function requireEconomy(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`Browser economy: ${message}`);
}

export function initializeBrowserEconomyWorld(profile: BrowserEconomyProfile, world: CampaignWorld): CampaignWorld {
  requireEconomy(profile.scope === "browser-adapted-economy-v1" && profile.sessionId === world.sessionId
    && world.clockMilliseconds === 0, "fresh matching economy world required");
  for (const [team, credits] of Object.entries(world.exomoney)) {
    requireEconomy(profile.initialCredits[Number(team)] === credits, "existing money differs from SCN");
  }
  return { ...world, exomoney: { ...profile.initialCredits } };
}

export class BrowserCampaignEconomy {
  readonly #profile: BrowserEconomyProfile;
  #bindings: readonly BrowserEconomyBinding[];
  #harvesters: BrowserEconomyProfile["harvesters"];
  #state: BrowserEconomyCheckpoint;

  constructor(profile: BrowserEconomyProfile, simulation: DeterministicSimulation,
    bindings: readonly BrowserEconomyBinding[], checkpoint?: BrowserEconomyCheckpoint) {
    requireEconomy(profile.scope === "browser-adapted-economy-v1" && profile.profileId.length > 0
      && profile.policy.ticksPerSecond === 20 && profile.policy.timing === "adapted-not-native"
      && profile.policy.delivery === "direct-team-credit"
      && Number.isSafeInteger(profile.policy.extractionPeriodTicks) && profile.policy.extractionPeriodTicks > 0,
    "explicit adapted profile required");
    this.#profile = structuredClone(profile);
    this.#bindings = structuredClone(bindings);
    this.#harvesters = structuredClone(checkpoint?.harvesters ?? profile.harvesters);
    requireEconomy(bindings.length === this.#harvesters.length
      && new Set(bindings.map(binding => binding.key)).size === bindings.length
      && new Set(bindings.map(binding => binding.simulationId)).size === bindings.length, "harvester census mismatch");
    const snapshot = simulation.snapshot;
    for (const actor of this.#harvesters) {
      const binding = bindings.find(entry => entry.key === actor.key);
      const unit = snapshot.units.find(entry => entry.id === binding?.simulationId);
      requireEconomy(unit && !unit.resourceActor && unit.team === actor.team
        && unit.faction === actor.options.faction && unit.maxHealth === actor.options.maxHealth,
      "source harvester binding mismatch or native owner present");
      if (!checkpoint) requireEconomy(unit.health === actor.options.health
        && unit.xSubcells === actor.options.positionSubcells?.x && unit.ySubcells === actor.options.positionSubcells?.y,
      "source harvester initial pose/health mismatch");
    }
    this.#state = checkpoint ? structuredClone(checkpoint) : {
      scope: profile.scope, profileId: profile.profileId, sessionId: profile.sessionId,
      tick: snapshot.tick, bindings: this.#bindings, harvesters: this.#harvesters,
      remaining: Object.fromEntries(profile.nodes.map(node => [node.key, node.amount])),
      rates: Object.fromEntries(profile.nodes.map(node => [node.key, node.rateWord])),
      earned: Object.fromEntries(Object.keys(profile.initialCredits).map(team => [team, 0])), orders: [],
    };
    this.#validateState(snapshot.tick);
  }

  checkpoint(): BrowserEconomyCheckpoint { return structuredClone(this.#state); }

  get deployedInterceptors(): readonly number[] {
    return this.#state.incomeInterception?.deployments.map(actor => actor.simulationId) ?? [];
  }

  interceptionFrame(simulation: DeterministicSimulation,
    ground: Omit<BrowserIncomeInterceptionFrame, "collectors" | "tick">): BrowserIncomeInterceptionFrame {
    const snapshot = simulation.snapshot;
    const collectors: BrowserIncomeInterceptionFrame["collectors"][number][] = [];
    for (const order of this.#state.orders) {
      if (order.phase !== "extracting" || this.#state.remaining[order.nodeKey] <= 0 || this.#state.rates[order.nodeKey] <= 0) continue;
      const unit = snapshot.units.find(entry => entry.id === order.simulationId);
      if (!unit || unit.health <= 0 || unit.activity !== "idle" || unit.movementPlane === "air"
        || unit.xSubcells !== (order.target.x + 0.5) * SUBCELLS_PER_CELL
        || unit.ySubcells !== (order.target.y + 0.5) * SUBCELLS_PER_CELL) continue;
      const binding = this.#bindings.find(entry => entry.simulationId === unit.id)!;
      const actor = this.#harvesters.find(entry => entry.key === binding.key)!;
      collectors.push({ key: actor.key, slot: actor.slot, generation: actor.generation, team: actor.team,
        simulationId: unit.id, currentType: actor.typeId === 6 ? 47 : 48 });
    }
    return { ...ground, tick: snapshot.tick, collectors };
  }

  observeInterception(simulation: DeterministicSimulation, frame: BrowserIncomeInterceptionFrame): void {
    requireEconomy(simulation.snapshot.tick === this.#state.tick, "observe simulation before acquisition");
    if (!this.#state.incomeInterception) return;
    this.#state = { ...this.#state, incomeInterception:
      observeBrowserIncomeInterception(this.#state.incomeInterception, simulation.snapshot, frame) };
  }

  haltDeployed(simulation: DeterministicSimulation): void {
    if (this.deployedInterceptors.length) simulation.queue({ type: "stop", unitIds: this.deployedInterceptors });
  }

  assignComputerHarvesters(simulation: DeterministicSimulation): void {
    const snapshot = simulation.snapshot;
    for (const actor of this.#harvesters) {
      if (actor.team === 0) continue;
      const binding = this.#bindings.find(entry => entry.key === actor.key)!;
      const unit = snapshot.units.find(entry => entry.id === binding.simulationId);
      if (!unit || unit.health <= 0 || unit.activity !== "idle"
        || this.#state.orders.some(order => order.simulationId === unit.id)) continue;
      const nodes = this.#profile.nodes.filter(node => this.#state.remaining[node.key] > 0 && this.#state.rates[node.key] > 0)
        .sort((left, right) => Math.abs(left.cell.x - unit.cellX) + Math.abs(left.cell.y - unit.cellY)
          - Math.abs(right.cell.x - unit.cellX) - Math.abs(right.cell.y - unit.cellY) || left.slot - right.slot);
      for (const node of nodes) if (this.harvest(simulation, [unit.id], node.key, actor.team).length) break;
    }
  }

  activateIncomeInterception(simulation: DeterministicSimulation, action: BrowserIncomeInterceptionAction): void {
    requireEconomy(simulation.snapshot.tick === this.#state.tick, "observe simulation before activation");
    if (action.type === "deploy") requireEconomy(Object.hasOwn(this.#state.earned, action.actor.team)
      && !this.#bindings.some(binding => binding.key === action.actor.key || binding.simulationId === action.actor.simulationId)
      && !this.#harvesters.some(actor => actor.slot === action.actor.slot), "interceptor identity conflicts with collector");
    const incomeInterception = activateBrowserIncomeInterception(
      this.#state.incomeInterception ?? initializeBrowserIncomeInterception(), simulation.snapshot, action);
    this.#state = { ...this.#state, incomeInterception };
  }

  synchronizeSourceRates(world: CampaignWorld): void {
    requireEconomy(world.sessionId === this.#profile.sessionId, "source rate session mismatch");
    const rates = { ...this.#state.rates };
    for (const node of this.#profile.nodes) {
      const entity = world.entities.find(entry => entry.key === node.key);
      requireEconomy(entity && entity.rawSlot === node.slot && entity.sourceRow === node.sourceRow
        && entity.unitType === 40 && entity.tileX === node.cell.x && entity.tileY === node.cell.y
        && Number.isInteger(entity.resource?.rateWord) && entity.resource!.rateWord >= 0
        && entity.resource!.rateWord <= 32767, "source VENT rate binding mismatch");
      rates[node.key] = entity.resource!.rateWord;
    }
    const orders = this.#state.orders.filter(order => rates[order.nodeKey] > 0).map(order =>
      rates[order.nodeKey] === this.#state.rates[order.nodeKey] ? order : { ...order, progressTicks: 0 });
    this.#state = { ...this.#state, rates, orders };
  }

  bindHarvester(simulation: DeterministicSimulation, actor: BrowserEconomyProfile["harvesters"][number], simulationId: number): void {
    requireEconomy(simulation.snapshot.tick === this.#state.tick, "observe simulation before binding");
    requireEconomy(!this.#bindings.some(binding => binding.key === actor.key || binding.simulationId === simulationId)
      && !this.#harvesters.some(entry => entry.slot === actor.slot && entry.generation === actor.generation), "duplicate harvester identity");
    requireEconomy(!this.#state.incomeInterception?.deployments.some(entry => entry.key === actor.key
      || entry.slot === actor.slot || entry.simulationId === simulationId), "collector identity conflicts with interceptor");
    const unit = simulation.snapshot.units.find(entry => entry.id === simulationId);
    requireEconomy((actor.typeId === 6 || actor.typeId === 14) && actor.options.team === actor.team
      && unit && !unit.resourceActor && unit.team === actor.team && unit.faction === actor.options.faction
      && unit.health === actor.options.health && unit.maxHealth === actor.options.maxHealth
      && unit.xSubcells === actor.options.positionSubcells?.x && unit.ySubcells === actor.options.positionSubcells?.y,
    "source delivery binding mismatch");
    this.#bindings = [...this.#bindings, { key: actor.key, simulationId }];
    this.#harvesters = [...this.#harvesters, structuredClone(actor)];
    this.#state = { ...this.#state, bindings: this.#bindings, harvesters: this.#harvesters };
  }

  get income(): readonly BrowserEconomyIncome[] {
    return Object.entries(this.#state.earned).map(([team, earnedTotal]) => ({
      scope: this.#profile.scope, profileId: this.#profile.profileId, sessionId: this.#profile.sessionId,
      team: Number(team), earnedTotal,
    }));
  }

  get initialLedger(): BrowserEconomyIncomeLedger {
    return { profileId: this.#profile.profileId, sessionId: this.#profile.sessionId, earned: {} };
  }

  harvest(simulation: DeterministicSimulation, selectedIds: readonly number[], nodeKey: string, team: number): readonly number[] {
    requireEconomy(simulation.snapshot.tick === this.#state.tick, "observe simulation before issuing orders");
    const node = this.#profile.nodes.find(entry => entry.key === nodeKey);
    requireEconomy(node, "unknown source VENT");
    if (this.#state.remaining[nodeKey] === 0 || this.#state.rates[nodeKey] === 0) return [];
    const snapshot = simulation.snapshot;
    const orders = [...this.#state.orders];
    const accepted: number[] = [];
    for (const simulationId of [...new Set(selectedIds)].sort((left, right) => left - right)) {
      const binding = this.#bindings.find(entry => entry.simulationId === simulationId);
      const actor = this.#harvesters.find(entry => entry.key === binding?.key);
      const unit = snapshot.units.find(entry => entry.id === simulationId);
      if (!actor || actor.team !== team || !unit || unit.health <= 0 || unit.resourceActor) continue;
      if (orders.some(order => order.nodeKey === nodeKey && order.simulationId !== simulationId)) continue;
      const existing = orders.find(order => order.simulationId === simulationId);
      if (existing?.nodeKey === nodeKey && existing.target.x === node.cell.x && existing.target.y === node.cell.y
        && (unit.activity === "move"
        || (unit.activity === "idle" && unit.xSubcells === (existing.target.x + 0.5) * SUBCELLS_PER_CELL
          && unit.ySubcells === (existing.target.y + 0.5) * SUBCELLS_PER_CELL))) {
        accepted.push(simulationId);
        continue;
      }
      const start = { x: unit.cellX, y: unit.cellY };
      const occupied = new Set(snapshot.units.filter(entry => entry.id !== simulationId && entry.health > 0)
        .map(entry => simulation.grid.index(entry.cellX, entry.cellY)));
      for (const blocker of simulation.checkpoint().staticBlockers) occupied.add(blocker.index);
      for (const order of orders) if (order.simulationId !== simulationId) occupied.add(simulation.grid.index(order.target.x, order.target.y));
      const target = node.cell;
      if (!simulation.grid.isPassable(target.x, target.y) || occupied.has(simulation.grid.index(target.x, target.y))
        || !findPath(simulation.grid, start, target, { blocked: occupied })) continue;
      simulation.queue({ type: "move", unitIds: [simulationId], target });
      const previous = orders.findIndex(order => order.simulationId === simulationId);
      if (previous !== -1) orders.splice(previous, 1);
      orders.push({ simulationId, nodeKey, target, phase: "moving", progressTicks: 0 });
      accepted.push(simulationId);
    }
    this.#state = { ...this.#state, orders: orders.sort((left, right) => left.simulationId - right.simulationId) };
    return accepted;
  }

  cancelOrders(selectedIds: readonly number[]): void {
    this.#state = { ...this.#state, orders: this.#state.orders.filter(order => !selectedIds.includes(order.simulationId)) };
  }

  stop(simulation: DeterministicSimulation, selectedIds: readonly number[]): void {
    requireEconomy(simulation.snapshot.tick === this.#state.tick, "observe simulation before issuing orders");
    const unitIds = [...new Set(selectedIds)].filter(id => this.#bindings.some(binding => binding.simulationId === id));
    simulation.queue({ type: "stop", unitIds });
    this.cancelOrders(unitIds);
  }

  observe(simulation: DeterministicSimulation, interceptionFrame?: BrowserIncomeInterceptionFrame): readonly BrowserEconomyIncome[] {
    const snapshot = simulation.snapshot;
    if (snapshot.tick === this.#state.tick) return this.income;
    requireEconomy(snapshot.tick === this.#state.tick + 1, "one observation per simulation tick required");
    requireEconomy(!interceptionFrame || this.#state.incomeInterception, "explicit interception activation required");
    let incomeInterception = this.#state.incomeInterception
      ? observeBrowserIncomeInterception(this.#state.incomeInterception, snapshot, interceptionFrame) : undefined;
    const remaining = { ...this.#state.remaining }, earned = { ...this.#state.earned };
    const orders: BrowserEconomyOrder[] = [];
    for (const order of this.#state.orders) {
      const unit = snapshot.units.find(entry => entry.id === order.simulationId);
      if (!unit || unit.health <= 0 || unit.resourceActor || remaining[order.nodeKey] === 0) continue;
      const binding = this.#bindings.find(entry => entry.simulationId === order.simulationId)!;
      const actor = this.#harvesters.find(entry => entry.key === binding.key)!;
      requireEconomy(unit.team === actor.team, "harvester team changed without rebinding");
      const arrived = unit.xSubcells === (order.target.x + 0.5) * SUBCELLS_PER_CELL
        && unit.ySubcells === (order.target.y + 0.5) * SUBCELLS_PER_CELL;
      if (order.phase === "moving") {
        if (arrived && unit.activity === "idle") orders.push({ ...order, phase: "extracting", progressTicks: 0 });
        else if (unit.activity === "move") orders.push(order);
        continue;
      }
      if (!arrived || unit.activity !== "idle") continue;
      const progressTicks = order.progressTicks + 1;
      if (progressTicks < this.#profile.policy.extractionPeriodTicks) {
        orders.push({ ...order, progressTicks });
        continue;
      }
      const node = this.#profile.nodes.find(entry => entry.key === order.nodeKey)!;
      const amount = Math.min(this.#state.rates[node.key], remaining[node.key]);
      remaining[node.key] -= amount;
      if (incomeInterception) {
        const split = splitBrowserInterceptedIncome(incomeInterception, snapshot, interceptionFrame, actor, unit, amount);
        incomeInterception = split.state;
        earned[actor.team] = (earned[actor.team] ?? 0) + split.retained;
        if (split.interceptorTeam !== undefined) earned[split.interceptorTeam] += split.stolen;
      } else earned[actor.team] = (earned[actor.team] ?? 0) + amount;
      if (remaining[node.key] > 0) orders.push({ ...order, progressTicks: 0 });
    }
    this.#state = { ...this.#state, tick: snapshot.tick, remaining, earned,
      ...(incomeInterception ? { incomeInterception } : {}),
      orders: orders.filter(order => remaining[order.nodeKey] > 0) };
    return this.income;
  }

  #validateState(tick: number): void {
    const state = this.#state, profile = this.#profile;
    requireEconomy(state.scope === profile.scope && state.profileId === profile.profileId
      && state.sessionId === profile.sessionId && state.tick === tick
      && JSON.stringify(state.bindings) === JSON.stringify(this.#bindings), "checkpoint identity/tick mismatch");
    requireEconomy(Object.keys(state.remaining).length === profile.nodes.length
      && Object.keys(state.rates).length === profile.nodes.length, "resource census mismatch");
    let depleted = 0;
    for (const node of profile.nodes) {
      const remaining = state.remaining[node.key];
      requireEconomy(Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= node.amount, "invalid remaining reserve");
      requireEconomy(Number.isInteger(state.rates[node.key]) && state.rates[node.key] >= 0
        && state.rates[node.key] <= 32767, "invalid source rate");
      depleted += node.amount - remaining;
    }
    if (state.incomeInterception) validateBrowserIncomeInterception(state.incomeInterception, this.#harvesters, state.earned);
    const dissipated = state.incomeInterception?.ledger.reduce((sum, entry) => sum + entry.dissipated, 0) ?? 0;
    requireEconomy(Object.keys(state.earned).length === Object.keys(profile.initialCredits).length
      && Object.entries(state.earned).every(([team, amount]) => Object.hasOwn(profile.initialCredits, team)
        && Number.isSafeInteger(amount) && amount >= 0)
      && Object.values(state.earned).reduce((sum, amount) => sum + amount, 0) + dissipated === depleted, "income/reserve conservation mismatch");
    const seen = new Set<number>();
    const centeredNodes = new Set<string>();
    for (const order of state.orders) {
      const node = profile.nodes.find(entry => entry.key === order.nodeKey);
      requireEconomy(!seen.has(order.simulationId) && this.#bindings.some(binding => binding.simulationId === order.simulationId)
        && node && state.remaining[node.key] > 0 && state.rates[node.key] > 0
        && Number.isInteger(order.target.x) && Number.isInteger(order.target.y)
        && Math.abs(order.target.x - node.cell.x) + Math.abs(order.target.y - node.cell.y) <= 1
        && (order.phase === "moving" || order.phase === "extracting")
        && Number.isInteger(order.progressTicks) && order.progressTicks >= 0
        && order.progressTicks < profile.policy.extractionPeriodTicks
        && (order.phase !== "moving" || order.progressTicks === 0), "invalid checkpoint order");
      seen.add(order.simulationId);
      if (order.target.x === node.cell.x && order.target.y === node.cell.y) {
        requireEconomy(!centeredNodes.has(node.key)
          && state.orders.filter(entry => entry.nodeKey === node.key).length === 1, "contested centered checkpoint order");
        centeredNodes.add(node.key);
      }
    }
  }
}

export function consumeBrowserEconomyIncome(world: CampaignWorld, ledger: BrowserEconomyIncomeLedger,
  receipts: readonly BrowserEconomyIncome[]): { world: CampaignWorld; ledger: BrowserEconomyIncomeLedger; earnedDelta: number } {
  requireEconomy(world.sessionId === ledger.sessionId && ledger.profileId.length > 0, "ledger identity mismatch");
  const earned = { ...ledger.earned }, exomoney = { ...world.exomoney }, statistics = { ...world.statistics };
  let earnedDelta = 0;
  for (const receipt of receipts) {
    requireEconomy(receipt.scope === "browser-adapted-economy-v1" && receipt.profileId === ledger.profileId
      && receipt.sessionId === ledger.sessionId, "income identity mismatch");
    requireEconomy(Number.isInteger(receipt.team) && receipt.team >= 0 && receipt.team < 8
      && Number.isSafeInteger(receipt.earnedTotal) && receipt.earnedTotal >= 0, "invalid income");
    const previous = earned[receipt.team] ?? 0;
    requireEconomy(Number.isSafeInteger(previous) && previous >= 0 && receipt.earnedTotal >= previous, "income counter regressed");
    const delta = receipt.earnedTotal - previous;
    const credits = exomoney[receipt.team];
    requireEconomy(Number.isSafeInteger(credits) && Number.isSafeInteger(credits + delta)
      && credits + delta <= 0x7fffffff, "invalid campaign money");
    exomoney[receipt.team] = credits + delta;
    const incomeKey = `${receipt.team},1`;
    const income = statistics[incomeKey] ?? 0;
    requireEconomy(Number.isSafeInteger(income) && Number.isSafeInteger(income + delta), "invalid campaign income counter");
    statistics[incomeKey] = income + delta;
    earned[receipt.team] = receipt.earnedTotal;
    earnedDelta += delta;
  }
  return { world: { ...world, exomoney, statistics }, ledger: { ...ledger, earned }, earnedDelta };
}