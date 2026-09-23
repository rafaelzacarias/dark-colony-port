"""Isolated source SCN actor receipt and registered task visits; no task stubs."""

import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys
from unicorn import UC_HOOK_MEM_WRITE
from unicorn.x86_const import UC_X86_REG_EIP

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools/research" / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


AI = module("actor_ai", "ai-policy-20260919.py")
PLACEMENT = module("actor_placement", "scenario-placement-20260919.py")
GAME = AI.NATIVE.GAME


def capture(unit_type, mode, count, counter, faction="HUMAN", order=2, distance=2, source_slot=None, updates=2, poison=False, stop_task=None, nearby_enemy=False, acquisition_case=None, combat_inputs=False, fire_capture=False, configure_fire=None, fire_options=None):
    animations = None

    def load_animations(machine, rows):
        nonlocal animations
        kinds = {0, 2, 3, 8, 69, 73, 92, 93, unit_type}
        if acquisition_case:
            kinds.add(acquisition_case.get("type", 0))
            kinds.update(target["type"] for target in acquisition_case.get("targets", []))
        kinds.update(int(line.split()[2]) for line in rows if len(line.split()) == 6)
        kinds.update(int(line.split()[2]) for line in rows
                     if len(line.split()) == 5 and line.split()[2] == "40")
        animations = AI.load_carrier_animations(machine, sorted(kinds))

    def prepare(machine, sources, width, height, rows):
        if fire_options and "scenarioWeaponLevel" in fire_options:
            rows = list(rows)
            upgrade_team = 0 if fire_options.get("sourceSlot") is not None else fire_options.get("sourceTeam", 1)
            start = next(index for index, line in enumerate(rows) if line.startswith(f"TEAM {upgrade_team} "))
            tokens = rows[start + 11].split()
            assert len(tokens) == 5
            tokens[2] = str(fire_options["scenarioWeaponLevel"])
            rows[start + 11] = " ".join(tokens)
        AI.initialize_source_world(machine, sources, width, height, rows, PLACEMENT, runtime=True,
            animations=load_animations, full_source=True)

    machine = AI.source_fixture(faction, 2 if faction == "HUMAN" else 1, prepare, False, fresh_game=True)
    if configure_fire:
        configure_fire(machine, [profile["unitType"] for profile in animations["profiles"]])
    AI.put(machine, GAME + 0x544, 0x850000)
    AI.put(machine, GAME + 0x530, counter)
    AI.put(machine, GAME + 0x94C, counter)
    if acquisition_case or combat_inputs:
        AI.put(machine, AI.NATIVE.FRAME - 4, GAME)
        machine.reg_write(AI.UC_X86_REG_EBP, AI.NATIVE.FRAME)
        machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
        machine.emu_start(0x41989E, 0x419990, count=5000000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x419990
    if source_slot is None:
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", (fire_options or {}).get("sourceTeam", 1), -1))
        AI.invoke(machine, 0x41B750, eax=GAME, edx=67, ebx=48, ecx=unit_type)
        slot = machine.reg_read(AI.UC_X86_REG_EAX)
    else:
        slot = source_slot
    assert 152 <= slot < 800, slot
    actor = GAME + 0x7D28 + slot * 220
    if poison:
        machine.mem_write(actor + 0x86, b"\xa5" * 16)
        machine.mem_write(actor + 0x58, struct.pack("<H", 0xABCD))
    read = lambda: list(machine.mem_read(actor, 220))
    before = read()
    unit_type = before[6]
    origin_x, origin_y = struct.unpack_from("<H", bytes(before))[0] >> 8, struct.unpack_from("<H", bytes(before), 4)[0] >> 8
    def reveal_cell(column, row):
        width = AI.dword(machine, AI.MAP + 0x9A4B0)
        cell = AI.GROUND + (row * width + column) * 4
        if AI.dword(machine, cell) & AI.dword(machine, GAME + before[7] * 0xE30 + 0x19C0):
            return
        destination = next((column + step, row) for step in (1, -1)
                           if AI.dword(machine, cell + step * 4) & 1023 == 1023)
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", before[7], -1))
        AI.invoke(machine, 0x41B750, eax=GAME, edx=column, ebx=row, ecx=0)
        scout_slot = machine.reg_read(AI.UC_X86_REG_EAX)
        packet = bytes((5,)) + struct.pack("<h", scout_slot) + bytes((2, 7, 1)) + struct.pack("<hHHh", 1,
            destination[0] * 256 + 128, destination[1] * 256 + 128, scout_slot) + b"\0"
        machine.mem_write(0x709000, packet)
        AI.invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(packet))
        AI.invoke(machine, 0x419248, eax=GAME, edx=scout_slot)
        assert AI.dword(machine, cell) & AI.dword(machine, GAME + before[7] * 0xE30 + 0x19C0)
    enemy_setup = None
    if nearby_enemy or acquisition_case:
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", before[7], -1))
        AI.invoke(machine, 0x41B750, eax=GAME, edx=origin_x, ebx=origin_y - 1, ecx=0)
        scout = machine.reg_read(AI.UC_X86_REG_EAX)
        scout_stream = bytes((5,)) + struct.pack("<h", scout) + bytes((2, 7, 1)) + struct.pack("<hHHh", 1,
            (origin_x + 1) * 256 + 128, (origin_y - 1) * 256 + 128, scout) + b"\0"
        machine.mem_write(0x709000, scout_stream)
        AI.invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(scout_stream))
        AI.invoke(machine, 0x419248, eax=GAME, edx=scout)
        target_team = acquisition_case.get("team", 0) if acquisition_case else 0
        target_type = acquisition_case.get("type", 0) if acquisition_case else 0
        machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", target_team, -1))
        target_x = origin_x + (acquisition_case.get("dx", 0) if acquisition_case else 0)
        target_y = origin_y + (acquisition_case.get("dy", -1) if acquisition_case else -1)
        if acquisition_case and acquisition_case.get("aligned"):
            if not fire_capture:
                assert before[9] % 32 == 0
            delta = ((3, 0), (3, 3), (0, 3), (-3, 3), (-3, 0), (-3, -3), (0, -3), (3, -3))[((before[9] + 16) & 255) // 32]
            if fire_options and "targetDistance" in fire_options:
                delta = tuple(value // 3 * fire_options["targetDistance"] for value in delta)
            target_x, target_y = origin_x + delta[0], origin_y + delta[1]
        if acquisition_case and acquisition_case.get("revealCell"):
            reveal_cell(target_x, target_y)
            machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", target_team, -1))
        AI.invoke(machine, 0x41B750, eax=GAME, edx=target_x, ebx=target_y, ecx=target_type)
        enemy = machine.reg_read(AI.UC_X86_REG_EAX)
        enemy_setup = {"scoutSlot": scout, "enemySlot": enemy, "scoutStream": scout_stream.hex(),
                       "enemyRaw": list(machine.mem_read(GAME + 0x7D28 + enemy * 220, 220))}
        if acquisition_case:
            for target in acquisition_case.get("targets", []):
                reveal_cell(origin_x + target["dx"], origin_y + target["dy"])
                machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", target.get("team", 2), -1))
                AI.invoke(machine, 0x41B750, eax=GAME, edx=origin_x + target["dx"], ebx=origin_y + target["dy"], ecx=target["type"])
            if "revealMask" in acquisition_case:
                machine.mem_write(GAME + 0x7D28 + enemy * 220 + 0xCA, bytes((acquisition_case["revealMask"],)))
    if fire_capture:
        width = AI.dword(machine, AI.MAP + 0x9A4B0)
        path_rows = AI.dword(machine, AI.MAP + 0x1404)
        path_row = AI.dword(machine, path_rows + origin_y * 4)
        family = machine.mem_read(path_row + origin_x * 24 + 12, 1)
        distance = next(step for step in (1, -1) if machine.mem_read(path_row + (origin_x + step) * 24 + 12, 1) == family
                        and AI.dword(machine, AI.GROUND + (origin_y * width + origin_x + step) * 4) & 1023 == 1023)
    points = [((origin_x + distance) * 256 + 128, origin_y * 256 + 128),
              ((origin_x + distance + 1) * 256 + 128, origin_y * 256 + 128)]
    stream = bytes((5,)) + struct.pack("<h", slot) + bytes((order,))
    if mode in (7, 17):
        if mode == 17:
            stream = b""
        stream += bytes((7, count)) + struct.pack("<h", 1)
        stream += b"".join(struct.pack("<HH", *points[index % 2]) for index in range(count))
        stream += struct.pack("<h", slot)
    stream += b"\0"
    machine.mem_write(0x709000, stream)
    AI.invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(stream))
    assert machine.reg_read(AI.UC_X86_REG_EAX) == 0
    if acquisition_case and acquisition_case.get("damagedIdle"):
        AI.invoke(machine, 0x419248, eax=GAME, edx=slot)
        AI.put(machine, actor + 12, AI.dword(machine, actor + 12) - 1)
    if fire_options:
        for _ in range(fire_options.get("rngWarmup", 0)):
            AI.invoke(machine, 0x411DB4)
        if fire_options.get("poisonPool"):
            machine.mem_write(GAME + 0x32CA8, b"\xa5" * (2024 * 40))
        if fire_options.get("reusePool"):
            for _ in range(3):
                AI.invoke(machine, 0x4415D0, eax=GAME)
            machine.mem_write(GAME + 0x32CA8 + 40 + 20, struct.pack("<h", -1))
            machine.mem_write(GAME + 0x32CA8 + 2 * 40 + 20, struct.pack("<h", 1))
            machine.mem_write(GAME + 0x32CA8 + 20, struct.pack("<h", 2))
            machine.mem_write(GAME + 0x468E8, struct.pack("<h", 0))
    received = read()
    entries, pushes, visits, initializers, task_visits = [], [], [], [], []
    ground_writes, random_writes = [], []
    handlers = struct.unpack("<64I", AI.NATIVE.READ(0x4792B8, 256))
    width, height = AI.dword(machine, AI.MAP + 0x9A4B0), AI.dword(machine, AI.MAP + 0x9A4B4)
    path_rows = AI.dword(machine, AI.MAP + 0x1404)
    world = {"width": width, "height": height, "typeId": unit_type,
             "families": [machine.mem_read(AI.dword(machine, path_rows + row * 4) + column * 24 + 12, 1)[0]
                          for row in range(height) for column in range(width)],
             "ground": list(struct.unpack(f"<{width * height}I", machine.mem_read(AI.GROUND, width * height * 4))),
             "pthSha256": machine.source_path_initialization["sourceSha256"],
             "typeBytes": list(machine.mem_read(0x4F1880 + unit_type * 280, 280))}
    world["air"] = [struct.unpack("<H", machine.mem_read(AI.dword(machine, AI.MAP + 0xC04 + row * 4) + column * 2, 2))[0]
                    for row in range(height) for column in range(width)]
    world["extra"] = [struct.unpack("<H", machine.mem_read(AI.dword(machine, AI.MAP + 0x1004 + row * 4) + column * 2, 2))[0]
                      for row in range(height) for column in range(width)]
    world["enemyMask"] = AI.dword(machine, GAME + before[7] * 0xE30 + 0x19C0)
    world["teamControl"] = AI.dword(machine, GAME + before[7] * 0xE30 + 0xBBC)
    world["weapons"] = list(machine.mem_read(0x4F0200, 72 * 80))
    world["randomTable"] = list(struct.unpack("<256i", machine.mem_read(0x478E04, 1024)))
    world["typeTable"] = list(machine.mem_read(0x4F1880, 110 * 280))
    world["relations"] = list(machine.mem_read(GAME + 0x46F34, 100))
    world["actors"] = {str(index): list(machine.mem_read(GAME + 0x7D28 + index * 220, 220))
                       for index in range(800)
                       if machine.mem_read(GAME + 0x7D28 + index * 220 + 0x2C, 1)[0]}
    world["cityFlags"] = [machine.mem_read(GAME + owner * 0xE30 + 0xC10 + city, 1)[0]
                          for owner in range(8) for city in range(15)]
    weapon_classes = [struct.unpack_from("<i", bytes(world["weapons"]), index * 72)[0] for index in range(80)]
    armor_classes = [struct.unpack_from("<i", bytes(world["typeTable"]), index * 280 + 0x40)[0] for index in range(110)]
    damage_rows = AI.dword(machine, 0x4F98D0)
    world["damageTable"] = [list(struct.unpack(f"<{max(armor_classes) + 1}h", machine.mem_read(
        AI.dword(machine, damage_rows + index * 4), (max(armor_classes) + 1) * 2)))
        for index in range(max(weapon_classes) + 1)]
    world["scanOffsets"] = []
    scan_index, rings = 0, 0
    while rings <= 32:
        point = list(struct.unpack("<hh", machine.mem_read(0x434090 + scan_index * 4, 4)))
        world["scanOffsets"].append(point)
        rings += point[0] == 99
        scan_index += 1
    world["combat"] = {key: world.pop(key) for key in ("typeTable", "relations", "actors", "cityFlags", "damageTable", "scanOffsets")}
    if not acquisition_case and not combat_inputs:
        del world["combat"]
    acquisition_calls = []
    scans = []
    launches = []

    def spans(raw):
        return [{"task": raw[0x39 + level * 2], "offset": raw[0x3A + level * 2],
                 "words": list(struct.unpack_from(f"<{raw[0x3C + level * 2] - raw[0x3A + level * 2]}H",
                     bytes(raw), 0x46 + raw[0x3A + level * 2] * 2))}
                for level in range(0 if raw[0x38] == 255 else raw[0x38] + 1)]

    def snapshot(address):
        raw = read()
        result = {"entry": hex(address), "raw": raw, "stack": spans(raw),
                  "rngCursor": AI.dword(machine, 0x479204), "task6Budget": AI.dword(machine, 0x478E00)}
        if fire_capture and address == 0x419248:
            import base64
            result["counter"] = AI.dword(machine, GAME + 0x530)
            result["projectiles"] = {"records": base64.b64encode(machine.mem_read(GAME + 0x32CA8, 2024 * 40)).decode(),
                "highWater": AI.dword(machine, GAME + 0x7D24),
                "heads": list(struct.unpack("<hh", machine.mem_read(GAME + 0x468E8, 4))),
                "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 96 * 4)))}
        if address == 0x416104:
            result["ground"] = list(struct.unpack(f"<{width * height}I", machine.mem_read(AI.GROUND, width * height * 4)))
        return result

    def observe(emulator, address, size, context):
        if fire_capture and address == 0x441710:
            stack_pointer = emulator.reg_read(AI.UC_X86_REG_ESP)
            launches.append({"source": emulator.reg_read(AI.UC_X86_REG_EDX),
                "velocityX": emulator.reg_read(AI.UC_X86_REG_EBX), "velocityY": emulator.reg_read(AI.UC_X86_REG_ECX),
                "arguments": list(struct.unpack("<8i", emulator.mem_read(stack_pointer + 4, 32)))})
        if address == 0x435570:
            scans.append({"raw": read(), "radius": emulator.reg_read(AI.UC_X86_REG_EBX), "candidates": [],
                          "rngCursor": AI.dword(emulator, 0x479204)})
        if address == 0x4357D8:
            base = emulator.reg_read(AI.UC_X86_REG_EBP)
            candidate = AI.dword(emulator, base - 4)
            if candidate not in (1022, 1023):
                scans[-1]["candidates"].append({"slot": candidate, "plane": ("ground", "air", "extra")[AI.dword(emulator, base - 0x14)],
                    "cell": AI.dword(emulator, base - 8) * width + AI.dword(emulator, base - 0xC),
                    "raw": list(emulator.mem_read(GAME + 0x7D28 + candidate * 220, 220))})
        if address == 0x435C0D:
            scans[-1]["target"] = emulator.reg_read(AI.UC_X86_REG_EAX)
            scans[-1]["rngAfter"] = AI.dword(emulator, 0x479204)
            scans[-1]["actorsAfter"] = {str(candidate["slot"]): list(emulator.mem_read(GAME + 0x7D28 + candidate["slot"] * 220, 220))
                                       for candidate in scans[-1]["candidates"]}
        if address in (0x435C14, 0x41481C, 0x414CE4, 0x414CBE, 0x412E13):
            acquisition_calls.append({**snapshot(address), "eax": emulator.reg_read(AI.UC_X86_REG_EAX),
                "edx": emulator.reg_read(AI.UC_X86_REG_EDX), "ebx": emulator.reg_read(AI.UC_X86_REG_EBX),
                "ecx": emulator.reg_read(AI.UC_X86_REG_ECX)})
        if address == 0x411DD8:
            pushes.append({"task": emulator.reg_read(AI.UC_X86_REG_EBX),
                           "length": emulator.reg_read(AI.UC_X86_REG_ECX)})
        elif address in (0x412014, 0x4120F1):
            initializers.append(snapshot(address))
            entries.append(hex(address))
        elif address in (0x416104, 0x41618D, 0x416157, 0x4125BC):
            task_visits.append(snapshot(address))
            entries.append(hex(address))
        else:
            entries.append(hex(address))

    def writes(emulator, access, address, size, value, context):
        if AI.GROUND <= address < AI.GROUND + width * height * 4:
            ground_writes.append({"eip": hex(emulator.reg_read(UC_X86_REG_EIP)),
                "cell": (address - AI.GROUND) // 4, "size": size,
                "before": int.from_bytes(emulator.mem_read(address, size), "little"), "after": value})
        if address == 0x479204:
            random_writes.append(value)

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
             for address in {0x419248, 0x412014, 0x4120F1, 0x411DD8, 0x416104, 0x41618D, 0x416157,
                             0x4125BC, 0x435C14, 0x435570, 0x4357D8, 0x435C0D, 0x41481C, 0x414CE4, 0x414CBE, 0x412E13,
                             *handlers, *([0x441710] if fire_capture else [])} if 0x400000 <= address < 0x470000]
    hooks.append(machine.hook_add(UC_HOOK_MEM_WRITE, writes))
    stop_receipt = None
    for visit in range(updates):
        if fire_capture:
            AI.put(machine, 0x478E00, 0)
            AI.put(machine, GAME + 0x530, counter + visit)
        current_stack = spans(read())
        if stop_task and stop_receipt is None and current_stack[-1]["task"] == stop_task:
            stop_stream = bytes((5,)) + struct.pack("<h", slot) + bytes((13, 0))
            stop_before = read()
            machine.mem_write(0x709000, stop_stream)
            AI.invoke(machine, 0x41DEFC, eax=GAME, edx=0x709000, ebx=len(stop_stream))
            stop_receipt = {"visit": visit, "stream": stop_stream.hex(), "before": stop_before, "after": read(), "slot": slot}
        start = len(entries)
        write_start, random_start = len(ground_writes), len(random_writes)
        visit_before = snapshot(0x419248)
        AI.invoke(machine, 0x419248, eax=GAME, edx=slot)
        visits.append({**snapshot(0x419248), "before": visit_before, "entries": entries[start:],
                       "groundWrites": ground_writes[write_start:], "randomWrites": random_writes[random_start:]})
        if updates > 110 and visit > 0 and spans(read())[0]["task"] == 1:
            break
    if acquisition_case and acquisition_case.get("aggroControl"):
        machine.mem_write(AI.GROUND, struct.pack(f"<{width * height}I", *world["ground"]))
        for index, actor_raw in world["combat"]["actors"].items():
            machine.mem_write(GAME + 0x7D28 + int(index) * 220, bytes(actor_raw))
        for flag in (0, 1):
            machine.mem_write(actor + 0xD0, bytes((flag,)))
            AI.invoke(machine, 0x435570, eax=GAME, edx=slot, ebx=4)
            scans[-1]["control"] = "explicit actor+d0 input; native selector only"
    for hook in hooks:
        machine.hook_del(hook)
    fin = {}
    banks = [AI.dword(machine, 0x4F1880 + unit_type * 280 + offset) for offset in (0x7C, 0x80)]
    if fire_capture:
        variants = AI.dword(machine, 0x4F1880 + unit_type * 280 + 0xE4)
        banks.extend(AI.dword(machine, 0x4F1880 + unit_type * 280 + 0xA0 + index * 4) for index in range(variants))
        world["nativeFire"] = {"spread": list(machine.mem_read(0x4F9144, 12 * 136 + 18)), "frames": {}}
    banks.extend(struct.unpack_from("<I", bytes(raw), 0x14)[0]
                 for raw in (before, received, *(entry["raw"] for entry in visits)))
    for bank in banks:
        if not bank:
            continue
        if str(bank) in fin:
            continue
        fin[str(bank)] = []
        if fire_capture:
            world["nativeFire"]["frames"][str(bank)] = []
        for direction in range(32):
            animation = AI.dword(machine, bank + direction * 4)
            timeline = AI.dword(machine, animation + 0x20)
            length = AI.dword(machine, animation + 0x28)
            fin[str(bank)].append([machine.mem_read(timeline + frame * 72 + 2, 1)[0] for frame in range(length)])
            if fire_capture:
                world["nativeFire"]["frames"][str(bank)].append([list(machine.mem_read(timeline + frame * 72, 72)) for frame in range(length)])
    return {"unitType": unit_type, "mode": mode, "order": order, "count": count, "counter": counter,
            "slot": slot, "faction": faction, "stream": stream.hex(), "before": before,
            "received": received, "visits": visits, "pushes": pushes,
            "initializers": initializers, "taskVisits": task_visits, "actionTable": list(handlers[:16]),
            "world": world, "fin": fin, "sourceSlot": source_slot, "poison": poison,
            "stopReceipt": stop_receipt,
            "nearbyEnemy": enemy_setup,
            "acquisitionCalls": acquisition_calls,
            "launches": launches,
            "fireOptions": fire_options,
            "scans": scans,
            "acquisitionCase": acquisition_case,
            "animations": animations, "binarySha256": AI.NATIVE.AUDIT.DIGEST,
            "sourceInitialization": {"freshGame": True, "scn": "0x41b920", "pth": "0x442b7c",
                                     "relations": machine.source_relations,
                                     "relationRefresh": "0x41989e..0x419990" if acquisition_case or combat_inputs else None},
            "controlledInputs": {key: acquisition_case[key] for key in ("revealMask", "aggroControl", "damagedIdle")
                                 if acquisition_case and key in acquisition_case}, "runtimeIntercepts": []}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--type", type=int, default=0)
    parser.add_argument("--mode", type=int, default=7)
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--counter", type=int, default=1)
    parser.add_argument("--faction", default="HUMAN")
    parser.add_argument("--order", type=int, default=2)
    parser.add_argument("--distance", type=int, default=2)
    parser.add_argument("--slot", type=int)
    parser.add_argument("--suite", action="store_true")
    parser.add_argument("--movement-suite", action="store_true")
    parser.add_argument("--acquisition-suite", action="store_true")
    parser.add_argument("--combat-inputs", action="store_true")
    parser.add_argument("--stop-task", type=int)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int)
    parser.add_argument("--updates", type=int, default=2)
    args = parser.parse_args()
    if args.acquisition_suite:
        cases = [{"team": team, "type": kind} for team in (0, 1, 2) for kind in (0, 8, 4, 12, 69, 73)]
        cases.extend({"team": 2, "type": kind, "actorType": attacker} for attacker in (8, 2, 3, 69, 73)
                     for kind in (0, 4, 12, 69))
        cases.extend({"team": team, "type": kind, "order": 13} for team in (0, 1, 2) for kind in (0, 8, 4, 69))
        cases.extend({"team": team, "type": kind} for team in (0, 1, 2) for kind in (5, 13, 45, 46))
        cases.extend({"team": 2, "type": kind, "revealMask": mask} for kind in (45, 46) for mask in (1, 2))
        cases.extend([
            {"team": 2, "type": 0, "aligned": True, "revealCell": True},
            {"team": 2, "type": 0, "targets": [{"type": 5, "dx": 0, "dy": -1}]},
            {"team": 2, "type": 5, "actorType": 3, "targets": [{"type": 0, "dx": 0, "dy": -1}]},
            {"team": 2, "type": 0, "targets": [{"type": 0, "dx": -1, "dy": 0}, {"type": 0, "dx": 0, "dy": -2}]},
            {"team": 0, "type": 0, "aggroControl": True},
            {"team": 2, "type": 0, "dx": 6, "dy": 0, "revealCell": True, "order": 13},
            {"team": 2, "type": 0, "dx": 6, "dy": 0, "revealCell": True, "order": 13, "damagedIdle": True},
            {"team": 2, "type": 0, "actorType": 3, "aligned": True, "revealCell": True},
            {"team": 2, "type": 6, "actorType": 3, "priority": True, "targets": [{"type": 0, "dx": 0, "dy": -2}]},
            {"team": 2, "type": 0, "dx": 3, "dy": 3, "revealCell": True, "diagonalRange": True},
        ])
        for case in cases[args.start:args.end]:
            print(json.dumps(capture(case.get("actorType", args.type), 7, 1, 1, order=case.get("order", 7), updates=1, acquisition_case=case)), flush=True)
    elif args.movement_suite:
        cases = [(kind, 7, 1, counter, "HUMAN", order, distance, None, 160, False, stop)
                 for kind in (0, 8, 69, 73, 2, 3) for order in (2, 7)
                 for distance, counter, stop in ((1, 1, None), (2, 32, None), (-1, 9, None),
                                                (-1, 1, 4), (2, 1, 5))]
        cases.extend((kind, 7, 1, 9, "HUMAN", order, 3, None, 160)
                     for kind in (0, 8, 69, 73, 2, 3) for order in (2, 7))
        cases.extend((kind, 7, 1, 1, "HUMAN", order, 2, None, 2, False, None, True)
                     for kind in (0, 8, 69, 73, 2, 3) for order in (2, 7))
        for case in cases[args.start:args.end]:
            print(json.dumps(capture(*case)), flush=True)
    elif args.suite:
        cases = []
        for kind in (0, 8, 69, 73, 2, 3):
            for order in (2, 7):
                for distance, count, counter in ((1, 1, 1), (2, 2, 32), (-3, 8, 9), (2, 0, 1)):
                    cases.append((kind, 7, count, counter, "HUMAN", order, distance, None))
        cases.append((0, 17, 2, 1, "HUMAN", 2, 2, None))
        for slot in (160, 161):
            cases.append((2, 7, 2, 32, "ALIEN", 7, 2, slot))
        cases.extend([(0, 7, 8, 9, "HUMAN", 7, 3, None), (0, 7, 2, 9, "HUMAN", 2, -1, None)])
        cases.extend([(2, 7, 2, 32, "ALIEN", 7, -1, 170), (2, 7, 2, 32, "ALIEN", 7, 1, 181)])
        cases.extend([(0, 7, 2, 1, "HUMAN", 2, 2, None, 70), (3, 7, 8, 32, "HUMAN", 7, 1, None, 110)])
        cases.append((0, 7, 2, 1, "HUMAN", 2, 2, None, 2, True))
        for case in cases[args.start:args.end]:
            print(json.dumps(capture(*case)), flush=True)
    else:
        print(json.dumps(capture(args.type, args.mode, args.count, args.counter, args.faction, args.order,
                                 args.distance, args.slot, args.updates, False, args.stop_task, combat_inputs=args.combat_inputs)))
