export type SelectionCommand =
  | { readonly type: "select"; readonly entityIds: readonly number[] }
  | { readonly type: "move"; readonly x: number; readonly y: number }
  | { readonly type: "attack"; readonly targetId: number }
  | { readonly type: "stop" };

export interface CommandSink {
  dispatch(command: SelectionCommand): void;
}

export * from "./control-groups";
export * from "./hud-geometry";
export * from "./radar";
