"""Whole 44be40 calls from original pre-action policy, with explicit receipt boundaries."""

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


def capture(faction, team, demand_trace):
    content = Path(demand_trace).read_bytes()
    source = next(json.loads(line) for line in content.splitlines() if json.loads(line)["mission"] == faction + "02")
    preaction = next(case for case in source["cases"] if case["label"] == "source-pipeline")
    spec = importlib.util.spec_from_file_location("placement", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    machine, _, _, width, families = AI.source_fixture(
        faction, team, lambda *args: AI.initialize_source_world(*args, placement))
    pool = AI.NATIVE.GAME + 0x7D28
    side = AI.NATIVE.GAME + 0xB98 + team * 0xE30
    encode = lambda address, length: base64.b64encode(machine.mem_read(address, length)).decode()
    snapshot = lambda: {"policy": encode(AI.POLICY, 0x6C40), "entities": encode(pool, 800 * 220),
                        "teamBytes": encode(side, 0xE30), "rngCursor": AI.dword(machine, 0x479204),
                        "forceOrder": machine.mem_read(0x489510, 1)[0]}
    machine.mem_write(0x4E6D70, base64.b64decode(source["inputs"]["dependencies"]))
    AI.put(machine, 0x4793F0, AI.NATIVE.GAME)
    machine.mem_write(0x49D620, b"\x01")
    packets, callbacks, cases, rng_events = [], [], [], []
    transport = "deferred"
    active_group = "demand"

    def observe(emulator, address, size, context):
        nonlocal active_group
        if address == 0x40BCC0:
            assert emulator.reg_read(AI.UC_X86_REG_EDX) == 0x6C40
            stack = emulator.reg_read(AI.UC_X86_REG_ESP)
            emulator.reg_write(AI.UC_X86_REG_EAX, AI.POLICY)
            emulator.reg_write(AI.UC_X86_REG_EIP, AI.dword(emulator, stack))
            emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4)
        elif address == 0x421725:
            pointer = emulator.reg_read(AI.UC_X86_REG_ESI)
            length = struct.unpack("<H", emulator.mem_read(pointer, 2))[0]
            packet = bytes(emulator.mem_read(pointer, length))
            packets.append({"stage": active_group, "packet": packet.hex()})
            if transport == "deferred" or packet[2] in (9, 10):
                emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)
        elif address == 0x411DB4:
            rng_events.append(AI.dword(emulator, 0x479204))
        else:
            if address in (0x4578A0, 0x459F24):
                active_group = emulator.reg_read(AI.UC_X86_REG_EBX)
            callbacks.append({"callback": address, "stage": active_group})

    entries = {0x40BCC0, 0x44BD2C, 0x457568, 0x456AD0, 0x457940, 0x4578D0,
               0x4578A0, 0x459F24, 0x44BBEC, 0x44BBDC, 0x44B920, 0x4598B0,
               0x4593A8, 0x458B44, 0x463E78, 0x459F80, 0x463840, 0x463EEC,
               0x464074, 0x411DB4, 0x421725}
    for address in entries:
        machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)

    def restore():
        machine.mem_write(AI.POLICY, base64.b64decode(preaction["before"]["policy"]))
        machine.mem_write(pool, base64.b64decode(preaction["before"]["entities"]))
        machine.mem_write(AI.NATIVE.GAME + 0xB98, base64.b64decode(preaction["before"]["teams"]))
        AI.put(machine, side + 0x28, AI.POLICY)
        AI.put(machine, 0x479204, preaction["before"]["rngCursor"])
        machine.mem_write(0x489510, bytes((preaction["before"]["forceOrder"],)))
        AI.put(machine, AI.NATIVE.GAME + 0x528, preaction["populationLimit"])
        AI.put(machine, 0x4956E0 + team * 48 + 24, preaction["population"])

    def actor(slot, kind, region):
        pointer = pool + slot * 220
        machine.mem_write(pointer, bytes(220))
        machine.mem_write(pointer, struct.pack("<H", machine.mem_read(AI.POLICY + region * 18 + 2, 1)[0] << 8))
        machine.mem_write(pointer + 4, struct.pack("<H", machine.mem_read(AI.POLICY + region * 18 + 3, 1)[0] << 8))
        machine.mem_write(pointer + 6, bytes((kind, team)))
        machine.mem_write(pointer + 0x2C, b"\x01")
        machine.mem_write(pointer + 0x39, b"\x01")
        machine.mem_write(pointer + 0xD2, struct.pack("<hh", -1, -1))

    def link(group, bucket, slots, target):
        base = AI.POLICY + group * 0x12FC + bucket * 300
        machine.mem_write(base + 0x1E95, b"\x01")
        machine.mem_write(base + 0x1FAA, struct.pack("<hh", slots[0], slots[-1]))
        AI.put(machine, base + 0x1E9C, target)
        AI.put(machine, base + 0x1EA0, target)
        machine.mem_write(base + 0x1EA6, bytes(2))
        machine.mem_write(base + 0x1EA8, bytes((target,)))
        for index, slot in enumerate(slots):
            machine.mem_write(pool + slot * 220 + 0xD2, struct.pack("<hh",
                slots[index + 1] if index + 1 < len(slots) else -1, slots[index - 1] if index else -1))

    rng = list(struct.unpack("<256i", AI.NATIVE.READ(0x478E04, 1024)))
    for label in ("source-preaction", "initialize-needed", "mixed-branches", "paid-demand"):
        for timing in ("deferred", "synchronous"):
            restore()
            transport = timing
            if label == "initialize-needed":
                AI.put(machine, side + 0x28, 0)
                machine.mem_write(AI.POLICY, bytes(0x6C40))
            if label == "paid-demand":
                AI.put(machine, side + 0x14, 100000)
                machine.mem_write(side + 0xDA4, bytes(110))
                machine.mem_write(side + 0x110, bytes(8))
                for city in range(15):
                    AI.put(machine, side + 0x3C + city * 4, 100)
                    AI.put(machine, side + 0xC4 + city * 4, 10)
                    machine.mem_write(side + 0x78 + city, b"\0")
            if label == "mixed-branches":
                origin = AI.dword(machine, AI.POLICY + 0x12FC + 0x1E9C)
                targets = [region for region in range(1, 255) if region != origin and region in families
                           and machine.mem_read(AI.MAP + 0x884A8 + origin * 256 + region, 1)[0]]
                for group in range(4):
                    for bucket in range(16):
                        machine.mem_write(AI.POLICY + group * 0x12FC + bucket * 300 + 0x1FAA, b"\xff" * 4)
                for slot in range(800):
                    machine.mem_write(pool + slot * 220 + 0xD2, b"\xff" * 4)
                for slot, kind in ((600, 6), (610, 0), (611, 2), (620, 0), (621, 3), (630, 5)):
                    actor(slot, kind + (8 if faction == "ALIEN" else 0), origin)
                link(0, 0, [600], origin)
                link(1, 1, [610, 611], targets[0])
                link(2, 0, [620, 621], origin)
                link(3, 0, [630], origin)
                machine.mem_write(AI.POLICY + 0x6A74, bytes((1, targets[1], 1, targets[2])) + bytes(28))
                AI.put(machine, 0x479204, next(cursor for cursor in range(256) if not rng[(cursor + 1) & 255] & 15))
            before = snapshot()
            packets.clear()
            callbacks.clear()
            rng_events.clear()
            active_group = "demand"
            AI.invoke(machine, 0x44BE40, instruction_limit=80000000, eax=AI.NATIVE.GAME, edx=team)
            after = snapshot()
            if label == "paid-demand":
                assert any(packet["stage"] == "demand" for packet in packets), (faction, label)
            if label == "mixed-branches":
                assert set(range(4)) <= {packet["stage"] for packet in packets}
                assert {0x463840, 0x463EEC, 0x464074} <= {entry["callback"] for entry in callbacks}
            cases.append({"label": label, "actorTransport": timing, "initialize": label == "initialize-needed",
                          "before": before, "after": after, "packets": packets[:], "callbacks": callbacks[:],
                          "rngEvents": rng_events[:], "population": preaction["population"],
                          "populationLimit": preaction["populationLimit"]})
    receipts = []
    for count in range(9):
        stream = bytes((7, count)) + struct.pack("<h", 3)
        stream += b"".join(struct.pack("<HH", 65535 - index * 100, index * 100) for index in range(count))
        stream += struct.pack("<hhh", 0, 799, 0) + bytes((5, 31, 3, 13, 0))
        packet = struct.pack("<H", len(stream) + 2) + stream
        machine.mem_write(pool, bytes((index * 17 + 3) & 255 for index in range(800 * 220)))
        before = encode(pool, 800 * 220)
        machine.mem_write(0x709000, packet)
        AI.invoke(machine, 0x41DEFC, eax=AI.NATIVE.GAME, edx=0x709002, ebx=len(stream))
        assert machine.reg_read(AI.UC_X86_REG_EAX) == 0
        receipts.append({"label": f"points-{count}-duplicate-slots-stop", "packet": packet.hex(),
                         "before": before, "after": encode(pool, 800 * 220)})
    print(json.dumps({"mission": faction + "02", "team": team, "binarySha256": AI.NATIVE.AUDIT.DIGEST,
                      "provenance": {"kind": "source-preaction-reconstructed-bounds", "entry": "0x44be40",
                                     "demandTraceSha256": hashlib.sha256(content).hexdigest(),
                                     "historicalNaturalDemand": False, "productionReceipts": "pending-owner",
                                     "allocationPointer": "explicit-owner-input"},
                      "navigation": source["navigation"], "inputs": source["inputs"],
                      "neighbors": encode(AI.MAP + 0x984A8, 8192), "rngTable": rng,
                      "ruleTable": source["ruleTable"], "policyAddress": AI.POLICY, "cases": cases,
                      "receipts": receipts}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demand-trace", default="/tmp/dc-ai-demand-native-0919-f2.jsonl")
    arguments = parser.parse_args()
    capture("HUMAN", 2, arguments.demand_trace)
    capture("ALIEN", 1, arguments.demand_trace)