"""Full group-zero native boundary oracle; no order execution substitution."""

import argparse
import base64
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ai_policy", Path(__file__).with_name("ai-policy-20260919.py"))
AI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AI)
from unicorn import UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE


def capture(faction, team, natural_traces):
    machine, cities, resources, width, families = AI.source_fixture(faction, team)
    height = len(families) // width
    pool = AI.NATIVE.GAME + 0x7D28
    encode = lambda address, length: base64.b64encode(machine.mem_read(address, length)).decode()
    snapshot = lambda: {"policy": encode(AI.POLICY, 0x6C40), "entities": encode(pool, 800 * 220),
                        "rngCursor": AI.dword(machine, 0x479204),
                        "forceOrder": machine.mem_read(0x489510, 1)[0]}
    original_policy = bytes(machine.mem_read(AI.POLICY, 0x6C40))
    original_graph = bytes(machine.mem_read(AI.MAP + 0x984A8, 256 * 32))
    original_next = bytes(machine.mem_read(AI.MAP + 0x884A8, 65536))
    original_families = bytes(machine.mem_read(AI.PATH_CELLS, width * height * 24))
    callbacks = (0x4578A0, 0x44BBDC, 0x44B920, 0x4598B0)
    events, packets, cases = [], [], []
    rng_accesses = []

    def rng_access(emulator, access, address, size, value, context):
        rng_accesses.append({"address": address, "access": access, "size": size})

    machine.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, rng_access, begin=0x478E04, end=0x479207)

    def observe(emulator, address, size, context):
        if address == 0x421725:
            pointer = emulator.reg_read(AI.UC_X86_REG_ESI)
            length = struct.unpack("<H", emulator.mem_read(pointer, 2))[0]
            packet = bytes(emulator.mem_read(pointer, length)).hex()
            packets.append(packet)
            events.append({"packet": packet})
            emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)
        else:
            events.append({"callback": address})

    for address in (*callbacks, 0x45817C, 0x421725):
        machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)

    def actor(slot, kind, tile_x, tile_y, objective=0, counter=0, stationary=False, owner=team):
        pointer = pool + slot * 220
        machine.mem_write(pointer, bytes(220))
        machine.mem_write(pointer, struct.pack("<H", tile_x * 256 + 128))
        machine.mem_write(pointer + 4, struct.pack("<H", tile_y * 256 + 128))
        machine.mem_write(pointer + 6, bytes((kind, owner)))
        machine.mem_write(pointer + 0x11, bytes((objective,)))
        machine.mem_write(pointer + 0x2C, b"\x01")
        machine.mem_write(pointer + 0xCD, bytes((tile_x if stationary else 0, tile_y if stationary else 0, counter)))

    def link(slots):
        machine.mem_write(AI.POLICY + 0x1FAA, struct.pack("<hh", slots[0] if slots else -1, slots[-1] if slots else -1))
        for index, slot in enumerate(slots):
            machine.mem_write(pool + slot * 220 + 0xD2, struct.pack("<hh",
                slots[index + 1] if index + 1 < len(slots) else -1, slots[index - 1] if index else -1))

    def reset():
        machine.mem_write(AI.POLICY, original_policy)
        machine.mem_write(pool, bytes(800 * 220))
        machine.mem_write(AI.MAP + 0x984A8, original_graph)
        machine.mem_write(AI.MAP + 0x884A8, original_next)
        machine.mem_write(AI.PATH_CELLS, original_families)
        machine.mem_write(AI.GROUND, struct.pack("<I", 1023) * width * height)
        AI.put(machine, 0x479204, 255)
        machine.mem_write(0x489510, b"\x01")
        AI.put(machine, AI.POLICY + 0x1E8C, 0xFFFFFFF0)
        actor(200, 14 if faction == "HUMAN" else 6, *cities[0])
        link([200])
        for index, (tile_x, tile_y, kind, rate, reserve) in enumerate(resources):
            actor(300 + index, kind, tile_x, tile_y, owner=8)
            machine.mem_write(pool + (300 + index) * 220 + 0x32, struct.pack("<H", rate))

    def run(label):
        events.clear()
        packets.clear()
        rng_accesses.clear()
        before = snapshot()
        inputs = {"neighbors": encode(AI.MAP + 0x984A8, 256 * 32),
                  "groundCells": encode(AI.GROUND, width * height * 4)}
        navigation = {"width": width, "height": height,
            "families": base64.b64encode(bytes(machine.mem_read(AI.dword(machine,
                AI.dword(machine, AI.MAP + 0x1404) + tile_y * 4) + tile_x * 24 + 12, 1)[0]
                for tile_y in range(height) for tile_x in range(width))).decode(),
            "nextFamily": encode(AI.MAP + 0x884A8, 65536)}
        for callback in callbacks:
            AI.invoke(machine, callback, eax=AI.NATIVE.GAME, edx=AI.POLICY, ebx=0, ecx=team)
        after = snapshot()
        assert after["rngCursor"] == before["rngCursor"]
        assert after["forceOrder"] == before["forceOrder"]
        assert not rng_accesses, rng_accesses
        cases.append({"label": label, "before": before, "after": after, "inputs": inputs,
                  "navigation": navigation, "packets": packets[:], "events": events[:], "rngAccesses": []})

    origin = families[cities[0][1] * width + cities[0][0]]
    preferred = (69, 48) if faction == "HUMAN" else (4, 80)
    target = families[preferred[1] * width + preferred[0]]
    controls = ("baseline", "preferred-occupied", "zero-rate", "dead", "rotting", "wrong-type", "occupied",
        "route-score", "no-route", "zero-origin", "empty", "cleanup", "cleanup-all", "last-unassigned",
        "assigned-exclusion", "rank-tie", "rank255", "all-assigned", "own-score", "signed-owner", "unowned-score",
        "mobile-safe", "mobile-unsafe", "mobile-missing-route", "mobile-stale", "mobile-counter9", "mobile-counter10",
        "mobile-counter254", "mobile-counter255", "mobile-moved", "deploy47", "deploy48", "other-type", "owner-not-team",
        "mask-isolated", "mask-two-rings", "mask-third-ring", "mask-deduplicated", "mask-low-region", "slot799",
        "same-family", "high-ground-bits", "zero-target", "slot0", "allied-score", "graph-count31",
        "graph-count0-tail", "status2", "multiple-maintenance", "unsafe-reassigned", "fractional-target",
        "rank-unsigned", "stale-no-resource")
    for control in controls:
        reset()
        if control == "empty":
            link([])
        elif control in ("cleanup", "cleanup-all", "last-unassigned", "assigned-exclusion"):
            actor(201, 47, *cities[0], objective=target if control == "assigned-exclusion" else 0)
            actor(202, 6, *cities[0])
            link([202, 201, 200])
            if control.startswith("cleanup"):
                for slot in ([202, 201, 200] if control == "cleanup-all" else [202, 200]):
                    machine.mem_write(pool + slot * 220 + 0x2C, b"\x0a")
        elif control in ("zero-rate", "dead", "rotting", "wrong-type", "occupied", "preferred-occupied"):
            for index, (tile_x, tile_y, *_) in enumerate(resources):
                pointer = pool + (300 + index) * 220
                if control == "zero-rate":
                    machine.mem_write(pointer + 0x32, bytes(2))
                elif control in ("dead", "rotting"):
                    machine.mem_write(pointer + 0x2C, bytes((0 if control == "dead" else 10,)))
                elif control == "wrong-type":
                    machine.mem_write(pointer + 6, b"\x27")
                elif control == "occupied" or (tile_x, tile_y) == preferred:
                    AI.put(machine, AI.GROUND + (tile_y * width + tile_x) * 4, 123)
        elif control in ("route-score", "own-score", "signed-owner", "unowned-score", "owner-not-team", "allied-score"):
            owner = team if control in ("own-score", "owner-not-team") else 255 if control == "unowned-score" else 254 if control == "signed-owner" else 7
            for region in range(256):
                machine.mem_write(AI.POLICY + region * 18 + 8, bytes((owner,)))
                machine.mem_write(AI.POLICY + region * 18 + 10, b"\xff\xff")
            if control == "owner-not-team":
                machine.mem_write(pool + 200 * 220 + 7, b"\x07")
            if control == "allied-score":
                machine.mem_write(AI.POLICY + 0x6C38, b"\x01" * 8)
        elif control == "no-route":
            machine.mem_write(AI.MAP + 0x884A8 + origin * 256, bytes(256))
        elif control == "zero-origin":
            machine.mem_write(AI.PATH_CELLS + (cities[0][1] * width + cities[0][0]) * 24 + 12, b"\0")
        elif control in ("rank-tie", "rank255", "rank-unsigned"):
            for region in range(256):
                machine.mem_write(AI.POLICY + region * 18 + 13, bytes((255 if control == "rank255" else 128,)))
            if control == "rank-unsigned":
                machine.mem_write(AI.POLICY + target * 18 + 13, b"\xff")
        elif control.startswith("mobile") or control in ("all-assigned", "deploy47", "deploy48", "other-type"):
            kind = 47 if control == "deploy47" else 48 if control == "deploy48" else 0 if control == "other-type" else 6 if faction == "HUMAN" else 14
            counter = int(control.removeprefix("mobile-counter")) if control.startswith("mobile-counter") else 60 if control in ("mobile-stale", "mobile-moved", "deploy47", "deploy48", "other-type") else 0
            actor(200, kind, *cities[0], objective=target, counter=counter, stationary=control != "mobile-moved")
            link([200])
            if control == "mobile-unsafe":
                machine.mem_write(AI.POLICY + target * 18 + 8, b"\x07")
                machine.mem_write(AI.POLICY + target * 18 + 10, b"\x01\0")
            elif control == "mobile-missing-route":
                machine.mem_write(AI.MAP + 0x884A8 + origin * 256, bytes(256))
        elif control.startswith("mask"):
            machine.mem_write(AI.MAP + 0x984A8, bytes(256 * 32))
            machine.mem_write(AI.MAP + 0x884A8, bytes(65536))
            machine.mem_write(AI.MAP + 0x884A8 + origin * 256 + target, bytes((target,)))
            for index, row in enumerate(resources):
                machine.mem_write(pool + (300 + index) * 220 + 0x32, struct.pack("<H", int(tuple(row[:2]) == preferred)))
            threat_region = target
            if control != "mask-isolated":
                first, second, third = 240, 241, 242
                for region, adjacent in ((origin, [first]), (first, [second]), (second, [third])):
                    machine.mem_write(AI.MAP + 0x984A8 + region * 32, bytes((len(adjacent), *adjacent)))
                threat_region = third if control == "mask-third-ring" else second
                if control == "mask-deduplicated":
                    machine.mem_write(AI.MAP + 0x984A8 + target * 32, bytes((2, second, second)))
                if control == "mask-low-region":
                    machine.mem_write(AI.MAP + 0x984A8 + origin * 32, bytes((1, 2)))
                    threat_region = 2
            machine.mem_write(AI.POLICY + threat_region * 18 + 8, b"\x07")
            machine.mem_write(AI.POLICY + threat_region * 18 + 10, b"\x01\0")
        elif control == "slot799":
            preferred_slot = 300 + next(index for index, row in enumerate(resources) if tuple(row[:2]) == preferred)
            machine.mem_write(pool + 799 * 220, bytes(machine.mem_read(pool + preferred_slot * 220, 220)))
            for index in range(len(resources)):
                machine.mem_write(pool + (300 + index) * 220 + 0x32, bytes(2))
        elif control == "same-family":
            actor(200, 6, *preferred)
            link([200])
        elif control == "high-ground-bits":
            machine.mem_write(AI.GROUND, struct.pack("<I", 0xFFFFF7FF) * width * height)
        elif control == "zero-target":
            for tile_x, tile_y, *_ in resources:
                machine.mem_write(AI.PATH_CELLS + (tile_y * width + tile_x) * 24 + 12, b"\0")
        elif control in ("slot0", "fractional-target", "status2"):
            preferred_slot = 300 + next(index for index, row in enumerate(resources) if tuple(row[:2]) == preferred)
            if control == "slot0":
                machine.mem_write(pool, bytes(machine.mem_read(pool + preferred_slot * 220, 220)))
                machine.mem_write(pool + preferred_slot * 220 + 0x32, bytes(2))
            elif control == "fractional-target":
                machine.mem_write(pool + preferred_slot * 220, struct.pack("<H", preferred[0] * 256 + 37))
                machine.mem_write(pool + preferred_slot * 220 + 4, struct.pack("<H", preferred[1] * 256 + 249))
            else:
                machine.mem_write(pool + preferred_slot * 220 + 0x2C, b"\x02")
        elif control.startswith("graph-count"):
            machine.mem_write(AI.MAP + 0x984A8, bytes(256 * 32))
            count = 31 if control == "graph-count31" else 0
            machine.mem_write(AI.MAP + 0x984A8 + origin * 32, bytes((count, *([240] * 31))))
            machine.mem_write(AI.POLICY + 240 * 18 + 8, b"\x07")
            machine.mem_write(AI.POLICY + 240 * 18 + 10, b"\x01\0")
        elif control in ("multiple-maintenance", "unsafe-reassigned"):
            actor(200, 6, *cities[0], objective=target, stationary=True)
            machine.mem_write(AI.POLICY + target * 18 + 8, b"\x07")
            machine.mem_write(AI.POLICY + target * 18 + 10, b"\x01\0")
            if control == "multiple-maintenance":
                actor(201, 14, *cities[0], objective=target, stationary=True)
                link([201, 200])
            else:
                link([200])
                actor(301, 40, *cities[0], owner=8)
                machine.mem_write(pool + 301 * 220 + 0x32, b"\x01\0")
                machine.mem_write(AI.MAP + 0x984A8, bytes(256 * 32))
                machine.mem_write(AI.POLICY + origin * 18 + 13, b"\0")
        elif control == "stale-no-resource":
            actor(200, 6, *cities[0], objective=target, counter=10, stationary=True)
            link([200])
            for index in range(len(resources)):
                machine.mem_write(pool + (300 + index) * 220 + 0x32, bytes(2))
        run(control)
    expected = "11000701010080458030c80005c8000200" if faction == "HUMAN" else "11000701010080048050c80005c8000200"
    assert cases[0]["packets"] == [expected]
    for path in natural_traces:
        content = Path(path).read_bytes()
        for line in content.splitlines():
            natural = json.loads(line)
            if natural["mission"] != faction + "02":
                continue
            assert natural["acceptance"]["naturalSchedulerActivation"]
            assert natural["executableSha256"] == AI.NATIVE.AUDIT.DIGEST
            assert natural["sourcePathInitialization"]["familyGraphSha256"] == hashlib.sha256(original_graph).hexdigest()
            completed = next(group for group in natural["groupCompletions"] if group["group"] == 0)
            assert completed["team"] == team
            reset()
            machine.mem_write(AI.POLICY, base64.b64decode(completed["policy"]["before"]))
            machine.mem_write(pool, base64.b64decode(completed["entities"]["before"]))
            assert struct.unpack("<hh", machine.mem_read(AI.POLICY + 0x1FAA, 4)) == (-1, -1)
            AI.put(machine, 0x479204, completed["rngBefore"])
            run(f"original-action-frame-{completed['frame']}")
            assert cases[-1]["after"]["policy"] == completed["policy"]["after"]
            assert cases[-1]["after"]["entities"] == completed["entities"]["after"]
            assert cases[-1]["after"]["rngCursor"] == completed["rngAfter"]
            assert cases[-1]["packets"] == []
            assert completed["callbacks"] == [hex(callback) for callback in callbacks]
            cases[-1]["historical"] = {"sha256": hashlib.sha256(content).hexdigest(),
                "frame": completed["frame"], "schedulerVisit": completed["schedulerVisit"],
                "originalPolicyMatched": True, "originalEntitiesMatched": True,
                "emptyCanonicalGroup": True, "dynamicGroundNotRead": True,
                "forceOrderNotRead": True}
    print(json.dumps({"mission": faction + "02", "team": team, "binarySha256": AI.NATIVE.AUDIT.DIGEST,
                      "sourceHashes": AI.SOURCE_HASHES[faction], "cases": cases}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--natural-trace", action="append", default=[])
    args = parser.parse_args()
    for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
        capture(faction, team, args.natural_trace)