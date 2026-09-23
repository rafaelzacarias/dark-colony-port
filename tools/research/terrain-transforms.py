"""Execute original DC.EXE terrain blitters; requires Capstone 5 and Unicorn 2."""

import argparse
import hashlib
import json
from pathlib import Path
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDI, UC_X86_REG_EDX, UC_X86_REG_EIP, UC_X86_REG_ESI,
    UC_X86_REG_ESP,
)


DIGEST = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"
BACKGROUND = 0x700000
FOREGROUND = 0x701000
MASK = 0x702000
LIGHT = 0x703000
DESTINATION = 0x704000
REMAP = 0x710000
STACK = 0x72F000
STOP = 0x72FF00
PITCH = 48


def load_image(path):
    image = path.read_bytes()
    assert hashlib.sha256(image).hexdigest() == DIGEST, "Unrecognized executable"
    pe = struct.unpack_from("<I", image, 0x3C)[0]
    section_count = struct.unpack_from("<H", image, pe + 6)[0]
    optional_size = struct.unpack_from("<H", image, pe + 20)[0]
    base = struct.unpack_from("<I", image, pe + 52)[0]
    sections = []
    for index in range(section_count):
        offset = pe + 24 + optional_size + 40 * index
        _, rva, size, raw = struct.unpack_from("<IIII", image, offset + 8)
        flags = struct.unpack_from("<I", image, offset + 36)[0]
        if not flags & 0x80:
            sections.append((base + rva, image[raw:raw + size]))
    return sections


def machine_for(sections):
    machine = Uc(UC_ARCH_X86, UC_MODE_32)
    machine.mem_map(0x400000, 0x200000)
    machine.mem_map(0x700000, 0x30000)
    for address, payload in sections:
        machine.mem_write(address, payload)
    return machine


def write_word(machine, address, value):
    machine.mem_write(address, struct.pack("<I", value))


def verify_attribute_consumers(sections):
    machine = machine_for(sections)
    frame = 0x728000
    cell = 0x708000
    output = 0x709000
    sprite = 0x70A000
    view = 0x70B000
    machine.reg_write(UC_X86_REG_EBP, frame)
    machine.reg_write(UC_X86_REG_ESP, STACK)
    write_word(machine, frame - 0x38, MASK)
    write_word(machine, frame - 4, cell)
    machine.mem_write(sprite + 2, struct.pack("<H", 73))
    for attribute in range(1024):
        packed = 1 | (2 << 11) | (attribute << 22)
        write_word(machine, cell, packed)
        machine.reg_write(UC_X86_REG_ECX, 0)
        machine.reg_write(UC_X86_REG_EDX, cell)
        machine.reg_write(UC_X86_REG_EDI, 0)
        machine.emu_start(0x4504DF, 0x45051B, count=100)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x45051B
        background_flip = struct.unpack("<I", machine.mem_read(frame - 0x20, 4))[0]
        foreground_flip = struct.unpack("<I", machine.mem_read(frame - 0x34, 4))[0]
        assert background_flip == ((attribute >> 5) & 1)
        assert foreground_flip == ((attribute >> 6) & 1)
        machine.reg_write(UC_X86_REG_ESI, view)
        write_word(machine, 0x4891F4, MASK + 128)
        machine.emu_start(0x45062F, 0x450654, count=100)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x450654
        assert machine.reg_read(UC_X86_REG_EDX) == 0
        assert machine.reg_read(UC_X86_REG_EAX) == ((attribute >> 5) & 3)
        for foreground_index in (0, 2):
            value = 1 | (foreground_index << 11) | (attribute << 22)
            write_word(machine, cell, value)
            write_word(machine, frame - 0x14, cell)
            machine.emu_start(0x45375F, 0x453776, count=100)
            actual = struct.unpack("<I", machine.mem_read(cell, 4))[0]
            expected = value if foreground_index else value & ~0x03C00000
            assert actual == expected
    for nibble in range(16):
        for local_y in range(32):
            write_word(machine, cell, 1 | (2 << 11) | (nibble << 22))
            write_word(machine, frame + 0x10, output)
            write_word(machine, frame - 8, sprite)
            machine.reg_write(UC_X86_REG_EAX, cell)
            machine.reg_write(UC_X86_REG_EBX, local_y)
            machine.reg_write(UC_X86_REG_ECX, 0)
            machine.emu_start(0x461120, 0x46115A, count=100)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x46115A
            actual = struct.unpack("<h", machine.mem_read(output, 2))[0]
            assert actual == 73 + 31 - local_y - 32 * nibble
    print("PASS original x86: 1024 packed attribute selectors, 2048 foreground-clear cases, 512 cutoff cases")


def run_blitter(sections, selector, foreground_present, axis):
    machine = machine_for(sections)
    background = bytes(1 + (column if axis == "x" else row)
                       for row in range(32) for column in range(32))
    foreground = bytes(129 + (column if axis == "x" else row)
                       if (column + 3 * row) % 7 < 3 else 0
                       for row in range(32) for column in range(32))
    background_flip = bool(selector & 1)
    foreground_flip = bool(selector & 2)
    masks = []
    for row in range(32):
        mask = 0
        for column in range(32):
            mask |= bool(foreground[row * 32 + column]) << (31 - column)
        masks.append(mask)
    machine.mem_write(BACKGROUND, background)
    machine.mem_write(FOREGROUND, foreground)
    machine.mem_write(MASK, struct.pack("<32I", *masks))
    machine.mem_write(REMAP, bytes(range(256)) * 256)
    machine.mem_write(DESTINATION, bytes([0xEE]) * (PITCH * 34))
    for address, value in (
        (0x4891E8, FOREGROUND), (0x4891EC, BACKGROUND),
        (0x4891F0, LIGHT), (0x4891F4, MASK),
        (0x4891F8, DESTINATION + PITCH), (0x4891FC, REMAP),
        (0x489200, 32), (0x489204, PITCH), (0x489214, 4),
    ):
        write_word(machine, address, value)
    table = 0x47C030 if foreground_present else 0x47C040
    slot = selector if foreground_present else selector & 1
    entry = struct.unpack("<I", machine.mem_read(table + 4 * slot, 4))[0]
    machine.reg_write(UC_X86_REG_ESP, STACK)
    write_word(machine, STACK, STOP)
    machine.emu_start(entry, STOP, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == STOP, "Blitter did not return"
    expected = bytearray([0xEE] * (PITCH * 34))
    for row in range(32):
        for column in range(32):
            background_column = 31 - column if background_flip else column
            foreground_column = 31 - column if foreground_flip else column
            value = foreground[row * 32 + foreground_column] if foreground_present else 0
            expected[(row + 1) * PITCH + column] = value or background[row * 32 + background_column]
    actual = bytes(machine.mem_read(DESTINATION, len(expected)))
    assert actual == expected, (hex(entry), axis, next(
        (index, observed, wanted) for index, (observed, wanted)
        in enumerate(zip(actual, expected)) if observed != wanted))
    return {"entry": hex(entry), "selector": slot, "foreground": foreground_present,
            "axis_fixture": axis, "pixels_verified": 1024, "guards_unchanged": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=Path(__file__).resolve().parents[2] / "raw_cd/DC/DC.EXE")
    args = parser.parse_args()
    sections = load_image(args.exe)
    print(f"SHA256 {DIGEST}")
    machine = machine_for(sections)
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    for start, end in ((0x4504E2, 0x4504ED), (0x450507, 0x45050D),
                       (0x45062F, 0x45065B), (0x461120, 0x46112B)):
        for instruction in decoder.disasm(bytes(machine.mem_read(start, end - start)), start):
            print(f"{instruction.address:#010x}: {instruction.mnemonic} {instruction.op_str}")
    verify_attribute_consumers(sections)
    for foreground_present in (False, True):
        for selector in range(4 if foreground_present else 2):
            for axis in ("x", "y"):
                print(json.dumps(run_blitter(sections, selector, foreground_present, axis)))
    print("PASS original x86: six terrain blitters, two coordinate fixtures each")


if __name__ == "__main__":
    main()