export interface ScenarioTeam {
  readonly index: number;
  readonly enabled: number;
  readonly race: number;
  readonly money: number;
  readonly ai: number;
  readonly teamColor: number;
  readonly dependencies: readonly number[];
  readonly allies: readonly number[];
  readonly aiSlots: readonly number[];
  readonly coordinateRows: readonly [readonly number[], readonly number[]];
  readonly cityRows: readonly (readonly number[])[];
}

export interface ScenarioDefinition {
  readonly terrainBank: string;
  readonly id: string;
  readonly title: string;
  readonly rawHeader: readonly string[];
  readonly teams: readonly ScenarioTeam[];
  readonly placementRows: readonly (readonly number[])[];
}

export class ScenarioFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioFormatError";
  }
}

function integerList(line: string, context: string): number[] {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.some((token) => !/^-?\d+$/.test(token))) {
    throw new ScenarioFormatError(`${context} contains non-integer values: ${line}`);
  }
  return tokens.map(Number);
}

function terminated(line: string, context: string): number[] {
  const values = integerList(line, context);
  if (values.at(-1) !== -1) throw new ScenarioFormatError(`${context} lacks -1 terminator`);
  return values.slice(0, -1);
}

export function parseScenario(text: string): ScenarioDefinition {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  while (lines.at(-1) === "") lines.pop();
  const firstTeam = lines.findIndex((line) => /^TEAM\s+/.test(line));
  if (firstTeam < 8 || lines.slice(8, firstTeam).some((line) => line !== "")) {
    throw new ScenarioFormatError(`SCN expected 8 header lines followed by blank separators; first team is ${firstTeam}`);
  }
  const header = lines.slice(0, 8);
  const teams: ScenarioTeam[] = [];
  let cursor = firstTeam;
  for (let teamNumber = 0; teamNumber < 8; teamNumber += 1) {
    while (lines[cursor] === "") cursor += 1;
    const teamHeader = lines[cursor++]?.match(/^TEAM\s+(\d+)\s+(-?\d+)$/);
    if (!teamHeader) throw new ScenarioFormatError(`missing TEAM ${teamNumber}`);
    const index = Number(teamHeader[1]);
    if (index !== teamNumber) throw new ScenarioFormatError(`expected TEAM ${teamNumber}; found ${index}`);
    const enabled = Number(teamHeader[2]);
    const scalar = (marker: string): number => {
      const values = integerList(lines[cursor++], `TEAM ${index} ${marker}`);
      if (lines[cursor++] !== marker) throw new ScenarioFormatError(`TEAM ${index} missing ${marker}`);
      if (values.length !== 1) throw new ScenarioFormatError(`TEAM ${index} ${marker} must be scalar`);
      return values[0];
    };
    const race = scalar("%Race");
    const money = scalar("%Money");
    const ai = scalar("%AI");
    const teamColor = scalar("%TeamColour");
    const dependencies = terminated(lines[cursor++], `TEAM ${index} dependencies`);
    if (lines[cursor++] !== "%Depend") throw new ScenarioFormatError(`TEAM ${index} missing %Depend`);
    const allies = terminated(lines[cursor++], `TEAM ${index} allies`);
    if (lines[cursor++] !== "%TeamAllies") throw new ScenarioFormatError(`TEAM ${index} missing %TeamAllies`);
    const aiSlots = terminated(lines[cursor++], `TEAM ${index} AI slots`);
    if (lines[cursor++] !== "%AISlots") throw new ScenarioFormatError(`TEAM ${index} missing %AISlots`);
    const coordinateRows = [
      integerList(lines[cursor++], `TEAM ${index} AI slot 0`),
      integerList(lines[cursor++], `TEAM ${index} AI slot 1`),
    ] as const;
    if (lines[cursor++] !== "%City") throw new ScenarioFormatError(`TEAM ${index} missing %City`);
    const cityRows = Array.from({ length: 9 }, (_, row) =>
      integerList(lines[cursor++], `TEAM ${index} city row ${row}`),
    );
    teams.push({
      index,
      enabled,
      race,
      money,
      ai,
      teamColor,
      dependencies,
      allies,
      aiSlots,
      coordinateRows,
      cityRows,
    });
  }
  const placementRows = lines
    .slice(cursor)
    .filter((line) => line !== "")
    .map((line, index) => integerList(line, `placement ${index}`));
  return {
    terrainBank: header[0],
    id: header[1],
    title: header[2],
    rawHeader: header.slice(3),
    teams,
    placementRows,
  };
}
