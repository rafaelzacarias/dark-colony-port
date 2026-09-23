export interface TriggerAction {
  readonly name: string;
  readonly arguments: readonly (number | string)[];
  readonly raw: string;
}

export interface TriggerBlock {
  readonly id: number;
  readonly mode: string;
  readonly flag: number | null;
  readonly condition: string;
  readonly actions: readonly TriggerAction[];
}

export class TriggerFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggerFormatError";
  }
}

function argument(token: string): number | string {
  return /^-?\d+$/.test(token) ? Number(token) : token;
}

export function parseTriggerScript(text: string): readonly TriggerBlock[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const blocks: TriggerBlock[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    while (lines[cursor] === "") cursor += 1;
    if (cursor >= lines.length) break;
    const header = lines[cursor++]?.match(/^(\d+)\s+(\S+)(?:\s+(-?\d+))?\s+(\(.+)$/);
    if (!header) throw new TriggerFormatError(`invalid trigger header: ${lines[cursor - 1]}`);
    const actions: TriggerAction[] = [];
    let terminated = false;
    while (cursor < lines.length) {
      const raw = lines[cursor++];
      if (raw === "") continue;
      if (raw.toLowerCase() === "end") {
        terminated = true;
        break;
      }
      const tokens = raw.split(/\s+/);
      actions.push({
        name: tokens[0].toLowerCase(),
        arguments: tokens.slice(1).map(argument),
        raw,
      });
    }
    if (!terminated) throw new TriggerFormatError(`trigger ${header[1]} lacks end`);
    blocks.push({
      id: Number(header[1]),
      mode: header[2],
      flag: header[3] === undefined ? null : Number(header[3]),
      condition: header[4],
      actions,
    });
  }
  return blocks;
}
