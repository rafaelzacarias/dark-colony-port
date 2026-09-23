import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EBP

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SOURCE = runpy.run_path(str(ROOT / "tools/research/construction-lifecycle-20260919.py"))
IMAGE = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(IMAGE).hexdigest() == SOURCE["BASE"]["EXE_HASH"]


def receipt_case(race):
    native = SOURCE["source_fixture"](IMAGE)
    game = SOURCE["GAME"]
    team = game + 0xb98 + 0xe30
    profiles = SOURCE["load_fin"](native, (16 + race * 12, 17 + race * 12, 20 + race * 12, 92 + race, race * 8, 6 + race * 8))
    native.emulator.mem_write(game + 0x468ec, b"\xff\xff" * 800)
    native.put(game + 0x7d20, 152)
    native.put(game + 0x7d1c, 1)
    native.put(game + 0x94c, 3)
    native.put(game + 0x544, 0xd00000)
    native.put(team + 0x20, race)
    native.put(team + 0x14, 6000)
    native.put(team + 0x18, 17)
    native.emulator.mem_map(0xc00000, 0x200000)
    native.put(game + 0x46f2c, 0xc00000)
    native.put(0xc00000 + 0x9a4b0, 128)
    native.put(0xc00000 + 0x9a4b4, 128)
    SOURCE["populate_footprint"](native, 1, 3)
    native.emulator.mem_write(0xc10000, struct.pack("<I", 1023) * 16384)
    native.emulator.mem_write(0xc50000, struct.pack("<I", 0x80000000) * 16384)
    for row in range(128):
        native.put(0xc00000 + 4 + row * 4, 0xc50000 + row * 512)
    for slot in (0, 1):
        unit_type = 16 + race * 12 + slot
        native.put(team + 0x3c + slot * 4, native.get(0x4f1880 + unit_type * 280 + 0x44))
        native.run(0x444f14, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 1, UC_X86_REG_EBX: slot})
    native.put(0x70d800 - 4, game)
    native.run(0x419bb8, {UC_X86_REG_EBP: 0x70d800}, 0x419c0e)
    native.run(0x437bc4, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 1})
    native.put(game + 0x94c, 4)
    native.put(team + 0xda4 + (3 if race == 0 else 17), 1, 1)
    for queue in range(4):
        native.put(team + 0x108 + queue, 1, 1)
    policy = 0xa00000
    native.emulator.mem_map(policy, 0x10000)
    native.emulator.mem_write(policy + 0x6a94, bytes(native.emulator.mem_read(0x48903c, 216)))
    native.put(policy + 0x6c14, 192)
    for index, weight in enumerate((1, 1, 2, 4, 2, 4, 2)):
        native.put(policy + 0x6c18 + index * 4, weight)
    for group in range(4):
        native.put(policy + group * 0x12fc + 0x3178, 0x459d98 if group == 0 else 0x44b6a4)
        native.put(policy + group * 0x12fc + 0x1e95, 1, 1)
        for bucket in range(16):
            native.put(policy + group * 0x12fc + bucket * 300 + 0x1faa, 0xffffffff)
    for index in range(6):
        native.put(SOURCE["BASE"]["STACK"] + 4, 1)
        native.put(SOURCE["BASE"]["STACK"] + 8, 0xffffffff)
        native.run(0x41b750, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 40 + index,
                              UC_X86_REG_EBX: 40, UC_X86_REG_ECX: (6 if index == 0 else 0) + race * 8})
        assert native.emulator.reg_read(UC_X86_REG_EAX) == 152 + index
        actor = game + 0x7d28 + (152 + index) * 220
        native.put(actor + 0xd2, 153 + index if 0 < index < 5 else 65535, 2)
        native.put(actor + 0xd4, 151 + index if index > 1 else 65535, 2)
    native.put(policy + 0x1faa, 152, 2)
    native.put(policy + 0x1fac, 152, 2)
    native.put(policy + 0x12fc + 0x1faa, 153, 2)
    native.put(policy + 0x12fc + 0x1fac, 157, 2)
    native.put(game + 0x528, 10)
    native.put(0x4956e0 + 48 + 24, 6)
    packets = []
    def output(machine):
        length = machine.emulator.reg_read(UC_X86_REG_EDX)
        packet = bytearray(machine.emulator.mem_read(machine.emulator.reg_read(UC_X86_REG_EAX), length))
        struct.pack_into("<H", packet, 0, length)
        packets.append(list(packet))
    native.stubs[0x421648] = output
    def ai_snapshot():
        return dict(policy=list(native.emulator.mem_read(policy, 0x6c40)),
                    entities=list(native.emulator.mem_read(game + 0x7d28, 800 * 220)),
                    teamBytes=list(native.emulator.mem_read(team, 0xe30)))
    ai_before = ai_snapshot()
    before_team = list(native.emulator.mem_read(team, 0xe30))
    native.run(0x457940, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: policy, UC_X86_REG_EBX: 1})
    assert packets == [[7, 0, 9, 3, 0, 1, 0]], packets
    ai_after = ai_snapshot()
    calls = []
    def observe(emulator, address, size, userdata):
        if address in (0x41c8d4, 0x444f14, 0x41822c, 0x437bc4):
            calls.append(hex(address))
    native.emulator.hook_add(UC_HOOK_CODE, observe)
    start = len(native.calls)
    native.emulator.mem_write(0x701100, bytes([9, 3, 0, 1, 0]))
    native.run(0x41defc, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 0x701100, UC_X86_REG_EBX: 5})
    assert native.emulator.reg_read(UC_X86_REG_EAX) == 0
    assert native.get(team + 0x14) == 4000 and native.get(team + 0x18) == 2017
    assert set(calls) == {"0x41c8d4", "0x444f14", "0x41822c", "0x437bc4"}
    def snapshot():
        return dict(main=SOURCE["snapshot"](native, 18), auxiliary=SOURCE["snapshot"](native, 21),
                    busy=native.get(team + 0x7b, 1), latch=native.get(team + 0xe12, 1),
                    position=[native.get(game + 0x7d28 + 18 * 220, 2), native.get(game + 0x7d28 + 18 * 220 + 4, 2)],
                    auxiliaryPosition=[native.get(game + 0x7d28 + 21 * 220, 2), native.get(game + 0x7d28 + 21 * 220 + 2, 2), native.get(game + 0x7d28 + 21 * 220 + 4, 2)])
    trace = [snapshot()]
    for update in range(1, 247):
        native.put(0x70d800 - 4, game)
        native.run(0x419bb8, {UC_X86_REG_EBP: 0x70d800}, 0x419c0e)
        trace.append(snapshot())
        if trace[-1]["busy"] == trace[-1]["latch"] == 0:
            break
    assert update == (186 if race == 0 else 246)
    assert len(native.calls) == start
    first_calls = native.calls[start:]
    next_before = ai_snapshot()
    native.run(0x457940, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: policy, UC_X86_REG_EBX: 1})
    assert packets[-1] == [7, 0, 10, race * 8, 1, 1, 0], packets
    next_after = ai_snapshot()
    native.emulator.mem_write(0x701100, bytes(packets[-1][2:]))
    native.run(0x41defc, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 0x701100, UC_X86_REG_EBX: 5})
    assert native.get(team + 0x110, 2) == 1
    return dict(race=race, team=1, beforeTeam=before_team, profiles=profiles, calls=calls,
                aiBefore=ai_before, aiAfter=ai_after, nextBefore=next_before, nextAfter=next_after, packets=packets,
                cityDependencies=list(struct.unpack("<18i", native.emulator.mem_read(0x488ff4, 72))),
                dependencies=list(native.emulator.mem_read(0x4e6d70, 110 * 52)),
                types=list(native.emulator.mem_read(0x4f1880, 110 * 280)), trace=trace,
                lifecycleInterceptedCalls=first_calls)

if __name__ == "__main__":
    print(json.dumps({"sha256": SOURCE["BASE"]["EXE_HASH"],
                      "cases": [receipt_case(race) for race in (0, 1)]}))