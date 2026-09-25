// Summarize a V8 .cpuprofile: top self-time and inclusive-time functions.
import { readFileSync } from "node:fs";

const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const nodes = new Map<number, any>(profile.nodes.map((node: any) => [node.id, node]));
const self = new Map<number, number>();
const deltas: number[] = profile.timeDeltas;
profile.samples.forEach((id: number, index: number) => self.set(id, (self.get(id) ?? 0) + (deltas[index] ?? 0)));
const parent = new Map<number, number>();
for (const node of nodes.values()) for (const child of node.children ?? []) parent.set(child, node.id);
const label = (node: any) => `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").slice(-2).join("/")}:${node.callFrame.lineNumber + 1}`;
const selfBy = new Map<string, number>(), inclusiveBy = new Map<string, number>();
for (const [id, time] of self) {
  selfBy.set(label(nodes.get(id)), (selfBy.get(label(nodes.get(id))) ?? 0) + time);
  const seen = new Set<string>();
  for (let cursor: number | undefined = id; cursor !== undefined; cursor = parent.get(cursor)) {
    const key = label(nodes.get(cursor));
    if (seen.has(key)) continue;
    seen.add(key);
    inclusiveBy.set(key, (inclusiveBy.get(key) ?? 0) + time);
  }
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = (map: Map<string, number>, count: number) => [...map].sort((a, b) => b[1] - a[1]).slice(0, count)
  .map(([key, time]) => `${(time / 1000).toFixed(0).padStart(7)}ms ${(100 * time / total).toFixed(1).padStart(5)}% ${key}`).join("\n");
console.log(`total ${(total / 1000).toFixed(0)}ms\n--- self\n${top(selfBy, Number(process.argv[3] ?? 25))}\n--- inclusive\n${top(inclusiveBy, Number(process.argv[4] ?? 45))}`);
