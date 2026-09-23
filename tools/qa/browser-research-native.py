"""Bounded read-only disassembly of original team spy-field references."""

import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_EIP

ROOT = Path(__file__).resolve().parents[2]
SOURCE = runpy.run_path(str(ROOT / "tools/research/construction-lifecycle-20260919.py"))
image = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(image).hexdigest() == SOURCE["BASE"]["EXE_HASH"]
native = SOURCE["BASE"]["Native"](image)
decoder = Cs(CS_ARCH_X86, CS_MODE_32)
decoder.detail = True
decoder.skipdata = True
instructions = list(decoder.disasm(bytes(native.emulator.mem_read(0x401000, 0x78000)), 0x401000))
references = []
for index, instruction in enumerate(instructions):
    if instruction.id and any(operand.type == 3 and operand.mem.disp == 0xBE4 for operand in instruction.operands):
        references.append({"address": hex(instruction.address), "context": [
            f"{entry.address:#x}: {entry.mnemonic} {entry.op_str}"
            for entry in instructions[max(0, index - 12):index + 13]
        ]})
assert references, "No native spy references found"
CITY = runpy.run_path(str(ROOT / "tools/research/scenario-city-layout.py"))
types, _, _ = SOURCE["parsed_source"](image)
cases = []
assert 0xB98 + 0x3C + 4 * 4 == 0xBE4
for race in (0, 1):
    source_health = struct.unpack_from("<i", types, (22 if race == 0 else 34) * 280 + 0x44)[0]
    assert source_health == 3600
    for level, health in ((0, source_health), (1, source_health), (1, 1), (1, 0)):
        city = CITY["execute"](3, race, [24, 8], [
            f"1 4800 1 2400 0 0 2 3600 {level} {health}"
        ] + ["0 0 0 0 0"] * 8)
        for idle in (0, 1):
            machine = SOURCE["BASE"]["Native"](image)
            game, actor, frame = SOURCE["GAME"], 0x701000, 0x702000
            machine.put(game + 3 * 0xE30 + 0xBE4, city["health"][4])
            machine.put(actor + 6, 6 if race == 0 else 14, 1)
            machine.put(actor + 7, 3, 1)
            machine.put(actor + 0x39, idle, 1)
            machine.put(frame - 4, game)
            machine.emulator.reg_write(UC_X86_REG_EDI, actor)
            machine.emulator.reg_write(UC_X86_REG_EBP, frame)
            def stop_gate(emulator, address, size, data):
                if address in (0x413330, 0x413360):
                    emulator.emu_stop()
            machine.emulator.hook_add(UC_HOOK_CODE, stop_gate)
            machine.emulator.emu_start(0x413306, 0, count=100)
            endpoint = machine.emulator.reg_read(UC_X86_REG_EIP)
            assert endpoint in (0x413330, 0x413360)
            eligible = endpoint == 0x413360
            assert eligible == (city["health"][4] != 0 and idle == 1)
            cases.append({"race": race, "cityLevel": level, "declaredHealth": health,
                          "nativeSlot4Health": city["health"][4], "idle": idle, "eligible": eligible})
print(json.dumps({"executableSha256": hashlib.sha256(image).hexdigest(),
                  "scope": "Native City scanner plus bounded original collector predicate; no full construction/render/frame cadence claim",
                  "spyField": "team+0xbd4+4*4 == team+0xbe4: signed dword Research Center health, not a separate byte",
                  "references": references, "cases": cases}, indent=2))