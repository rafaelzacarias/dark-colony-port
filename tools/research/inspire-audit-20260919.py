"""Bounded, hash-pinned native Inspire research; Capstone 5 and Unicorn 2."""

import argparse
import importlib.util
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True

from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDX, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
)


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("inspire_transport_loader", Path(__file__).with_name("transport-audit.py"))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
IMAGE, SECTIONS, READ = AUDIT.load_image(ROOT / "raw_cd/DC/DC.EXE")
GAME, UI, STACK, STOP = 0x800000, 0x900000, 0x70E000, 0x70D000
FRAME, TYPES = 0x70F000, 0x4F1880


def fixture():
    machine = Uc(UC_ARCH_X86, UC_MODE_32)
    for address, size in ((0x400000, 0x200000), (0x700000, 0x10000), (GAME, 0x200000)):
        machine.mem_map(address, size)
    for _, address, length, raw in SECTIONS:
        machine.mem_write(address, IMAGE[raw:raw + length])
    machine.mem_write(UI + 0xC, struct.pack("<I", GAME))
    return machine


def invoke(machine, entry, argument):
    machine.mem_write(STACK, struct.pack("<I", STOP))
    machine.reg_write(UC_X86_REG_ESP, STACK)
    machine.reg_write(UC_X86_REG_EAX, argument)
    machine.emu_start(entry, STOP, count=1000000)
    assert machine.reg_read(UC_X86_REG_EIP) == STOP, hex(machine.reg_read(UC_X86_REG_EIP))
    return machine.reg_read(UC_X86_REG_EAX)


def run_slice(machine, start, end):
    machine.emu_start(start, end, count=1000000)
    assert machine.reg_read(UC_X86_REG_EIP) == end, hex(machine.reg_read(UC_X86_REG_EIP))


def parsed_fixture():
    machine = fixture()
    lines = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT").read_text(encoding="ascii").splitlines()
             if line.strip() and not line.lstrip().startswith("%")]
    assert int(lines[0][0]) == len(lines) - 1 == 106
    for index, tokens in enumerate(lines[1:]):
        assert len(tokens) == 33
        source = " ".join(tokens).encode("ascii") + b"\0"
        assert len(source) <= 256
        machine.mem_write(FRAME - 0x278, source)
        machine.mem_write(FRAME - 4, struct.pack("<I", TYPES + index * 280))
        machine.reg_write(UC_X86_REG_EBP, FRAME)
        machine.reg_write(UC_X86_REG_ESP, STACK)
        run_slice(machine, 0x43BBC5, 0x43BCCC)
        stack_pointer = machine.reg_read(UC_X86_REG_ESP)
        source_pointer, format_pointer = struct.unpack("<2I", machine.mem_read(stack_pointer, 8))
        assert source_pointer == FRAME - 0x278
        format_text = READ(format_pointer, 160).split(b"\0", 1)[0]
        assert format_text.split() == [b"%s"] + [b"%d"] * 32
        destinations = struct.unpack("<33I", machine.mem_read(stack_pointer + 8, 132))
        machine.mem_write(destinations[0], tokens[0].encode("ascii") + b"\0")
        for destination, token in zip(destinations[1:], tokens[1:]):
            machine.mem_write(destination, struct.pack("<i", int(token)))
        run_slice(machine, 0x43BCD1, 0x43BD2F)
    return machine


def table_probe():
    machine = parsed_fixture()
    eligible = []
    for unit_type in range(106):
        recharge, multiplier, count, capability = struct.unpack("<4i", machine.mem_read(TYPES + unit_type * 280 + 0xF8, 16))
        if capability & 63 == 4:
            eligible.append(unit_type)
            level = (unit_type - 69) % 4
            assert (recharge, multiplier, count, capability) == (1, (130 + 10 * level) * 256 // 100, 6 + 2 * level, 0xC4)
            print(f"NATIVE TYPE {unit_type}: recharge={recharge}, multiplierQ8={multiplier}, scanBudget={count}, capability={capability:#x}")
    assert eligible == list(range(69, 77)), eligible
    print("PASS native scanf destinations and Q8 conversion on all 106 source type rows; ASCII sscanf marshalled")


def return_from_call(machine, cleanup=0):
    stack_pointer = machine.reg_read(UC_X86_REG_ESP)
    destination = struct.unpack("<I", machine.mem_read(stack_pointer, 4))[0]
    machine.reg_write(UC_X86_REG_ESP, stack_pointer + 4 + cleanup)
    machine.reg_write(UC_X86_REG_EIP, destination)


def effect_probe():
    assert struct.unpack("<4I", READ(0x417158, 16)) == (0x4171F0, 0x4171F9, 0x417203, 0x41720C)
    source_slot, target_slot = 200, 201
    source_entity = GAME + 0x7D28 + source_slot * 220
    target_entity = GAME + 0x7D28 + target_slot * 220
    map_base, ground, air = 0xA00000, 0xB00000, 0xB10000
    cases = [
        (0, 0, 0, 0, True), (10, 20, 0, 0, True), (20, 10, 0, 0, True),
        (11, 20, 0, 0, False), (20, 11, 0, 0, False), (21, 0, 0, 0, False),
        (-20, -10, 0, 0, True), (0, 1, 1, 0, False),
        (0, 1, 0, 69, False), (0, 1, 0, 6, False),
        (0, 0, 0, 5, True), (0, 0, 0, 8, True),
    ]
    for delta_x, delta_y, target_team, target_type, expected in cases:
        machine = parsed_fixture()
        machine.mem_map(map_base, 0x200000)
        machine.mem_write(GAME + 0x46F2C, struct.pack("<I", map_base))
        machine.mem_write(map_base + 0x9A4B0, struct.pack("<2I", 64, 64))
        machine.mem_write(ground, struct.pack("<I", 1023) * (64 * 64))
        machine.mem_write(air, struct.pack("<H", 1023) * (64 * 64))
        for row in range(64):
            machine.mem_write(map_base + 0x804 + row * 4, struct.pack("<I", ground + row * 256))
            machine.mem_write(map_base + 0xC04 + row * 4, struct.pack("<I", air + row * 128))
        machine.mem_write(source_entity + 6, bytes((69, 0)))
        machine.mem_write(source_entity + 10, b"\xff")
        machine.mem_write(target_entity + 6, bytes((target_type, target_team)))
        cell = (32 + delta_y) * 64 + 32 + delta_x
        if target_type != 5:
            machine.mem_write(ground + cell * 4, struct.pack("<I", target_slot))
        if target_type in (5, 8):
            machine.mem_write(air + cell * 2, struct.pack("<H", target_slot))
        assignments, visits = [], []

        def effect_hook(emulator, address, size, user_data):
            if address == 0x412014:
                return_from_call(emulator)
            elif address == 0x417213:
                visits.append((emulator.reg_read(UC_X86_REG_EDX), emulator.reg_read(UC_X86_REG_ECX)))
            elif address == 0x417310:
                assignments.append((emulator.reg_read(UC_X86_REG_EDI), emulator.reg_read(UC_X86_REG_EAX) & 255))

        machine.hook_add(UC_HOOK_CODE, effect_hook)
        machine.mem_write(STACK + 4, struct.pack("<I", 6))
        machine.reg_write(UC_X86_REG_EDX, 32 * 256 + 128)
        machine.reg_write(UC_X86_REG_EBX, 32 * 256 + 128)
        machine.reg_write(UC_X86_REG_ECX, source_slot)
        invoke(machine, 0x417168, GAME)
        timer = machine.mem_read(target_entity + 0xD6, 1)[0]
        assert bool(timer) == expected, (delta_x, delta_y, target_team, target_type, timer)
        assert machine.mem_read(source_entity + 10, 1) == b"\0"
        if expected:
            assert 20 <= timer <= 35
            assert machine.mem_read(target_entity + 0xD8, 2) == struct.pack("<H", source_slot)
        if (delta_x, delta_y, target_team, target_type) == (0, 0, 0, 0):
            assert len(assignments) == 4, assignments
        if target_type == 5:
            assert len(assignments) == 4
        if target_type == 8:
            assert len(assignments) == 6 and len(visits) < 1804
        if not expected:
            assert len(visits) == 1804, len(visits)
            expected_visits = []
            for ring in range(11):
                for transverse in range(-20, 21):
                    expected_visits.extend(((32 - ring, 32 + transverse), (32 + ring, 32 + transverse),
                                            (32 + transverse, 32 - ring), (32 + transverse, 32 + ring)))
            assert visits == expected_visits
        print(f"PASS effect target offset=({delta_x},{delta_y}) team={target_team} type={target_type}: writes={len(assignments)}, timer={timer}, scanVisits={len(visits)}")
    print("LIMIT effect: task-reset/pending-order continuation intercepted; native scan, RNG, eligibility and writes executed")


def cadence_probe():
    machine = parsed_fixture()
    entity = GAME + 0x7D28 + 200 * 220
    machine.reg_write(UC_X86_REG_ESI, entity)
    machine.reg_write(UC_X86_REG_EDI, GAME)
    machine.reg_write(UC_X86_REG_EBX, TYPES + 69 * 280)
    for counter, charge, timer, expected_charge, expected_timer in (
        (1, 0, 20, 0, 20), (16, 0, 20, 0, 19), (32, 0, 20, 1, 19),
        (32, 254, 1, 255, 0), (32, 255, 0, 255, 0),
    ):
        machine.mem_write(GAME + 0x530, struct.pack("<I", counter))
        machine.mem_write(entity + 10, bytes((charge,)))
        machine.mem_write(entity + 0xD6, bytes((timer,)))
        run_slice(machine, 0x4192C0, 0x4192F0)
        assert machine.mem_read(entity + 10, 1)[0] == expected_charge
        if counter & 15 == 0:
            run_slice(machine, 0x419311, 0x419325)
        assert machine.mem_read(entity + 0xD6, 1)[0] == expected_timer
    print("PASS native cadence: recharge +1 on counter&31==0, saturation 255; timer -1 on counter&15==0")


def activation_probe():
    assert struct.unpack("<I", READ(0x4793E8, 4))[0] == 0x41CF8C
    assert struct.unpack("<I", READ(0x4792EC, 4))[0] == 0x416784
    assert struct.unpack("<I", READ(0x479344, 4))[0] == 0x417B0C
    machine = parsed_fixture()
    entities = bytearray(800 * 220)
    for slot, unit_type, selected in ((200, 69, 1), (201, 69, 0), (202, 0, 1), (203, 4, 1)):
        entities[slot * 220 + 6] = unit_type
        entities[slot * 220 + 0x12] = selected
    machine.mem_write(GAME + 0x7D28, bytes(entities))
    machine.mem_write(0x702000, struct.pack("<I", 0x702100))
    machine.mem_write(0x702100, b"\0")
    machine.reg_write(UC_X86_REG_EDX, 0x702000)
    invoke(machine, 0x41CF8C, GAME)
    for slot in (200, 203):
        entities[slot * 220 + 0x36:slot * 220 + 0x38] = bytes((1, 13))
    assert machine.mem_read(GAME + 0x7D28, len(entities)) == entities
    assert machine.mem_read(0x702000, 4) == struct.pack("<I", 0x702101)
    for charge in (0, 31, 32, 33, 254, 255):
        machine = parsed_fixture()
        entity = GAME + 0x7D28 + 200 * 220
        machine.mem_write(entity + 6, bytes((69, 1)))
        machine.mem_write(entity + 10, bytes((charge,)))
        events = []

        def deploy_hook(emulator, address, size, user_data):
            if address not in (0x412654, 0x42630C, 0x411DD8):
                return
            events.append((address, emulator.reg_read(UC_X86_REG_EBX), emulator.reg_read(UC_X86_REG_ECX)))
            if address == 0x411DD8:
                emulator.reg_write(UC_X86_REG_EAX, 0x705000)
            return_from_call(emulator)

        machine.hook_add(UC_HOOK_CODE, deploy_hook)
        machine.reg_write(UC_X86_REG_EDX, 200)
        invoke(machine, 0x416784, GAME)
        if charge < 32:
            assert [event[0] for event in events] == [0x412654]
        else:
            assert [event[0] for event in events] == [0x42630C, 0x411DD8]
            assert events[-1][1:] == (13, 1)
            assert machine.mem_read(0x705000, 2) == struct.pack("<H", 50)
        machine.reg_write(UC_X86_REG_EBP, FRAME)
        machine.mem_write(FRAME - 12, struct.pack("<I", TYPES + 69 * 280))
        machine.mem_write(FRAME - 8, struct.pack("<I", entity))
        machine.mem_write(FRAME - 20, struct.pack("<I", 0))
        run_slice(machine, 0x436839, 0x436892)
        assert struct.unpack("<I", machine.mem_read(FRAME - 20, 4))[0] == (4 if charge > 32 else 0)
    print("PASS native command 26: selection mask plus capability; exact order writes (1,13), no effect writes")
    print("PASS native deploy charge >=32 versus UI charge >32; task 13 scheduled with payload word 50")
    print("LIMIT deploy: rejection, animation and task-push boundaries intercepted; no animation playback")


def combat_probe():
    machine = parsed_fixture()
    attacker = GAME + 0x7D28 + 201 * 220
    caster = GAME + 0x7D28 + 200 * 220
    projectile = 0x704000
    machine.mem_write(projectile + 12, struct.pack("<I", 201 << 16))
    machine.mem_write(attacker + 0xD8, struct.pack("<H", 200))
    for caster_type, expected_factor in ((69, 332), (70, 358), (71, 384), (72, 409)):
        machine.mem_write(caster + 6, bytes((caster_type,)))
        for timer in (0, 1):
            machine.mem_write(attacker + 0xD6, bytes((timer,)))
            machine.reg_write(UC_X86_REG_ESI, projectile)
            machine.reg_write(UC_X86_REG_EDI, GAME)
            machine.reg_write(UC_X86_REG_EBX, 256)
            run_slice(machine, 0x4427D5, 0x44283D)
            factor = machine.reg_read(UC_X86_REG_EBX)
            assert factor == (expected_factor if timer else 256)
            machine.reg_write(UC_X86_REG_EBP, FRAME)
            machine.mem_write(FRAME - 12, struct.pack("<I", 256))
            machine.mem_write(FRAME - 4, struct.pack("<I", factor))
            machine.mem_write(FRAME + 20, b"\0")
            machine.reg_write(UC_X86_REG_ECX, 100)
            machine.reg_write(UC_X86_REG_EBX, 256)
            run_slice(machine, 0x4419E5, 0x441A12)
            assert machine.reg_read(UC_X86_REG_ECX) == 100 * factor // 256
    for timer in (0, 1):
        machine.mem_write(attacker + 0xD6, bytes((timer,)))
        machine.reg_write(UC_X86_REG_ESI, attacker)
        machine.reg_write(UC_X86_REG_EBP, FRAME)
        machine.mem_write(FRAME + 0x4E, struct.pack("<I", 1234))
        machine.mem_write(FRAME + 0x56, struct.pack("<I", 5678))
        machine.mem_write(FRAME + 0x2A, struct.pack("<I", 0))
        machine.mem_write(FRAME + 0x76, b"\0")
        run_slice(machine, 0x412EF7, 0x412F8E)
        actual = tuple(struct.unpack("<I", machine.mem_read(FRAME + offset, 4))[0] for offset in (0x4E, 0x56))
        assert actual == ((1234, 5678) if timer else (1746, 6190)), actual
    print("PASS native combat: active timer uses current caster-type Q8 multiplier; 100 base -> 129/139/150/159")
    print("PASS native scatter: active timer chooses center (1,1), bypassing random 3x3 offset")


def animation_gate_probe():
    for unit_type, budget in ((69, 6), (72, 12)):
        for phase in (0, 1, 2, 3):
            machine = parsed_fixture()
            entity = GAME + 0x7D28 + 200 * 220
            machine.mem_write(entity, struct.pack("<3H", 8320, 0, 8576))
            machine.mem_write(entity + 6, bytes((unit_type, 0)))
            machine.mem_write(entity + 0x1A, bytes((phase,)))
            calls = []

            def capture_effect(emulator, address, size, user_data):
                if address != 0x417168:
                    return
                stack_pointer = emulator.reg_read(UC_X86_REG_ESP)
                calls.append(tuple(emulator.reg_read(register) for register in
                                   (UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX))
                             + (struct.unpack("<I", emulator.mem_read(stack_pointer + 4, 4))[0],))
                return_from_call(emulator, 4)

            machine.hook_add(UC_HOOK_CODE, capture_effect)
            machine.reg_write(UC_X86_REG_EDX, 200)
            invoke(machine, 0x417B0C, GAME)
            assert calls == ([(GAME, 8320, 8576, 200, budget)] if phase == 2 else [])
    print("PASS native task 13: only animation byte +0x1a == 2 calls effect with caster position/slot and source budget")
    print("LIMIT animation: effect boundary captured; frame progression and pending-order continuation not integrated")


def lifecycle_fixture():
    construction = runpy.run_path(str(Path(__file__).with_name("construction-lifecycle-20260919.py")))
    native = construction["source_fixture"](IMAGE)
    profiles = construction["load_fin"](native, (0, 5, 69, 73, 92, 93))
    for binding in profiles["bindings"]:
        unit_type = binding["unitType"]
        native.emulator.mem_write(0x70D800 - 0x178, binding["stem"].encode("ascii") + b"\0")
        native.put(0x70D800 - 4, TYPES + unit_type * 280)
        native.run(0x43BE2A, {UC_X86_REG_EBP: 0x70D800}, 0x43BE59)
        native.run(0x43C099, {UC_X86_REG_EBP: 0x70D800}, 0x43C0EA)
        bank = native.get(TYPES + unit_type * 280 + 0x94)
        assert bank, (unit_type, "unresolved deploy FIN binding +0x94")
        binding["deployBank"] = bank
        binding["deployUsesStandDescriptor"] = native.get(bank) == native.get(binding["standBank"])
        if unit_type in (69, 73):
            assert bank == binding["standBank"]
            assert all(native.get(native.get(bank + direction * 4) + 0x28) == 1 for direction in range(32))
        native.run(0x43C0EA, {UC_X86_REG_EBP: 0x70D800}, 0x43C13B)
    native.inspire_states = {}
    native.emulator.mem_write(0x701700, b"\0")
    for source in profiles["sources"]:
        for state in source["states"]:
            native.emulator.mem_write(0x701500, state["name"].encode("ascii") + b"\0")
            native.run(0x4254D4, {UC_X86_REG_EAX: 0x701500, UC_X86_REG_EDX: 0x701700})
            descriptor = native.emulator.reg_read(UC_X86_REG_EAX)
            assert descriptor
            native.inspire_states[descriptor] = state
    native.emulator.mem_map(0xC00000, 0x200000)
    native.put(GAME + 0x46F2C, 0xC00000)
    native.put(GAME + 0x544, 0xD00000)
    for offset, value in ((0x9A4B0, 128), (0x9A4B4, 128), (0x9A4B8, 128 * 256), (0x9A4BC, 128 * 256)):
        native.put(0xC00000 + offset, value)
    for offset, base, width, code in ((0x804, 0xC10000, 4, "I"), (0xC04, 0xC30000, 2, "H"),
                                      (0x1004, 0xC40000, 2, "H")):
        native.emulator.mem_write(base, struct.pack("<" + code, 1023) * (128 * 128))
        for row in range(128):
            native.put(0xC00000 + offset + row * 4, base + row * 128 * width)
    native.emulator.mem_write(GAME + 0x468EC, b"\xff\xff" * 800)
    native.put(GAME + 0x468E8, 65535, 2)
    native.put(GAME + 0x468EA, 65535, 2)
    native.put(GAME + 0x7D20, 152)
    native.put(GAME + 0x7D1C, 0)
    native.put(GAME + 0x530, 1)
    return construction, native, profiles


def lifecycle_case(queued_order=None, recipients_first=False, reset_counter=False, lifetime=False):
    construction, native, profiles = lifecycle_fixture()
    if lifetime:
        construction["load_damage"](native, 69)
        construction["load_damage"](native, 73)
    runtime_call_start = len(native.calls)
    result = {"queuedOrder": queued_order, "recipientsFirst": recipients_first, "resetCounter": reset_counter,
              "profiles": profiles, "trace": [], "events": [], "writes": []}
    update = 0
    slots = {}
    tracked = {0x479204: "rngIndex"}
    entries = {0x41DEFC, 0x41CF8C, 0x41CE54, 0x419248, 0x412014, 0x416784,
               0x42630C, 0x4264C8, 0x411DD8, 0x417B0C, 0x417168, 0x4171B7,
               0x416308, 0x416460, 0x41B750, 0x434D48}

    def entity(slot):
        return GAME + 0x7D28 + slot * 220

    def record_code(emulator, address, size, user_data):
        if address in entries:
            event = {"sequence": len(result["events"]) + len(result["writes"]),
                "update": update, "eip": hex(address),
                "eax": emulator.reg_read(UC_X86_REG_EAX), "edx": emulator.reg_read(UC_X86_REG_EDX),
                "ebx": emulator.reg_read(UC_X86_REG_EBX), "ecx": emulator.reg_read(UC_X86_REG_ECX)}
            if address == 0x417168:
                event["casterSlot"] = event["ecx"]
                event["animationMode"] = native.get(entity(event["ecx"]) + 0x1A, 1)
            if address == 0x416784:
                event["chargeAtEntry"] = native.get(entity(event["edx"]) + 10, 1)
            result["events"].append(event)

    def record_write(emulator, access, address, size, value, user_data):
        if address in tracked:
            result["writes"].append({"sequence": len(result["events"]) + len(result["writes"]),
                "update": update, "eip": hex(emulator.reg_read(UC_X86_REG_EIP)),
                "field": tracked[address], "before": native.get(address, size),
                "after": value & ((1 << (size * 8)) - 1)})

    native.emulator.hook_add(UC_HOOK_CODE, record_code)
    native.emulator.hook_add(UC_HOOK_MEM_WRITE, record_write)

    def spawn(unit_type, column, row, replace_slot=-1):
        native.put(construction["BASE"]["STACK"] + 4, 1)
        native.put(construction["BASE"]["STACK"] + 8, replace_slot)
        native.run(0x41B750, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: column,
                              UC_X86_REG_EBX: row, UC_X86_REG_ECX: unit_type})
        slot = native.emulator.reg_read(UC_X86_REG_EAX)
        assert native.get(GAME + 0x468EC + slot * 2, 2) == slot
        occupancy = construction["occupancy_membership"](native, slot)
        assert occupancy["air" if unit_type == 5 else "ground"] == [[column, row]], occupancy
        for offset, field in ((10, "charge"), (0x1A, "animationMode"), (0x36, "pending"),
                              (0x37, "order"), (0x38, "taskDepth"), (0xD6, "timer"), (0xD8, "casterSlot"),
                              (0x2C, "status"), (0x46, "taskWord0")):
            tracked[entity(slot) + offset] = f"{slot}.{field}"
        tracked[GAME + 0x468EC + slot * 2] = f"{slot}.activeSlot"
        return slot

    units = [("caster69", 69, 32, 32), ("ground69", 0, 32, 33), ("air69", 5, 33, 32),
             ("caster73", 73, 80, 80), ("ground73", 0, 80, 81)]
    if recipients_first:
        units.sort(key=lambda item: item[1] in (69, 73))
    for name, unit_type, column, row in units:
        slot = spawn(unit_type, column, row)
        slots[name] = slot
        if unit_type in (69, 73):
            native.put(entity(slot) + 0x12, 2, 1)
            native.put(entity(slot) + 0xA, 255, 1)

    def record(stage):
        states = {name: construction["snapshot"](native, slot) | {
            "charge": native.get(entity(slot) + 10, 1), "timer": native.get(entity(slot) + 0xD6, 1),
            "casterSlot": native.get(entity(slot) + 0xD8, 2)} for name, slot in slots.items()}
        for name, slot in slots.items():
            animation = states[name]["animation"]
            direction = (((native.get(entity(slot) + 9, 1) + 8) & 255) >> 4) * 2
            descriptor = native.get(animation["bank"] + direction * 4)
            source = native.inspire_states[descriptor]
            animation.update({"direction": direction, "descriptor": descriptor, "source": source["source"],
                "state": source["name"], "sourceTimeline": source["first"] + animation["frame"],
                "sourceDelay": source["delays"][animation["frame"]]})
        result["trace"].append({"stage": stage, "update": update, "counter": native.get(GAME + 0x530),
                                "rngIndex": native.get(0x479204), "slots": states})
        return states

    def command(payload):
        native.emulator.mem_write(0x701100, payload + b"\0")
        native.run(0x41DEFC, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701100,
                              UC_X86_REG_EBX: len(payload) + 1})
        assert native.emulator.reg_read(UC_X86_REG_EAX) == 0

    def dispatch():
        native.put(0x70D800 - 4, GAME)
        native.run(0x419BB8, {UC_X86_REG_EBP: 0x70D800}, 0x419C0E)

    record("native-spawn")
    command(bytes((26, 1)))
    states = record("selected-command26")
    assert all((states[name]["pendingOrder"], states[name]["order"]) == (1, 13)
               for name in ("caster69", "caster73"))
    update = 1
    dispatch()
    states = record("task13-started")
    for name in ("caster69", "caster73"):
        assert (states[name]["task"], states[name]["animation"]["mode"], states[name]["charge"]) == (13, 1, 255)
        assert states[name]["taskWords"][0] == 50
    assert not any(event["eip"] == "0x417168" for event in result["events"])
    if queued_order is not None:
        assert native.get(0x479380 + 5 * 4) == 0x41CE54
        for name in ("caster69", "caster73"):
            command(bytes((5,)) + struct.pack("<hB", slots[name], queued_order))
        states = record("queued-before-effect")
        assert all(states[name]["task"] == 13 and states[name]["order"] == queued_order
                   for name in ("caster69", "caster73"))
    if reset_counter:
        native.put(GAME + 0x530, 48)
        native.put(GAME + 0x534, 47)
        native.put(0x70D800 - 4, GAME)
        native.run(0x419993, {UC_X86_REG_EBP: 0x70D800, UC_X86_REG_EDX: GAME}, 0x4199C1)
        assert native.get(GAME + 0x530) == 0 and native.get(GAME + 0x53C) == 1
    update = 2
    dispatch()
    states = record("first-effect-returned")
    assert all(states[name]["charge"] == 0 for name in ("caster69", "caster73"))
    assert all(states[name]["task"] == (13 if queued_order == 13 else 1) for name in ("caster69", "caster73"))
    first_effect_writes = [write for write in result["writes"] if write["eip"] == "0x417310"]
    assert len(first_effect_writes) == 9, first_effect_writes
    for name, caster in (("ground69", "caster69"), ("air69", "caster69"), ("ground73", "caster73")):
        assert states[name]["timer"] > 0 and states[name]["casterSlot"] == slots[caster]
        last_timer = [write["after"] for write in first_effect_writes if write["field"] == f"{slots[name]}.timer"][-1]
        assert states[name]["timer"] == last_timer - int(reset_counter and not recipients_first)
    update = 3
    native.put(GAME + 0x530, 1)
    dispatch()
    record("following-update")
    effect_events = [event for event in result["events"] if event["eip"] == "0x417168"]
    assert [event["update"] for event in effect_events] == ([2, 2, 3, 3] if queued_order == 13 else [2, 2])
    for effect in effect_events:
        assert effect["animationMode"] == 2
        clear = next(write for write in result["writes"] if write["eip"] == "0x4171b7"
                     and write["sequence"] > effect["sequence"])
        continuation = [event for event in result["events"] if event["eip"] == "0x412014"
                        and effect["sequence"] < event["sequence"] < clear["sequence"]]
        assert len(continuation) == 1 and continuation[0]["edx"] == effect["casterSlot"]
        if queued_order == 13 and effect["update"] == 2:
            deploy = [event for event in result["events"] if event["eip"] == "0x416784"
                      and effect["sequence"] < event["sequence"] < clear["sequence"]]
            assert len(deploy) == 1 and deploy[0]["chargeAtEntry"] == 255
    for write in [entry for entry in result["writes"] if entry["eip"] == "0x417310"]:
        position = result["writes"].index(write)
        rng_write = next(entry for entry in reversed(result["writes"][:position]) if entry["field"] == "rngIndex")
        assert write["after"] == 20 + (native.get(0x478E04 + rng_write["after"] * 4) & 15)
    if lifetime:
        result["lifetime"] = {"damageHits": {}, "multipliers": [], "naturalReuseProven": False}

        def multipliers(stage, expected):
            factors = {}
            for name in ("ground69", "air69", "ground73"):
                assert native.get(entity(slots[name]) + 0xD6, 1) > 0
                native.put(0x706000 + 12, slots[name] << 16)
                native.run(0x4427D5, {UC_X86_REG_ESI: 0x706000, UC_X86_REG_EDI: GAME,
                                      UC_X86_REG_EBX: 256}, 0x44283D)
                factors[name] = native.emulator.reg_read(UC_X86_REG_EBX)
                expected_factor = expected[name] if isinstance(expected, dict) else expected
                assert factors[name] == expected_factor, (stage, name, factors[name])
            result["lifetime"]["multipliers"].append({"stage": stage, "factors": factors})

        multipliers("living-casters", 332)
        for name in ("caster69", "caster73"):
            hits = 0
            while native.get(entity(slots[name]) + 0x2C, 1) != 10:
                before_hp = native.get(entity(slots[name]) + 12)
                for offset, value in ((4, 0), (8, 0), (12, slots["ground69"])):
                    native.put(construction["BASE"]["STACK"] + offset, value)
                native.run(0x441930, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: slots[name],
                                      UC_X86_REG_EBX: 0x703000, UC_X86_REG_ECX: 256})
                hits += 1
                assert native.get(entity(slots[name]) + 12) < before_hp
                assert hits < 1024
            result["lifetime"]["damageHits"][name] = hits
            assert not any(construction["occupancy_membership"](native, slots[name]).values())
        record("lethal-native-damage")
        multipliers("dead-casters", 332)
        for update in range(4, 165):
            native.put(GAME + 0x530, update)
            dispatch()
        states = record("after-161-death-updates")
        for name in ("caster69", "caster73"):
            assert (states[name]["status"], states[name]["task"], states[name]["taskWords"][0]) == (0, 10, 150)
            assert states[name]["activeSlot"] == 65535
            recovery = [write for write in result["writes"] if write["field"] == f"{slots[name]}.taskWord0"
                        and write["eip"] == "0x418d0e"]
            assert len(recovery) == 1 and recovery[0]["after"] == 150 and recovery[0]["update"] == 68
        multipliers("reclaimed-casters-retain-type", 332)
        allocated = spawn(0, 90, 90)
        assert allocated == slots["caster73"]
        multipliers("first-automatic-reuse", {"ground69": 332, "air69": 332, "ground73": 0})
        second = spawn(0, 91, 90)
        assert second == slots["caster69"]
        result["lifetime"]["automaticAllocation"] = [allocated, second]
        result["lifetime"]["naturalReuseProven"] = True
        record("automatic-native-slot-reuse")
        multipliers("both-automatic-reuse", 0)
        result["lifetime"]["boundary"] = (
            "Lethal damage is batched through original 0x441930, not timed projectiles. "
            "Native recovery auxiliaries and outer dispatcher reclaim commander slots. "
            "Two automatic (-1) 0x41b750 allocations reuse the slots while recipient timers remain positive.")
    assert len(native.calls) == runtime_call_start, native.calls[runtime_call_start:]
    result["runtimeIntercepts"] = []
    result["accepted"] = True
    return result


def lifecycle_probe(quiet=False):
    results = [lifecycle_case(order, reverse, reset) for order, reverse, reset in
               ((None, False, False), (1, False, False), (13, False, False),
                (None, False, True), (None, True, True))]
    results.append(lifecycle_case(lifetime=True))
    if not quiet:
        for result in results:
            print(f"PASS native lifecycle queued={result['queuedOrder']} recipientsFirst={result['recipientsFirst']} "
                  f"dayNightReset={result['resetCounter']} effects="
                  f"{[event['update'] for event in result['events'] if event['eip'] == '0x417168']} "
                  f"nativeLifetime={'lifetime' in result}")
    return results


def dispatch_probe():
    table = struct.unpack("<8i", READ(0x436560, 32))
    assert table == (-1, 138, 139, 140, 141, 142, 142, 37)
    for widget in (37, 138, 139, 140, 141, 142, 143, 150):
        actual = invoke(fixture(), 0x43659C, widget) & 255
        assert actual == int(widget in table[1:])
    for team in (0, 1, 7):
        for game_gate, ui_gate in ((0, 0), (1, 0), (0, 1)):
            machine = fixture()
            machine.mem_write(GAME + 0x7D1C, struct.pack("<I", team))
            machine.mem_write(GAME + 0x46F31, bytes((game_gate,)))
            machine.mem_write(UI + 0x13B, bytes((ui_gate,)))
            packets = []

            def capture_transport(emulator, address, size, user_data):
                if address != 0x421770:
                    return
                pointer = emulator.reg_read(UC_X86_REG_EAX)
                length = emulator.reg_read(UC_X86_REG_EDX)
                packets.append(bytes(emulator.mem_read(pointer + 2, length - 2)))
                stack_pointer = emulator.reg_read(UC_X86_REG_ESP)
                destination = struct.unpack("<I", emulator.mem_read(stack_pointer, 4))[0]
                emulator.reg_write(UC_X86_REG_ESP, stack_pointer + 4)
                emulator.reg_write(UC_X86_REG_EIP, destination)

            machine.hook_add(UC_HOOK_CODE, capture_transport)
            invoke(machine, 0x409418, UI)
            assert packets == ([] if game_gate or ui_gate else [bytes((26, team))])
    print("PASS native table: widget 141 is special-action index 4")
    print("PASS native serializer: payload [26, team], teams 0/1/7; both nonzero gates suppress")
    print("LIMIT serializer: transport enqueue intercepted; command consumption tested separately")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lifecycle-only", action="store_true")
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args()
    if arguments.json and not arguments.lifecycle_only:
        parser.error("--json requires --lifecycle-only")
    if arguments.lifecycle_only:
        results = lifecycle_probe(quiet=arguments.json)
        if arguments.json:
            print(json.dumps({"exeSha256": AUDIT.DIGEST, "cases": results}, indent=2))
        sys.exit(0)
    print(f"SHA256 {AUDIT.DIGEST}")
    dispatch_probe()
    table_probe()
    effect_probe()
    cadence_probe()
    activation_probe()
    combat_probe()
    animation_gate_probe()
    lifecycle_probe()