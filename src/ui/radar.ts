import type { CampaignMissionData } from "../game-data";
import { drawTerrainLayer } from "../render/terrain";
import type { BuildingSnapshot, SimulationSnapshot, UnitSnapshot } from "../engine";
import type { StaticTargetSnapshot } from "../engine/simulation";

export interface RadarPoint { readonly x: number; readonly y: number }
export interface RadarSize { readonly width: number; readonly height: number }
export interface RadarRect extends RadarPoint, RadarSize {}
export interface RadarClientRect extends RadarSize { readonly left: number; readonly top: number }
export type RadarEntityKind = "unit" | "building";

export interface RadarEntity {
  readonly id: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly owned: boolean;
  readonly health: number;
  readonly activity?: string;
  readonly kind?: RadarEntityKind;
}

export interface RadarFrame {
  readonly visible: ArrayLike<number>;
  readonly explored?: ArrayLike<number>;
  readonly entities: readonly RadarEntity[];
  readonly view: RadarRect;
}

export interface RadarMarker extends RadarPoint {
  readonly id: number;
  readonly owned: boolean;
  readonly kind: RadarEntityKind;
}

export const RADAR_COLORS = {
  unknown: "#000000",
  unresolvedTerrain: "#343434",
  owned: "#56ed87",
  enemy: "#ff635c",
  view: "#ffffff",
} as const;

function validateSize(size: RadarSize): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new RangeError("Radar dimensions must be positive and finite");
  }
}

function validateMap(map: RadarSize): void {
  validateSize(map);
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height)) {
    throw new RangeError("Radar map dimensions must be integer cell counts");
  }
}

function validateFog(map: RadarSize, frame: Pick<RadarFrame, "visible" | "explored">): void {
  validateMap(map);
  const count = map.width * map.height;
  if (frame.visible.length !== count || (frame.explored && frame.explored.length !== count)) {
    throw new RangeError("Radar fog masks must match the map cell count");
  }
}

export function radarMapRect(map: RadarSize, surface: RadarSize): RadarRect {
  validateMap(map);
  validateSize(surface);
  const scale = Math.min(surface.width / map.width, surface.height / map.height);
  const width = map.width * scale;
  const height = map.height * scale;
  return { x: (surface.width - width) / 2, y: (surface.height - height) / 2, width, height };
}

export function radarClientToMap(
  client: RadarPoint,
  bounds: RadarClientRect,
  surface: RadarSize,
  map: RadarSize,
  clampToMap = false,
): RadarPoint | null {
  if (![client.x, client.y, bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) return null;
  const rect = radarMapRect(map, surface);
  const localX = (client.x - bounds.left) * surface.width / bounds.width;
  const localY = (client.y - bounds.top) * surface.height / bounds.height;
  if (!clampToMap && (localX < rect.x || localY < rect.y || localX > rect.x + rect.width || localY > rect.y + rect.height)) return null;
  return {
    x: Math.max(0, Math.min(map.width, (localX - rect.x) / rect.width * map.width)),
    y: Math.max(0, Math.min(map.height, map.height - (localY - rect.y) / rect.height * map.height)),
  };
}

export function radarCellAt(point: RadarPoint, map: RadarSize): RadarPoint {
  validateMap(map);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError("Invalid radar point");
  return {
    x: Math.max(0, Math.min(map.width - 1, Math.floor(point.x))),
    y: Math.max(0, Math.min(map.height - 1, Math.floor(point.y))),
  };
}

export function radarCameraView(map: RadarSize, center: RadarPoint, viewportCells: RadarSize): RadarRect {
  validateMap(map);
  validateSize(viewportCells);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw new RangeError("Invalid camera center");
  const width = Math.min(map.width, viewportCells.width);
  const height = Math.min(map.height, viewportCells.height);
  return {
    x: Math.max(0, Math.min(map.width - width, center.x - width / 2)),
    y: Math.max(0, Math.min(map.height - height, center.y - height / 2)),
    width,
    height,
  };
}

export function radarViewRect(map: RadarSize, surface: RadarSize, view: RadarRect): RadarRect {
  const rect = radarMapRect(map, surface);
  validateSize(view);
  if (!Number.isFinite(view.x) || !Number.isFinite(view.y)) throw new RangeError("Invalid view origin");
  const left = Math.max(0, Math.min(map.width, view.x));
  const top = Math.max(0, Math.min(map.height, view.y));
  const right = Math.max(left, Math.min(map.width, view.x + view.width));
  const bottom = Math.max(top, Math.min(map.height, view.y + view.height));
  return {
    x: rect.x + left / map.width * rect.width,
    y: rect.y + (map.height - bottom) / map.height * rect.height,
    width: (right - left) / map.width * rect.width,
    height: (bottom - top) / map.height * rect.height,
  };
}

export function accumulateRadarExploration(previous: ArrayLike<number>, visible: ArrayLike<number>): Uint8Array {
  if (previous.length !== visible.length) throw new RangeError("Exploration mask size changed");
  return Uint8Array.from(visible, (value, index) => value > 0 || previous[index] > 0 ? 1 : 0);
}

export function snapshotRadarEntities(
  snapshot: Pick<SimulationSnapshot, "units" | "buildings"> & Partial<Pick<SimulationSnapshot, "staticTargets">>,
  isOwned: (entity: UnitSnapshot | BuildingSnapshot | StaticTargetSnapshot, kind: RadarEntityKind) => boolean,
): RadarEntity[] {
  return [
    ...snapshot.units.map((unit) => ({ ...unit, kind: "unit" as const, owned: isOwned(unit, "unit") })),
    ...snapshot.buildings.map((building) => ({ ...building, kind: "building" as const, owned: isOwned(building, "building") })),
    ...(snapshot.staticTargets ?? []).map((target) => ({ ...target, kind: "building" as const, owned: isOwned(target, "building") })),
  ];
}

export function radarMarkers(map: RadarSize, surface: RadarSize, frame: RadarFrame): RadarMarker[] {
  validateFog(map, frame);
  const rect = radarMapRect(map, surface);
  return frame.entities.filter((entity) => {
    if (entity.health <= 0 || !Number.isFinite(entity.health) || entity.activity === "die"
      || !Number.isInteger(entity.cellX) || !Number.isInteger(entity.cellY)
      || entity.cellX < 0 || entity.cellY < 0 || entity.cellX >= map.width || entity.cellY >= map.height) return false;
    return entity.owned || frame.visible[entity.cellY * map.width + entity.cellX] > 0;
  }).map((entity) => ({
    id: entity.id,
    owned: entity.owned,
    kind: entity.kind ?? "unit",
    x: rect.x + (entity.cellX + 0.5) / map.width * rect.width,
    y: rect.y + (map.height - entity.cellY - 0.5) / map.height * rect.height,
  }));
}

export type RadarTerrainSource = Pick<CampaignMissionData, "map" | "tileRecordIndices" | "attributes" | "terrain">;

export function createRadarTerrain(
  source: RadarTerrainSource,
  atlas: CanvasImageSource,
  createCanvas: () => HTMLCanvasElement,
): HTMLCanvasElement {
  validateMap(source.map);
  if (source.map.schemaVersion !== 2 || source.map.referencesPerCell !== 2) {
    throw new RangeError("Radar requires map schema 2 with background/foreground record pairs");
  }
  if (source.tileRecordIndices.length !== source.map.width * source.map.height * 2) {
    throw new RangeError("Radar terrain references must match the map");
  }
  if (source.attributes.length !== source.map.width * source.map.height) {
    throw new RangeError("Radar terrain attributes must match the map");
  }
  const canvas = createCanvas();
  canvas.width = source.map.width * 2;
  canvas.height = source.map.height * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Radar requires a 2D canvas context");
  context.fillStyle = RADAR_COLORS.unresolvedTerrain;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let cellY = 0; cellY < source.map.height; cellY += 1) {
    for (let cellX = 0; cellX < source.map.width; cellX += 1) {
      const offset = (cellY * source.map.width + cellX) * source.map.referencesPerCell;
      for (const layer of [0, 1] as const) {
        if (layer === 1 && source.tileRecordIndices[offset + layer] === 0) continue;
        const tile = source.terrain.tiles[source.tileRecordIndices[offset + layer]];
        if (!tile) continue;
        drawTerrainLayer(context, atlas, tile,
          { x: cellX * 2, y: cellY * 2, width: 2, height: 2 },
          source.attributes[offset / 2], layer);
      }
    }
  }
  return canvas;
}

export function drawRadar(
  context: CanvasRenderingContext2D,
  surface: RadarSize,
  map: RadarSize,
  terrain: CanvasImageSource,
  frame: RadarFrame,
): void {
  validateFog(map, frame);
  const rect = radarMapRect(map, surface);
  const view = radarViewRect(map, surface, frame.view);
  const markers = radarMarkers(map, surface, frame);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.imageSmoothingEnabled = false;
  context.fillStyle = RADAR_COLORS.unknown;
  context.fillRect(0, 0, surface.width, surface.height);
  context.drawImage(terrain, rect.x, rect.y, rect.width, rect.height);
  for (let cellY = 0; cellY < map.height; cellY += 1) {
    for (let cellX = 0; cellX < map.width; cellX += 1) {
      const index = cellY * map.width + cellX;
      if (frame.visible[index] > 0) continue;
      context.fillStyle = frame.explored && frame.explored[index] > 0 ? "rgba(0, 0, 0, 0.72)" : RADAR_COLORS.unknown;
      const left = Math.floor(rect.x + cellX / map.width * rect.width);
      const screenRow = map.height - 1 - cellY;
      const top = Math.floor(rect.y + screenRow / map.height * rect.height);
      context.fillRect(left, top,
        Math.ceil(rect.x + (cellX + 1) / map.width * rect.width) - left,
        Math.ceil(rect.y + (screenRow + 1) / map.height * rect.height) - top);
    }
  }
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  for (const marker of markers) {
    context.fillStyle = marker.owned ? RADAR_COLORS.owned : RADAR_COLORS.enemy;
    const size = marker.kind === "building" ? 3 : 2;
    context.fillRect(Math.floor(marker.x - size / 2), Math.floor(marker.y - size / 2), size, size);
  }
  context.strokeStyle = RADAR_COLORS.view;
  context.lineWidth = 1;
  if (view.width > 0 && view.height > 0) {
    context.strokeRect(view.x + 0.5, view.y + 0.5, Math.max(0, view.width - 1), Math.max(0, view.height - 1));
  }
  context.restore();
}

export interface RadarNavigation {
  readonly point: RadarPoint;
  readonly cell: RadarPoint;
  readonly button: 0 | 2;
}

export function bindRadarPointer(
  canvas: HTMLCanvasElement,
  map: RadarSize,
  onNavigate: (navigation: RadarNavigation) => void,
): () => void {
  validateMap(map);
  let active: { id: number; button: 0 | 2 } | null = null;
  let disposed = false;
  const touchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";
  const pointAt = (event: PointerEvent, clampToMap = false) => radarClientToMap(
    { x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect(), canvas, map, clampToMap,
  );
  const navigate = (point: RadarPoint, button: 0 | 2) => onNavigate({ point, cell: radarCellAt(point, map), button });
  const release = () => {
    const pointer = active;
    active = null;
    if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
  };
  const down = (event: PointerEvent) => {
    if (disposed || active || event.isPrimary === false || (event.button !== 0 && event.button !== 2)) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    active = { id: event.pointerId, button: event.button };
    navigate(point, active.button);
  };
  const move = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.id) return;
    const point = pointAt(event, true);
    event.preventDefault();
    event.stopPropagation();
    if (point) navigate(point, active.button);
  };
  const end = (event: PointerEvent) => {
    if (event.pointerId === active?.id) release();
  };
  const contextmenu = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const stopClick = (event: Event) => { event.stopPropagation(); };
  const host = canvas.ownerDocument.defaultView;
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);
  canvas.addEventListener("contextmenu", contextmenu);
  canvas.addEventListener("click", stopClick);
  canvas.addEventListener("auxclick", stopClick);
  host?.addEventListener("blur", release);
  return () => {
    if (disposed) return;
    disposed = true;
    release();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", end);
    canvas.removeEventListener("pointercancel", end);
    canvas.removeEventListener("lostpointercapture", end);
    canvas.removeEventListener("contextmenu", contextmenu);
    canvas.removeEventListener("click", stopClick);
    canvas.removeEventListener("auxclick", stopClick);
    host?.removeEventListener("blur", release);
    canvas.style.touchAction = touchAction;
  };
}

export function createRadar(options: {
  readonly canvas: HTMLCanvasElement;
  readonly source: RadarTerrainSource;
  readonly atlas: CanvasImageSource;
  readonly onNavigate: (navigation: RadarNavigation) => void;
}) {
  const { canvas, source, atlas, onNavigate } = options;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Radar requires a 2D canvas context");
  const terrain = createRadarTerrain(source, atlas, () => canvas.ownerDocument.createElement("canvas"));
  const unbind = bindRadarPointer(canvas, source.map, onNavigate);
  let disposed = false;
  return {
    render(frame: RadarFrame): void {
      if (!disposed) drawRadar(context, canvas, source.map, terrain, frame);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unbind();
      context.clearRect(0, 0, canvas.width, canvas.height);
      terrain.width = 0;
      terrain.height = 0;
    },
  };
}