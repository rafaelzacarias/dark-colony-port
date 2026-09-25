import type { CampaignEntity, CampaignWorld } from "./campaign-world";
import { consumeTransportFifo, readTransportHostState, transportHostState } from "./transport-host";

export interface BrowserType37Frame {
  readonly spyTeams: readonly boolean[];
  readonly idleHarvesterSlots: readonly number[];
}

export interface BrowserCoordinateQueue {
  readonly sourceRow: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly captured: readonly { readonly sourceRow: number; readonly unitType: number }[];
}

export interface BrowserScenarioMarker {
  readonly key: string;
  readonly sourceRow: number;
  readonly rawSlot: number;
  readonly queueIndex: number;
  readonly kind: "type37-coordinate-relay";
  readonly selector6: 0;
  readonly loaderGate: 0;
  readonly remainingVisits: number;
  readonly active: boolean;
}

export function registerBrowserType37(sourceRow: number, rawSlot: number, queueIndex: number): BrowserScenarioMarker {
  if (!Number.isInteger(queueIndex) || queueIndex < 0 || queueIndex >= 10) throw new Error("Type37 supports ten source coordinate queues");
  return { key: `placement:${sourceRow}`, sourceRow, rawSlot, queueIndex, kind: "type37-coordinate-relay",
    selector6: 0, loaderGate: 0, remainingVisits: 450, active: true };
}

export function browserType37Presentation(entity: CampaignEntity, markers: readonly BrowserScenarioMarker[], spyEnabled: boolean):
  "ordinary" | "excluded-native-spy-gate" | "source-art-required" {
  if (!markers.some(marker => marker.key === entity.key && marker.rawSlot === entity.rawSlot
    && marker.sourceRow === entity.sourceRow) || entity.unitType !== 37 || entity.team !== 8) return "ordinary";
  return spyEnabled ? "source-art-required" : "excluded-native-spy-gate";
}

export function stepBrowserType37(world: CampaignWorld, frame?: BrowserType37Frame): CampaignWorld {
  if (!world.scenarioMarkers || !world.coordinateQueues) throw new Error("Type37 relay requires adapted source markers");
  const observation: BrowserType37Frame = frame ?? { spyTeams: world.markerSpyTeams ?? Array(8).fill(false), idleHarvesterSlots: [] };
  if (observation.spyTeams.length !== 8 || observation.spyTeams.some(value => typeof value !== "boolean")
    || !Array.isArray(observation.idleHarvesterSlots)
    || new Set(observation.idleHarvesterSlots).size !== observation.idleHarvesterSlots.length) throw new Error("Invalid adapted type37 observation");
  let staged = world;
  const initialHost = readTransportHostState(staged);
  for (const slot of observation.idleHarvesterSlots) {
    const actor = initialHost.slots[slot];
    if (!Number.isInteger(slot) || !actor || ![6, 14].includes(actor.unitType) || actor.team >= 8
      || actor.status === 0 || actor.status === 10 || actor.health <= 0 || initialHost.registry[slot] !== actor.key) {
      throw new Error("Type37 observation requires a live registered source harvester");
    }
  }
  const markers: BrowserScenarioMarker[] = [];
  for (const marker of world.scenarioMarkers) {
    if (!marker.active) { markers.push(marker); continue; }
    const host = readTransportHostState(staged);
    const queue: BrowserCoordinateQueue | undefined = world.coordinateQueues[marker.queueIndex];
    const source = staged.entities.find(entity => entity.key === marker.key);
    if (!queue || !source || source.unitType !== 37 || source.team !== 8 || source.rawSlot !== marker.rawSlot
      || host.registry[marker.rawSlot] !== marker.key) throw new Error("Type37 source marker identity mismatch");
    const slot = host.ground[queue.tileY * host.width + queue.tileX];
    const collector = host.slots[slot];
    const eligible = collector && observation.idleHarvesterSlots.includes(slot) && observation.spyTeams[collector.team];
    if (!eligible) { markers.push({ ...marker, remainingVisits: 450 }); continue; }
    if (marker.remainingVisits > 1) { markers.push({ ...marker, remainingVisits: marker.remainingVisits - 1 }); continue; }
    const fifo = host.fifos[marker.queueIndex];
    if (!fifo || fifo.tile.x !== queue.tileX || fifo.tile.y !== queue.tileY) throw new Error("Type37 transport FIFO identity mismatch");
    if (fifo.types.length) {
      const result = consumeTransportFifo(staged, marker.queueIndex, collector.team);
      if (!result.ok) throw new Error(result.diagnostics.map(entry => entry.message).join("; "));
      staged = result.value;
      markers.push({ ...marker, remainingVisits: 450 });
    } else {
      const owned = transportHostState(staged);
      owned.slots[marker.rawSlot]!.status = 0;
      owned.registry[marker.rawSlot] = null;
      const bytes = new Uint8Array(staged.entityBytes!);
      bytes[marker.rawSlot * 220 + 0x2c] = 0;
      staged = { ...staged, entityBytes: bytes, transportState: owned };
      markers.push({ ...marker, remainingVisits: 450, active: false });
    }
  }
  return { ...staged, scenarioMarkers: markers, markerSpyTeams: [...observation.spyTeams] };
}