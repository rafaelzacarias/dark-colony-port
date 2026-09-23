"""Source-spawned ordinary projectile continuation, without position rewrites."""

import base64
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("projectile_fire", Path(__file__).with_name("native-fire-native.py"))
FIRE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(FIRE)
AI = FIRE.ACTOR.AI
GAME = FIRE.ACTOR.GAME


@lru_cache(maxsize=None)
def source_collision_profiles(kinds):
    construction = FIRE.ACTOR.module("projectile_geometry", "construction-lifecycle-20260919.py")
    native = construction.source_fixture(AI.NATIVE.IMAGE)
    bindings = construction.load_fin(native, kinds, attack=True)["bindings"]
    sprites = {path.stem.upper(): path for path in (FIRE.ROOT / "raw_cd/DC").rglob("*.SPR")}
    cursor = 0x1D00000
    sprite_pointers = {}
    installed = set()
    profiles = {}
    for binding in bindings:
        state = binding["standState"]
        data = (FIRE.ROOT / state["source"]).read_bytes()
        _, timeline_count, state_count, sprite_count = struct.unpack_from("<4H", data)
        timeline_start = 8 + sprite_count * 8 + state_count * 20
        child_start = timeline_start + timeline_count * 164
        children = []
        for index in range(timeline_count):
            count = struct.unpack_from("<H", data, timeline_start + index * 164)[0]
            children.append(data[child_start:child_start + count * 22])
            child_start += count * 22
        bank = binding["standBank"]
        origin = native.get(native.get(bank) + 0x20) - state["first"] * 72
        for direction in range(32):
            descriptor = native.get(bank + direction * 4)
            timeline = native.get(descriptor + 0x20)
            for local in range(native.get(descriptor + 0x28)):
                frame = timeline + local * 72
                if frame in installed:
                    continue
                installed.add(frame)
                source_children = children[(frame - origin) // 72]
                destination = cursor
                cursor += len(source_children) // 22 * 20
                native.put(frame + 4, destination)
                for offset in range(0, len(source_children), 22):
                    child = source_children[offset:offset + 22]
                    name = child[:8].split(b"\0", 1)[0].decode().upper()
                    if name not in sprite_pointers:
                        sprite = sprites[name].read_bytes()
                        count = struct.unpack_from("<H", sprite, 2)[0]
                        pointer = cursor
                        cursor += 12 + count * 24
                        native.put(pointer + 8, pointer + 12)
                        for index in range(count):
                            native.emulator.mem_write(pointer + 12 + index * 24, sprite[776 + index * 8:784 + index * 8])
                        sprite_pointers[name] = pointer
                    frame_id, horizontal, vertical = struct.unpack_from("<Hhh", child, 8)
                    native.emulator.mem_write(destination + offset // 22 * 20,
                        struct.pack("<Ihhhh", sprite_pointers[name], frame_id, horizontal * 8, vertical * 8, 0))
        pointer = 0x4F1880 + binding["unitType"] * 280
        native.put(0x70D800 - 4, pointer)
        native.run(0x43BD46, {AI.UC_X86_REG_EBP: 0x70D800}, 0x43BD89)
        armor = bytes(native.emulator.mem_read(pointer + 0x24, 12))
        native.emulator.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
        native.emulator.reg_write(AI.UC_X86_REG_EBP, 0x70D800)
        native.emulator.emu_start(0x43BE82, 0x43BF38, count=5000000)
        assert native.emulator.reg_read(FIRE.ACTOR.UC_X86_REG_EIP) == 0x43BF38
        profiles[binding["unitType"]] = (armor, bytes(native.emulator.mem_read(pointer + 0x48, 24)))
    assert cursor < 0x1E00000
    return profiles


def capture(unit_type=0, level=0, distance=1, reuse=False, miss=False, armor_level=None, policy=None, shots=1, airborne=False, wall=False):
    machines = []

    def configure(machine, kinds):
        FIRE.configure_fire(machine, kinds)
        for kind, (armor, rectangle) in source_collision_profiles(tuple(sorted(set(kinds) | {5}))).items():
            machine.mem_write(0x4F1880 + kind * 280 + 0x24, armor)
            machine.mem_write(0x4F1880 + kind * 280 + 0x48, rectangle)
        if policy is not None:
            AI.put(machine, GAME + 0x53C, policy)
        machines.append(machine)

    original_initialize = AI.initialize_source_world
    def initialize(machine, sources, width, height, rows, *args, **kwargs):
        if armor_level is not None:
            rows = list(rows)
            target_team = 2 if unit_type in (0, 69) else 1
            start = next(index for index, line in enumerate(rows) if line.startswith(f"TEAM {target_team} "))
            tokens = rows[start + 11].split()
            tokens[3] = str(armor_level)
            rows[start + 11] = " ".join(tokens)
        return original_initialize(machine, sources, width, height, rows, *args, **kwargs)
    AI.initialize_source_world = initialize
    fire = FIRE.ACTOR.capture(unit_type, 7, 1, 1, order=7, updates=1 + (shots - 1) * 17,
        faction="ALIEN" if unit_type in (8, 73) else "HUMAN",
        acquisition_case={"team": 2 if unit_type in (0, 69) else 1, "type": 8 if armor_level is not None else 0,
                          "aligned": True, "revealCell": True},
        fire_capture=True, configure_fire=configure,
        fire_options={"sourceTeam": 0 if unit_type in (8, 73) else 1,
                      "scenarioWeaponLevel": level, "targetDistance": distance,
                      "poisonPool": reuse, "reusePool": reuse, "rngWarmup": 253 if reuse else 0})
    AI.initialize_source_world = original_initialize
    machine = machines[0]
    assert len(fire["launches"]) == shots, {"launches": fire["launches"], "scans": fire["scans"],
                                     "raw": fire["visits"][-1]["raw"]}
    if miss:
        AI.invoke(machine, 0x434D48, eax=GAME, edx=fire["nearbyEnemy"]["enemySlot"])
    air_slot = None
    if airborne:
        target = bytes(fire["nearbyEnemy"]["enemyRaw"])
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", target[7], -1))
        AI.invoke(machine, 0x41B750, eax=GAME, edx=struct.unpack_from("<H", target)[0] >> 8,
                  ebx=(struct.unpack_from("<H", target, 4)[0] >> 8) - (1 if airborne == 2 else 0), ecx=5)
        air_slot = machine.reg_read(AI.UC_X86_REG_EAX)
        assert machine.mem_read(GAME + 0x7D28 + air_slot * 220 + 6, 1)[0] == 5
    world = fire["world"]
    width, height = world["width"], world["height"]
    projectile_families = list(world["families"])
    wall_input = None
    if wall:
        target = bytes(fire["nearbyEnemy"]["enemyRaw"])
        column, row = struct.unpack_from("<H", target)[0] >> 8, struct.unpack_from("<H", target, 4)[0] >> 8
        source_cell = next(index for index, family in enumerate(world["families"]) if family == 0)
        rows = AI.dword(machine, AI.MAP + 0x1404)
        source_address = AI.dword(machine, rows + (source_cell // width) * 4) + (source_cell % width) * 24
        destination = AI.dword(machine, rows + row * 4) + column * 24
        source_record = bytes(machine.mem_read(source_address, 24))
        machine.mem_write(destination, source_record)
        projectile_families[row * width + column] = 0
        wall_input = {"sourceCell": source_cell, "cell": row * width + column, "raw24": list(source_record),
                      "label": "controlled obstacle input: original impassable PTH record copied after launch"}
    projectile_ground = list(struct.unpack(f"<{width * height}I", machine.mem_read(AI.GROUND, width * height * 4)))
    projectile_air = [struct.unpack("<H", machine.mem_read(AI.dword(machine, AI.MAP + 0xC04 + row * 4) + column * 2, 2))[0]
                      for row in range(height) for column in range(width)]
    if air_slot is not None:
        assert any(value & 1023 == air_slot for value in projectile_air)
    projectile_fin = {}
    for weapon in (1, 2, 3, 5, 15, 16, 17, 62):
        for offset in (44, 48, 52, 56, 60):
            bank = AI.dword(machine, 0x4F0200 + weapon * 72 + offset)
            if not bank or str(bank) in projectile_fin:
                continue
            directions = []
            for direction in range(32):
                descriptor = AI.dword(machine, bank + direction * 4)
                timeline = AI.dword(machine, descriptor + 0x20)
                count = AI.dword(machine, descriptor + 0x28)
                assert 0 < count < 256, (weapon, bank, descriptor, count)
                directions.append([machine.mem_read(timeline + frame * 72 + 2, 1)[0] for frame in range(count)])
            projectile_fin[str(bank)] = directions

    def spatial_hash():
        return hashlib.sha256(bytes(machine.mem_read(AI.GROUND, width * height * 4))
            + bytes(machine.mem_read(0xB40000, width * height * 2))
            + bytes(machine.mem_read(0xB60000, width * height * 2))
            + bytes(machine.mem_read(GAME + 0x468EC, 1600))).hexdigest()
    spatial_before = spatial_hash()

    def snapshot():
        return {"projectiles": {
            "records": base64.b64encode(machine.mem_read(GAME + 0x32CA8, 2024 * 40)).decode(),
            "highWater": AI.dword(machine, GAME + 0x7D24),
            "heads": list(struct.unpack("<hh", machine.mem_read(GAME + 0x468E8, 4))),
            "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 384)))},
            "actors": base64.b64encode(machine.mem_read(GAME + 0x7D28, 800 * 220)).decode(),
            "rngCursor": AI.dword(machine, 0x479204)}

    initial = snapshot()
    visits = []
    events = []
    random_writes = []

    def observe(emulator, address, size, context):
        events.append({"entry": hex(address), "pass": len(visits),
            "eax": emulator.reg_read(AI.UC_X86_REG_EAX), "edx": emulator.reg_read(AI.UC_X86_REG_EDX)})

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
             for address in (0x4423F8, 0x441930, 0x441BEC, 0x4421B8, 0x411DB4)]
    def write(emulator, access, address, size, value, context):
        if address == 0x479204:
            random_writes.append(value)
    hooks.append(machine.hook_add(FIRE.ACTOR.UC_HOOK_MEM_WRITE, write))
    for _ in range(100):
        random_start = len(random_writes)
        AI.invoke(machine, 0x44293C, eax=GAME)
        visits.append({**snapshot(), "randomWrites": random_writes[random_start:]})
        if visits[-1]["projectiles"]["heads"][1] == -1:
            break
    result = {"fire": fire, "initial": initial, "visits": visits, "events": list(events),
            "policy": AI.dword(machine, GAME + 0x53C),
            "boom": list(machine.mem_read(0x4F90D0, 13 * 136)), "projectileFin": projectile_fin,
            "projectileGround": projectile_ground, "projectileAir": projectile_air,
            "projectileFamilies": projectile_families, "wallInput": wall_input,
            "expectedHits": 0 if miss else shots, "spatialBefore": spatial_before, "spatialAfter": spatial_hash(),
            "fixture": {"reuse": reuse, "miss": miss, "armorLevel": armor_level, "policy": policy,
                        "distance": distance, "shots": shots, "airSlot": air_slot, "airCollision": airborne == 2},
            "sourceProjection": {"geometry": "source FIN children + SPR frame records -> 0x43be82..0x43bf38",
                "armor": "0x43bd46..0x43bd89; scenario team levels retained", "sourceInspire": 0}}
    if (unit_type, level, distance, reuse, miss, armor_level, policy, shots, airborne, wall) == (0, 0, 1, False, False, None, None, 1, False, False):
        continuation = {"registered": []}
        for counter in range(2, 30):
            AI.put(machine, 0x478E00, 0)
            AI.put(machine, GAME + 0x530, counter)
            before = snapshot()
            AI.invoke(machine, 0x419248, eax=GAME, edx=fire["slot"])
            after = snapshot()
            continuation["registered"].append({"before": before, "after": after, "counter": counter})
            if after["projectiles"]["heads"][1] != -1:
                break
        assert continuation["registered"][-1]["after"]["projectiles"]["heads"][1] == 0
        AI.invoke(machine, 0x44293C, eax=GAME)
        continuation["afterTravel"] = snapshot()
        result["continuation"] = continuation
    for hook in hooks:
        machine.hook_del(hook)
    return result


if __name__ == "__main__":
    if "--disassemble" in sys.argv:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        for start, end in ((0x44293C, 0x442A40), (0x434F6C, 0x435240),
                           (0x441930, 0x441BEC), (0x441504, 0x441710), (0x42630C, 0x4264C8)):
            for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(AI.NATIVE.READ(start, end - start), start):
                print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
    else:
        cases = [(0, 0, 1, False, False, None, None)]
        if "--suite" in sys.argv:
            cases = [(kind, level, distance, reuse, False, None, None)
                for kind, level in ((0, 0), (0, 1), (0, 2), (8, 0), (8, 1), (8, 2), (69, 0), (73, 0))
                for distance, reuse in ((1, False), (3, True))]
            cases += [(0, 0, 1, True, True, None, None), (8, 0, 1, True, True, None, None)]
            cases += [(0, 2, 1, False, False, level, policy) for level in (1, 2) for policy in (0, 1)]
            cases += [(kind, 0, 3, reuse, False, None, None, 2) for kind in (0, 69) for reuse in (False, True)]
            cases += [(0, 0, 1, False, True, None, None, 1, True)]
            cases += [(0, 0, 1, False, miss, None, None, 1, False, True) for miss in (False, True)]
            cases += [(0, 0, 1, False, True, None, None, 1, 2)]
        if "--case" in sys.argv:
            cases = [cases[int(sys.argv[sys.argv.index("--case") + 1])]]
        for arguments in cases:
            print(json.dumps(capture(*arguments)), flush=True)