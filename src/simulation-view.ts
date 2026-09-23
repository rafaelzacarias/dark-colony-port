import { assetUrl } from "./asset-url";
import {
  DeterministicSimulation,
  FixedStepClock,
  NavigationGrid,
  SIMULATION_TICKS_PER_SECOND,
  SUBCELLS_PER_CELL,
  type Faction,
  type SimulationSnapshot,
  type UnitSnapshot,
} from "./engine";
import type { SkirmishBalance } from "./game-data";
import type { HostRequest } from "./engine/transport-host";

interface FrameMetadata {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly empty: boolean;
}

interface SpriteMetadata {
  readonly frames: readonly FrameMetadata[];
}

interface AnimationMetadata {
  readonly states: readonly {
    readonly name: string;
    readonly firstTimelineIndex: number;
    readonly lastTimelineIndex: number;
  }[];
  readonly timeline: readonly {
    readonly children: readonly { readonly sprite: string; readonly frame: number }[];
  }[];
}

interface UnitVisual {
  readonly sprite: string;
  readonly image: HTMLImageElement;
  readonly metadata: SpriteMetadata;
  readonly idleFrames: readonly number[];
  readonly moveFrames: readonly number[];
}

export interface SkirmishStats {
  readonly tick: number;
  readonly selectedCell: string;
  readonly daylight: string;
  readonly selectedState: string;
  readonly healthAndResources: string;
  readonly unitCount: number;
  readonly selectedCount: number;
  readonly missionMessage?: string;
  readonly missionDiagnostic?: string;
}

export interface SkirmishCallbacks {
  readonly onStats: (stats: SkirmishStats) => void;
  readonly onUnitsChanged: (units: readonly UnitSnapshot[], selectedIds: readonly number[]) => void;
  readonly onNativeDeathSound?: (request: Extract<HostRequest, { type: "native-death-sound" }>) => void;
}

export interface SkirmishSessionOptions {
  readonly playerFaction: Faction;
  readonly scriptedDemo?: boolean;
}

const ASSET_ROOT = assetUrl("/assets/generated");

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`Could not load ${url}`)), { once: true });
    image.src = url;
  });
}

function animationFrames(
  animation: AnimationMetadata,
  stateName: string,
  sprite: string,
  frameCount: number,
): number[] {
  const state = animation.states.find(({ name }) => name === stateName);
  if (!state) return [];
  const result: number[] = [];
  let previous: number | null = null;
  for (let index = state.firstTimelineIndex; index <= state.lastTimelineIndex; index += 1) {
    const child = animation.timeline[index]?.children.find(
      (candidate) => candidate.sprite.toLowerCase() === sprite && candidate.frame < frameCount,
    );
    if (child) previous = child.frame;
    if (previous !== null) result.push(previous);
  }
  return result;
}

async function loadVisual(
  sprite: string,
  animationName: string,
  idleState: string,
  moveState: string,
): Promise<UnitVisual> {
  const upperSprite = sprite.toUpperCase();
  const [metadata, animation, image] = await Promise.all([
    loadJson<SpriteMetadata>(`${ASSET_ROOT}/sprites/SPRITES/${upperSprite}.json`),
    loadJson<AnimationMetadata>(`${ASSET_ROOT}/animations/${animationName}.json`),
    loadImage(`${ASSET_ROOT}/sprites/SPRITES/${upperSprite}.png`),
  ]);
  return {
    sprite,
    metadata,
    image,
    idleFrames: animationFrames(animation, idleState, sprite, metadata.frames.length),
    moveFrames: animationFrames(animation, moveState, sprite, metadata.frames.length),
  };
}

export class SkirmishView {
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly callbacks: SkirmishCallbacks;
  readonly grid: NavigationGrid;
  readonly simulation: DeterministicSimulation;
  readonly playerFaction: Faction;
  readonly clock = new FixedStepClock(1000 / SIMULATION_TICKS_PER_SECOND);
  readonly #visuals = new Map<number, UnitVisual>();
  readonly #buildingVisuals = new Map<Faction, UnitVisual>();
  readonly #dropoffs = new Map<Faction, { readonly x: number; readonly y: number }>();
  readonly #selectedIds = new Set<number>();
  readonly #controlAllFactions: boolean;
  #previousSnapshot: SimulationSnapshot;
  #interpolation = 0;
  #lastTime: number | null = null;
  #originX = 0;
  #originY = 0;
  #cellSize = 1;

  constructor(
    canvas: HTMLCanvasElement,
    stage: HTMLElement,
    callbacks: SkirmishCallbacks,
    balance: SkirmishBalance,
    options: SkirmishSessionOptions,
  ) {
    this.canvas = canvas;
    this.stage = stage;
    this.callbacks = callbacks;
    this.playerFaction = options.playerFaction;
    this.#controlAllFactions = options.scriptedDemo === true;
    const costs = new Uint16Array(24 * 16).fill(1);
    for (let y = 1; y < 15; y += 1) {
      if (y !== 4 && y !== 11) costs[y * 24 + 11] = 0;
    }
    for (const [x, y] of [
      [6, 5],
      [7, 5],
      [17, 10],
      [18, 10],
      [4, 12],
      [19, 3],
    ] as const) {
      costs[y * 24 + x] = 0;
    }
    this.grid = new NavigationGrid(24, 16, costs);
    this.simulation = new DeterministicSimulation(this.grid, {
      seed: 0xdc1997,
      dayNightCycleTicks: 400,
      initialResources: { human: 200, alien: 200 },
    });
    const human = this.simulation.addUnit({
      ...balance.humanCombat,
      cell: { x: 2, y: 8 },
    });
    const alien = this.simulation.addUnit({
      ...balance.alienCombat,
      cell: { x: 21, y: 8 },
    });
    const humanHarvester = this.simulation.addUnit({
      ...balance.humanHarvester,
      cell: { x: 2, y: 13 },
      harvester: { cargoCapacity: 60, harvestPerTick: 3 },
    });
    const alienHarvester = this.simulation.addUnit({
      ...balance.alienHarvester,
      cell: { x: 21, y: 2 },
      harvester: { cargoCapacity: 60, harvestPerTick: 3 },
    });
    const humanPetra = this.simulation.addResourceNode({ cell: { x: 7, y: 13 }, amount: 600 });
    const alienPetra = this.simulation.addResourceNode({ cell: { x: 16, y: 2 }, amount: 600 });
    const humanCore = this.simulation.addBuilding({
      faction: "human",
      kind: "core",
      cell: { x: 1, y: 13 },
      maxHealth: 1000,
    });
    const alienCore = this.simulation.addBuilding({
      faction: "alien",
      kind: "core",
      cell: { x: 22, y: 2 },
      maxHealth: 1000,
    });
    this.#dropoffs.set("human", { x: 2, y: 13 });
    this.#dropoffs.set("alien", { x: 21, y: 2 });
    if (options.scriptedDemo) {
      this.simulation.queue({ type: "move", unitIds: [human], target: { x: 16, y: 6 } });
      this.simulation.queue({ type: "move", unitIds: [alien], target: { x: 7, y: 9 } });
      this.simulation.queue({ type: "attack", unitIds: [human], targetId: alien }, 60);
      this.simulation.queue({ type: "attack", unitIds: [alien], targetId: human }, 60);
      this.simulation.queue({
        type: "harvest",
        unitIds: [humanHarvester],
        resourceId: humanPetra,
        dropoff: this.#dropoffs.get("human")!,
      });
      this.simulation.queue({
        type: "harvest",
        unitIds: [alienHarvester],
        resourceId: alienPetra,
        dropoff: this.#dropoffs.get("alien")!,
      });
      this.simulation.queue(
        {
          type: "build",
          builderId: humanCore,
          kind: "turret",
          target: { x: 3, y: 13 },
          cost: 100,
          buildTicks: 40,
          maxHealth: 375,
        },
        10,
      );
      this.simulation.queue(
        {
          type: "build",
          builderId: alienCore,
          kind: "turret",
          target: { x: 20, y: 2 },
          cost: 100,
          buildTicks: 40,
          maxHealth: 375,
        },
        10,
      );
    } else {
      const enemyHarvester = this.playerFaction === "human" ? alienHarvester : humanHarvester;
      const enemyResource = this.playerFaction === "human" ? alienPetra : humanPetra;
      const enemyFaction = this.playerFaction === "human" ? "alien" : "human";
      this.simulation.queue({
        type: "harvest",
        unitIds: [enemyHarvester],
        resourceId: enemyResource,
        dropoff: this.#dropoffs.get(enemyFaction)!,
      });
    }
    this.#selectedIds.add(this.playerFaction === "human" ? human : alien);
    this.#previousSnapshot = this.simulation.snapshot;
  }

  async initialize(): Promise<void> {
    const [human, alien, humanHarvester, alienHarvester, humanTurret, alienTurret] = await Promise.all([
      loadVisual("trooper1", "TROOPER1", "TROOPER1STAND6", "TROOPER1MOVE6"),
      loadVisual("gray", "GRAY", "GRAYSTAND0", "GRAYMOVE0"),
      loadVisual("expl", "EXPL", "EXPLSTAND0", "EXPLMOVE0"),
      loadVisual("slug", "SLUG", "SLUGSTAND0", "SLUGMOVE0"),
      loadVisual("turr", "TURR", "TURRSTAND0", "TURRMOVE0"),
      loadVisual("xeno", "XENO", "XENOSTAND0", "XENOMOVE0"),
    ]);
    this.#visuals.set(1, human);
    this.#visuals.set(2, alien);
    this.#visuals.set(3, humanHarvester);
    this.#visuals.set(4, alienHarvester);
    this.#buildingVisuals.set("human", humanTurret);
    this.#buildingVisuals.set("alien", alienTurret);
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  get selectedId(): number {
    return this.selectedIds[0] ?? 0;
  }

  get selectedIds(): readonly number[] {
    return [...this.#selectedIds].sort((left, right) => left - right);
  }

  selectUnit(id: number, additive = false): void {
    const unit = this.simulation.snapshot.units.find((candidate) => candidate.id === id);
    if (
      !unit ||
      (!this.#controlAllFactions && unit.faction !== this.playerFaction) ||
      unit.activity === "die"
    ) {
      return;
    }
    if (!additive) this.#selectedIds.clear();
    if (additive && this.#selectedIds.has(id)) this.#selectedIds.delete(id);
    else this.#selectedIds.add(id);
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  selectAllPlayerUnits(): void {
    this.#selectedIds.clear();
    for (const unit of this.simulation.snapshot.units) {
      if (unit.faction === this.playerFaction && unit.activity !== "die") this.#selectedIds.add(unit.id);
    }
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  resetClock(): void {
    this.#lastTime = null;
    this.clock.reset();
  }

  update(time: number): void {
    if (this.#lastTime === null) this.#lastTime = time;
    const elapsed = Math.min(250, Math.max(0, time - this.#lastTime));
    this.#lastTime = time;
    const result = this.clock.consume(elapsed, () => {
      this.#previousSnapshot = this.simulation.snapshot;
      this.simulation.advance();
    });
    this.#interpolation = result.interpolation;
    if (result.steps > 0) {
      this.#reconcileSelection();
      this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    }
    this.render();
  }

  commandAt(clientX: number, clientY: number, additiveSelection = false): void {
    const bounds = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - bounds.left - this.#originX) / this.#cellSize);
    const y = Math.floor((clientY - bounds.top - this.#originY) / this.#cellSize);
    if (!this.grid.isPassable(x, y)) return;
    const snapshot = this.simulation.snapshot;
    const friendly = snapshot.units.find(
      (unit) =>
        (this.#controlAllFactions || unit.faction === this.playerFaction) &&
        unit.activity !== "die" &&
        unit.cellX === x &&
        unit.cellY === y,
    );
    if (friendly) {
      this.selectUnit(friendly.id, additiveSelection);
      return;
    }
    const selected = snapshot.units.filter(
      (unit) =>
        this.#selectedIds.has(unit.id) &&
        (this.#controlAllFactions || unit.faction === this.playerFaction) &&
        unit.activity !== "die",
    );
    if (selected.length === 0) return;
    const commandingFaction = selected[0].faction;
    const enemy = snapshot.units.find(
      (unit) =>
        unit.faction !== commandingFaction &&
        unit.activity !== "die" &&
        unit.cellX === x &&
        unit.cellY === y,
    );
    if (enemy) {
      this.simulation.queue({ type: "attack", unitIds: selected.map(({ id }) => id), targetId: enemy.id });
      return;
    }
    const resource = snapshot.resourceNodes.find((node) => node.cellX === x && node.cellY === y && node.remaining > 0);
    const harvesters = selected.filter(({ cargoCapacity }) => cargoCapacity > 0);
    const dropoff = this.#dropoffs.get(commandingFaction);
    if (resource && harvesters.length > 0 && dropoff) {
      this.simulation.queue({
        type: "harvest",
        unitIds: harvesters.map(({ id }) => id),
        resourceId: resource.id,
        dropoff,
      });
      return;
    }
    this.simulation.queue({ type: "move", unitIds: selected.map(({ id }) => id), target: { x, y } });
  }

  render(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(bounds.width));
    const height = Math.max(1, Math.floor(bounds.height));
    this.canvas.width = Math.floor(width * ratio);
    this.canvas.height = Math.floor(height * ratio);
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    this.#cellSize = Math.max(4, Math.floor(Math.min((width - 48) / this.grid.width, (height - 48) / this.grid.height)));
    this.#originX = Math.floor((width - this.grid.width * this.#cellSize) / 2);
    this.#originY = Math.floor((height - this.grid.height * this.#cellSize) / 2);

    context.fillStyle = "#0d1610";
    context.fillRect(
      this.#originX,
      this.#originY,
      this.grid.width * this.#cellSize,
      this.grid.height * this.#cellSize,
    );
    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        const blocked = !this.grid.isPassable(x, y);
        context.fillStyle = blocked ? "#293028" : (x + y) % 2 === 0 ? "#111c14" : "#101912";
        context.fillRect(
          this.#originX + x * this.#cellSize,
          this.#originY + y * this.#cellSize,
          this.#cellSize - 1,
          this.#cellSize - 1,
        );
      }
    }

    const snapshot = this.simulation.snapshot;
    const visibility = this.simulation.visibilityMask(this.playerFaction, 4);
    for (const building of snapshot.buildings) {
      if (
        building.faction !== this.playerFaction &&
        !visibility[building.cellY * this.grid.width + building.cellX]
      ) {
        continue;
      }
      const x = this.#originX + (building.cellX + 0.5) * this.#cellSize;
      const y = this.#originY + (building.cellY + 0.5) * this.#cellSize;
      if (building.kind === "turret") {
        this.#drawBuildingVisual(context, building.faction, x, y);
      } else {
        context.fillStyle = building.faction === "human" ? "#315d72" : "#71362f";
        context.beginPath();
        context.arc(x, y, this.#cellSize * 0.55, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = building.faction === "human" ? "#74c8e8" : "#e27968";
        context.stroke();
      }
      const construction = building.constructionQueue[0];
      if (construction) {
        const progress = 1 - construction.remainingTicks / construction.totalTicks;
        const targetX = this.#originX + (construction.targetCellX + 0.5) * this.#cellSize;
        const targetY = this.#originY + (construction.targetCellY + 0.5) * this.#cellSize;
        context.beginPath();
        context.arc(targetX, targetY, this.#cellSize * 0.35, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        context.strokeStyle = "#d8b65d";
        context.lineWidth = 3;
        context.stroke();
      }
    }

    for (const node of snapshot.resourceNodes) {
      if (!visibility[node.cellY * this.grid.width + node.cellX]) continue;
      const x = this.#originX + (node.cellX + 0.5) * this.#cellSize;
      const y = this.#originY + (node.cellY + 0.5) * this.#cellSize;
      const fullness = node.remaining / 600;
      const glow = context.createRadialGradient(x, y, 1, x, y, this.#cellSize * 0.7);
      glow.addColorStop(0, `rgba(111, 236, 211, ${0.8 * fullness})`);
      glow.addColorStop(0.45, `rgba(63, 151, 139, ${0.55 * fullness})`);
      glow.addColorStop(1, "rgba(21, 72, 67, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, this.#cellSize * 0.7, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#a0f1e1";
      context.fillRect(x - 2, y - 4, 4, 8);
    }

    const previousById = new Map(this.#previousSnapshot.units.map((unit) => [unit.id, unit]));
    const sortedUnits = [...snapshot.units].sort(
      (left, right) => left.ySubcells - right.ySubcells || left.id - right.id,
    );
    for (const unit of sortedUnits) {
      if (
        unit.faction !== this.playerFaction &&
        !visibility[unit.cellY * this.grid.width + unit.cellX]
      ) {
        continue;
      }
      const previous = previousById.get(unit.id) ?? unit;
      const xSubcells = previous.xSubcells + (unit.xSubcells - previous.xSubcells) * this.#interpolation;
      const ySubcells = previous.ySubcells + (unit.ySubcells - previous.ySubcells) * this.#interpolation;
      const screenX = this.#originX + (xSubcells / SUBCELLS_PER_CELL) * this.#cellSize;
      const screenY = this.#originY + (ySubcells / SUBCELLS_PER_CELL) * this.#cellSize;
      const vision = this.simulation.visionRadius(4, unit.faction) * this.#cellSize;
      context.beginPath();
      context.arc(screenX, screenY, vision, 0, Math.PI * 2);
      context.strokeStyle = unit.faction === "human" ? "rgba(90, 183, 232, .16)" : "rgba(218, 82, 63, .16)";
      context.stroke();
      if (this.#selectedIds.has(unit.id)) {
        context.beginPath();
        context.ellipse(screenX, screenY + 3, this.#cellSize * 0.45, this.#cellSize * 0.22, 0, 0, Math.PI * 2);
        context.strokeStyle = "#9ddb75";
        context.lineWidth = 2;
        context.stroke();
      }
      this.#drawUnit(context, unit, screenX, screenY);
      const barWidth = Math.max(14, this.#cellSize * 0.8);
      const healthRatio = unit.health / unit.maxHealth;
      context.fillStyle = "rgba(0, 0, 0, .7)";
      context.fillRect(screenX - barWidth / 2, screenY - this.#cellSize * 0.75, barWidth, 3);
      context.fillStyle = unit.faction === "human" ? "#61b8df" : "#d75548";
      context.fillRect(screenX - barWidth / 2, screenY - this.#cellSize * 0.75, barWidth * healthRatio, 2);
    }

    context.fillStyle = "rgba(2, 5, 4, .76)";
    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        if (visibility[y * this.grid.width + x]) continue;
        context.fillRect(
          this.#originX + x * this.#cellSize,
          this.#originY + y * this.#cellSize,
          this.#cellSize,
          this.#cellSize,
        );
      }
    }

    const darkness = ((1000 - snapshot.daylightPermille) / 1000) * 0.34;
    context.fillStyle = `rgba(4, 10, 20, ${darkness.toFixed(3)})`;
    context.fillRect(0, 0, width, height);
    const selected = snapshot.units.find(({ id }) => this.#selectedIds.has(id));
    this.callbacks.onStats({
      tick: snapshot.tick,
      selectedCell: selected ? `${selected.cellX}, ${selected.cellY}` : "--",
      daylight: `${snapshot.daylightPermille} / 1000`,
      selectedState: selected?.activity.toUpperCase() ?? "--",
      healthAndResources: selected
        ? `${selected.health}/${selected.maxHealth} · H${snapshot.resources.human} A${snapshot.resources.alien}`
        : `H${snapshot.resources.human} A${snapshot.resources.alien}`,
      unitCount: snapshot.units.length,
      selectedCount: this.#selectedIds.size,
    });
  }

  #reconcileSelection(): void {
    const alive = this.simulation.snapshot.units.filter(
      (unit) =>
        (this.#controlAllFactions || unit.faction === this.playerFaction) &&
        unit.activity !== "die",
    );
    const aliveIds = new Set(alive.map(({ id }) => id));
    for (const id of this.#selectedIds) {
      if (!aliveIds.has(id)) this.#selectedIds.delete(id);
    }
    if (this.#selectedIds.size === 0 && alive[0]) this.#selectedIds.add(alive[0].id);
  }

  #drawUnit(context: CanvasRenderingContext2D, unit: UnitSnapshot, screenX: number, screenY: number): void {
    const visual = this.#visuals.get(unit.id);
    if (!visual) return;
    const sequence = unit.activity === "move" && visual.moveFrames.length > 0 ? visual.moveFrames : visual.idleFrames;
    const frameIndex = sequence.length > 0 ? sequence[Math.floor(this.simulation.snapshot.tick / 3) % sequence.length] : 0;
    const frame = visual.metadata.frames[frameIndex];
    if (!frame || frame.empty) return;
    const scale = Math.max(1, Math.floor(this.#cellSize / 12));
    const width = frame.width * scale;
    const height = frame.height * scale;
    context.drawImage(
      visual.image,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      Math.round(screenX - width / 2),
      Math.round(screenY - height + this.#cellSize * 0.35),
      width,
      height,
    );
  }

  #drawBuildingVisual(
    context: CanvasRenderingContext2D,
    faction: Faction,
    screenX: number,
    screenY: number,
  ): void {
    const visual = this.#buildingVisuals.get(faction);
    const frameIndex = visual?.idleFrames[0] ?? 0;
    const frame = visual?.metadata.frames[frameIndex];
    if (!visual || !frame || frame.empty) return;
    const scale = Math.max(1, Math.floor(this.#cellSize / 14));
    const width = frame.width * scale;
    const height = frame.height * scale;
    context.drawImage(
      visual.image,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      Math.round(screenX - width / 2),
      Math.round(screenY - height + this.#cellSize * 0.45),
      width,
      height,
    );
  }
}