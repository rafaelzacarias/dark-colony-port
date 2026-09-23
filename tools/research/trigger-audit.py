"""Read-only DC.EXE string/xref/disassembly probe; requires Capstone 5."""

import argparse
import hashlib
import json
from pathlib import Path
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_32


def integer(value):
    return int(value, 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=Path(__file__).resolve().parents[2] / "raw_cd/DC/DC.EXE")
    commands = parser.add_subparsers(dest="command", required=True)
    strings = commands.add_parser("strings")
    strings.add_argument("terms", nargs="+")
    refs = commands.add_parser("refs")
    refs.add_argument("addresses", type=integer, nargs="+")
    disasm = commands.add_parser("disasm")
    disasm.add_argument("start", type=integer)
    disasm.add_argument("end", type=integer)
    words = commands.add_parser("words")
    words.add_argument("start", type=integer)
    words.add_argument("count", type=integer)
    commands.add_parser("imports")
    commands.add_parser("verify")
    commands.add_parser("stat-probe", help="Execute statistic VM handlers with Unicorn and distinct table sentinels")
    commands.add_parser("primitive-probe", help="Execute original newtype and victim-loss instructions with Unicorn")
    commands.add_parser("mission-evidence", help="Report mission MTG regions and objective-related SCN placements")
    args = parser.parse_args()
    image = args.exe.read_bytes()
    digest = hashlib.sha256(image).hexdigest()
    if digest != "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b":
        raise ValueError(f"unrecognized executable SHA-256: {digest}")
    pe = struct.unpack_from("<I", image, 0x3C)[0]
    count = struct.unpack_from("<H", image, pe + 6)[0]
    optional_size = struct.unpack_from("<H", image, pe + 20)[0]
    base = struct.unpack_from("<I", image, pe + 52)[0]
    sections = []
    for index in range(count):
        offset = pe + 24 + optional_size + 40 * index
        name = image[offset:offset + 8].rstrip(b"\0").decode("ascii")
        _, rva, size, raw = struct.unpack_from("<IIII", image, offset + 8)
        flags = struct.unpack_from("<I", image, offset + 36)[0]
        if not flags & 0x80:
            sections.append((name, base + rva, size, raw))

    def slice_va(start, size):
        for _, address, length, raw in sections:
            if address <= start and start + size <= address + length:
                offset = raw + start - address
                return image[offset:offset + size]
        raise ValueError(f"VA outside raw sections: {start:#x}, size {size:#x}")

    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.skipdata = True
    print(f"SHA256 {digest}")
    if args.command == "stat-probe":
        from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EDX, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP

        for arguments, stop, expected in [
            ((4, 3), 0x43D25B, 5300),
            ((1, 0, 82), 0x43D289, 2082),
            ((0, 1, 82), 0x43D289, 1182),
        ]:
            machine = Uc(UC_ARCH_X86, UC_MODE_32)
            machine.mem_map(0x400000, 0x200000)
            machine.mem_map(0x700000, 0x10000)
            for _, address, length, raw in sections:
                machine.mem_write(address, image[raw:raw + length])
            for team in range(8):
                for selector in range(12):
                    machine.mem_write(0x4956E0 + 48 * team + 4 * selector,
                                      struct.pack("<I", (team + 1) * 1000 + selector * 100))
                for unit_type in range(110):
                    for selector in range(4):
                        machine.mem_write(0x495860 + 1760 * team + 16 * unit_type + 4 * selector,
                                          struct.pack("<I", (team + 1) * 1000 + selector * 100 + unit_type))
            source = f"s({','.join(map(str, arguments))})"
            machine.mem_write(0x701000, source.encode("ascii") + b"\0")
            machine.mem_write(0x700000, struct.pack("<II", 0x702000, 0x701000))
            machine.mem_write(0x70E000, struct.pack("<I", 0x70D000))
            machine.reg_write(UC_X86_REG_EAX, 0x700000)
            machine.reg_write(UC_X86_REG_EDX, 0x700004)
            machine.reg_write(UC_X86_REG_ESP, 0x70E000)
            machine.emu_start(0x43C96C, 0x70D000, count=100000)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x70D000
            code_end = struct.unpack("<I", machine.mem_read(0x700000, 4))[0]
            assert 0x702000 < code_end < 0x702100
            bytecode = bytes(machine.mem_read(0x702000, code_end - 0x702000))
            machine.mem_write(0x70F000 - 0x20, struct.pack("<I", 0x702000))
            machine.reg_write(UC_X86_REG_ESI, 0x708000)
            machine.reg_write(UC_X86_REG_EBP, 0x70F000)
            machine.reg_write(UC_X86_REG_ESP, 0x70E000)
            machine.emu_start(0x43CF53, stop, count=1000)
            assert machine.reg_read(UC_X86_REG_EIP) == stop
            actual = struct.unpack("<h", machine.mem_read(0x708000, 2))[0]
            assert actual == expected, (arguments, actual, expected)
            assert machine.reg_read(UC_X86_REG_ESI) == 0x708002
            print(json.dumps({"source": source, "original_parser_bytecode": bytecode.hex(), "result": actual,
                              "native_team": arguments[0], "native_selector": arguments[1]}))
        print("PASS original x86 statistic VM: s(team, selector[, type])")
    elif args.command == "primitive-probe":
        from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP

        def machine_for_probe():
            machine = Uc(UC_ARCH_X86, UC_MODE_32)
            machine.mem_map(0x400000, 0x200000)
            machine.mem_map(0x700000, 0x10000)
            machine.mem_map(0x800000, 0x50000)
            for _, address, length, raw in sections:
                machine.mem_write(address, image[raw:raw + length])
            machine.reg_write(UC_X86_REG_EBP, 0x70F000)
            machine.reg_write(UC_X86_REG_ESP, 0x70E000)
            return machine

        for label, target_x, expected_slot in [("inactive-first", 54, 152), ("last-slot", 54, 799), ("no-match", 53, None)]:
            machine = machine_for_probe()
            entities = bytearray(800 * 220)
            for slot in (0, 152, 799):
                offset = slot * 220
                entities[offset:offset + 2] = struct.pack("<H", (54 << 8) | 255)
                entities[offset + 4:offset + 6] = struct.pack("<H", 17 << 8)
                entities[offset + 6] = 1 if slot == 0 or (slot == 152 and label == "last-slot") else 95
                entities[offset + 7] = 1
                entities[offset + 12] = 123
            machine.mem_write(0x4F18E0 + 280, b"\x01")
            machine.mem_write(0x807D28, bytes(entities))
            machine.mem_write(0x709004, bytes((target_x, 17, 84)))
            machine.reg_write(UC_X86_REG_ESI, 0x709000)
            machine.reg_write(UC_X86_REG_EDI, 0x800000)

            def stop_at_action_boundary(emulator, address, size, user_data):
                if address in (0x43D822, 0x43E4BE):
                    emulator.emu_stop()

            machine.hook_add(UC_HOOK_CODE, stop_at_action_boundary)
            machine.emu_start(0x43E0FE, 0, count=100000)
            assert machine.reg_read(UC_X86_REG_EIP) in (0x43D822, 0x43E4BE)
            if expected_slot is not None:
                entities[expected_slot * 220 + 6] = 84
            assert machine.mem_read(0x807D28, len(entities)) == entities
            print(json.dumps({"original_newtype": label, "changed_slot": expected_slot, "team_and_all_other_bytes_unchanged": True}))

        for team, unit_type in ((4, 8), (1, 82)):
            machine = machine_for_probe()
            machine.mem_write(0x807D28 + 152 * 220 + 6, bytes((unit_type, team)))
            machine.reg_write(UC_X86_REG_EAX, 152 * 220)
            machine.reg_write(UC_X86_REG_ESI, 0x800000)
            machine.emu_start(0x441B0F, 0x441B45, count=1000)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x441B45
            aggregate = struct.unpack("<I", machine.mem_read(0x4956E0 + 48 * team + 12, 4))[0]
            per_type = struct.unpack("<I", machine.mem_read(0x495860 + 1760 * team + 16 * unit_type, 4))[0]
            assert aggregate == per_type == 1
            assert machine.mem_read(0x807D28 + 152 * 220 + 6, 2) == bytes((unit_type, team))
            print(json.dumps({"original_loss_writes": {f"{team},3": aggregate, f"{team},0,{unit_type}": per_type}, "ownership_unchanged": True}))
        print("PASS original x86 newtype and victim-loss primitives (not a full game execution)")
    elif args.command == "mission-evidence":
        for faction in ("HUMAN", "ALIEN"):
            stem = args.exe.parent / "SCENARIO" / faction / f"{faction}01"
            mtg = stem.with_suffix(".MTG").read_bytes()
            width, height = mtg[:2]
            assert len(mtg) == 2 + width * height
            regions = {}
            for source_y in range(height):
                for source_x in range(width):
                    tag = mtg[2 + source_y * width + source_x] & 63
                    if tag:
                        regions.setdefault(tag, []).append((source_x, height - 1 - source_y))
            print(json.dumps({"mission": stem.name, "mtg_sha256": hashlib.sha256(mtg).hexdigest(), "dimensions": [width, height]}))
            for tag, cells in sorted(regions.items()):
                print(json.dumps({"trip_id": tag, "cells": len(cells), "runtime_bounds": [min(cell[0] for cell in cells), min(cell[1] for cell in cells), max(cell[0] for cell in cells), max(cell[1] for cell in cells)]}))
            placements = []
            for line in stem.with_suffix(".SCN").read_text().splitlines():
                fields = line.split()
                if len(fields) == 6 and all(field.lstrip("-").isdigit() for field in fields):
                    values = list(map(int, fields))
                    if values[5] not in (0, 1):
                        continue
                    if (faction == "HUMAN" and (values[2] == 95 or values[3] == 4)) or (faction == "ALIEN" and values[2] == 82):
                        placements.append(values)
                        print(json.dumps({"scn_placement": values}))
            if faction == "HUMAN":
                assert sum(values[3] == 4 for values in placements) == 3
                assert sum(values[2] == 95 for values in placements) == 2
            else:
                assert len(placements) == 11 and all(values[3] == 1 for values in placements)
        print("PASS mission MTG dimensions and objective placement counts")
    elif args.command == "strings":
        for term in args.terms:
            needle = term.encode("ascii")
            for name, address, length, raw in sections:
                offset = raw
                while (offset := image.find(needle, offset, raw + length)) >= 0:
                    stop = image.find(b"\0", offset, min(offset + 160, raw + length))
                    print(f"{address + offset - raw:#010x} file={offset:#x} {name} {image[offset:stop if stop >= 0 else offset + len(needle)]!r}")
                    offset += len(needle)
    elif args.command == "refs":
        targets = set(args.addresses)
        for name, address, length, raw in sections:
            if name not in (".text", "CODE", "AUTO"):
                continue
            for insn in decoder.disasm(image[raw:raw + length], address):
                if any(f"0x{target:x}" in insn.op_str for target in targets):
                    print(f"{insn.address:#010x}: {insn.mnemonic:8s} {insn.op_str}")
        for target in targets:
            needle = struct.pack("<I", target)
            for name, address, length, raw in sections:
                offset = raw
                while (offset := image.find(needle, offset, raw + length)) >= 0:
                    print(f"raw-ref {target:#x} at {address + offset - raw:#010x} ({name})")
                    offset += 4
    elif args.command == "disasm":
        for insn in decoder.disasm(slice_va(args.start, args.end - args.start), args.start):
            print(f"{insn.address:#010x}: {insn.bytes.hex():20s} {insn.mnemonic:8s} {insn.op_str}")
    elif args.command == "words":
        values = struct.unpack(f"<{args.count}I", slice_va(args.start, args.count * 4))
        for index, value in enumerate(values):
            print(f"{args.start + 4 * index:#010x}: {value:#010x} ({value})")
    elif args.command == "imports":
        descriptor = base + struct.unpack_from("<I", image, pe + 24 + 104)[0]

        def string_va(address):
            result = bytearray()
            while (value := slice_va(address + len(result), 1)) != b"\0":
                result.extend(value)
            return result.decode("ascii")

        while True:
            original, _, _, name, first = struct.unpack("<5I", slice_va(descriptor, 20))
            if not name:
                break
            index = 0
            while (entry := struct.unpack("<I", slice_va(base + (original or first) + 4 * index, 4))[0]):
                symbol = f"ordinal:{entry & 0xFFFF}" if entry & 0x80000000 else string_va(base + entry + 2)
                print(f"{base + first + 4 * index:#010x} {string_va(base + name)}!{symbol}")
                index += 1
            descriptor += 20
    else:
        checks = [
            (0x43E746, "898848bc4f00", "norm mode field"),
            (0x43E779, "c78048bc4f0001000000", "trip mode field"),
            (0x43E878, "889050bc4f00", "header lives byte"),
            (0x43E508, "81ff80000000", "128-entry normal scan"),
            (0x43E501, "fe8950bc4f00", "normal post-action lives decrement"),
            (0x43E56C, "fe8950bc4f00", "trip post-action lives decrement"),
            (0x43D9C2, "888250bc4f00", "setlifes writes same byte"),
            (0x43D1E0, "8a872f7d0000", "S entity team byte"),
            (0x43D573, "8b802c050000", "c cycle counter field"),
            (0x43D57C, "c1f804668946fe", "c shift then word truncation"),
            (0x43D227, "668b8487d40b0000", "b reads team slot low word"),
            (0x43D252, "e8e1d2fdff", "s two-argument statistic reader"),
            (0x43D280, "e8abd3fdff", "s three-argument statistic reader"),
            (0x43D47C, "09df", "eager bitwise OR"),
            (0x43D49D, "21cf", "eager bitwise AND"),
            (0x43FA0C, "89b164c44f00", "action links to previous action"),
            (0x43FB7D, "89b054bc4f00", "trigger starts at last action"),
            (0x43D96C, "c687a971040001", "bail sets pending flag"),
            (0x43D978, "0510270000", "bail clock delta 10000"),
            (0x43E121, "8a4606884206", "newtype changes type byte only"),
            (0x415DF5, "66812200fc", "flying destination reservation preserves MTG tag"),
            (0x415E43, "0938", "ground destination reservation precedes trip"),
            (0x415E60, "668b10c1fa0a", "trip extracts destination word upper six bits"),
            (0x415E6E, "e8bd860200", "reserved destination invokes trip dispatcher"),
            (0x415E8B, "66894a04", "path cursor changes only after trip dispatch"),
            (0x43D238, "0fbf46fe", "aggregate selector is last source argument"),
            (0x43D242, "0fbf56fe", "aggregate team is first source argument"),
            (0x43D266, "0fbf46fe0fbf56fc", "per-type selector second and team first"),
            (0x441A7D, "85d20f8f5c010000", "positive remaining HP bypasses loss path"),
            (0x441B19, "b803000000", "victim aggregate loss selector three"),
            (0x441B1E, "8a972f7d0000", "aggregate loss charged to victim team"),
            (0x441B29, "e85e82fdff", "increment victim aggregate loss"),
            (0x441B32, "31c0", "victim per-type loss selector zero"),
            (0x441B34, "8a9f2e7d00008a972f7d0000", "loss uses victim type and team"),
            (0x441B40, "e83b83fdff", "increment victim per-type loss"),
            (0x45391F, "c1e00a668945f8", "MTG byte shifted ten and truncated to word"),
            (0x453995, "29d801d28b8486000c0000", "MTG source row mapped to reversed runtime row"),
            (0x4539A5, "668910", "MTG tag word stored in flying grid"),
            (0x43E117, "803cc5e0184f0000", "newtype requires zero movement-class byte"),
            (0x415C9D, "803cc5e0184f0000", "same movement-class byte selects ground collision"),
            (0x415CB0, "8b849004080000", "zero movement class checks ground destination grid"),
            (0x415CF3, "8b8482040c0000", "nonzero movement class checks flying destination grid"),
        ]
        for address, expected, label in checks:
            actual = slice_va(address, len(bytes.fromhex(expected))).hex()
            if actual != expected:
                raise AssertionError(f"{label} at {address:#x}: {actual} != {expected}")
            print(json.dumps({"va": hex(address), "bytes": actual, "check": label}))
        for faction in ("HUMAN", "ALIEN"):
            for extension in ("TRO", "SCN", "TXT"):
                path = args.exe.parent / "SCENARIO" / faction / f"{faction}01.{extension}"
                content = path.read_bytes()
                print(json.dumps({"source": str(path.relative_to(args.exe.parent)), "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}))
        print(f"PASS {len(checks)} instruction anchors and 6 source fingerprints")


if __name__ == "__main__":
    main()