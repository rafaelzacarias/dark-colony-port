export interface MissionBriefing {
  readonly rawText: string;
  readonly plainText: string;
  readonly objectives: readonly string[];
}

function normalizeText(text: string): string {
  return text.replace(/~\d/g, "").replace(/\r/g, "");
}

export function parseMissionBriefing(text: string): MissionBriefing {
  const rawText = text.replace(/\r/g, "").trim();
  const plainText = normalizeText(rawText).trim();
  const lines = plainText.split("\n");
  const objectiveHeader = lines.findIndex((line) => line.trim().toUpperCase() === "MISSION OBJECTIVES");
  const objectives: string[] = [];
  if (objectiveHeader >= 0) {
    for (const sourceLine of lines.slice(objectiveHeader + 1)) {
      const line = sourceLine.trim();
      if (line === "") continue;
      if (/^(?:\.\.\.|MIND LINK|TRANSMISSION)/i.test(line)) break;
      if (line.startsWith("-")) objectives.push(line.slice(1).trim());
      else if (objectives.length > 0) objectives[objectives.length - 1] += ` ${line}`;
    }
  }
  return { rawText, plainText, objectives };
}
