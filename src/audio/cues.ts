import { assetUrl } from "../asset-url";

export interface LegacySound {
  readonly id: number;
  readonly source: string;
  readonly parameters: readonly number[];
}

export interface MediaAudioIndex {
  readonly entries: readonly {
    readonly kind: string;
    readonly source: string;
    readonly outputs: readonly { readonly path: string; readonly mimeType: string }[];
  }[];
}

export interface LegacySoundBinding {
  readonly id: number;
  readonly group: string;
  readonly soundIds: readonly number[];
  readonly parameters: readonly number[];
}

export interface CueCatalog {
  readonly sounds: readonly LegacySound[];
  readonly bindings: readonly LegacySoundBinding[];
}

export type UnitAudioEvent =
  | { readonly type: "unit-selected" | "unit-move" | "unit-death"; readonly unitType: number }
  | { readonly type: "unit-attack"; readonly weaponId: number };

export interface ResolvedUnitCue {
  readonly assetId: string;
  readonly soundId: number;
  readonly priority: number;
  readonly evidence: { readonly file: "SOUND/SLIST.DAT"; readonly group: string; readonly id: number };
}

export function parseSoundBindings(text: string): LegacySoundBinding[] {
  return text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("%")) return [];
    const match = /^(\d+)\s+(DEA|AMB|GUN|SEL|DPY|EXP|ACK|XTR)\s+(.+)$/.exec(line);
    if (!match || !/^-?\d+(?:\s+-?\d+)*$/.test(match[3])) throw new Error(`Invalid SLIST row: ${line}`);
    const values = match[3].split(/\s+/).map(Number);
    const end = values.indexOf(-1);
    if (end < 1 || values.slice(0, end).some((value) => value < 0) || values.slice(end + 1).some((value) => value < 0)) {
      throw new Error(`Invalid SLIST terminator: ${line}`);
    }
    return [{ id: Number(match[1]), group: match[2], soundIds: values.slice(0, end), parameters: values.slice(end + 1) }];
  });
}

export function createCueCatalog(soundText: string, bindingText: string): CueCatalog {
  const sounds = parseSoundTable(soundText);
  const bindings = parseSoundBindings(bindingText);
  const ids = new Set(sounds.map((sound) => sound.id));
  for (const binding of bindings) {
    if (binding.soundIds.some((id) => !ids.has(id))) throw new Error(`Unresolved SLIST binding: ${binding.id} ${binding.group}`);
  }
  return { sounds, bindings };
}

export function resolveUnitCue(catalog: CueCatalog, event: UnitAudioEvent, variant = 0): ResolvedUnitCue | undefined {
  if (!Number.isSafeInteger(variant) || variant < 0) return undefined;
  const group = event.type === "unit-selected" ? "SEL" : event.type === "unit-move" ? "ACK" : event.type === "unit-attack" ? "GUN" : event.type === "unit-death" ? "DEA" : undefined;
  if (!group) return undefined;
  const id = event.type === "unit-attack" ? event.weaponId : event.unitType;
  const binding = catalog.bindings.find((candidate) => candidate.id === id && candidate.group === group);
  if (!binding?.soundIds.length) return undefined;
  const soundId = binding.soundIds[variant % binding.soundIds.length];
  const sound = catalog.sounds.find((candidate) => candidate.id === soundId);
  if (!sound) return undefined;
  return { assetId: sound.source, soundId, priority: group === "GUN" ? 40 : 70, evidence: { file: "SOUND/SLIST.DAT", group, id } };
}

export interface AudioPosition {
  readonly x: number;
  readonly y: number;
}

export interface AudioListener extends AudioPosition {
  readonly halfWidth: number;
  readonly audibleRadius: number;
}

export function spatialAudio(position: AudioPosition, listener: AudioListener): { pan: number; gain: number } {
  if (![position.x, position.y, listener.x, listener.y, listener.halfWidth, listener.audibleRadius].every(Number.isFinite)
    || listener.halfWidth <= 0 || listener.audibleRadius <= 0) return { pan: 0, gain: 0 };
  const horizontal = position.x - listener.x;
  return {
    pan: Math.max(-1, Math.min(1, horizontal / listener.halfWidth)),
    gain: Math.max(0, 1 - Math.hypot(horizontal, position.y - listener.y) / listener.audibleRadius),
  };
}

export function normalizeAudioSource(source: string): string {
  return source.replaceAll("\\", "/").replace(/^\.\//, "").toUpperCase();
}

export function parseSoundTable(text: string): LegacySound[] {
  const sounds: LegacySound[] = [];
  const ids = new Set<number>();
  let terminated = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%")) continue;
    if (line === "*") {
      terminated = true;
      break;
    }
    const match = /^(\d+)\s+(\S+\.WAV)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i.exec(line);
    if (!match) throw new Error(`Invalid SOUND2 row: ${line}`);
    const id = Number(match[1]);
    if (ids.has(id)) throw new Error(`Duplicate sound ID: ${id}`);
    ids.add(id);
    sounds.push({ id, source: normalizeAudioSource(match[2]), parameters: match.slice(3).map(Number) });
  }
  if (!terminated) throw new Error("Missing SOUND2 terminator");
  return sounds;
}

export function resolveAudioAsset(index: MediaAudioIndex, source: string, baseUrl = assetUrl("/assets/generated/media/")): string | undefined {
  return resolveAudioCandidates(index, source, baseUrl)[0];
}

export function resolveAudioCandidates(index: MediaAudioIndex, source: string, baseUrl = assetUrl("/assets/generated/media/")): readonly string[] {
  const normalized = normalizeAudioSource(source);
  const entry = index.entries.find((candidate) => candidate.kind === "audio" && normalizeAudioSource(candidate.source) === normalized);
  return ["audio/ogg", "audio/wav"].flatMap((mimeType) => {
    const output = entry?.outputs.find((candidate) => candidate.mimeType === mimeType
      && candidate.path.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== ".."));
    return output ? [`${baseUrl.replace(/\/$/, "")}/${output.path}`] : [];
  });
}