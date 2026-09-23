import { aiSelectorSourceCanonical, type AiSelectorConfiguration, type AiSelectorSchedulingOwner } from "./ai-command-selector";
import type { CampaignWorld } from "./campaign-world";
import { advanceLegacyNativeAiSchedule, computeLegacyNativeSchedulerTimingFeedback,
	planLegacyNativeSchedulerCycle, recordLegacyNativeSchedulerTiming, selectLegacyNativePolicy,
	type LegacyNativeSchedulerClock, type LegacyNativeSchedulerPhaseKind,
	type LegacyNativeSchedulerSource } from "./legacy-native-scheduler";
import { consumeSourceNativePolicy, requireSourceNativePolicy, type SourceNativePolicy } from "./source-native-policy";
import { NativeRegisteredHost, type NativeRegisteredConfiguration, type NativeRegisteredState } from "./native-registered-host";

export { computeSourceNativePolicyPhase as transactSourceNativePolicyPhase } from "./source-native-policy";

export function createNativeSchedulerRegisteredHost(input: Readonly<{
	source: LegacyNativeSchedulerSource;
	configuration: NativeRegisteredConfiguration;
	boundary: NativeRegisteredState;
}>): NativeRegisteredHost {
	selectLegacyNativePolicy(input.source, { mode: 4, weights: [0], rngCursor: 0 });
	return new NativeRegisteredHost(input.configuration, input.boundary);
}

export interface NativeSchedulerBoundary {
	readonly scope: "explicit-native-post-projectile-boundary";
	readonly game: Uint8Array;
	readonly aiState: Uint8Array;
	readonly policies: readonly { readonly team: number; readonly address: number; readonly bytes: Uint8Array }[];
	readonly rngCursor: number;
	readonly crtSeed: number;
	readonly forceOrder: number;
	readonly localPackets: number;
	readonly groundCells: Uint32Array;
	readonly populations: readonly number[];
}

const phaseConsumers = Object.freeze({
	"ai-local-enter": "native-local-packets-42163c",
	ai: "native-selectors-and-sourceNativePolicy",
	"ai-local-exit": "native-local-packets-42163c",
	timing: "recordLegacyNativeSchedulerTiming",
	"timing-feedback": "computeLegacyNativeSchedulerTimingFeedback:transport-requests",
});

export type NativeSchedulerHostConfiguration = Readonly<{
	scope: "source-native-post-projectile-transaction";
	selector: AiSelectorConfiguration;
	consumers: typeof phaseConsumers;
	sourceNativePolicy: readonly SourceNativePolicy[];
}>;

const configurations = new WeakMap<NativeSchedulerHostConfiguration, LegacyNativeSchedulerSource>();
const bytesView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const teamOffset = (team: number) => 0xb98 + team * 0xe30;

export function createNativeSchedulerHostConfiguration(input: Readonly<{
	source: LegacyNativeSchedulerSource; scenario: CampaignWorld["source"]; globalMode: 0 | 3;
	sourceNativePolicy: readonly SourceNativePolicy[];
}>): NativeSchedulerHostConfiguration {
	selectLegacyNativePolicy(input.source, { mode: 4, weights: [0], rngCursor: 0 });
	if (input.globalMode !== 0 && input.globalMode !== 3) throw new RangeError("Native scheduler requires proven global mode 0 or 3");
	if (input.scenario.teams.length !== 8 || input.scenario.teams.some((team, index) => team.index !== index)) {
		throw new RangeError("Native scheduler requires all eight source teams");
	}
	const owners = [...input.sourceNativePolicy];
	owners.forEach(owner => requireSourceNativePolicy(owner, input.source));
	if (new Set(owners.map(owner => owner.team)).size !== owners.length) throw new RangeError("Duplicate native policy team owner");
	const selector = Object.freeze({ sourceId: input.scenario.id, sourceCanonical: aiSelectorSourceCanonical(input.scenario),
		profileId: "native-scheduler-post-projectile-v1", scope: "source-native-policy-scheduler" as const,
		globalMode: input.globalMode,
		teams: Object.freeze(input.scenario.teams.map(team => Object.freeze({ team: team.index,
			modes: Object.freeze(owners.some(owner => owner.team === team.index) ? [0, 3, 4] : [0, 4]) }))) });
	const configuration = Object.freeze({ scope: "source-native-post-projectile-transaction" as const,
		selector, consumers: phaseConsumers, sourceNativePolicy: Object.freeze(owners) });
	configurations.set(configuration, input.source);
	return configuration;
}

export type NativeSchedulerBlocker = Readonly<{
	phase: LegacyNativeSchedulerPhaseKind;
	reason: string;
	slot?: number;
	type?: number;
	team?: number;
}>;

export type NativeSchedulerTransportRequest = Readonly<{
	kind: "period" | "latency";
	callback: 0x421394 | 0x42125c;
	value: number;
}>;

function boundaryClock(game: Uint8Array): LegacyNativeSchedulerClock {
	const view = bytesView(game);
	return { counter: view.getUint32(0x94c, true), troCounter: view.getInt32(0x52c, true),
		resourceClock: view.getInt32(0x530, true), period: view.getInt32(0x534, true),
		transition: view.getInt32(0x538, true), dayPhase: view.getInt32(0x53c, true), daylight: view.getInt32(0x540, true) };
}

function validateBoundary(state: NativeSchedulerBoundary): void {
	if (state.scope !== "explicit-native-post-projectile-boundary" || state.game.length !== 0x471b0
		|| state.aiState.length !== 8 || state.populations.length !== 8) throw new RangeError("Complete explicit native boundary required");
	if (typeof SharedArrayBuffer !== "undefined" && [state.game, state.aiState, state.groundCells,
		...state.policies.map(policy => policy.bytes)].some(bytes => bytes.buffer instanceof SharedArrayBuffer)) {
		throw new RangeError("Native scheduler requires unshared current-world buffers");
	}
	for (const [name, value, maximum] of [["RNG", state.rngCursor, 255], ["CRT", state.crtSeed, 0xffffffff],
		["force", state.forceOrder, 255], ["local packets", state.localPackets, 1]] as const) {
		if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`Invalid native ${name}`);
	}
	if (state.populations.some(value => !Number.isInteger(value) || value < 0 || value > 800)) throw new RangeError("Invalid native census");
	const view = bytesView(state.game);
	if (new Set(state.policies.map(policy => policy.team)).size !== state.policies.length) throw new RangeError("Duplicate native policy allocation");
	for (const policy of state.policies) {
		if (!Number.isInteger(policy.team) || policy.team < 0 || policy.team > 7 || policy.bytes.length !== 0x6c40
			|| !Number.isInteger(policy.address) || policy.address <= 0 || policy.address > 0xffffffff
			|| view.getUint32(teamOffset(policy.team) + 0x28, true) !== policy.address) {
			throw new RangeError("Native policy heap/team pointer mismatch");
		}
	}
	for (let team = 0; team < 8; team++) {
		if (view.getUint32(teamOffset(team) + 0x28, true) !== 0 && !state.policies.some(policy => policy.team === team)) {
			throw new RangeError(`Missing current policy heap for team ${team}`);
		}
	}
}

export class NativeSchedulerHost {
	readonly configuration: NativeSchedulerHostConfiguration;
	readonly selectorOwner: AiSelectorSchedulingOwner;
	readonly #source: LegacyNativeSchedulerSource;
	#current: NativeSchedulerBoundary;
	#completed = false;

	constructor(configuration: NativeSchedulerHostConfiguration, boundary: NativeSchedulerBoundary) {
		const source = configurations.get(configuration);
		if (!source) throw new RangeError("Native scheduler requires its original frozen configuration identity");
		validateBoundary(boundary);
		this.configuration = configuration;
		this.#source = source;
		this.#current = structuredClone(boundary);
		this.selectorOwner = Object.freeze({ configuration: configuration.selector, isReady: context => {
			if (context.world.source.id !== configuration.selector.sourceId
				|| aiSelectorSourceCanonical(context.world.source) !== configuration.selector.sourceCanonical
				|| context.selectors.modes.length !== 8
				|| context.selectors.modes.some((mode, team) => mode !== bytesView(this.#current.game).getInt32(teamOffset(team) + 0x24, true))) return false;
			return this.wholeCycleReadiness().ready;
		} } satisfies AiSelectorSchedulingOwner);
		Object.freeze(this);
	}

	get snapshot(): NativeSchedulerBoundary { return structuredClone(this.#current); }
	get completed(): boolean { return this.#completed; }

	wholeCycleReadiness(clock: LegacyNativeSchedulerClock = boundaryClock(this.#current.game)) {
		const plan = planLegacyNativeSchedulerCycle(this.#source, clock);
		const blockers: NativeSchedulerBlocker[] = plan.phases.filter(phase => !Object.hasOwn(phaseConsumers, phase.kind))
			.map(phase => ({ phase: phase.kind, reason: `Missing concrete native ${phase.kind} transaction consumer` }));
		const view = bytesView(this.#current.game), highWater = view.getInt32(0x7d20, true);
		if (highWater < 0 || highWater > 799) throw new RangeError("Invalid current native registry high water");
		for (let index = 0; index <= highWater; index++) {
			const slot = view.getInt16(0x468ec + index * 2, true);
			if (slot === -1) continue;
			if (slot < 0 || slot > 799) throw new RangeError(`Invalid current registry value at index ${index}`);
			blockers.push({ phase: "registered-actors", slot, type: this.#current.game[0x7d28 + slot * 220 + 6],
				reason: `No composed registered-visit owner at live index ${index}` });
		}
		for (let team = 0; team < 8; team++) {
			const mode = view.getInt32(teamOffset(team) + 0x24, true);
			if (![0, 3, 4].includes(mode) || mode === 3 && !this.configuration.sourceNativePolicy.some(owner => owner.team === team)) {
				blockers.push({ phase: "ai", team, reason: `Unsupported current selector mode ${mode} for team ${team}` });
			}
		}
		blockers.push({ phase: "timing-feedback", reason: "Outgoing timing requests have no integrated transport consumer" });
		return { ready: blockers.length === 0, partialScope: this.configuration.scope, blockers };
	}

	transactWholeCycle(clock: LegacyNativeSchedulerClock = boundaryClock(this.#current.game)) {
		const readiness = this.wholeCycleReadiness(clock);
		return { ok: false as const, admitted: false as const, blockers: readiness.blockers };
	}

	transactPostProjectile(input: Readonly<{ endTick: number; feedbackTick?: number }>) {
		let phase: LegacyNativeSchedulerPhaseKind = "ai-local-enter";
		let team: number | undefined;
		try {
			if (this.#completed) throw new RangeError("Native boundary already consumed; a new current-world boundary is required");
			const staged = structuredClone(this.#current);
			const view = bytesView(staged.game), ai = bytesView(staged.aiState);
			const counter = view.getUint32(0x94c, true);
			const phases: LegacyNativeSchedulerPhaseKind[] = [phase];
			const mutable = { ...staged, policies: [...staged.policies], localPackets: 1 };
			phase = "ai";
			phases.push(phase);
			const schedule = advanceLegacyNativeAiSchedule(this.#source, { counter, nextTeam: ai.getUint32(4, true),
				modes: Array.from({ length: 8 }, (_, index) => view.getInt32(teamOffset(index) + 0x24, true)) },
			{ consumers: {}, registeredTypes: [], aiModes: [3, 4], synchronousReceipts: ["actor"] });
			ai.setUint32(4, schedule.nextTeam, true);
			const calls = [];
			for (const selector of schedule.selectors) {
				team = selector.team;
				if (selector.mode === 4) {
					const selection = selectLegacyNativePolicy(this.#source, { mode: 4, weights: [0], rngCursor: mutable.rngCursor });
					mutable.rngCursor = selection.rngCursor;
					calls.push({ team, selection, packets: [] });
					continue;
				}
				const owner = this.configuration.sourceNativePolicy.find(candidate => candidate.team === team);
				if (!owner) throw new RangeError(`Missing sourceNativePolicy owner for current mode 3 team ${team}`);
				const previous = mutable.policies.find(policy => policy.team === team);
				const transaction = consumeSourceNativePolicy(owner, this.#source, {
					policy: previous?.bytes ?? new Uint8Array(0x6c40), entities: mutable.game.slice(0x7d28, 0x7d28 + 800 * 220),
					teamBytes: mutable.game.slice(teamOffset(team), teamOffset(team) + 0xe30),
					rngCursor: mutable.rngCursor, forceOrder: mutable.forceOrder, population: mutable.populations[team],
					populationLimit: view.getInt32(0x528, true), relations: mutable.game.slice(0x46f34, 0x46f34 + 100),
					visibilityMasks: Array.from({ length: 8 }, (_, index) => view.getUint32(0x19c0 + index * 0xe30, true)),
					groundCells: mutable.groundCells,
				});
				const { result } = transaction;
				mutable.game.set(result.candidate.entities, 0x7d28);
				mutable.game.set(result.teamBytes, teamOffset(team));
				mutable.rngCursor = result.candidate.rngCursor;
				mutable.forceOrder = result.candidate.forceOrder;
				mutable.policies = [...mutable.policies.filter(policy => policy.team !== team),
					{ team, address: owner.policyAddress, bytes: result.candidate.policy }].sort((left, right) => left.team - right.team);
				calls.push({ team, selection: transaction.selection, packets: result.packets });
			}
			team = undefined;
			phase = "ai-local-exit";
			phases.push(phase);
			mutable.localPackets = 0;
			phase = "timing";
			phases.push(phase);
			const ringIndex = view.getUint32(0x308, true);
			const ring = (offset: number) => Array.from({ length: 64 }, (_, index) => view.getUint32(offset + index * 4, true));
			const timing = recordLegacyNativeSchedulerTiming(this.#source, { ringIndex, durations: ring(8),
				timestamps: ring(0x108), periods: ring(0x208) }, { startTick: view.getUint32(0x108 + ringIndex * 4, true),
				endTick: input.endTick, framePeriod: view.getUint32(0x970, true) });
			timing.durations.forEach((value, index) => view.setUint32(8 + index * 4, value, true));
			timing.periods.forEach((value, index) => view.setUint32(0x208 + index * 4, value, true));
			view.setUint32(0x308, timing.ringIndex, true);
			const requests: NativeSchedulerTransportRequest[] = [];
			if ((counter & 31) === 0) {
				phase = "timing-feedback";
				phases.push(phase);
				if (input.feedbackTick === undefined) throw new RangeError("Explicit native timing-feedback tick required");
				const feedback = computeLegacyNativeSchedulerTimingFeedback(this.#source, timing, { tick: input.feedbackTick,
					teamLatencies: Array.from({ length: 8 }, (_, index) => view.getUint32(0x974 + index * 4, true)),
					requestedLatency: view.getUint32(0x96c, true) });
				view.setUint32(4, feedback.populationCeiling, true);
				requests.push({ kind: "period", callback: 0x421394, value: feedback.period },
					{ kind: "latency", callback: 0x42125c, value: feedback.latency });
			} else if (input.feedbackTick !== undefined) throw new RangeError("Unexpected timing-feedback tick outside native cadence");
			validateBoundary(mutable);
			const result = { ok: true as const, scope: this.configuration.scope, admitted: false as const,
				executableWholeGame: false as const, counter, phases, calls, requests, state: structuredClone(mutable) };
			this.#current = mutable;
			this.#completed = true;
			return result;
		} catch (error) {
			return { ok: false as const, admitted: false as const, phase, ...(team === undefined ? {} : { team }),
				message: error instanceof Error ? error.message : String(error) };
		}
	}
}