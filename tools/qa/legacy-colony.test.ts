import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectLegacyColony } from "../../src/engine/legacy-colony.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";

const root = new URL("../../", import.meta.url);
const executable = readFileSync(new URL("raw_cd/DC/DC.EXE", root));
const scenario = parseScenario(readFileSync(new URL("raw_cd/DC/SCENARIO/HUMAN/HUMAN01.SCN", root), "utf8"));
const units = parseUnitStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root), "utf8"));

function nativeBytes(address: number, hex: string): void {
  const expected = Buffer.from(hex, "hex");
  assert.deepEqual(executable.subarray(address - 0x400c00, address - 0x400c00 + expected.length), expected);
}

test("HUMAN01 City source and native loader distinguish level from HP", () => {
  assert.equal(createHash("sha256").update(executable).digest("hex"),
    "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.deepEqual(scenario.teams[1].coordinateRows, [[69, 65], [76, 65]]);
  assert.deepEqual(scenario.teams[1].cityRows[0], [1, 1000, 1, 1000, 0, -1, 0, -1, 0, -1]);
  nativeBytes(0x41c0f0, "85d27e39");
  nativeBytes(0x41c0fd, "83f8ff751b");
  nativeBytes(0x41c102, "4a89c8e8328b0200");
  nativeBytes(0x41c11d, "89433c8b55d84a89948fc4000000");
  nativeBytes(0x41c12d, "c7448f3c00000000c7848fc400000000000000");
  nativeBytes(0x444f77, "83783c007509c6412c00");
  nativeBytes(0x445064, "89410c");
  nativeBytes(0x4450d9, "c6412c01");
});

test("HUMAN01 projects actual reserved buildings, HP overrides, native positions and footprints", () => {
  const projection = projectLegacyColony(scenario.teams, units);
  assert.deepEqual([0, 1, 2, 3, 4].map((slot) => projection.buildingSlots[`1,${slot}`]), [1000, 1000, 0, 0, 0]);
  assert.equal(Object.keys(projection.buildingSlots).length, 40);
  assert.equal(Object.hasOwn(projection.buildingSlots, "1,5"), false);
  assert.deepEqual(projection.buildings.map(({ nativeId, unitType, health }) => [nativeId, unitType, health]),
    [[15, 16, 1000], [16, 17, 1000], [20, 81, 1]]);
  assert.deepEqual(projection.slots.filter(({ team, slot }) => team === 1 && slot < 5)
    .map(({ nativeId, upgradeLevel, health, slotState, entity }) =>
      [nativeId, upgradeLevel, health, slotState, entity?.nativeState ?? 0]),
  [[15, 0, 1000, 1, 1], [16, 0, 1000, 1, 1], [17, 0, 0, 0, 0], [18, 0, 0, 0, 0], [19, 0, 0, 0, 0]]);
  const [exco, barracks, connector] = projection.buildings;
  assert.deepEqual([exco.sprite, barracks.sprite], ["EXCOPOD", "BRRKPOD"]);
  assert.deepEqual([exco.maxHealth, barracks.maxHealth], [4800, 2400]);
  assert.deepEqual(exco.nativePosition, { x: 18944, y: 16760 });
  assert.deepEqual(exco.position, { x: 74, y: 65.46875 });
  assert.deepEqual(barracks.position, { x: 76, y: 65 });
  assert.deepEqual(exco.footprint, [{ x: 73, y: 65 }, { x: 74, y: 65 }, { x: 73, y: 66 }, { x: 74, y: 66 }]);
  assert.deepEqual(barracks.footprint, [{ x: 75, y: 64 }, { x: 76, y: 64 }, { x: 75, y: 63 }, { x: 76, y: 63 }]);
  assert.deepEqual(connector.position, { x: 76, y: 66 });
  assert.equal(connector.sprite, "TOWR");
  assert.equal(connector.maxHealth, 1600);
  assert.deepEqual(connector.footprint, []);
});

test("type, position and footprint tables match the native data section", () => {
  const types = [
    [16, 17, 18, 20, 22, 81], [16, 17, 19, 21, 22, 81],
    [28, 29, 30, 32, 34, 81], [28, 29, 31, 33, 34, 81],
  ];
  for (const [bank, expected] of types.entries()) {
    assert.deepEqual(expected.map((_, slot) => executable.readInt32LE(0x47afa8 - 0x402400 + bank * 60 + slot * 4)), expected);
  }
  const positions = [[-64, 15], [0, 0], [32, 64], [64, 10], [-32, 65], [0, 32]];
  for (const [slot, expected] of positions.entries()) {
    assert.deepEqual(expected.map((_, axis) => executable.readInt32LE(0x47ab70 - 0x402400 + slot * 8 + axis * 4)), expected);
  }
  const footprints = [
    [[-3, 0], [-2, 0], [-3, 1], [-2, 1]],
    [[-1, -1], [0, -1], [-1, -2], [0, -2]],
    [[0, 2], [1, 2], [0, 3], [1, 3]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[-1, 2], [-1, 3], [-2, 2], [-2, 3]],
  ];
  for (const [slot, points] of footprints.entries()) {
    for (let entry = 0; entry < 8; entry += 1) {
      assert.deepEqual([0, 1].map((axis) => executable.readInt32LE(0x47abe8 - 0x402400 + slot * 64 + entry * 8 + axis * 4)),
        points[Math.min(entry, 3)]);
    }
  }
  nativeBytes(0x41c07e, "8d4730508d472c50");
  nativeBytes(0x41c176, "837f2c007437837f30007431");
  nativeBytes(0x41c1a0, "c787d800000000000000c7475001000000");
  nativeBytes(0x444c4e, "8b848aa8af4700");
  nativeBytes(0x4450fa, "884107");
  nativeBytes(0x4182c1, "c68411100c000001");
  nativeBytes(0x4182e5, "595bc3");
  nativeBytes(0x445136, "83f9050f8414020000");
  nativeBytes(0x43d227, "668b8487d40b0000");
});

test("native Unicorn loader and initializer agree with the pure projection", () => {
  const syntheticUnits = units.map((unit) => ({ ...unit, health: 10000 + unit.index }));
  const variant = (race: number, base: readonly number[], city: readonly number[]) => ({
    ...scenario.teams[1], race, coordinateRows: [[3, 4], base] as const, cityRows: [city],
  });
  const fixtures = [
    ...scenario.teams,
    ...parseScenario(readFileSync(new URL("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN", root), "utf8")).teams,
    variant(0, [76, 65], [1, -1, 1, -1, 2, -1, 2, -1, 1, 12345, 2, 98765]),
    variant(1, [76, 65], [1, -1, 1, -1, 2, -1, 2, -1, 1, 12345, 0, 0]),
    variant(0, [76, 65], [1, -1, 1, -1, 2, -1, 2, -1, 1, 12345]),
    variant(1, [76, 65], [1, -1, 1, -1, 2, -1, 2, -1, 2, -1]),
    variant(0, [0, 65], [1, 10, 1, -1, 2, -1, 2, -1, 1, 20]),
    variant(0, [76, 0], [1, 10, 1, -1, 2, -1, 2, -1, 1, 20]),
    variant(0, [1, 255], [2, 0, 0, 999, 1, 99999, 2, -1, 1, 20]),
  ];
  const script = String.raw`
import importlib.util, json, struct, sys
from pathlib import Path
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP
sys.dont_write_bytecode = True
root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('audit', root / 'tools/research/transport-audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
image, sections, read = audit.load_image(root / 'raw_cd/DC/DC.EXE')
payload = json.load(sys.stdin)
game, frame, stack, stop = 0x800000, 0x70f000, 0x70e000, 0x70ff00
results = []
for team in payload['teams']:
    machine = Uc(UC_ARCH_X86, UC_MODE_32)
    machine.mem_map(0x400000, 0x200000)
    machine.mem_map(0x700000, 0x10000)
    machine.mem_map(game, 0x200000)
    for _, address, length, raw in sections:
        machine.mem_write(address, image[raw:raw + length])
    def put(address, value):
        machine.mem_write(address, struct.pack('<I', value & 0xffffffff))
    def word(address):
        return struct.unpack('<i', machine.mem_read(address, 4))[0]
    def returning():
        pointer = machine.reg_read(UC_X86_REG_ESP)
        machine.reg_write(UC_X86_REG_EIP, word(pointer))
        machine.reg_write(UC_X86_REG_ESP, pointer + 4)
    def hook(machine, address, size, data):
        if address == 0x41b8ac:
            machine.mem_write(machine.reg_read(UC_X86_REG_EAX),
                (' '.join(map(str, team['cityRows'][0])) + '\0').encode('ascii'))
            returning()
        elif address in (0x42630c, 0x412014, 0x437bc4):
            returning()
        elif address == 0x411dd8:
            machine.reg_write(UC_X86_REG_EAX, 0x701000)
            returning()
        elif address == 0x445136:
            machine.emu_stop()
    machine.hook_add(UC_HOOK_CODE, hook)
    for unit in payload['units']:
        put(0x4f18c4 + unit['index'] * 280, unit['health'])
    side = game + 0xb98 + team['index'] * 0xe30
    base_x, base_y = team['coordinateRows'][1]
    put(side + 0x20, team['race'])
    put(side + 0x2c, base_x)
    put(side + 0x30, base_y)
    put(frame - 8, 0x900000)
    put(frame - 12, team['index'])
    for register, value in ((UC_X86_REG_EBP, frame), (UC_X86_REG_ESP, stack),
                            (UC_X86_REG_ESI, game), (UC_X86_REG_EDI, side)):
        machine.reg_write(register, value)
    machine.emu_start(0x41c0cd, 0x41c1ef, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x41c1ef
    slots = []
    for slot in range(6):
        native_id = team['index'] * 15 + slot
        entity = game + 0x7d28 + native_id * 220
        put(stack, stop)
        for register, value in ((UC_X86_REG_ESP, stack), (UC_X86_REG_EAX, game),
                                (UC_X86_REG_EDX, team['index']), (UC_X86_REG_EBX, slot)):
            machine.reg_write(register, value)
        machine.emu_start(0x444f14, stop, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) in (stop, 0x445136)
        active = machine.mem_read(entity + 0x2c, 1)[0]
        if active:
            assert machine.reg_read(UC_X86_REG_ECX) == slot
        footprint = []
        if active and slot != 5:
            for entry in range(8):
                put(stack, stop)
                for register, value in ((UC_X86_REG_ESP, stack), (UC_X86_REG_EAX, slot),
                    (UC_X86_REG_EDX, entry), (UC_X86_REG_EBX, 0x702000), (UC_X86_REG_ECX, 0x702004)):
                    machine.reg_write(register, value)
                machine.emu_start(0x444de0, stop, count=10000)
                assert machine.reg_read(UC_X86_REG_EIP) == stop
                if machine.reg_read(UC_X86_REG_EAX) & 255 == 0:
                    break
                footprint.append([base_x + word(0x702000), base_y + word(0x702004)])
        trigger_value = None
        if slot < 5:
          machine.mem_write(0x704000, struct.pack('<hh', team['index'], slot))
          put(frame - 4, game)
          machine.reg_write(UC_X86_REG_EBP, frame)
          machine.reg_write(UC_X86_REG_ESI, 0x704004)
          machine.emu_start(0x43d209, 0x43cf53, count=100)
          assert machine.reg_read(UC_X86_REG_EIP) == 0x43cf53
          trigger_value = struct.unpack('<h', machine.mem_read(0x704000, 2))[0]
        slots.append(dict(nativeId=native_id, health=word(side + 0x3c + slot * 4), triggerValue=trigger_value,
            upgradeLevel=word(side + 0xc4 + slot * 4),
            slotState=machine.mem_read(side + 0x78 + slot, 1)[0], nativeState=active,
            unitType=machine.mem_read(entity + 6, 1)[0] if active else None,
            entityTeam=machine.mem_read(entity + 7, 1)[0] if active else None,
            entityHealth=word(entity + 12) if active else None,
            position=[struct.unpack('<H', machine.mem_read(entity + offset, 2))[0] for offset in (0, 4)] if active else None,
            footprint=footprint))
    results.append(slots)
print(json.dumps(results))
`;
  const native = JSON.parse(execFileSync("python3", ["-c", script, root.pathname], {
    input: JSON.stringify({ teams: fixtures, units: syntheticUnits }), encoding: "utf8",
    env: { ...process.env, PYTHONPATH: process.env.DC_COLONY_PYTHONPATH
      ?? "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
  const projected = fixtures.map((team) => projectLegacyColony([team], syntheticUnits).slots.map((slot) => ({
    nativeId: slot.nativeId, health: slot.health, upgradeLevel: slot.upgradeLevel,
    triggerValue: slot.slot < 5 ? (slot.health << 16) >> 16 : null,
    slotState: slot.slotState, nativeState: slot.entity?.nativeState ?? 0,
    unitType: slot.entity?.unitType ?? null, entityTeam: slot.entity?.team ?? null,
    entityHealth: slot.entity?.health ?? null,
    position: slot.entity ? [slot.entity.nativePosition.x, slot.entity.nativePosition.y] : null,
    footprint: slot.entity?.footprint.map(({ x, y }) => [x, y]) ?? [],
  })));
  assert.deepEqual(native, projected);
});

test("zero HP does not spawn an object, and default HP is not a presence flag", () => {
  const team = { ...scenario.teams[1], cityRows: [[1, -1, 2, 0, 0, 999, 0, -1, 0, -1]] };
  const projection = projectLegacyColony([team], units);
  assert.deepEqual(projection.slots.slice(0, 3).map(({ health, upgradeLevel, slotState, entity }) =>
    [health, upgradeLevel, slotState, entity?.unitType ?? null]), [[4800, 0, 1, 16], [0, 1, 0, null], [0, 0, 0, null]]);
  assert.deepEqual(projection.buildingSlots, { "1,0": 4800, "1,1": 0, "1,2": 0, "1,3": 0, "1,4": 0 });
});

test("projection rejects unsupported inputs and does not mutate source rows", () => {
  const original = JSON.stringify(scenario);
  projectLegacyColony(scenario.teams, units);
  assert.equal(JSON.stringify(scenario), original);
  const team = scenario.teams[1];
  assert.throws(() => projectLegacyColony([{ ...team, race: 2 }], units), /race/);
  assert.throws(() => projectLegacyColony([{ ...team, index: 8 }], units), /team/);
  assert.throws(() => projectLegacyColony([team, team], units), /duplicate/);
  assert.throws(() => projectLegacyColony([{ ...team, cityRows: [[3, 10, 0, -1, 0, -1, 0, -1, 0, -1]] }], units), /level/);
  assert.throws(() => projectLegacyColony([{ ...team, cityRows: [[1, -2, 0, -1, 0, -1, 0, -1, 0, -1]] }], units), /health/);
  assert.throws(() => projectLegacyColony([{ ...team, cityRows: [] }], units), /City pairs/);
  assert.throws(() => projectLegacyColony([{ ...team, coordinateRows: [[0, 0], [256, 1]] }], units), /base x/);
  assert.throws(() => projectLegacyColony([team], []), /missing colony unit/);
});