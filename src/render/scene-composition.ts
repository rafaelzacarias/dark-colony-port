import type { FinPoint } from "./fin-animation";
import { finSourceLayerPriority, type FinCompositionPart } from "./fin-composition";

export interface NativeScenePosition extends FinPoint {
  readonly heightOffset: number;
}

export interface SceneBodyInput {
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
}

export interface SceneSpriteInput extends SceneBodyInput {
  readonly id: string;
  readonly submissionWord: number;
}

export interface SceneTerrainCommand {
  readonly kind: "terrain";
  readonly column: number;
  readonly row: number;
  readonly backgroundIndex: number;
  readonly foregroundIndex: number;
  readonly attributes: number;
  readonly foregroundMask?: ArrayLike<number>;
}

export interface SceneClipSpan extends FinPoint {
  readonly width: number;
  readonly height: number;
}

export interface SceneSpriteCommand<Source extends SceneBodyInput = SceneSpriteInput> {
  readonly kind: "sprite";
  readonly source: Source;
  readonly topLeft: FinPoint;
  readonly compositionOrigin: FinPoint;
  readonly clips: readonly SceneClipSpan[] | null;
  readonly diagnostics: readonly string[];
}

export interface SceneDrawPlan {
  readonly commands: readonly (SceneTerrainCommand | SceneSpriteCommand)[];
  readonly diagnostics: readonly string[];
  readonly verifiedSubset: boolean;
}

function integer(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(label);
}

function signedWord(value: number): number {
  return (value << 16) >> 16;
}

export function nativeScenePosition(
  xEighth: number, yEighth: number, heightEighth: number, mapHeightEighth: number,
): NativeScenePosition {
  for (const value of [xEighth, yEighth, heightEighth, mapHeightEighth]) {
    integer(value, -2147483648, 2147483647, "Native coordinates must be signed dwords");
  }
  return { x: signedWord(xEighth >> 3), y: signedWord(((mapHeightEighth - yEighth - 1) | 0) >> 3),
    heightOffset: signedWord(-(heightEighth >> 3)) };
}

export function nativeOrdinarySceneSubmissionWord(yQ8: number, sourceChildOrdinal: number): number {
  integer(yQ8, 0, 65535, "Entity Y must be an unsigned native Q8 word");
  integer(sourceChildOrdinal, 0, 799, "Source child ordinal must be within the native queue bound");
  return ((yQ8 & 0xfff8) - sourceChildOrdinal) >>> 0;
}

export function nativeSceneKey(sprite: SceneSpriteInput): number {
  return (((finSourceLayerPriority(sprite.part.child.layer) + sprite.submissionWord) << 16) + sprite.position.x) | 0;
}

export function compareNativeSceneSprites(left: SceneSpriteInput, right: SceneSpriteInput): number {
  return (nativeSceneKey(right) - nativeSceneKey(left)) | 0;
}

export function nativeSceneCutoff(height: number, baselineY: number, attributes: number, foregroundIndex: number): number {
  integer(height, 0, 65535, "SPR height must be a word");
  integer(baselineY, -32768, 32767, "Queue Y must be a signed word");
  integer(attributes, 0, 65535, "MAP attributes must be a word");
  integer(foregroundIndex, 0, 2047, "Resolved foreground index must be 11 bits");
  return signedWord(height + 31 - (Math.max(0, baselineY) & 31) - 32 * (foregroundIndex ? attributes & 15 : 0));
}

function sceneTerrainCells(terrain: readonly SceneTerrainCommand[]): Map<string, SceneTerrainCommand> {
  const cells = new Map<string, SceneTerrainCommand>();
  for (const cell of terrain) {
    integer(cell.column, 0, 255, "MAP column out of range");
    integer(cell.row, 0, 255, "MAP row out of range");
    integer(cell.attributes, 0, 65535, "MAP attributes must be a word");
    integer(cell.backgroundIndex, 0, 2047, "Resolved background index must be 11 bits");
    integer(cell.foregroundIndex, 0, 2047, "Resolved foreground index must be 11 bits");
    if (cell.foregroundMask) {
      if (cell.foregroundMask.length !== 32) throw new RangeError("Foreground coverage needs 32 source-order rows");
      for (let row = 0; row < 32; row += 1) integer(cell.foregroundMask[row], 0, 0xffffffff, "Coverage rows must be uint32");
    }
    const key = `${cell.column},${cell.row}`;
    if (cells.has(key)) throw new RangeError("Duplicate MAP cell");
    cells.set(key, cell);
  }
  return cells;
}

export function composeSceneBodyMasks<Source extends SceneBodyInput>(input: {
  readonly terrain: readonly SceneTerrainCommand[];
  readonly sprites: readonly Source[];
}): readonly SceneSpriteCommand<Source>[] {
  const cells = sceneTerrainCells(input.terrain);
  return input.sprites.map((source) => composeSceneBodyMask(source, cells));
}

export function composeSceneFrame(input: {
  readonly terrain: readonly SceneTerrainCommand[];
  readonly sprites: readonly SceneSpriteInput[];
}): SceneDrawPlan {
  if (input.sprites.length > 800) throw new RangeError("Native scene queue limit is 800 children");
  const cells = sceneTerrainCells(input.terrain);
  const diagnostics: string[] = [];
  const keys = new Set<number>();
  const ids = new Set<string>();
  for (const sprite of input.sprites) {
    integer(sprite.position.x, -32768, 32767, "Queue X must be a signed word");
    integer(sprite.position.y, -32768, 32767, "Queue Y must be a signed word");
    integer(sprite.position.heightOffset, -32768, 32767, "Queue height must be a signed word");
    integer(sprite.submissionWord, -2147483648, 0xffffffff, "Submission word must fit a dword");
    integer(sprite.part.child.layer, 0, 65535, "FIN layer must be a word");
    if (ids.has(sprite.id)) throw new RangeError("Duplicate scene sprite ID");
    ids.add(sprite.id);
    const key = nativeSceneKey(sprite);
    if (keys.has(key)) diagnostics.push("native-equal-key-sort-stability-unverified");
    keys.add(key);
  }
  const keyValues = [...keys];
  if (keyValues.length && Math.max(...keyValues) - Math.min(...keyValues) >= 0x80000000) {
    throw new RangeError("Native comparator overflow ordering outside verified subset");
  }
  const sprites = [...input.sprites].sort(compareNativeSceneSprites).map((source) => composeSceneBodyMask(source, cells));
  return { commands: [...input.terrain, ...sprites], diagnostics: [...new Set(diagnostics)],
    verifiedSubset: diagnostics.length === 0 && sprites.every((sprite) => sprite.diagnostics.length === 0) };
}

function composeSceneBodyMask<Source extends SceneBodyInput>(
  source: Source, cells: ReadonlyMap<string, SceneTerrainCommand>,
): SceneSpriteCommand<Source> {
    const { part, position } = source;
    const frame = part.frame;
    const child = part.child;
    const issues = [...part.diagnostics];
    if (!frame) issues.push("missing-atlas-frame");
    if (child.flags !== 16 || child.valueA !== 0 || (child.valueB !== 0 && child.valueB !== 1)
      || part.mirrored !== (child.valueB === 1)) issues.push("scene-mode-unverified");
    if (position.heightOffset !== 0) issues.push("scene-elevation-unverified");
    if ((child.layer & 255) > 2) issues.push("scene-layer-unverified");
    const topLeft = { x: position.x + (part.mirrored ? 1 : frame?.anchorX ?? 0),
      y: position.y + position.heightOffset - (frame?.height ?? 0) };
    const compositionOrigin = { x: position.x - child.x, y: position.y + position.heightOffset - child.y };
    if (frame && (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || !Number.isInteger(frame.anchorX)
      || frame.anchorX < 0 || frame.anchorX > 65535 || frame.width < 1 || frame.width > 352
      || frame.height < 1 || frame.height > 240 || frame.empty)) {
      issues.push("scene-frame-bounds-unverified");
    }
    if (frame && (!Number.isInteger(child.x) || !Number.isInteger(child.y)
      || part.x !== child.x + (part.mirrored ? 1 : frame.anchorX) || part.y !== child.y - frame.height)) {
      issues.push("scene-part-placement-inconsistent");
    }
    if (topLeft.x < 0 || topLeft.y < 0 || position.y < 0) issues.push("scene-edge-clipping-unverified");
    const clips: SceneClipSpan[] = [];
    if (!issues.length && frame) {
      const cutoffByColumn = new Map<number, number>();
      for (let column = Math.floor(topLeft.x / 32); column <= Math.floor((topLeft.x + frame.width - 1) / 32); column += 1) {
        const cell = cells.get(`${column},${Math.floor(position.y / 32)}`);
        if (!cell) issues.push("scene-missing-baseline-cell");
        else cutoffByColumn.set(column, nativeSceneCutoff(frame.height, position.y, cell.attributes, cell.foregroundIndex));
      }
      if (!issues.length) {
        for (let row = 0; row < frame.height; row += 1) {
          let start = -1;
          for (let column = 0; column <= frame.width; column += 1) {
            let visible = column < frame.width;
            if (visible && (child.layer & 255) !== 2) {
              const worldX = topLeft.x + column;
              const worldY = topLeft.y + row;
              if (row > cutoffByColumn.get(Math.floor(worldX / 32))!) {
                const cell = cells.get(`${Math.floor(worldX / 32)},${Math.floor(worldY / 32)}`);
                if (!cell || (cell.foregroundIndex && !cell.foregroundMask)) {
                  issues.push("scene-missing-foreground-coverage");
                } else if (cell.foregroundIndex) {
                  const bit = cell.attributes & 0x40 ? worldX & 31 : 31 - (worldX & 31);
                  visible = ((cell.foregroundMask![worldY & 31] >>> bit) & 1) === 0;
                }
              }
            }
            if (visible && start === -1) start = column;
            if (!visible && start !== -1) {
              clips.push({ x: start, y: row, width: column - start, height: 1 });
              start = -1;
            }
          }
        }
      }
    }
    return { kind: "sprite", source, topLeft, compositionOrigin, clips: issues.length ? null : clips,
      diagnostics: [...new Set(issues)] };
}