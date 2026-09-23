import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

export const pendingMoveHostInsertion = `          if (type === 25 && raw[0x36]) {
            const pendingFrame = { boundary: 0x4157ec as const, index, slot,
              registeredSlot: game.getInt16(0x468ec + index * 2, true), raw,
              rngCursor: mutable.rngCursor, task6Budget: mutable.task6Budget };
            const pending = resolveLegacyNativePendingMove(reduceLegacyNativePendingMove(pendingFrame), pendingFrame);
            raw.set(pending.raw); mutable.task6Budget = pending.task6Budget;
            continue;
          }
`;

export async function loadPendingMoveTestHost(): Promise<typeof import("../../../src/engine/native-registered-host")> {
  const url = new URL("../../../src/engine/native-registered-host.ts", import.meta.url);
  const source = readFileSync(url, "utf8");
  const anchor = "        if ((type === 25 || troopRoute) && opcode === 6 && binding.groundRoute) {\n";
  assert.equal(source.split(anchor).length, 2, "pending7 test integration requires the exact task6 owner");
  const integrated = 'import { reduceLegacyNativePendingMove, resolveLegacyNativePendingMove } from "./legacy-native-pending-move";\n'
    + source.replace(anchor, anchor + pendingMoveHostInsertion);
  const compiled = ts.transpileModule(integrated, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext } }).outputText.replace(/from "(\.[^"]+)"/g,
    (_match, path: string) => `from "${new URL(path + ".ts", url).href}"`);
  return import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
}