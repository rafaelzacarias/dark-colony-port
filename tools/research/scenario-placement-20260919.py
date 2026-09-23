"""Native SCN placement evidence, using the hash-gated resource harness."""

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
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDI, UC_X86_REG_ESI, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "placement_resource_probe", Path(__file__).with_name("resource-init-20260919.py"))
RESOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RESOURCE)
TYPE_SPEC = importlib.util.spec_from_file_location(
    "placement_type_probe", Path(__file__).with_name("inspire-audit-20260919.py"))
TYPE_PROBE = importlib.util.module_from_spec(TYPE_SPEC)
TYPE_SPEC.loader.exec_module(TYPE_PROBE)
GAME, FRAME, STACK = RESOURCE.NATIVE.GAME, RESOURCE.NATIVE.FRAME, RESOURCE.NATIVE.STACK
TYPES = 0x4F1880


def source(name):
    faction = name[:-2]
    data = (ROOT / f"raw_cd/DC/SCENARIO/{faction}/{name}.SCN").read_bytes()
    lines = [line.strip() for line in data.decode("ascii").splitlines()]
    teams = [int(lines[next(index for index, line in enumerate(lines)
                           if line.startswith(f"TEAM {team} ")) + 1]) for team in range(8)]
    start = lines.index("%City", next(index for index, line in enumerate(lines)
                                    if line.startswith("TEAM 7 "))) + 10
    rows = [line for line in lines[start:] if line]
    assert all(len(row.split()) in (5, 6) for row in rows)
    return data, teams, rows


def fixture(teams, first_slot, high_water, mode):
    machine = RESOURCE.fixture()
    parsed = TYPE_PROBE.parsed_fixture()
    machine.mem_write(TYPES, bytes(parsed.mem_read(TYPES, 110 * 280)))
    type_rows = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT").read_text().splitlines()
                 if line.strip() and not line.lstrip().startswith("%")][1:]
    assert all(RESOURCE.get(machine, TYPES + index * 280 + 0x114, "i") == int(row[31])
               for index, row in enumerate(type_rows))
    machine.mem_map(0x900000, 0x200000)
    RESOURCE.put(machine, GAME + 0x46F2C, 0x900000)
    RESOURCE.put(machine, 0x99A4B0, 256)
    RESOURCE.put(machine, 0x99A4B4, 256)
    for row in range(256):
        for offset, base, stride in ((4, 0x9A0000, 1024), (0x804, 0xA00000, 1024),
                                     (0xC04, 0xA40000, 512), (0x1004, 0xA60000, 512)):
            RESOURCE.put(machine, 0x900000 + offset + row * 4, base + row * stride)
    for team, race in enumerate(teams):
        RESOURCE.put(machine, GAME + team * 0xE30 + 0xBB8, race)
    RESOURCE.put(machine, FRAME - 8, 0x708000)
    RESOURCE.put(machine, 0x7094A0, mode)
    RESOURCE.put(machine, GAME + 0x7D20, high_water)
    RESOURCE.put(machine, RESOURCE.AUDIT.SCALE, 256)
    RESOURCE.put(machine, RESOURCE.AUDIT.STATISTICS + 96, 256)
    RESOURCE.put(machine, 0x4796B0, 0)
    RESOURCE.put(machine, 0x4796B4, 0)
    machine.reg_write(UC_X86_REG_ESI, GAME)
    machine.reg_write(UC_X86_REG_EDI, first_slot)
    return machine


def stream(name, rows=None, first_slot=152, high_water=None, mode=0):
    data, teams, original_rows = source(name)
    rows = original_rows if rows is None else rows
    machine = fixture(teams, first_slot, first_slot if high_water is None else high_water, mode)
    records = []
    projected = bytearray()
    for index, text in enumerate(rows):
        before = machine.reg_read(UC_X86_REG_EDI)
        metadata_before = RESOURCE.get(machine, 0x4796B0)
        calls = []

        def observe(emulator, address, size, user_data):
            if address in (0x43FD50, 0x41AF14, 0x440410):
                calls.append(hex(address))

        hook = machine.hook_add(UC_HOOK_CODE, observe)
        machine.mem_write(FRAME - 0x47C, text.encode("ascii") + b"\0")
        machine.reg_write(UC_X86_REG_ESP, STACK)
        RESOURCE.execute(machine, 0x41C453, 0x41C438)
        machine.hook_del(hook)
        after = machine.reg_read(UC_X86_REG_EDI)
        row = list(map(int, text.split()))
        record = {"sourceRow": index, "row": row, "before": before, "after": after,
                  "highWater": RESOURCE.get(machine, GAME + 0x7D20), "calls": calls}
        if row[3] == -1:
            assert after == before and calls == ["0x43fd50"], record
            assert RESOURCE.get(machine, 0x4796B0) == metadata_before + 1
            raw = bytes(machine.mem_read(0x4FE06C + metadata_before * 40, 40))
            expected = bytearray(40)
            struct.pack_into("<4i", expected, 4, row[0], row[1], row[2], row[4])
            assert raw == expected, raw.hex()
            record["metadataHex"] = raw.hex()
        elif "0x41af14" in calls:
            assert after == before + 1 and "0x41af14" in calls, record
            raw = bytes(machine.mem_read(GAME + 0x7D28 + before * 220, 220))
            record["slot"] = before
            record["entityHex"] = raw.hex()
            projection = struct.pack("<H", before) + raw[0:2] + raw[4:8] + raw[12:16] + raw[44:45] + raw[203:204]
            if raw[6] == 40:
                projection += raw[50:52] + raw[70:72]
            projected.extend(projection)
            record["nativeFields"] = [RESOURCE.get(machine, GAME + 0x7D28 + before * 220 + offset, fmt)
                                      for offset, fmt in ((0, "H"), (4, "H"), (6, "B"), (7, "B"),
                                                          (12, "i"), (0x2C, "B"), (0xCB, "B"))]
        else:
            assert after in (before, before + 1) and calls == [], record
            record["noEntity"] = True
        records.append(record)
    machine.reg_write(UC_X86_REG_ESP, STACK)
    RESOURCE.put(machine, STACK, RESOURCE.STOP)
    RESOURCE.execute(machine, 0x43FE6C, RESOURCE.STOP)
    total = machine.reg_read(UC_X86_REG_EAX)
    assert total == sum(record["row"][4] for record in records if "metadataHex" in record)
    return {"scenario": name, "sourceSha256": hashlib.sha256(data).hexdigest(),
            "originalStream": rows == original_rows, "firstSlot": first_slot,
            "nextSlot": machine.reg_read(UC_X86_REG_EDI),
            "highWater": RESOURCE.get(machine, GAME + 0x7D20),
            "projectedEntitySha256": hashlib.sha256(projected).hexdigest(), "renatPopulation": total,
            "metadataCount": RESOURCE.get(machine, 0x4796B0),
            "entityCount": sum("slot" in record for record in records), "records": records}


def synthetic():
    result = stream("HUMAN02", ["2 3 0 2 -1 257", "4 5 25 -1 2 999",
                               "6 7 40 0 100 257", "8 9 0 0 -2"], 231, 250)
    assert [record.get("slot") for record in result["records"]] == [231, None, 232, 233]
    assert [record["nativeFields"][2:] for record in result["records"] if "slot" in record] == [
        [8, 2, 800, 1, 1], [40, 8, 100, 1, 0], [0, 0, 800, 1, 0]]
    assert result["highWater"] == 250 and result["nextSlot"] == 234
    reserved = stream("HUMAN02", ["2 3 0 0 -1", "4 5 25 -1 2"], 231, mode=1)
    assert reserved["entityCount"] == 0 and reserved["nextSlot"] == reserved["highWater"] == 232
    queue = stream("HUMAN02", ["2 3 37 0 -1 257", "2 3 0 0 -1", "4 5 0 0 -1"], 231)
    assert [record.get("slot") for record in queue["records"]] == [231, None, 232]
    assert queue["records"][0]["nativeFields"][2:] == [37, 8, 300, 1, 0]
    return {"counterpartSixthAndCursor": result, "disabledTeamReservesSlot": reserved,
            "coordinateQueueCapturesOrdinaryRow": queue}


def disassemble():
    read = RESOURCE.NATIVE.READ
    for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(read(0x41C453, 0x2A0), 0x41C453):
        print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--disassemble", action="store_true")
    arguments = parser.parse_args()
    if arguments.disassemble:
        disassemble()
    else:
        missions = [stream(name) for name in ("HUMAN01", "ALIEN01", "HUMAN02", "ALIEN02")]
        assert [(mission["entityCount"], mission["metadataCount"], mission["highWater"])
            for mission in missions] == [(33, 0, 185), (46, 0, 198), (18, 2, 170), (41, 2, 193)]
        assert [mission["projectedEntitySha256"] for mission in missions] == [
            "e6b9b2d746735cca9a89e103d00f82f67d92539e18e637de9d7cc56eeb52230c",
            "4dcedb6507b3da3dece3f77ef442a269dda7b323656a445c610b397765feb3a9",
            "e0576cd48817219c13f25f2041b90fd1a011c84ba366d6c050508455513e30eb",
            "2183678aa8f53335cd943cef1d9228eb9b6f01c1394e154b0786d379e5c030dc"]
        print(json.dumps({"scope": "Actual scanner, metadata routine, constructor and allocation loop; explicit mode 0, fresh metadata/coordinate queues, parsed source type table, synthetic map planes; not full boot",
                  "missions": missions, "synthetic": synthetic()}, indent=2))