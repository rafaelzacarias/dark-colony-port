"""Original group-3 callbacks, complete buffers and ordered RNG/packet evidence."""

import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ai_policy", Path(__file__).with_name("ai-policy-20260919.py"))
AI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AI)
CALLBACKS = (0x459F24, 0x44BBDC, 0x44B920, 0x459F80)


def capture(faction, team, natural_paths):
    spec = importlib.util.spec_from_file_location("placement", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    machine, _, _, width, families = AI.source_fixture(
        faction, team, lambda *args: AI.initialize_source_world(*args, placement))
    encode = lambda address, size: base64.b64encode(machine.mem_read(address, size)).decode()
    snapshot = lambda: {"policy": encode(AI.POLICY, 0x6C40),
                        "entities": encode(AI.NATIVE.GAME + 0x7D28, 800 * 220),
                        "rngCursor": AI.dword(machine, 0x479204),
                        "forceOrder": machine.mem_read(0x489510, 1)[0]}
    initial = None

    def entry(emulator, address, size, context):
        nonlocal initial
        if address == 0x459F24:
            initial = snapshot()
            emulator.emu_stop()
        else:
            emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, entry, begin=address, end=address)
             for address in (0x459F24, 0x421725)]
    try:
        AI.invoke(machine, 0x44BE40, eax=AI.NATIVE.GAME, edx=team)
    except AssertionError:
        assert initial is not None
    for hook in hooks:
        machine.hook_del(hook)
    assert initial is not None
    events, packets, cases, branches = [], [], [], set()
    branch_addresses = (0x459FFE, 0x45A012, 0x45A021, 0x45A02D, 0x45A123, 0x45A130,
                        0x45A158, 0x45A1E9, 0x45A2AA, 0x45A2D0, 0x45A2F3, 0x45A325,
                        0x45A36B, 0x45A3DA, 0x45A3E6, 0x45A420, 0x45A477,
                        0x45A4E9, 0x45A589, 0x45A628, 0x45A652, 0x45A65D,
                        0x45A675, 0x45A692, 0x45A69D, 0x45A6D2, 0x45A6D6)

    def branch(emulator, address, size, context):
        branches.add(address)

    for address in branch_addresses:
        machine.hook_add(AI.UC_HOOK_CODE, branch, begin=address, end=address)

    def observe(emulator, address, size, context):
        if address == 0x421725:
            pointer = emulator.reg_read(AI.UC_X86_REG_ESI)
            length = struct.unpack("<H", emulator.mem_read(pointer, 2))[0]
            packet = bytes(emulator.mem_read(pointer, length)).hex()
            packets.append(packet)
            events.append({"packet": packet})
            emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)
        elif address == 0x411DB4:
            events.append({"rngCursor": AI.dword(emulator, 0x479204)})
        else:
            events.append({"callback": address})

    for address in (*CALLBACKS, 0x411DB4, 0x40C414, 0x421725):
        machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)

    def restore(before=initial):
        machine.mem_write(AI.POLICY, base64.b64decode(before["policy"]))
        machine.mem_write(AI.NATIVE.GAME + 0x7D28, base64.b64decode(before["entities"]))
        AI.put(machine, 0x479204, before["rngCursor"])
        machine.mem_write(0x489510, bytes((before["forceOrder"],)))

    def run(label):
        events.clear()
        packets.clear()
        branches.clear()
        before = snapshot()
        stages = []
        for callback in CALLBACKS:
            AI.invoke(machine, callback, instruction_limit=20000000,
                      eax=AI.NATIVE.GAME, edx=AI.POLICY, ebx=3, ecx=team)
            if label == "source-invocation" or label.startswith("natural-"):
                stages.append({"callback": callback, "after": snapshot()})
        cases.append({"label": label, "before": before, "after": snapshot(),
                      "stages": stages, "events": events[:], "packets": packets[:],
                      "branches": sorted(branches)})

    run("source-invocation")
    for path in natural_paths:
        content = Path(path).read_bytes()
        for line in content.splitlines():
            natural = json.loads(line)
            if natural["mission"] != faction + "02":
                continue
            assert natural["acceptance"]["naturalSchedulerActivation"]
            assert natural["executableSha256"] == AI.NATIVE.AUDIT.DIGEST
            assert natural["sourcePathInitialization"]["familyGraphSha256"] == hashlib.sha256(
                machine.mem_read(AI.MAP + 0x984A8, 256 * 32)).hexdigest()
            completed = next(group for group in natural["groupCompletions"] if group["group"] == 3)
            assert completed["team"] == team
            restore({"policy": completed["policy"]["before"], "entities": completed["entities"]["before"],
                     "rngCursor": completed["rngBefore"], "forceOrder": 0})
            run(f"natural-frame-{completed['frame']}")
            assert cases[-1]["after"]["policy"] == completed["policy"]["after"]
            local_match = cases[-1]["after"]["entities"] == completed["entities"]["after"]
            for packet in packets[:]:
                payload = bytes.fromhex(packet)
                machine.mem_write(0x709000, payload)
                AI.invoke(machine, 0x41DEFC, eax=AI.NATIVE.GAME, edx=0x709002, ebx=len(payload) - 2)
            assert snapshot()["entities"] == completed["entities"]["after"]
            assert cases[-1]["after"]["rngCursor"] == completed["rngAfter"]
            assert completed["callbacks"] == [hex(callback) for callback in CALLBACKS]
            submitted = [order["packet"] for order in natural["submittedOrders"]
                         if order["frame"] == completed["frame"] and order["team"] == team]
            assert any(submitted[index:index + len(packets)] == packets
                       for index in range(len(submitted) - len(packets) + 1))
            cases[-1]["historical"] = {"sha256": hashlib.sha256(content).hexdigest(),
                "frame": completed["frame"], "localEntitiesMatched": local_match,
                "originalReceivedEntitiesMatched": True, "originalPolicyMatched": True,
                "packetSubsequenceMatched": True}
    group = AI.POLICY + 3 * 0x12FC
    pool = AI.NATIVE.GAME + 0x7D28
    rng = list(struct.unpack("<256i", machine.mem_read(0x478E04, 1024)))
    height = len(families) // width
    source_types = encode(0x4F1880, 110 * 280)
    region = next(value for value in range(1, 255) if value in families)
    cell = families.index(region)
    origin = (cell % width, cell // width)

    def cursor(predicate):
        return next(index for index in range(256) if predicate([rng[(index + offset) & 255] for offset in range(1, 6)]))

    def members(count=1, unit_type=8, mode=0, task=1):
        restore()
        for record in range(256):
            base = AI.POLICY + record * 18
            for offset in (4, 8, 12):
                machine.mem_write(base + offset, b"\xff")
                machine.mem_write(base + offset + 2, bytes(2))
            machine.mem_write(base + 16, bytes(2))
        slots = list(range(800 - count, 800))
        machine.mem_write(group + 0x1FAA, struct.pack("<hh", slots[0] if slots else -1, slots[-1] if slots else -1))
        for index, slot in enumerate(slots):
            actor = pool + slot * 220
            machine.mem_write(actor, bytes(220))
            machine.mem_write(actor, struct.pack("<H", origin[0] * 256 + 128))
            machine.mem_write(actor + 4, struct.pack("<H", origin[1] * 256 + 128))
            machine.mem_write(actor + 6, bytes((unit_type, team)))
            machine.mem_write(actor + 0x2C, b"\x01")
            machine.mem_write(actor + 0x39, bytes((task,)))
            machine.mem_write(actor + 0xCC, bytes((mode,)))
            machine.mem_write(actor + 0xD2, struct.pack("<hh", slots[index + 1] if index + 1 < count else -1,
                                                     slots[index - 1] if index else -1))
        return slots

    def resources(count):
        for slot in range(800):
            actor = pool + slot * 220
            if machine.mem_read(actor + 6, 1)[0] == 40:
                machine.mem_write(actor + 0x2C, b"\x0a")
        cells = [index for index, value in enumerate(families) if value]
        for index in range(count):
            actor = pool + index * 220
            selected = cells[(index * 97) % len(cells)]
            machine.mem_write(actor, struct.pack("<H", selected % width * 256 + 128))
            machine.mem_write(actor + 4, struct.pack("<H", selected // width * 256 + 128))
            machine.mem_write(actor + 6, b"\x28")
            machine.mem_write(actor + 0x2C, b"\x01")

    for count in (0, 1, 4, 9, 49, 128, 648):
        members(count, task=9)
        run(f"member-count-{count}")
    for unit_type in (*range(16), 40, 41, 42, 49, 50, 109):
        members(unit_type=unit_type)
        AI.put(machine, 0x479204, cursor(lambda values: values[0] & 1))
        run(f"source-type-{unit_type}")
    for mode in (0, 4, 5, 6):
        for task in (1, 9):
            members(mode=mode, task=task)
            run(f"mode-{mode}-task-{task}")
    for label in ("gate-hit", "gate-miss", "feedback", "rng-wrap", "force-255", "cleanup-mixed",
                  "cleanup-all", "empty-wrap", "disabled-bucket", "objective-score", "objective-tie",
                  "objective-subtract", "objective-own", "objective-second-ring", "signed-owner",
                  "random-retry", "no-resources", "resource-1", "resource-2", "resource-257",
                  "resource-danger", "resource-owner-zero", "resource-signed-cancel", "resource-dead",
                  "resource-inactive", "resource-family-zero"):
        slots = members(4 if label.startswith("cleanup") else 0 if label == "empty-wrap" else 1,
                        mode=6 if label in ("gate-hit", "gate-miss", "feedback") else 0)
        actor = pool + 799 * 220
        if label in ("gate-hit", "gate-miss", "feedback"):
            AI.put(machine, 0x479204, cursor(lambda values: (values[0] & 63 == 0) == (label == "gate-hit")))
            machine.mem_write(actor + 0xC9, bytes((int(label == "feedback"),)))
        elif label == "rng-wrap":
            AI.put(machine, 0x479204, 255)
        elif label == "force-255":
            machine.mem_write(0x489510, b"\xff")
        elif label.startswith("cleanup"):
            for slot in slots if label == "cleanup-all" else (slots[0], slots[2], slots[3]):
                machine.mem_write(pool + slot * 220 + 0x2C, b"\x0a")
        elif label == "empty-wrap":
            AI.put(machine, group + 0x1E8C, 0xFFFFFF00)
        elif label == "disabled-bucket":
            machine.mem_write(group + 0x1E95, b"\0")
        elif label.startswith("objective") or label == "signed-owner":
            AI.put(machine, 0x479204, cursor(lambda values: values[0] & 1 == 0))
            for target in (region, region + 1):
                machine.mem_write(AI.POLICY + target * 18 + 8, bytes(((team + 1) % 8,)))
                machine.mem_write(AI.POLICY + target * 18 + 10, struct.pack("<H", 20 if target == region else 10))
                machine.mem_write(AI.POLICY + target * 18 + 16, b"\x01\0")
            if label == "objective-tie":
                machine.mem_write(AI.POLICY + (region + 1) * 18 + 10, struct.pack("<H", 20))
            elif label == "objective-subtract":
                machine.mem_write(AI.POLICY + region * 18 + 12, bytes(((team + 1) % 8,)))
                machine.mem_write(AI.POLICY + region * 18 + 14, struct.pack("<H", 30))
            elif label == "objective-own":
                machine.mem_write(AI.POLICY + region * 18 + 8, bytes((team,)))
            elif label == "objective-second-ring":
                graph = machine.mem_read(AI.MAP + 0x984A8, 8192)
                near = graph[region * 32 + 1]
                far = graph[near * 32 + 1]
                machine.mem_write(AI.POLICY + far * 18 + 4, bytes(((team + 1) % 8,)))
            elif label == "signed-owner":
                machine.mem_write(AI.POLICY + region * 18 + 8, b"\xfe")
        elif label == "random-retry":
            AI.put(machine, 0x479204, cursor(lambda values: values[0] & 1 and values[1] & 3
                and not families[(values[3] % (height - 5)) * width + values[2] % width]))
        else:
            AI.put(machine, 0x479204, cursor(lambda values: values[0] & 1 and values[1] & 3 == 0))
            count = int(label.split("-")[-1]) if label in ("resource-1", "resource-2", "resource-257") else 0 if label == "no-resources" else 1
            resources(count)
            if label == "resource-signed-cancel":
                graph = machine.mem_read(AI.MAP + 0x984A8, 8192)
                selected = next(index for index, value in enumerate(families)
                                if value and graph[value * 32] and graph[value * 32 + 1] != value)
                machine.mem_write(pool, struct.pack("<H", selected % width * 256))
                machine.mem_write(pool + 4, struct.pack("<H", selected // width * 256))
            resource_region = families[(struct.unpack("<H", machine.mem_read(pool + 4, 2))[0] >> 8) * width
                                       + (struct.unpack("<H", machine.mem_read(pool, 2))[0] >> 8)] if count else 0
            if label in ("resource-danger", "resource-owner-zero", "resource-signed-cancel"):
                machine.mem_write(AI.POLICY + resource_region * 18 + 12,
                                  bytes((0 if label == "resource-owner-zero" else 3,)))
                if label == "resource-signed-cancel":
                    near = machine.mem_read(AI.MAP + 0x984A8 + resource_region * 32 + 1, 1)[0]
                    adjacent = list(graph[resource_region * 32 + 1:resource_region * 32 + 1 + graph[resource_region * 32]])
                    negative = -3 * (1 + adjacent.count(resource_region))
                    assert adjacent.count(near) == 1
                    machine.mem_write(AI.POLICY + near * 18 + 12, struct.pack("<b", negative))
            elif label == "resource-dead":
                machine.mem_write(pool + 0x2C, b"\x0a")
            elif label == "resource-inactive":
                machine.mem_write(pool + 0x2C, b"\0")
            elif label == "resource-family-zero":
                empty = families.index(0)
                machine.mem_write(pool, struct.pack("<H", empty % width * 256))
                machine.mem_write(pool + 4, struct.pack("<H", empty // width * 256))
        run(label)
        if label == "resource-signed-cancel":
            assert 0x45A628 not in cases[-1]["branches"]
    for axis, direction in ((0, -1), (0, 1), (1, -1), (1, 1)):
        if faction == "ALIEN" and axis == 1 and direction == -1:
            continue
        members()
        resources(1)
        edge = next(index for index, value in enumerate(families) if value and
                    (index % width if axis == 0 else index // width) ==
                    (0 if direction == -1 else (width if axis == 0 else height) - 1))
        machine.mem_write(pool, struct.pack("<H", edge % width * 256))
        machine.mem_write(pool + 4, struct.pack("<H", edge // width * 256))
        machine.mem_write(AI.POLICY + families[edge] * 18 + 12, b"\x03")
        AI.put(machine, 0x479204, cursor(lambda values: values[0] & 1 and values[1] & 3 == 0
               and ((values[3 + axis] & 15) - 8) * direction > 0))
        run(f"resource-clamp-{axis}-{direction}")
    for unit_type, count in ((0, 1), (8, 4), (5, 9), (13, 49), (4, 4), (49, 4),
                             (50, 4), (1, 4), (9, 4), (6, 4), (14, 4), (41, 4), (42, 4)):
        restore()
        machine.mem_write(AI.POLICY, machine.ai_initialized_policy)
        machine.mem_write(pool, bytes(800 * 220))
        for slot in range(152, 152 + count):
            actor = pool + slot * 220
            machine.mem_write(actor, struct.pack("<H", origin[0] * 256 + 128))
            machine.mem_write(actor + 4, struct.pack("<H", origin[1] * 256 + 128))
            machine.mem_write(actor + 6, bytes((unit_type, team)))
            machine.mem_write(actor + 0x2C, b"\x01")
            machine.mem_write(actor + 0x39, b"\x01")
            machine.mem_write(actor + 0xD2, struct.pack("<hh", -2, -2))
        AI.invoke(machine, 0x457568, eax=AI.NATIVE.GAME, edx=team, ebx=AI.POLICY)
        membership = []
        for group_index in range(4):
            for bucket in range(16):
                base = AI.POLICY + group_index * 0x12FC + bucket * 300
                if machine.mem_read(base + 0x1E95, 1)[0] == 0:
                    continue
                slot = struct.unpack("<h", machine.mem_read(base + 0x1FAA, 2))[0]
                while slot != -1:
                    membership.append({"slot": slot, "group": group_index, "bucket": bucket,
                                       "type": machine.mem_read(pool + slot * 220 + 6, 1)[0]})
                    slot = struct.unpack("<h", machine.mem_read(pool + slot * 220 + 0xD2, 2))[0]
        assert len(membership) == (0 if unit_type in (41, 42) else count), (unit_type, count, membership)
        if unit_type in (0, 8, 5, 13):
            assert all(member["group"] == 3 for member in membership)
        run(f"native-assignment-type-{unit_type}-count-{count}")
        cases[-1]["assignment"] = {"callback": "0x457568", "unitType": unit_type,
                                    "count": count, "membership": membership}
    print(json.dumps({"mission": faction + "02", "team": team, "binarySha256": AI.NATIVE.AUDIT.DIGEST,
        "navigation": {"width": width, "height": len(families) // width,
                       "families": base64.b64encode(families).decode(),
                       "nextFamily": encode(AI.MAP + 0x884A8, 65536)},
        "neighbors": encode(AI.MAP + 0x984A8, 256 * 32), "sourceTypes": source_types,
        "rngTable": list(struct.unpack("<256i", machine.mem_read(0x478E04, 1024))),
        "bodies": [{"address": address, "bytes": base64.b64encode(AI.NATIVE.READ(address, size)).decode()}
               for address, size in ((0x459EC0, 0xC0), (0x459F80, 0x7A1), (0x44B920, 5),
                         (0x44BA48, 0x1A4), (0x45A724, 7), (0x411DB4, 0x21),
                         (0x40C414, 0xDB), (0x421648, 0x126))], "cases": cases}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--natural-trace", action="append", default=[])
    parser.add_argument("--disassemble", action="store_true")
    arguments = parser.parse_args()
    if arguments.disassemble:
        for address, size in ((0x411DB4, 0x40), (0x45A724, 0x180), (0x40C414, 0x150)):
            for instruction in AI.Cs(AI.CS_ARCH_X86, AI.CS_MODE_32).disasm(AI.NATIVE.READ(address, size), address):
                print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
    else:
        for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
            capture(faction, team, arguments.natural_trace)