"""Read-only, hash-pinned DC.EXE transport evidence; requires Capstone 5."""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

from capstone import Cs, CS_ARCH_X86, CS_MODE_32


ROOT = Path(__file__).resolve().parents[2]
DIGEST = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"
ANCHORS = [
    (0x43E33C, "e80bacfdff", "abduct calls transport constructor"),
    (0x418FF2, "c68406130e000001", "reserve team transport entry"),
    (0x4190E5, "bb15000000", "transport task opcode 21"),
    (0x419121, "668911", "copy five packed payload words"),
    (0x419153, "66c742100000", "initialize task payload cursor to zero"),
    (0x419164, "66c7420e0000", "initialize task phase to zero"),
    (0x418B58, "81f9ff000000", "pickup marker high byte 255"),
    (0x418BDE, "3d00010000", "pickup Manhattan threshold 256"),
    (0x418C32, "e8e9d5ffff", "pickup calls noncombat removal"),
    (0x418C3B, "e808c10100", "pickup clears collision"),
    (0x41625E, "c6462c0a", "pickup status becomes 10"),
    (0x418C5E, "66c7460e0200", "pickup schedules departure phase"),
    (0x418D9D, "e892280000", "one delivery creation per invocation"),
    (0x418DB7, "66891446", "persist decremented group count"),
    (0x418DCB, "66894610", "advance group cursor"),
    (0x418DE3, "66c7460e0200", "all groups exhausted: departure"),
    (0x418AB8, "c68401a419000000", "release pooled carrier reservation"),
    (0x418AED, "bb3c000000", "post-departure idle count 60"),
    (0x41835B, "bb32000000", "arrival starts at vertical step 50"),
    (0x4184A5, "6683fa32", "departure completes at vertical step 50"),
    (0x411E7E, "fe4638", "task push increments stack top"),
    (0x412009, "fe4e38", "task pop decrements stack top"),
    (0x43E3BD, "e872d2fdff", "reinforce2 synchronous spawn call"),
    (0x419A4E, "f6804c09000007", "normal scan every eighth scheduler update"),
    (0x41BA2C, "c7867009000042000000", "initial update interval 66 milliseconds"),
    (0x41DC2A, "899170090000", "update interval is mutable"),
    (0x41E201, "e8eeb4ffff", "wall-clock catch-up calls game update"),
]


def load_image(path):
    image = path.read_bytes()
    digest = hashlib.sha256(image).hexdigest()
    if digest != DIGEST:
        raise ValueError(f"unrecognized executable SHA-256: {digest}")
    header = struct.unpack_from("<I", image, 0x3C)[0]
    count = struct.unpack_from("<H", image, header + 6)[0]
    optional_size = struct.unpack_from("<H", image, header + 20)[0]
    base = struct.unpack_from("<I", image, header + 52)[0]
    sections = []
    for index in range(count):
        offset = header + 24 + optional_size + 40 * index
        name = image[offset:offset + 8].rstrip(b"\0").decode("ascii")
        _, relative, size, raw = struct.unpack_from("<IIII", image, offset + 8)
        flags = struct.unpack_from("<I", image, offset + 36)[0]
        if not flags & 0x80:
            sections.append((name, base + relative, size, raw))

    def read(address, size):
        for _, start, length, raw in sections:
            if start <= address and address + size <= start + length:
                return image[raw + address - start:raw + address - start + size]
        raise ValueError(f"unmapped raw VA {address:#x}, size {size:#x}")

    return image, sections, read


def probe(image, sections):
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
    from unicorn.x86_const import (
        UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
        UC_X86_REG_EBP, UC_X86_REG_ESI, UC_X86_REG_ESP, UC_X86_REG_EIP,
    )

    game, task, stack, stop = 0x800000, 0x701000, 0x70E000, 0x70D000
    carrier_slot, target_slot = 7, 200
    carrier = game + 0x7D28 + 220 * carrier_slot
    target = game + 0x7D28 + 220 * target_slot

    def fixture():
        machine = Uc(UC_ARCH_X86, UC_MODE_32)
        machine.mem_map(0x400000, 0x200000)
        machine.mem_map(0x700000, 0x10000)
        machine.mem_map(game, 0x100000)
        machine.mem_map(0x900000, 0x100000)
        for _, address, length, raw in sections:
            machine.mem_write(address, image[raw:raw + length])
        machine.mem_write(carrier + 6, bytes((92, 8)))
        machine.mem_write(carrier + 0x2C, b"\x01")
        machine.mem_write(target + 6, bytes((69, 0)))
        machine.mem_write(target + 0x2C, b"\x01")
        return machine

    def word(machine, address):
        return struct.unpack("<H", machine.mem_read(address, 2))[0]

    def put_word(machine, address, value):
        machine.mem_write(address, struct.pack("<H", value & 65535))

    def invoke(machine, address, slot=carrier_slot):
        machine.mem_write(stack, struct.pack("<I", stop))
        for register, value in ((UC_X86_REG_EAX, game), (UC_X86_REG_EDX, slot),
                                (UC_X86_REG_EBX, task), (UC_X86_REG_ESP, stack)):
            machine.reg_write(register, value)
        machine.emu_start(address, stop, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == stop
        return machine.reg_read(UC_X86_REG_EAX)

    def boundary_hook(events):
        boundaries = {
            0x42630C: ("animation", 0), 0x434D48: ("collision-clear", 0),
            0x412388: ("move", 8), 0x4182E8: ("vertical", 12),
            0x412274: ("idle", 0), 0x41B634: ("spawn", 4),
            0x41B4A0: ("find-cell", 8),
        }

        def hook(machine, address, size, user_data):
            if address not in boundaries:
                return
            name, cleanup = boundaries[address]
            pointer = machine.reg_read(UC_X86_REG_ESP)
            registers = [machine.reg_read(register) for register in
                         (UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX)]
            events.append((name, registers))
            if name == "find-cell":
                machine.mem_write(registers[3], struct.pack("<I", 11))
                output = struct.unpack("<I", machine.mem_read(pointer + 4, 4))[0]
                machine.mem_write(output, struct.pack("<I", 10))
            destination = struct.unpack("<I", machine.mem_read(pointer, 4))[0]
            machine.reg_write(UC_X86_REG_ESP, pointer + 4 + cleanup)
            machine.reg_write(UC_X86_REG_EIP, destination)

        return hook

    for parser_entry, opcode in ((0x43EB74, 2), (0x43EC8B, 15)):
        machine = fixture()
        source = b"0 72 50 8 2 0 0 0 0 0 0\0"
        machine.mem_write(0x702000, source)
        machine.mem_write(0x70F000 - 0x30, struct.pack("<I", 0x702000))
        machine.mem_write(0x4FC44C, b"\xa5" * 28)
        machine.reg_write(UC_X86_REG_EBP, 0x70F000)
        machine.reg_write(UC_X86_REG_ESI, 0)
        machine.reg_write(UC_X86_REG_ESP, stack)
        machine.emu_start(parser_entry, 0x43E8B7, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43E8B7
        assert machine.mem_read(0x4FC44C, 1) == bytes((opcode,))
        assert machine.mem_read(0x4FC450, 13) == bytes((0, 72, 50, 8, 0, 0, 0, 0, 2, 0, 0, 0, 0))
        print(json.dumps({"native_parser_opcode": opcode, "shortened_source": source[:-1].decode(),
                          "fifth_type_count": [0, 0]}))

    for distance, entity_status in ((256, 1), (257, 1), (0, 0), (0, 10)):
        machine = fixture()
        events = []
        machine.hook_add(UC_HOOK_CODE, boundary_hook(events))
        machine.mem_write(task, struct.pack("<5H", 0xFF01, target_slot, 0, 0, 0))
        put_word(machine, task + 0x14, 0x1080)
        put_word(machine, task + 0x16, 0x1080)
        put_word(machine, target, 0x1080 + distance)
        put_word(machine, target + 4, 0x1080)
        machine.mem_write(target + 0x2C, bytes((entity_status,)))
        assert invoke(machine, 0x418A48) == 1
        assert word(machine, task + 0x10) == 1
        assert not events
        assert invoke(machine, 0x418A48) == 0
        names = [event[0] for event in events]
        if entity_status == 1 and distance <= 256:
            assert names == ["animation", "collision-clear", "vertical"], names
            assert machine.mem_read(target + 0x2C, 1) == b"\x0a"
            assert machine.mem_read(target + 0x39, 1) == b"\x0a"
            assert word(machine, target + 0x46) == 1
        elif entity_status == 1:
            assert names == ["move"], names
            assert word(machine, task + 0x10) == 1
            assert word(machine, task + 0x14) == 0x1080 + distance
        else:
            assert names == ["vertical"], names
        assert word(machine, task + 0x0E) == (1 if names == ["move"] else 2)
        assert machine.mem_read(target + 6, 2) == bytes((69, 0))
        assert not any(machine.mem_read(0x4956E0, 384))
        assert not any(machine.mem_read(0x495860, 0x3700))
        print(json.dumps({"pickup_distance": distance, "target_status": entity_status,
                          "events": names, "no_loss_counters": True}))

    for outbound, steps in ((0, 51), (1, 50)):
        machine = fixture()
        put_word(machine, task + 2, 6)
        put_word(machine, task + 4, 600)
        put_word(machine, task + 6, outbound)
        put_word(machine, task + 8, 0 if outbound else 50)
        put_word(machine, task + 10, -1)
        for invocation in range(1, steps + 1):
            invoke(machine, 0x4183B8)
            assert machine.mem_read(carrier + 0x38, 1) == (
                b"\xff" if invocation == steps else b"\x00")
        print(json.dumps({"vertical_outbound": outbound, "invocations_to_pop": steps,
                          "last_height": word(machine, carrier + 2)}))

    machine = fixture()
    events = []
    machine.hook_add(UC_HOOK_CODE, boundary_hook(events))
    machine.mem_write(game + 0x46F2C, struct.pack("<I", 0x900000))
    machine.mem_write(0x900804 + 10 * 4, struct.pack("<I", 0x910000))
    machine.mem_write(0x910000 + 10 * 4, struct.pack("<II", 0x3FF, 0x3FF))
    machine.mem_write(task, struct.pack("<5H", 2, (69 << 8) | 1, 0, 0, 0))
    for offset, value in ((10, 10), (12, 10), (18, 3), (20, 10 * 256 + 128),
                          (22, 10 * 256 + 128)):
        put_word(machine, task + offset, value)
    machine.mem_write(0x910000 + 10 * 4, struct.pack("<I", 0x3FE))
    invoke(machine, 0x418A48)
    assert [event[0] for event in events] == ["find-cell", "move"]
    assert word(machine, task) == 2 and word(machine, task + 16) == 0
    print(json.dumps({"blocked_delivery": "relocate", "count_unchanged": 2, "spawn_calls": 0}))
    machine.mem_write(0x910000 + 10 * 4, struct.pack("<I", 0x3FF))
    put_word(machine, task + 20, 10 * 256 + 128)
    for expected_type, expected_count, expected_cursor in ((0, 1, 0), (0, 0, 1), (69, 0, 5)):
        events.clear()
        invoke(machine, 0x418A48)
        spawns = [event for event in events if event[0] == "spawn"]
        assert len(spawns) == 1 and spawns[0][1][3] == expected_type, events
        assert word(machine, task) == expected_count
        assert word(machine, task + 16) == expected_cursor
    assert word(machine, task + 14) == 2
    assert events[-1][0] == "vertical"
    events.clear()
    machine.mem_write(game + 3 * 0xE30 + 0x19AB, b"\x01")
    put_word(machine, task + 18, 0)
    machine.mem_write(game + 0x19AB, b"\x01")
    invoke(machine, 0x418A48)
    assert [event[0] for event in events] == ["animation", "idle"]
    assert machine.mem_read(game + 0x19AB, 1) == b"\x00"
    assert machine.mem_read(game + 3 * 0xE30 + 0x19AB, 1) == b"\x01"
    assert machine.mem_read(carrier + 0x2C, 1) == b"\x01"
    print(json.dumps({"delivery_order": [0, 0, 69], "max_spawns_per_invocation": 1,
                      "departure_after_last_spawn": True, "release_then_idle": True}))

    for queued in (False, True):
        machine = fixture()
        events = []
        machine.hook_add(UC_HOOK_CODE, boundary_hook(events))
        machine.mem_write(task, b"\x0f")
        machine.mem_write(task + 4, bytes((3, 10, 10, 0, 69, 0, 0, 0, 2, 1, 0, 0, 0)))
        if queued:
            machine.mem_write(0x4796B4, struct.pack("<I", 1))
            machine.mem_write(0x4FE454, struct.pack("<III", 10, 10, 0))
        invoke(machine, 0x43D814, task)
        if queued:
            assert not events
            assert struct.unpack("<4I", machine.mem_read(0x4FE45C, 16)) == (3, 0, 0, 69)
        else:
            assert [event[0] for event in events] == ["spawn"] * 3
            assert [event[1][3] for event in events] == [0, 0, 69]
        print(json.dumps({"reinforce2_coordinate_queue": queued,
                          "immediate_spawn_calls": len(events), "type_order": [0, 0, 69]}))
    print("PASS isolated original-x86 transport probes; external boundaries stubbed, not full-game emulation")


def mission_evidence(executable):
    for faction in ("HUMAN", "ALIEN"):
        stem = executable.parent / "SCENARIO" / faction / f"{faction}01"
        for extension in (".TRO", ".SCN"):
            source = stem.with_suffix(extension)
            print(json.dumps({"source": str(source.relative_to(executable.parent)),
                              "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}))
        for line_number, line in enumerate(stem.with_suffix(".TRO").read_text().splitlines(), 1):
            fields = line.split()
            if fields and fields[0] in ("reinforce", "reinforce2", "abduct", "bail"):
                print(json.dumps({"mission": stem.name, "line": line_number, "source": line.strip()}))
        placements = []
        for line in stem.with_suffix(".SCN").read_text().splitlines():
            fields = line.split()
            if len(fields) == 6 and all(field.lstrip("-").isdigit() for field in fields):
                placements.append(list(map(int, fields)))
        registrations = [row for row in placements if row[2] == 37]
        print(json.dumps({"mission": stem.name, "type_37_coordinate_queue_placements": registrations}))
        if faction == "ALIEN":
            assert not registrations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=ROOT / "raw_cd/DC/DC.EXE")
    parser.add_argument("command", choices=("verify", "probe", "mission-evidence", "disasm", "refs", "words", "strings"))
    parser.add_argument("arguments", nargs="*")
    args = parser.parse_args()
    image, sections, read = load_image(args.exe)
    if args.command == "probe":
        probe(image, sections)
        return
    if args.command == "mission-evidence":
        mission_evidence(args.exe)
        return
    if args.command != "verify":
        subprocess.run([sys.executable, str(Path(__file__).with_name("trigger-audit.py")),
                        "--exe", str(args.exe), args.command, *args.arguments], check=True)
        return
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    for address, encoded, label in ANCHORS:
        expected = bytes.fromhex(encoded)
        actual = read(address, len(expected))
        if actual != expected:
            raise AssertionError((hex(address), label, actual.hex(), encoded))
        instructions = list(decoder.disasm(actual, address))
        if not instructions or sum(item.size for item in instructions) != len(actual):
            raise AssertionError(f"incomplete instruction anchor {address:#x}")
        print(f"{address:#010x} {label}: " + "; ".join(
            f"{item.mnemonic} {item.op_str}" for item in instructions))
    print(f"PASS {len(ANCHORS)} static instruction anchors; SHA256 {DIGEST}")


if __name__ == "__main__":
    main()