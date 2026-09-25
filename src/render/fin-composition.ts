import { finSourceDuration, type FinAnimationData, type FinAtlasFrame, type FinChildData,
  type FinPoint, type FinSample, type FinSelection } from "./fin-animation";

export function finSourcePlacement(child: FinChildData, frame: FinAtlasFrame): FinPoint {
  return { x: child.x + (child.valueB ? 1 : frame.anchorX), y: child.y - frame.height };
}

export function finSourceLayerPriority(layer: number): number {
  const byte = layer & 255;
  return byte & 1 ? ((byte >> 1) + 1) * 3000 : -(byte >> 1) * 3000;
}

export interface FinCompositionPart extends FinPoint {
  readonly child: FinChildData;
  readonly frame: FinAtlasFrame | undefined;
  readonly mirrored: boolean;
  readonly diagnostics: readonly string[];
}

export interface FinBodyBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function finBodyBounds(parts: readonly FinCompositionPart[], origin: FinPoint, scale = 1): FinBodyBounds | undefined {
  const body = parts.filter(part => part.frame && !part.frame.empty && part.frame.width > 0 && part.frame.height > 0
    && (part.child.valueA === 0 || part.child.valueA === 1));
  if (!body.length) return undefined;
  return {
    left: origin.x + Math.min(...body.map(part => part.x)) * scale,
    top: origin.y + Math.min(...body.map(part => part.y)) * scale,
    right: origin.x + Math.max(...body.map(part => part.x + part.frame!.width)) * scale,
    bottom: origin.y + Math.max(...body.map(part => part.y + part.frame!.height)) * scale,
  };
}

export function composeFinSample(
  sample: FinSample,
  lookup: (sprite: string, frame: number) => FinAtlasFrame | undefined,
): readonly FinCompositionPart[] {
  return [...sample.children]
    .sort((left, right) => finSourceLayerPriority(right.layer) - finSourceLayerPriority(left.layer))
    .flatMap((child): FinCompositionPart[] => {
      const frame = lookup(child.sprite, child.frame);
      if (frame?.empty || frame?.width === 0 || frame?.height === 0) return [];
      const diagnostics: string[] = [];
      if (!frame) diagnostics.push("missing-atlas-frame");
      if (child.flags !== 16) diagnostics.push(`unverified-flags:${child.flags}`);
      if (child.valueA === 1) diagnostics.push("native-shadow-pass-unimplemented");
      else if (child.valueA !== 0) diagnostics.push(`native-draw-mode:${child.valueA}`);
      if (child.valueB !== 0 && child.valueB !== 1) diagnostics.push(`unverified-mirror-value:${child.valueB}`);
      return [{ child, frame, mirrored: Boolean(child.valueB), diagnostics,
        ...(frame ? finSourcePlacement(child, frame) : { x: child.x, y: child.y }) }];
    });
}

export function createFinSourceSampler(animation: FinAnimationData) {
  const ranges = new Map<FinSelection["state"], { ends: readonly number[]; total: number }>();
  return (selection: FinSelection, elapsedUpdates: number): FinSample => {
    if (!Number.isFinite(elapsedUpdates)) throw new RangeError("FIN elapsed updates must be finite");
    const { state } = selection;
    let range = ranges.get(state);
    if (!range) {
      let total = 0;
      const ends: number[] = [];
      for (let index = state.firstTimelineIndex; index <= state.lastTimelineIndex; index += 1) {
        const field2 = animation.timeline[index]?.field2;
        if (field2 === undefined) throw new RangeError(`Missing source FIN duration at ${index}`);
        const duration = finSourceDuration(field2);
        if (duration === 0) throw new RangeError(`Unsupported zero FIN countdown at ${index}`);
        ends.push(total += duration);
      }
      range = { ends, total };
      ranges.set(state, range);
    }
    const updates = Math.floor(Math.max(0, elapsedUpdates));
    const finished = selection.action === "Die" && updates >= range.total;
    const phase = finished ? range.total - 1 : updates % range.total;
    const offset = range.ends.findIndex((end) => phase < end);
    const timelineIndex = state.firstTimelineIndex + offset;
    return { timelineIndex, finished, children: animation.timeline[timelineIndex].children };
  };
}

export function drawFinComposition(
  context: CanvasRenderingContext2D,
  parts: readonly FinCompositionPart[],
  imageLookup: (sprite: string, part: FinCompositionPart) => CanvasImageSource | undefined,
  origin: FinPoint,
  scale: number,
  drawEffect?: (part: FinCompositionPart, origin: FinPoint, scale: number) => boolean,
): void {
  for (const part of parts) {
    if (part.child.valueA === 5 && drawEffect?.(part, origin, scale)) continue;
    const image = imageLookup(part.child.sprite, part);
    const frame = part.frame;
    context.save();
    context.translate(Math.round(origin.x + part.x * scale), Math.round(origin.y + part.y * scale));
    context.scale(scale, scale);
    if (image && frame) {
      if (part.mirrored) {
        context.translate(frame.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    }
    context.restore();
  }
}