"""Hash-gated native City and unit-row parsing across the unchanged SCN corpus."""

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_GDTR, UC_X86_REG_SS,
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EDI,
    UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
)

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("city_image", Path(__file__).with_name("transport-audit.py"))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
IMAGE, SECTIONS, READ = AUDIT.load_image(ROOT / "raw_cd/DC/DC.EXE")
GAME, FRAME, STACK = 0x800000, 0x70F000, 0x70E000
MAPPING = struct.unpack("<16i", READ(0x41AD90, 64))


def execute(team_index, race, base, source_lines):
    machine = Uc(UC_ARCH_X86, UC_MODE_32)
    machine.mem_map(0x400000, 0x200000)
    machine.mem_map(0x700000, 0x10000)
    machine.mem_map(GAME, 0x200000)
    machine.mem_write(0x700000, struct.pack("<3Q", 0, 0x00CF9A000000FFFF, 0x00CF92000000FFFF))
    machine.reg_write(UC_X86_REG_GDTR, (0, 0x700000, 23, 0))
    machine.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
        machine.reg_write(register, 16)
    for _, address, length, raw in SECTIONS:
        machine.mem_write(address, IMAGE[raw:raw + length])

    def put(address, value):
        machine.mem_write(address, struct.pack("<I", value & 0xFFFFFFFF))

    def get(address):
        return struct.unpack("<i", machine.mem_read(address, 4))[0]

    side = GAME + 0xB98 + team_index * 0xE30
    for type_index in range(106):
        put(0x4F18C4 + type_index * 280, 10000 + type_index)
        machine.mem_write(0x4F18B0 + type_index * 280, bytes(16))
    put(side + 0x20, race)
    put(side + 0x2C, base[0])
    put(side + 0x30, base[1])
    put(FRAME - 8, 0x900000)
    put(FRAME - 12, team_index)
    for register, value in ((UC_X86_REG_EBP, FRAME), (UC_X86_REG_ESP, STACK),
                            (UC_X86_REG_ESI, GAME), (UC_X86_REG_EDI, side)):
        machine.reg_write(register, value)
    reads, scanned, formats, scanned_unit_rows = [], [], [], []
    city_tail = []

    def hook(emulator, address, size, data):
        if address == 0x41B8AC:
            assert len(reads) < 9
            line = source_lines[len(reads)]
            reads.append(line)
            emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), line.encode("ascii") + b"\0")
            pointer = emulator.reg_read(UC_X86_REG_ESP)
            emulator.reg_write(UC_X86_REG_EIP, get(pointer))
            emulator.reg_write(UC_X86_REG_ESP, pointer + 4)
        elif address in (0x41C1D2, 0x41C1DF):
            value = emulator.reg_read(UC_X86_REG_EAX)
            scanned.append(value if value < 0x80000000 else value - 0x100000000)
        elif address == 0x41C1EF:
            pointer = get(FRAME - 0x7C)
            city_tail.append(bytes(emulator.mem_read(pointer, 128)).split(b"\0", 1)[0].decode("ascii").strip()
                             if pointer else "")
        elif address == 0x440DB2:
            pointer = emulator.reg_read(UC_X86_REG_ESP)
            assert get(pointer + 4) == FRAME - 0x47C
            format_pointer = get(pointer + 8)
            formats.append(bytes(emulator.mem_read(format_pointer, 32)).split(b"\0", 1)[0].decode("ascii"))
            assert [get(pointer + 12 + index * 4) for index in range(5)] == [
                FRAME - offset for offset in (0x78, 0x74, 0x70, 0x6C, 0x64)]
        elif address == 0x41C24E:
            assert emulator.reg_read(UC_X86_REG_EAX) == 5
            scanned_unit_rows.append([get(FRAME - offset) for offset in (0x78, 0x74, 0x70, 0x6C, 0x64)])

    machine.hook_add(UC_HOOK_CODE, hook)
    machine.emu_start(0x41C0CD, 0x41C289, count=1000000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x41C289
    assert reads == source_lines
    city = [int(value) for value in source_lines[0].split()]
    assert scanned == city[:10], (scanned, city)
    assert len(formats) == 8 and all(value.split() == ["%d"] * 5 for value in formats)
    unit_rows = [[int(value) for value in line.split()] for line in source_lines[1:]]
    assert scanned_unit_rows == unit_rows
    level_bytes = bytearray(106 * 16)
    for row_index, row in enumerate(unit_rows):
        type_index = MAPPING[race * 8 + row_index]
        level_bytes[type_index * 16 + team_index] = row[2]
        level_bytes[type_index * 16 + team_index + 8] = row[3]
    actual = b"".join(bytes(machine.mem_read(0x4F18B0 + type_index * 280, 16)) for type_index in range(106))
    assert actual == level_bytes
    return {"team": team_index, "race": race, "base": base, "city": city,
            "scanned": scanned, "unconsumedCity": city_tail[0], "lineReads": len(reads),
            "unitRows": unit_rows, "scannedUnitRows": scanned_unit_rows,
            "levelBytesSha256": hashlib.sha256(actual).hexdigest(),
            "health": [get(side + 0x3C + slot * 4) for slot in range(6)],
            "upgradeLevels": [get(side + 0xC4 + slot * 4) for slot in range(6)]}


def main():
    paths = sorted((ROOT / "raw_cd/DC/SCENARIO").rglob("*.SCN"))
    assert len(paths) == 108, len(paths)
    scenarios = []
    for path in paths:
        source = path.read_bytes()
        lines = [line.strip() for line in source.decode("ascii").splitlines()]
        teams = []
        for team_index in range(8):
            start = next(index for index, line in enumerate(lines) if line.startswith(f"TEAM {team_index} "))
            city = lines.index("%City", start)
            teams.append(execute(team_index, int(lines[start + 1]),
                                 [int(value) for value in lines[city - 1].split()], lines[city + 1:city + 10]))
        scenarios.append({"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(source).hexdigest(),
                          "bank": lines[0], "teams": teams})
    sentinel = ["1 -1 2 123 0 999 2 -1 1 0 2147483647 -2147483648"] + [
        f"{row + 10} {row + 20} {row % 3} {(row + 1) % 3} {row + 30}" for row in range(8)]
    synthetic = [execute(3, race, [76, 65], sentinel) for race in (0, 1)]
    print(json.dumps({"executableSha256": AUDIT.DIGEST,
                      "scope": "native integer scanner and CRT sscanf executed; line I/O supplied; mode 0; synthetic type HP 10000+type",
                      "mapping": [list(MAPPING[:8]), list(MAPPING[8:])],
                      "scenarios": scenarios, "synthetic": synthetic}, indent=2))


if __name__ == "__main__":
    main()