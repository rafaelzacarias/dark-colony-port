import type { SimulationSnapshot } from "../engine";

export * from "./fin-animation";
export * from "./fin-composition";
export * from "./atlas-cache";

export interface RenderFrame {
  readonly interpolation: number;
  readonly snapshot: SimulationSnapshot;
}

export interface Renderer {
  render(frame: RenderFrame): void;
  destroy(): void;
}
