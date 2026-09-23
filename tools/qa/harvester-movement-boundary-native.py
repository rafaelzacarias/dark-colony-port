import hashlib
import json
import random
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
PROBE = runpy.run_path(str(Path(__file__).parents[1] / "research/harvester-handoff-20260919.py"))
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBP, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_EBX, UC_X86_REG_ECX

GAME = PROBE["GAME"]
assert hashlib.sha256(PROBE["IMAGE"]).hexdigest() == PROBE["BASE"]["EXE_HASH"]
FIXTURES = {}


def source_descriptors(native, profiles):
    cursor = PROBE["CONSTRUCTION"]["HEAP"]
    descriptors = {}
    for source in profiles["sources"]:
        path = PROBE["ROOT"] / source["source"]
        data = path.read_bytes()
        tag, timeline_count, state_count, sprite_count = struct.unpack_from("<4H", data)
        frames = cursor
        cursor += timeline_count * 72
        for index in range(state_count):
            offset = 8 + sprite_count * 8 + index * 20
            name = data[offset:offset + 16].split(b"\0")[0].decode()
            first, last = struct.unpack_from("<HH", data, offset + 16)
            if not first <= last < timeline_count:
                continue
            assert native.get(cursor + 0x20) == frames + first * 72
            assert native.get(cursor + 0x24) == frames + last * 72
            descriptors[cursor] = {"source": path.stem, "name": name, "firstTimelineIndex": first, "lastTimelineIndex": last}
            cursor += 48
    return descriptors


def run_case(unit_type, stop_after=None, counter=None, order=2, mobile_first=False, route=None):
    key = (unit_type, mobile_first)
    if key not in FIXTURES:
        fixture = PROBE["fixture"](unit_type, mobile_first)
        emulator = fixture[0].emulator
        FIXTURES[key] = (fixture, emulator.context_save(),
                         [(start, bytes(emulator.mem_read(start, end - start + 1)))
                          for start, end, permissions in emulator.mem_regions()], source_descriptors(fixture[0], fixture[1]))
    fixture, context, memory, descriptors = FIXTURES[key]
    native, profiles, sources, width, resource, source_slot, mobile_slot = fixture
    native.emulator.context_restore(context)
    for address, content in memory:
        native.emulator.mem_write(address, content)
    if route is not None and "slot" in route:
        native.put(GAME + 0x7D28 + mobile_slot * 220 + 0x2C, 0, 1)
        native.put(GAME + 0x468EC + mobile_slot * 2, 65535, 2)
        native.put(0xD20000 + (48 * width + 67) * 4, 1023)
        mobile_slot = route["slot"]
        native.put(GAME + 0x7D20, mobile_slot + 1)
        for offset, value in ((4, 0), (8, route["hp"]), (12, 0), (16, mobile_slot)):
            native.put(PROBE["BASE"]["STACK"] + offset, value)
        native.run(0x41AF14, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: route["start"][0],
                             UC_X86_REG_EBX: route["start"][1], UC_X86_REG_ECX: unit_type})
    entity = GAME + 0x7D28 + mobile_slot * 220
    cells = [48 * width + column for column in (67, 68, 69)]
    target = [17792, 12416]
    if route is not None:
        start, destination = route["start"], route["destination"]
        native.put(0xD20000 + (48 * width + 67) * 4, 1023)
        native.put(GAME + 0x7D28 + source_slot * 220 + 0x2C, 0, 1)
        position = route.get("originQ8", [coordinate * 256 + 128 for coordinate in start])
        native.put(entity, position[0], 2)
        native.put(entity + 4, position[1], 2)
        native.put(entity + 0xCD, start[0], 1)
        native.put(entity + 0xCE, start[1], 1)
        native.put(entity + 9, route["direction"], 1)
        native.put(0xD20000 + (start[1] * width + start[0]) * 4, mobile_slot)
        cells = [row * width + column for row in range(start[1] - 4, start[1] + 5)
                 for column in range(start[0] - 4, start[0] + 5)]
        target = [coordinate * 256 + 128 for coordinate in destination]
    native.put(0x479204, route.get("randomIndex", 82 if order == 7 else 0) if route else (82 if order == 7 else 0))
    baseline = len(native.calls)
    random_writes = []
    writes, visits, route_policy_writes = [], [], []
    update = 0

    def observe(emulator, access, address, size, value, data):
        if address == 0x479204:
            random_writes.append({"eip": hex(emulator.reg_read(UC_X86_REG_EIP)), "value": value})
        if 0xD20000 <= address < 0xD20000 + width * 84 * 4 or entity + 0x86 <= address < entity + 0x96:
            writes.append({"update": update, "eip": hex(emulator.reg_read(UC_X86_REG_EIP)),
                           "address": address, "size": size, "before": native.get(address, size), "after": value})

    write_hook = native.emulator.hook_add(UC_HOOK_MEM_WRITE, observe)

    def packet(entry, payload):
        native.emulator.mem_write(0x701100, payload)
        native.put(0x701000, 0x701100)
        native.run(entry, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
        assert native.get(0x701000) == 0x701100 + len(payload)

    def snapshot():
        depth = native.get(entity + 0x38, 1)
        stack = []
        for level in range(depth + 1):
            start = native.get(entity + 0x3A + level * 2, 1)
            end = native.get(entity + 0x3A + (level + 1) * 2, 1)
            assert end >= start
            stack.append({"opcode": native.get(entity + 0x39 + level * 2, 1), "offset": start,
                          "words": [native.get(entity + 0x46 + index * 2, 2) for index in range(start, end)]})
        return {"raw": list(native.emulator.mem_read(entity, 220)), "stack": stack,
            "pathBytes": list(native.emulator.mem_read(entity + 0x86, 16)),
                "xQ8": native.get(entity, 2), "yQ8": native.get(entity + 4, 2),
                "targetXQ8": native.get(entity + 0x2E, 2), "targetYQ8": native.get(entity + 0x30, 2),
                "pending": native.get(entity + 0x36, 1), "order": native.get(entity + 0x37, 1),
                "randomIndex": native.get(0x479204), "direction": native.get(entity + 9, 1),
                "ground": [native.get(0xD20000 + cell * 4) for cell in cells]}

    def visit(emulator, address, size, data):
        if address in (0x419458, 0x419576) and emulator.reg_read(UC_X86_REG_ESI) == entity:
            depth = native.get(entity + 0x38, 1)
            if route is not None and not route_policy_writes and address == 0x419458 and native.get(entity + 0x39 + depth * 2, 1) == 6:
                start, destination = route["start"], route["destination"]
                delta = tuple((target > origin) - (target < origin) for origin, target in zip(start, destination))
                vectors = [struct.unpack("<ii", bytes(emulator.mem_read(0x479208 + index * 8, 8))) for index in range(8)]
                code = vectors.index(delta)
                count = max(abs(target - origin) for origin, target in zip(start, destination))
                payload = entity + 0x46 + native.get(entity + 0x3A + depth * 2, 1) * 2
                backing = bytearray(16)
                for index in range(count):
                    backing[index // 2] |= code << ((index & 1) * 4)
                emulator.mem_write(entity + 0x86, bytes(backing))
                emulator.mem_write(payload, struct.pack("<8H", count - 1, count, *start, int(order == 7), 65535, 65535, 0))
                route_policy_writes.append({"boundary": "before-first-task6", "policy": "external-direct-straight",
                                            "backing": list(backing), "count": count})
            visits.append({"update": update, "boundary": hex(address), "state": snapshot()})

    visit_hook = native.emulator.hook_add(UC_HOOK_CODE, visit)

    command_before = snapshot()
    packet(0x41DD2C, struct.pack("<Bhh", 0, mobile_slot, -1))
    packet(0x41D4F4, struct.pack("<BBhh", 1, 0, *target))
    packet(0x41CE9C, bytes((0, order)))
    trace = []
    mutation = None
    for update in range(1, 81 if route is not None else 34):
        if stop_after == update - 1:
            before = snapshot()
            packet(0x41CE54, struct.pack("<hB", mobile_slot, 13))
            mutation = {"before": before, "after": snapshot()}
        if counter is not None and update == (11 if unit_type == 6 else 14):
            before = snapshot()
            assert before["stack"][-1]["opcode"] == 5
            payload = before["stack"][-1]["offset"]
            native.put(entity + 0x46 + (payload + 2) * 2, counter, 2)
            mutation = {"before": before, "after": snapshot()}
        before = snapshot()
        native.put(0x70D800 - 4, GAME)
        native.run(0x41989E, {UC_X86_REG_EBP: 0x70D800}, 0x4198C3)
        native.put(0x4956E0 + 20, 0)
        native.run(0x419BB8, {UC_X86_REG_EBP: 0x70D800}, 0x419C0E)
        trace.append({"update": update, "before": before, "after": snapshot()})
        if route is not None and update > 1 and snapshot()["stack"][0]["opcode"] == 1:
            break
    assert native.calls[baseline:] == []
    native.emulator.hook_del(write_hook)
    native.emulator.hook_del(visit_hook)
    record = 0x4F1880 + unit_type * 280
    banks = {name: native.get(record + offset) for name, offset in (("stand", 0x80), ("move", 0x7C),
                                                                  ("deploy", 0x94), ("preservedIdle", 0x9C))}
    suffix = bytes(native.emulator.mem_read(0x476814, 16)).split(b"\0")[0].decode()
    animations = {str(bank): [[native.get(native.get(native.get(bank + direction * 4) + 0x20) + frame * 72 + 2, 1)
                      for frame in range(native.get(native.get(bank + direction * 4) + 0x28))]
                     for direction in range(32)] for bank in banks.values() if bank}
    return {"unitType": unit_type, "order": order, "mobileFirst": mobile_first, "mobileSlot": mobile_slot,
            "route": route, "groundCells": cells, "commandTarget": target,
            "routePolicyWrites": route_policy_writes,
            "finBindings": {str(bank): [descriptors[native.get(bank + direction * 4)] for direction in range(32)]
                            for bank in banks.values() if bank},
            "commandBefore": command_before,
            "motion": {"speedQ8": native.get(record + 12), "turnStep": native.get(record + 8),
                       "vectors": [list(struct.unpack("<ii", bytes(native.emulator.mem_read(0x479208 + index * 8, 8)))) for index in range(8)],
                       "sineQuarterQ11": [native.get(0x4796B8 + index * 64, 2) for index in range(65)],
                       "atanQ13": [native.get(0x47A6BA + index * 2, 2) for index in range(257)]},
            "speedRecord": list(native.emulator.mem_read(record, 0x40)),
            "sourceSlot": source_slot, "stopAfter": stop_after, "counterOverride": counter,
            "scope": "original HUMAN02 MAP/PTH/FIN, source-separated legal constructors; not full mission admission; counter overrides synthetic",
            "corridor": {"width": width, "height": 84, "from": [67, 48], "to": [69, 48],
                         "families": [sources["PTH"][65536 + 48 * width + column] for column in (67, 68, 69)]},
            "banks": banks, "animations": animations, "preservedIdleSuffix": suffix, "mutation": mutation, "trace": trace,
            "visits": visits, "writes": writes,
            "randomWrites": random_writes, "runtimeInterceptions": native.calls[baseline:],
            "sourceHashes": {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()}}


def turn_sweep(unit_type):
    native = FIXTURES[(unit_type, False)][0][0]
    entity = GAME + 0x7D28 + 153 * 220
    native.put(entity + 6, unit_type, 1)
    cases, rng = [], []
    def observe(emulator, access, address, size, value, data):
        if address == 0x479204:
            rng.append(value)
    hook = native.emulator.hook_add(UC_HOOK_MEM_WRITE, observe)
    baseline = len(native.calls)
    for target in range(0, 256, 32):
        for initial in range(256):
            native.put(entity + 9, initial, 1)
            ticks = []
            for update in range(14):
                native.run(0x4120FC, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 153, UC_X86_REG_EBX: target})
                ticks.append(native.get(entity + 9, 1))
                if native.emulator.reg_read(UC_X86_REG_EAX) == 0:
                    break
            assert ticks[-1] == target
            cases.append({"typeId": unit_type, "initial": initial, "target": target, "ticks": ticks})
    native.emulator.hook_del(hook)
    assert not rng and native.calls[baseline:] == []
    return cases


if "--generalized" in sys.argv or "--smoke" in sys.argv:
    vectors = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    pth = (PROBE["ROOT"] / "raw_cd/DC/SCENARIO/HUMAN/HUMAN02.PTH").read_bytes()
    centers = [(column, row) for row in range(4, 80) for column in range(4, 92)
               if all(pth[65536 + near_row * 96 + near_column] not in (0, 255)
                      for near_row in range(row - 3, row + 4) for near_column in range(column - 3, column + 4))]
    origin = min(centers, key=lambda point: abs(point[0] - 67) + abs(point[1] - 48))
    cases = [run_case(kind, route={"start": list(origin), "destination": [origin[0] + delta[0] * length, origin[1] + delta[1] * length],
                                  "direction": direction})
             for kind in (6, 14) for delta in vectors for length in (1, 2, 3)
             for direction in ((0,) if "--smoke" in sys.argv else (0, 1, 127, 128, 129, 255))]
    if "--generalized" in sys.argv:
        for current in list(cases):
            if current["route"]["direction"] != 129 or max(abs(target - start) for target, start in
                zip(current["route"]["destination"], current["route"]["start"])) != 3:
                continue
            for boundary in ("step-zero", "next-leg", "task8"):
                frame = next(frame for frame in current["trace"] if
                    (boundary == "step-zero" and frame["before"]["stack"][-1]["opcode"] == 5 and frame["before"]["stack"][-1]["words"][2] == 0) or
                    (boundary == "next-leg" and frame["before"]["stack"][-1]["opcode"] == 6 and frame["before"]["stack"][-1]["words"][0] != 65535) or
                    (boundary == "task8" and frame["before"]["stack"][-1]["opcode"] == 8))
                cases.append(run_case(current["unitType"], stop_after=frame["update"] - 1, route={**current["route"], "stopBoundary": boundary}))
        generator = random.Random(20260919)
        for kind in (6, 14):
            for index, start in enumerate(generator.sample(centers, 16)):
                delta = vectors[index % 8]
                length = index % 3 + 1
                cases.append(run_case(kind, order=7 if index & 1 else 2, route={"start": list(start),
                    "destination": [start[0] + delta[0] * length, start[1] + delta[1] * length],
                    "direction": generator.randrange(256), "slot": generator.randrange(200, 800),
                    "hp": generator.randrange(600, 801), "randomIndex": generator.randrange(256),
                    "originQ8": [coordinate * 256 + generator.randrange(64, 193) for coordinate in start]}))
        source_rows = [list(map(int, line.split())) for line in
                       (PROBE["ROOT"] / "raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN").read_text().splitlines()
                       if len(line.split()) == 5 and all(field.lstrip("-").isdigit() for field in line.split())
                       and line.split()[2] == "40"]
        for kind in (6, 14):
            for source in source_rows:
                for index, delta in enumerate(vectors):
                    length = index % 3 + 1
                    start = [source[axis] - delta[axis] * length for axis in range(2)]
                    if not all(4 <= start[axis] < (92, 80)[axis] for axis in range(2)):
                        continue
                    cells = [(start[0] + delta[0] * step, start[1] + delta[1] * step) for step in range(length + 1)]
                    if delta[0] and delta[1]:
                        cells += [(column - delta[0], row) for column, row in cells[1:]] + [(column, row - delta[1]) for column, row in cells[1:]]
                    if any(pth[65536 + row * 96 + column] in (0, 255) for column, row in cells):
                        continue
                    cases.append(run_case(kind, route={"start": start, "destination": source[:2],
                        "direction": generator.randrange(256), "slot": generator.randrange(200, 800), "hp": 800,
                        "randomIndex": generator.randrange(256), "sourcePoint": source}))
    print(json.dumps({"executableSha256": hashlib.sha256(PROBE["IMAGE"]).hexdigest(), "cases": cases,
                      "turnSweep": [entry for kind in (6, 14) for entry in turn_sweep(kind)] if "--generalized" in sys.argv else []}))
else:
    print(json.dumps({"executableSha256": hashlib.sha256(PROBE["IMAGE"]).hexdigest(),
                  "cases": [run_case(kind, stop_after=stop) for kind in (6, 14) for stop in (0, 10, 15, 16, 22, 28)]
                        + [run_case(kind, counter=counter) for kind in (6, 14) for counter in (0, 1, 6)]
                        + [run_case(kind, order=order, mobile_first=first)
                            for kind in (6, 14) for order in (2, 7) for first in (False, True)]}))