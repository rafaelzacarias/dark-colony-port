"""Source-backed mobile idle dispatcher research; no runtime task stubs."""

import argparse
import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_EBP, UC_X86_REG_EIP, UC_X86_REG_ESI

SOURCE = runpy.run_path(str(Path(__file__).with_name("inspire-audit-20260919.py")))
GAME = SOURCE["GAME"]


def fixture():
    construction = runpy.run_path(str(Path(__file__).with_name("construction-lifecycle-20260919.py")))
    native = construction["source_fixture"](SOURCE["IMAGE"])
    profiles = construction["load_fin"](native, (0, 8, 69, 73), attack=True)
    for binding in profiles["bindings"]:
        native.emulator.mem_write(0x70D800 - 0x178, binding["stem"].encode("ascii") + b"\0")
        native.put(0x70D800 - 4, 0x4F1880 + binding["unitType"] * 280)
        native.run(0x43BE2A, {UC_X86_REG_EBP: 0x70D800}, 0x43BE59)
        native.run(0x43C099, {UC_X86_REG_EBP: 0x70D800}, 0x43C13B)
    native.emulator.mem_map(0xC00000, 0x200000)
    native.put(GAME + 0x46F2C, 0xC00000)
    native.put(GAME + 0x544, 0xD00000)
    for offset, value in ((0x9A4B0, 128), (0x9A4B4, 128), (0x9A4B8, 32768), (0x9A4BC, 32768)):
        native.put(0xC00000 + offset, value)
    for offset, base, width, code in ((0x804, 0xC10000, 4, "I"), (0xC04, 0xC30000, 2, "H"),
                                      (0x1004, 0xC40000, 2, "H")):
        native.emulator.mem_write(base, struct.pack("<" + code, 1023) * 16384)
        for row in range(128):
            native.put(0xC00000 + offset + row * 4, base + row * 128 * width)
    native.emulator.mem_write(GAME + 0x468EC, b"\xff\xff" * 800)
    native.put(GAME + 0x468E8, 65535, 2)
    native.put(GAME + 0x468EA, 65535, 2)
    native.put(GAME + 0x7D20, 152)
    native.put(GAME + 0x530, 1)
    return construction, native, profiles


def probe(unit_type=0, random_index=0, enemy=False, pending=None, updates=3, direction=None,
          charge=255, pending_at=0, damage_at=0, uniform_table=None, counter=1):
    construction, native, profiles = fixture()
    if enemy:
        construction["load_damage"](native, unit_type)
    baseline = len(native.calls)
    native.stubs.clear()
    native.put(0x479204, random_index)
    native.put(GAME + 0x530, counter)
    native.put(GAME + 0x46F34 + 11, 1, 1)
    if uniform_table is not None:
        native.emulator.mem_write(0x478E04, struct.pack("<I", uniform_table) * 256)
    events, entries, frames = [], [], []
    update = 0

    def write(emulator, access, address, size, value, data):
        if address == 0x479204:
            events.append({"update": update, "eip": hex(emulator.reg_read(UC_X86_REG_EIP)),
                           "before": native.get(address), "after": value,
                           "value": native.get(0x478E04 + value * 4)})

    def code(emulator, address, size, data):
        if address in (0x412654, 0x4148B0, 0x412274, 0x412338, 0x412D00, 0x435C14, 0x435570, 0x416784):
            entries.append({"update": update, "eip": hex(address),
                            "slot": emulator.reg_read(UC_X86_REG_EDX)})
        if address in (0x419458, 0x419576) and emulator.reg_read(UC_X86_REG_ESI) == GAME + 0x7D28 + 152 * 220:
            if address == 0x419458 and (not frames or frames[-1]["update"] != update):
                frames.append({"update": update, "before": reducer_state(), "rngStart": len(events)})
            elif address == 0x419576:
                frames[-1].update({"after": reducer_state(), "rng": events[frames[-1]["rngStart"]:]})

    native.emulator.hook_add(UC_HOOK_MEM_WRITE, write)
    native.emulator.hook_add(UC_HOOK_CODE, code)

    def spawn(kind, team, column):
        native.put(construction["BASE"]["STACK"] + 4, team)
        native.put(construction["BASE"]["STACK"] + 8, -1)
        native.run(0x41B750, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: column,
                              UC_X86_REG_EBX: 32, UC_X86_REG_ECX: kind})
        return native.emulator.reg_read(UC_X86_REG_EAX)

    slot = spawn(unit_type, 1, 32)
    if enemy:
        enemy_slot = spawn(0, 2, 33)
        native.put(GAME + 0xE30 + 0x19C0, 0x20000000)
        native.put(0xC10000 + (32 * 128 + 33) * 4, enemy_slot | 0x20000000)
        native.put(GAME + 0x46F34 + 11, 1, 1)
        native.put(GAME + 0x46F34 + 22, 1, 1)
    entity = GAME + 0x7D28 + slot * 220
    if direction is not None:
        native.put(entity + 9, direction, 1)

    def reducer_state():
        state = snapshot()
        return {"slot": slot, "typeId": unit_type, "team": state["team"], "activity": "idle",
                "status": state["status"], "hp": state["hp"], "xQ8": native.get(entity, 2),
                "yQ8": native.get(entity + 4, 2), "direction": state["direction"], "observer": state["observer"],
                "specialOrder": native.get(entity + 0xCB, 1), "confusion": native.get(entity + 0xD0, 1),
                "secondaryAnimationPending": native.get(entity + 0xC7, 1),
                "secondaryAnimationsInactive": all(native.get(entity + offset + 6, 1) == 2
                                                    for offset in (0x1C, 0x24)),
                "pending": state["pendingOrder"], "order": state["order"], "charge": state["charge"],
                "randomIndex": state["rngIndex"],
                "stack": [{"task": entry["task"], "words": entry["words"][:{1: 3, 3: 2}.get(entry["task"], 1)]}
                          for entry in state["stack"]],
                "animation": {key: state["animation"][key] for key in ("bank", "frame", "delay", "mode")}}

    def snapshot():
        state = construction["snapshot"](native, slot)
        depth = state["taskDepth"]
        state.update({"rngIndex": native.get(0x479204), "direction": native.get(entity + 9, 1),
                      "charge": native.get(entity + 10, 1), "observer": native.get(entity + 0x35, 1),
                      "stack": [{"task": native.get(entity + 0x39 + level * 2, 1),
                                 "words": [native.get(entity + 0x46 + native.get(entity + 0x3A + level * 2, 1) * 2 + word * 2, 2)
                                           for word in range(3)]} for level in range(depth + 1)]})
        return state

    trace = [snapshot()]
    if pending is not None and pending_at == 0:
        native.put(entity + 0x36, 1, 1)
        native.put(entity + 0x37, pending, 1)
        native.put(entity + 10, charge, 1)
        trace.append(snapshot())
    for update in range(1, updates + 1):
        if pending is not None and update == pending_at:
            native.put(entity + 0x36, 1, 1)
            native.put(entity + 0x37, pending, 1)
            native.put(entity + 10, charge, 1)
        if update == damage_at:
            native.put(entity + 12, 700)
        native.put(0x70D800 - 4, GAME)
        native.run(0x419BB8, {UC_X86_REG_EBP: 0x70D800}, 0x419C0E)
        trace.append(snapshot())
    transition_frames = []
    if not enemy:
        before = reducer_state()
        native.run(0x412014, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: slot})
        transition_frames.append({"operation": "continue", "before": before, "after": reducer_state()})
        native.put(entity + 0x38, 255, 1)
        native.put(entity + 0x39, 0, 2)
        before = reducer_state()
        native.run(0x412654, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: slot})
        transition_frames.append({"operation": "initialize", "before": before, "after": reducer_state()})
    assert native.calls[baseline:] == [], native.calls[baseline:]
    profile = 0x4F1880 + unit_type * 280
    stand_bank = native.get(profile + 0x80)
    world = {"width": 128, "height": 128, "selfDiplomacy": 1, "standBank": stand_bank,
             "sourceFin": "TRSC" if unit_type in (0, 69) else "GRAY",
             "standDirections": [{"frameCount": native.get(native.get(stand_bank + bank * 4) + 0x28),
                                   "delay": native.get(native.get(native.get(stand_bank + bank * 4) + 0x20) + 2, 1)}
                                  for bank in range(32)],
             "slots": {str(current): {"team": native.get(GAME + 0x7D28 + current * 220 + 7, 1),
                                       "status": native.get(GAME + 0x7D28 + current * 220 + 0x2C, 1)}
                       for current in range(152, 154 if enemy else 153)}}
    for name, base, size in (("ground", 0xC10000, 4), ("air", 0xC30000, 2), ("auxiliary", 0xC40000, 2)):
        world[name] = [[cell, native.get(base + cell * size, size)] for cell in range(16384)
                       if native.get(base + cell * size, size) != 1023]
    return {"typeId": unit_type, "initialRandomIndex": random_index, "enemy": enemy, "pending": pending,
            "uniformTable": uniform_table, "counter": counter,
            "profile": {hex(offset): native.get(profile + offset) for offset in (8, 0xC, 0x18, 0x60, 0xD8, 0xDC, 0xF8)},
            "sourceHashes": {source["source"]: source["sha256"] for source in profiles["sources"]},
            "world": world, "frames": frames, "transitionFrames": transition_frames,
            "trace": trace, "rng": events, "entries": entries, "runtimeIntercepts": []}


def startup_probe():
    construction, native, _ = fixture()
    zero_filled_seed = native.get(0x49469C)
    results = []
    for seed in (0, 1, 255, 256, 0x1234):
        native.put(0x479204, 197)
        native.put(0x49469C, seed)
        native.run(0x40150B, {}, 0x401515)
        startup = native.get(0x479204)
        native.put(0x479204, 197)
        native.run(0x41B920, {UC_X86_REG_EAX: GAME, UC_X86_REG_EBX: seed, UC_X86_REG_EDX: 0}, 0x41B938)
        scenario = native.get(0x479204)
        assert startup == scenario == seed & 255
        results.append({"seed": seed, "startup": startup, "scenario": scenario})
    return {"imageIndex": int.from_bytes(SOURCE["READ"](0x479204, 4), "little"),
            "zeroFilledStartupSeed": zero_filled_seed,
            "resetSlices": results, "freshMenuVerified": False}


def suite():
    table = struct.unpack("<256I", SOURCE["READ"](0x478E04, 1024))
    turn_index = next(index for index in range(256) if table[(index + 1) & 255] & 15 == 0)
    cases = []
    for unit_type in (0, 8, 69, 73):
        cases.extend([probe(unit_type, updates=120), probe(unit_type, turn_index, updates=65, direction=255),
                      probe(unit_type, 255, pending=1, updates=4),
                      probe(unit_type, updates=5, damage_at=3),
                      probe(unit_type, enemy=True, updates=1)])
    for unit_type in (69, 73):
        for charge in (0, 31, 32, 33, 255):
            cases.append(probe(unit_type, pending=13, charge=charge, updates=4))
        cases.append(probe(unit_type, turn_index, pending=13, pending_at=18, updates=45, direction=128))
    field_cases = [probe(unit_type, updates=1, uniform_table=value, counter=32)
                   for unit_type in (0, 8, 69, 73) for value in (0, 32767)]
    baseline = SOURCE["lifecycle_case"]()
    idle_writes = [write for write in baseline["writes"]
                   if write["field"] == "rngIndex" and write["eip"] in ("0x414c34", "0x414c79")]
    return {"exeSha256": hashlib.sha256(SOURCE["IMAGE"]).hexdigest(),
            "startup": startup_probe(), "turnIndex": turn_index, "cases": cases, "fieldCases": field_cases,
            "inspireBaseline": {"runtimeIntercepts": baseline["runtimeIntercepts"], "idleWrites": idle_writes}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 16))
    parser.add_argument("--type", type=int, default=0)
    parser.add_argument("--index", type=int, default=0)
    parser.add_argument("--enemy", action="store_true")
    parser.add_argument("--pending", type=int)
    parser.add_argument("--updates", type=int, default=3)
    parser.add_argument("--suite", action="store_true")
    arguments = parser.parse_args()
    if arguments.disassemble:
        start, end = arguments.disassemble
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(SOURCE["READ"](start, end - start), start):
            print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
    elif arguments.suite:
        print(json.dumps(suite()))
    else:
        print(json.dumps(probe(arguments.type, arguments.index, arguments.enemy, arguments.pending, arguments.updates), indent=2))


if __name__ == "__main__":
    main()