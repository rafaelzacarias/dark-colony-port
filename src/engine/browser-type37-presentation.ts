import { assetUrl } from "../asset-url";
import type { CampaignEntity, CampaignWorld } from "./campaign-world";
import { browserType37Presentation, type BrowserType37Frame } from "./browser-type37";
import { aiSelectorSourceCanonical } from "./ai-command-selector";
import { SUBCELLS_PER_CELL } from "./constants";
import type { ResourceActorIdentity, SimulationSnapshot } from "./simulation";
import { transportHostState } from "./transport-host";
import { observeBrowserResearch, type BrowserResearchConfiguration } from "./browser-research";

export interface BrowserType37PresentationOwner {
  readonly runtimeProfile: "browser-adapted";
  readonly sourceCanonical: string;
}

export function browserType37SourceMatches(world: CampaignWorld, source: CampaignWorld["source"]): boolean {
  return aiSelectorSourceCanonical(world.source) === aiSelectorSourceCanonical(source);
}

function requireOwner(world: CampaignWorld, owner: BrowserType37PresentationOwner): void {
  if (owner.runtimeProfile !== "browser-adapted" || owner.sourceCanonical !== aiSelectorSourceCanonical(world.source)
    || !world.scenarioMarkers || !world.coordinateQueues || world.markerSpyTeams?.length !== 8
    || world.markerSpyTeams.some(value => typeof value !== "boolean")) {
    throw new TypeError("Type37 presentation requires adapted source fingerprint and relay ownership");
  }
}

export function isBrowserScenarioMarker(entity: CampaignEntity, world: CampaignWorld): boolean {
  if (entity.unitType !== 37 || entity.team !== 8 || entity.generation !== 0 || entity.sourceRow === null
    || entity.rawSlot === null || entity.simulationId !== null) return false;
  const marker = world.scenarioMarkers?.find(entry => entry.key === entity.key && entry.rawSlot === entity.rawSlot
    && entry.sourceRow === entity.sourceRow);
  const row = world.source.placementRows[entity.sourceRow];
  const queue = marker && world.coordinateQueues?.[marker.queueIndex];
  return !!(marker && marker.kind === "type37-coordinate-relay" && marker.selector6 === 0 && marker.loaderGate === 0
    && entity.key === `placement:${entity.sourceRow}` && row && row[2] === 37 && row[3] !== -1
    && row[0] === entity.tileX && row[1] === entity.tileY
    && queue && queue.sourceRow === entity.sourceRow && queue.tileX === entity.tileX && queue.tileY === entity.tileY
    && world.markerSpyTeams?.length === 8 && world.markerSpyTeams.every(value => typeof value === "boolean")
    && world.entities.some(entry => entry.key === entity.key && entry.rawSlot === entity.rawSlot
      && entry.generation === entity.generation && entry.sourceRow === entity.sourceRow && entry.unitType === 37 && entry.team === 8));
}

export function browserScenarioMarkerPresentation(entity: CampaignEntity, world: CampaignWorld, spyEnabled = world.markerSpyTeams?.[0] ?? false) {
  return isBrowserScenarioMarker(entity, world)
    ? browserType37Presentation(entity, world.scenarioMarkers!, spyEnabled) : "ordinary";
}

export function browserType37PlacementHidden(world: CampaignWorld | undefined, sourceRow: number, row: readonly number[]): boolean {
  if (!world || row[2] !== 37) return false;
  const original = world.source.placementRows[sourceRow];
  if (!original || original.length !== row.length || original.some((value, index) => value !== row[index])) return false;
  const entity = world.entities.find(entry => entry.sourceRow === sourceRow);
  return !!entity && browserScenarioMarkerPresentation(entity, world) === "excluded-native-spy-gate";
}

export function projectBrowserType37Presentation(world: CampaignWorld, owner: BrowserType37PresentationOwner, localTeam = 0) {
  requireOwner(world, owner);
  if (!Number.isInteger(localTeam) || localTeam < 0 || localTeam >= 8) throw new RangeError("Invalid type37 local team");
  const host = transportHostState(world);
  const entries = world.scenarioMarkers!.map(marker => {
    const entity = world.entities.find(entry => entry.key === marker.key);
    if (!entity || !isBrowserScenarioMarker(entity, world)) throw new TypeError("Type37 presentation source marker mismatch");
    const queue = world.coordinateQueues![marker.queueIndex];
    const fifo = host.fifos[marker.queueIndex];
    const actor = host.slots[marker.rawSlot];
    if (!fifo || fifo.tile.x !== queue.tileX || fifo.tile.y !== queue.tileY || marker.active &&
      (!actor || actor.key !== entity.key || actor.generation !== entity.generation || actor.unitType !== 37 || actor.team !== 8
        || host.registry[marker.rawSlot] !== entity.key || host.ground.includes(marker.rawSlot) || host.flying.includes(marker.rawSlot))) {
      throw new TypeError("Type37 presentation registry or FIFO mismatch");
    }
    return { ...marker, generation: entity.generation, team: 8 as const, tileX: queue.tileX, tileY: queue.tileY,
      captured: queue.captured.map(entry => ({ ...entry })), pendingTypes: [...fifo.types],
      presentation: browserScenarioMarkerPresentation(entity, world, world.markerSpyTeams![localTeam]) };
  });
  return { runtimeProfile: owner.runtimeProfile, sourceCanonical: owner.sourceCanonical,
    clockMilliseconds: world.clockMilliseconds, timing: "adapted-visits-not-native-frames" as const,
    spyTeams: [...world.markerSpyTeams!], entries };
}

export function observeBrowserType37Frame(world: CampaignWorld, owner: BrowserType37PresentationOwner, input: {
  readonly snapshot: SimulationSnapshot;
  readonly bindings: readonly ResourceActorIdentity[];
  readonly spyTeams?: readonly boolean[];
}): BrowserType37Frame {
  requireOwner(world, owner);
  const spyTeams = input.spyTeams ?? world.markerSpyTeams!;
  if (spyTeams.length !== 8 || spyTeams.some(value => typeof value !== "boolean")) throw new TypeError("Invalid type37 spy observation");
  const host = transportHostState(world);
  const idleHarvesterSlots: number[] = [];
  const observedIds = new Set<number>();
  const observedSlots = new Set<number>();
  for (const binding of input.bindings) {
    if (observedIds.has(binding.simulationId) || observedSlots.has(binding.slot)) throw new TypeError("Duplicate type37 collector binding");
    observedIds.add(binding.simulationId);
    observedSlots.add(binding.slot);
    const entity = world.entities.find(entry => entry.key === binding.key);
    if (!entity || ![6, 14].includes(entity.unitType)) continue;
    const actor = host.slots[binding.slot];
    const unit = input.snapshot.units.find(entry => entry.id === binding.simulationId);
    if (entity.rawSlot !== binding.slot || entity.generation !== binding.generation || !actor || actor.key !== binding.key
      || actor.generation !== binding.generation || actor.unitType !== entity.unitType || actor.team !== entity.team) {
      throw new TypeError("Stale type37 collector identity");
    }
    if (!unit || unit.health <= 0 || unit.activity !== "idle" || unit.targetId !== null || unit.resourceActor || actor.resourceTask
      || unit.team !== entity.team || entity.team < 0 || entity.team >= 8 || entity.health <= 0
      || actor.health <= 0 || actor.status === 0 || actor.status === 10 || host.registry[binding.slot] !== binding.key
      || !spyTeams[entity.team]) continue;
    const column = Math.floor(unit.xSubcells / SUBCELLS_PER_CELL), row = Math.floor(unit.ySubcells / SUBCELLS_PER_CELL);
    if (actor.position.x !== Math.round(unit.xSubcells * 256 / SUBCELLS_PER_CELL)
      || actor.position.y !== Math.round(unit.ySubcells * 256 / SUBCELLS_PER_CELL)
      || host.ground[row * host.width + column] !== binding.slot) continue;
    if (world.scenarioMarkers!.some(marker => marker.active && world.coordinateQueues![marker.queueIndex]?.tileX === column
      && world.coordinateQueues![marker.queueIndex]?.tileY === row)) idleHarvesterSlots.push(binding.slot);
  }
  return { spyTeams: [...spyTeams], idleHarvesterSlots: idleHarvesterSlots.sort((left, right) => left - right) };
}

export function observeBrowserResearchType37Frame(world: CampaignWorld, owner: BrowserType37PresentationOwner, input: {
  readonly research: BrowserResearchConfiguration;
  readonly scienceOwner: string;
  readonly snapshot: SimulationSnapshot;
  readonly bindings: readonly ResourceActorIdentity[];
}): BrowserType37Frame {
  const research = observeBrowserResearch(world, input.research, input.scienceOwner);
  return observeBrowserType37Frame(world, owner, { snapshot: input.snapshot, bindings: input.bindings, spyTeams: research.spyTeams });
}

export function projectBrowserType37Discovery(world: CampaignWorld, owner: BrowserType37PresentationOwner, input: {
  readonly research: BrowserResearchConfiguration;
  readonly scienceOwner: string;
  readonly localTeam: number;
  readonly presentationPolicy: "adapted-original-cursor-v1";
  readonly isTileVisible: (tileX: number, tileY: number) => boolean;
}) {
  if (input.presentationPolicy !== "adapted-original-cursor-v1") throw new TypeError("Explicit adapted discovery presentation required");
  const research = observeBrowserResearch(world, input.research, input.scienceOwner);
  const projection = projectBrowserType37Presentation(world, owner, input.localTeam);
  return { runtimeProfile: owner.runtimeProfile, sourceCanonical: owner.sourceCanonical,
    clockMilliseconds: world.clockMilliseconds, presentationPolicy: input.presentationPolicy,
    revealsTerrain: false as const, research,
    entries: projection.entries.map(entry => ({ ...entry, presentation: "adapted-discovery-marker" as const,
      visible: entry.active && research.spyTeams[input.localTeam] && input.isTileVisible(entry.tileX, entry.tileY) === true,
      selectable: false as const, combatBinding: null, collisionFootprint: [] as readonly never[],
      asset: { metadata: assetUrl("/assets/generated/sprites/CURSOR/CURS.json"), image: assetUrl("/assets/generated/sprites/CURSOR/CURS.png"),
        source: "CURSOR/CURS.SPR", sourceSha256: "c614526158b82e99e3022c974c754c7ad58a7827dac49a48b362989601924c89",
        frame: 6, role: "adapted-ui-overlay-not-POOP-art" as const } })) };
}