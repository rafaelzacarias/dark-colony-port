"""Original visibility instructions over the complete source scenario registry."""

import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.x86_const import UC_X86_REG_EIP

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("visibility_actor", Path(__file__).with_name("nativeactor-task-native.py"))
ACTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACTOR)
AI, GAME = ACTOR.AI, ACTOR.GAME


def disassemble():
    decoder = AI.Cs(AI.CS_ARCH_X86, AI.CS_MODE_32)
    for start, end in ((0x419A20, 0x419A55), (0x44A6D4, 0x44AB74), (0x4489CC, 0x448E44),
                       (0x448E44, 0x4492B0), (0x4463E0, 0x446844),
                       (0x454FAF, 0x455014), (0x435D2C, 0x435F30),
                       (0x449D20, 0x44A1E0), (0x4484E4, 0x4489CC)):
        print(f"RANGE {start:#x}")
        for instruction in decoder.disasm(AI.NATIVE.READ(start, end - start), start):
            print(hex(instruction.address), instruction.mnemonic, instruction.op_str)
    for address, length in ((0x47B098, 128), (0x47B118, 96)):
        print("TABLE", hex(address), AI.NATIVE.READ(address, length).hex())


def load_terrain(machine, sources, rows):
    bank = (ROOT / "raw_cd/DC/SCENARIO" / rows[0].upper()).read_bytes()
    key_space, count = struct.unpack_from("<II", bank)
    assert len(bank) == 776 + count * 1028
    lookup = bytearray(key_space * 2)
    for index in range(count):
        key = struct.unpack_from("<I", bank, 776 + index * 1028)[0]
        struct.pack_into("<h", lookup, key * 2, index)
    machine.mem_map(0xC00000, 0x40000)
    machine.mem_write(0xC20000, bytes(lookup))
    cursor = 8

    def boundary(emulator, address, size, context):
        nonlocal cursor
        stack = emulator.reg_read(AI.UC_X86_REG_ESP)
        if address == 0x406664:
            length = emulator.reg_read(AI.UC_X86_REG_EDX) * 2
            emulator.mem_write(emulator.reg_read(AI.UC_X86_REG_EAX), sources["MAP"][cursor:cursor + length])
            cursor += length
            result = length // 2
        else:
            assert emulator.reg_read(AI.UC_X86_REG_EDX) == 0x15E00
            result = 0xC00000
        emulator.reg_write(AI.UC_X86_REG_EAX, result)
        emulator.reg_write(AI.UC_X86_REG_EIP, AI.dword(emulator, stack))
        emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4)

    hooks = [machine.hook_add(UC_HOOK_CODE, boundary, begin=address, end=address)
             for address in (0x406664, 0x40BCC0)]
    AI.put(machine, AI.NATIVE.FRAME + 0x10, 0xC20000)
    AI.put(machine, AI.NATIVE.FRAME - 0x44, 0x703000)
    for register, value in ((AI.UC_X86_REG_EBP, AI.NATIVE.FRAME), (AI.UC_X86_REG_ESP, AI.NATIVE.STACK),
                            (AI.UC_X86_REG_ESI, AI.MAP), (AI.UC_X86_REG_EDI, 1)):
        machine.reg_write(register, value)
    machine.emu_start(0x453421, 0x453790, count=5000000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x453790 and cursor == len(sources["MAP"])
    for hook in hooks:
        machine.hook_del(hook)
    machine.visibility_terrain_source = {"bank": rows[0], "sha256": hashlib.sha256(bank).hexdigest(),
                                        "loader": "0x453421..0x453790"}
    cells = AI.dword(machine, AI.MAP + 0x9A4B0) * AI.dword(machine, AI.MAP + 0x9A4B4)
    machine.visibility_initial_terrain = list(struct.unpack(f"<{cells}I", machine.mem_read(0xB00000, cells * 4)))


def capture(faction, bounded=False, moving=False, daylight=0, position=(67, 48), owner=0, counter=16,
            victim=False, all_troops=False, local_mask=0x40000000, stale_metadata=False, fresh=False, kind=None,
            inclusive_high_water_control=False):
    assert not fresh or not (bounded or moving or victim or all_troops or kind is not None)

    def animations(machine, rows):
        kinds = {0, 8, 2, 3, 69, 73, 92, 93}
        if kind is not None:
            kinds.add(kind)
        kinds.update(int(line.split()[2]) for line in rows if len(line.split()) == 6)
        kinds.add(40)
        AI.load_carrier_animations(machine, sorted(kinds))

    def prepare(machine, sources, width, height, rows):
        original = AI.initialize_full_source_scn

        def with_terrain(machine, sources, rows):
            load_terrain(machine, sources, rows)
            original(machine, sources, rows)

        AI.initialize_full_source_scn = with_terrain
        try:
            AI.initialize_source_world(machine, sources, width, height, rows, ACTOR.PLACEMENT,
                                       runtime=True, animations=animations, full_source=True)
        finally:
            AI.initialize_full_source_scn = original

    machine = AI.source_fixture(faction, 2 if faction == "HUMAN" else 1, prepare,
                                False, fresh_game=True)
    width, height = AI.dword(machine, AI.MAP + 0x9A4B0), AI.dword(machine, AI.MAP + 0x9A4B4)
    AI.put(machine, GAME + 0x544, 0x850000)
    if position == "occluded":
        position = next((column, row) for row in range(8, height - 8) for column in range(8, width - 8)
                        if AI.dword(machine, AI.GROUND + (row * width + column) * 4) & 1023 == 1023
                        and AI.dword(machine, 0xB00000 + ((height - 1 - row) * width + column) * 4) & 0x20000000
                        and not AI.dword(machine, 0xB00000 + ((height - 1 - row) * width + column + 1) * 4) & 0x20000000)
    slot = None
    if not fresh:
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", owner, -1))
        AI.invoke(machine, 0x41B750, eax=GAME, edx=position[0], ebx=position[1],
                  ecx=kind if kind is not None else 0 if faction == "HUMAN" else 8)
        slot = machine.reg_read(AI.UC_X86_REG_EAX)
        if kind is not None:
            assert machine.mem_read(GAME + 0x7D28 + slot * 220 + 6, 1)[0] == kind
    actor = GAME + 0x7D28 + (slot or 0) * 220
    if moving:
        packet = bytes((5,)) + struct.pack("<h", slot) + bytes((2, 7, 1)) + struct.pack("<hHHh", 1,
            (position[0] + 1) * 256 + 128, position[1] * 256 + 128, slot) + b"\0"
        machine.mem_write(0x709000, packet)
        AI.invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(packet))
        for visit in range(1, 9):
            AI.put(machine, GAME + 0x530, visit)
            AI.put(machine, GAME + 0x94C, visit)
            AI.invoke(machine, 0x419248, eax=GAME, edx=slot)
        assert struct.unpack("<H", machine.mem_read(actor, 2))[0] != position[0] * 256 + 128
    victim_slot = None
    if victim:
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", 2, -1))
        AI.invoke(machine, 0x41B750, eax=GAME, edx=position[0] + 2, ebx=position[1], ecx=0)
        victim_slot = machine.reg_read(AI.UC_X86_REG_EAX)
    AI.put(machine, GAME + 0x7D1C, 0)
    AI.put(machine, GAME + 0x19C0, local_mask)
    AI.put(machine, GAME + 0x540, daylight)
    AI.put(machine, GAME + 0x94C, counter)
    assert bytes(machine.mem_read(GAME + 0x46F30, 4)) == bytes(4)
    calls, writes, skipped, workers = [], [], [], []
    high_water = AI.dword(machine, GAME + 0x7D20)
    if inclusive_high_water_control:
        assert not fresh and slot is not None
        high_water = slot
        AI.put(machine, GAME + 0x7D20, high_water)
    eligible = []
    for index in range(high_water + 1):
        raw = machine.mem_read(GAME + 0x7D28 + index * 220, 220)
        if raw[0x2C] and raw[7] <= 7 and raw[0xCB] not in (1, 2):
            eligible.append(index)
    selected = [index for index in eligible if machine.mem_read(GAME + 0x7D28 + index * 220 + 6, 1)[0] in (0, 8)] if all_troops else [slot] if bounded else eligible
    excluded = [index for index in eligible if index not in selected]
    if stale_metadata:
        for index in range(high_water + 1):
            pointer = GAME + 0x7D28 + index * 220
            if machine.mem_read(pointer + 0x2C, 1)[0]:
                machine.mem_write(pointer + 0xCA, b"\xa5")
        for cell in range(width * height):
            pointer = AI.GROUND + cell * 4
            AI.put(machine, pointer, (AI.dword(machine, pointer) & 0xFFFC03FF) | ((cell & 255) << 10))
    entries = {0x4456F0, 0x44A6D4, 0x454DB8, 0x445A24, 0x445F0C, 0x4463E0, 0x446844,
               0x446C90, 0x4471B0, 0x4476C8, 0x447B60, 0x447FF4, 0x4484E4,
               0x4489CC, 0x448E44, 0x4492B0, 0x4497EC, 0x449D20, 0x44A1E0}

    def observe(emulator, address, size, context):
        if bounded and address == 0x44A74C:
            index = emulator.reg_read(AI.UC_X86_REG_EDI)
            if index in excluded:
                skipped.append(index)
                emulator.reg_write(UC_X86_REG_EIP, 0x44AB5B)
                return
        if address in entries:
            calls.append({"entry": hex(address), "slot": emulator.reg_read(AI.UC_X86_REG_EDX),
                          "radius": emulator.reg_read(AI.UC_X86_REG_EBX)})
            if address not in (0x4456F0, 0x44A6D4, 0x454DB8):
                index = emulator.reg_read(AI.UC_X86_REG_EDX)
                raw = bytes(emulator.mem_read(GAME + 0x7D28 + index * 220, 220))
                stack = emulator.reg_read(AI.UC_X86_REG_ESP)
                workers.append({"entry": hex(address), "slot": index, "type": raw[6],
                                "radius": emulator.reg_read(AI.UC_X86_REG_EBX),
                                "game": emulator.reg_read(AI.UC_X86_REG_EAX),
                                "width": emulator.reg_read(AI.UC_X86_REG_ECX),
                                "arguments": list(struct.unpack("<4i", emulator.mem_read(stack + 4, 16))),
                                "actor": base64.b64encode(raw).decode()})

    def write(emulator, access, address, size, value, context):
        assert (0x700000 <= address < 0x710000
            or AI.GROUND <= address < AI.GROUND + width * height * 4
            or GAME + 0x7D28 <= address < GAME + 0x7D28 + 800 * 220
            and (address - GAME - 0x7D28) % 220 == 0xCA and size == 1), (hex(address), size)
        if AI.GROUND <= address < AI.GROUND + width * height * 4:
            writes.append({"pc": hex(emulator.reg_read(UC_X86_REG_EIP)), "plane": "ground", "index": (address - AI.GROUND) // 4,
                           "size": size, "before": int.from_bytes(emulator.mem_read(address, size), "little"),
                           "after": value & ((1 << (size * 8)) - 1)})
        if GAME + 0x7D28 <= address < GAME + 0x7D28 + 800 * 220:
            writes.append({"pc": hex(emulator.reg_read(UC_X86_REG_EIP)), "plane": "actors", "index": address - GAME - 0x7D28,
                           "size": size, "before": int.from_bytes(emulator.mem_read(address, size), "little"),
                           "after": value & ((1 << (size * 8)) - 1)})
        assert address not in (0x479204, 0x516AA0), "visibility consumed RNG"

    machine.hook_add(UC_HOOK_CODE, observe, begin=0x445600, end=0x455009)
    machine.hook_add(UC_HOOK_MEM_WRITE, write)

    def snapshot():
        return {"actors": base64.b64encode(machine.mem_read(GAME + 0x7D28, 800 * 220)).decode(),
                "ground": list(struct.unpack(f"<{width * height}I", machine.mem_read(AI.GROUND, width * height * 4))),
                "rngCursor": AI.dword(machine, 0x479204), "crtSeed": AI.dword(machine, 0x516AA0),
                "air": list(struct.unpack(f"<{width * height}H", machine.mem_read(0xB40000, width * height * 2))),
                "extra": list(struct.unpack(f"<{width * height}H", machine.mem_read(0xB60000, width * height * 2)))}

    def sound_gate():
        if victim_slot is None:
            return None
        raw = machine.mem_read(GAME + 0x7D28 + victim_slot * 220, 220)
        reached = []

        def stop_at_playback(emulator, address, size, context):
            reached.append(hex(address))
            emulator.emu_stop()

        hook = machine.hook_add(UC_HOOK_CODE, stop_at_playback, begin=0x431E08, end=0x431E08)
        machine.mem_write(AI.NATIVE.STACK, struct.pack("<III", AI.RETURN,
            struct.unpack_from("<H", raw)[0], struct.unpack_from("<H", raw, 4)[0]))
        for register, value in ((AI.UC_X86_REG_EAX, GAME), (AI.UC_X86_REG_EDX, raw[6]),
                                (AI.UC_X86_REG_EBX, 3), (AI.UC_X86_REG_ECX, 1),
                                (AI.UC_X86_REG_ESP, AI.NATIVE.STACK)):
            machine.reg_write(register, value)
        machine.emu_start(0x431DA8, AI.RETURN, count=1000)
        machine.hook_del(hook)
        assert machine.reg_read(UC_X86_REG_EIP) in (0x431E08, AI.RETURN)
        return reached

    phases = []

    def phase(name, address):
        before = snapshot()
        write_start, worker_start, call_start = len(writes), len(workers), len(calls)
        AI.invoke(machine, address, eax=GAME)
        after = snapshot()
        phases.append({"name": name, "before": before, "after": after,
                       "writes": writes[write_start:], "workers": workers[worker_start:],
                       "calls": calls[call_start:]})
        return after

    initial = snapshot()
    gate_before = sound_gate()
    cleared = phase("clear", 0x4456F0)
    computed = phase("compute", 0x44A6D4)
    gate_computed = sound_gate()
    assert initial["rngCursor"] == computed["rngCursor"] and initial["crtSeed"] == computed["crtSeed"]
    assert initial["air"] == computed["air"] and initial["extra"] == computed["extra"]
    persistent = phase("clear", 0x4456F0)
    gate_cleared = sound_gate()
    recomputed = phase("compute", 0x44A6D4)
    assert computed == recomputed
    if victim_slot is not None:
        assert gate_before == [] and gate_computed == gate_cleared == ["0x431e08"]
    assert all((before & 0x80000000) == (after & 0x80000000)
               for before, after in zip(computed["ground"], persistent["ground"]))
    for key, value in initial.items():
        if key == "actors":
            machine.mem_write(GAME + 0x7D28, base64.b64decode(value))
        if key == "ground":
            machine.mem_write(AI.GROUND, struct.pack(f"<{width * height}I", *value))
    writes.clear()
    worker_start, call_start = len(workers), len(calls)
    assert snapshot() == initial
    AI.put(machine, AI.NATIVE.FRAME - 4, GAME)
    machine.reg_write(AI.UC_X86_REG_EBP, AI.NATIVE.FRAME)
    machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
    machine.reg_write(AI.UC_X86_REG_EAX, GAME)
    machine.emu_start(0x419A30, 0x419A46 if counter & 15 == 0 else 0x419A4B, count=5000000)
    assert machine.reg_read(UC_X86_REG_EIP) == (0x419A46 if counter & 15 == 0 else 0x419A4B)
    caller = snapshot()
    phases.append({"name": "caller", "before": initial, "after": caller,
                   "writes": list(writes), "workers": workers[worker_start:], "calls": calls[call_start:]})
    assert caller == (computed if counter & 15 == 0 else initial)
    return {"faction": faction, "slot": slot, "width": width, "height": height,
            "victimSlot": victim_slot,
            "soundGate": {"before": gate_before, "computed": gate_computed, "cleared": gate_cleared,
                          "boundaryOnly": True},
            "localMask": local_mask, "staleMetadataControl": stale_metadata,
            "inclusiveHighWaterControl": inclusive_high_water_control,
            "bounded": bounded, "fresh": fresh, "moving": moving, "daylight": daylight, "counter": counter,
            "selected": selected, "excluded": excluded, "skipped": skipped,
            "terrainSource": machine.visibility_terrain_source,
            "initialTerrain": machine.visibility_initial_terrain,
            "highWater": AI.dword(machine, GAME + 0x7D20), "initial": initial,
            "cleared": cleared, "computed": computed, "persistent": persistent, "recomputed": recomputed,
            "caller": caller, "calls": calls, "writes": writes, "phases": phases,
            "typeTable": base64.b64encode(machine.mem_read(0x4F1880, 110 * 280)).decode(),
            "terrain": list(struct.unpack(f"<{width * height}I", machine.mem_read(0xB00000, width * height * 4))),
            "registry": list(struct.unpack("<800h", machine.mem_read(GAME + 0x468EC, 1600)))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--disassemble", action="store_true")
    parser.add_argument("--faction", default="HUMAN", choices=("HUMAN", "ALIEN"))
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--bounded", action="store_true")
    parser.add_argument("--moving", action="store_true")
    parser.add_argument("--daylight", type=int, default=0)
    parser.add_argument("--counter", type=int, default=16)
    parser.add_argument("--matrix", action="store_true")
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--kind", type=int)
    parser.add_argument("--ground-matrix", action="store_true")
    arguments = parser.parse_args()
    if arguments.disassemble:
        disassemble()
    elif arguments.ground_matrix:
        cases = []
        for faction in ("HUMAN", "ALIEN"):
            for daylight in (0, 128, 256):
                cases.append((f"{faction}-fresh-full-{daylight}", dict(faction=faction, fresh=True, daylight=daylight)))
            cases.append((f"{faction}-fresh-nonlocal", dict(faction=faction, fresh=True, local_mask=0)))
            cases.append((f"{faction}-fresh-metadata-control", dict(faction=faction, fresh=True, stale_metadata=True)))
        for counter in (0, 1, 15, 17, 31, 32, 0xFFFFFFF0, 0xFFFFFFFF):
            cases.append((f"HUMAN-fresh-counter-{counter}", dict(faction="HUMAN", fresh=True, counter=counter)))
        for faction, kind in (("HUMAN", 69), ("ALIEN", 73)):
            for daylight in (0, 128, 256):
                cases.append((f"commander-{kind}-{daylight}", dict(faction=faction, kind=kind, bounded=True, daylight=daylight)))
            for label, options in (("border", dict(position=(1, 1))), ("occluded", dict(position="occluded")),
                                   ("nonlocal", dict(owner=2)), ("allied", dict(owner=2, local_mask=0x50000000))):
                cases.append((f"commander-{kind}-{label}", dict(faction=faction, kind=kind, bounded=True, **options)))
        for faction, kind in (("HUMAN", 16), ("ALIEN", 28)):
            for owner in (0, 2):
                options = dict(faction=faction, kind=kind, bounded=True, position=(1, 1), owner=owner)
                cases.append((f"city-{kind}-border-team-{owner}", options))
        endpoint = dict(faction="HUMAN", kind=69, bounded=True, stale_metadata=True, inclusive_high_water_control=True)
        cases.append(("commander-69-inclusive-high-water-control", endpoint))
        for name, options in cases:
            print(json.dumps({"name": name, **capture(**options)}), flush=True)
    elif arguments.matrix:
        cases = []
        for faction in ("HUMAN", "ALIEN"):
            for daylight in (0, 128, 256):
                cases.append((f"{faction}-stationary-{daylight}", dict(faction=faction, daylight=daylight, victim=True)))
            cases.append((f"{faction}-moving", dict(faction=faction, moving=True, victim=True)))
            cases.append((f"{faction}-border", dict(faction=faction, position=(1, 1))))
            cases.append((f"{faction}-source-occlusion", dict(faction=faction, position="occluded")))
            cases.append((f"{faction}-all-troops", dict(faction=faction, all_troops=True)))
            cases.append((f"{faction}-nonlocal", dict(faction=faction, owner=2)))
            cases.append((f"{faction}-allied", dict(faction=faction, owner=2, local_mask=0x50000000)))
            cases.append((f"{faction}-stale-metadata", dict(faction=faction, stale_metadata=True, all_troops=True)))
        for counter in (0, 1, 15, 17, 31, 32, 0xFFFFFFF0, 0xFFFFFFFF):
            cases.append((f"counter-{counter}", dict(faction="HUMAN", counter=counter, victim=True)))
        for name, options in cases:
            result = capture(bounded=True, **options)
            print(json.dumps({"name": name, **result}), flush=True)
    else:
        result = capture(arguments.faction, arguments.bounded, arguments.moving, arguments.daylight,
                         counter=arguments.counter, fresh=arguments.fresh, kind=arguments.kind)
        if arguments.summary:
            types = base64.b64decode(result["typeTable"])
            result = {"terrain": result["terrainSource"], "calls": result["calls"],
                      "explored": sum(bool(value & 0x80000000) for value in result["computed"]["ground"]),
                      "metadata": [(kind, struct.unpack_from("<i", types, kind * 280 + 120)[0])
                                   for kind in range(106) if struct.unpack_from("<i", types, kind * 280 + 120)[0]]}
        print(json.dumps(result))