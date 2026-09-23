"""Original group-one helpers and full policy-call evidence."""

import importlib.util
import argparse
import base64
import json
import struct
from pathlib import Path
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ai_policy", Path(__file__).with_name("ai-policy-20260919.py"))
AI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AI)


def disassemble():
    for address, length in ((0x4593A8, 0x2B8), (0x463840, 0xEC),
                            (0x463EEC, 0x248), (0x44BE40, 0x190)):
        for instruction in AI.Cs(AI.CS_ARCH_X86, AI.CS_MODE_32).disasm(AI.NATIVE.READ(address, length), address):
            print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")


def capture(faction, team):
    spec = importlib.util.spec_from_file_location("placement", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    machine, _, _, width, families = AI.source_fixture(
        faction, team, lambda *args: AI.initialize_source_world(*args, placement))
    encode = lambda address, length: base64.b64encode(machine.mem_read(address, length)).decode()
    snapshot = lambda: {"policy": encode(AI.POLICY, 0x6C40),
                        "entities": encode(AI.NATIVE.GAME + 0x7D28, 800 * 220),
                        "rngCursor": AI.dword(machine, 0x479204),
                        "forceOrder": machine.mem_read(0x489510, 1)[0]}
    initial = None

    def stop(emulator, address, size, context):
        nonlocal initial
        if address == 0x4578A0 and emulator.reg_read(AI.UC_X86_REG_EBX) == 1:
            initial = snapshot()
            emulator.emu_stop()
        elif address == 0x421725:
            emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, stop, begin=address, end=address)
             for address in (0x4578A0, 0x421725)]
    try:
        AI.invoke(machine, 0x44BE40, eax=AI.NATIVE.GAME, edx=team)
    except AssertionError:
        assert initial is not None
    for hook in hooks:
        machine.hook_del(hook)
    assert initial is not None
    events, packets, cases = [], [], []

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

    callbacks = (0x4578A0, 0x44BBEC, 0x4593A8, 0x463E78)
    for address in (*callbacks, 0x463840, 0x463EEC, 0x464074, 0x44B864, 0x411DB4, 0x421725):
        machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
    rng = list(struct.unpack("<256i", AI.NATIVE.READ(0x478E04, 1024)))
    group = AI.POLICY + 0x12FC
    origin = AI.dword(machine, group + 0x1E9C)
    reachable = [source for source in range(1, 255) if source != origin and source in families
                 and machine.mem_read(AI.MAP + 0x884A8 + origin * 256 + source, 1)[0]]

    def restore():
        machine.mem_write(AI.POLICY, base64.b64decode(initial["policy"]))
        machine.mem_write(AI.NATIVE.GAME + 0x7D28, base64.b64decode(initial["entities"]))
        AI.put(machine, 0x479204, initial["rngCursor"])
        machine.mem_write(0x489510, bytes((initial["forceOrder"],)))

    def run(label):
        events.clear()
        packets.clear()
        before = snapshot()
        for callback in callbacks:
            AI.invoke(machine, callback, eax=AI.NATIVE.GAME, edx=AI.POLICY, ebx=1, ecx=team)
        cases.append({"label": label, "before": before, "after": snapshot(),
                      "events": events[:], "packets": packets[:]})

    def members(bucket, slots, target):
        base = group + bucket * 300
        machine.mem_write(base + 0x1E95, b"\x01")
        AI.put(machine, base + 0x1E9C, origin)
        AI.put(machine, base + 0x1EA0, target)
        machine.mem_write(base + 0x1EA6, bytes(2))
        machine.mem_write(base + 0x1EA8, bytes((origin,)))
        machine.mem_write(base + 0x1FAA, struct.pack("<hh", slots[0] if slots else -1, slots[-1] if slots else -1))
        for index, slot in enumerate(slots):
            actor = AI.NATIVE.GAME + 0x7D28 + slot * 220
            machine.mem_write(actor, bytes(220))
            machine.mem_write(actor, struct.pack("<H", machine.mem_read(AI.POLICY + origin * 18 + 2, 1)[0] << 8))
            machine.mem_write(actor + 4, struct.pack("<H", machine.mem_read(AI.POLICY + origin * 18 + 3, 1)[0] << 8))
            machine.mem_write(actor + 6, bytes((index % 8, team)))
            machine.mem_write(actor + 0x11, bytes((origin,)))
            machine.mem_write(actor + 0x2C, b"\x01")
            machine.mem_write(actor + 0xCC, b"\x01")
            machine.mem_write(actor + 0xD2, struct.pack("<hh", slots[index + 1] if index + 1 < len(slots) else -1,
                                                      slots[index - 1] if index else -1))

    run("source-invocation")
    for label in ("retarget", "release-full-members", "release-cleanup", "create", "create-sorted",
                  "duplicate-target", "sixteen-buckets", "mixed", "rng-wrap", "forced"):
        restore()
        AI.put(machine, 0x479204, next(cursor for cursor in range(256) if rng[(cursor + 1) & 255] & 15))
        machine.mem_write(AI.POLICY + 0x1FAA, struct.pack("<hh", -1, -1))
        machine.mem_write(AI.POLICY + 0x6A74, bytes(32))
        members(0, [620, 621, 622], origin)
        if label in ("retarget", "mixed"):
            AI.put(machine, 0x479204, next(cursor for cursor in range(256) if not (rng[(cursor + 1) & 255] & 15)))
        if label in ("release-full-members", "release-cleanup", "mixed", "duplicate-target"):
            members(1, [600, 601, 602], reachable[0])
        if label == "release-cleanup":
            machine.mem_write(AI.NATIVE.GAME + 0x7D28 + 601 * 220 + 0x2C, b"\x0a")
        if label in ("create", "create-sorted", "mixed", "duplicate-target", "sixteen-buckets"):
            targets = reachable[:16] if label == "sixteen-buckets" else reachable[:3] if label in ("create-sorted", "mixed") else reachable[:1]
            for index, target in enumerate(reversed(targets)):
                machine.mem_write(AI.POLICY + 0x6A74 + index * 2, bytes((1, target)))
        if label == "duplicate-target":
            members(2, [610, 611], reachable[0])
        if label == "sixteen-buckets":
            for bucket in range(1, 16):
                members(bucket, [400 + bucket * 3, 401 + bucket * 3], reachable[bucket - 1])
        if label == "rng-wrap":
            AI.put(machine, 0x479204, 255)
        if label == "forced":
            machine.mem_write(0x489510, b"\x01")
        run(label)
    print(json.dumps({"mission": faction + "02", "team": team, "binarySha256": AI.NATIVE.AUDIT.DIGEST,
                      "navigation": {"width": width, "height": len(families) // width,
                                     "families": base64.b64encode(families).decode(),
                                     "nextFamily": encode(AI.MAP + 0x884A8, 65536)},
                      "rngTable": rng, "cases": cases}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", action="store_true")
    arguments = parser.parse_args()
    if arguments.disassemble:
        disassemble()
    else:
        capture("HUMAN", 2)
        capture("ALIEN", 1)