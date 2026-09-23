"""Original registered attack visits and projectile allocation evidence."""

import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("fire_actor", Path(__file__).with_name("nativeactor-task-native.py"))
ACTOR = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ACTOR)


def configure_fire(machine, kinds):
    construction = ACTOR.module("fire_construction", "construction-lifecycle-20260919.py")
    native = construction.source_fixture(ACTOR.AI.NATIVE.IMAGE)
    construction.load_fin(native, kinds, attack=True)
    lookup = native.stubs[0x4254D4]
    descriptors = {}
    source_states = {}
    cursor = 0x1E00000
    for filename in (ROOT / "raw_cd/DC/ANIM.DAT").read_text().splitlines():
        data = (ROOT / "raw_cd/DC/ANIMATE" / filename.strip().upper()).read_bytes()
        if len(data) < 8 or struct.unpack_from("<H", data)[0] != 29:
            continue
        _, timeline_count, state_count, sprite_count = struct.unpack_from("<4H", data)
        state_start = 8 + sprite_count * 8
        timeline_start = state_start + state_count * 20
        for index in range(state_count):
            offset = state_start + index * 20
            name = data[offset:offset + 16].split(b"\0", 1)[0].decode().upper()
            first, last = struct.unpack_from("<HH", data, offset + 16)
            if first <= last < timeline_count:
                source_states[name] = (data, timeline_start, first, last)

    def source_lookup(context):
        nonlocal cursor
        name = (construction.cstring(context, context.emulator.reg_read(ACTOR.AI.UC_X86_REG_EAX))
                + construction.cstring(context, context.emulator.reg_read(ACTOR.AI.UC_X86_REG_EDX))).upper()
        lookup(context)
        if context.emulator.reg_read(ACTOR.AI.UC_X86_REG_EAX) or name not in source_states:
            return
        if name not in descriptors:
            data, timeline_start, first, last = source_states[name]
            descriptor, frames = cursor, cursor + 48
            cursor = frames + (last - first + 1) * 72
            assert cursor < 0x1F00000
            descriptors[name] = descriptor
            context.put(descriptor + 0x20, frames)
            context.put(descriptor + 0x24, frames + (last - first) * 72)
            context.put(descriptor + 0x28, last - first + 1)
            for local, timeline in enumerate(range(first, last + 1)):
                children, duration = struct.unpack_from("<HH", data, timeline_start + timeline * 164)
                context.put(frames + local * 72, children, 2)
                context.put(frames + local * 72 + 2, duration, 2)
        context.emulator.reg_write(ACTOR.AI.UC_X86_REG_EAX, descriptors[name])

    native.stubs[0x4254D4] = source_lookup
    lines = iter((ROOT / "raw_cd/DC/GAMESTAT/BOOMSTAT.TXT").read_bytes().splitlines(keepends=True))

    def open_file(context):
        context.emulator.reg_write(ACTOR.AI.UC_X86_REG_EAX, 1)

    def read_line(context):
        destination = context.emulator.reg_read(ACTOR.AI.UC_X86_REG_EAX)
        line = next(lines)
        context.emulator.mem_write(destination, line + b"\0")

    native.stubs.update({0x40601C: open_file, 0x4062B4: read_line, 0x40636C: None})
    native.run(0x43B344, {})
    weapon_rows = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").read_text().splitlines()
                   if line.strip() and not line.lstrip().startswith("%")][1:]
    for tokens in weapon_rows:
        weapon_record = 0x4F0200 + int(tokens[0]) * 72
        native.emulator.mem_write(weapon_record, bytes(machine.mem_read(weapon_record, 72)))
        native.emulator.mem_write(0x70D800 - 0x114, tokens[1].encode() + b"\0")
        native.run(0x43B84F, {ACTOR.AI.UC_X86_REG_EBP: 0x70D800, ACTOR.AI.UC_X86_REG_ESI: weapon_record}, 0x43B955)
    for name, descriptor in descriptors.items():
        _, _, first, last = source_states[name]
        frames = native.get(descriptor + 0x20)
        for index in range(last - first + 1):
            native.put(0x70E062, frames)
            native.run(0x425B21, {ACTOR.AI.UC_X86_REG_EAX: frames + index * 72, ACTOR.AI.UC_X86_REG_EDI: index,
                ACTOR.AI.UC_X86_REG_EBP: 0x70E000}, 0x425B6F)
    machine.mem_write(0x1E00000, bytes(native.emulator.mem_read(0x1E00000, cursor - 0x1E00000)))
    machine.mem_write(0x4F0200, bytes(native.emulator.mem_read(0x4F0200, 80 * 72)))
    machine.mem_write(0x4F90D0, bytes(native.emulator.mem_read(0x4F90D0, 13 * 136)))
    relocated = {}

    def bind(address):
        bank = native.get(address)
        if bank:
            if bank not in relocated:
                relocated[bank] = 0x1F00000 + len(relocated) * 128
                machine.mem_write(relocated[bank], bytes(native.emulator.mem_read(bank, 128)))
            ACTOR.AI.put(machine, address, relocated[bank])

    for address in range(0x4F90D0, 0x4F90D0 + 13 * 136, 136):
        for offset in range(0, 16, 4):
            bind(address + offset)
    for index in range(80):
        for offset in range(0x2C, 0x40, 4):
            bind(0x4F0200 + index * 72 + offset)
    assert any(machine.mem_read(0x4F9144 + 136, 18))


def disassembly():
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32
    for start, end in ((0x412D00, 0x4131C0), (0x41481C, 0x41486C),
                       (0x441504, 0x441710), (0x441710, 0x441880), (0x4121D8, 0x412290),
                       (0x411DB4, 0x411DD8), (0x42630C, 0x4264C8), (0x43B330, 0x43B955), (0x419D8C, 0x419E08)):
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(ACTOR.AI.NATIVE.READ(start, end - start), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    if "--disassemble" in sys.argv:
        disassembly()
    else:
        cases = [(unit_type, order, True, None, {"rngWarmup": 253, "poisonPool": True, "reusePool": True})
                 for unit_type in (0, 8, 69, 73) for order in (7, 0)]
        if "--suite" in sys.argv:
            cases += [(unit_type, 7, False, None, {"rngWarmup": 17}) for unit_type in (0, 8, 69, 73)]
            cases += [(unit_type, 7, True, 11, {}) for unit_type in (0, 8, 69, 73)]
            cases += [(unit_type, order, True, None, {"scenarioWeaponLevel": level, "rngWarmup": 71, "targetDistance": 1,
                                                    "sourceTeam": 0 if unit_type == 8 else 1})
                      for unit_type in (0, 8) for level in (1, 2) for order in (7, 0)]
            cases += [(8, order, False, None, {"sourceSlot": 152, "rngWarmup": 119}) for order in (7, 0)]
            cases += [(8, order, False, None, {"sourceSlot": 152, "scenarioWeaponLevel": level, "rngWarmup": 211})
                      for level in (1, 2) for order in (7, 0)]
        else:
            cases = cases[:1]
        if "--case" in sys.argv:
            cases = [cases[int(sys.argv[sys.argv.index("--case") + 1])]]
        for unit_type, order, aligned, stop_task, options in cases:
            print(json.dumps(ACTOR.capture(unit_type, 7 if order else 17, 1 if order else 0, 1, order=order, updates=35 if not aligned else 18,
                faction="ALIEN" if unit_type in (8, 73) else "HUMAN", stop_task=stop_task,
                source_slot=options.get("sourceSlot"),
                acquisition_case={"team": 1 if options.get("sourceSlot") or options.get("sourceTeam") == 0 else 0 if unit_type in (8, 73) else 2,
                                  "type": 0, "aligned": aligned, "revealCell": True},
                fire_capture=True, configure_fire=configure_fire, fire_options=options)), flush=True)