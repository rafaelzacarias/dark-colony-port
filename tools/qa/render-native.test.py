"""Execute original FIN placement, timing and ordering instructions with Unicorn."""

import hashlib
import json
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDI, UC_X86_REG_EDX, UC_X86_REG_EIP, UC_X86_REG_ESI,
    UC_X86_REG_ESP,
)

ROOT = Path(__file__).resolve().parents[2]
IMAGE = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(IMAGE).hexdigest() == "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"
PE = struct.unpack_from("<I", IMAGE, 0x3C)[0]
BASE = struct.unpack_from("<I", IMAGE, PE + 52)[0]
SECTION_COUNT = struct.unpack_from("<H", IMAGE, PE + 6)[0]
OPTIONAL_SIZE = struct.unpack_from("<H", IMAGE, PE + 20)[0]


def machine():
    emulator = Uc(UC_ARCH_X86, UC_MODE_32)
    emulator.mem_map(0x400000, 0x200000)
    emulator.mem_map(0x700000, 0x10000)
    for index in range(SECTION_COUNT):
        offset = PE + 24 + OPTIONAL_SIZE + index * 40
        _, address, size, raw = struct.unpack_from("<IIII", IMAGE, offset + 8)
        flags = struct.unpack_from("<I", IMAGE, offset + 36)[0]
        if not flags & 0x80 and size:
            emulator.mem_write(BASE + address, IMAGE[raw:raw + size])
    emulator.reg_write(UC_X86_REG_ESP, 0x70E000)
    emulator.reg_write(UC_X86_REG_EBP, 0x70F000)
    return emulator


for field in (0, 1, 6, 13, 15, 20, 60, 100, 140, 250, 65535):
    emulator = machine()
    emulator.reg_write(UC_X86_REG_EDI, 0)
    emulator.reg_write(UC_X86_REG_EAX, 0x701000)
    emulator.mem_write(0x70F062, struct.pack("<I", 0x701000))
    emulator.mem_write(0x701000, struct.pack("<HH", 1, field))
    emulator.emu_start(0x425B21, 0x425B6F, count=1000)
    actual = emulator.mem_read(0x701002, 1)[0]
    signed = (field or 15) if field < 32768 else field - 65536
    expected = int((signed + 3) * 15 / 100) & 255
    assert actual == expected, (field, actual, expected)
    print(json.dumps({"field2": field, "native_countdown": actual}))

for name in ("TRSC", "GRAY"):
    animation = json.loads((ROOT / f"public/assets/generated/animations/{name}.json").read_text())
    atlas = json.loads((ROOT / f"public/assets/generated/sprites/SPRITES/{name}.json").read_text())
    child = animation["timeline"][0]["children"][0]
    frame = atlas["frames"][child["frame"]]
    emulator = machine()
    emulator.reg_write(UC_X86_REG_ECX, 0x701000)
    emulator.mem_write(0x701006, struct.pack("<hh", child["x"], child["y"]))
    emulator.emu_start(0x425D1C, 0x425D3A, count=1000)
    runtime_x, runtime_y = struct.unpack("<hh", emulator.mem_read(0x701006, 4))
    assert (runtime_x, runtime_y) == (child["x"] * 8, -child["y"] * 8)
    emulator.reg_write(UC_X86_REG_EDI, 0x702000)
    emulator.reg_write(UC_X86_REG_ECX, 300 + child["x"])
    emulator.reg_write(UC_X86_REG_ESI, 300 + child["y"])
    emulator.mem_write(0x702000, struct.pack("<HHHH", frame["width"], frame["height"], frame["anchorX"], frame["anchorY"]))
    emulator.emu_start(0x4611C8, 0x4611DD, count=1000)
    actual_x = struct.unpack("<i", emulator.mem_read(0x70EFFC, 4))[0]
    emulator.emu_start(0x4611ED, 0x4611F5, count=1000)
    actual_y = emulator.reg_read(UC_X86_REG_ESI)
    expected = (300 + child["x"] + frame["anchorX"], 300 + child["y"] - frame["height"])
    assert (actual_x, actual_y) == expected
    print(json.dumps({"sprite": name, "native_body_top_left_relative": [actual_x - 300, actual_y - 300]}))

for left, right, expected_sign in ((0, 1, 1), (1, 0, -1), (2, 0, 1), (0, 0, 0)):
    emulator = machine()
    emulator.mem_write(0x701000, struct.pack("<II", 0x702000, 0x703000))
    emulator.mem_write(0x702015, bytes((left,)))
    emulator.mem_write(0x703015, bytes((right,)))
    emulator.mem_write(0x70E000, struct.pack("<I", 0x70D000))
    emulator.reg_write(UC_X86_REG_EAX, 0x701000)
    emulator.reg_write(UC_X86_REG_EDX, 0x701004)
    emulator.emu_start(0x454590, 0x70D000, count=1000)
    assert emulator.reg_read(UC_X86_REG_EIP) == 0x70D000
    result = emulator.reg_read(UC_X86_REG_EAX)
    signed = result if result < 0x80000000 else result - 0x100000000
    assert (signed > 0) - (signed < 0) == expected_sign
emulator = machine()
emulator.mem_write(0x701000, bytes(range(256)))
emulator.mem_write(0x702000, bytes((7, 11, 23)))
emulator.mem_write(0x70E000, struct.pack("<I", 0x70D000))
emulator.reg_write(UC_X86_REG_EAX, 0x701000)
emulator.reg_write(UC_X86_REG_ESI, 0x702000)
emulator.reg_write(UC_X86_REG_EDI, 0x703003)
emulator.emu_start(0x4658B9, 0x70D000, count=1000)
assert bytes(emulator.mem_read(0x703000, 5)) == bytes((0, 23, 11, 7, 0))
print("PASS native mirror writer: width=3 writes x+1..x+3 in reverse source order")
print("PASS native FIN duration, loader offsets, body placement, and layer comparator")