import { assetUrl } from "../asset-url";
import { finSourceDuration, type FinAnimationData } from "../render/fin-animation";

export type MissionCursor = "default" | "select" | "move" | "attack" | "drag" | "blocked";

export const CURSOR_PRESENTATION_HZ = 20;
export const MISSION_CURSOR_FALLBACKS: Readonly<Record<MissionCursor, string>> = Object.freeze({
  default: "default", select: "pointer", move: "crosshair", attack: "crosshair", drag: "crosshair", blocked: "not-allowed",
});

const STATES: Readonly<Record<Exclude<MissionCursor, "blocked">, string>> = {
  default: "DEFAULT", select: "UNITSELECT", move: "MOVE", attack: "ATTACK", drag: "DRAWBOX",
};

interface CursorFrame { index: number; x: number; y: number; width: number; height: number; empty: boolean }
interface CursorAnimation {
  states: { name: string; firstTimelineIndex: number }[];
  timeline: { children: { sprite: string; frame: number }[] }[];
}

export function cursorFrameIds(animation: CursorAnimation): Readonly<Record<Exclude<MissionCursor, "blocked">, number>> {
  return Object.fromEntries(Object.entries(STATES).map(([kind, name]) => {
    const state = animation.states.find((state) => state.name === name);
    const child = state && animation.timeline[state.firstTimelineIndex]?.children.find((child) => child.sprite.toUpperCase() === "CURS");
    if (!child) throw new Error(`Missing original cursor state ${name}`);
    return [kind, child.frame];
  })) as Record<Exclude<MissionCursor, "blocked">, number>;
}

export interface MissionCursorFrame {
  readonly frame: number;
  readonly durationTicks: number;
  readonly endTick: number;
  readonly style: string;
}

export interface MissionCursorSequence {
  readonly frames: readonly MissionCursorFrame[];
  readonly durationTicks: number;
}

export interface MissionCursorAnimation {
  readonly states: Readonly<Record<Exclude<MissionCursor, "blocked">, MissionCursorSequence>>;
  readonly firstStyles: Readonly<Record<MissionCursor, string>>;
}

export function createMissionCursorAnimation(animation: FinAnimationData,
  frameUrl: (frame: number) => { readonly url: string; readonly width: number; readonly height: number }): MissionCursorAnimation {
  const images = new Map<number, ReturnType<typeof frameUrl>>();
  const firstStyles = { ...MISSION_CURSOR_FALLBACKS };
  const states = Object.fromEntries(Object.entries(STATES).map(([kind, name]) => {
    const state = animation.states.find(state => state.name === name);
    if (!state || state.validRange === false || !Number.isInteger(state.firstTimelineIndex)
      || !Number.isInteger(state.lastTimelineIndex) || state.firstTimelineIndex < 0
      || state.lastTimelineIndex < state.firstTimelineIndex || state.lastTimelineIndex >= animation.timeline.length) {
      throw new Error(`Missing original cursor state ${name}`);
    }
    let durationTicks = 0;
    const frames: MissionCursorFrame[] = [];
    for (let index = state.firstTimelineIndex; index <= state.lastTimelineIndex; index++) {
      const entry = animation.timeline[index];
      const child = entry.children.find(child => child.sprite.toUpperCase() === "CURS");
      if (!child || entry.field2 === undefined) throw new Error(`Missing original cursor timeline ${name}:${index}`);
      let image = images.get(child.frame);
      if (!image) {
        image = frameUrl(child.frame);
        images.set(child.frame, image);
      }
      const delay = finSourceDuration(entry.field2);
      durationTicks += delay;
      frames.push(Object.freeze({ frame: child.frame, durationTicks: delay, endTick: durationTicks,
        style: `url("${image.url}") ${Math.floor(image.width / 2)} ${Math.floor(image.height / 2)}, ${MISSION_CURSOR_FALLBACKS[kind as MissionCursor]}` }));
    }
    if (durationTicks === 0) throw new Error(`Empty original cursor duration ${name}`);
    firstStyles[kind as MissionCursor] = frames[0].style;
    return [kind, Object.freeze({ frames: Object.freeze(frames), durationTicks })];
  })) as Record<Exclude<MissionCursor, "blocked">, MissionCursorSequence>;
  return Object.freeze({ states: Object.freeze(states), firstStyles: Object.freeze(firstStyles) });
}

export function createMissionCursorController(animation: MissionCursorAnimation) {
  let previousState: MissionCursor | undefined;
  let stateStartedAt = 0;
  return {
    styleAt(state: MissionCursor, now: number): string {
      if (state !== previousState) {
        previousState = state;
        stateStartedAt = now;
      }
      if (state === "blocked") return MISSION_CURSOR_FALLBACKS.blocked;
      const sequence = animation.states[state];
      const tick = Math.floor(Math.max(0, now - stateStartedAt) / (1000 / CURSOR_PRESENTATION_HZ)) % sequence.durationTicks;
      for (let index = 0; index < sequence.frames.length; index++) {
        if (tick < sequence.frames[index].endTick) return sequence.frames[index].style;
      }
      return sequence.frames[0].style;
    },
  };
}

let loadedAnimation: Promise<MissionCursorAnimation> | undefined;

export function loadMissionCursorAnimation(): Promise<MissionCursorAnimation> {
  return loadedAnimation ??= loadCursorAnimation().catch(error => {
    loadedAnimation = undefined;
    throw error;
  });
}

export async function loadMissionCursorStyles(): Promise<Readonly<Record<MissionCursor, string>>> {
  return (await loadMissionCursorAnimation()).firstStyles;
}

async function loadCursorAnimation(): Promise<MissionCursorAnimation> {
  const root = assetUrl("/assets/generated");
  const json = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cursor ${response.status}: ${url}`);
    return response.json();
  };
  const [animation, metadata] = await Promise.all([
    json(`${root}/animations/CURS.json`) as Promise<FinAnimationData>,
    json(`${root}/sprites/SPRITES/CURS.json`) as Promise<{ frames: CursorFrame[] }>,
  ]);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Original cursor atlas unavailable"));
  });
  image.src = `${root}/sprites/SPRITES/CURS.png`;
  await loaded;
  return createMissionCursorAnimation(animation, index => {
    const frame = metadata.frames.find((frame) => frame.index === index);
    if (!frame || frame.empty) throw new Error(`Missing cursor frame ${index}`);
    const canvas = document.createElement("canvas");
    canvas.width = frame.width; canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cursor image needs Canvas2D");
    context.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    return { url: canvas.toDataURL(), width: frame.width, height: frame.height };
  });
}