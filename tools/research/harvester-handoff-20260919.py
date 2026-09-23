"""Bounded original-x86 harvester movement/resource handoff evidence."""

import argparse
import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
CONSTRUCTION = runpy.run_path(str(Path(__file__).with_name("construction-lifecycle-20260919.py")))
BASE = CONSTRUCTION["BASE"]
GAME = BASE["GAME"]
IMAGE = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE, UC_HOOK_MEM_INVALID
from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX,
                               UC_X86_REG_ECX, UC_X86_REG_EBP, UC_X86_REG_ESI,
                               UC_X86_REG_EDI, UC_X86_REG_EIP)


def fixture(unit_type, mobile_first=False):
    native = CONSTRUCTION["source_fixture"](IMAGE)
    profiles = CONSTRUCTION["load_fin"](native, (40, unit_type, 47 if unit_type == 6 else 48))
    for binding in profiles["bindings"]:
        record = 0x4F1880 + binding["unitType"] * 280
        native.emulator.mem_write(0x70D800 - 0x178, binding["stem"].encode() + b"\0")
        native.put(0x70D800 - 4, record)
        native.run(0x43BE2A, {UC_X86_REG_EBP: 0x70D800}, 0x43BE59)
        native.run(0x43C099, {UC_X86_REG_EBP: 0x70D800}, 0x43C18C)
    native.emulator.mem_map(0xC00000, 0x400000)
    native.put(GAME + 0x46F2C, 0xC00000)
    native.put(GAME + 0x544, 0xD00000)
    scenario = ROOT / "raw_cd/DC/SCENARIO/HUMAN/HUMAN02"
    sources = {extension: scenario.with_suffix("." + extension).read_bytes() for extension in ("MAP", "PTH", "SCN", "MTG")}
    width, height = struct.unpack_from("<II", sources["MAP"])
    area = width * height
    assert len(sources["PTH"]) == 65536 + area
    for offset, value in ((0x9A4B0, width), (0x9A4B4, height), (0x9A4B8, width * 256), (0x9A4BC, height * 256)):
        native.put(0xC00000 + offset, value)
    for row in range(height):
        for offset, base, stride in ((4, 0xD10000, width * 4), (0x804, 0xD20000, width * 4),
                                     (0xC04, 0xD30000, width * 2), (0x1004, 0xD40000, width * 2)):
            native.put(0xC00000 + offset + row * 4, base + row * stride)
        attributes = struct.unpack_from(f"<{width}H", sources["MAP"], 8 + area * 4 + row * width * 2)
        native.emulator.mem_write(0xD10000 + row * width * 4, b"".join(struct.pack("<I", (attribute << 22) & 0xFFFFFFFF) for attribute in attributes))
    for row in range(-1, height + 1):
        row_pointer = 0xE01000 + ((row + 1) * (width + 2) + 1) * 24
        native.put(0xE00000 + row * 4, row_pointer)
        for column in range(-1, width + 1):
            cell = row_pointer + column * 24
            native.put(cell + 4, -1)
            native.put(cell + 8, column, 1)
            native.put(cell + 9, row, 1)
            family = sources["PTH"][65536 + row * width + column] if 0 <= row < height and 0 <= column < width else 255
            native.put(cell + 12, family, 1)
    native.emulator.mem_write(0xD20000, struct.pack("<I", 1023) * area)
    native.emulator.mem_write(0xD30000, struct.pack("<H", 1023) * area)
    native.emulator.mem_write(0xD40000, struct.pack("<H", 1023) * area)
    native.put(0xC01404, 0xE00000)
    native.emulator.mem_write(0xC884A8, sources["PTH"][:65536])
    for register, value in ((UC_X86_REG_EBP, 0x70D800), (UC_X86_REG_ESI, 0xC01404), (UC_X86_REG_EDI, 1)):
        native.emulator.reg_write(register, value)
    native.emulator.emu_start(0x442E2B, 0x442E41, count=5000000)
    assert native.emulator.reg_read(UC_X86_REG_EIP) == 0x442E41
    native.run(0x442A10, {UC_X86_REG_EAX: 0xC01404})
    native.emulator.mem_write(GAME + 0x468EC, b"\xff\xff" * 800)
    native.put(GAME + 0x7D20, 154)
    native.put(GAME + 0x468E8, 65535, 2)
    native.put(GAME + 0x468EA, 65535, 2)
    native.put(GAME + 0xBB8, int(unit_type == 14))
    native.put(GAME + 0xBD4, 1)
    native.put(GAME + 0x19B8, 256)
    native.put(GAME + 0x46F34, 1, 1)
    resource = next(list(map(int, line.split())) for line in sources["SCN"].decode().splitlines() if line.strip() == "69 48 40 22 12000")
    source_slot, mobile_slot = (153, 152) if mobile_first else (152, 153)
    native.stubs.clear()
    for slot, kind, team, column, row, health in ((source_slot, 40, 8, resource[0], resource[1], resource[4]),
                                                (mobile_slot, unit_type, 0, resource[0] - 2, resource[1], -1)):
        for offset, value in ((4, team), (8, health), (12, 0), (16, slot)):
            native.put(BASE["STACK"] + offset, value)
        native.run(0x41AF14, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: column, UC_X86_REG_EBX: row, UC_X86_REG_ECX: kind})
    native.put(GAME + 0x7D28 + source_slot * 220 + 0x32, resource[3], 2)
    return native, profiles, sources, width, resource, source_slot, mobile_slot


def probe(unit_type=6, order=2, mobile_first=False):
    native, profiles, sources, width, resource, source_slot, mobile_slot = fixture(unit_type, mobile_first)
    initial_random_index = 82 if order == 7 else 0
    native.put(0x479204, initial_random_index)
    baseline = len(native.calls)
    update = 0
    events, rng, trace, failures = [], [], [], []

    def state(slot):
        entity = GAME + 0x7D28 + slot * 220
        result = CONSTRUCTION["snapshot"](native, slot)
        result.update(position=[native.get(entity + offset, 2) for offset in (0, 4)],
                      targetPosition=[native.get(entity + offset, 2) for offset in (0x2E, 0x30)],
                      direction=native.get(entity + 9, 1), randomIndex=native.get(0x479204),
                      rateWord=native.get(entity + 0x32, 2) if slot == source_slot else None)
        animation = result["animation"]
        for key in ("state", "sourceTimeline", "sourceDelay"):
            animation.pop(key, None)
        direction = (((result["direction"] + 8) & 255) >> 4) * 2
        descriptor = native.get(animation["bank"] + direction * 4)
        animation["bankDirection"] = direction
        animation["directionalDelays"] = [native.get(native.get(descriptor + 0x20) + frame * 72 + 2, 1)
                                            for frame in range(native.get(descriptor + 0x28))]
        result["stack"] = [{"task": native.get(entity + 0x39 + level * 2, 1),
                            "words": [native.get(entity + 0x46 + native.get(entity + 0x3A + level * 2, 1) * 2 + word * 2, 2) for word in range(6)]}
                           for level in range(result["taskDepth"] + 1)]
        return result

    def idle_state():
        entity = GAME + 0x7D28 + mobile_slot * 220
        current = state(mobile_slot)
        return {"slot": mobile_slot, "typeId": current["type"], "team": current["team"],
                "status": current["status"], "hp": current["hp"], "xQ8": current["position"][0], "yQ8": current["position"][1],
                "direction": current["direction"], "randomIndex": current["randomIndex"], "pending": current["pendingOrder"], "order": current["order"],
                "observer": native.get(entity + 0x35, 1), "specialOrder": native.get(entity + 0xCB, 1), "confusion": native.get(entity + 0xD0, 1),
                "secondaryAnimationPending": native.get(entity + 0xC7, 1),
                "secondaryAnimationsInactive": all(native.get(entity + offset + 6, 1) == 2 for offset in (0x1C, 0x24)),
                "stack": [{"task": task["task"], "words": task["words"][:{1: 3, 3: 2, 4: 1, 12: 3, 13: 1}.get(task["task"], 6)]} for task in current["stack"]],
                "animation": {key: current["animation"][key] for key in ("bank", "frame", "delay", "mode")}}

    frames, source_frames, occupancy_writes = [], [], []

    def observe(emulator, address, size, data):
        if address in (0x419458, 0x419576) and emulator.reg_read(UC_X86_REG_ESI) == GAME + 0x7D28 + source_slot * 220:
            if address == 0x419458 and (not source_frames or source_frames[-1]["update"] != update):
                source_frames.append({"update": update, "before": state(source_slot), "mobileBefore": idle_state()})
            elif address == 0x419576:
                source_frames[-1].update(after=state(source_slot), mobileAfter=idle_state())
        if address in (0x419458, 0x419576) and emulator.reg_read(UC_X86_REG_ESI) == GAME + 0x7D28 + mobile_slot * 220:
            if address == 0x419458 and (not frames or frames[-1]["update"] != update):
                frames.append({"update": update, "before": idle_state()})
            elif address == 0x419576:
                frames[-1].update(after=idle_state(), sourceAfterMobile=state(source_slot),
                                  groundAfterMobile=native.get(0xD20000 + (resource[1] * width + resource[0]) * 4))
        if address in (0x419248, 0x412014, 0x412654, 0x4148B0, 0x414A70, 0x435C14, 0x413490, 0x413780, 0x416784):
            events.append({"update": update, "eip": hex(address), "slot": emulator.reg_read(UC_X86_REG_EDX),
                           "mobile": state(mobile_slot), "source": state(source_slot)})
        if address in (0x46C996, 0x46CB3E):
            raise RuntimeError(f"native diagnostic {address:#x}")

    def write(emulator, access, address, size, value, data):
        if 0xD20000 <= address < 0xD20000 + width * (len(sources["PTH"][65536:]) // width) * 4:
            occupancy_writes.append({"update": update, "eip": hex(emulator.reg_read(UC_X86_REG_EIP)),
                                     "cell": (address - 0xD20000) // 4, "bytes": size, "before": native.get(address, size), "after": value})
        if address == 0x479204:
            rng.append({"update": update, "eip": hex(emulator.reg_read(UC_X86_REG_EIP)), "before": native.get(address), "after": value,
                        "value": native.get(0x478E04 + value * 4)})

    def invalid(emulator, access, address, size, value, data):
        failures.append({"eip": hex(emulator.reg_read(UC_X86_REG_EIP)), "address": hex(address), "access": access, "size": size})
        return False

    native.emulator.hook_add(UC_HOOK_CODE, observe)
    native.emulator.hook_add(UC_HOOK_MEM_WRITE, write)
    native.emulator.hook_add(UC_HOOK_MEM_INVALID, invalid)

    def record():
        trace.append({"update": update, "mobile": state(mobile_slot), "source": state(source_slot),
                      "destinationGround": native.get(0xD20000 + (resource[1] * width + resource[0]) * 4),
                      "destinationMapFlags": native.get(0xD10000 + (resource[1] * width + resource[0]) * 4),
                      "originGround": native.get(0xD20000 + (resource[1] * width + resource[0] - 2) * 4),
                      "credits": native.get(GAME + 0xBAC), "phase": native.get(GAME + 0x530)})

    def packet(entry, payload):
        native.emulator.mem_write(0x701100, payload)
        native.put(0x701000, 0x701100)
        native.run(entry, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
        assert native.get(0x701000) == 0x701100 + len(payload)

    record()
    error = None
    activation = cancellation = release = None
    try:
        packet(0x41DD2C, struct.pack("<Bhh", 0, mobile_slot, -1))
        packet(0x41D4F4, struct.pack("<BBhh", 1, 0, resource[0] * 256 + 128, resource[1] * 256 + 128))
        packet(0x41CE9C, bytes((0, order)))
        record()
        for update in range(1, 257):
            if activation is not None and update == activation + 45:
                cancellation = update
                packet(0x41CE54, struct.pack("<hB", mobile_slot, 13))
            native.put(0x70D800 - 4, GAME)
            native.run(0x41989E, {UC_X86_REG_EBP: 0x70D800}, 0x4198C3)
            native.put(0x4956E0 + 20, 0)
            native.run(0x419BB8, {UC_X86_REG_EBP: 0x70D800}, 0x419C0E)
            record()
            if activation is None and state(mobile_slot)["type"] in (47, 48):
                activation = update
            if cancellation is not None and release is None and state(mobile_slot)["type"] == unit_type:
                release = update
            if release is not None and update == release + 12:
                break
    except (RuntimeError, AssertionError) as caught:
        error = str(caught)
    record_type = 0x4F1880 + unit_type * 280
    banks = {name: native.get(record_type + offset) for name, offset in (("standBank", 0x80), ("preservedIdleBank", 0x9C), ("moveBank", 0x7C))}
    animations = {}
    for kind in (unit_type, 47 if unit_type == 6 else 48, 40):
        for offset in (0x7C, 0x80, 0x94, 0x9C):
            bank = native.get(0x4F1880 + kind * 280 + offset)
            if bank:
                animations[str(bank)] = [[native.get(native.get(native.get(bank + direction * 4) + 0x20) + frame * 72 + 2, 1)
                                          for frame in range(native.get(native.get(bank + direction * 4) + 0x28))] for direction in range(32)]
    arrived = next((frame for frame in frames if frame["update"] > 1 and frame.get("after", {}).get("typeId") == unit_type
                    and any(task["task"] in (2, 4, 5, 6, 7, 8) for task in frame["before"]["stack"])
                    and all(task["task"] in (1, 3) for task in frame["after"]["stack"])), None)
    handshake = []
    if arrived:
        arrival_trace = next(frame for frame in trace if frame["update"] == arrived["update"])
        handshake.append({"kind": "native-movement-completed", "boundary": "after-mobile-entity-update", "update": arrived["update"],
                          "state": arrived["after"], "source": arrived["sourceAfterMobile"], "groundWord": arrived["groundAfterMobile"],
                          "mapFlags": arrival_trace["destinationMapFlags"], "phase": arrival_trace["phase"]})
    if activation is not None:
        source_frame = next(frame for frame in source_frames if frame["update"] == activation)
        handshake.append({"kind": "native-resource-activated", "boundary": "inside-source-entity-update", **source_frame})
    if release is not None:
        release_frame = next(frame for frame in frames if frame["update"] == release)
        handshake.append({"kind": "native-resource-released", "boundary": "after-mobile-entity-update-no-idle-redispatch", **release_frame})
    verified = error is None and release is not None and arrived is not None
    if verified:
        assert native.calls[baseline:] == [] and failures == []
        assert arrived["after"]["xQ8"] == 17760 and arrived["after"]["yQ8"] == 12416
        assert arrived["after"]["pending"] == 0 and arrived["after"]["order"] == 255
        assert trace[-1]["originGround"] & 1023 == 1023
        assert trace[-1]["destinationGround"] & 1023 == mobile_slot
        assert all(event["eip"] != "0x435c14" or order == 7 for event in events)
    variants = []
    if verified:
        entity = GAME + 0x7D28 + mobile_slot * 220
        for name, bank, mode in (("same-stand", banks["standBank"], 0), ("move-bank-reset", banks["moveBank"], 0),
                                 ("preserved-once", banks["preservedIdleBank"], 1), ("preserved-complete", banks["preservedIdleBank"], 2),
                                 ("wait-zero", banks["standBank"], 0), ("wait-hp-loss", banks["standBank"], 0)):
            native.put(entity + 12, 800)
            native.run(0x412014, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: mobile_slot})
            native.run(0x42630C, {UC_X86_REG_EAX: entity + 0x14, UC_X86_REG_EDX: bank, UC_X86_REG_EBX: mode})
            if name.startswith("wait-"):
                native.run(0x412274, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: mobile_slot, UC_X86_REG_EBX: 0 if name == "wait-zero" else 7})
                if name == "wait-hp-loss":
                    native.put(entity + 12, 799)
            before = idle_state()
            for dispatch in range(4):
                depth = native.get(entity + 0x38, 1)
                task = native.get(entity + 0x39 + depth * 2, 1)
                payload = entity + 0x46 + native.get(entity + 0x3A + depth * 2, 1) * 2
                assert task in (1, 3)
                native.run(0x4148B0 if task == 1 else 0x4122C8,
                           {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: mobile_slot, UC_X86_REG_EBX: payload})
                if native.emulator.reg_read(UC_X86_REG_EAX) == 0:
                    break
            else:
                raise AssertionError("native idle redispatch did not settle")
            variants.append({"name": name, "scope": "synthetic handler-entry sensitivity, not mission progression", "before": before, "after": idle_state()})
    return {"unitType": unit_type, "order": order, "mobileFirst": mobile_first, "scope": "synthetic legal constructors on original HUMAN02 MAP/PTH; not full mission",
            "sourceRow": resource, "profiles": profiles, "sourceHashes": {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()},
            "idleWorld": {**banks, "selectedWeapon": native.get(record_type + 0x18), "width": width, "height": len(sources["PTH"][65536:]) // width},
            "animations": animations, "frames": frames, "sourceFrames": source_frames, "handshake": handshake, "occupancyWrites": occupancy_writes,
            "initialRandomIndex": initial_random_index, "idleVariants": variants,
            "activation": activation, "cancellation": cancellation, "release": release,
            "initializers": {index: hex(native.get(0x4792B8 + index * 4)) for index in range(24)},
            "trace": trace, "events": events, "rng": rng, "error": error, "invalidMemory": failures,
            "runtimeInterceptions": native.calls[baseline:], "verified": verified}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 16))
    parser.add_argument("--type", type=int, choices=(6, 14), default=6)
    parser.add_argument("--order", type=int, default=2)
    parser.add_argument("--mobile-first", action="store_true")
    parser.add_argument("--suite", action="store_true")
    arguments = parser.parse_args()
    assert hashlib.sha256(IMAGE).hexdigest() == BASE["EXE_HASH"]
    if arguments.disassemble:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        native = BASE["Native"](IMAGE)
        start, end = arguments.disassemble
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes(native.emulator.mem_read(start, end - start)), start):
            print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
    elif arguments.suite:
        cases = [probe(kind, order, first) for kind in (6, 14) for order in (2, 7) for first in (False, True)]
        print(json.dumps({"executableSha256": BASE["EXE_HASH"], "cases": cases}))
        assert all(case["verified"] for case in cases)
    else:
        print(json.dumps({"executableSha256": BASE["EXE_HASH"], **probe(arguments.type, arguments.order, arguments.mobile_first)}))


if __name__ == "__main__":
    main()