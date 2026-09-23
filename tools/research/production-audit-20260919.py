"""Bounded production probes against the hash-pinned original executable."""

import argparse
import hashlib
import json
from pathlib import Path
import runpy
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
    UC_X86_REG_EIP, UC_X86_REG_ESP, UC_X86_REG_EBP, UC_X86_REG_EDI,
)


ROOT = Path(__file__).resolve().parents[2]
EXE_HASH = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"
GAME = 0x800000
STACK = 0x70F000
STOP = 0x70FF00
AUX = 0x702000


class Native:
    def __init__(self, image):
        self.image = image
        self.emulator = Uc(UC_ARCH_X86, UC_MODE_32)
        self.emulator.mem_map(0x400000, 0x200000)
        self.emulator.mem_map(0x700000, 0x10000)
        self.emulator.mem_map(GAME, 0x60000)
        header = struct.unpack_from("<I", image, 0x3C)[0]
        count = struct.unpack_from("<H", image, header + 6)[0]
        optional = struct.unpack_from("<H", image, header + 20)[0]
        base = struct.unpack_from("<I", image, header + 52)[0]
        for index in range(count):
            offset = header + 24 + optional + index * 40
            _, relative, size, raw = struct.unpack_from("<IIII", image, offset + 8)
            flags = struct.unpack_from("<I", image, offset + 36)[0]
            if not flags & 0x80:
                self.emulator.mem_write(base + relative, image[raw:raw + size])
        self.stubs = {}
        self.stub_cleanup = {}
        self.calls = []
        self.emulator.hook_add(UC_HOOK_CODE, self.hook)

    def put(self, address, value, size=4):
        self.emulator.mem_write(address, int(value & ((1 << (size * 8)) - 1)).to_bytes(size, "little"))

    def get(self, address, size=4):
        return int.from_bytes(self.emulator.mem_read(address, size), "little")

    def hook(self, emulator, address, size, _):
        if address in self.stubs:
            self.calls.append(hex(address))
            callback = self.stubs[address]
            if callback:
                callback(self)
            stack = emulator.reg_read(UC_X86_REG_ESP)
            emulator.reg_write(UC_X86_REG_EIP, self.get(stack))
            emulator.reg_write(UC_X86_REG_ESP, stack + 4 + self.stub_cleanup.get(address, 0))

    def run(self, start, registers, end=STOP):
        self.put(STACK, STOP)
        self.emulator.reg_write(UC_X86_REG_ESP, STACK)
        for register, value in registers.items():
            self.emulator.reg_write(register, value)
        try:
            self.emulator.emu_start(start, end, count=200000)
        except Exception as error:
            position = self.emulator.reg_read(UC_X86_REG_EIP)
            raise RuntimeError(f"native entry {start:#x} stopped at {position:#x}; stubs={self.calls}") from error
        assert self.emulator.reg_read(UC_X86_REG_EIP) == end


def initialization_probe(image):
    native = Native(image)
    team, slot, unit_type = 1, 3, 20
    native_id = team * 15 + slot
    entity = GAME + 0x7D28 + native_id * 220
    native.put(entity + 6, unit_type, 1)
    native.put(entity + 7, team, 1)
    native.put(GAME + 0x7D1C, team)
    native.put(AUX, 99, 2)
    native.stubs = {
        0x411DD8: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, AUX),
        0x437BC4: None,
    }
    native.run(0x41822C, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: native_id})
    phase = native.get(AUX, 2)
    busy = native.get(GAME + team * 0xE30 + 0xC10 + slot, 1)
    assert (phase, busy) == (0, 1)
    return {"team": team, "slot": slot, "nativeId": native_id,
            "phase": phase, "busy": busy, "stubCalls": native.calls}


def completion_probes(image):
    results = []
    fixtures = [
        (0, 0, 0, 3, (5, 0, 0)),
        (0, 0, 0, 4, (1, 1, 1)),
        (0, 0, 1, 4, (0, 1, 1)),
        (1, 2, 1, 4, (1, 1, 1)),
        (2, 1, 1, 4, (2, 1, 1)),
        (2, 2, 1, 4, (3, 0, 1)),
        (3, 2, 1, 4, (3, 1, 1)),
        (4, 2, 1, 4, (4, 1, 0)),
        (5, 1, 1, 4, (5, 1, 1)),
        (5, 2, 1, 4, (5, 0, 0)),
    ]
    for phase, animation, latch, clock, expected in fixtures:
        native = Native(image)
        team, slot, unit_type = 1, 3, 20
        native_id = team * 15 + slot
        entity = GAME + 0x7D28 + native_id * 220
        team_base = GAME + team * 0xE30
        native.put(entity + 6, unit_type, 1)
        native.put(entity + 7, team, 1)
        native.put(entity + 0x1A, animation, 1)
        native.put(entity + 0xC, 1600)
        native.put(GAME + 0x7D1C, team)
        native.put(GAME + 0x94C, clock)
        native.put(team_base + 0xC10 + slot, 1, 1)
        native.put(team_base + 0x19AA, latch, 1)
        native.put(AUX, phase, 2)
        native.put(0x4F1918 + unit_type * 280, 0x703000)
        native.stubs = {0x437BC4: None, 0x418504: None, 0x412014: None}
        native.stub_cleanup = {0x418504: 4}
        native.run(0x4187E4, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: native_id,
                                UC_X86_REG_EBX: AUX})
        actual = (native.get(AUX, 2), native.get(team_base + 0xC10 + slot, 1),
                  native.get(team_base + 0x19AA, 1))
        assert actual == expected, (phase, animation, latch, actual, expected)
        assert native.get(entity + 0xC) == 1600
        results.append({"inputPhaseAnimationLatchClock": [phase, animation, latch, clock],
                        "outputPhaseBusyLatch": actual, "stubCalls": native.calls})
    return results


def timer_to_completion_probes(image):
    results = []
    for delays in ([1, 1], [2, 3], [7, 4, 2]):
        native = Native(image)
        team, slot, unit_type = 1, 3, 20
        native_id = team * 15 + slot
        entity = GAME + 0x7D28 + native_id * 220
        team_base = GAME + team * 0xE30
        bank, animation, frames = 0x703000, 0x704000, 0x705000
        native.put(entity + 6, unit_type, 1)
        native.put(entity + 7, team, 1)
        native.put(entity + 0x14, bank)
        native.put(entity + 0x18, 0, 1)
        native.put(entity + 0x19, delays[0], 1)
        native.put(entity + 0x1A, 1, 1)
        native.put(bank, animation)
        native.put(animation + 0x20, frames)
        native.put(animation + 0x28, len(delays))
        for index, delay in enumerate(delays):
            native.put(frames + index * 72 + 2, delay, 1)
        native.put(GAME + 0x7D1C, team)
        native.put(team_base + 0xC10 + slot, 1, 1)
        native.put(team_base + 0x19AA, 1, 1)
        native.put(AUX, 2, 2)
        native.stubs = {0x437BC4: None, 0x418504: None, 0x412014: None}
        native.stub_cleanup = {0x418504: 4}
        updates = 0
        trace = []
        while native.get(team_base + 0xC10 + slot, 1):
            updates += 1
            assert updates <= 100
            native.run(0x4264C8, {UC_X86_REG_EAX: entity + 0x14, UC_X86_REG_EDX: 0})
            native.run(0x4187E4, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: native_id,
                                    UC_X86_REG_EBX: AUX})
            trace.append([updates, native.get(entity + 0x18, 1), native.get(entity + 0x19, 1),
                          native.get(entity + 0x1A, 1), native.get(AUX, 2),
                          native.get(team_base + 0xC10 + slot, 1)])
        assert updates == sum(delays) + 1, (delays, updates)
        assert native.get(AUX, 2) == 3
        assert native.get(team_base + 0x19AA, 1) == 1
        results.append({"syntheticFrameDelays": delays, "updatesToBusyClear": updates,
                        "traceUpdateFrameDelayAnimationPhaseBusy": trace,
                        "stubCalls": native.calls})
    return results


def source_probe(image):
    source = runpy.run_path(str(ROOT / "tools/research/balance-audit.py"))["audit"](ROOT / "raw_cd/DC")
    native = Native(image)
    frame = 0x70F800
    for row in source["dependencies"]:
        text = " ".join(map(str, row["rawTokens"][1:])).encode("ascii") + b"\0"
        native.emulator.mem_write(0x701000, text)
        native.put(frame - 0x10, 0x701000)
        native.run(0x4379F3, {UC_X86_REG_EBP: frame, UC_X86_REG_EDI: row["id"]}, 0x437BA4)
        record = 0x4E6D70 + row["id"] * 52
        assert native.get(record + 8) == row["cost"]
        assert [native.get(record + 32 + index * 4) for index in range(len(row["prerequisites"]))] == row["prerequisites"]
        native.put(record, 1, 1)
    dependency_bytes = bytes(native.emulator.mem_read(0x4E6D70, 110 * 52))
    native.put(frame - 4, 0x702000)
    native.run(0x43BBC5, {UC_X86_REG_EBP: frame}, 0x43BCCC)
    stack = native.emulator.reg_read(UC_X86_REG_ESP)
    offsets = [native.get(stack + 8 + index * 4) - 0x702000 for index in range(33)]
    offsets = [offset if 0 <= offset < 280 else None for offset in offsets]
    assert offsets[21] == 0xEC and offsets[23] == 0xF0
    costs = []
    for row in source["dependencies"]:
        native.run(0x438074, {UC_X86_REG_EAX: row["id"]})
        assert native.emulator.reg_read(UC_X86_REG_EAX) == row["cost"]
        costs.append({"id": row["id"], "kind": row["kind"], "cost": row["cost"],
                      "interfaceId": row["interfaceId"], "metadata": row["metadata"],
                      "prerequisites": row["prerequisites"]})
    producers = []
    for row in source["dependencies"]:
        if row["kind"] == 1:
            unit = source["units"][row["metadata"][1]]
            producers.append({"dependency": row["id"], "unitType": unit["index"],
                              "sprite": unit["sprite"], "queue": int(unit["rawTokens"][21]),
                              "exitSelector": int(unit["rawTokens"][23])})
    slots = []
    for slot in range(15):
        native.run(0x41AE6C, {UC_X86_REG_EAX: slot})
        slots.append({"slot": slot, "queue": native.emulator.reg_read(UC_X86_REG_EAX),
                      "humanLevel0Type": native.get(0x47AFA8 + slot * 4),
                      "humanLevel1Type": native.get(0x47AFA8 + 60 + slot * 4),
                      "alienLevel0Type": native.get(0x47AFA8 + 120 + slot * 4),
                      "alienLevel1Type": native.get(0x47AFA8 + 180 + slot * 4)})
    assert [entry["queue"] for entry in slots[:6]] == [2, 0, 1, 4, 3, 4]
    return source, dependency_bytes, {"sourceHashes": source["sha256"], "nativeCosts": costs,
                                      "unitScannerOffsetsByToken": offsets,
                                      "sourceUnitQueues": producers, "nativeSlots": slots}


def eligibility_probes(image, dependencies):
    results = []
    for health, busy, restricted, expected in (
        (0, 0, 0, (1, 2, 2)), (4800, 0, 0, (0, 1, 2)),
        (4800, 1, 0, (0, 2, 2)), (4800, 0, 1, (0, 2, 2)),
    ):
        native = Native(image)
        native.emulator.mem_write(0x4E6D70, dependencies)
        team = GAME + 0xE30
        native.put(GAME + 0x7D1C, 1)
        native.put(team + 0xBD4, health)
        native.put(team + 0xC10, busy, 1)
        native.put(team + 0x193C + 7, restricted, 1)
        native.run(0x437BC4, {UC_X86_REG_EAX: GAME})
        actual = tuple(native.get(0x4E6D74 + identifier * 52) for identifier in (0, 7, 9))
        assert actual == expected, (health, busy, restricted, actual)
        results.append({"exoHealthBusyRestrictUnit7": [health, busy, restricted],
                        "statesDependency0_7_9": actual})
    return results


def enqueue_probe(image, dependencies):
    native = Native(image)
    native.emulator.mem_write(0x4E6D70, dependencies)
    team, unit_type, queue = 1, 0, 0
    team_base = GAME + team * 0xE30
    native.put(0x4F196C + unit_type * 280, queue)
    native.put(team_base + 0xBAC, 777)
    native.put(team_base + 0xBB0, 100)
    native.put(team_base + 0xCA8 + queue * 2, 1, 2)
    native.put(team_base + 0xCB0 + queue * 800, 43, 1)
    native.emulator.mem_write(0x701100, bytes([unit_type, team, 3]))
    native.put(0x701000, 0x701100)
    native.run(0x41C7F8, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
    queued = list(native.emulator.mem_read(team_base + 0xCB0, 4))
    assert queued == [43, 0, 0, 0]
    assert native.get(team_base + 0xCA8, 2) == 4
    assert native.get(team_base + 0xBAC) == 777
    assert native.get(team_base + 0xBB0) == 1150
    return {"seededQueueSelector": queue, "fifo": queued, "count": 4,
            "creditsUnchanged": 777, "accountingBefore": 100, "accountingAfter": 1150,
            "costPerUnit": 350, "appendedCount": 3}


def unit_completion_probes(image):
    results = []
    for animation_state in (1, 2):
        native = Native(image)
        team, slot, queue = 1, 1, 0
        native_id = team * 15 + slot
        entity = GAME + 0x7D28 + native_id * 220
        team_base = GAME + 0xB98 + team * 0xE30
        native.put(entity + 6, 17, 1)
        native.put(entity + 7, team, 1)
        native.put(entity + 0x1A, 1, 1)
        native.put(entity + 0x2A, animation_state, 1)
        native.put(team_base + 0x110 + queue * 2, 2, 2)
        native.put(team_base + 0x118 + queue * 800, 0, 1)
        native.put(team_base + 0x119 + queue * 800, 43, 1)
        native.put(0x4F1970, 0)
        native.put(team_base + 0x2C, 50)
        native.put(team_base + 0x30, 50)
        spawned = []
        def spawn(machine):
            emulator = machine.emulator
            stack = emulator.reg_read(UC_X86_REG_ESP)
            spawned.append({"type": emulator.reg_read(UC_X86_REG_ECX),
                            "x": emulator.reg_read(UC_X86_REG_EDX),
                            "y": emulator.reg_read(UC_X86_REG_EBX),
                            "team": machine.get(stack + 4)})
        def copy_fifo(machine):
            emulator = machine.emulator
            destination = emulator.reg_read(UC_X86_REG_EAX)
            source = emulator.reg_read(UC_X86_REG_EDX)
            count = emulator.reg_read(UC_X86_REG_EBX)
            assert count == 2
            emulator.mem_write(destination, bytes(emulator.mem_read(source, count)))
        native.stubs = {0x41B750: spawn, 0x43AFDE: copy_fifo}
        native.stub_cleanup = {0x41B750: 8}
        native.run(0x414314, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: native_id,
                                UC_X86_REG_EBX: entity})
        count = native.get(team_base + 0x110, 2)
        head = native.get(team_base + 0x118, 1)
        ready = native.get(team_base + 0x108, 1)
        assert (count, head, ready) == ((2, 0, 0) if animation_state == 1 else (1, 43, 1))
        assert len(spawned) == (0 if animation_state == 1 else 1)
        results.append({"animationState": animation_state, "count": count, "head": head,
                        "ready": ready, "spawnBoundary": spawned, "stubCalls": native.calls})
    return results


def ui_credit_probes(image, source, dependencies):
    results = []
    fixtures = [
        (9, 4, 0, 349, (0, 349)), (9, 4, 0, 350, (1, 0)),
        (9, 4, 49, 350, (50, 0)), (9, 4, 50, 350, (50, 350)),
        (9, 5, 1, 0, (0, 350)), (9, 5, 0, 0, (0, 0)),
        (2, 4, 0, 2000, (1, 0)), (2, 4, 1, 2000, (1, 2000)),
        (30, 4, 1, 1000, (1, 1000)),
    ]
    for identifier, event, pending, credits, expected in fixtures:
        native = Native(image)
        native.emulator.mem_write(0x4E6D70, dependencies)
        native.put(0x4E6D74 + identifier * 52, 1)
        row = next(row for row in source["dependencies"] if row["id"] == identifier)
        native.put(GAME + 0x7D1C, 1)
        native.put(GAME + 0xE30 + 0xBAC, credits)
        ui = 0x703000
        native.put(ui + 0xC, GAME)
        native.put(ui + 0x7F4, 0x704000)
        output = [pending]
        def input_event(machine):
            machine.put(machine.emulator.reg_read(UC_X86_REG_EBX), row["interfaceId"])
            machine.emulator.reg_write(UC_X86_REG_EAX, event)
        def set_count(machine):
            output[0] = machine.emulator.reg_read(UC_X86_REG_EBX)
        native.stubs = {
            0x4240DC: input_event,
            0x42776C: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, pending),
            0x4277FC: set_count,
        }
        native.run(0x433124, {UC_X86_REG_EAX: ui})
        actual = (output[0], native.get(GAME + 0xE30 + 0xBAC))
        assert actual == expected, (identifier, event, pending, credits, actual)
        results.append({"dependency": identifier, "event": event, "before": [pending, credits],
                        "after": actual})
    return results


def dispatch_probes(image, dependencies):
    results = []
    for identifier, expected in ((2, [9, 3, 0, 1, 0]), (9, [10, 0, 1, 3, 0]),
                                 (30, [12, 0, 8, 1, 1, 0])):
        native = Native(image)
        native.emulator.mem_write(0x4E6D70, dependencies)
        for index in range(110):
            native.put(0x4E6D74 + index * 52, 1 if index == identifier else 2)
        packets, cleared = [], []
        def capture(machine):
            emulator = machine.emulator
            packet = emulator.reg_read(UC_X86_REG_EAX)
            size = emulator.reg_read(UC_X86_REG_EDX)
            packets.append(list(emulator.mem_read(packet + 2, size - 2)))
        def clear_count(machine):
            cleared.append(machine.emulator.reg_read(UC_X86_REG_EBX))
        native.stubs = {
            0x42776C: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 3),
            0x4277FC: clear_count,
            0x421648: capture,
        }
        native.run(0x437F3C, {UC_X86_REG_EAX: 0x703000, UC_X86_REG_EDX: 0x704000,
                                UC_X86_REG_EBX: 1})
        assert packets == [expected], (identifier, packets)
        assert cleared == [0]
        results.append({"dependency": identifier, "payloadFromByte2": packets[0], "clearedPending": 0})
    return results


def building_command_probes(image, source, dependencies):
    results = []
    maximum = source["units"][20]["health"]
    for health in (0, maximum - 1, maximum):
        native = Native(image)
        native.emulator.mem_write(0x4E6D70, dependencies)
        team, slot = 1, 3
        team_base = GAME + team * 0xE30
        native.put(GAME + 0x7D1C, team)
        native.put(0x4F18C4 + 20 * 280, maximum)
        native.put(team_base + 0xBD4 + slot * 4, health)
        native.put(team_base + 0xBAC, 777)
        native.put(team_base + 0xBB0, 100)
        native.emulator.mem_write(0x701100, bytes([slot, 0, team]))
        native.put(0x701000, 0x701100)
        native.stubs = {0x444F14: None, 0x437BC4: None}
        native.run(0x41C8D4, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
        credits, accounting = native.get(team_base + 0xBAC), native.get(team_base + 0xBB0)
        assert (credits, accounting) == ((2777, 100) if health == maximum else (777, 2100))
        assert native.get(team_base + 0xBD4 + slot * 4) == maximum
        assert ("0x444f14" in native.calls) == (health != maximum)
        results.append({"dependency": 2, "inputHealth": health, "targetHealth": maximum,
                        "credits": credits, "accounting": accounting, "stubCalls": native.calls})
    return results


def upgrade_command_probes(image):
    results = []
    for selector, current, requested in ((0, 0, 1), (0, 1, 1), (1, 0, 2), (1, 2, 2)):
        native = Native(image)
        team, unit_type = 1, 8
        team_base = GAME + team * 0xE30
        upgrade = (0x4F18B0 if selector == 0 else 0x4F18B8) + unit_type * 280 + team
        native.put(GAME + 0x7D1C, team)
        native.put(upgrade, current, 1)
        native.put(team_base + 0xBAC, 777)
        native.put(team_base + 0xBB0, 100)
        native.emulator.mem_write(0x701100, bytes([selector, unit_type, requested, team]))
        native.put(0x701000, 0x701100)
        native.stubs = {0x437BC4: None}
        native.run(0x41CA04, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
        credits, accounting = native.get(team_base + 0xBAC), native.get(team_base + 0xBB0)
        cost = requested * 1000
        assert (credits, accounting) == ((777 + cost, 100) if current == requested else (777, 100 + cost))
        assert native.get(upgrade, 1) == requested
        results.append({"selector": selector, "current": current, "requested": requested,
                        "credits": credits, "accounting": accounting})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--references", help="Literal Capstone operand substring")
    args = parser.parse_args()
    image = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
    assert hashlib.sha256(image).hexdigest() == EXE_HASH, "unrecognized executable"
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.skipdata = True
    if args.disassemble:
        start, end = args.disassemble
        native = Native(image)
        for instruction in decoder.disasm(bytes(native.emulator.mem_read(start, end - start)), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
    elif args.references:
        for instruction in decoder.disasm(image[0x400:0x70000], 0x401000):
            if args.references in instruction.op_str:
                print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
    else:
        source, dependencies, tables = source_probe(image)
        print(json.dumps({"sha256": EXE_HASH, "initialization": initialization_probe(image),
                          "completion": completion_probes(image),
                          "timerToCompletion": timer_to_completion_probes(image),
                          "tables": tables, "eligibility": eligibility_probes(image, dependencies),
                          "enqueue": enqueue_probe(image, dependencies),
                          "unitCompletion": unit_completion_probes(image),
                          "uiCredits": ui_credit_probes(image, source, dependencies),
                          "dispatch": dispatch_probes(image, dependencies),
                          "buildingCommands": building_command_probes(image, source, dependencies),
                          "upgradeCommands": upgrade_command_probes(image)}, indent=2))


if __name__ == "__main__":
    main()