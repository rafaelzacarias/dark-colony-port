"""Hash-gated native CD audio audit. Requires Capstone 5 and Unicorn 2."""

import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from capstone.x86_const import X86_OP_IMM, X86_OP_MEM

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "cd_transport_loader", Path(__file__).with_name("transport-audit.py"))
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)


def imports(image, read):
    header = struct.unpack_from("<I", image, 0x3C)[0]
    base = struct.unpack_from("<I", image, header + 52)[0]
    relative = struct.unpack_from("<I", image, header + 24 + 104)[0]
    result = {}
    while relative:
        original, _, _, name, first = struct.unpack("<5I", read(base + relative, 20))
        if not name:
            break
        library = read(base + name, 64).split(b"\0")[0].decode("ascii")
        offset = 0
        while True:
            entry = struct.unpack("<I", read(base + (original or first) + offset, 4))[0]
            if not entry:
                break
            symbol = (f"ordinal:{entry & 65535}" if entry & 0x80000000 else
                      read(base + entry + 2, 100).split(b"\0")[0].decode("ascii"))
            result[base + first + offset] = f"{library}!{symbol}"
            offset += 4
        relative += 20
    return result


def probe(image, sections):
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
    from unicorn.x86_const import (
        UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_ESP, UC_X86_REG_EIP,
        UC_X86_REG_EBP, UC_X86_REG_ESI, UC_X86_REG_ECX,
    )

    stack, stop, api = 0x70F000, 0x700000, 0x700100

    def fixture(mode=0x20E, failure=0, disabled=0, ticks=0, fail_command=None):
        machine = Uc(UC_ARCH_X86, UC_MODE_32)
        machine.mem_map(0x400000, 0x200000)
        machine.mem_map(0x700000, 0x10000)
        machine.mem_map(0x800000, 0x100000)
        for _, address, length, raw in sections:
            machine.mem_write(address, image[raw:raw + length])

        def put(address, value):
            machine.mem_write(address, struct.pack("<I", value & 0xFFFFFFFF))

        def get(address):
            return struct.unpack("<I", machine.mem_read(address, 4))[0]

        put(0x470570, api)
        put(0x470590, api + 16)
        put(0x479628, 7)
        put(0x47962C, disabled)
        events = []

        def hook(emulator, address, size, user_data):
            if address == api + 16:
                pointer = emulator.reg_read(UC_X86_REG_ESP)
                emulator.reg_write(UC_X86_REG_EAX, ticks)
                emulator.reg_write(UC_X86_REG_ESP, pointer + 4)
                emulator.reg_write(UC_X86_REG_EIP, get(pointer))
                return
            if address != api:
                return
            pointer = emulator.reg_read(UC_X86_REG_ESP)
            device, command, flags, params = struct.unpack(
                "<4I", emulator.mem_read(pointer + 4, 16))
            event = {"command": hex(command), "device": device, "flags": hex(flags)}
            result = int(command == fail_command)
            if command == 0x803:
                event["type"] = bytes(emulator.mem_read(get(params + 8), 7)).split(b"\0")[0].decode()
                if not result:
                    put(params + 4, 7)
            elif command == 0x814:
                event["item"] = get(params + 8)
                put(params + 4, mode if event["item"] == 4 else 5)
                result = failure or result
            elif command == 0x80D:
                event["timeFormat"] = get(params + 4)
            elif command == 0x807:
                event["to"] = get(params + 4)
            elif command not in (0x804, 0x806, 0x808):
                raise AssertionError(event)
            events.append(event)
            emulator.reg_write(UC_X86_REG_EAX, result)
            emulator.reg_write(UC_X86_REG_ESP, pointer + 20)
            emulator.reg_write(UC_X86_REG_EIP, get(pointer))

        machine.hook_add(UC_HOOK_CODE, hook)

        def invoke(entry, argument=0, track=0, until=stop, registers=()):
            put(stack, stop)
            machine.reg_write(UC_X86_REG_EAX, argument)
            machine.reg_write(UC_X86_REG_EDX, track)
            machine.reg_write(UC_X86_REG_ESP, stack)
            for register, value in registers:
                machine.reg_write(register, value)
            machine.emu_start(entry, until, count=10000)
            assert machine.reg_read(UC_X86_REG_EIP) == until
            return machine.reg_read(UC_X86_REG_EAX)

        return invoke, events, put, get

    results = []
    for track in (2, 3, 4, 5):
        invoke, events, _, _ = fixture()
        returned = invoke(0x451888, 7, track)
        assert [event["command"] for event in events] == ["0x80d", "0x807", "0x806"]
        assert events[0]["timeFormat"] == 10
        assert events[1]["to"] == track
        assert events[2]["flags"] == "0x0"
        assert returned == track + 1
        results.append({"case": "track-parameter", "physicalTrack": track,
                        "returned": returned, "events": events})
    for mode, failure, recovery in ((0x20E, 0, False), (0x20D, 0, True),
                                    (0x212, 0, False), (0x20C, 0, False),
                                    (0x211, 0, False),
                                    (0x20E, 1, True)):
        invoke, events, _, _ = fixture(mode=mode, failure=failure)
        invoke(0x42F8B8)
        expected = ["0x814"] + (["0x804", "0x803", "0x80d", "0x807",
                                 "0x806", "0x80d", "0x806"] if recovery else [])
        assert [event["command"] for event in events] == expected, events
        if recovery:
            assert events[4]["to"] == 2
        results.append({"case": "poll", "mode": hex(mode), "error": failure, "events": events})
    for entry, expected in ((0x42F844, ["0x80d", "0x807", "0x806", "0x80d", "0x806"]),
                            (0x42F878, ["0x808"]),
                            (0x42F894, ["0x80d", "0x807", "0x806"])):
        invoke, events, _, _ = fixture()
        invoke(entry, 3)
        assert [event["command"] for event in events] == expected, events
        results.append({"case": "controller", "entry": hex(entry), "events": events})
        invoke, events, _, _ = fixture(disabled=1)
        invoke(entry, 3)
        assert not events
    invoke, events, _, _ = fixture(disabled=1)
    invoke(0x42F8B8)
    assert not events
    for command in (0x80D, 0x807, 0x806):
        invoke, events, _, _ = fixture(fail_command=command)
        assert invoke(0x451888, 7, 2) == 0
        expected = ["0x80d", "0x807", "0x806"]
        assert [event["command"] for event in events] == expected[:expected.index(hex(command)) + 1]
        results.append({"case": "wrapper-failure", "failedCommand": hex(command), "events": events})
    invoke, events, _, get = fixture(fail_command=0x803)
    invoke(0x42F7F0)
    assert get(0x479628) == 0xFFFFFFFF and get(0x47962C) == 1
    invoke(0x42F894)
    assert len(events) == 1
    results.append({"case": "open-failure-disables", "events": events})

    frame, source, interface, game = 0x70E000, 0x801000, 0x802000, 0x810000

    def lifecycle_fixture(**kwargs):
        invoke, events, put, get = fixture(**kwargs)
        invoke(0x42FAE9, source, until=0x42FB25)
        put(frame - 8, source)
        invoke(0x42C65E, until=0x42C6B8,
               registers=((UC_X86_REG_EBP, frame), (UC_X86_REG_EDX, interface)))
        targets = (0x42F7F0, 0x42F844, 0x42F878, 0x42F894, 0x42F8B8, 0x42F820)
        assert tuple(get(interface + 0xB8 + index * 4) for index in range(6)) == targets
        put(game + 0x7D18, interface)
        put(frame - 4, interface)
        return invoke, events, put, get

    for label, entry, until, registers, expected in (
        ("menu-open", 0x404BA4, 0x404BAD, ((UC_X86_REG_EBP, frame),), ["0x803"]),
        ("mission-start", 0x41EF44, 0x41EF55, ((UC_X86_REG_EDX, game),),
         ["0x80d", "0x807", "0x806"]),
        ("post-mission-loop-stop", 0x401A58, 0x401A60, ((UC_X86_REG_ECX, interface),), ["0x808"]),
    ):
        invoke, events, _, _ = lifecycle_fixture()
        invoke(entry, until=until, registers=registers)
        assert [event["command"] for event in events] == expected
        if label == "mission-start":
            assert events[1]["to"] == 2
        results.append({"case": label, "events": events})
    for choice in (0, 1, 12):
        invoke, events, put, _ = lifecycle_fixture()
        put(frame - 16, choice)
        invoke(0x404D42, until=0x404D53 if choice == 12 else 0x404D6C,
               registers=((UC_X86_REG_EBP, frame),))
        assert [event["command"] for event in events] == (["0x808"] if choice == 12 else [])
        results.append({"case": "menu-choice", "choice": choice, "events": events})
    for elapsed in (0, 4999, 5000, 5001, 12000):
        invoke, events, put, get = lifecycle_fixture(ticks=10000 + elapsed)
        put(0x4D199C, 10000)
        put(0x4D19A0, 10000)
        invoke(0x431EF6, until=0x431F30 if elapsed > 5000 else 0x431F3D,
               registers=((UC_X86_REG_EBP, frame), (UC_X86_REG_ESI, game)))
        assert [event["command"] for event in events] == (["0x814"] if elapsed > 5000 else [])
        assert get(0x4D199C) == (10000 + elapsed if elapsed > 5000 else 10000)
        results.append({"case": "poll-timing", "elapsedMs": elapsed,
                        "lastPoll": get(0x4D199C), "events": events})
    return results


def static_evidence(image, sections, read):
    imported = imports(image, read)
    assert imported[0x470570] == "WINMM.dll!mciSendCommandA"
    assert imported[0x470590] == "WINMM.dll!timeGetTime"
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.detail = True
    decoder.skipdata = True
    api_calls, interface_calls, clock_references = [], [], []
    unused_track_helpers = []
    for name, start, length, raw in sections:
        if name != "AUTO":
            continue
        for instruction in decoder.disasm(image[raw:raw + length], start):
            if not instruction.id:
                continue
            for operand in instruction.operands:
                if operand.type == X86_OP_MEM:
                    if instruction.mnemonic == "call" and operand.mem.disp == 0x470570:
                        api_calls.append(hex(instruction.address))
                    if instruction.mnemonic == "call" and operand.mem.disp in range(0xB8, 0xD0, 4):
                        interface_calls.append([hex(instruction.address), hex(operand.mem.disp)])
                    if operand.mem.disp == 0x4D199C:
                        clock_references.append(hex(instruction.address))
                elif operand.type == X86_OP_IMM and operand.imm in (0x45150C, 0x4515F8):
                    unused_track_helpers.append(hex(instruction.address))
    assert interface_calls == [["0x401a5a", "0xc0"], ["0x404ba7", "0xb8"],
                               ["0x404d4d", "0xc0"], ["0x41ef4f", "0xc4"],
                               ["0x431f2a", "0xc8"]]
    assert clock_references == ["0x431efb", "0x431f17"]
    assert not unused_track_helpers
    return {"mciImport": "0x470570", "clockImport": "0x470590",
            "mciApiCalls": api_calls, "cdInterfaceCalls": interface_calls,
            "lastPollDirectReferences": clock_references,
            "nextPreviousImmediateReferences": unused_track_helpers,
            "scanScope": "Capstone linear AUTO scan; not exhaustive indirect control-flow analysis"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=ROOT / "raw_cd/DC/DC.EXE")
    parser.add_argument("--disasm", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--xref", nargs="*", type=lambda value: int(value, 0))
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    image, sections, read = NATIVE.load_image(args.exe)
    print(json.dumps({"sha256": NATIVE.DIGEST, "exe": str(args.exe)}))
    if args.probe:
        evidence = static_evidence(image, sections, read)
        results = probe(image, sections)
        print(json.dumps({"staticEvidence": evidence, "caseCount": len(results),
                          "additionalDisabledGateAssertions": 4, "probes": results}, indent=2))
        return
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.skipdata = True
    decoder.detail = True
    if args.disasm:
        start, end = args.disasm
        for instruction in decoder.disasm(read(start, end - start), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
        return
    imported = imports(image, read)
    selected = {address: name for address, name in imported.items()
                if any(token in name.lower() for token in ("mci", "timeget", "timer"))}
    print(json.dumps({hex(address): name for address, name in selected.items()}))
    targets = args.xref if args.xref is not None else selected
    for name, start, length, raw in sections:
        if name != "AUTO":
            continue
        for instruction in decoder.disasm(image[raw:raw + length], start):
            if instruction.id and any(
                (operand.type == X86_OP_IMM and operand.imm in targets) or
                (operand.type == X86_OP_MEM and operand.mem.disp in targets)
                for operand in instruction.operands
            ):
                print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    main()