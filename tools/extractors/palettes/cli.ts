import path from "node:path";
import { extractIndexedAssets } from "./extract";

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  let source = "raw_cd/DC";
  let output = "public/assets/generated/indexed";
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help") {
      console.log("Usage: npm run extract-indexed -- [--source <DC directory>] [--output <indexed directory>]");
      return;
    }
    const value = argumentsList[++index];
    if (!value || (argument !== "--source" && argument !== "--output")) throw new Error(`Invalid option: ${argument}`);
    if (argument === "--source") source = value;
    else output = value;
  }
  const result = await extractIndexedAssets(source, output);
  console.log(`Published ${path.resolve(output)}`);
  console.log(`Palettes: ${result.paletteCount}; terrain banks: ${result.terrainBankCount}; tiles: ${result.tileCount}`);
  console.log(`Sprite archives: ${result.archiveCount}; frames: ${result.frameCount}; empty: ${result.emptyFrameCount}`);
  console.log(`FIN: ${result.animationCount}/${result.animationFileCount}; missions: ${result.missions.length}; hashed outputs: ${result.outputs.length}`);
  for (const diagnostic of result.diagnostics) console.log(`${diagnostic.code}: ${diagnostic.source}: ${diagnostic.message}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});