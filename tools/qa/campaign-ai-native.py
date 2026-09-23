import argparse
import base64
import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX

ROOT = Path(__file__).resolve().parents[2]
BASE = runpy.run_path(str(ROOT / "tools/research/production-audit-20260919.py"))
LIFECYCLE = runpy.run_path(str(ROOT / "tools/research/construction-lifecycle-20260919.py"))
IMAGE = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(IMAGE).hexdigest() == BASE["EXE_HASH"]


def inspect():
    native = BASE["Native"](IMAGE)
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    for start, length in ((0x40c13c, 0x60), (0x41c7f8, 0xdc), (0x41df68, 0x198), (0x421648, 0x140)):
        for instruction in decoder.disasm(bytes(native.emulator.mem_read(start, length)), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
    code = bytes(native.emulator.mem_read(0x401000, 0x79000))
    image = bytes(native.emulator.mem_read(0x400000, 0x100000))
    for target in (0x41c7f8, 0x41c8d4, 0x479380):
        needle = target.to_bytes(4, "little")
        locations = [0x400000 + offset for offset in range(len(image) - 3) if image[offset:offset + 4] == needle]
        print("TABLE", hex(target), [hex(address) for address in locations])
        if target == 0x479380:
            for location in locations:
                start = location - 100
                for nearby in decoder.disasm(bytes(native.emulator.mem_read(start, 360)), start):
                    print(f"{nearby.address:#x}: {nearby.mnemonic} {nearby.op_str}")
    for offset in range(len(code) - 5):
        if code[offset] == 0xe8:
            target = 0x401000 + offset + 5 + int.from_bytes(code[offset + 1:offset + 5], "little", signed=True)
            if target in (0x41c7f8, 0x41c8d4):
                address = 0x401000 + offset
                print(f"CALLER {address:#x} -> {target:#x}")
                for instruction in decoder.disasm(bytes(native.emulator.mem_read(address - 48, 96)), address - 48):
                    print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")


def receiver_cases():
    native = LIFECYCLE["source_fixture"](IMAGE)
    team = BASE["GAME"] + 0xb98 + 0xe30
    result = []
    for unit_type, prefix, count in ((0, [43], 1), (8, [44], 3), (0, [], 0), (1, [1], 2),
                                     (6, [6], 1), (4, [], 255), (0, [0] * 799, 1)):
        native.emulator.mem_write(team, bytes(0xe30))
        queue = native.get(0x4f1880 + unit_type * 280 + 0xec)
        native.put(team + 0x14, 650)
        native.put(team + 0x18, 100)
        native.put(team + 0x108 + queue, count & 1, 1)
        native.put(team + 0x10c + queue, 7, 1)
        native.put(team + 0x110 + queue * 2, len(prefix), 2)
        if prefix:
            native.emulator.mem_write(team + 0x118 + queue * 800, bytes(prefix))
        native.run(0x438090, {UC_X86_REG_EAX: unit_type})
        cost = native.emulator.reg_read(UC_X86_REG_EAX)
        native.emulator.mem_write(0x701100, bytes([unit_type, 1, count, 0]))
        native.put(0x701000, 0x701100)
        native.run(0x41c7f8, {UC_X86_REG_EAX: BASE["GAME"], UC_X86_REG_EDX: 0x701000})
        length = native.get(team + 0x110 + queue * 2, 2)
        queued = list(native.emulator.mem_read(team + 0x118 + queue * 800, length))
        assert queued == prefix + [unit_type] * count
        assert native.get(team + 0x14) == 650
        assert native.get(team + 0x18) == 100 + count * cost
        assert native.get(team + 0x108 + queue, 1) == count & 1
        assert native.get(team + 0x10c + queue, 1) == 7
        result.append(dict(unitType=unit_type, queue=queue, cost=cost, prefix=prefix, count=count, fifo=queued,
                           cursor=native.get(0x701000) - 0x701100,
                           credits=native.get(team + 0x14), accounting=native.get(team + 0x18),
                           ready=native.get(team + 0x108 + queue, 1), delay=native.get(team + 0x10c + queue, 1)))
    return result


def transport_cases():
    native = LIFECYCLE["source_fixture"](IMAGE)
    game, transport, vtable = BASE["GAME"], 0x701a00, 0x701b00
    team = game + 0xb98 + 0xe30
    native.put(transport, vtable)
    native.put(vtable + 0x5c, 0x702000)
    emitted = []

    def output(machine):
        emulator = machine.emulator
        emitted.append(list(emulator.mem_read(emulator.reg_read(UC_X86_REG_EDX), emulator.reg_read(UC_X86_REG_EBX))))

    native.stubs[0x702000] = output
    for sequence in (0, 1, 15):
        native.put(transport + 4, sequence, 1)
        native.run(0x40c168, {UC_X86_REG_EAX: transport, UC_X86_REG_EDX: 1, UC_X86_REG_EBX: 0, UC_X86_REG_ECX: 1})
        assert emitted[-1] == [7, sequence << 4, 10, 0, 1, 1, 0]
        assert native.get(transport + 4, 1) == (sequence + 1) & 15
    native.put(team + 0x14, 650)
    native.put(team + 0x18, 100)
    native.put(team + 0x110, 0, 2)
    native.put(0x49d620, 1, 1)
    native.put(0x4793f0, game)
    native.run(0x40c168, {UC_X86_REG_EAX: transport, UC_X86_REG_EDX: 1, UC_X86_REG_EBX: 0, UC_X86_REG_ECX: 1})
    assert native.get(team + 0x110, 2) == 1
    assert native.get(team + 0x18) == 450 and native.get(team + 0x14) == 650
    native.put(team + 0x110, 0, 2)
    native.put(team + 0x18, 100)
    frames = bytes([5, 0, 10, 0, 1, 1, 0, 5, 0, 10, 8, 1, 2, 0])
    native.emulator.mem_write(0x701100, frames)
    native.put(game + 0x958, 0x701100)
    native.put(game + 0x95c, len(frames))
    native.run(0x41df68, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 0})
    assert native.emulator.reg_read(UC_X86_REG_EAX) == 0
    assert native.get(game + 0x95c) == 0
    assert native.get(team + 0x110, 2) == 3
    assert native.get(team + 0x18) == 1150
    assert list(native.emulator.mem_read(team + 0x118, 3)) == [0, 8, 8]
    return dict(emitted=emitted, localReceipt=dict(credits=650, accounting=450, count=1),
                framedSource=dict(bytes=list(frames), remainingBytes=0, fifo=[0, 8, 8], accounting=1150))


def decoder_cases():
    native = LIFECYCLE["source_fixture"](IMAGE)
    native.stubs.update({0x444f14: None, 0x437bc4: None})
    team = BASE["GAME"] + 0xb98 + 0xe30
    calls = []

    def observe(emulator, address, size, userdata):
        if address in (0x41c7f8, 0x41c8d4):
            cursor = native.get(emulator.reg_read(UC_X86_REG_EDX))
            calls.append(dict(callback=hex(address), payload=list(emulator.mem_read(cursor, 3))))

    native.emulator.hook_add(UC_HOOK_CODE, observe)
    cases = [
        ("unit", [10, 0, 1, 1, 0], 0),
        ("city-initializer-intercepted", [9, 3, 0, 1, 0], 0),
        ("sequence", [10, 0, 1, 1, 10, 8, 1, 2, 0], 0),
        ("zero-count", [10, 0, 1, 0, 0], 0),
        ("missing-terminator", [10, 0, 1, 1], -1),
        ("early-terminator", [0, 10, 0, 1, 1], -1),
        ("invalid-mode", [28, 0], -1),
        ("truncated-unit", [10, 0, 1], -1),
        ("empty", [], -1),
    ]
    result = []
    for label, stream, expected in cases:
        native.emulator.mem_write(team, bytes(0xe30))
        native.put(team + 0x14, 650)
        native.put(team + 0x18, 100)
        native.put(team + 0x108, 1, 1)
        native.emulator.mem_write(0x701100, bytes(stream) + bytes(16))
        calls.clear()
        native.run(0x41defc, {UC_X86_REG_EAX: BASE["GAME"], UC_X86_REG_EDX: 0x701100, UC_X86_REG_EBX: len(stream)})
        returned = native.emulator.reg_read(UC_X86_REG_EAX)
        assert returned == expected & 0xffffffff, (label, returned)
        count = native.get(team + 0x110, 2)
        result.append(dict(label=label, stream=stream, result=expected, callbacks=list(calls),
                           fifo=list(native.emulator.mem_read(team + 0x118, count)),
                           credits=native.get(team + 0x14), accounting=native.get(team + 0x18),
                           cityHealth=native.get(team + 0x3c + 3 * 4), cityLevel=native.get(team + 0xc4 + 3 * 4)))
    return result


def bounded_demand_cases(trace_path):
    demand = runpy.run_path(str(ROOT / "tools/research/ai-demand-20260919.py"))
    ai = demand["AI"]
    placement = runpy.run_path(str(ROOT / "tools/research/scenario-placement-20260919.py"))
    from types import SimpleNamespace
    placement = SimpleNamespace(**placement)
    results = []
    for golden in map(json.loads, Path(trace_path).read_text().splitlines()):
        faction, owner = golden["mission"][:-2], golden["team"]
        machine, _, _, _, _ = ai.source_fixture(faction, owner,
            lambda *args: ai.initialize_source_world(*args, placement))
        capture = next(entry for entry in golden["cases"] if entry["label"] == f"weighted-0-team-{owner}")
        game, policy = ai.NATIVE.GAME, ai.POLICY
        machine.mem_write(policy, base64.b64decode(capture["before"]["policy"]))
        machine.mem_write(game + 0x7d28, base64.b64decode(capture["before"]["entities"]))
        machine.mem_write(game + 0xb98, base64.b64decode(capture["before"]["teams"]))
        machine.mem_write(0x4e6d70, base64.b64decode(golden["inputs"]["dependencies"]))
        side = game + 0xb98 + owner * 0xe30
        race = ai.dword(machine, side + 0x20)
        ai.put(machine, side + 0x14, 1000)
        ai.put(machine, side + 0x18, 17)
        ai.put(machine, side + 0x2c, 50)
        ai.put(machine, side + 0x30, 50)
        for slot in range(15):
            ai.put(machine, side + 0x3c + slot * 4, 100 if slot < 2 else 0)
            ai.put(machine, side + 0xc4 + slot * 4, 0)
            machine.mem_write(side + 0x78 + slot, b"\0")
        machine.mem_write(side + 0x108, bytes([1, 1, 1, 1]))
        machine.mem_write(side + 0x10c, bytes(4 + 8 + 3200))
        for source in range(110):
            record = 0x4e6d70 + source * 52
            restricted = ai.dword(machine, record + 16) == 0 and ai.dword(machine, record + 20) >= 2
            machine.mem_write(side + 0xda4 + source, bytes([int(restricted)]))
        machine.mem_write(policy + 0x1faa, struct.pack("<h", 152))
        for slot, following in ((152, 153), (153, -1)):
            entity = game + 0x7d28 + slot * 220
            machine.mem_write(entity + 6, bytes([6 + race * 8, owner]))
            machine.mem_write(entity + 0xd2, struct.pack("<h", following))
        ai.put(machine, game + 0x528, 10)
        ai.put(machine, 0x4956e0 + owner * 48 + 24, 2)
        ai.put(machine, 0x479204, capture["before"]["rngCursor"])
        machine.mem_write(0x489510, bytes([capture["before"]["forceOrder"]]))
        packets = []

        def packet_hook(emulator, address, size, userdata):
            length = emulator.reg_read(ai.UC_X86_REG_EDX)
            packet = bytearray(emulator.mem_read(emulator.reg_read(ai.UC_X86_REG_EAX), length))
            struct.pack_into("<H", packet, 0, length)
            packets.append(packet.hex())
            stack = emulator.reg_read(ai.UC_X86_REG_ESP)
            emulator.reg_write(ai.UC_X86_REG_EIP, ai.dword(emulator, stack))
            emulator.reg_write(ai.UC_X86_REG_ESP, stack + 4)

        machine.hook_add(ai.UC_HOOK_CODE, packet_hook, begin=0x421648, end=0x421648)
        def snapshot():
            return {key: base64.b64encode(machine.mem_read(address, length)).decode()
                    for key, address, length in (("policy", policy, 0x6c40),
                      ("entities", game + 0x7d28, 800 * 220), ("teamBytes", side, 0xe30))}
        before = snapshot()
        for stage in ("demand", "pipeline"):
            machine.mem_write(policy, base64.b64decode(before["policy"]))
            machine.mem_write(game + 0x7d28, base64.b64decode(before["entities"]))
            machine.mem_write(side, base64.b64decode(before["teamBytes"]))
            packets.clear()
            if stage == "pipeline":
                if machine.mem_read(policy, 1)[0]:
                    ai.invoke(machine, 0x457568, eax=game, edx=owner, ebx=policy)
                machine.mem_write(policy, b"\0")
                ai.invoke(machine, 0x456ad0, eax=game, edx=owner, ebx=policy)
            ai.invoke(machine, 0x457940, eax=game, edx=policy, ebx=owner)
            assert packets == [bytes([7, 0, 10, race * 8, owner, 1, 0]).hex()], (faction, stage, packets)
            results.append(dict(label=f"{faction}02-source-separated-bounded-base-troop-{stage}", stage=stage, team=owner, race=race,
                                inputs=golden["inputs"], navigation=golden["navigation"], before=before, after=snapshot(),
                                population=2, populationLimit=10, forceOrder=capture["before"]["forceOrder"], packets=list(packets)))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--demand-trace", default="/tmp/dc-ai-demand-native-0919-f2.jsonl")
    options = parser.parse_args()
    if options.inspect:
        inspect()
    else:
        print(json.dumps(dict(sha256=BASE["EXE_HASH"], receivers=receiver_cases(), decoders=decoder_cases(),
                              transport=transport_cases(), demands=bounded_demand_cases(options.demand_trace))))