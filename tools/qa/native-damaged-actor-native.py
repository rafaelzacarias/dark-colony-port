"""Original projectile damage followed by the damaged actor's registered visit."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("damaged_projectile", Path(__file__).with_name("native-projectiles-native.py"))
PROJECTILE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PROJECTILE)
AI = PROJECTILE.AI
GAME = PROJECTILE.GAME


def actor_world(machine, fire, slot):
    actor = bytes(machine.mem_read(GAME + 0x7D28 + slot * 220, 220))
    world = {**fire["world"], "typeId": actor[6],
             "typeBytes": list(machine.mem_read(0x4F1880 + actor[6] * 280, 280)),
             "enemyMask": AI.dword(machine, GAME + actor[7] * 0xE30 + 0x19C0),
             "teamControl": AI.dword(machine, GAME + actor[7] * 0xE30 + 0xBBC),
             "fin": {}, "nativeFire": {**fire["world"]["nativeFire"], "frames": {}}}
    record = bytes(world["typeBytes"])
    for offset in (0x7C, 0x80, *(0xA0 + index * 4 for index in range(struct.unpack_from("<i", record, 0xE4)[0])),
                   *(0xBC + index * 4 for index in range(struct.unpack_from("<i", record, 0xD8)[0]))):
        bank = struct.unpack_from("<I", record, offset)[0]
        if not bank or str(bank) in world["fin"]:
            continue
        frames = []
        for direction in range(32):
            descriptor = AI.dword(machine, bank + direction * 4)
            timeline, count = AI.dword(machine, descriptor + 0x20), AI.dword(machine, descriptor + 0x28)
            frames.append([list(machine.mem_read(timeline + index * 72, 72)) for index in range(count)])
        world["fin"][str(bank)] = [[frame[2] for frame in direction] for direction in frames]
        world["nativeFire"]["frames"][str(bank)] = frames
    return world


def active_schedule(machine, fire, activity, distance, invoke):
    slot, source_slot = fire["nearbyEnemy"]["enemySlot"], fire["slot"]
    removed_scouts = []
    for scout in range(source_slot + 1, slot):
        address = GAME + 0x7D28 + scout * 220
        before = list(machine.mem_read(address, 220))
        invoke(machine, 0x434D48, eax=GAME, edx=scout)
        removed_scouts.append({"slot": scout, "before": before, "after": list(machine.mem_read(address, 220)),
                               "entry": "0x434d48"})
    world = actor_world(machine, fire, slot)
    source_world = actor_world(machine, fire, source_slot)
    width, height = world["width"], world["height"]
    registry = list(struct.unpack("<800h", machine.mem_read(GAME + 0x468EC, 1600)))
    assert slot in registry and source_slot in registry

    def snapshot():
        return {"raw": list(machine.mem_read(GAME + 0x7D28 + slot * 220, 220)),
                "actors": base64.b64encode(machine.mem_read(GAME + 0x7D28, 800 * 220)).decode(),
                "rngCursor": AI.dword(machine, 0x479204), "task6Budget": AI.dword(machine, 0x478E00),
                "ground": list(struct.unpack(f"<{width * height}I", machine.mem_read(AI.GROUND, width * height * 4))),
                "auxiliarySha256": hashlib.sha256(bytes(machine.mem_read(0xB40000, width * height * 2))
                    + bytes(machine.mem_read(0xB60000, width * height * 2))
                    + bytes(machine.mem_read(GAME + 0x468EC, 1600))).hexdigest(),
                "projectiles": {"records": base64.b64encode(machine.mem_read(GAME + 0x32CA8, 2024 * 40)).decode(),
                    "highWater": AI.dword(machine, GAME + 0x7D24),
                    "heads": list(struct.unpack("<hh", machine.mem_read(GAME + 0x468E8, 4))),
                    "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 384)))}}

    before_order = snapshot()
    column = struct.unpack_from("<H", bytes(before_order["raw"]))[0] >> 8
    row = struct.unpack_from("<H", bytes(before_order["raw"]), 4)[0] >> 8
    family = world["families"][row * width + column]
    step = next(step for step in (-1, 1) if all(
        world["families"][row * width + column + step * offset] == family != 0
        and before_order["ground"][row * width + column + step * offset] & 1023 == 1023
        for offset in range(1, distance + 1)))
    destination = [(column + step * distance) * 256 + 128, row * 256 + 128]
    packet = bytes((5,)) + struct.pack("<h", slot) + bytes((2 if activity == "moving" else 7, 7, 1))
    packet += struct.pack("<hHHh", 1, *destination, slot) + b"\0"
    machine.mem_write(0x709000, packet)
    invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(packet))
    receipt = {"packet": packet.hex(), "before": before_order, "after": snapshot()}
    visits, random_writes, ground_writes, entries = [], [], [], []

    def write(emulator, access, address, size, value, context):
        if address == 0x479204:
            random_writes.append(value)
        if AI.GROUND <= address < AI.GROUND + width * height * 4:
            ground_writes.append({"eip": hex(emulator.reg_read(PROJECTILE.FIRE.ACTOR.UC_X86_REG_EIP)),
                "cell": (address - AI.GROUND) // 4, "size": size,
                "before": int.from_bytes(emulator.mem_read(address, size), "little"), "after": value})

    def observe(emulator, address, size, context):
        entries.append({"entry": hex(address), "source": emulator.reg_read(AI.UC_X86_REG_EDX)})

    hooks = [machine.hook_add(PROJECTILE.FIRE.ACTOR.UC_HOOK_MEM_WRITE, write)]
    hooks += [machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
              for address in (0x441710, 0x441930, 0x4421B8, 0x419248, 0x416104)]
    first_counter = fire["visits"][-1]["counter"] + 1
    for counter in range(first_counter, first_counter + 45):
        AI.put(machine, GAME + 0x530, counter)
        AI.put(machine, 0x478E00, 0)
        for owner in ("target", "source", "projectile"):
            before = snapshot()
            random_writes.clear()
            ground_writes.clear()
            entries.clear()
            invoke(machine, 0x44293C if owner == "projectile" else 0x419248,
                   eax=GAME, **({} if owner == "projectile" else {"edx": slot if owner == "target" else source_slot}))
            after = snapshot()
            visits.append({"before": before, "after": after, "counter": counter, "owner": owner,
                           "randomWrites": list(random_writes), "groundWrites": list(ground_writes), "entries": list(entries)})
            all_actors = base64.b64decode(after["actors"])
            assert all(struct.unpack_from("<i", all_actors, participant * 220 + 12)[0] > 0
                       for participant in (slot, source_slot)), "bounded schedule reached lethal damage"
    for hook in hooks:
        machine.hook_del(hook)
    world["ground"] = receipt["after"]["ground"]
    return {"activity": activity, "distance": distance, "slot": slot, "world": world, "sourceWorld": source_world,
            "visits": visits, "registry": registry, "activeReceipt": receipt,
            "removedScouts": removed_scouts,
            "repeated": False, "receipt": None, "warmup": 0, "runtimeIntercepts": []}


def capture(kind=0, repeated=False, pending_stop=False, warmup=0, activity=None, distance=1):
    machines = []
    configure = PROJECTILE.FIRE.configure_fire
    original_capture = PROJECTILE.FIRE.ACTOR.capture
    original_invoke = AI.invoke
    fire_capture, active, preparation = [], [], []

    def explore(machine, column, row, destination, team):
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", team, -1))
        original_invoke(machine, 0x41B750, eax=GAME, edx=column, ebx=row, ecx=0)
        scout = machine.reg_read(AI.UC_X86_REG_EAX)
        address = GAME + 0x7D28 + scout * 220
        packet = bytes((5,)) + struct.pack("<h", scout) + bytes((2, 7, 1))
        packet += struct.pack("<hHHh", 1, destination * 256 + 128, row * 256 + 128, scout) + b"\0"
        machine.mem_write(0x709000, packet)
        original_invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(packet))
        visits = []
        for _ in range(40):
            AI.put(machine, 0x478E00, 0)
            before = list(machine.mem_read(address, 220))
            original_invoke(machine, 0x419248, eax=GAME, edx=scout)
            after = list(machine.mem_read(address, 220))
            visits.append({"before": before, "after": after})
            if after[0x39] == 1:
                break
        assert struct.unpack_from("<H", bytes(after))[0] >> 8 == destination
        original_invoke(machine, 0x434D48, eax=GAME, edx=scout)
        preparation.append({"slot": scout, "team": team, "packet": packet.hex(), "visits": visits,
                            "unregister": "0x434d48", "after": list(machine.mem_read(address, 220))})

    def retain(machine, kinds):
        configure(machine, kinds)
        machines.append(machine)

    def configured_capture(*args, **kwargs):
        kwargs["fire_options"] = {**kwargs["fire_options"], "rngWarmup": warmup}
        if activity:
            kwargs["acquisition_case"] = {**kwargs["acquisition_case"], "aligned": False, "dx": 3, "dy": 1}
            kwargs["updates"] = 16
        fire = original_capture(*args, **kwargs)
        fire_capture.append(fire)
        return fire

    def invoke(machine, address, *args, **kwargs):
        if activity and address == 0x41B750 and not preparation and kwargs.get("edx") == 67 and kwargs.get("ebx") == 48:
            arguments = bytes(machine.mem_read(AI.NATIVE.STACK + 4, 8))
            explore(machine, 67, 48, 66, 2 if kind == 0 else 1)
            for column in (67, 68, 69):
                explore(machine, column, 49, column + 1, 1 if kind == 0 else 0)
            machine.mem_write(AI.NATIVE.STACK + 4, arguments)
        if activity and address == 0x44293C and not active:
            active.append(active_schedule(machine, fire_capture[0], activity, distance, original_invoke))
        return original_invoke(machine, address, *args, **kwargs)

    PROJECTILE.FIRE.configure_fire = retain
    PROJECTILE.FIRE.ACTOR.capture = configured_capture
    AI.invoke = invoke
    try:
        source = PROJECTILE.capture(kind, armor_level=0 if kind == 8 else None, policy=0)
    finally:
        PROJECTILE.FIRE.configure_fire = configure
        PROJECTILE.FIRE.ACTOR.capture = original_capture
        AI.invoke = original_invoke
    if active:
        return {**active[0], "preparation": preparation, "projectile": source, "binarySha256": source["fire"]["binarySha256"]}
    machine = machines[0]
    slot = source["fire"]["nearbyEnemy"]["enemySlot"]
    actor = GAME + 0x7D28 + slot * 220
    registry = list(struct.unpack("<800h", machine.mem_read(GAME + 0x468EC, 1600)))
    assert slot in registry and source["fire"]["slot"] in registry
    raw = lambda: list(machine.mem_read(actor, 220))
    world = dict(source["fire"]["world"])
    world["typeId"] = raw()[6]
    world["typeBytes"] = list(machine.mem_read(0x4F1880 + raw()[6] * 280, 280))
    world["enemyMask"] = AI.dword(machine, GAME + raw()[7] * 0xE30 + 0x19C0)
    world["teamControl"] = AI.dword(machine, GAME + raw()[7] * 0xE30 + 0xBBC)
    world["combat"] = {**world["combat"], "actors": {
        str(index): list(machine.mem_read(GAME + 0x7D28 + index * 220, 220))
        for index in range(800) if machine.mem_read(GAME + 0x7D28 + index * 220 + 0x2C, 1)[0]}}
    world["fin"] = {}
    world["nativeFire"] = {**world["nativeFire"], "frames": {}}
    record = bytes(world["typeBytes"])
    for offset in (0x7C, 0x80, *(0xA0 + index * 4 for index in range(struct.unpack_from("<i", record, 0xE4)[0])),
                   *(0xBC + index * 4 for index in range(struct.unpack_from("<i", record, 0xD8)[0]))):
        bank = struct.unpack_from("<I", record, offset)[0]
        if not bank or str(bank) in world["fin"]:
            continue
        delays, frames = [], []
        for direction in range(32):
            descriptor = AI.dword(machine, bank + direction * 4)
            timeline, count = AI.dword(machine, descriptor + 0x20), AI.dword(machine, descriptor + 0x28)
            frames.append([list(machine.mem_read(timeline + index * 72, 72)) for index in range(count)])
            delays.append([frame[2] for frame in frames[-1]])
        world["fin"][str(bank)] = delays
        world["nativeFire"]["frames"][str(bank)] = frames
    width, height = world["width"], world["height"]

    def snapshot():
        return {"raw": raw(), "rngCursor": AI.dword(machine, 0x479204),
                "actors": base64.b64encode(machine.mem_read(GAME + 0x7D28, 800 * 220)).decode(),
                "auxiliarySha256": hashlib.sha256(bytes(machine.mem_read(0xB40000, width * height * 2))
                    + bytes(machine.mem_read(0xB60000, width * height * 2))
                    + bytes(machine.mem_read(GAME + 0x468EC, 1600))).hexdigest(),
                "task6Budget": AI.dword(machine, 0x478E00),
                "ground": list(struct.unpack(f"<{width * height}I", machine.mem_read(AI.GROUND, width * height * 4))),
                "projectiles": {"records": base64.b64encode(machine.mem_read(GAME + 0x32CA8, 2024 * 40)).decode(),
                    "highWater": AI.dword(machine, GAME + 0x7D24),
                    "heads": list(struct.unpack("<hh", machine.mem_read(GAME + 0x468E8, 4))),
                    "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 384)))}}

    entries, writes, random_writes, ground_writes = [], [], [], []
    handlers = struct.unpack("<64I", AI.NATIVE.READ(0x4792B8, 256))

    def observe(emulator, address, size, context):
        entries.append({"entry": hex(address), "raw": raw()})

    def write(emulator, access, address, size, value, context):
        eip = hex(emulator.reg_read(PROJECTILE.FIRE.ACTOR.UC_X86_REG_EIP))
        if actor <= address < actor + 220:
            writes.append({"eip": eip, "offset": address - actor, "size": size, "value": value})
        if address == 0x479204:
            random_writes.append(value)
        if AI.GROUND <= address < AI.GROUND + width * height * 4:
            ground_writes.append({"eip": eip, "cell": (address - AI.GROUND) // 4, "size": size,
                "before": int.from_bytes(emulator.mem_read(address, size), "little"), "after": value})

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
             for address in {0x419248, 0x411DD8, 0x412014, 0x435570, 0x41481C, *handlers}
             if 0x400000 <= address < 0x470000]
    hooks.append(machine.hook_add(PROJECTILE.FIRE.ACTOR.UC_HOOK_MEM_WRITE, write))
    visits = []

    def visit(owner, counter):
        AI.put(machine, GAME + 0x530, counter)
        AI.put(machine, 0x478E00, 0)
        before = snapshot()
        entries.clear()
        writes.clear()
        random_writes.clear()
        ground_writes.clear()
        if owner == "projectile":
            AI.invoke(machine, 0x44293C, eax=GAME)
        else:
            AI.invoke(machine, 0x419248, eax=GAME, edx=slot if owner == "target" else source["fire"]["slot"])
        visits.append({"before": before, "after": snapshot(), "counter": counter, "owner": owner,
            "entries": list(entries), "writes": list(writes), "randomWrites": list(random_writes), "groundWrites": list(ground_writes)})

    receipt = None
    if pending_stop:
        packet = bytes((5,)) + struct.pack("<h", slot) + bytes((13, 0))
        before = raw()
        machine.mem_write(0x709000, packet)
        AI.invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(packet))
        receipt = {"packet": packet.hex(), "before": before, "after": raw()}
    if repeated:
        for counter in range(2, 16):
            visit("source", counter)
    for counter in range(16 if repeated else 32, 56):
        visit("target", counter)
        if repeated:
            visit("source", counter)
            for _ in range(100):
                if struct.unpack("<h", machine.mem_read(GAME + 0x468EA, 2))[0] == -1:
                    break
                visit("projectile", counter)
            else:
                raise AssertionError("projectile pass bound")
    for hook in hooks:
        machine.hook_del(hook)
    return {"slot": slot, "world": world, "visits": visits, "projectile": source,
            "repeated": repeated, "receipt": receipt, "warmup": warmup, "registry": registry,
            "binarySha256": source["fire"]["binarySha256"], "runtimeIntercepts": []}


if __name__ == "__main__":
    if "--disassemble" in sys.argv:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(AI.NATIVE.READ(0x419248, 0x600), 0x419248):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
    else:
        cases = [(0, False, False)]
        if "--suite" in sys.argv:
            cases = [(kind, repeated, stop) for kind in (0, 8) for repeated, stop in ((False, False), (True, False), (False, True))]
            cases.extend((kind, False, False, 253) for kind in (0, 8))
            cases.extend((0, False, False, 0, "moving", distance) for distance in (1, 2, 3))
            cases.extend((kind, False, False, 0, "firing", 1) for kind in (0, 8))
        if "--case" in sys.argv:
            cases = [cases[int(sys.argv[sys.argv.index("--case") + 1])]]
        for arguments in cases:
            print(json.dumps(capture(*arguments)), flush=True)