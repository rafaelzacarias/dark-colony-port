export type AssetCategory =
  | "animation"
  | "audio"
  | "development-metadata"
  | "executable"
  | "game-data"
  | "graphics"
  | "installer"
  | "palette"
  | "scenario"
  | "third-party-runtime"
  | "tooling"
  | "unknown"
  | "video";

export type ClassificationConfidence = "high" | "medium" | "low";
export type ContentKind = "binary" | "empty" | "text";

export interface AssetClassification {
  readonly category: AssetCategory;
  readonly probableRole: string;
  readonly confidence: ClassificationConfidence;
  readonly proprietary: boolean;
}

export interface AssetRecord extends AssetClassification {
  readonly path: string;
  readonly bytes: number;
  readonly extension: string | null;
  readonly contentKind: ContentKind;
  readonly detectedFormat: string;
  readonly magicHex: string;
  readonly entropyBitsPerByte: number;
  readonly sha256: string;
}

export interface AssetManifest {
  readonly schemaVersion: 1;
  readonly scanVersion: "phase-1";
  readonly source: {
    readonly kind: "directory";
    readonly rootName: string;
  };
  readonly integrity: {
    readonly algorithm: "sha256";
    readonly sourceTreeSha256: string;
  };
  readonly summary: {
    readonly fileCount: number;
    readonly directoryCount: number;
    readonly totalBytes: number;
    readonly byCategory: Readonly<Record<string, number>>;
    readonly byExtension: Readonly<Record<string, number>>;
    readonly zeroLengthFiles: readonly string[];
  };
  readonly files: readonly AssetRecord[];
}
