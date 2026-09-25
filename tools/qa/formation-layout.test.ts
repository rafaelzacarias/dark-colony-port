import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGrid, type GridPoint } from "../../src/engine/grid";
import { findPath } from "../../src/engine/pathfinding";
import { DeterministicRandom } from "../../src/engine/random";
import { DeterministicSimulation } from "../../src/engine/simulation";

// Reference destination policy before lazy floods and cached reverse reachability.
function referenceGoals(grid: NavigationGrid, starts: readonly GridPoint[], target: GridPoint,
  foreign: readonly GridPoint[], diagonal: boolean): readonly GridPoint[] {
  const reserved = new Set(foreign.map(point => grid.index(point.x, point.y)));
  const distance = (point: GridPoint) => Math.abs(point.x - target.x) + Math.abs(point.y - target.y);
  const candidates = Array.from(grid.costs.keys()).filter(index => grid.costs[index] > 0 && !reserved.has(index))
    .sort((a, b) => distance(grid.point(a)) - distance(grid.point(b)) || a - b);
  const assigned: { start: GridPoint; goal: GridPoint }[] = [];
  return starts.map(start => {
    const reachable = new Set([grid.index(start.x, start.y)]), frontier = [...reachable];
    for (let cursor = 0; cursor < frontier.length; cursor++) for (const neighbor of grid.neighbors(frontier[cursor])) {
      if (reachable.has(neighbor) || reserved.has(neighbor)) continue;
      reachable.add(neighbor); frontier.push(neighbor);
    }
    const index = candidates.find(candidate => !reserved.has(candidate) && reachable.has(candidate) &&
      assigned.every(previous => {
        const blocked = new Set(reserved);
        blocked.add(candidate); blocked.delete(grid.index(previous.goal.x, previous.goal.y));
        return findPath(grid, previous.start, previous.goal, { blocked, diagonal }) !== null;
      }));
    if (index === undefined) return start;
    const goal = grid.point(index);
    if (!findPath(grid, start, goal, { diagonal })) return start;
    reserved.add(index); assigned.push({ start, goal });
    return goal;
  });
}

for (const diagonal of [false, true]) test(`formation optimization preserves destination policy across obstructed maps (diagonal=${diagonal})`, () => {
  const random = new DeterministicRandom(0xdc2026);
  const starts = [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 2, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 3 }, { x: 5, y: 3 }];
  const foreign = [{ x: 8, y: 8 }, { x: 9, y: 8 }];
  for (let fixture = 0; fixture < 24; fixture++) {
    const costs = Uint16Array.from({ length: 18 * 18 }, () => random.nextInt(7) === 0 ? 0 : 1);
    for (const point of [...starts, ...foreign]) costs[point.y * 18 + point.x] = 1;
    const grid = new NavigationGrid(18, 18, costs);
    const target = { x: 3 + random.nextInt(12), y: 3 + random.nextInt(12) };
    const expected = referenceGoals(grid, starts, target, foreign, diagonal);
    const simulation = new DeterministicSimulation(grid, diagonal ? { groundMovement: "eight-way-v1" } : {});
    const ids = starts.map(cell => simulation.addUnit({ faction: "human", cell, speedSubcellsPerTick: 100 }));
    foreign.forEach(cell => simulation.addUnit({ faction: "alien", cell }));
    simulation.queue({ type: "move", unitIds: [...ids].reverse(), target });
    simulation.advance();
    const actual = simulation.checkpoint().units.slice(0, starts.length).map((unit, index) => unit.path.at(-1) ?? starts[index]);
    assert.deepEqual(actual, expected, `fixture ${fixture}`);
  }
});
