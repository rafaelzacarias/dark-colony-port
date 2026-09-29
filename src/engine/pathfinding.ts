import type { GridPoint } from "./grid";
import { NavigationGrid } from "./grid";

interface OpenNode {
  readonly index: number;
  readonly cost: number;
  readonly heuristic: number;
}

function compareNodes(left: OpenNode, right: OpenNode): number {
  const leftTotal = left.cost + left.heuristic;
  const rightTotal = right.cost + right.heuristic;
  return leftTotal - rightTotal || left.heuristic - right.heuristic || left.index - right.index;
}

class MinHeap {
  readonly #values: OpenNode[] = [];

  get size(): number {
    return this.#values.length;
  }

  push(value: OpenNode): void {
    this.#values.push(value);
    let index = this.#values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareNodes(this.#values[parent], value) <= 0) break;
      this.#values[index] = this.#values[parent];
      index = parent;
    }
    this.#values[index] = value;
  }

  pop(): OpenNode | undefined {
    const first = this.#values[0];
    const last = this.#values.pop();
    if (!last || this.#values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#values.length) break;
      let child = left;
      if (right < this.#values.length && compareNodes(this.#values[right], this.#values[left]) < 0) {
        child = right;
      }
      if (compareNodes(last, this.#values[child]) <= 0) break;
      this.#values[index] = this.#values[child];
      index = child;
    }
    this.#values[index] = last;
    return first;
  }
}

export interface PathfindingOptions {
  readonly diagonal?: boolean;
  readonly blocked?: { has(index: number): boolean };
  readonly maximumVisited?: number;
}

export function findPath(
  grid: NavigationGrid,
  start: GridPoint,
  goal: GridPoint,
  options: PathfindingOptions = {},
): readonly GridPoint[] | null {
  if (!grid.isPassable(start.x, start.y) || !grid.isPassable(goal.x, goal.y)) return null;
  const startIndex = grid.index(start.x, start.y);
  const goalIndex = grid.index(goal.x, goal.y);
  if (options.blocked?.has(goalIndex)) return null;
  if (startIndex === goalIndex) return [start];
  if (grid.neighbors(goalIndex, options.diagonal).every(index => {
    if (index !== startIndex && options.blocked?.has(index)) return true;
    const neighbor = grid.point(index);
    return neighbor.x !== goal.x && neighbor.y !== goal.y &&
      (options.blocked?.has(grid.index(neighbor.x, goal.y)) || options.blocked?.has(grid.index(goal.x, neighbor.y)));
  })) return null;

  const maximumVisited = options.maximumVisited ?? grid.costs.length;
  const area = grid.costs.length, width = grid.width, height = grid.height, gridCosts = grid.costs;
  const scratch = acquireScratch(area);
  const generation = scratch.generation, costs = scratch.costs, stamp = scratch.stamp, previous = scratch.previous;
  const closedStamp = scratch.closed;
  const blocked = options.blocked, diagonalMoves = options.diagonal === true;
  const goalX = goal.x, goalY = goal.y;
  const open = new MinHeap();
  const heuristic = (index: number) => {
    const dx = Math.abs(index % width - goalX), dy = Math.abs(Math.floor(index / width) - goalY);
    return dx + dy + (diagonalMoves ? (Math.SQRT2 - 2) * Math.min(dx, dy) : 0);
  };
  stamp[startIndex] = generation;
  costs[startIndex] = 0;
  previous[startIndex] = -1;
  open.push({ index: startIndex, cost: 0, heuristic: heuristic(startIndex) });
  let visited = 0;
  const offsets = diagonalMoves ? NEIGHBOR_OFFSETS : NEIGHBOR_OFFSETS.slice(0, 4);

  while (open.size > 0 && visited < maximumVisited) {
    const current = open.pop()!;
    const currentIndex = current.index;
    if (closedStamp[currentIndex] === generation || current.cost !== costs[currentIndex]) continue;
    closedStamp[currentIndex] = generation;
    visited += 1;
    if (currentIndex === goalIndex) {
      const indices: number[] = [];
      for (let index = goalIndex; index >= 0; index = previous[index]) {
        indices.push(index);
        if (index === startIndex) break;
      }
      indices.reverse();
      return indices.map((index) => grid.point(index));
    }
    const fromX = currentIndex % width, fromY = (currentIndex - fromX) / width;
    for (let step = 0; step < offsets.length; step++) {
      const dx = offsets[step][0], dy = offsets[step][1];
      const toX = fromX + dx, toY = fromY + dy;
      if (toX < 0 || toY < 0 || toX >= width || toY >= height) continue;
      const neighbor = toY * width + toX;
      const neighborCost = gridCosts[neighbor];
      if (neighborCost === 0) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (gridCosts[fromY * width + toX] === 0 || gridCosts[toY * width + fromX] === 0)) continue;
      if (closedStamp[neighbor] === generation || (neighbor !== startIndex && blocked?.has(neighbor))) continue;
      if (diagonal && (blocked?.has(fromY * width + toX) || blocked?.has(toY * width + fromX))) continue;
      const nextCost = current.cost + neighborCost * (diagonal ? Math.SQRT2 : 1);
      if (stamp[neighbor] === generation && nextCost >= costs[neighbor]) continue;
      stamp[neighbor] = generation;
      costs[neighbor] = nextCost;
      previous[neighbor] = currentIndex;
      open.push({ index: neighbor, cost: nextCost, heuristic: heuristic(neighbor) });
    }
  }
  return null;
}

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

// Generation-stamped scratch buffers avoid reallocating and refilling map-sized arrays per search.
const scratchState = { area: 0, generation: 0, costs: new Float64Array(0), stamp: new Uint32Array(0),
  closed: new Uint32Array(0), previous: new Int32Array(0) };
function acquireScratch(area: number) {
  if (scratchState.area !== area || scratchState.generation >= 0xfffffffe) {
    scratchState.area = area;
    scratchState.generation = 0;
    scratchState.costs = new Float64Array(area);
    scratchState.stamp = new Uint32Array(area);
    scratchState.closed = new Uint32Array(area);
    scratchState.previous = new Int32Array(area);
  }
  scratchState.generation += 1;
  return scratchState;
}
