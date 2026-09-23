import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseScenario } from "../../extractors/data/scenario";

export const buildingUpgradeFundingLabel = "H07 source control: initial credits 10000 instead of 5500; no earned-funding claim; original city, placements, TRO and terrain unchanged";

export async function fundedBuildingUpgradeFetch(input: string | URL | Request): Promise<Response> {
  const path = String(input);
  const bytes = readFileSync(new URL(`../../../public${path}`, import.meta.url));
  if (!path.endsWith("/scenarios/HUMAN/HUMAN07.json") && !path.endsWith("/scenarios/ALIEN/ALIEN04.json")) return new Response(bytes);
  const envelope = JSON.parse(bytes.toString());
  const raw = Buffer.from(envelope.rawScenario, "base64").toString("latin1")
    .replace(/\d+(\r?\n%Money)/, "10000$1");
  return new Response(JSON.stringify({ ...envelope, ...parseScenario(raw),
    rawScenario: Buffer.from(raw, "latin1").toString("base64"),
    source: { ...envelope.source, sha256: createHash("sha256").update(raw, "latin1").digest("hex") } }));
}