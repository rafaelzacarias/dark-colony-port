"""Hash-gated native damage caller component probes; Capstone 5 / Unicorn 2."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDX, UC_X86_REG_EDI, UC_X86_REG_ESI, UC_X86_REG_ESP,
)

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "combat_inspire_evidence", Path(__file__).with_name("inspire-audit-20260919.py"))
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)
GAME, TYPES, FRAME, STACK = NATIVE.GAME, NATIVE.TYPES, NATIVE.FRAME, NATIVE.STACK


def put(machine, address, value):
    machine.mem_write(address, struct.pack("<I", value & 0xFFFFFFFF))


def get(machine, address):
    return struct.unpack("<I", machine.mem_read(address, 4))[0]


def flag_probe():
    results = []
    for source_kind in (0, 1, 2):
        for phase in (0, 1, 2):
            machine = NATIVE.fixture()
            source_slot, target_slot = 200, 201
            source = GAME + 0x7D28 + source_slot * 220
            target = GAME + 0x7D28 + target_slot * 220
            projectile, weapon = 0x702000, 0x703000
            machine.mem_write(source + 6, bytes((0, 3)))
            machine.mem_write(target + 6, bytes((1, 5)))
            put(machine, target + 12, 1000)
            put(machine, TYPES + 4, source_kind)
            put(machine, GAME + 0x53C, phase)
            put(machine, projectile + 12, source_slot << 16)
            put(machine, weapon, 0)
            put(machine, weapon + 12, 100)
            put(machine, TYPES + 280 + 0x24, 256)
            put(machine, 0x4F98D0, 0x704000)
            put(machine, 0x704000, 0x705000)
            machine.mem_write(0x705000, struct.pack("<h", 256))
            put(machine, FRAME - 8, target_slot)
            put(machine, FRAME - 12, weapon)
            machine.reg_write(UC_X86_REG_EBP, FRAME)
            machine.reg_write(UC_X86_REG_ESP, STACK)
            machine.reg_write(UC_X86_REG_ESI, projectile)
            machine.reg_write(UC_X86_REG_EDI, GAME)
            calls = []

            def capture(emulator, address, size, user_data):
                if address == 0x441930:
                    pointer = emulator.reg_read(UC_X86_REG_ESP)
                    calls.append({
                        "target": emulator.reg_read(UC_X86_REG_EDX),
                        "factor": emulator.reg_read(UC_X86_REG_ECX),
                        "sourceTeam": get(emulator, pointer + 4),
                        "flag": get(emulator, pointer + 8),
                        "sourceSlot": get(emulator, pointer + 12),
                    })

            machine.hook_add(UC_HOOK_CODE, capture)
            NATIVE.run_slice(machine, 0x442775, 0x441A3E)
            expected_flag = int((source_kind == 0 and phase == 1)
                                or (source_kind == 1 and phase == 0))
            assert calls == [{"target": target_slot, "factor": 256,
                              "sourceTeam": 3, "flag": expected_flag,
                              "sourceSlot": source_slot}], calls
            damage = 1000 - get(machine, target + 12)
            assert damage == (75 if expected_flag else 100), damage
            results.append({"sourceTypeField4": source_kind, "phase": phase,
                            **calls[0], "damage": damage})
    return results


def initialized_types():
    machine = NATIVE.parsed_fixture()
    for type_id in range(106):
        record = TYPES + type_id * 280
        percentages = struct.unpack("<2I", machine.mem_read(record + 0x28, 8))
        machine.mem_write(record + 0x30, b"\xa5" * 16)
        put(machine, FRAME - 4, record)
        machine.reg_write(UC_X86_REG_EBP, FRAME)
        NATIVE.run_slice(machine, 0x43BD46, 0x43BDAE)
        assert machine.mem_read(record + 0x30, 16) == bytes(16)
        assert struct.unpack("<3I", machine.mem_read(record + 0x24, 12)) == (
            256, 25600 // percentages[0], 25600 // percentages[1])
    return machine


def armor_initialization_probe():
    machine = initialized_types()
    results = []
    for type_id in range(106):
        record = TYPES + type_id * 280
        results.append({"type": type_id,
                        "faction": get(machine, record + 4),
                        "targetClass": get(machine, record + 0x40),
                        "armorFactors": list(struct.unpack("<3I", machine.mem_read(record + 0x24, 12))),
                        "weaponLevels": list(machine.mem_read(record + 0x30, 8)),
                        "armorLevels": list(machine.mem_read(record + 0x38, 8))})
    return results


def scenario_override_probe():
    results = []
    mapping = struct.unpack("<16i", NATIVE.READ(0x41AD90, 64))
    assert mapping == (0, 2, 3, 6, 43, 5, 1, 4, 8, 10, 11, 14, 44, 13, 9, 12)
    for faction in (0, 1):
        for team in (0, 3, 7):
            for weapon_level, armor_level in ((0, 0), (1, 2), (2, 1)):
                machine = initialized_types()
                record = 0x706000
                put(machine, record + 0x20, faction)
                put(machine, FRAME - 12, team)
                put(machine, FRAME - 0x70, weapon_level)
                put(machine, FRAME - 0x6C, armor_level)
                machine.reg_write(UC_X86_REG_EBP, FRAME)
                machine.reg_write(UC_X86_REG_EDI, record)
                machine.reg_write(UC_X86_REG_ECX, 0)
                machine.reg_write(UC_X86_REG_ESP, STACK)
                NATIVE.run_slice(machine, 0x41C24E, 0x41C287)
                type_id = mapping[faction * 8]
                assert machine.mem_read(TYPES + type_id * 280 + 0x30 + team, 1)[0] == weapon_level
                assert machine.mem_read(TYPES + type_id * 280 + 0x38 + team, 1)[0] == armor_level
                results.append({"faction": faction, "team": team, "type": type_id,
                                "weaponLevel": weapon_level, "armorLevel": armor_level})
    return results


def phase_probe():
    results = []
    for phase in (0, 1):
        for counter in (99, 100, 101):
            machine = NATIVE.fixture()
            put(machine, FRAME - 4, GAME)
            put(machine, GAME + 0x530, counter)
            put(machine, GAME + 0x534, 100)
            put(machine, GAME + 0x53C, phase)
            machine.reg_write(UC_X86_REG_EBP, FRAME)
            machine.reg_write(UC_X86_REG_EDX, GAME)
            NATIVE.run_slice(machine, 0x419993, 0x4199C1)
            actual = (get(machine, GAME + 0x530), get(machine, GAME + 0x53C))
            assert actual == ((0, 1 - phase) if counter > 100 else (counter, phase))
            results.append({"before": [counter, phase], "after": list(actual)})
    return results


def source_rows(name):
    return [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT" / name).read_text(encoding="ascii").splitlines()
            if line.strip() and not line.lstrip().startswith("%")]


def combat_tables():
    machine = initialized_types()
    weapon_rows = source_rows("WEAPSTAT.TXT")
    assert int(weapon_rows[0][0]) == len(weapon_rows) - 1
    for tokens in weapon_rows[1:]:
        weapon_id = int(tokens[0])
        machine.reg_write(UC_X86_REG_EBP, FRAME)
        machine.reg_write(UC_X86_REG_ESP, STACK)
        machine.reg_write(UC_X86_REG_ESI, weapon_id * 9)
        NATIVE.run_slice(machine, 0x43B78B, 0x43B7CA)
        pointer = machine.reg_read(UC_X86_REG_ESP)
        assert NATIVE.READ(get(machine, pointer + 4), 100).split(b"\0", 1)[0].split() == [b"%s"] + [b"%d"] * 11
        destinations = struct.unpack("<12I", machine.mem_read(pointer + 8, 48))
        machine.mem_write(destinations[0], tokens[1].encode("ascii") + b"\0")
        for destination, token in zip(destinations[1:], tokens[2:]):
            put(machine, destination, int(token))
    matrix_rows = source_rows("MBULLET.TXT")
    assert matrix_rows[:2] == [["10"], ["9"]]
    put(machine, 0x4F98C8, 10)
    put(machine, 0x4F98D0, 0x704000)
    for row_id, tokens in enumerate(matrix_rows[2:]):
        destination = 0x705000 + row_id * 32
        put(machine, 0x704000 + row_id * 4, destination)
        machine.mem_write(0x701000, " ".join(tokens).encode("ascii") + b"\0")
        put(machine, FRAME - 16, 0x701000)
        put(machine, FRAME - 4, row_id)
        machine.reg_write(UC_X86_REG_EBP, FRAME)
        machine.reg_write(UC_X86_REG_ESP, STACK)
        machine.reg_write(UC_X86_REG_EDI, 0)
        NATIVE.run_slice(machine, 0x43B24B, 0x43B2EF)
        actual = struct.unpack("<10h", machine.mem_read(destination, 20))
        assert actual == tuple(int(int(value) * 0.01 * 256) for value in tokens)
    boom_rows = source_rows("BOOMSTAT.TXT")
    assert boom_rows[1] == ["0", "1"]
    machine.mem_write(FRAME - 0x118, b"0 1\0")
    machine.reg_write(UC_X86_REG_EBP, FRAME)
    machine.reg_write(UC_X86_REG_ESP, STACK)
    NATIVE.run_slice(machine, 0x43B407, 0x43B49E)
    assert machine.mem_read(0x4F90E0, 1) == b"\x01"
    return machine


def ordinary_hit_probe():
    machine = combat_tables()
    results = []
    source_slot, target_slot = 200, 201
    source = GAME + 0x7D28 + source_slot * 220
    target = GAME + 0x7D28 + target_slot * 220
    projectile = 0x702000
    calls = []

    def capture(emulator, address, size, user_data):
        if address == 0x441930:
            pointer = emulator.reg_read(UC_X86_REG_ESP)
            calls.append([emulator.reg_read(UC_X86_REG_ECX), get(emulator, pointer + 8)])
        elif address == 0x4419E5:
            calls[-1].extend([emulator.reg_read(UC_X86_REG_EBX),
                              get(emulator, emulator.reg_read(UC_X86_REG_EBP) - 12)])

    machine.hook_add(UC_HOOK_CODE, capture)
    for source_type, weapon_id in ((0, 1), (8, 15)):
        assert get(machine, TYPES + source_type * 280 + 0x18) == weapon_id
        weapon = 0x4F0200 + weapon_id * 72
        assert [get(machine, weapon + offset) for offset in (0, 12, 28)] == [0, 100, 0]
        for phase in (0, 1):
            for target_type in (0, 8, *range(16, 23), *range(28, 36)):
                for source_team, target_team in ((0, 1), (7, 3), (3, 3)):
                    machine.mem_write(source + 6, bytes((source_type, source_team)))
                    machine.mem_write(target + 6, bytes((target_type, target_team)))
                    machine.mem_write(source + 0xD6, b"\0")
                    put(machine, target + 12, 1000)
                    put(machine, GAME + 0x53C, phase)
                    put(machine, projectile + 12, source_slot << 16)
                    put(machine, FRAME - 8, target_slot)
                    put(machine, FRAME - 12, weapon)
                    machine.reg_write(UC_X86_REG_EBP, FRAME)
                    machine.reg_write(UC_X86_REG_ESP, STACK)
                    machine.reg_write(UC_X86_REG_ESI, projectile)
                    machine.reg_write(UC_X86_REG_EDI, GAME)
                    calls.clear()
                    NATIVE.run_slice(machine, 0x44275A, 0x441A3E)
                    flag = int(get(machine, TYPES + source_type * 280 + 4) != phase)
                    target_class = get(machine, TYPES + target_type * 280 + 0x40)
                    coefficient = struct.unpack("<h", machine.mem_read(0x705000 + target_class * 2, 2))[0]
                    expected = (coefficient * 100) >> 8
                    if flag:
                        expected = (expected * 3) >> 2
                    actual = 1000 - get(machine, target + 12)
                    assert calls == [[256, flag, 256, coefficient]], calls
                    assert actual == expected
                    results.append({"sourceType": source_type, "weapon": weapon_id,
                                    "phase": phase, "sourceTeam": source_team,
                                    "targetType": target_type, "targetTeam": target_team,
                                    "targetClass": target_class, "coefficient": coefficient,
                                    "factor": 256, "armor": 256, "flag": flag, "damage": actual})
    return results


def alternate_caller_probe():
    results = []
    for caller in (0x44219B, 0x4423B5):
        for same_team in (False, True):
            machine = NATIVE.fixture()
            source_slot, target_slot = 200, 201
            source = GAME + 0x7D28 + source_slot * 220
            target = GAME + 0x7D28 + target_slot * 220
            projectile, weapon, effect = 0x702000, 0x703000, 0x706000
            machine.mem_write(source + 6, bytes((0, 3)))
            machine.mem_write(source + 0xD6, b"\x01")
            machine.mem_write(target + 6, bytes((1, 3 if same_team else 5)))
            put(machine, GAME + 0x53C, 1)
            put(machine, target + 12, 1000)
            put(machine, weapon + 12, 100)
            put(machine, projectile + 12, source_slot << 16)
            put(machine, TYPES + 280 + 0x24, 256)
            put(machine, 0x4F98D0, 0x704000)
            put(machine, 0x704000, 0x705000)
            machine.mem_write(0x705000, struct.pack("<h", 256))
            put(machine, effect + 16, 128 << 16)
            machine.reg_write(UC_X86_REG_EBP, FRAME)
            machine.reg_write(UC_X86_REG_ESP, STACK)
            machine.reg_write(UC_X86_REG_ESI, projectile)
            if caller == 0x44219B:
                for offset, value in ((4, weapon), (8, 0), (12, 0), (24, 0), (28, 0),
                                      (36, effect), (40, 0), (48, target_slot)):
                    put(machine, FRAME - offset, value)
                machine.reg_write(UC_X86_REG_EDI, GAME)
                machine.reg_write(UC_X86_REG_ECX, 256)
                start = 0x4420D6
            else:
                for offset, value in ((8, 0), (12, 0), (16, GAME), (20, 0),
                                      (24, 0), (28, weapon), (32, effect)):
                    put(machine, FRAME - offset, value)
                machine.reg_write(UC_X86_REG_EDI, 0)
                machine.reg_write(UC_X86_REG_EDX, target_slot)
                start = 0x442351
            calls = []

            def capture(emulator, address, size, user_data):
                if address == 0x441930:
                    pointer = emulator.reg_read(UC_X86_REG_ESP)
                    calls.append([emulator.reg_read(UC_X86_REG_ECX), get(emulator, pointer + 8)])

            machine.hook_add(UC_HOOK_CODE, capture)
            NATIVE.run_slice(machine, start, 0x441A3E)
            factor = 32 if caller == 0x44219B and same_team else 128
            assert calls == [[factor, 0]], calls
            damage = 1000 - get(machine, target + 12)
            assert damage == (100 * factor) >> 8
            results.append({"caller": hex(caller), "sameTeam": same_team,
                            "factor": factor, "flag": 0, "damage": damage})
    return results


def direct_call_sites():
    sites = []
    _, start, length, raw = NATIVE.SECTIONS[0]
    code = NATIVE.IMAGE[raw:raw + length]
    for offset in range(len(code) - 4):
        if code[offset] == 0xE8:
            target = start + offset + 5 + struct.unpack_from("<i", code, offset + 1)[0]
            if target == 0x441930:
                sites.append(start + offset)
    assert sites == [0x44219B, 0x4423B5, 0x442877], sites
    return [hex(site) for site in sites]


def phase_observation_probe():
    machine = initialized_types()
    results = []
    source = GAME + 0x7D28
    for phase in (0, 1):
        for counter in (0, 50, 100):
            put(machine, FRAME - 4, GAME)
            put(machine, GAME + 0x530, counter)
            put(machine, GAME + 0x538, 100)
            put(machine, GAME + 0x53C, phase)
            machine.reg_write(UC_X86_REG_EBP, FRAME)
            NATIVE.run_slice(machine, 0x4199C1, 0x419A28)
            blend = get(machine, GAME + 0x540)
            assert blend == (256 - counter * 256 // 100 if phase == 0 else counter * 256 // 100)
            machine.reg_write(UC_X86_REG_ESI, GAME)
            NATIVE.run_slice(machine, 0x44A6E9, 0x44A703)
            for type_id, day, night in ((0, 7, 4), (8, 4, 7)):
                record = TYPES + type_id * 280
                assert get(machine, record + 0x10) == night
                assert get(machine, record + 0x14) == day
                machine.mem_write(source + 6, bytes((type_id,)))
                machine.reg_write(UC_X86_REG_EDX, source)
                NATIVE.run_slice(machine, 0x44A7A6, 0x44A7DD)
                vision = machine.reg_read(UC_X86_REG_EBX)
                assert vision == (night * blend + day * (256 - blend)) >> 8
                results.append({"phase": phase, "counter": counter, "blend": blend,
                                "type": type_id, "vision": vision})
    return results


def armor_selection_probe():
    machine = combat_tables()
    results = []
    target_slot, target_team, source_team = 201, 3, 7
    target = GAME + 0x7D28 + target_slot * 220
    weapon = 0x4F0200 + 72
    for target_type in (0, 8, 16, 17, 28, 29):
        record = TYPES + target_type * 280
        target_class = get(machine, record + 0x40)
        coefficient = struct.unpack("<h", machine.mem_read(0x705000 + target_class * 2, 2))[0]
        for level in (0, 1, 2):
            for flag in (0, 1):
                machine.mem_write(target + 6, bytes((target_type, target_team)))
                machine.mem_write(record + 0x38, bytes([2] * 8))
                machine.mem_write(record + 0x38 + target_team, bytes((level,)))
                machine.mem_write(record + 0x38 + source_team, bytes(((level + 1) % 3,)))
                put(machine, target + 12, 1000)
                machine.mem_write(STACK, struct.pack("<4I", NATIVE.STOP, source_team, flag, 200))
                machine.reg_write(UC_X86_REG_ESP, STACK)
                machine.reg_write(UC_X86_REG_EAX, GAME)
                machine.reg_write(UC_X86_REG_EDX, target_slot)
                machine.reg_write(UC_X86_REG_EBX, weapon)
                machine.reg_write(UC_X86_REG_ECX, 256)
                NATIVE.run_slice(machine, 0x441930, 0x441A3E)
                armor = get(machine, record + 0x24 + level * 4)
                expected = (((coefficient * 100) >> 8) * armor) >> 8
                if flag:
                    expected = (expected * 3) >> 2
                damage = 1000 - get(machine, target + 12)
                assert damage == expected
                results.append({"targetType": target_type, "targetTeam": target_team,
                                "sourceTeam": source_team, "armorLevel": level,
                                "armorFactor": armor, "flag": flag, "damage": damage})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    args = parser.parse_args()
    if args.disassemble:
        start, end = args.disassemble
        decoder = Cs(CS_ARCH_X86, CS_MODE_32)
        for instruction in decoder.disasm(NATIVE.READ(start, end - start), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
        return
    print(json.dumps({"sha256": NATIVE.AUDIT.DIGEST,
                      "sourceHashes": {name: hashlib.sha256((ROOT / "raw_cd/DC/GAMESTAT" / name).read_bytes()).hexdigest()
                                       for name in ("GAMESTAT.TXT", "WEAPSTAT.TXT", "MBULLET.TXT", "BOOMSTAT.TXT")},
                      "directCallSites": direct_call_sites(), "flagProbes": flag_probe(),
                      "typeInitialization": armor_initialization_probe(),
                      "scenarioOverrides": scenario_override_probe(),
                      "phaseTransitions": phase_probe(),
                      "phaseObservation": phase_observation_probe(),
                      "armorSelection": armor_selection_probe(),
                      "ordinaryHits": ordinary_hit_probe(),
                      "alternateCallers": alternate_caller_probe()}, indent=2))


if __name__ == "__main__":
    main()