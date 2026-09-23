"""Bounded source inspection and native SARGE partner-acquisition probes."""

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
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_EIP, UC_X86_REG_EBP

ROOT = Path(__file__).resolve().parents[2]
CONSTRUCTION = runpy.run_path(str(Path(__file__).with_name("construction-lifecycle-20260919.py")))
BASE = CONSTRUCTION["BASE"]
GAME = BASE["GAME"]
TYPES = CONSTRUCTION["TYPES"]
MAP = 0xC00000
GROUND = 0xC20000


def actor_address(slot):
    return GAME + 0x7D28 + slot * 220


def ground_address(cell_x, cell_y):
    return GROUND + cell_y * 512 + cell_x * 4


def actor_observation(native, slot):
    actor = actor_address(slot)
    cursor = native.get(actor + 0x38, 1)
    payload = actor + 0x46 + native.get(actor + 0x3A + cursor * 2, 1) * 2
    return {"slot": slot, "type": native.get(actor + 6, 1), "team": native.get(actor + 7, 1),
            "xQ8": native.get(actor, 2), "yQ8": native.get(actor + 4, 2),
            "status": native.get(actor + 0x2C, 1), "animationState": native.get(actor + 0x1A, 1),
            "task": native.get(actor + 0x39 + cursor * 2, 1), "payloadAddress": payload,
            "payloadWords": [native.get(payload + offset, 2) for offset in (0, 2, 4)],
            "raw220": bytes(native.emulator.mem_read(actor, 220)).hex()}


def source_fixture(image, collector_type):
    native = CONSTRUCTION["source_fixture"](image)
    profiles = CONSTRUCTION["load_fin"](native, (4, 6, 12, 14, 40, 47, 48, 77, 78))
    for binding in profiles["bindings"]:
        native.emulator.mem_write(0x70D800 - 0x178, binding["stem"].encode("ascii") + b"\0")
        native.put(0x70D800 - 4, TYPES + binding["unitType"] * 280)
        native.run(0x43C099, {UC_X86_REG_EBP: 0x70D800}, 0x43C18C)
    native.emulator.mem_map(MAP, 0x200000)
    native.put(GAME + 0x46F2C, MAP)
    native.put(GAME + 0x544, 0xD00000)
    native.put(MAP + 0x9A4B0, 128)
    native.put(MAP + 0x9A4B4, 128)
    for row in range(128):
        for offset, base, stride in ((4, 0xC10000, 512), (0x804, GROUND, 512),
                                     (0xC04, 0xC30000, 256), (0x1004, 0xC40000, 256)):
            native.put(MAP + offset + row * 4, base + row * stride)
    native.emulator.mem_write(GROUND, struct.pack("<I", 1023) * 128 * 128)
    for plane in (0xC30000, 0xC40000):
        native.emulator.mem_write(plane, struct.pack("<H", 1023) * 128 * 128)
    native.emulator.mem_write(GAME + 0x468EC, b"\xff\xff" * 800)
    native.put(GAME + 0x7D20, 156)
    native.put(GAME + 0x7D1C, 7)
    for team in range(8):
        native.put(GAME + team * 0xE30 + 0xBD4, 1)
        native.put(GAME + team * 0xE30 + 0x19C0, 0x40000000 >> team)
    for slot, unit_type, team, cell_x, cell_y in ((152, 40, 8, 65, 64), (153, collector_type, 1, 65, 64),
                                                (154, 4, 0, 64, 64), (155, 14, 2, 66, 64)):
        for offset, value in ((4, team), (8, -1), (12, 0), (16, slot)):
            native.put(BASE["STACK"] + offset, value)
        native.run(0x41AF14, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: cell_x,
                              UC_X86_REG_EBX: cell_y, UC_X86_REG_ECX: unit_type})
    native.put(actor_address(152) + 0x32, 25, 2)
    native.put(actor_address(152) + 0xC, 1000)
    native.put(0xC10000 + 64 * 512 + 65 * 4, 0x04000000)
    native.put(ground_address(65, 64), 153 | 0x40000000)
    native.run(0x413490, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 152,
                          UC_X86_REG_EBX: actor_address(152) + 0x46})
    assert native.get(actor_address(153) + 6, 1) == (47 if collector_type == 6 else 48)
    return native, profiles


def probe(image, collector_type):
    native, profiles = source_fixture(image, collector_type)
    baseline_game = bytes(native.emulator.mem_read(GAME, 0x471B0))
    baseline_ground = bytes(native.emulator.mem_read(GROUND, 128 * 512))
    source_rows = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT").read_text().splitlines()
                   if line.strip() and not line.lstrip().startswith("%")][1:]
    source_types = [{"type": unit_type, "record280": bytes(native.emulator.mem_read(TYPES + unit_type * 280, 280)).hex(),
                     "sprite": source_rows[unit_type][0], "sourceUnitRow": source_rows[unit_type],
                     "revealField68": native.get(TYPES + unit_type * 280 + 0x68),
                     "observationDay": native.get(TYPES + unit_type * 280 + 0x14),
                     "observationNight": native.get(TYPES + unit_type * 280 + 0x10)}
                    for unit_type in (4, 6, 12, 14, 40, 47, 48, 77, 78)]
    cases = []
    original_calls = len(native.calls)

    def restore():
        native.emulator.mem_write(GAME, baseline_game)
        native.emulator.mem_write(GROUND, baseline_ground)

    def acquire(label, delta_x=1, delta_y=0, target_type=47, target_team=1, status=1,
                visible=True, mask=0x40000000, reveal=0, second=None, vision=None,
                caller_team=0, allied=False, reveal_field=None):
        restore()
        native.put(ground_address(65, 64), 1023)
        native.put(ground_address(66, 64), 1023)
        actor = actor_address(153)
        cell_x, cell_y = 64 + delta_x, 64 + delta_y
        native.put(actor, cell_x * 256 + 128, 2)
        native.put(actor + 4, cell_y * 256 + 128, 2)
        native.put(actor + 6, target_type, 1)
        native.put(actor + 7, target_team, 1)
        native.put(actor + 0x2C, status, 1)
        native.put(actor + 0xCA, reveal, 1)
        native.put(ground_address(cell_x, cell_y), 153 | (0x40000000 if visible else 0))
        native.put(GAME + caller_team * 0xE30 + 0x19C0, mask)
        native.put(GAME + 0x46F34 + caller_team * 10 + target_team, int(allied), 1)
        prior_types = bytes(native.emulator.mem_read(TYPES, 106 * 280))
        if vision is not None:
            for unit_type in (4, 77):
                for offset in (0x10, 0x14):
                    native.put(TYPES + unit_type * 280 + offset, vision)
        if reveal_field is not None:
            native.put(TYPES + target_type * 280 + 0x68, reveal_field)
        if second:
            second_x, second_y = 64 + second[0], 64 + second[1]
            native.put(actor_address(155), second_x * 256 + 128, 2)
            native.put(actor_address(155) + 4, second_y * 256 + 128, 2)
            native.put(actor_address(155) + 6, 48, 1)
            native.put(ground_address(second_x, second_y), 155 | 0x40000000)
        native.run(0x417944, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 64,
                              UC_X86_REG_EBX: 64, UC_X86_REG_ECX: caller_team})
        selected = native.emulator.reg_read(UC_X86_REG_EAX)
        native.emulator.mem_write(TYPES, prior_types)
        result = {"label": label, "deltaCells": [delta_x, delta_y], "targetType": target_type,
                  "targetTeam": target_team, "status": status, "visible": visible, "visionMask": mask,
                  "revealByte": reveal, "sourceDayNightControl": vision, "secondDelta": second,
                  "callerTeam": caller_team, "allied": allied, "revealFieldControl": reveal_field,
                  "targetPositionQ8": [cell_x * 256 + 128, cell_y * 256 + 128],
                  "callerCell": [64, 64], "phaseCounter": native.get(GAME + 0x530),
                  "selected": -1 if selected == 0xFFFFFFFF else selected}
        cases.append(result)
        return result

    for distance in range(-24, 25):
        for delta_x, delta_y in ((distance, 0), (0, distance), (distance, distance)):
            result = acquire("distance", delta_x, delta_y)
            expected = abs(delta_x) <= 22 and abs(delta_y) <= 22 and min(abs(delta_x), abs(delta_y)) <= 11
            assert (result["selected"] == 153) == expected, result
    for delta_x, delta_y in ((11, 22), (22, 11), (12, 22), (22, 12), (-11, -22), (-22, -11)):
        result = acquire("corner", delta_x, delta_y)
        assert (result["selected"] == 153) == (min(abs(delta_x), abs(delta_y)) <= 11), result
    for target_type in (4, 6, 12, 14, 40, 47, 48, 77, 78):
        result = acquire("target-type", target_type=target_type)
        assert (result["selected"] == 153) == (target_type in (47, 48)), result
    for target_team in range(8):
        result = acquire("target-team", target_team=target_team)
        assert (result["selected"] == 153) == (target_team != 0), result
    for status in (0, 1, 2, 10):
        result = acquire("target-status", status=status)
        assert (result["selected"] == 153) == (status != 0), result
    for visible, mask in ((False, 0x40000000), (True, 0), (True, 0x20000000), (True, 0x60000000)):
        result = acquire("visibility", visible=visible, mask=mask)
        assert (result["selected"] == 153) == bool(visible and mask & 0x40000000), result
    for vision in (0, 1, 99):
        assert acquire("source-vision", 22, 11, vision=vision)["selected"] == 153
    assert acquire("far-before-near", 0, -22, second=(1, 0))["selected"] == 153
    assert acquire("slot-order", 1, 0, second=(0, -22))["selected"] == 155
    assert acquire("allied-other-team", allied=True)["selected"] == 153
    for caller_team in range(8):
        result = acquire("caller-team-shared-vision", caller_team=caller_team, target_team=(caller_team + 1) % 8)
        assert result["selected"] == 153, result
    for reveal in (0, 1, 2):
        result = acquire("conditional-reveal", reveal_field=1, reveal=reveal)
        assert (result["selected"] == 153) == bool(reveal & 1), result
    restore()
    events, writes = [], []
    watched = {0x417944, 0x417D12, 0x417E75, 0x417EB8, 0x413BC0, 0x413780}

    def observe(emulator, address, size, data):
        if address in watched:
            events.append({"address": hex(address), "phaseCounter": native.get(GAME + 0x530),
                           "eax": emulator.reg_read(UC_X86_REG_EAX), "edx": emulator.reg_read(UC_X86_REG_EDX),
                           "ebx": emulator.reg_read(UC_X86_REG_EBX), "ecx": emulator.reg_read(UC_X86_REG_ECX)})

    def observe_write(emulator, access, address, size, value, data):
        if actor_address(153) <= address < actor_address(155):
            writes.append({"pc": hex(emulator.reg_read(UC_X86_REG_EIP)), "address": hex(address),
                           "size": size, "value": value & ((1 << (size * 8)) - 1)})

    native.emulator.hook_add(UC_HOOK_CODE, observe)
    native.emulator.hook_add(UC_HOOK_MEM_WRITE, observe_write)
    native.run(0x416784, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 154})
    visits = 0
    while native.get(actor_address(154) + 0x1A, 1) != 2:
        native.run(0x4264C8, {UC_X86_REG_EAX: actor_address(154) + 0x14, UC_X86_REG_EDX: 0})
        visits += 1
        assert visits <= 512
    before = [actor_observation(native, slot) for slot in (152, 153, 154)]
    native.run(0x417B0C, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 154})
    linked = [actor_observation(native, slot) for slot in (152, 153, 154)]
    assert linked[2]["type"] == 77 and linked[2]["payloadWords"][0] == 153, linked
    assert linked[1]["task"] == 12 and linked[1]["payloadWords"][2] == 154, linked
    acquisition_frame = {"boundary": "0x417b0c returned after 0x417944 and 0x417eb8",
                         "nativePhaseCounter": native.get(GAME + 0x530),
                         "sourceMobileType": 4, "sourceCollectorType": collector_type,
                         "interceptor": linked[2], "collector": linked[1], "resource": linked[0],
                         "callerTeamVisibilityMask": native.get(GAME + 0x19C0),
                         "collectorGroundWord": native.get(ground_address(65, 64)),
                         "callerCell": [64, 64], "collectorCell": [65, 64],
                         "eligibleAtAcquisition": True, "reciprocalNativeSlots": [154, 153]}
    linked_game = bytes(native.emulator.mem_read(GAME, 0x471B0))
    settlements = []
    for counter in (15, 16, 17, 32):
        native.put(GAME + 0x530, counter)
        native.run(0x413780, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 153,
                              UC_X86_REG_EBX: linked[1]["payloadAddress"]})
        settlements.append({"counter": counter, "reserve": native.get(actor_address(152) + 0xC),
                            "thiefCredits": native.get(GAME + 0xBAC),
                            "collectorCredits": native.get(GAME + 0xE30 + 0xBAC),
                            "partner": native.get(linked[1]["payloadAddress"] + 4, 2)})
    assert [entry["thiefCredits"] for entry in settlements] == [0, 12, 12, 24], settlements
    assert [entry["collectorCredits"] for entry in settlements] == [0, 12, 12, 24], settlements
    delivery_controls = []
    for label in ("lost-visibility", "out-of-range", "same-team-after-link", "undeployed-partner", "dead-partner"):
        native.emulator.mem_write(GAME, linked_game)
        native.emulator.mem_write(GROUND, baseline_ground)
        if label == "lost-visibility":
            native.put(GAME + 0x19C0, 0)
            native.put(ground_address(65, 64), 153)
        if label == "out-of-range":
            native.put(actor_address(154), 2 * 256 + 128, 2)
            native.put(actor_address(154) + 4, 2 * 256 + 128, 2)
        if label == "same-team-after-link":
            native.put(actor_address(154) + 7, 1, 1)
        if label == "undeployed-partner":
            native.put(actor_address(154) + 6, 4, 1)
        if label == "dead-partner":
            native.put(actor_address(154) + 0x2C, 10, 1)
        native.put(GAME + 0x530, 16)
        if label in ("lost-visibility", "out-of-range", "same-team-after-link"):
            native.run(0x413BC0, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 154,
                                  UC_X86_REG_EBX: linked[2]["payloadAddress"]})
            assert actor_observation(native, 154)["task"] == 1
        native.run(0x413780, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 153,
                              UC_X86_REG_EBX: linked[1]["payloadAddress"]})
        observed = {"label": label, "counter": 16, "thief": actor_observation(native, 154),
                    "collector": actor_observation(native, 153),
                    "creditsTeams0And1": [native.get(GAME + team * 0xE30 + 0xBAC) for team in (0, 1)],
                    "reserve": native.get(actor_address(152) + 0xC)}
        expected = [0, 25] if label in ("undeployed-partner", "dead-partner") else [0, 24] if label == "same-team-after-link" else [12, 12]
        assert observed["creditsTeams0And1"] == expected, observed
        assert observed["collector"]["payloadWords"][2] == (0 if label in ("undeployed-partner", "dead-partner") else 154), observed
        delivery_controls.append(observed)
    native.emulator.mem_write(GAME, linked_game)
    native.emulator.mem_write(GROUND, baseline_ground)
    native.put(actor_address(153) + 0x2C, 10, 1)
    native.run(0x413BC0, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 154,
                          UC_X86_REG_EBX: linked[2]["payloadAddress"]})
    invalidated = actor_observation(native, 154)
    assert invalidated["task"] == 13 and invalidated["animationState"] == 1, invalidated
    restore()
    native.put(before[1]["payloadAddress"] + 4, 155, 2)
    native.emulator.mem_write(actor_address(154), bytes.fromhex(before[2]["raw220"]))
    native.run(0x417B0C, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 154})
    busy = {"thief": actor_observation(native, 154), "collector": actor_observation(native, 153)}
    assert busy["thief"]["task"] == 13 and busy["collector"]["payloadWords"][2] == 155, busy
    assert native.calls[original_calls:] == [], native.calls[original_calls:]
    return {"exeSha256": BASE["EXE_HASH"], "scope": "controlled-source-constructors-not-full-mission",
            "initialCollectorType": collector_type,
            "sourceHashes": {name: hashlib.sha256((ROOT / "raw_cd/DC" / name).read_bytes()).hexdigest()
                             for name in ("GAMESTAT/GAMESTAT.TXT", "ANIM.DAT")},
            "sourceTypes": source_types, "finSources": profiles["sources"],
            "currentFramePartnerEvidence": acquisition_frame,
            "selectorJumpTable": [hex(native.get(0x417934 + offset * 4)) for offset in range(4)],
            "cases": cases, "nativeLink": {"animationVisits": visits, "before": before, "linked": linked,
                                            "events": events, "writes": writes, "settlements": settlements,
                                            "deliveryControls": delivery_controls,
                                            "invalidatedCollector": invalidated, "occupiedPartner": busy},
            "runtimeInterceptions": native.calls[original_calls:]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--references", type=lambda value: int(value, 0))
    parser.add_argument("--probe", action="store_true")
    options = parser.parse_args()
    image = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
    assert hashlib.sha256(image).hexdigest() == BASE["EXE_HASH"]
    if options.probe:
        print(json.dumps({"collectors": [probe(image, collector_type) for collector_type in (6, 14)]}, indent=2))
        return
    native = BASE["Native"](image)
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.skipdata = True
    if options.disassemble:
        start, end = options.disassemble
        for instruction in decoder.disasm(bytes(native.emulator.mem_read(start, end - start)), start):
            print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
        return
    matches = []
    for instruction in decoder.disasm(bytes(native.emulator.mem_read(0x401000, 0x70000)), 0x401000):
        selected = instruction.op_str.endswith((", 0x4d", ", 0x4e"))
        if options.references is not None:
            selected = instruction.mnemonic == "call" and instruction.op_str == hex(options.references)
        if selected:
            matches.append({"address": hex(instruction.address),
                            "instruction": instruction.mnemonic + " " + instruction.op_str})
    print(json.dumps({"exeSha256": BASE["EXE_HASH"], "type77And78Comparisons": matches}, indent=2))


if __name__ == "__main__":
    main()