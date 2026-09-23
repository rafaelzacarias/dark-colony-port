import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseMissionBriefing } from "./briefing";
import { parseMissionMessages } from "./messages";
import { parseScenario } from "./scenario";
import { parseDamageMatrix, parseDependencies, parseUnitStats, parseWeaponStats } from "./tables";
import { parseTriggerScript } from "./triggers";

export interface DataExtractionIndex {
  readonly schemaVersion: 1;
  readonly unitCount: number;
  readonly weaponCount: number;
  readonly dependencyCount: number;
  readonly scenarioCount: number;
  readonly enabledTeamCount: number;
  readonly placementCount: number;
  readonly files: {
    readonly units: string;
    readonly weapons: string;
    readonly dependencies: string;
    readonly damageMatrix: string;
    readonly scenarios: readonly {
      readonly source: string;
      readonly metadata: string;
      readonly triggers: string | null;
      readonly messages: string | null;
      readonly briefing: string | null;
    }[];
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

async function findScenarios(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".scn") files.push(entryPath);
    }
  }
  await visit(root);
  return files;
}

export async function extractGameData(
  gameRootDirectory: string,
  outputDirectory: string,
): Promise<DataExtractionIndex> {
  const gameRoot = path.resolve(gameRootDirectory);
  const outputRoot = path.resolve(outputDirectory);
  const temporaryRoot = `${outputRoot}.${process.pid}.tmp`;
  const gameStatRoot = path.join(gameRoot, "GAMESTAT");
  const scenarioRoot = path.join(gameRoot, "SCENARIO");
  const [unitSource, weaponSource, dependencySource, damageMatrixSource] = await Promise.all([
    readFile(path.join(gameStatRoot, "GAMESTAT.TXT")),
    readFile(path.join(gameStatRoot, "WEAPSTAT.TXT")),
    readFile(path.join(gameStatRoot, "DEPEND.TXT")),
    readFile(path.join(gameStatRoot, "MBULLET.TXT")),
  ]);
  const units = parseUnitStats(unitSource.toString("ascii"));
  const weapons = parseWeaponStats(weaponSource.toString("ascii"));
  const dependencies = parseDependencies(dependencySource.toString("ascii"));
  const damageMatrix = parseDamageMatrix(damageMatrixSource.toString("ascii"));
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(path.join(temporaryRoot, "scenarios"), { recursive: true });

  try {
    const writeTable = async (filename: string, sourcePath: string, source: Buffer, records: unknown) => {
      await writeFile(
        path.join(temporaryRoot, filename),
        `${JSON.stringify(
          { schemaVersion: 1, source: { path: sourcePath, sha256: sha256(source) }, records },
          null,
          2,
        )}\n`,
      );
    };
    await Promise.all([
      writeTable("units.json", "GAMESTAT/GAMESTAT.TXT", unitSource, units),
      writeTable("weapons.json", "GAMESTAT/WEAPSTAT.TXT", weaponSource, weapons),
      writeTable("dependencies.json", "GAMESTAT/DEPEND.TXT", dependencySource, dependencies),
      writeFile(path.join(temporaryRoot, "damage-matrix.json"), `${JSON.stringify({
        schemaVersion: 1,
        source: { path: "GAMESTAT/MBULLET.TXT", sha256: sha256(damageMatrixSource) },
        ...damageMatrix,
      }, null, 2)}\n`),
    ]);

    const scenarioFiles: {
      source: string;
      metadata: string;
      triggers: string | null;
      messages: string | null;
      briefing: string | null;
    }[] = [];
    let enabledTeamCount = 0;
    let placementCount = 0;
    for (const file of await findScenarios(scenarioRoot)) {
      const sourceBytes = await readFile(file);
      const source = posix(path.relative(scenarioRoot, file));
      const metadata = `scenarios/${source.slice(0, -path.extname(source).length)}.json`;
      const parsed = parseScenario(sourceBytes.toString("ascii"));
      const stem = path.basename(file, path.extname(file));
      const outcomes = [];
      for (const name of (await readdir(path.dirname(file))).sort()) {
        if (path.basename(name, path.extname(name)) !== stem || !/^\.\d{3}$/.test(path.extname(name))) continue;
        const bytes = await readFile(path.join(path.dirname(file), name));
        const briefing = parseMissionBriefing(bytes.toString("ascii"));
        outcomes.push({ reasonCode: Number(path.extname(name).slice(1)),
          source: { path: posix(path.relative(scenarioRoot, path.join(path.dirname(file), name))), sha256: sha256(bytes) },
          rawText: briefing.rawText, text: briefing.plainText });
      }
      enabledTeamCount += parsed.teams.filter(({ enabled }) => enabled !== 0).length;
      placementCount += parsed.placementRows.length;
      const destination = path.join(temporaryRoot, ...metadata.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(
        destination,
        `${JSON.stringify(
          { schemaVersion: 1, source: { path: source, sha256: sha256(sourceBytes) },
            rawScenario: sourceBytes.toString("base64"), ...parsed, outcomes },
          null,
          2,
        )}\n`,
      );
      const triggerSourcePath = file.slice(0, -path.extname(file).length) + ".TRO";
      const triggerMetadata = `triggers/${source.slice(0, -path.extname(source).length)}.json`;
      let triggers: string | null = null;
      try {
        const triggerSource = await readFile(triggerSourcePath);
        const triggerDestination = path.join(temporaryRoot, ...triggerMetadata.split("/"));
        await mkdir(path.dirname(triggerDestination), { recursive: true });
        await writeFile(
          triggerDestination,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              source: {
                path: source.slice(0, -path.extname(source).length) + ".TRO",
                sha256: sha256(triggerSource),
              },
              blocks: parseTriggerScript(triggerSource.toString("ascii")),
            },
            null,
            2,
          )}\n`,
        );
        triggers = triggerMetadata;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const messageSourcePath = file.slice(0, -path.extname(file).length) + ".MSG";
      const messageMetadata = `messages/${source.slice(0, -path.extname(source).length)}.json`;
      let messages: string | null = null;
      try {
        const messageSource = await readFile(messageSourcePath);
        const messageDestination = path.join(temporaryRoot, ...messageMetadata.split("/"));
        await mkdir(path.dirname(messageDestination), { recursive: true });
        await writeFile(
          messageDestination,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              source: {
                path: source.slice(0, -path.extname(source).length) + ".MSG",
                sha256: sha256(messageSource),
              },
              messages: parseMissionMessages(messageSource.toString("ascii")),
            },
            null,
            2,
          )}\n`,
        );
        messages = messageMetadata;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const briefingSourcePath = file.slice(0, -path.extname(file).length) + ".TXT";
      const briefingMetadata = `briefings/${source.slice(0, -path.extname(source).length)}.json`;
      let briefing: string | null = null;
      try {
        const briefingSource = await readFile(briefingSourcePath);
        const briefingDestination = path.join(temporaryRoot, ...briefingMetadata.split("/"));
        await mkdir(path.dirname(briefingDestination), { recursive: true });
        await writeFile(
          briefingDestination,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              source: {
                path: source.slice(0, -path.extname(source).length) + ".TXT",
                sha256: sha256(briefingSource),
              },
              ...parseMissionBriefing(briefingSource.toString("ascii")),
            },
            null,
            2,
          )}\n`,
        );
        briefing = briefingMetadata;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      scenarioFiles.push({ source, metadata, triggers, messages, briefing });
    }

    const index: DataExtractionIndex = {
      schemaVersion: 1,
      unitCount: units.length,
      weaponCount: weapons.length,
      dependencyCount: dependencies.length,
      scenarioCount: scenarioFiles.length,
      enabledTeamCount,
      placementCount,
      files: {
        units: "units.json",
        weapons: "weapons.json",
        dependencies: "dependencies.json",
        damageMatrix: "damage-matrix.json",
        scenarios: scenarioFiles,
      },
    };
    await writeFile(path.join(temporaryRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await rename(temporaryRoot, outputRoot);
    return index;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
