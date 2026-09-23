"""Hash-pinned native static occupancy census and isolated plane probes."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
    UC_X86_REG_EBP, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
)

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "static_placement", Path(__file__).with_name("scenario-placement-20260919.py"))
PLACEMENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PLACEMENT)
RESOURCE = PLACEMENT.RESOURCE
ROOT = PLACEMENT.ROOT
PLANES = {"map": (0x9A0000, 4, 1024), "ground": (0xA00000, 4, 1024),
          "air": (0xA40000, 2, 512), "auxiliary": (0xA60000, 2, 512)}
SLOT = 152


def plane_at(address):
    for name, (base, size, stride) in PLANES.items():
        if base <= address < base + stride * 256:
            offset = address - base
            return name, offset % stride // size, offset // stride, size
    return None


def address_at(plane, tile_x, tile_y):
    base, size, stride = PLANES[plane]
    return base + tile_y * stride + tile_x * size


def value_at(machine, plane, tile_x, tile_y):
    return RESOURCE.get(machine, address_at(plane, tile_x, tile_y),
                        "I" if PLANES[plane][1] == 4 else "H")


def map_fixture(scenario, mode=0, poop_gate=0):
    machine = PLACEMENT.fixture([team["race"] for team in scenario["teams"]], SLOT, SLOT, 0)
    RESOURCE.put(machine, 0x7094A0, mode)
    RESOURCE.put(machine, PLACEMENT.FRAME - 0x14, poop_gate)
    path = ROOT / "raw_cd/DC/SCENARIO" / scenario["name"]
    source = path.with_suffix(".MAP").read_bytes()
    width, height = struct.unpack_from("<II", source)
    area = width * height
    assert len(source) == 8 + area * 6 and 0 < width <= 255 and 0 < height <= 255
    path_data = path.with_suffix(".PTH").read_bytes()
    tags = path.with_suffix(".MTG").read_bytes()
    assert len(path_data) == 65536 + area and len(tags) == 2 + area
    assert tuple(tags[:2]) == (width, height)
    machine.mem_map(0xB00000, 0x200000)
    RESOURCE.put(machine, 0x901404, 0xB00000)
    machine.mem_write(0x901404 + 0x870A4, path_data[:65536])
    for offset, value in ((0x9A4B0, width), (0x9A4B4, height),
                          (0x9A4B8, width * 256), (0x9A4BC, height * 256)):
        RESOURCE.put(machine, 0x900000 + offset, value)
    for tile_y in range(height):
        RESOURCE.put(machine, 0xB00000 + tile_y * 4, 0xB01000 + tile_y * width * 24)
        path_row = bytearray(width * 24)
        for tile_x in range(width):
            path_row[tile_x * 24 + 12] = path_data[65536 + tile_y * width + tile_x]
        machine.mem_write(0xB01000 + tile_y * width * 24, bytes(path_row))
        attributes = struct.unpack_from(f"<{width}H", source, 8 + area * 4 + tile_y * width * 2)
        machine.mem_write(address_at("map", 0, tile_y), b"".join(
            struct.pack("<I", ((attribute << 22) | 0x12345) & 0xFFFFFFFF) for attribute in attributes))
        machine.mem_write(address_at("ground", 0, tile_y), struct.pack("<I", 0x1234ABFF) * width)
        machine.mem_write(address_at("air", 0, tile_y), b"".join(struct.pack("<H",
            ((tags[2 + (height - 1 - tile_y) * width + tile_x] << 10) | 1023) & 65535)
            for tile_x in range(width)))
        machine.mem_write(address_at("auxiliary", 0, tile_y), struct.pack("<H", 0xA7FF) * width)
    return machine, width, height, path_data


def capture(machine, action):
    touched = {}
    writes = []

    def observe(emulator, access, address, size, value, data):
        cell = plane_at(address)
        if cell is None:
            return
        name, tile_x, tile_y, cell_size = cell
        key = (name, tile_x, tile_y)
        touched.setdefault(key, value_at(emulator, *key))
        writes.append({"pc": hex(emulator.reg_read(UC_X86_REG_EIP)), "plane": name,
                       "x": tile_x, "y": tile_y, "bytes": size, "value": value})

    hook = machine.hook_add(UC_HOOK_MEM_WRITE, observe)
    try:
        action()
    finally:
        machine.hook_del(hook)
    changes = [{"plane": key[0], "x": key[1], "y": key[2], "before": before,
                "after": value_at(machine, *key)} for key, before in touched.items()]
    return {"cells": changes, "writes": writes}


def remove(machine, slot, registered):
    saved = machine.context_save()
    RESOURCE.put(machine, PLACEMENT.STACK, RESOURCE.STOP)
    machine.reg_write(UC_X86_REG_ESP, PLACEMENT.STACK)
    machine.reg_write(UC_X86_REG_EAX, PLACEMENT.GAME)
    machine.reg_write(UC_X86_REG_EDX, slot)
    result = capture(machine, lambda: RESOURCE.execute(
        machine, 0x434D48, RESOURCE.STOP if registered else 0x434EBB))
    result["outcome"] = "removed" if registered else "native-missing-slot-diagnostic"
    for cell in result["cells"]:
        assert cell["after"] == cell["before"] | 1023, cell
    machine.context_restore(saved)
    return result


def native_scenario(scenario, types, mode=0, poop_gate=0):
    machine, width, height, path_data = map_fixture(scenario, mode, poop_gate)
    records = []
    for index, row in enumerate(scenario["placementRows"]):
        slot = machine.reg_read(UC_X86_REG_EDI)
        assert SLOT <= slot < 800
        calls = []

        def observe(emulator, address, size, data):
            if address in (0x41AF14, 0x43FD50, 0x440410):
                calls.append(hex(address))

        hook = machine.hook_add(UC_HOOK_CODE, observe)
        machine.reg_write(UC_X86_REG_ESP, PLACEMENT.STACK)
        machine.mem_write(PLACEMENT.FRAME - 0x47C, " ".join(map(str, row)).encode("ascii") + b"\0")
        result = capture(machine, lambda: RESOURCE.execute(machine, 0x41C453, 0x41C438))
        machine.hook_del(hook)
        entity = PLACEMENT.GAME + 0x7D28 + slot * 220
        actual_type = RESOURCE.get(machine, entity + 6, "B") if "0x41af14" in calls else None
        owner = RESOURCE.get(machine, entity + 7, "B") if actual_type is not None else None
        plane = None if owner in (None, 8) else ("auxiliary" if types[actual_type]["auxiliary"] else
                "air" if types[actual_type]["flyByte"] else "ground")
        expected = [] if plane is None else [plane]
        if actual_type == 40:
            expected.append("map")
        assert sorted(cell["plane"] for cell in result["cells"]) == sorted(expected), (scenario["name"], row, result)
        for cell in result["cells"]:
            assert (cell["x"], cell["y"]) == tuple(row[:2]), cell
            value = cell["before"] | 0x04000000 if cell["plane"] == "map" else (cell["before"] & ~1023) | slot
            assert cell["after"] == value, (row, cell, value)
        if types[row[2]]["speed"] == 0 or row[3] == -1:
            assert 0 <= row[0] < width and 0 <= row[1] < height
            record = {"rowIndex": index, "row": row, "slot": slot if actual_type is not None else None,
                      "type": actual_type, "owner": owner, "plane": plane, "calls": calls,
                      "pthFamily": path_data[65536 + row[1] * width + row[0]], **result}
            if actual_type is not None:
                record["removal"] = remove(machine, slot, plane is not None)
                for cell in result["cells"]:
                    RESOURCE.put(machine, address_at(cell["plane"], cell["x"], cell["y"]), cell["after"],
                                 "I" if PLANES[cell["plane"]][1] == 4 else "H")
            records.append(record)
    return {"name": scenario["name"], "width": width, "height": height,
            "inputRows": len(scenario["placementRows"]), "nextSlot": machine.reg_read(UC_X86_REG_EDI),
            "records": records}

PARSER = r"""
import {readFileSync, readdirSync} from 'node:fs';
import {parseScenario} from './tools/extractors/data/scenario.ts';
import {parseTriggerScript} from './tools/extractors/data/triggers.ts';
const root = 'raw_cd/DC/SCENARIO';
const files = readdirSync(root, {recursive:true}).sort();
console.log(JSON.stringify({
 scenarios: files.filter(name => /\.SCN$/i.test(name)).map(name => ({name,
   ...parseScenario(readFileSync(`${root}/${name}`, 'ascii'))})),
 triggers: files.filter(name => /\.TRO$/i.test(name)).map(name => ({name,
   blocks: parseTriggerScript(readFileSync(`${root}/${name}`, 'ascii'))}))
}));
"""


def fingerprint(path):
    data = path.read_bytes()
    return {"path": str(path.relative_to(ROOT)), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def compile_reinforcement(action):
    machine = RESOURCE.fixture()
    source = " ".join(map(str, action["arguments"])).encode("ascii") + b"\0"
    machine.mem_write(0x702000, source)
    RESOURCE.put(machine, PLACEMENT.FRAME - 0x30, 0x702000)
    RESOURCE.put(machine, 0x4FC448, 0)
    machine.mem_write(0x4FC44C, b"\xa5" * 28)
    machine.reg_write(UC_X86_REG_EBP, PLACEMENT.FRAME)
    machine.reg_write(UC_X86_REG_ESI, 0)
    machine.reg_write(UC_X86_REG_ESP, PLACEMENT.STACK)
    RESOURCE.execute(machine, 0x43EB74 if action["name"] == "reinforce" else 0x43EC8B, 0x43E8B7)
    payload = list(machine.mem_read(0x4FC450, 13))
    consumed = RESOURCE.get(machine, PLACEMENT.FRAME - 0x30) - 0x702000
    assert 0 <= consumed < len(source)
    return {"owner": payload[0], "x": payload[1], "y": payload[2],
            "groups": [[payload[3 + index], payload[8 + index]] for index in range(5)],
            "unconsumed": source[consumed:-1].decode("ascii")}


def census():
    parsed = json.loads(subprocess.check_output(
        ["node", "--import", "tsx", "--input-type=module", "-e", PARSER], cwd=ROOT))
    assert len(parsed["scenarios"]) == 108
    table = PLACEMENT.TYPE_PROBE.parsed_fixture()
    rows = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT").read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("%")][1:]
    types = []
    for index, row in enumerate(rows):
        base = PLACEMENT.TYPES + index * 280
        types.append({"type": index, "name": row[0], "speed": int(row[3]),
                      "nativeSpeed": RESOURCE.get(table, base + 12, "i"),
                      "flyByte": RESOURCE.get(table, base + 0x60, "B"),
                      "auxiliary": RESOURCE.get(table, base + 0x68, "i"),
                      "counterpart": RESOURCE.get(table, base + 0x114, "i"),
                      "race": RESOURCE.get(table, base + 4, "i"), "references": []})
    sources = [fingerprint(ROOT / "raw_cd/DC/DC.EXE"),
               fingerprint(ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT")]
    for scenario in parsed["scenarios"]:
        path = ROOT / "raw_cd/DC/SCENARIO" / scenario["name"]
        sources.append(fingerprint(path))
        for extension in ("MAP", "PTH", "MTG"):
            sources.append(fingerprint(path.with_suffix("." + extension)))
        for index, row in enumerate(scenario["placementRows"]):
            assert len(row) in (5, 6) and 0 <= row[2] < len(types), (path, row)
            types[row[2]]["references"].append({"source": scenario["name"], "rowIndex": index,
                                               "row": row, "kind": "metadata" if row[3] == -1 else "scn"})
        for team in scenario["teams"]:
            base_x, base_y = team["coordinateRows"][1]
            for slot in range(6):
                level, health = team["cityRows"][0][slot * 2:slot * 2 + 2] if slot < 5 else (1, 1)
                if not base_x or not level or not health or (slot == 5 and not base_y):
                    continue
                assert team["race"] in (0, 1) and level in (1, 2), (scenario["name"], team["index"], slot)
                unit_type = struct.unpack("<I", RESOURCE.NATIVE.READ(
                    0x47AFA8 + team["race"] * 120 + (level - 1) * 60 + slot * 4, 4))[0]
                types[unit_type]["references"].append({"source": scenario["name"], "kind": "colony",
                    "team": team["index"], "slot": slot, "level": level, "health": health})
    actions = []
    unsupported = []
    for script in parsed["triggers"]:
        sources.append(fingerprint(ROOT / "raw_cd/DC/SCENARIO" / script["name"]))
        for block in script["blocks"]:
            for action in block["actions"]:
                if action["name"] not in ("newtype", "reinforce", "reinforce2"):
                    continue
                reference = {"source": script["name"], "block": block["id"], **action}
                if action["name"] != "newtype":
                    reference["nativePayload"] = compile_reinforcement(action)
                actions.append(reference)
                arguments = action["arguments"]
                selected = [arguments[2]] if action["name"] == "newtype" else [
                    unit_type for unit_type, count in reference["nativePayload"]["groups"] if count > 0]
                for operand in selected:
                    values = [operand]
                    for unit_type in values:
                        if not isinstance(unit_type, int) or not 0 <= unit_type < len(types):
                            unsupported.append({**reference, "operand": operand})
                            continue
                        types[unit_type]["references"].append({**reference, "kind": action["name"]})
    return {"sources": sources, "scenarioCount": len(parsed["scenarios"]),
            "triggerCount": len(parsed["triggers"]), "actions": actions,
            "types": types, "scenarios": parsed["scenarios"], "unsupportedOperands": unsupported}


def read_image(name):
    image = (ROOT / "raw_cd/DC" / name).read_bytes()
    expected = {"DC.EXE": "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
                "DC16.EXE": "3159a24c69b4299e668d981daca0a21f5a8c1ade7bcc48c9f89379450d27762f",
                "MAPED.EXE": "e8471a0adcade0d0562f0e38ddbc85ebbd0776f50cc7429628dee435fa6a8f7e"}
    assert hashlib.sha256(image).hexdigest() == expected[name]
    header = struct.unpack_from("<I", image, 0x3C)[0]
    count = struct.unpack_from("<H", image, header + 6)[0]
    optional_size = struct.unpack_from("<H", image, header + 20)[0]
    base = struct.unpack_from("<I", image, header + 52)[0]
    sections = []
    for index in range(count):
        offset = header + 24 + optional_size + 40 * index
        label = image[offset:offset + 8].rstrip(b"\0").decode("ascii")
        _, relative, size, raw = struct.unpack_from("<IIII", image, offset + 8)
        flags = struct.unpack_from("<I", image, offset + 36)[0]
        if not flags & 0x80:
            sections.append((label, base + relative, size, raw, flags))
    return image, sections


def auxiliary_evidence(executable="DC.EXE"):
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32
    strings = []
    image, sections = read_image(executable)
    for name, address, length, raw, flags in sections:
        for match in re.finditer(rb"[\x20-\x7e]{3,}\x00", image[raw:raw + length]):
            text = match.group()[:-1].decode("ascii")
            if text.lower() in ("o16", "ovh", "set") or text.lower().endswith(".set"):
                strings.append({"address": address + match.start(), "text": text})
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.skipdata = True
    refs = []
    for name, address, length, raw, flags in sections:
        if not flags & 0x20:
            continue
        for instruction in decoder.disasm(image[raw:raw + length], address):
            if any(f"0x{item['address']:x}" in instruction.op_str for item in strings):
                refs.append({"pc": hex(instruction.address), "instruction": f"{instruction.mnemonic} {instruction.op_str}"})
    files = [fingerprint(path) for path in sorted((ROOT / "raw_cd").rglob("*"))
             if path.is_file() and path.suffix.upper() in (".O16", ".OVH", ".SET")]
    return {"executable": fingerprint(ROOT / "raw_cd/DC" / executable),
            "strings": strings, "references": refs, "files": files}


def constructor_cases(scenario, types):
    machine, width, height, path_data = map_fixture(scenario)
    saved = machine.context_save()
    records = []
    required = [item["type"] for item in types if item["speed"] == 0 and any(
        reference["kind"] != "colony" for reference in item["references"])]
    for unit_type in required:
        for owner in (0, 8, 9):
            for tile_x, tile_y in ((0, 0), (width - 1, height - 1)):
                machine.context_restore(saved)
                stack = PLACEMENT.STACK
                machine.mem_write(stack, struct.pack("<5I", RESOURCE.STOP, owner, 0xFFFFFFFF, 0, SLOT))
                for register, value in ((UC_X86_REG_EAX, PLACEMENT.GAME), (UC_X86_REG_EDX, tile_x),
                                        (UC_X86_REG_EBX, tile_y), (UC_X86_REG_ECX, unit_type),
                                        (UC_X86_REG_ESP, stack)):
                    machine.reg_write(register, value)
                result = capture(machine, lambda: RESOURCE.execute(machine, 0x41AF14, RESOURCE.STOP))
                plane = None if owner == 8 else ("auxiliary" if types[unit_type]["auxiliary"] else
                                               "air" if types[unit_type]["flyByte"] else "ground")
                assert len(result["cells"]) == (0 if plane is None else 1)
                if plane is not None:
                    cell = result["cells"][0]
                    assert (cell["plane"], cell["x"], cell["y"]) == (plane, tile_x, tile_y)
                    assert cell["after"] == (cell["before"] & ~1023) | SLOT
                removal = remove(machine, SLOT, plane is not None)
                records.append({"type": unit_type, "owner": owner, "x": tile_x, "y": tile_y,
                                "plane": plane, **result, "removal": removal})
    return records


def exception_cases(scenario, types):
    cases = []
    for name, rows, mode, gate in (
        ("metadata-before-type", [[2, 3, 84, -1, 2]], 0, 0),
        ("poop-disabled", [[2, 3, 37, 0, -1]], 0, 1),
        ("team-disabled", [[2, 3, 41, 0, -1]], 1, 0),
        ("coordinate-fifo", [[2, 3, 37, 0, -1], [2, 3, 41, 0, -1]], 0, 0),
    ):
        result = native_scenario({**scenario, "placementRows": rows}, types, mode, gate)
        result["case"] = name
        assert result["records"][-1]["type"] is None, result
        cases.append(result)
    machine, width, height, path_data = map_fixture(scenario)
    entity = PLACEMENT.GAME + 0x7D28 + SLOT * 220
    RESOURCE.put(machine, entity, 2 * 256 + 128, "H")
    RESOURCE.put(machine, entity + 4, 2 * 256 + 128, "H")
    RESOURCE.put(machine, entity + 6, 84, "B")
    removals = []
    for state in (0, 1, 10):
        for plane in ("ground", "air", "auxiliary"):
            for tile_x, tile_y in ((1, 1), (2, 2), (3, 3)):
                RESOURCE.put(machine, entity + 0x2C, state, "B")
                before = 0x1234A898 if plane == "ground" else 0xA498
                RESOURCE.put(machine, address_at(plane, tile_x, tile_y), before,
                             "I" if plane == "ground" else "H")
                result = remove(machine, SLOT, True)
                assert result["cells"] == [{"plane": plane, "x": tile_x, "y": tile_y,
                                             "before": before, "after": before | 1023}], result
                removals.append({"status": state, "xQ8": 640, "yQ8": 640, **result})
    for plane, tile_x, tile_y in (("auxiliary", 1, 1), ("ground", 1, 2), ("ground", 2, 1)):
        RESOURCE.put(machine, address_at(plane, tile_x, tile_y), SLOT,
                     "I" if plane == "ground" else "H")
    first = remove(machine, SLOT, True)
    assert first["cells"][0]["plane"] == "auxiliary" and first["cells"][0]["x"] == first["cells"][0]["y"] == 1
    assert value_at(machine, "ground", 1, 2) == value_at(machine, "ground", 2, 1) == SLOT
    return {"scn": cases, "removalStatusAndOffsets": removals, "firstMatchOnly": first}


def reinforcement_cases(result):
    records = []
    for action in result["actions"]:
        if action["name"] not in ("reinforce", "reinforce2"):
            continue
        payload = action["nativePayload"]
        for group, (unit_type, count) in enumerate(payload["groups"]):
            if not isinstance(unit_type, int) or result["types"][unit_type]["speed"] != 0 or count <= 0:
                continue
            scenario = next(item for item in result["scenarios"]
                            if item["name"] == str(Path(action["source"]).with_suffix(".SCN")))
            machine, width, height, path_data = map_fixture(scenario)
            owner, requested_x, requested_y = payload["owner"], payload["x"], payload["y"]
            assert all(isinstance(value, int) for value in (owner, requested_x, requested_y))
            machine.mem_write(PLACEMENT.STACK, struct.pack("<2I", RESOURCE.STOP, owner))
            for register, value in ((UC_X86_REG_EAX, PLACEMENT.GAME), (UC_X86_REG_EDX, requested_x),
                                    (UC_X86_REG_EBX, requested_y), (UC_X86_REG_ECX, unit_type),
                                    (UC_X86_REG_ESP, PLACEMENT.STACK)):
                machine.reg_write(register, value)
            observed = capture(machine, lambda: RESOURCE.execute(machine, 0x41B634, RESOURCE.STOP))
            slot = machine.reg_read(UC_X86_REG_EAX)
            assert slot == SLOT
            entity = PLACEMENT.GAME + 0x7D28 + slot * 220
            tile_x, tile_y = RESOURCE.get(machine, entity, "H") >> 8, RESOURCE.get(machine, entity + 4, "H") >> 8
            plane = None if owner == 8 else ("auxiliary" if result["types"][unit_type]["auxiliary"] else
                                            "air" if result["types"][unit_type]["flyByte"] else "ground")
            assert len(observed["cells"]) == (0 if plane is None else 1)
            if plane:
                assert observed["cells"][0]["plane"] == plane
                assert (observed["cells"][0]["x"], observed["cells"][0]["y"]) == (tile_x, tile_y)
            if not result["types"][unit_type]["flyByte"] and unit_type != 40:
                assert path_data[65536 + tile_y * width + tile_x] != 0
            records.append({"source": action["source"], "block": action["block"], "raw": action["raw"],
                            "group": group, "count": count, "requested": [requested_x, requested_y],
                            "type": unit_type, "owner": owner, "x": tile_x, "y": tile_y, "slot": slot,
                            "width": width, "height": height, **observed,
                            "removal": remove(machine, slot, plane is not None)})
    return records


def coverage(result):
    required = [item for item in result["types"] if item["speed"] == 0 and any(
        reference["kind"] != "colony" for reference in item["references"])]
    tested = {item["type"] for item in result.get("constructorCases", [])}
    records = [record for scenario in result.get("nativeScenarios", []) for record in scenario["records"]]
    result["coverage"] = {
        "requiredNoncolonyTypes": [item["type"] for item in required],
        "unsupportedRequiredTypes": [item["type"] for item in required if item["type"] not in tested],
        "unreferencedZeroSpeedTypes": [{"type": item["type"], "name": item["name"]}
            for item in result["types"] if item["speed"] == 0 and not item["references"]],
        "nativeScenarioCount": len(result.get("nativeScenarios", [])),
        "nativeInputRows": sum(item["inputRows"] for item in result.get("nativeScenarios", [])),
        "staticRows": sum(item["type"] is not None for item in records),
        "nonentityRows": sum(item["type"] is None for item in records),
        "planeCounts": {plane: sum(item["type"] is not None and item["plane"] == plane for item in records)
                        for plane in ("ground", "air", "auxiliary", None)},
        "constructorCases": len(result.get("constructorCases", [])),
        "reinforcementGroups": len(result.get("reinforcementCases", [])),
        "coreSourceManifestSha256": hashlib.sha256("".join(sorted(
            f"{item['path']}\t{item['sha256']}\n" for item in result["sources"])).encode("ascii")).hexdigest(),
    }
    if "nativeScenarios" in result:
        assert result["coverage"]["nativeScenarioCount"] == 108
        assert result["coverage"]["nativeInputRows"] == 4377
        assert result["coverage"]["staticRows"] == 2013
        assert result["coverage"]["nonentityRows"] == 601
    if "constructorCases" in result:
        assert len(required) == 23 and not result["coverage"]["unsupportedRequiredTypes"]
    for item in result["types"]:
        kinds = {reference["kind"] for reference in item["references"]}
        item["classification"] = ("colony" if kinds == {"colony"} else "resource" if item["type"] == 40
            else "neutral-coordinate-fifo" if item["type"] == 37 else "vision-entity" if item["type"] == 94
            else "nonentity-metadata-only" if kinds == {"metadata"} else "unit" if kinds else "unreferenced")
        item["constructorPlaneWhenOwnerNot8"] = "auxiliary" if item["auxiliary"] else "air" if item["flyByte"] else "ground"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--auxiliary", action="store_true")
    parser.add_argument("--constructors", action="store_true")
    parser.add_argument("--exceptions", action="store_true")
    parser.add_argument("--reinforcements", action="store_true")
    parser.add_argument("--include-auxiliary", action="store_true")
    parser.add_argument("--executable", choices=("DC.EXE", "DC16.EXE", "MAPED.EXE"), default="DC.EXE")
    arguments = parser.parse_args()
    if arguments.auxiliary:
        print(json.dumps(auxiliary_evidence(arguments.executable), indent=2))
        return
    if arguments.disassemble:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        start, end = arguments.disassemble
        image, sections = read_image(arguments.executable)
        data = next(image[raw + start - address:raw + end - address]
                    for name, address, length, raw, flags in sections if address <= start < end <= address + length)
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(
            data, start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
        return
    result = census()
    if arguments.constructors:
        result["constructorCases"] = constructor_cases(result["scenarios"][0], result["types"])
    if arguments.exceptions:
        result["exceptionCases"] = exception_cases(result["scenarios"][0], result["types"])
    if arguments.reinforcements:
        result["reinforcementCases"] = reinforcement_cases(result)
    if arguments.probe:
        result["nativeScenarios"] = [native_scenario(scenario, result["types"])
                                     for scenario in result["scenarios"]]
    coverage(result)
    if arguments.include_auxiliary:
        result["auxiliaryEvidence"] = [auxiliary_evidence(name) for name in ("DC.EXE", "DC16.EXE", "MAPED.EXE")]
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()