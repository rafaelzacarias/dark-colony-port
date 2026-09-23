export interface RuntimeTriggerBlock {
  readonly id: number;
  readonly mode: string;
  readonly flag: number | null;
  readonly condition: string;
  readonly actions: readonly {
    readonly name: string;
    readonly arguments: readonly (number | string)[];
  }[];
}

export interface TriggerDiagnostic {
  readonly code: "invalid-input" | "unsupported-condition" | "unsupported-action" | "missing-input";
  readonly message: string;
  readonly triggerId?: number;
  readonly actionIndex?: number;
}

export type TriggerResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly diagnostics: readonly TriggerDiagnostic[] };

export interface TriggerBail {
  readonly resultCode: number;
  readonly reasonCode: number;
  readonly deadlineMilliseconds: number;
}

export interface TriggerRuntimeState {
  readonly lives: Readonly<Record<number, number>>;
  readonly statistics: Readonly<Record<string, number>>;
  readonly bail: TriggerBail | null;
}

export interface TriggerInputs {
  readonly cycleCounter: number;
  readonly clockMilliseconds: number;
  readonly buildingSlots: Readonly<Record<string, number>>;
  readonly runtimeProfile?: "browser-adapted";
  readonly triggeringUnitType?: number;
}

export type TriggerEvent =
  | { readonly kind: "normal" }
  | { readonly kind: "trip"; readonly triggerId: number; readonly team: number; readonly unitType?: number };

type Expression =
  | { kind: "literal"; value: number }
  | { kind: "native-omitted" }
  | { kind: "variable"; name: "c" | "S" | "t" }
  | { kind: "call"; name: "s" | "b"; args: Expression[] }
  | { kind: "binary"; operator: string; left: Expression; right: Expression };

class RuntimeFault extends Error {
  constructor(readonly code: TriggerDiagnostic["code"], message: string) {
    super(message);
  }
}

function fail(code: TriggerDiagnostic["code"], message: string): never {
  throw new RuntimeFault(code, message);
}

function diagnostic(error: unknown): TriggerDiagnostic {
  if (!(error instanceof RuntimeFault)) throw error;
  return { code: error.code, message: error.message };
}

function integer(value: number | undefined, minimum: number, maximum: number, label: string): number {
  if (value === undefined) fail("missing-input", `Missing ${label}`);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("invalid-input", `${label} must be an integer in ${minimum}..${maximum}`);
  }
  return value;
}

function signedWord(value: number): number {
  return (value << 16) >> 16;
}

export function recordTriggerVictimLoss(
  statistics: Readonly<Record<string, number>>,
  victimTeam: number,
  victimType: number,
): TriggerResult<Readonly<Record<string, number>>> {
  try {
    integer(victimTeam, 0, 7, "victim team");
    integer(victimType, 0, 109, "victim type");
    const updated = { ...statistics };
    for (const key of [`${victimTeam},3`, `${victimTeam},0,${victimType}`]) {
      const previous = Object.hasOwn(statistics, key) ? statistics[key] : undefined;
      updated[key] = (integer(previous, 0, 4294967295, `initialized statistic ${key}`) + 1) >>> 0;
    }
    return { ok: true, value: updated };
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(error)] };
  }
}

export function applyTriggerNewtype(
  entityBytes: Uint8Array,
  typeMovementClasses: Uint8Array,
  tileX: number,
  tileY: number,
  newType: number,
): TriggerResult<{ readonly entityBytes: Uint8Array; readonly changedSlot: number | null }> {
  try {
    if (entityBytes.length !== 800 * 220) fail("invalid-input", "newtype requires all 800 raw entity slots");
    if (typeMovementClasses.length !== 110) fail("invalid-input", "Expected 110 type-definition movement bytes");
    integer(tileX, 0, 255, "newtype tile X");
    integer(tileY, 0, 255, "newtype tile Y");
    integer(newType, 0, 109, "newtype target type (verified table range)");
    const updated = new Uint8Array(entityBytes);
    for (let slot = 0; slot < 800; slot += 1) {
      const offset = slot * 220;
      if (entityBytes[offset + 1] !== tileX || entityBytes[offset + 5] !== tileY) continue;
      const oldType = integer(entityBytes[offset + 6], 0, 109, "newtype source type (verified table range)");
      if (typeMovementClasses[oldType] !== 0) continue;
      updated[offset + 6] = newType;
      return { ok: true, value: { entityBytes: updated, changedSlot: slot } };
    }
    return { ok: true, value: { entityBytes: updated, changedSlot: null } };
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(error)] };
  }
}

export function tripForReservedMtgDestination(
  sourceTags: Uint8Array,
  width: number,
  height: number,
  runtimeX: number,
  runtimeY: number,
  team: number,
): TriggerResult<Extract<TriggerEvent, { kind: "trip" }> | null> {
  try {
    integer(width, 1, 255, "MTG width");
    integer(height, 1, 255, "MTG height");
    if (sourceTags.length !== width * height) fail("invalid-input", "MTG source plane size mismatch");
    integer(runtimeX, 0, width - 1, "reserved destination X");
    integer(runtimeY, 0, height - 1, "reserved destination Y");
    integer(team, 0, 7, "moving entity team");
    const triggerId = sourceTags[(height - 1 - runtimeY) * width + runtimeX] & 63;
    return { ok: true, value: triggerId === 0 ? null : { kind: "trip", triggerId, team } };
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(error)] };
  }
}

function parseCondition(source: string, adapted = false): Expression {
  if (source.length > 4096) fail("unsupported-condition", "Condition exceeds the supported size");
  const tokens: string[] = [];
  const tokenPattern = /\s*(\d+|[A-Za-z_]+|==|!=|&&|\|\||[(),<>+])/y;
  let offset = 0;
  while (offset < source.trimEnd().length) {
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(source);
    if (!match) fail("unsupported-condition", `Unsupported condition syntax at offset ${offset}`);
    tokens.push(match[1]);
    offset = tokenPattern.lastIndex;
  }
  let cursor = 0;
  function expect(token: string): void {
    if (tokens[cursor++] !== token) fail("unsupported-condition", `Expected '${token}'`);
  }
  function atom(depth: number): Expression {
    if (depth > 64) fail("unsupported-condition", "Condition nesting exceeds 64");
    const token = tokens[cursor++];
    if (token === "(") {
      const expression = logical(depth + 1);
      expect(")");
      return expression;
    }
    if (token === "c" || token === "S") return { kind: "variable", name: token };
    if (token === "t" && adapted) return { kind: "variable", name: token };
    if (token === "s" || token === "b") {
      expect("(");
      const args = [logical(depth + 1)];
      while (tokens[cursor] === ",") {
        cursor += 1;
        args.push(logical(depth + 1));
        if (args.length > 3) fail("unsupported-condition", `Too many arguments for ${token}`);
      }
      expect(")");
      if (args.length !== 2 && !(token === "s" && args.length === 3)) {
        fail("unsupported-condition", `Unsupported arity for ${token}`);
      }
      return { kind: "call", name: token, args };
    }
    if (token !== undefined && /^\d+$/.test(token) && Number(token) <= 65535) {
      return { kind: "literal", value: signedWord(Number(token)) };
    }
    return fail("unsupported-condition", `Unsupported operand '${token ?? "end of condition"}'`);
  }
  function addition(depth: number): Expression {
    let left = atom(depth);
    while (tokens[cursor] === "+") {
      cursor += 1;
      left = { kind: "binary", operator: "+", left, right: atom(depth) };
    }
    return left;
  }
  function comparison(depth: number): Expression {
    const left = addition(depth);
    const operator = tokens[cursor];
    if (operator !== undefined && ["==", "!=", "<", ">"].includes(operator)) {
      cursor += 1;
      return { kind: "binary", operator, left, right: addition(depth) };
    }
    return left;
  }
  function logical(depth: number): Expression {
    if (depth > 64) fail("unsupported-condition", "Condition nesting exceeds 64");
    const left = comparison(depth);
    const operator = tokens[cursor];
    if (operator === "&&" || operator === "||") {
      cursor += 1;
      if (adapted && operator === "&&" && tokens[cursor] === "==") {
        cursor += 1;
        return { kind: "binary", operator, left, right: { kind: "binary", operator: "==",
          left: { kind: "native-omitted" }, right: addition(depth + 1) } };
      }
      return { kind: "binary", operator, left, right: logical(depth + 1) };
    }
    return left;
  }
  const expression = logical(0);
  if (cursor !== tokens.length) fail("unsupported-condition", `Unexpected token '${tokens[cursor]}'`);
  return expression;
}

function readValue(table: Readonly<Record<string, number>>, key: string, label: string): number {
  const value = Object.hasOwn(table, key) ? table[key] : undefined;
  return signedWord(integer(value, -2147483648, 4294967295, `${label}(${key})`));
}

function evaluate(
  expression: Expression,
  statistics: Readonly<Record<string, number>>,
  inputs: TriggerInputs,
  team?: number,
): number {
  switch (expression.kind) {
    case "native-omitted": return fail("unsupported-condition", "Native omitted operand requires adapted stack evaluation");
    case "literal": return expression.value;
    case "variable":
      if (expression.name === "t") return integer(inputs.triggeringUnitType, 0, 109, "triggering unit type for t");
      return expression.name === "c"
        ? signedWord(integer(inputs.cycleCounter, -2147483648, 2147483647, "cycleCounter") >> 4)
        : integer(team, -1, 7, "triggering team for S");
    case "call": {
      const args = expression.args.map((argument) => evaluate(argument, statistics, inputs, team));
      if (expression.name === "b") {
        integer(args[0], 0, 7, "building team");
        integer(args[1], 0, 4, "building slot (verified mission subset)");
        return readValue(inputs.buildingSlots, args.join(","), "b");
      }
      integer(args[0], 0, 7, "statistic team");
      integer(args[1], 0, args.length === 2 ? 11 : 3, "statistic selector");
      if (args.length === 3 && args[1] === 2) {
        integer(args[2], 0, 799, "array statistic index");
        const index = integer(args[0] * 110 + args[2], 0, 879, "array statistic storage index");
        const key = `${Math.floor(index / 110)},2,${index % 110}`;
        return Object.hasOwn(statistics, key) ? readValue(statistics, key, "s") : 0;
      }
      if (args.length === 3) integer(args[2], 0, 109, "unit type (verified table stride)");
      return readValue(statistics, args.join(","), "s");
    }
    case "binary": {
      const left = evaluate(expression.left, statistics, inputs, team);
      const right = evaluate(expression.right, statistics, inputs, team);
      switch (expression.operator) {
        case "+": return signedWord(left + right);
        case "&&": return signedWord(left & right);
        case "||": return signedWord(left | right);
        case "==": return Number(left === right);
        case "!=": return Number(left !== right);
        case "<": return Number(left < right);
        case ">": return Number(left > right);
        default: return fail("unsupported-condition", expression.operator);
      }
    }
  }
}

function evaluateConditionExpression(expression: Expression, statistics: Readonly<Record<string, number>>,
  inputs: TriggerInputs, team?: number): number {
  if (inputs.runtimeProfile !== "browser-adapted") return evaluate(expression, statistics, inputs, team);
  const stack = [-1];
  function visit(node: Expression): void {
    if (node.kind === "native-omitted") return;
    if (node.kind !== "binary") { stack.push(evaluate(node, statistics, inputs, team)); return; }
    visit(node.left);
    visit(node.right);
    if (stack.length < 2) fail("unsupported-condition", "Native expression stack underflow beyond initialized sentinel");
    const right = stack.pop()!;
    const left = stack.pop()!;
    stack.push(evaluate({ ...node, left: { kind: "literal", value: left }, right: { kind: "literal", value: right } }, statistics, inputs, team));
  }
  visit(expression);
  return stack[stack.length - 1];
}

export function evaluateTriggerCondition(
  condition: string,
  statistics: Readonly<Record<string, number>>,
  inputs: TriggerInputs,
  triggeringTeam?: number,
): TriggerResult<number> {
  try {
    return { ok: true, value: evaluateConditionExpression(parseCondition(condition, inputs.runtimeProfile === "browser-adapted"), statistics, inputs, triggeringTeam) };
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(error)] };
  }
}

function validateBlocks(blocks: readonly RuntimeTriggerBlock[]): void {
  const ids = new Set<number>();
  for (const block of blocks) {
    integer(block.id, 0, 127, "trigger ID (normal scan range)");
    if (ids.has(block.id)) fail("invalid-input", `Duplicate trigger ID ${block.id}`);
    ids.add(block.id);
    if (block.mode !== "norm" && block.mode !== "trip") fail("invalid-input", `Unsupported mode '${block.mode}'`);
    integer(block.flag ?? 0, 0, 255, `initial lives for trigger ${block.id}`);
  }
}

function arrayAction(action: RuntimeTriggerBlock["actions"][number]): { key: string; expression: Expression } {
  const [index, ...tokens] = action.arguments;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || tokens.length === 0) {
    fail("unsupported-action", "setarray requires a literal integer index and an expression");
  }
  const wrapped = integer(index & 65535, 0, 799, "setarray index");
  return { key: `${Math.floor(wrapped / 110)},2,${wrapped % 110}`, expression: parseCondition(tokens.join(" ")) };
}

function actionArguments(action: RuntimeTriggerBlock["actions"][number]): readonly number[] {
  if (action.name !== "bail" && action.name !== "setlifes") {
    fail("unsupported-action", `Action '${action.name}' has no verified implementation`);
  }
  if (action.arguments.length !== 2 || action.arguments.some((value) => typeof value !== "number")) {
    fail("unsupported-action", `${action.name} supports exactly two integer arguments`);
  }
  const args = action.arguments as readonly number[];
  integer(args[0], 0, action.name === "setlifes" ? 127 : 255, `${action.name} argument 1`);
  integer(args[1], 0, 255, `${action.name} argument 2`);
  return args;
}

export function auditTriggerSupport(blocks: readonly RuntimeTriggerBlock[], options?: { readonly runtimeProfile?: "browser-adapted" }): readonly TriggerDiagnostic[] {
  const diagnostics: TriggerDiagnostic[] = [];
  try { validateBlocks(blocks); } catch (error) { diagnostics.push(diagnostic(error)); }
  for (const block of blocks) {
    try { parseCondition(block.condition, options?.runtimeProfile === "browser-adapted"); } catch (error) {
      diagnostics.push({ ...diagnostic(error), triggerId: block.id });
    }
    block.actions.forEach((action, actionIndex) => {
      try { if (action.name === "setarray") arrayAction(action); else actionArguments(action); } catch (error) {
        diagnostics.push({ ...diagnostic(error), triggerId: block.id, actionIndex });
      }
    });
  }
  return diagnostics;
}

export function createTriggerRuntimeState(
  blocks: readonly RuntimeTriggerBlock[],
  statistics: Readonly<Record<string, number>>,
): TriggerResult<TriggerRuntimeState> {
  try {
    validateBlocks(blocks);
    return {
      ok: true,
      value: {
        lives: Object.fromEntries(blocks.map((block) => [block.id, integer(block.flag ?? 0, 0, 255, "initial lives")])),
        statistics: { ...statistics },
        bail: null,
      },
    };
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(error)] };
  }
}

export function stepTriggerRuntime(
  blocks: readonly RuntimeTriggerBlock[],
  state: TriggerRuntimeState,
  inputs: TriggerInputs,
  event: TriggerEvent,
): TriggerResult<{ readonly state: TriggerRuntimeState; readonly fired: readonly number[] }> {
  let triggerId: number | undefined;
  let actionIndex: number | undefined;
  try {
    validateBlocks(blocks);
    if (event.kind === "trip") {
      integer(event.triggerId, 0, 127, "trip trigger ID");
      integer(event.team, 0, 7, "trip team");
      if (!blocks.some((block) => block.id === event.triggerId)) fail("missing-input", `Unknown trip trigger ${event.triggerId}`);
    }
    const lives = { ...state.lives };
    const statistics = { ...state.statistics };
    let bail = state.bail;
    const fired: number[] = [];
    for (const block of [...blocks].sort((left, right) => left.id - right.id)) {
      triggerId = block.id;
      actionIndex = undefined;
      integer(lives[block.id], 0, 255, `remaining lives for trigger ${block.id}`);
      if (lives[block.id] === 0) continue;
      if (event.kind === "normal" ? block.mode !== "norm" : block.mode !== "trip" || block.id !== event.triggerId) continue;
      const value = evaluateConditionExpression(parseCondition(block.condition, inputs.runtimeProfile === "browser-adapted"), statistics,
        { ...inputs, triggeringUnitType: event.kind === "trip" ? event.unitType : undefined }, event.kind === "trip" ? event.team : undefined);
      if (value === 0) continue;
      for (let index = block.actions.length - 1; index >= 0; index -= 1) {
        actionIndex = index;
        const action = block.actions[index];
        if (action.name === "setarray") {
          const compiled = arrayAction(action);
          statistics[compiled.key] = evaluate(compiled.expression, statistics, inputs, -1);
          continue;
        }
        const args = actionArguments(action);
        if (action.name === "setlifes") {
          if (!Object.hasOwn(lives, args[0])) fail("missing-input", `setlifes target ${args[0]} is not defined`);
          lives[args[0]] = args[1];
        } else {
          const clock = integer(inputs.clockMilliseconds, 0, 4294967295, "clockMilliseconds");
          statistics["0,0"] = args[0];
          statistics["7,0"] = args[1];
          bail = { resultCode: args[0], reasonCode: args[1], deadlineMilliseconds: (clock + 10000) >>> 0 };
        }
      }
      lives[block.id] = (lives[block.id] - 1) & 255;
      fired.push(block.id);
    }
    return { ok: true, value: { state: { lives, statistics, bail }, fired } };
  } catch (error) {
    return { ok: false, diagnostics: [{ ...diagnostic(error), triggerId, actionIndex }] };
  }
}