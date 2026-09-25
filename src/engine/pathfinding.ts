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
  if (grid.neighbors(goalIndex, options.diagonal).every(index => {
    if (index !== startIndex && options.blocked?.has(index)) return true;
    const neighbor = grid.point(index);
    return neighbor.x !== goal.x && neighbor.y !== goal.y &&
      (options.blocked?.has(grid.index(neighbor.x, goal.y)) || options.blocked?.has(grid.index(goal.x, neighbor.y)));
  })) return null;

  const maximumVisited = options.maximumVisited ?? grid.costs.length;
  const costs = new Float64Array(grid.costs.length).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(grid.costs.length).fill(-1);
  const closed = new Uint8Array(grid.costs.length);
  const open = new MinHeap();
  const heuristic = (index: number) => {
    const point = grid.point(index);
    const dx = Math.abs(point.x - goal.x), dy = Math.abs(point.y - goal.y);
    return dx + dy + (options.diagonal ? (Math.SQRT2 - 2) * Math.min(dx, dy) : 0);
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
    const from = grid.point(current.index);
    for (const neighbor of grid.neighbors(current.index, options.diagonal)) {
      if (closed[neighbor] || (neighbor !== startIndex && options.blocked?.has(neighbor))) continue;
      const to = grid.point(neighbor);
      const diagonal = from.x !== to.x && from.y !== to.y;
      if (diagonal && (options.blocked?.has(grid.index(from.x, to.y)) ||
        options.blocked?.has(grid.index(to.x, from.y)))) continue;
      const nextCost = current.cost + grid.costs[neighbor] * (diagonal ? Math.SQRT2 : 1);
      if (nextCost >= costs[neighbor]) continue;
      costs[neighbor] = nextCost;
      previous[neighbor] = current.index;
      open.push({ index: neighbor, cost: nextCost, heuristic: heuristic(neighbor) });
    }
  }
  return null;
}
