"""Original registered type8 continuation evidence and idle-branch diagnostics."""

import importlib.util
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "continuation_damaged", Path(__file__).with_name("native-damaged-actor-native.py")
)
damaged = importlib.util.module_from_spec(spec)
spec.loader.exec_module(damaged)
AI = damaged.AI
GAME = damaged.GAME


def initialize_sound(machine):
    root = AI.NATIVE.ROOT / "raw_cd/DC/SOUND"
    ids = []
    for line in (root / "SOUND2.DAT").read_text().splitlines():
        if not line.split() or not line.split()[0].isdigit():
            continue
        machine.mem_write(0x70D800 - 0x2B2, line.encode() + b"\0")
        machine.reg_write(AI.UC_X86_REG_EBP, 0x70D800)
        machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
        machine.emu_start(0x430830, 0x430905, count=100000)
        assert machine.reg_read(AI.UC_X86_REG_EIP) == 0x430905
        ids.append(int(line.split()[0]))
    for line in (root / "SLIST.DAT").read_text().splitlines():
        tokens = line.split()
        if not tokens or not tokens[0].isdigit():
            continue
        machine.mem_write(0x708800, (" " + " ".join(tokens[1:])).encode() + b"\0")
        AI.put(machine, 0x70D800 - 0x24, 0x708800)
        AI.put(machine, 0x70D800 - 4, int(tokens[0]))
        machine.reg_write(AI.UC_X86_REG_EBP, 0x70D800)
        machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
        machine.emu_start(0x431237, 0x4314EE, count=100000)
        assert machine.reg_read(AI.UC_X86_REG_EIP) == 0x4314EE
    machine.mem_write(0x47963D, b"\x01")
    AI.put(machine, 0x4D1994, 0x708000)
    AI.put(machine, 0x708008, 0x708200)
    AI.put(machine, 0x708280, 0x430F50)
    AI.put(machine, 0x708700, 0x708720)
    platform = {0x708600: ("GetStatus", 2), 0x708610: ("SetVolume", 2),
                0x708620: ("SetPan", 2), 0x708630: ("Play", 4)}
    for offset, address in ((0x24, 0x708600), (0x3C, 0x708610), (0x40, 0x708620), (0x30, 0x708630)):
        AI.put(machine, 0x708720 + offset, address)
    for sound_id in ids:
        AI.put(machine, 0x4C61B0 + sound_id * 116 + 76, 0x708700)
    AI.put(machine, 0x516A94, 0x708400)
    AI.invoke(machine, 0x44E251, eax=1)
    AI.put(machine, 0x708108, 55 * 256 + 128)
    AI.put(machine, 0x708110, 34 * 256 + 128)
    calls = []

    def boundary(emulator, address, size, context):
        name, count = platform[address]
        stack = emulator.reg_read(AI.UC_X86_REG_ESP)
        arguments = [AI.dword(emulator, stack + 4 + index * 4) for index in range(count)]
        calls.append({"method": name, "arguments": arguments})
        if name == "GetStatus":
            AI.put(emulator, arguments[1], 0)
        emulator.reg_write(AI.UC_X86_REG_EAX, 0)
        emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4 + count * 4)
        emulator.reg_write(AI.UC_X86_REG_EIP, AI.dword(emulator, stack))

    for address in platform:
        machine.hook_add(AI.UC_HOOK_CODE, boundary, begin=address, end=address)
    return calls


def capture(mission, limit, owned_originals=False):
    source_spec = importlib.util.spec_from_file_location(
        "continuation_source", Path(__file__).with_name("source-native-task-options-native.py")
    )
    source = importlib.util.module_from_spec(source_spec)
    source_spec.loader.exec_module(source)
    visibility_spec = importlib.util.spec_from_file_location(
        "continuation_visibility", Path(__file__).with_name("native-visibility-native.py")
    )
    visibility = importlib.util.module_from_spec(visibility_spec)
    visibility_spec.loader.exec_module(visibility)
    retained = []
    animation_kinds = []
    original_invoke = source.AI.invoke
    original_scan = source.scan
    original_animations = source.AI.load_carrier_animations

    def animations(machine, kinds):
        animation_kinds.extend(kinds)
        return original_animations(machine, kinds)

    def scan(machine, sources, rows, faction, name):
        visibility.load_terrain(machine, sources, rows)
        return original_scan(machine, sources, rows, faction, name)

    class FreshBoundary(Exception):
        pass

    def retain(machine, address, **arguments):
        if address == 0x41B750:
            retained.append(machine)
            raise FreshBoundary()
        return original_invoke(machine, address, **arguments)

    source.AI.invoke = retain
    source.scan = scan
    source.AI.load_carrier_animations = animations
    try:
        source.capture(mission)
    except FreshBoundary:
        pass
    finally:
        source.AI.invoke = original_invoke
        source.scan = original_scan
        source.AI.load_carrier_animations = original_animations
    machine = retained[0]
    sound_calls = initialize_sound(machine)
    width = AI.dword(machine, AI.MAP + 0x9A4B0)
    height = AI.dword(machine, AI.MAP + 0x9A4B4)
    damaged.PROJECTILE.FIRE.configure_fire(machine, animation_kinds)
    for kind, (armor, rectangle) in damaged.PROJECTILE.source_collision_profiles((0, 8)).items():
        machine.mem_write(0x4F1880 + kind * 280 + 0x24, armor)
        machine.mem_write(0x4F1880 + kind * 280 + 0x48, rectangle)
    AI.put(machine, AI.NATIVE.FRAME - 4, GAME)
    machine.reg_write(AI.UC_X86_REG_EBP, AI.NATIVE.FRAME)
    machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
    machine.emu_start(0x41989E, 0x419990, count=5000000)
    assert machine.reg_read(AI.UC_X86_REG_EIP) == 0x419990
    regions = {"actors": (GAME + 0x7D28, 800 * 220), "records": (GAME + 0x32CA8, 2024 * 40),
               "ground": (AI.GROUND, width * height * 4), "air": (0xB40000, width * height * 2),
               "extra": (0xB60000, width * height * 2), "registry": (GAME + 0x468EC, 1600)}

    def buffers():
        return {name: bytes(machine.mem_read(address, size)) for name, (address, size) in regions.items()}

    def metadata():
        return {"rngCursor": AI.dword(machine, 0x479204), "task6Budget": AI.dword(machine, 0x478E00),
                "highWater": AI.dword(machine, GAME + 0x7D24),
                "heads": list(struct.unpack("<hh", machine.mem_read(GAME + 0x468E8, 4))),
                "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 384)))}

    initial_actors = buffers()["actors"]
    original_slots = [slot for slot in range(152, 800)
                      if initial_actors[slot * 220 + 0x2C] == 1
                      and initial_actors[slot * 220 + 6] in (0, 8, 2, 3, 69, 73)] if owned_originals else []
    prefix = {"buffers": {name: base64.b64encode(value).decode() for name, value in buffers().items()},
              **metadata(), "visits": []}
    prefix_random = []

    def prefix_write(emulator, access, address, size, value, context):
        if address == 0x479204:
            prefix_random.append(value)

    prefix_hook = machine.hook_add(damaged.PROJECTILE.FIRE.ACTOR.UC_HOOK_MEM_WRITE, prefix_write)
    for counter in range(1, 17) if owned_originals else ():
        AI.put(machine, GAME + 0x530, counter)
        AI.put(machine, 0x478E00, 0)
        for slot in original_slots:
            before = buffers()
            prefix_random.clear()
            original_invoke(machine, 0x419248, eax=GAME, edx=slot)
            after = buffers()
            prefix["visits"].append({"counter": counter, "slot": slot,
                "changes": {name: [[index, value] for index, value in enumerate(after[name])
                                   if value != before[name][index]] for name in after},
                "randomWrites": list(prefix_random), **metadata()})
    machine.hook_del(prefix_hook)
    slots = []
    path_rows = AI.dword(machine, AI.MAP + 0x1404)
    families = [machine.mem_read(AI.dword(machine, path_rows + vertical * 4) + horizontal * 24 + 12, 1)[0]
                for vertical in range(height) for horizontal in range(width)]
    source_ground = struct.unpack(f"<{width * height}I", buffers()["ground"])
    source_air = struct.unpack(f"<{width * height}H", buffers()["air"])
    cell = next(cell for cell in range(width * height)
                if 12 <= cell % width <= width - 12 and 12 <= cell // width <= height - 12
                and all(source_ground[cell + vertical * width + horizontal] & 1023 == 1023
                        and source_air[cell + vertical * width + horizontal] & 1023 == 1023
                        for vertical in range(-8, 9) for horizontal in range(-8, 9))
                and all(families[cell + offset] == families[cell] != 0 and source_air[cell + offset] >> 10 == 0
                        for offset in (-2, -1, 0, 1, 2, 3)))
    column, row = cell % width, cell // width
    AI.put(machine, 0x708108, column * 256 + 128)
    AI.put(machine, 0x708110, row * 256 + 128)
    AI.put(machine, GAME + 0x530, 16)
    for team, horizontal in ((1, column - 2), (0, column)):
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", team, -1))
        original_invoke(machine, 0x41B750, eax=GAME, edx=horizontal, ebx=row, ecx=8)
        slots.append(machine.reg_read(AI.UC_X86_REG_EAX))
    assert all(152 <= slot < 800 for slot in slots)
    high_water = AI.dword(machine, GAME + 0x7D20)
    eligible = [slot for slot in range(high_water + 1)
                if machine.mem_read(GAME + 0x7D28 + slot * 220 + 0x2C, 1)[0]
                and machine.mem_read(GAME + 0x7D28 + slot * 220 + 7, 1)[0] < 8
                and machine.mem_read(GAME + 0x7D28 + slot * 220 + 0xCB, 1)[0] not in (1, 2)]
    excluded = [slot for slot in eligible if slot != slots[1]]

    def visibility_boundary(emulator, address, size, context):
        if emulator.reg_read(AI.UC_X86_REG_EDI) in excluded:
            emulator.reg_write(AI.UC_X86_REG_EIP, 0x44AB5B)

    visibility_hook = machine.hook_add(AI.UC_HOOK_CODE, visibility_boundary, begin=0x44A74C, end=0x44A74C)
    original_invoke(machine, 0x4456F0, eax=GAME)
    original_invoke(machine, 0x44A6D4, eax=GAME)
    machine.hook_del(visibility_hook)
    world = {"width": width, "height": height,
             "pthSha256": hashlib.sha256((AI.NATIVE.ROOT / "raw_cd/DC/SCENARIO/ALIEN" / f"{mission}.PTH").read_bytes()).hexdigest(),
             "families": families,
             "ground": list(struct.unpack(f"<{width * height}I", buffers()["ground"])),
             "air": list(struct.unpack(f"<{width * height}H", buffers()["air"])),
             "extra": list(struct.unpack(f"<{width * height}H", buffers()["extra"])),
             "weapons": list(machine.mem_read(0x4F0200, 80 * 72)),
             "randomTable": list(struct.unpack("<256i", machine.mem_read(0x478E04, 1024)))}
    types = bytes(machine.mem_read(0x4F1880, 110 * 280))
    damage_rows = AI.dword(machine, 0x4F98D0)
    armor_count = max(struct.unpack_from("<i", types, kind * 280 + 0x40)[0] for kind in range(110)) + 1
    damage_count = max(struct.unpack_from("<i", bytes(world["weapons"]), weapon * 72)[0] for weapon in range(80)) + 1
    offsets, rings = [], 0
    while rings < 17:
        assert len(offsets) < 10000
        point = list(struct.unpack("<hh", machine.mem_read(0x434090 + len(offsets) * 4, 4)))
        offsets.append(point)
        rings += point[0] == 99
    world["combat"] = {"typeTable": list(types), "relations": list(machine.mem_read(GAME + 0x46F34, 100)),
                       "actors": {}, "scanOffsets": offsets,
                       "cityFlags": [machine.mem_read(GAME + team * 0xE30 + 0xC10 + city, 1)[0]
                                     for team in range(8) for city in range(15)],
                       "damageTable": [list(struct.unpack(f"<{armor_count}h", machine.mem_read(
                           AI.dword(machine, damage_rows + index * 4), armor_count * 2))) for index in range(damage_count)]}
    world["nativeFire"] = {"spread": list(machine.mem_read(0x4F90D0, 13 * 136)), "frames": {}}
    profiles = {str(slot): damaged.actor_world(machine, {"world": world}, slot) for slot in (*original_slots, *slots)}
    for profile in profiles.values():
        if profile["typeId"] not in (0, 8):
            profile.pop("nativeFire", None)
    projectile_fin = {}
    for weapon in (1, 15):
        for offset in (44, 48, 52, 56, 60):
            bank = AI.dword(machine, 0x4F0200 + weapon * 72 + offset)
            if not bank or str(bank) in projectile_fin:
                continue
            directions = []
            for direction in range(32):
                descriptor = AI.dword(machine, bank + direction * 4)
                timeline = AI.dword(machine, descriptor + 0x20)
                count = AI.dword(machine, descriptor + 0x28)
                directions.append([machine.mem_read(timeline + index * 72 + 2, 1)[0] for index in range(count)])
            projectile_fin[str(bank)] = directions
    packet = b""
    for slot, order, destination in ((slots[0], 2, column - 1), (slots[1], 7, column + 2)):
        packet += bytes((5,)) + struct.pack("<h", slot) + bytes((order, 7, 1))
        packet += struct.pack("<hHHh", 1, destination * 256 + 128, row * 256 + 128, slot)
    packet += b"\0"
    machine.mem_write(0x709000, packet)
    original_invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(packet))
    initial = buffers()
    header = {"kind": "initial", "mission": mission, "slots": slots, "column": column, "row": row,
              "originalSlots": original_slots, "prefix": prefix if owned_originals else None,
              "counterPolicy": "QA explicit caller GAME+530=1..limit; not original global scheduler",
              "binarySha256": AI.NATIVE.AUDIT.DIGEST, "world": world, "profiles": profiles,
              "policy": AI.dword(machine, GAME + 0x53C), "projectileFin": projectile_fin,
              "sound": {"initialized": machine.mem_read(0x47963D, 1)[0],
                        "sourceDisabled": machine.mem_read(0x47963C, 1)[0], "platform": "DirectSoundBuffer methods only"},
              "originalActors": base64.b64encode(initial_actors).decode(), "receipt": packet.hex(),
              "visibility": {"selected": [slots[1]], "excluded": excluded, "terrain": machine.visibility_terrain_source},
              "buffers": {name: base64.b64encode(value).decode() for name, value in initial.items()}, **metadata()}
    print(json.dumps(header), flush=True)
    ground_writes, random_writes, entries, scans = [], [], [], []
    current_scan = None

    def observe(emulator, address, size, context):
        nonlocal current_scan
        if address == 0x435570:
            current_scan = {"slot": emulator.reg_read(AI.UC_X86_REG_EDX), "radius": emulator.reg_read(AI.UC_X86_REG_EBX), "maxIndex": -1}
            scans.append(current_scan)
        elif address == 0x4356B6:
            current_scan["maxIndex"] = max(current_scan["maxIndex"], emulator.reg_read(AI.UC_X86_REG_EAX) // 4)
        elif address == 0x435C0A:
            current_scan["target"] = struct.unpack("<i", emulator.mem_read(emulator.reg_read(AI.UC_X86_REG_EBP) - 0x54, 4))[0]
        else:
            entries.append({"entry": hex(address), "edx": emulator.reg_read(AI.UC_X86_REG_EDX)})

    def write(emulator, access, address, size, value, context):
        if address == 0x479204:
            random_writes.append(value)
        if AI.GROUND <= address < AI.GROUND + width * height * 4:
            ground_writes.append({"eip": hex(emulator.reg_read(AI.UC_X86_REG_EIP)), "cell": (address - AI.GROUND) // 4,
                                  "size": size, "before": int.from_bytes(emulator.mem_read(address, size), "little"), "after": value})

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
             for address in (0x435570, 0x4356B6, 0x435C0A, 0x419248, 0x441710, 0x441930, 0x414CE4, 0x431DA8, 0x431D79,
                             0x4148B0, 0x416104, 0x44492C)]
    hooks.append(machine.hook_add(damaged.PROJECTILE.FIRE.ACTOR.UC_HOOK_MEM_WRITE, write))
    for counter in range(17, limit + 1):
        AI.put(machine, GAME + 0x530, counter)
        AI.put(machine, 0x478E00, 0)
        for slot in (*original_slots, *slots, None):
            before = buffers()
            ground_writes.clear()
            random_writes.clear()
            entries.clear()
            scans.clear()
            sound_calls.clear()
            original_invoke(machine, 0x44293C if slot is None else 0x419248, eax=GAME,
                            **({} if slot is None else {"edx": slot}))
            after = buffers()
            changes = {name: [[index, value] for index, value in enumerate(after[name]) if value != before[name][index]]
                       for name in after}
            print(json.dumps({"kind": "visit", "counter": counter, "slot": slot, "changes": changes,
                              "hashes": {name: hashlib.sha256(value).hexdigest() for name, value in after.items()},
                              "entries": entries, "scans": scans, "groundWrites": ground_writes,
                              "soundCalls": sound_calls, "crtSeed": AI.dword(machine, 0x70840C),
                              "randomWrites": random_writes, **metadata()}), flush=True)
            assert all(struct.unpack_from("<i", after["actors"], participant * 220 + 12)[0] > 0 for participant in slots)
    for hook in hooks:
        machine.hook_del(hook)


def inspect_idle():
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32

    handlers = struct.unpack("<64I", AI.NATIVE.READ(0x4792B8, 256))
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    print("task table:", [hex(address) for address in handlers[:16]])
    for start, end in ((0x4148B0, 0x414CE4), (0x435570, 0x435C14)):
        print(f"branch: {start:#x}")
        for instruction in decoder.disasm(AI.NATIVE.READ(start, end - start), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--mission", choices=("ALIEN01", "ALIEN02"), default="ALIEN02")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--owned-originals", action="store_true")
    arguments = parser.parse_args()
    if arguments.inspect:
        inspect_idle()
    else:
        capture(arguments.mission, arguments.limit, arguments.owned_originals)