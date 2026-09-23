"""Read-only audit of legacy balance rows; executable evidence is opt-in."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct


ROOT = Path(__file__).resolve().parents[2]
EXE_SHA256 = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"


def rows(path):
    lines = [line.split() for line in path.read_text(encoding="ascii").splitlines()
             if line.strip() and not line.lstrip().startswith("%")]
    if len(lines[0]) != 1 or int(lines[0][0]) != len(lines) - 1:
        raise ValueError(f"{path}: declared count mismatch")
    return lines[1:]


def audit(game_root):
    table_root = game_root / "GAMESTAT"
    dependencies = []
    for tokens in rows(table_root / "DEPEND.TXT"):
        values = list(map(int, tokens))
        kind = values[3]
        start = 5 if kind == 1 else 7 if kind in (0, 2) else None
        if start is None or len(values) <= start or values[-1] != -1 or -1 in values[:-1]:
            raise ValueError(f"unsupported DEPEND row: {values}")
        dependencies.append({
            "id": values[0], "cost": values[1], "interfaceId": values[2],
            "kind": kind, "metadata": values[3:start],
            "prerequisites": values[start:-1], "rawTokens": values,
            "currentParserPrerequisites": values[7:-1],
        })
    units = rows(table_root / "GAMESTAT.TXT")
    weapons = rows(table_root / "WEAPSTAT.TXT")
    assert all(len(row) == 33 for row in units)
    assert all(len(row) == 13 for row in weapons)
    matrix_lines = [line.split() for line in (table_root / "MBULLET.TXT").read_text(encoding="ascii").splitlines()
                    if line.strip() and not line.lstrip().startswith("%")]
    columns, row_count = int(matrix_lines[0][0]), int(matrix_lines[1][0])
    matrix = [list(map(int, row)) for row in matrix_lines[2:]]
    assert len(matrix) == row_count and all(len(row) == columns for row in matrix)
    return {
        "sha256": {name: hashlib.sha256((table_root / name).read_bytes()).hexdigest()
                   for name in ("DEPEND.TXT", "GAMESTAT.TXT", "WEAPSTAT.TXT", "MBULLET.TXT")},
        "counts": {"units": len(units), "weapons": len(weapons),
                   "dependencies": len(dependencies),
                   "kinds": dict(Counter(row["kind"] for row in dependencies)),
                   "lostPrerequisiteRows": sum(row["prerequisites"] != row["currentParserPrerequisites"]
                                               for row in dependencies)},
        "dependencies": dependencies,
        "units": [{"index": index, "sprite": row[0], "armorUpgradePercentages": list(map(int, row[9:11])),
               "targetClass": int(row[11]), "health": int(row[12]),
               "rawTokens": row} for index, row in enumerate(units)],
        "weapons": [{"id": int(row[0]), "weaponClass": int(row[2]), "rateOfFire": int(row[4]),
                 "damage": int(row[5]), "rawTokens": row} for row in weapons],
        "damageMatrixPercentages": matrix,
    }


def verify_executable(path, report):
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
    from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX,
                                   UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_EDI,
                                   UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP)

    image = path.read_bytes()
    digest = hashlib.sha256(image).hexdigest()
    if digest != EXE_SHA256:
        raise ValueError(f"unrecognized executable SHA-256: {digest}")
    pe = struct.unpack_from("<I", image, 0x3C)[0]
    count = struct.unpack_from("<H", image, pe + 6)[0]
    optional_size = struct.unpack_from("<H", image, pe + 20)[0]
    base = struct.unpack_from("<I", image, pe + 52)[0]
    sections = []
    for index in range(count):
        offset = pe + 24 + optional_size + index * 40
        _, rva, size, raw = struct.unpack_from("<IIII", image, offset + 8)
        flags = struct.unpack_from("<I", image, offset + 36)[0]
        if not flags & 0x80:
            sections.append((base + rva, image[raw:raw + size]))

    def machine():
        emulator = Uc(UC_ARCH_X86, UC_MODE_32)
        emulator.mem_map(0x400000, 0x200000)
        emulator.mem_map(0x700000, 0x10000)
        for address, content in sections:
            emulator.mem_write(address, content)
        emulator.reg_write(UC_X86_REG_EBP, 0x70F000)
        emulator.reg_write(UC_X86_REG_ESP, 0x70E000)
        return emulator

    def put(emulator, address, value):
        emulator.mem_write(address, struct.pack("<i", value))

    def get(emulator, address):
        return struct.unpack("<i", emulator.mem_read(address, 4))[0]

    def run(emulator, start, end):
        emulator.emu_start(start, end, count=100000)
        assert emulator.reg_read(UC_X86_REG_EIP) == end, hex(emulator.reg_read(UC_X86_REG_EIP))

    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    emulator = machine()
    evidence = {}
    for label, start, end in [
        ("dependency_branch", 0x437A50, 0x437AC6),
        ("armor_reciprocals", 0x43BD46, 0x43BD89),
        ("damage_arithmetic", 0x4419DF, 0x441A12),
        ("projectile_lifetime", 0x43B935, 0x43B955),
        ("spawn_health", 0x41B339, 0x41B34C),
        ("matrix_conversion", 0x43B2C4, 0x43B2EA),
        ("firing_delay_selection", 0x413181, 0x4131A3),
    ]:
        evidence[label] = [f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}"
                           for instruction in decoder.disasm(bytes(emulator.mem_read(start, end - start)), start)]

    for row in report["dependencies"]:
        emulator = machine()
        source = " ".join(map(str, row["rawTokens"][1:])).encode("ascii") + b"\0"
        emulator.mem_write(0x701000, source)
        put(emulator, 0x70EFF0, 0x701000)
        emulator.reg_write(UC_X86_REG_EDI, row["id"])
        run(emulator, 0x4379F3, 0x437BA4)
        record = 0x4E6D70 + 52 * row["id"]
        assert get(emulator, record + 8) == row["cost"]
        assert get(emulator, record + 12) == row["interfaceId"]
        metadata = [get(emulator, record + 16 + index * 4) for index in range(len(row["metadata"]))]
        prerequisites = [get(emulator, record + 32 + index * 4) for index in range(len(row["prerequisites"]) + 1)]
        assert metadata == row["metadata"], row
        assert prerequisites == row["prerequisites"] + [-1], row

    emulator = machine()
    put(emulator, 0x70EFFC, 0x702000)
    run(emulator, 0x43BBC5, 0x43BCCC)
    stack = emulator.reg_read(UC_X86_REG_ESP)
    unit_offsets = [get(emulator, stack + 8 + index * 4) - 0x702000 for index in range(33)]
    assert unit_offsets[9:13] == [0x28, 0x2C, 0x40, 0x44], unit_offsets
    unit_offsets = [offset if 0 <= offset < 280 else None for offset in unit_offsets]

    emulator = machine()
    emulator.reg_write(UC_X86_REG_ESI, (0x702000 - 0x4F0200) // 8)
    run(emulator, 0x43B78B, 0x43B7CA)
    stack = emulator.reg_read(UC_X86_REG_ESP)
    weapon_offsets = [get(emulator, stack + 8 + index * 4) - 0x702000 for index in range(12)]
    weapon_offsets = [offset if 0 <= offset < 72 else None for offset in weapon_offsets]
    assert weapon_offsets == [None, 0, 4, 8, 12, 16, 20, 28, 32, 36, None, None], weapon_offsets

    for unit in report["units"]:
        emulator = machine()
        put(emulator, 0x4F18C4 + unit["index"] * 280, unit["health"])
        emulator.reg_write(UC_X86_REG_ECX, unit["index"] * 280)
        emulator.reg_write(UC_X86_REG_ESI, 0x702000)
        emulator.reg_write(UC_X86_REG_EBX, 0xFFFFFFFF)
        run(emulator, 0x41B339, 0x41B34C)
        assert get(emulator, 0x70200C) == unit["health"]

    converted_matrix = []
    for row_index, percentages in enumerate(report["damageMatrixPercentages"]):
        emulator = machine()
        emulator.mem_write(0x701000, " ".join(map(str, percentages)).encode("ascii") + b"\0")
        put(emulator, 0x70EFF0, 0x701000)
        put(emulator, 0x70EFFC, row_index)
        put(emulator, 0x4F98C8, len(percentages))
        put(emulator, 0x4F98D0, 0x702000)
        put(emulator, 0x702000 + row_index * 4, 0x703000)
        run(emulator, 0x43B24B, 0x43B2EF)
        actual = list(struct.unpack(f"<{len(percentages)}h", emulator.mem_read(0x703000, len(percentages) * 2)))
        assert actual == [int(value * 0.01 * 256) for value in percentages], (percentages, actual)
        converted_matrix.append(actual)

    armor_results = []
    for first, second in ((125, 150), (120, 140), (100, 100), (133, 177)):
        emulator = machine()
        put(emulator, 0x70EFFC, 0x702000)
        put(emulator, 0x702028, first)
        put(emulator, 0x70202C, second)
        run(emulator, 0x43BD46, 0x43BD89)
        actual = [get(emulator, 0x702024 + index * 4) for index in range(3)]
        assert actual == [256, 25600 // first, 25600 // second]
        armor_results.append({"source": [first, second], "runtime": actual})

    damage_results = []
    for coefficient, damage, factor, armor, special in (
        (256, 100, 256, 256, 0), (256, 100, 256, 204, 0),
        (256, 100, 256, 170, 0), (217, 125, 129, 204, 0),
        (256, 100, 256, 204, 1), (1, 1, 256, 256, 0),
    ):
        emulator = machine()
        put(emulator, 0x70EFF4, coefficient)
        put(emulator, 0x70EFFC, factor)
        emulator.mem_write(0x70F014, bytes((special,)))
        emulator.reg_write(UC_X86_REG_ECX, damage)
        emulator.reg_write(UC_X86_REG_EBX, armor)
        run(emulator, 0x4419E5, 0x441A12)
        expected = (((coefficient * damage) >> 8) * factor) >> 8
        expected = (expected * armor) >> 8
        if special:
            expected = (expected * 3) >> 2
        actual = emulator.reg_read(UC_X86_REG_ECX)
        assert actual == expected
        damage_results.append({"inputs": [coefficient, damage, factor, armor, special], "result": actual})

    lifetime_results = []
    for distance, speed in ((4, 60), (12, 60), (2, 15)):
        emulator = machine()
        emulator.reg_write(UC_X86_REG_ESI, 0x702000)
        put(emulator, 0x702014, distance)
        put(emulator, 0x702010, speed)
        run(emulator, 0x43B935, 0x43B955)
        actual = get(emulator, 0x702018)
        assert actual == (2 * ((distance << 8) + 1024) + 1) // (2 * speed) + 1
        lifetime_results.append({"range": distance, "speed": speed, "derivedValue": actual})

    firing_results = []
    for rate, burst_count, burst_delay, counter in ((15, -1, -1, 0), (10, 3, 30, 0),
                                                   (10, 3, 30, 1), (10, 3, 30, 2)):
        emulator = machine()
        emulator.reg_write(UC_X86_REG_EDI, 0x702000)
        emulator.reg_write(UC_X86_REG_ESI, 0x703000)
        put(emulator, 0x702008, rate)
        put(emulator, 0x702020, burst_count)
        put(emulator, 0x702024, burst_delay)
        emulator.mem_write(0x703034, bytes((counter,)))
        run(emulator, 0x413181, 0x4131A3)
        expected_counter = counter + 1 if burst_count > 0 else counter
        expected_delay = rate
        if burst_count > 0 and expected_counter >= burst_count:
            expected_counter, expected_delay = 0, burst_delay
        actual = emulator.reg_read(UC_X86_REG_EBX)
        assert actual == expected_delay
        assert emulator.mem_read(0x703034, 1)[0] == expected_counter
        firing_results.append({"inputs": [rate, burst_count, burst_delay, counter],
                               "delay": actual, "counter": expected_counter})

        return {"sha256": digest, "nativeDependencyRowsVerified": len(report["dependencies"]),
            "nativeHealthInitializationsVerified": len(report["units"]),
            "nativeDamageMatrix": converted_matrix,
            "unitScanOffsetsByToken": unit_offsets, "weaponScanOffsetsAfterId": weapon_offsets,
            "armorProbes": armor_results, "damageProbes": damage_results,
            "firingDelayProbes": firing_results,
            "projectileProbes": lifetime_results, "disassembly": evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, default=ROOT / "raw_cd/DC")
    parser.add_argument("--verify-exe", type=Path, help="Verify original x86 with Capstone 5 and Unicorn 2")
    args = parser.parse_args()
    report = audit(args.game_root)
    if args.verify_exe:
        report["executable"] = verify_executable(args.verify_exe, report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()