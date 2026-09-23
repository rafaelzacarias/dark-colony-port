"""Original scanner/constructor evidence for browser type-37 placement."""

import json
import hashlib
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
PLACEMENT = runpy.run_path(str(ROOT / "tools/research/scenario-placement-20260919.py"))
RESOURCE = runpy.run_path(str(ROOT / "tools/qa/source-resource-options-native.py"))
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_ESI, UC_X86_REG_EDI,
                              UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP,
                              UC_X86_REG_GDTR, UC_X86_REG_CS, UC_X86_REG_DS,
                              UC_X86_REG_ES, UC_X86_REG_SS)


def full_loader(name):
    data, races, rows = PLACEMENT["source"](name)
    native = RESOURCE["CONSTRUCTION"]["source_fixture"](RESOURCE["IMAGE"])
    game, frame = RESOURCE["BASE"]["GAME"], 0x70D800
    native.emulator.mem_write(0x707000, bytes(8) + bytes.fromhex("ffff0000009acf00ffff00000092cf00"))
    native.emulator.reg_write(UC_X86_REG_GDTR, (0, 0x707000, 23, 0))
    native.emulator.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
        native.emulator.reg_write(register, 16)
    native.emulator.mem_write(game, bytes(0x471B0))
    native.emulator.mem_map(0xC00000, 0x200000)
    native.put(game + 0x46F2C, 0xC00000)
    native.put(0xC9A4B0, 128)
    native.put(0xC9A4B4, 128)
    for tile_y in range(128):
        for offset, base, stride in ((4, 0xC10000, 512), (0x804, 0xC20000, 512),
                                     (0xC04, 0xC30000, 256), (0x1004, 0xC40000, 256)):
            native.put(0xC00000 + offset + tile_y * 4, base + tile_y * stride)
    native.emulator.mem_write(0xC20000, struct.pack("<I", 1023) * 128 * 128)
    for base in (0xC30000, 0xC40000):
        native.emulator.mem_write(base, struct.pack("<H", 1023) * 128 * 128)
    configuration = 0x850000
    native.run(0x429952, {RESOURCE["UC_X86_REG_EDX"]: configuration,
                        RESOURCE["UC_X86_REG_ECX"]: configuration}, 0x4299CD)
    RESOURCE["PRODUCTION"]["load_configuration_header"](native, configuration, races[0])
    native.run(0x419D60, {})
    native.put(frame - 8, configuration)
    native.put(frame - 0x14, 0)
    native.put(game + 0x544, configuration)
    native.put(game + 0x7D20, 152)
    native.put(game + 0x7D18, 0x704000)
    native.put(0x495710, 256)
    native.put(0x495740, 256)
    lines = iter(line.strip() for line in data.decode("ascii").splitlines()
                 if line.strip() and not line.lstrip().startswith("%"))

    def read_line(machine):
        line = next(lines, None)
        if line is not None:
            machine.emulator.mem_write(machine.emulator.reg_read(UC_X86_REG_EAX), line.encode() + b"\0")
        machine.emulator.reg_write(UC_X86_REG_EAX, int(line is not None))

    native.stubs.pop(0x46CB74, None)
    external = {0x43C388: None, 0x40B030: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 0),
                0x40601C: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 1),
                0x435F30: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 0xC00000),
                0x43FB90: None, 0x44D6F0: None, 0x445570: None, 0x41E7D8: None,
                0x444F14: None, 0x406560: None, 0x40636C: None, 0x44AC28: None, 0x437BC4: None,
                0x41B8AC: read_line, 0x41B864: read_line}
    native.stubs.update(external)
    records, pending = [], {}

    def observe(emulator, address, size, user_data):
        if address == 0x41C453:
            pending.update(sourceRow=len(records), before=emulator.reg_read(UC_X86_REG_EDI), calls=[],
                           buffer=bytes(emulator.mem_read(game, 0x471B0)))
        if pending and address in (0x41AF14, 0x43FD50, 0x440410, 0x4404C0):
            pending["calls"].append(hex(address))
        if pending and address == 0x41C438:
            before = pending.pop("buffer")
            after = bytes(emulator.mem_read(game, 0x471B0))
            pending.update(after=emulator.reg_read(UC_X86_REG_EDI),
                           row=list(map(int, rows[pending["sourceRow"]].split())),
                           changedGameOffsets=[offset for offset, (old, new) in enumerate(zip(before, after)) if old != new])
            if "0x41af14" in pending["calls"]:
                offset = 0x7D28 + pending["before"] * 220
                pending.update(slot=pending["before"], entityHex=after[offset:offset + 220].hex())
            records.append(dict(pending))
            pending.clear()

    native.emulator.hook_add(UC_HOOK_CODE, observe)
    stack = RESOURCE["BASE"]["STACK"]
    native.put(stack, RESOURCE["BASE"]["STOP"])
    for register, value in ((UC_X86_REG_ESP, stack), (UC_X86_REG_EAX, 0x704000),
                            (UC_X86_REG_ESI, game), (UC_X86_REG_EBP, frame)):
        native.emulator.reg_write(register, value)
    native.emulator.emu_start(0x41B9CE, 0x41C7EE, count=2000000)
    assert native.emulator.reg_read(UC_X86_REG_EIP) == 0x41C7EE
    assert next(lines, None) is None and len(records) == len(rows)
    queues = []
    for index in range(native.get(0x4796B4)):
        tile_x, tile_y, count, *types = struct.unpack("<13i", native.emulator.mem_read(0x4FE454 + index * 52, 52))
        queues.append(dict(tileX=tile_x, tileY=tile_y, types=types[:count]))
    stream = PLACEMENT["stream"](name)
    assert [record.get("slot") for record in records] == [record.get("slot") for record in stream["records"]]
    for record, bounded in zip(records, stream["records"]):
        if "slot" in record:
            raw, expected = bytes.fromhex(record["entityHex"]), bytes.fromhex(bounded["entityHex"])
            assert raw[:2] + raw[4:8] + raw[12:16] + raw[44:45] + raw[203:204] == expected[:2] + expected[4:8] + expected[12:16] + expected[44:45] + expected[203:204]
    return dict(name=name, sourceSha256=hashlib.sha256(data).hexdigest(), entry="0x41b9ce..0x41c7ee",
                boundaries=[hex(address) for address in external], records=records, queues=queues,
                spy=[native.get(game + team * 0xE30 + 0xBE4) for team in range(8)],
                selector6=native.get(0x4956E0 + 6 * 4), loaderGate=native.get(frame - 0x14),
                nextSlot=native.get(game + 0x7D20))


if __name__ == "__main__":
    mission = PLACEMENT["stream"]("HUMAN07")
    markers = [record for record in mission["records"] if record["row"][2] == 37]
    assert markers
    assert all(record["nativeFields"][2:4] == [37, 8] for record in markers)
    assert all(record["after"] == record["before"] + 1 for record in markers)
    names = ["HUMAN07", "HUMAN08", "HUMAN09", "HUMAN12", "HUMAN13",
             "ALIEN06", "ALIEN07", "ALIEN08", "ALIEN10", "ALIEN11", "ALIEN12", "ALIEN13"]
    print(json.dumps({"scope": "Unmodified full HUMAN07 loader with existing resource-harness external boundaries; actual placement allocator/FIFO and game-buffer differences, plus twelve complete original placement streams; not full game boot",
                      "mission": mission, "fullLoader": full_loader("HUMAN07"),
                      "missions": [PLACEMENT["stream"](name) for name in names]}, indent=2))