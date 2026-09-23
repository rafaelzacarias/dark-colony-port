export interface LegacyTriggerAction {
  readonly name: string;
  readonly arguments: readonly (number | string)[];
}

export interface LegacyTriggerBlock {
  readonly mode: string;
  readonly condition: string;
  readonly actions: readonly LegacyTriggerAction[];
}

export interface LegacyMissionEntity {
  readonly source: "placement" | "reinforcement";
  readonly x: number;
  readonly y: number;
  readonly unitType: number;
  readonly team: number;
  readonly rawTail: readonly number[];
}

export interface LegacyWaypointRoute {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

const FORMATION_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function number(value: number | string | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function bounded(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum - 1, value));
}

export function expandLegacyMissionEntities(
  placementRows: readonly (readonly number[])[],
  triggerBlocks: readonly LegacyTriggerBlock[],
  width: number,
  height: number,
): readonly LegacyMissionEntity[] {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError(`invalid mission dimensions: ${width}x${height}`);
  }
  const entities: LegacyMissionEntity[] = placementRows.map((row, index) => {
    if (row.length < 5 || row.some((value) => !Number.isInteger(value))) {
      throw new RangeError(`invalid placement row ${index}`);
    }
    const [x, y, unitType, team, ...rawTail] = row;
    if (x < 0 || x >= width || y < 0 || y >= height || unitType < 0) {
      throw new RangeError(`placement row ${index} is out of bounds`);
    }
    return { source: "placement", x, y, unitType, team, rawTail };
  });

  for (const block of triggerBlocks) {
    if (block.mode.toLowerCase() !== "norm" || block.condition.replace(/\s+/g, "").toLowerCase() !== "(c>0)") {
      continue;
    }
    for (const action of block.actions) {
      if (action.name !== "reinforce" && action.name !== "reinforce2") continue;
      const team = number(action.arguments[0]);
      const anchorX = number(action.arguments[1]);
      const anchorY = number(action.arguments[2]);
      if (team === null || anchorX === null || anchorY === null) continue;
      let formationIndex = 0;
      for (let index = 3; index + 1 < action.arguments.length; index += 2) {
        const unitType = number(action.arguments[index]);
        const count = number(action.arguments[index + 1]);
        if (unitType === null || count === null || unitType < 0 || count <= 0) continue;
        for (let instance = 0; instance < count; instance += 1) {
          const offset = FORMATION_OFFSETS[formationIndex % FORMATION_OFFSETS.length];
          const ring = Math.floor(formationIndex / FORMATION_OFFSETS.length) + 1;
          entities.push({
            source: "reinforcement",
            x: bounded(anchorX + offset[0] * ring, width),
            y: bounded(anchorY + offset[1] * ring, height),
            unitType,
            team,
            rawTail: [],
          });
          formationIndex += 1;
        }
      }
    }
  }
  return entities;
}

export function initialLegacyWaypointRoutes(
  triggerBlocks: readonly LegacyTriggerBlock[],
): readonly LegacyWaypointRoute[] {
  const routes: LegacyWaypointRoute[] = [];
  for (const block of triggerBlocks) {
    if (block.mode.toLowerCase() !== "norm" || block.condition.replace(/\s+/g, "").toLowerCase() !== "(c>0)") {
      continue;
    }
    for (const action of block.actions) {
      if (action.name !== "waypoint") continue;
      const sourceX = number(action.arguments[0]);
      const sourceY = number(action.arguments[1]);
      const count = number(action.arguments[2]);
      if (sourceX === null || sourceY === null || count === null || count <= 0) continue;
      const points: { x: number; y: number }[] = [];
      for (let index = 0; index < count; index += 1) {
        const x = number(action.arguments[3 + index * 2]);
        const y = number(action.arguments[4 + index * 2]);
        if (x === null || y === null) break;
        points.push({ x, y });
      }
      if (points.length === count) routes.push({ sourceX, sourceY, points });
    }
  }
  return routes;
}

export function initialLegacyMessageId(triggerBlocks: readonly LegacyTriggerBlock[]): number | null {
  for (const block of triggerBlocks) {
    if (block.mode.toLowerCase() !== "norm" || block.condition.replace(/\s+/g, "").toLowerCase() !== "(c>0)") {
      continue;
    }
    const action = block.actions.find(({ name }) => name === "msg");
    const messageId = number(action?.arguments[2]);
    if (messageId !== null) return messageId;
  }
  return null;
}
