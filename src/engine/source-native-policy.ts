import { computeLegacyAiFullPolicy, type LegacyAiFullPolicyInputs } from "./legacy-ai-policy";
import type { LegacyAiActiveState } from "./legacy-ai-active";
import { selectLegacyNativePolicy, type LegacyNativeSchedulerSource } from "./legacy-native-scheduler";

export type SourceNativePolicy = Readonly<{
  scope: "explicit-native-policy-boundary";
  team: number;
  policyAddress: number;
  consumer: "computeLegacyAiFullPolicy:synchronous-actor-receipts";
}>;

type Tables = Pick<LegacyAiFullPolicyInputs, "types" | "weapons" | "dependencies" | "cityDependencies"
  | "matrix" | "neighbors"> & { ruleTable: Uint8Array };
type Binding = { source: LegacyNativeSchedulerSource; tables: Tables; navigation: LegacyAiActiveState["navigation"] };
const bindings = new WeakMap<SourceNativePolicy, Binding>();

function requirePrivateBuffers(buffers: readonly ArrayBufferView[]): void {
  if (typeof SharedArrayBuffer !== "undefined" && buffers.some(bytes => bytes.buffer instanceof SharedArrayBuffer)) {
    throw new RangeError("Native policy requires unshared source and current-world buffers");
  }
}

export function createSourceNativePolicy(input: Readonly<{
  source: LegacyNativeSchedulerSource; team: number; policyAddress: number;
  tables: Tables; navigation: LegacyAiActiveState["navigation"];
}>): SourceNativePolicy {
  selectLegacyNativePolicy(input.source, { mode: 4, weights: [0], rngCursor: 0 });
  requirePrivateBuffers([input.tables.types, input.tables.weapons, input.tables.dependencies, input.tables.neighbors,
    input.tables.ruleTable, ...(input.navigation ? [input.navigation.families, input.navigation.nextFamily] : [])]);
  if (!Number.isInteger(input.team) || input.team < 0 || input.team > 7
    || !Number.isInteger(input.policyAddress) || input.policyAddress <= 0 || input.policyAddress > 0xffffffff) {
    throw new RangeError("Native policy requires an explicit team and allocation address");
  }
  if (input.tables.types.length !== 110 * 280 || input.tables.weapons.length !== 80 * 72
    || input.tables.dependencies.length !== 110 * 52 || input.tables.neighbors.length !== 8192
    || input.tables.ruleTable.length !== 216) throw new RangeError("Incomplete native policy source tables");
  const owner = Object.freeze({ scope: "explicit-native-policy-boundary" as const, team: input.team,
    policyAddress: input.policyAddress, consumer: "computeLegacyAiFullPolicy:synchronous-actor-receipts" as const });
  bindings.set(owner, { source: input.source, tables: structuredClone(input.tables), navigation: structuredClone(input.navigation) });
  return owner;
}

export function requireSourceNativePolicy(owner: SourceNativePolicy, source: LegacyNativeSchedulerSource): void {
  if (bindings.get(owner)?.source !== source) throw new RangeError("Native policy requires its original owner/source identity");
}

export type SourceNativePolicyFrame = Readonly<{
  policy: Uint8Array;
  entities: Uint8Array;
  teamBytes: Uint8Array;
  rngCursor: number;
  forceOrder: number;
  population: number;
  populationLimit: number;
  relations: Uint8Array;
  visibilityMasks: readonly number[];
  groundCells: Uint32Array;
}>;

export function consumeSourceNativePolicy(owner: SourceNativePolicy, source: LegacyNativeSchedulerSource,
  frame: SourceNativePolicyFrame) {
  requireSourceNativePolicy(owner, source);
  requirePrivateBuffers([frame.policy, frame.entities, frame.teamBytes, frame.relations, frame.groundCells]);
  if (frame.teamBytes.length !== 0xe30) throw new RangeError("Native policy requires complete current team bytes");
  const pointer = new DataView(frame.teamBytes.buffer, frame.teamBytes.byteOffset, frame.teamBytes.byteLength).getUint32(0x28, true);
  if (pointer !== 0 && pointer !== owner.policyAddress) throw new RangeError("Native policy allocation identity mismatch");
  const binding = bindings.get(owner)!;
  const inputs: LegacyAiFullPolicyInputs = { ...structuredClone(binding.tables), team: owner.team,
    teamBytes: frame.teamBytes, population: frame.population, populationLimit: frame.populationLimit,
    relations: frame.relations, visibilityMasks: frame.visibilityMasks, occupancy: [...frame.groundCells],
    groundCells: frame.groundCells, rngTable: source.rngTable, actorTransport: "synchronous",
    initialization: pointer === 0 ? { needed: true, policyAddress: owner.policyAddress,
      ruleTable: binding.tables.ruleTable } : { needed: false } };
  return computeSourceNativePolicyPhase(source, { policy: frame.policy, entities: frame.entities,
    rngCursor: frame.rngCursor, forceOrder: frame.forceOrder, navigation: structuredClone(binding.navigation) }, inputs);
}

export function computeSourceNativePolicyPhase(source: LegacyNativeSchedulerSource,
  state: LegacyAiActiveState, inputs: LegacyAiFullPolicyInputs) {
  requirePrivateBuffers([state.policy, state.entities, inputs.teamBytes, inputs.types, inputs.weapons,
    inputs.dependencies, inputs.neighbors, inputs.groundCells, inputs.relations,
    ...(state.navigation ? [state.navigation.families, state.navigation.nextFamily] : []),
    ...(inputs.initialization.needed ? [inputs.initialization.ruleTable] : [])]);
  if (inputs.actorTransport !== "synchronous") throw new RangeError("Native scheduler requires synchronous actor receipts");
  const selection = selectLegacyNativePolicy(source, { mode: 3, weights: [1], rngCursor: state.rngCursor });
  if (selection.action !== 0x44be40) throw new RangeError("Unsupported native policy action");
  const result = computeLegacyAiFullPolicy(structuredClone({ ...state, rngCursor: selection.rngCursor }),
    structuredClone({ ...inputs, rngTable: source.rngTable }));
  const pending = result.packets.find(packet => packet.kind === "production");
  if (pending?.kind === "production") {
    throw new RangeError(`Unsupported native scheduler phase ai: synchronous ${pending.intent.kind} production receipt`);
  }
  return { scope: "source-native-selector-policy-actor-receipts" as const, admitted: false as const,
    executableWholeGame: false as const, selection, result };
}