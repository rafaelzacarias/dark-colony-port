import type { MissionView } from "../../../src/mission-view";
import { findPath } from "../../../src/engine/pathfinding";
import { areHostile } from "../../../src/engine/diplomacy";

export type PlaythroughPoint = { x: number; y: number };
export type PlaythroughCommand = {
  tick: number; ids: number[]; mode: "move" | "assault"; point: PlaythroughPoint; purpose: string;
};
export type PlaythroughStrategyState = { phase: number; lastSignature: string; lastCommandTick: number };
export type PlaythroughPathBlock = {
  tick: number; leader: MissionView["simulation"]["snapshot"]["units"][number];
  goal: PlaythroughPoint; purpose: string;
};

export function createPlaythroughStrategy(intent: "win" | "loss", saved?: PlaythroughStrategyState) {
  let { phase, lastSignature, lastCommandTick } = saved ?? { phase: 0, lastSignature: "", lastCommandTick: -1000 };
  return {
    get state(): PlaythroughStrategyState { return { phase, lastSignature, lastCommandTick }; },
    plan(view: MissionView, issue: (command: PlaythroughCommand) => void,
      onPathBlock?: (block: PlaythroughPathBlock) => void): void {
      const mission = view.mission;
      const goals = mission.faction === "human" ? [1, 7, 2] : [4, 8];
      const tagCells = (tag: number): PlaythroughPoint[] => Array.from(mission.tags.entries())
        .filter(([, value]) => (value & 63) === tag)
        .map(([index]) => ({ x: index % mission.map.width, y: mission.map.height - 1 - Math.floor(index / mission.map.width) }))
        .filter(({ x, y }) => view.grid.isPassable(x, y));
      const snapshot = view.simulation.snapshot;
      const owned = snapshot.units.filter((unit) => view.isOwnedUnit(unit.id) && unit.health > 0 && unit.activity !== "die");
      if (!owned.length) return;
      const commanderType = mission.faction === "human" ? 69 : 73;
      const bindings = view.nativeBindings;
      const entities = view.campaignSnapshot!.world.entities;
      const commander = owned.find((unit) => entities.some((entity) => entity.unitType === commanderType &&
        bindings.some((binding) => binding.simulationId === unit.id && binding.key === entity.key)));
      const group = intent === "loss" ? (commander ? [commander] : []) : owned;
      if (!group.length) return;
      const center = { x: Math.round(group.reduce((sum, unit) => sum + unit.cellX, 0) / group.length),
        y: Math.round(group.reduce((sum, unit) => sum + unit.cellY, 0) / group.length) };
      const distance = (point: PlaythroughPoint) => Math.abs(point.x - center.x) + Math.abs(point.y - center.y);
      const enemies = snapshot.units.filter((unit) => unit.health > 0 && unit.activity !== "die" &&
        areHostile({ faction: mission.faction, team: 0 }, unit, snapshot.teamAlliances));
      const visible = view.visibility;
      const nearby = enemies.filter((unit) => visible[unit.cellY * mission.map.width + unit.cellX] &&
        distance({ x: unit.cellX, y: unit.cellY }) <= 12)
        .sort((left, right) => left.health - right.health || left.id - right.id)[0];
      let point: PlaythroughPoint | undefined, purpose = "", mode: PlaythroughCommand["mode"] = "assault";
      if (intent === "loss") {
        const enemy = enemies.sort((left, right) => distance({ x: left.cellX, y: left.cellY }) -
          distance({ x: right.cellX, y: right.cellY }) || left.id - right.id)[0];
        if (enemy) { point = { x: enemy.cellX, y: enemy.cellY }; purpose = "expose-commander"; mode = "move"; }
      } else if (nearby) {
        point = { x: nearby.cellX, y: nearby.cellY }; purpose = `visible-enemy:${nearby.id}`;
      } else {
        const lives = view.campaignSnapshot!.controller.runtime.lives;
        while (phase < goals.length && lives[goals[phase]] === 0) phase += 1;
        if (phase < goals.length) {
          point = tagCells(goals[phase]).sort((left, right) => distance(left) - distance(right))[0];
          purpose = `source-trip:${goals[phase]}`;
        } else if (mission.faction === "alien") {
          const target = snapshot.staticTargets.filter((unit) => unit.health > 0 && unit.team === 1)
            .sort((left, right) => distance({ x: left.cellX, y: left.cellY }) - distance({ x: right.cellX, y: right.cellY }) || left.id - right.id)[0];
          if (target) { point = { x: target.cellX, y: target.cellY }; purpose = `source-static:${target.id}`; }
        } else {
          const target = enemies.filter((unit) => unit.team === 4).sort((left, right) => left.id - right.id)[0];
          if (target) { point = { x: target.cellX, y: target.cellY }; purpose = `colony-defender:${target.id}`; }
        }
      }
      if (!point) return;
      const targetVisible = visible[point.y * mission.map.width + point.x];
      if (!purpose.startsWith("visible-enemy") && !(purpose.startsWith("source-static") && targetVisible)) {
        const leader = group.slice().sort((left, right) => distance({ x: left.cellX, y: left.cellY }) -
          distance({ x: right.cellX, y: right.cellY }) || left.id - right.id)[0];
        const blocked = new Set(snapshot.staticTargets.filter((unit) => unit.health > 0)
          .map((unit) => view.grid.index(unit.cellX, unit.cellY)));
        const candidates = [point, ...view.grid.neighbors(view.grid.index(point.x, point.y)).map((index) => view.grid.point(index))];
        const path = candidates.map((goal) => findPath(view.grid, { x: leader.cellX, y: leader.cellY }, goal, { blocked }))
          .find((candidate) => candidate !== null);
        if (!path) { onPathBlock?.({ tick: snapshot.tick, leader, goal: point, purpose }); return; }
        point = path[Math.min(8, path.length - 1)];
      }
      const command: PlaythroughCommand = { tick: snapshot.tick, ids: group.map(({ id }) => id), point, mode, purpose };
      const signature = JSON.stringify({ ...command, tick: 0 });
      if (signature === lastSignature && snapshot.tick - lastCommandTick < 300) return;
      issue(command);
      lastSignature = signature;
      lastCommandTick = snapshot.tick;
    },
  };
}