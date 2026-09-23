export interface MissionMessage {
  readonly id: number;
  readonly text: string;
}

export class MessageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageFormatError";
  }
}

export function parseMissionMessages(text: string): readonly MissionMessage[] {
  const lines = text.split(/\r?\n/);
  const messages: MissionMessage[] = [];
  let currentId: number | null = null;
  let content: string[] = [];
  const flush = () => {
    if (currentId === null) return;
    while (content[0]?.trim() === "") content.shift();
    while (content.at(-1)?.trim() === "") content.pop();
    messages.push({ id: currentId, text: content.join("\n").trim() });
    content = [];
  };
  for (const line of lines) {
    const header = line.trim().match(/^text\s+(\d+)\.?$/i);
    if (header) {
      flush();
      currentId = Number(header[1]);
    } else if (currentId === null) {
      if (line.trim() !== "") throw new MessageFormatError(`content precedes first text header: ${line}`);
    } else {
      content.push(line);
    }
  }
  flush();
  const ids = new Set<number>();
  for (const message of messages) {
    if (ids.has(message.id)) throw new MessageFormatError(`duplicate text ${message.id}`);
    if (message.text === "") throw new MessageFormatError(`text ${message.id} is empty`);
    ids.add(message.id);
  }
  return messages;
}
