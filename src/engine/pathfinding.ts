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
  readonly blocked?: ReadonlySet<number>;
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

  const maximumVisited = options.maximumVisited ?? grid.costs.length;
  const costs = new Float64Array(grid.costs.length).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(grid.costs.length).fill(-1);
  const closed = new Uint8Array(grid.costs.length);
  const open = new MinHeap();
  const heuristic = (index: number) => {
    const point = grid.point(index);
    return Math.abs(point.x - goal.x) + Math.abs(point.y - goal.y);
  };
  costs[startIndex] = 0;
  open.push({ index: startIndex, cost: 0, heuristic: heuristic(startIndex) });
  let visited = 0;

  while (open.size > 0 && visited < maximumVisited) {
    const current = open.pop()!;
    if (closed[current.index] || current.cost !== costs[current.index]) continue;
    closed[current.index] = 1;
    visited += 1;
    if (current.index === goalIndex) {
      const indices: number[] = [];
      for (let index = goalIndex; index >= 0; index = previous[index]) {
        indices.push(index);
        if (index === startIndex) break;
      }
      indices.reverse();
      return indices.map((index) => grid.point(index));
    }
    for (const neighbor of grid.neighbors(current.index)) {
      if (closed[neighbor] || (neighbor !== startIndex && options.blocked?.has(neighbor))) continue;
      const nextCost = current.cost + grid.costs[neighbor];
      if (nextCost >= costs[neighbor]) continue;
      costs[neighbor] = nextCost;
      previous[neighbor] = current.index;
      open.push({ index: neighbor, cost: nextCost, heuristic: heuristic(neighbor) });
    }
  }
  return null;
}
