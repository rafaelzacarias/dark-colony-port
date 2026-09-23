"""Check actual mission upgrade rows against native scanner destinations/writes."""

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True

from unicorn.x86_const import (
    UC_X86_REG_EBP, UC_X86_REG_ECX, UC_X86_REG_EDI, UC_X86_REG_ESP,
)

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "live_combat_evidence", Path(__file__).with_name("combat-callers-20260919.py"))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def probe(name):
    path = ROOT / "raw_cd/DC/SCENARIO" / name / f"{name}01.SCN"
    data = path.read_bytes()
    lines = [line.strip() for line in data.decode("ascii").splitlines()]
    machine = AUDIT.initialized_types()
    mapping = struct.unpack("<16i", AUDIT.NATIVE.READ(0x41AD90, 64))
    expected = bytearray(106 * 16)
    rows_checked = 0
    teams = []
    for team_index in range(8):
        start = next(index for index, line in enumerate(lines)
                     if line.startswith(f"TEAM {team_index} "))
        race = int(lines[start + 1])
        city = lines.index("%City", start)
        city_row = [int(value) for value in lines[city + 1].split()]
        assert len(city_row) == 10
        unit_rows = [[int(value) for value in lines[city + offset].split()]
                     for offset in range(2, 10)]
        assert all(len(row) == 5 for row in unit_rows)
        nonzero = []
        for row_index, row in enumerate(unit_rows):
            machine.reg_write(UC_X86_REG_EBP, AUDIT.FRAME)
            machine.reg_write(UC_X86_REG_ESP, AUDIT.STACK)
            machine.reg_write(UC_X86_REG_EDI, 0x706000)
            machine.reg_write(UC_X86_REG_ECX, row_index)
            AUDIT.put(machine, 0x706020, race)
            AUDIT.put(machine, AUDIT.FRAME - 12, team_index)
            AUDIT.NATIVE.run_slice(machine, 0x41C229, 0x41C249)
            pointer = machine.reg_read(UC_X86_REG_ESP)
            format_pointer = AUDIT.get(machine, pointer + 4)
            assert AUDIT.NATIVE.READ(format_pointer, 32).split(b"\0", 1)[0].split() == [b"%d"] * 5
            destinations = struct.unpack("<5I", machine.mem_read(pointer + 8, 20))
            assert destinations == tuple(AUDIT.FRAME - offset for offset in (0x78, 0x74, 0x70, 0x6C, 0x64))
            for destination, value in zip(destinations, row):
                AUDIT.put(machine, destination, value)
            AUDIT.NATIVE.run_slice(machine, 0x41C24E, 0x41C287)
            type_index = mapping[race * 8 + row_index]
            expected[type_index * 16 + team_index] = row[2]
            expected[type_index * 16 + 8 + team_index] = row[3]
            if row[2] or row[3]:
                nonzero.append({"type": type_index, "rawRow": row,
                                "weaponLevel": row[2], "armorLevel": row[3]})
            rows_checked += 1
        teams.append({"team": team_index, "race": race, "nonzero": nonzero})
    for type_index in range(106):
        actual = machine.mem_read(AUDIT.TYPES + type_index * 280 + 0x30, 16)
        assert actual == expected[type_index * 16:(type_index + 1) * 16]
    assert [(team["team"], record["type"], record["weaponLevel"], record["armorLevel"])
            for team in teams for record in team["nonzero"]] == (
                [(0, 8, 1, 1)] if name == "ALIEN" else [])
    return {"scenario": f"{name}01", "sha256": hashlib.sha256(data).hexdigest(),
            "rowsChecked": rows_checked, "typeTeamLevelBytesChecked": len(expected), "teams": teams}


print(json.dumps({"scope": "native scanner argument construction and writes; CRT values marshalled from raw SCN rows, not full scenario boot",
                  "missions": [probe("HUMAN"), probe("ALIEN")]}, indent=2))