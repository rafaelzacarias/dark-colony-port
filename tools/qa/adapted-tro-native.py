"""Bounded original TRO parser/handler probes; no original game loop or UI."""

import importlib.util
import json
from pathlib import Path
import struct
import sys

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_EDX, UC_X86_REG_EDI, UC_X86_REG_ESI, UC_X86_REG_ESP

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("actions", Path(__file__).resolve().parents[1] / "research/mission-actions.py")
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)


def expression(source):
    machine = NATIVE.machine_for_probe()
    machine.mem_write(0x701000, source.encode("ascii") + b"\0")
    machine.mem_write(0x700000, struct.pack("<II", 0x702000, 0x701000))
    machine.mem_write(NATIVE.STACK, struct.pack("<I", 0x70D000))
    machine.reg_write(UC_X86_REG_EAX, 0x700000)
    machine.reg_write(UC_X86_REG_EDX, 0x700004)
    faults = []

    def boundary(emulator, address, size, data):
        if address in (0x43C548, 0x46CB3E):
            faults.append(hex(address))
            emulator.emu_stop()

    machine.hook_add(UC_HOOK_CODE, boundary)
    machine.emu_start(0x43C5B8, 0x70D000, count=100000)
    end = struct.unpack("<I", machine.mem_read(0x700000, 4))[0]
    code = bytes(machine.mem_read(0x702000, end - 0x702000))
    result = {"source": source, "bytecode": code.hex(), "faults": faults}
    if not faults:
        machine.mem_write(NATIVE.GAME + 0x7D28 + 152 * 220 + 6, bytes((8, 3)))
        machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
        machine.reg_write(UC_X86_REG_EDX, 0x702000)
        machine.reg_write(UC_X86_REG_EBX, 152)
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        machine.emu_start(0x43CF2C, 0x70D000, count=100000)
        result["result"] = machine.reg_read(UC_X86_REG_EAX)
    print(json.dumps(result))
    return result


print(json.dumps({"sha256": NATIVE.AUDIT.DIGEST}))
assert expression("((S==3)&&(t==8))")["result"] == 1
human09 = (NATIVE.ROOT / "raw_cd/DC/SCENARIO/HUMAN/HUMAN09.TRO").read_text().splitlines()[4].split(" ", 3)[3]
expression(human09)
for source in ("(b(1,3)&&==0)", "(1&&==0)", "(0&&==0)"):
    expression(source)

for keyword, entry, source in (
    ("reinforce", 0x43EB74, "0 59 9 69 1 0 3 2 2 0 0 0 0 0 0"),
    ("reinforce", 0x43EB74, "0 91 12 69 1 2 0 0 0 0 0 0"),
    ("reinforce2", 0x43EC8B, "3 0 65 8 1"),
    ("vision", 0x43F6F7, "0 0"),
    ("vision", 0x43F6F7, "0 5 1"),
    ("ally", 0x43F85D, "0 5 0"),
    ("dfiddle", 0x43F934, "1 6 1"),
    ("nopickup", 0x43F7CE, "6"),
    ("aimsg", 0x43EA40, "1 2 3 8"),
    ("exomoney", 0x43F642, "0 920"),
    ("exomoney", 0x43F642, "0 -1"),
):
    machine = NATIVE.parse(entry, source)
    record = bytes(machine.mem_read(NATIVE.ACTION, 28))
    print(json.dumps({"action": keyword, "source": source, "record": record.hex()}))
    if keyword.startswith("reinforce"):
        values = list(map(int, source.split()))
        for index in range(5):
            assert record[7 + index] == (values[3 + index * 2] if 3 + index * 2 < len(values) else 0)
            assert record[12 + index] == (values[4 + index * 2] if 4 + index * 2 < len(values) else 0)
    if keyword == "exomoney":
        assert record[5] == (int(source.split()[1]) & 255)

for index in range(4):
    table = struct.unpack("<I", NATIVE.READ(0x47936C + index * 4, 4))[0]
    callback = struct.unpack("<I", NATIVE.READ(table + 16, 4))[0]
    print(json.dumps({"selector": index + 1, "message_callback": hex(callback)}))

for keyword, parser, handler, source, offset, expected in (
    ("ally", 0x43F85D, 0x43D9D0, "0 5 0", 0x46F34 + 5, 0),
    ("dfiddle", 0x43F934, 0x43DA8D, "1 6 1", 0xE30 + 0x193C + 6, 1),
    ("nopickup", 0x43F7CE, 0x43DA6F, "6", 6 * 0xE30 + 0xBB4, 1),
    ("vision", 0x43F6F7, 0x43DA31, "0 5 1", None, None),
):
    machine = NATIVE.parse(parser, source)
    machine.mem_write(NATIVE.GAME + 0x471A0, struct.pack("<II", 0x708000, 0x708100))
    machine.mem_write(NATIVE.GAME + 0x46F34, bytes([1] * 100))
    machine.mem_write(0x708000, bytes([255] * 8))
    machine.reg_write(UC_X86_REG_ESI, NATIVE.ACTION)
    machine.reg_write(UC_X86_REG_EDI, NATIVE.GAME)
    machine.emu_start(handler, 0x43D822, count=10000)
    if offset is not None:
        assert machine.mem_read(NATIVE.GAME + offset, 1)[0] == expected
    if keyword == "ally":
        assert machine.mem_read(NATIVE.GAME + 0x46F34 + 50, 1)[0] == 1
        assert machine.mem_read(0x708000, 1)[0] == 223
        assert machine.mem_read(0x708005, 1)[0] == 254
    if keyword == "vision":
        assert machine.mem_read(0x708100, 8) == bytes((32, 0, 0, 0, 0, 1, 0, 0))
    print(json.dumps({"handler": keyword, "verified": True}))

for selector, value in ((1, 4), (2, 4), (3, 8), (4, 1)):
    machine = NATIVE.parse(0x43EA40, f"1 2 {selector} {value}")
    machine.mem_write(NATIVE.GAME + 0xE30 + 0xBBC, struct.pack("<II", 3, 0x880000))
    machine.reg_write(UC_X86_REG_ESI, NATIVE.ACTION)
    machine.reg_write(UC_X86_REG_EDI, NATIVE.GAME)
    machine.emu_start(0x43D85E, 0x43D822, count=10000)
    offset = 0x6C14 + selector * 4
    assert struct.unpack("<i", machine.mem_read(0x880000 + offset, 4))[0] == value
    print(json.dumps({"handler": "aimsg", "selector": selector, "policy_offset": hex(offset), "value": value}))