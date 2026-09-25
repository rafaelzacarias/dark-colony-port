import type { FinPoint, FinSample } from "./fin-animation";
import { drawFinComposition, type FinCompositionPart } from "./fin-composition";
import { drawMirroredPaletteBody, drawNativeMode1CanvasShadow } from "./mode1-canvas";
import { drawNativeMode2Canvas } from "./mode2-canvas";
import { drawNativeMode5Canvas } from "./mode5-canvas";
import { MODE5_PIXEL_BUDGET } from "./mode5-effect";
import { composeNativeMode3, stageNativeMode3Filters, validateNativeMode3Surface } from "./mode3-effect";
import type { NativeIndexedSprite, NativeIndexedSurface } from "./mode1-shadow";
import type { MissionIndexedTerrain, MissionTerrainInput, MissionMode3Terrain } from "./mission-terrain";
import { composeSceneBodyMasks, nativeOrdinarySceneSubmissionWord, nativeScenePosition,
  type SceneBodyInput, type SceneClipSpan, type SceneSpriteCommand, type SceneTerrainCommand } from "./scene-composition";

export interface MissionSceneCamera extends FinPoint {
  readonly width: number;
  readonly height: number;
}

export interface MissionOrdinaryPrimaryQueue {
  readonly admitted: boolean;
  readonly acceptedBeforePrimary: number;
  readonly effectsEnabled: boolean;
}

export interface MissionOrdinaryAdmission {
  readonly rawSlot: number;
  readonly status: number;
  readonly type: number;
  readonly team: number;
  readonly localTeam: number;
  readonly spyEnabled: boolean;
  readonly tileVisibilityWord: number;
  readonly localVisibilityMask: number;
  readonly concealedType: boolean;
  readonly detectedTeams: number;
  readonly revealAll: boolean;
  readonly xQ8: number;
  readonly yQ8: number;
  readonly bounds: { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };
  readonly bankMode: 0 | 1 | 2;
  readonly bankFrame: number;
  readonly bankTimelineCount: number;
}

export function missionOrdinarySceneAdmission(input: MissionOrdinaryAdmission) {
  integer(input.rawSlot, 120, 799, "Ordinary admission excludes low-slot city paths");
  for (const value of [input.spyEnabled, input.concealedType, input.revealAll]) {
    if (typeof value !== "boolean") throw new RangeError("Explicit native admission flags required");
  }
  for (const value of [input.status, input.type, input.team, input.detectedTeams, input.bankFrame]) {
    integer(value, 0, 255, "Native admission byte out of range");
  }
  integer(input.localTeam, 0, 7, "Native viewer team out of range");
  integer(input.bankMode, 0, 2, "Native animation mode out of range");
  integer(input.bankTimelineCount, 1, 256, "Native loaded bank timeline count required");
  for (const value of [input.xQ8, input.yQ8]) integer(value, 0, 65535, "Native entity Q8 word required");
  for (const value of [input.tileVisibilityWord, input.localVisibilityMask]) integer(value, 0, 0xffffffff, "Native visibility dword required");
  for (const value of Object.values(input.bounds)) integer(value, -32768, 32767, "Native admission bounds required");
  let bankFrame = input.bankFrame;
  let bankMode = input.bankMode;
  const rejected = () => ({ admitted: false, bankFrame, bankMode });
  if (!input.status || (input.type === 37 && !input.spyEnabled)) return rejected();
  const visible = (input.tileVisibilityWord & input.localVisibilityMask) !== 0;
  const detected = !input.concealedType || input.team === input.localTeam || (input.detectedTeams & (1 << input.localTeam)) !== 0;
  if (!(visible && detected) && !input.revealAll) return rejected();
  const tileX = input.xQ8 >> 8, tileY = input.yQ8 >> 8;
  if (tileX < input.bounds.left || tileX >= input.bounds.right || tileY < input.bounds.bottom || tileY >= input.bounds.top) return rejected();
  if (bankMode === 2) return rejected();
  if (bankFrame >= input.bankTimelineCount) {
    bankFrame = 0;
    if (bankMode === 1) {
      bankMode = 2;
      return rejected();
    }
  }
  return { admitted: true, bankFrame, bankMode };
}

export interface MissionSceneEntity {
  readonly rawSlot: number;
  readonly xSubcells: number;
  readonly ySubcells: number;
  readonly heightSubcells: number;
  readonly sample: FinSample;
  readonly parts: readonly FinCompositionPart[];
  readonly fallbackOrigin: FinPoint;
  readonly ordinaryPrimary?: MissionOrdinaryPrimaryQueue;
}

export interface MissionSceneBody extends SceneBodyInput {
  readonly entity: MissionSceneEntity;
  readonly sourceChildIndex: number;
}

export interface MissionSceneSubmission {
  readonly rawSlot: number;
  readonly sourceChildIndex: number;
  readonly submissionWord: number;
}

export interface MissionMode3Prepass {
  readonly surface: NativeIndexedSurface;
  readonly enabled: boolean;
  readonly queue: readonly { readonly rawSlot: number; readonly sourceChildIndex: number }[];
  readonly sprite: (body: MissionSceneBody) => NativeIndexedSprite | undefined;
}

export function stageMissionMode3Prepass(input: MissionMode3Prepass & {
  readonly entities: readonly MissionSceneEntity[];
  readonly bodies: readonly MissionSceneBody[];
  readonly terrain: readonly SceneTerrainCommand[];
}) {
  try {
    validateNativeMode3Surface(input.surface);
    if (typeof input.enabled !== "boolean") throw new RangeError("Explicit illumination gate required");
    const bodies = new Map(input.bodies.map(body => [`${body.entity.rawSlot}:${body.sourceChildIndex}`, body]));
    if (bodies.size !== input.bodies.length || input.queue.length !== bodies.size || bodies.size > 800) {
      throw new RangeError("Complete captured queue required");
    }
    const capturedSlots = new Set<number>();
    let capturedChildren = 0;
    for (const entity of input.entities) {
      if (capturedSlots.has(entity.rawSlot) || entity.parts.length !== entity.sample.children.length) {
        throw new RangeError("Complete captured queue required");
      }
      capturedSlots.add(entity.rawSlot);
      capturedChildren += entity.sample.children.length;
      const childIndices = new Set<number>();
      for (const part of entity.parts) {
        const sourceChildIndex = entity.sample.children.indexOf(part.child);
        const body = bodies.get(`${entity.rawSlot}:${sourceChildIndex}`);
        const frame = part.frame;
        if (sourceChildIndex === -1 || childIndices.has(sourceChildIndex) || body?.entity !== entity || body.part !== part
          || !frame || frame.empty || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)
          || frame.width <= 0 || frame.width >= 512 || frame.height <= 0 || frame.height >= 512) {
          throw new RangeError("Complete captured queue required");
        }
        childIndices.add(sourceChildIndex);
      }
    }
    if (capturedChildren !== bodies.size) throw new RangeError("Complete captured queue required");
    const owned = new Set<string>();
    const seen = new Set<string>();
    let indices: Uint8Array = Uint8Array.from(input.surface.indices);
    for (const entry of input.queue) {
      const key = `${entry.rawSlot}:${entry.sourceChildIndex}`;
      const body = bodies.get(key);
      if (!body || seen.has(key)) throw new RangeError("Unknown or duplicate queue child");
      seen.add(key);
      if (body.part.child.valueA !== 3) continue;
      const sprite = input.sprite(body);
      if (!sprite) throw new RangeError("Indexed mode3 source required");
      const plan = composeNativeMode3({ part: body.part, position: body.position, sprite, terrain: input.terrain });
      indices = stageNativeMode3Filters({ ...input.surface, indices }, plan, input.enabled);
      owned.add(key);
    }
    return { exact: true, illumination: { ...input.surface, indices }, owned } as const;
  } catch (error) {
    return { exact: false, diagnostic: `mode3-prepass-unverified:${error instanceof Error ? error.message : String(error)}` } as const;
  }
}

function integer(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(label);
}

export function missionSceneQ8(subcells: number): number {
  integer(subcells, 0, 65535 * 4 + 1, "Scene position must be an unsigned Q10 coordinate convertible to Q8");
  return Math.round(subcells / 4);
}

export function missionSceneCamera(cameraX: number, cameraY: number, mapHeight: number,
  width = 512, height = 452): MissionSceneCamera {
  if (![cameraX, cameraY].every(Number.isFinite)) throw new RangeError("Scene camera must be finite");
  return { x: -Math.round(width / 2 - cameraX * 32),
    y: mapHeight * 32 - Math.round(height / 2 + cameraY * 32), width, height };
}

function clippedCommand(command: SceneSpriteCommand<MissionSceneBody>, camera: MissionSceneCamera): SceneSpriteCommand<MissionSceneBody> {
  const topLeft = { x: command.topLeft.x - camera.x, y: command.topLeft.y - camera.y };
  const clips: SceneClipSpan[] | null = command.clips === null ? null : [];
  for (const span of command.clips ?? []) {
    const left = Math.max(span.x, -topLeft.x);
    const top = Math.max(span.y, -topLeft.y);
    const right = Math.min(span.x + span.width, camera.width - topLeft.x);
    const bottom = Math.min(span.y + span.height, camera.height - topLeft.y);
    if (right > left && bottom > top) clips!.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return { ...command, topLeft, clips,
    compositionOrigin: { x: command.compositionOrigin.x - camera.x, y: command.compositionOrigin.y - camera.y } };
}

export function createMissionSceneFrame(input: {
  readonly mission: Pick<MissionTerrainInput, "tileRecordIndices" | "attributes"> & {
    readonly map: Pick<MissionTerrainInput["map"], "width" | "height">;
  };
  readonly indexed: MissionIndexedTerrain | undefined;
  readonly camera: MissionSceneCamera;
  readonly entities: readonly MissionSceneEntity[];
}) {
  const { mission, camera } = input;
  integer(mission.map.width, 1, 256, "Scene MAP width out of range");
  integer(mission.map.height, 1, 256, "Scene MAP height out of range");
  for (const coordinate of [camera.x, camera.y]) integer(coordinate, 0, 8192, "Scene camera must use nonnegative integer map pixels");
  for (const size of [camera.width, camera.height]) integer(size, 1, 8192, "Scene viewport size must use integer pixels");
  const count = mission.map.width * mission.map.height;
  if (mission.tileRecordIndices.length !== count * 2 || mission.attributes.length !== count) {
    throw new RangeError("Scene MAP layer lengths do not match");
  }
  const diagnostics = new Set<string>(["native-global-order-unverified:city-auxiliary-map-object-effect-admission"]);
  const slots = new Set<number>();
  const bodies: MissionSceneBody[] = [];
  const submissions: MissionSceneSubmission[] = [];
  for (const entity of input.entities) {
    integer(entity.rawSlot, 0, 799, "Actual native raw slot required in 0..799");
    if (slots.has(entity.rawSlot)) throw new RangeError("Duplicate native raw slot");
    slots.add(entity.rawSlot);
    const xQ8 = missionSceneQ8(entity.xSubcells);
    const yQ8 = missionSceneQ8(entity.ySubcells);
    const heightQ8 = missionSceneQ8(entity.heightSubcells);
    if (![entity.fallbackOrigin.x, entity.fallbackOrigin.y].every(Number.isFinite)) throw new RangeError("Finite fallback origin required");
    const childParts = new Map<number, FinCompositionPart>();
    for (const part of entity.parts) {
      const sourceChildIndex = entity.sample.children.indexOf(part.child);
      if (sourceChildIndex === -1 || childParts.has(sourceChildIndex)) throw new RangeError("Parts must retain unique original FIN child references");
      childParts.set(sourceChildIndex, part);
      for (const offset of [part.child.x, part.child.y]) integer(offset, -32768, 32767, "FIN disk offsets must be signed words");
      const loadedX = (part.child.x * 8 << 16) >> 16;
      const loadedY = (-part.child.y * 8 << 16) >> 16;
      bodies.push({ entity, part, sourceChildIndex,
        position: nativeScenePosition(xQ8 + loadedX, yQ8 + loadedY, heightQ8, mission.map.height * 256) });
    }
    const queue = entity.ordinaryPrimary;
    if (!queue || entity.rawSlot < 120) {
      diagnostics.add(`slot:${entity.rawSlot}:native-primary-admission-and-capacity-required`);
      continue;
    }
    integer(queue.acceptedBeforePrimary, 0, 800, "Native accepted count must be in 0..800");
    if (typeof queue.admitted !== "boolean" || typeof queue.effectsEnabled !== "boolean") {
      throw new RangeError("Explicit native primary admission and effect gate required");
    }
    if (!queue.admitted) continue;
    let accepted = 0;
    const pending: MissionSceneSubmission[] = [];
    let complete = true;
    for (const [sourceChildIndex, child] of entity.sample.children.entries()) {
      if (child.valueA === undefined || !Number.isInteger(child.valueA) || child.valueA < 0 || child.valueA > 65535) { complete = false; break; }
      if (!queue.effectsEnabled && (child.valueA << 16 >> 16) >= 3) continue;
      if (queue.acceptedBeforePrimary + accepted === 800) break;
      const frame = childParts.get(sourceChildIndex)?.frame;
      if (!frame || frame.empty || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)
        || frame.width <= 0 || frame.width >= 512 || frame.height <= 0 || frame.height >= 512) {
        complete = false;
        break;
      }
      pending.push({ rawSlot: entity.rawSlot, sourceChildIndex,
        submissionWord: nativeOrdinarySceneSubmissionWord(yQ8, accepted++) });
    }
    if (complete) submissions.push(...pending);
    else diagnostics.add(`slot:${entity.rawSlot}:native-primary-source-headers-incomplete`);
  }
  const requiredCells = new Set<number>();
  for (const { part, position } of bodies) {
    const frame = part.frame;
    if (!frame || frame.width < 1 || frame.width > 352 || frame.height < 1 || frame.height > 240) continue;
    const bodyLeft = position.x + (part.mirrored ? 1 : frame.anchorX);
    const projectedShadow = part.child.valueA === 1 || part.child.valueA === 2;
    const shadowHeight = projectedShadow ? frame.height + Math.floor(frame.height * 40 / 256) : frame.height;
    const left = bodyLeft - (projectedShadow ? Math.floor(shadowHeight / 2) + 1 : 0);
    const firstColumn = Math.max(0, Math.floor(left / 32));
    const lastColumn = Math.min(mission.map.width - 1, Math.floor((bodyLeft + frame.width - 1) / 32));
    const firstRow = Math.max(0, Math.floor((position.y + position.heightOffset - shadowHeight) / 32));
    const lastRow = Math.min(mission.map.height - 1, Math.floor(position.y / 32));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) requiredCells.add(row * mission.map.width + column);
    }
  }
  const terrain: SceneTerrainCommand[] = [...requiredCells].map((index) => {
    const foregroundIndex = mission.tileRecordIndices[index * 2 + 1];
    return { kind: "terrain", column: index % mission.map.width, row: Math.floor(index / mission.map.width),
      backgroundIndex: mission.tileRecordIndices[index * 2], foregroundIndex, attributes: mission.attributes[index],
      foregroundMask: input.indexed?.sourceForegroundCoverage?.[foregroundIndex] };
  });
  const commands = composeSceneBodyMasks({ terrain, sprites: bodies }).map((command) => ({
    ...clippedCommand(command, camera), diagnostics: [...command.diagnostics],
  }));
  const bySlot = new Map<number, typeof commands>();
  for (const command of commands) {
    const rawSlot = command.source.entity.rawSlot;
    const list = bySlot.get(rawSlot) ?? [];
    list.push(command);
    bySlot.set(rawSlot, list);
    for (const diagnostic of command.diagnostics) diagnostics.add(`slot:${rawSlot}:${diagnostic}`);
  }
  submissions.sort((left, right) => left.rawSlot - right.rawSlot || left.sourceChildIndex - right.sourceChildIndex);
  const mode1Results = new Map<string, { readonly exact: boolean; readonly diagnostic?: string; readonly readbackPixels?: number }>();
  const mode2Results = new Map<string, ReturnType<typeof drawNativeMode2Canvas>>();
  const mode5Results = new Map<string, ReturnType<typeof drawNativeMode5Canvas>>();
  let effectReadbackPixels = 0;
  let mode3AllocatedPixels = 0;
  let bodiesStarted = false;
  let mode3Owned = new Set<string>();
  return {
    commands, submissions, get diagnostics() { return [...diagnostics]; }, globalOrder: null, mode1Results, mode2Results, mode5Results,
    get effectBudget() { return { mode3AllocatedPixels, readbackPixels: effectReadbackPixels,
      remainingPixels: MODE5_PIXEL_BUDGET - mode3AllocatedPixels - effectReadbackPixels }; },
    orderingVerified: false as const,
    drawMode3Terrain(context: CanvasRenderingContext2D, owner: MissionMode3Terrain, prepass: MissionMode3Prepass) {
      const reject = (message: string) => ({ exact: false as const, diagnostic: `mode3-prepass-unverified:${message}` });
      if (bodiesStarted || mode3AllocatedPixels) return reject("Pre-terrain phase already closed");
      if (owner.mission !== mission || owner.indexed !== input.indexed) return reject("Terrain source owner differs from scene");
      if (["x", "y", "width", "height"].some(key => camera[key as keyof MissionSceneCamera] !==
        prepass.surface[key as keyof MissionSceneCamera])) return reject("Exact unrounded camera required");
      const transform = context.getTransform?.();
      if (!transform || transform.a !== 1 || transform.b !== 0 || transform.c !== 0 || transform.d !== 1
        || transform.e !== 0 || transform.f !== 0 || context.globalAlpha !== 1 || context.globalCompositeOperation !== "source-over"
        || context.filter !== "none" || context.shadowBlur !== 0 || context.shadowOffsetX !== 0 || context.shadowOffsetY !== 0
        || context.canvas.width < camera.width || context.canvas.height < camera.height) return reject("Canvas state unverified");
      const result = stageMissionMode3Prepass({ ...prepass, entities: input.entities, bodies, terrain });
      if (!result.exact) return result;
      try {
        const output = owner.renderIllumination(result.illumination);
        const image = context.createImageData(camera.width, camera.height);
        image.data.set(output.rgba);
        context.putImageData(image, 0, 0);
        mode3Owned = result.owned;
        mode3AllocatedPixels = camera.width * camera.height;
        for (const command of commands) {
          const key = `${command.source.entity.rawSlot}:${command.source.sourceChildIndex}`;
          if (!mode3Owned.has(key)) continue;
          command.diagnostics = command.diagnostics.filter(issue => issue !== "native-draw-mode:3" && issue !== "scene-mode-unverified");
        }
        for (const diagnostic of diagnostics) {
          if (diagnostic.endsWith(":native-draw-mode:3")) diagnostics.delete(diagnostic);
        }
        return { ...result, output };
      } catch (error) { return reject(error instanceof Error ? error.message : String(error)); }
    },
    drawEntity(context: CanvasRenderingContext2D, rawSlot: number,
      imageLookup: (sprite: string, part: FinCompositionPart) => CanvasImageSource | undefined,
      drawEffect?: (part: FinCompositionPart, origin: FinPoint, scale: number) => boolean): void {
      if (!slots.has(rawSlot)) throw new RangeError("Entity was not captured in this scene frame");
      bodiesStarted = true;
      for (const command of bySlot.get(rawSlot) ?? []) {
        const { part, entity } = command.source;
        if (part.child.valueA === 3 && mode3Owned.has(`${rawSlot}:${command.source.sourceChildIndex}`)) continue;
        if (part.child.valueA === 2) {
          const result = drawNativeMode2Canvas({ context, image: imageLookup(part.child.sprite, part), mission,
            part, position: command.source.position, terrain, camera, pixelBudget: MODE5_PIXEL_BUDGET - mode3AllocatedPixels - effectReadbackPixels });
          effectReadbackPixels += result.readbackPixels;
          mode2Results.set(`${rawSlot}:${command.source.sourceChildIndex}`, result);
          command.diagnostics = command.diagnostics.filter(issue => !issue.startsWith("mode2-shadow-")
            && issue !== "native-draw-mode:2" && issue !== "scene-mode-unverified");
          if (result.exact) continue;
          command.diagnostics.push("native-draw-mode:2", "scene-mode-unverified", result.diagnostic);
        }
        if (part.child.valueA === 5) {
          const result = drawNativeMode5Canvas({ context, image: imageLookup(part.child.sprite, part), mission,
            part, position: command.source.position, terrain, camera, pixelBudget: MODE5_PIXEL_BUDGET - mode3AllocatedPixels - effectReadbackPixels });
          effectReadbackPixels += result.readbackPixels;
          mode5Results.set(`${rawSlot}:${command.source.sourceChildIndex}`, result);
          command.diagnostics = command.diagnostics.filter(issue => !issue.startsWith("mode5-effect-")
            && issue !== "native-draw-mode:5" && issue !== "scene-mode-unverified");
          if (result.exact) continue;
          command.diagnostics.push("native-draw-mode:5", "scene-mode-unverified", result.diagnostic);
          if (drawEffect?.(part, entity.fallbackOrigin, 1)) continue;
        }
        if (part.child.valueA === 1 && mode3AllocatedPixels) {
          const diagnostic = "mode1-shadow-shared-budget-unverified";
          mode1Results.set(`${rawSlot}:${command.source.sourceChildIndex}`, { exact: false, diagnostic, readbackPixels: 0 });
          command.diagnostics.push(diagnostic);
        }
        if (part.child.valueA === 1 && !mode3AllocatedPixels) {
          const image = imageLookup(part.child.sprite, part);
          const result = image ? drawNativeMode1CanvasShadow({ context, image, part,
            position: command.source.position, terrain, camera }) : { diagnostic: "mode1-shadow-indexed-image-required" };
          const key = `${rawSlot}:${command.source.sourceChildIndex}`;
          if ("plan" in result && result.plan) {
            const body = clippedCommand({ ...result.plan.body, source: command.source }, camera);
            mode1Results.set(key, { exact: true, readbackPixels: result.readbackPixels });
            if (drawMirroredPaletteBody({ context, image, part, body })) continue;
            context.save();
            try {
              context.beginPath();
              for (const span of body.clips!) context.rect(body.topLeft.x + span.x, body.topLeft.y + span.y, span.width, span.height);
              context.clip();
              drawFinComposition(context, [part], () => image, body.compositionOrigin, 1);
            } finally { context.restore(); }
            continue;
          }
          mode1Results.set(key, { exact: false, diagnostic: result.diagnostic });
        }
        if (command.clips === null) {
          if (part.frame && drawMirroredPaletteBody({ context, image: imageLookup(part.child.sprite, part), part,
            body: { topLeft: { x: Math.round(entity.fallbackOrigin.x + part.x), y: Math.round(entity.fallbackOrigin.y + part.y) },
              clips: [{ x: 0, y: 0, width: part.frame.width, height: part.frame.height }] } })) continue;
          drawFinComposition(context, [part], imageLookup, entity.fallbackOrigin, 1);
          continue;
        }
        if (!command.clips.length) continue;
        if (drawMirroredPaletteBody({ context, image: imageLookup(part.child.sprite, part), part, body: command })) continue;
        context.save();
        try {
          context.beginPath();
          for (const span of command.clips) context.rect(command.topLeft.x + span.x, command.topLeft.y + span.y, span.width, span.height);
          context.clip();
          drawFinComposition(context, [part], imageLookup, command.compositionOrigin, 1);
        } finally {
          context.restore();
        }
      }
    },
  };
}