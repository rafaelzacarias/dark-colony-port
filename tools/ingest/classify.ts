import type {
  AssetClassification,
  AssetCategory,
  ClassificationConfidence,
  ContentKind,
} from "./types";

export interface ClassificationInput {
  readonly assetPath: string;
  readonly extension: string | null;
  readonly contentKind: ContentKind;
}

function classification(
  category: AssetCategory,
  probableRole: string,
  confidence: ClassificationConfidence,
  proprietary: boolean,
): AssetClassification {
  return { category, probableRole, confidence, proprietary };
}

export function classifyAsset(input: ClassificationInput): AssetClassification {
  const lowerPath = input.assetPath.toLowerCase();
  const extension = input.extension ?? "";

  if (lowerPath.startsWith("directx/")) {
    return classification(
      "third-party-runtime",
      "bundled Microsoft DirectX redistributable",
      "high",
      false,
    );
  }

  if (lowerPath.includes("/cvs/")) {
    return classification(
      "development-metadata",
      "CVS working-copy metadata",
      "high",
      false,
    );
  }

  if (lowerPath.startsWith("editor/")) {
    return classification("tooling", "legacy map editor support file", "high", false);
  }

  if (
    !lowerPath.startsWith("dc/") &&
    /(^|\/)(setup|uninst|_is|_setup|_inst)/.test(lowerPath)
  ) {
    return classification("installer", "InstallShield setup component", "high", false);
  }

  if (lowerPath.startsWith("dc/avi/") && extension === ".avi") {
    return classification("video", "Cinepak campaign or training cutscene", "high", false);
  }

  if (extension === ".wav") {
    if (lowerPath.startsWith("dc/mission/")) {
      return classification("audio", "campaign mission voice-over", "high", false);
    }
    if (lowerPath.startsWith("dc/encyclo/")) {
      return classification("audio", "encyclopedia narration", "high", false);
    }
    return classification("audio", "PCM sound effect or unit voice cue", "high", false);
  }

  if (extension === ".amb") {
    return classification("audio", "ambient sound selection rules", "high", true);
  }

  if (extension === ".spr" || extension === ".b00") {
    return classification("graphics", "proprietary indexed sprite archive", "high", true);
  }

  if (extension === ".fin") {
    return classification("animation", "named animation sequence definitions", "high", true);
  }

  if (extension === ".gif" || extension === ".bmp" || extension === ".ppm") {
    const role = lowerPath.startsWith("dc/cursor/")
      ? "cursor artwork"
      : lowerPath.startsWith("dc/wallpapr/")
        ? "installer wallpaper"
        : "indexed reference or interface artwork";
    return classification("graphics", role, "high", false);
  }

  if (extension === ".ico" || extension === ".res" || extension === ".rc") {
    return classification("graphics", "Windows icon or resource metadata", "high", false);
  }

  if (lowerPath === "dc/colour.set") {
    return classification("palette", "text color definitions", "high", true);
  }

  if (extension === ".rgb" || extension === ".rmp") {
    return classification("palette", "color conversion or remap lookup table", "medium", true);
  }

  if (extension === ".bts") {
    return classification("graphics", "terrain tile sprite bank", "medium", true);
  }

  if (extension === ".set") {
    return classification("scenario", "terrain set data with unresolved record layout", "medium", true);
  }

  if (extension === ".map") {
    return classification("scenario", "dimensioned terrain cell records", "high", true);
  }

  if (extension === ".mtg") {
    return classification("scenario", "one-byte map companion grid; semantics unresolved", "medium", true);
  }

  if (extension === ".o16") {
    return classification("scenario", "fixed-size 16-bit map companion layer", "medium", true);
  }

  if (extension === ".ovh") {
    return classification("scenario", "overhead map companion layer; semantics unresolved", "medium", true);
  }

  if (extension === ".pth") {
    return classification("scenario", "derived pathfinding data", "medium", true);
  }

  if (extension === ".scn") {
    return classification("scenario", "scenario, team, economy, and spawn definition", "high", true);
  }

  if (extension === ".tro" || extension === ".trm") {
    return classification("scenario", "mission trigger and action script", "high", true);
  }

  if (extension === ".msg") {
    return classification("scenario", "indexed in-game mission messages", "high", true);
  }

  if (/^\.00[1-5]$/.test(extension)) {
    return classification("scenario", "mission outcome narrative text", "high", true);
  }

  if (extension === ".pop") {
    return classification("scenario", "multiplayer population and placement table", "medium", true);
  }

  if (extension === ".med") {
    return classification("scenario", "map editor metadata", "medium", true);
  }

  if (extension === ".jus" || extension === ".inf") {
    return classification("game-data", "proprietary sprite or scenario companion records", "low", true);
  }

  if (lowerPath.startsWith("dc/gamestat/")) {
    return classification("game-data", "unit, weapon, campaign, or economy table", "high", true);
  }

  if (extension === ".dat") {
    const role = lowerPath.startsWith("dc/sound/")
      ? "sound cue index"
      : "game asset index or configuration";
    return classification("game-data", role, "medium", true);
  }

  if ([".exe", ".dll", ".drv", ".vxd", ".cpl"].includes(extension)) {
    return classification("executable", "legacy Windows executable component", "high", false);
  }

  if (input.contentKind === "text") {
    return classification("game-data", "text data or documentation", "low", false);
  }

  return classification("unknown", "unclassified disc content", "low", true);
}
