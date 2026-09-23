"""Native-scanned upgraded weapon records through original direct impact health write."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDI, UC_X86_REG_ESI, UC_X86_REG_ESP,
)

SPEC = importlib.util.spec_from_file_location(
    "upgraded_combat_evidence", Path(__file__).with_name("combat-callers-20260919.py"))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def scenario_levels_probe():
    spec = importlib.util.spec_from_file_location(
        "additional_profile_scenario", Path(__file__).with_name("scenario-city-layout.py"))
    scanner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scanner)
    results = []
    for race, number in (("HUMAN", 1), ("ALIEN", 1), ("HUMAN", 11), ("ALIEN", 14)):
        relative = f"raw_cd/DC/SCENARIO/{race}/{race}{number:02d}.SCN"
        source = (AUDIT.ROOT / relative).read_bytes()
        lines = [line.strip() for line in source.decode("ascii").splitlines()]
        teams = []
        for team_index in range(8):
            start = next(index for index, line in enumerate(lines) if line.startswith(f"TEAM {team_index} "))
            city = lines.index("%City", start)
            native = scanner.execute(team_index, int(lines[start + 1]),
                                     [int(value) for value in lines[city - 1].split()], lines[city + 1:city + 10])
            teams.append({key: native[key] for key in ("team", "race", "unitRows", "scannedUnitRows", "levelBytesSha256")})
        results.append({"path": relative, "sha256": hashlib.sha256(source).hexdigest(), "teams": teams})
    return results


def probe(additional_profiles=False):
    machine = AUDIT.combat_tables()
    source_slot, target_slot = 200, 201
    source = AUDIT.GAME + 0x7D28 + source_slot * 220
    target = AUDIT.GAME + 0x7D28 + target_slot * 220
    projectile = 0x702000
    targets = (0, 8, *range(16, 23), *range(28, 36), 69, 73, 81, 82, 84, 89, 95)
    if additional_profiles:
        targets = tuple(range(106))
    calls, hits, sources, defenses = [], [], [], []
    route_counts = {address: 0 for address in (0x442767, 0x442775, 0x441930, 0x441A38, 0x441BEC)}

    def capture(emulator, address, size, user_data):
        if address in route_counts:
            route_counts[address] += 1
        if address == 0x441930:
            pointer = emulator.reg_read(UC_X86_REG_ESP)
            calls.append([emulator.reg_read(UC_X86_REG_ECX),
                          AUDIT.get(emulator, pointer + 4),
                          AUDIT.get(emulator, pointer + 8),
                          emulator.reg_read(UC_X86_REG_EBX)])
        elif address == 0x4419E5:
            calls[-1].extend([emulator.reg_read(UC_X86_REG_EBX),
                             AUDIT.get(emulator, emulator.reg_read(UC_X86_REG_EBP) - 12)])

    machine.hook_add(UC_HOOK_CODE, capture)
    for target_type in targets:
        record = AUDIT.TYPES + target_type * 280
        defenses.append({"type": target_type, "class": AUDIT.get(machine, record + 0x40),
                         "weapons": list(struct.unpack("<3i", machine.mem_read(record + 0x18, 12))),
                         "armorFactors": list(struct.unpack("<3I", machine.mem_read(record + 0x24, 12)))})
    source_types = (0, 2, 4, 8, 10, 12, 69, 73) if additional_profiles else (0, 8, 69, 73)
    for source_type in source_types:
        record = AUDIT.TYPES + source_type * 280
        faction = AUDIT.get(machine, record + 4)
        weapon_ids = struct.unpack("<3I", machine.mem_read(record + 0x18, 12))
        assert weapon_ids == {0: (1, 2, 3), 2: (7, 8, 9), 4: (13, 14, 14), 8: (15, 16, 17),
                      10: (21, 22, 23), 12: (30, 27, 28), 69: (5, 8, 6), 73: (62, 8, 6)}[source_type]
        assert faction == int(source_type in (8, 10, 12, 73))
        for weapon_level, weapon_id in enumerate(weapon_ids if source_type < 16 else weapon_ids[:1]):
            weapon = 0x4F0200 + weapon_id * 72
            weapon_class, base_damage, boom = [AUDIT.get(machine, weapon + offset) for offset in (0, 12, 28)]
            expected_class = 1 if source_type in (2, 10) else 4 if source_type in (4, 12) else 0
            expected_damage = ((200, 250, 250) if source_type == 4 else (200, 250, 300)
                               if source_type == 12 else (100, 125, 150) if source_type < 16 else (160,))
            assert weapon_class == expected_class and boom == 0, (source_type, weapon_id, weapon_class, boom)
            assert base_damage == expected_damage[weapon_level]
            assert struct.unpack('<2i', machine.mem_read(weapon + 32, 8)) == (-1, -1)
            assert machine.mem_read(0x4F90E0, 1) == b"\x01"
            sources.append({"type": source_type, "typeFaction": faction, "level": weapon_level,
                            "weapon": weapon_id, "class": weapon_class, "baseDamage": base_damage,
                            "boomProfile": boom, "boomDimension": 1,
                            "burstCount": -1, "burstDelay": -1})
            for defense in defenses:
                target_type = defense["type"]
                target_record = AUDIT.TYPES + target_type * 280
                coefficient = struct.unpack("<h", machine.mem_read(0x705000 + weapon_class * 32 + defense["class"] * 2, 2))[0]
                for armor_level, armor in enumerate(defense["armorFactors"]):
                    for phase in (0, 1):
                        for source_team, target_team in ((0, 1), (7, 3), (3, 3)):
                            machine.mem_write(source + 6, bytes((source_type, source_team)))
                            machine.mem_write(source + 0xD6, b"\0")
                            machine.mem_write(target + 6, bytes((target_type, target_team)))
                            machine.mem_write(target_record + 0x38, bytes([(armor_level + 1) % 3] * 8))
                            machine.mem_write(target_record + 0x38 + target_team, bytes((armor_level,)))
                            AUDIT.put(machine, target + 12, 10000)
                            AUDIT.put(machine, AUDIT.GAME + 0x53C, phase)
                            AUDIT.put(machine, projectile + 12, source_slot << 16)
                            AUDIT.put(machine, AUDIT.FRAME - 8, target_slot)
                            AUDIT.put(machine, AUDIT.FRAME - 12, weapon)
                            machine.reg_write(UC_X86_REG_EBP, AUDIT.FRAME)
                            machine.reg_write(UC_X86_REG_ESP, AUDIT.STACK)
                            machine.reg_write(UC_X86_REG_ESI, projectile)
                            machine.reg_write(UC_X86_REG_EDI, AUDIT.GAME)
                            calls.clear()
                            AUDIT.NATIVE.run_slice(machine, 0x44275A, 0x441A3E)
                            flag = int(faction != phase)
                            assert calls == [[256, source_team, flag, weapon, armor, coefficient]], calls
                            expected = (((coefficient * base_damage) >> 8) * armor) >> 8
                            if flag:
                                expected = (expected * 3) >> 2
                            damage = 10000 - AUDIT.get(machine, target + 12)
                            assert damage == expected, (source_type, weapon_id, target_type, damage, expected)
                            hits.append({"sourceType": source_type, "weaponLevel": weapon_level,
                                         "weapon": weapon_id, "targetType": target_type, "armorLevel": armor_level,
                                         "phase": phase, "sourceTeam": source_team, "targetTeam": target_team,
                                         "damage": damage,
                                         **({"callerFactor": calls[0][0], "flag": calls[0][2],
                                             "weaponPointer": calls[0][3], "armorFactor": calls[0][4],
                                             "coefficient": calls[0][5], "healthBefore": 10000,
                                             "healthAfter": AUDIT.get(machine, target + 12)} if additional_profiles else {})})
    assert all(count == (0 if address == 0x441BEC else len(hits)) for address, count in route_counts.items())
    return {"executableSha256": AUDIT.NATIVE.AUDIT.DIGEST,
            "sourceHashes": {name: hashlib.sha256((AUDIT.ROOT / "raw_cd/DC/GAMESTAT" / name).read_bytes()).hexdigest()
                             for name in ("GAMESTAT.TXT", "WEAPSTAT.TXT", "MBULLET.TXT", "BOOMSTAT.TXT")},
            "scope": "native scanner destinations with marshalled CRT values; original BOOMSTAT-0 parser and direct impact through health write; no firing/cadence/flight proof",
            "sources": sources, "defenses": defenses, "hitCount": len(hits), "hits": hits,
            **({"routeCounts": {hex(address): count for address, count in route_counts.items()},
                "scenarios": scenario_levels_probe()} if additional_profiles else {})}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--additional-profiles", action="store_true")
    args = parser.parse_args()
    print(json.dumps(probe(args.additional_profiles), indent=2))