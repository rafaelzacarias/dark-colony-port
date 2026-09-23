"""Read-only, hash-pinned native palette audit; requires Capstone 5."""

import argparse
import hashlib
import json
from pathlib import Path
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_32


ROOT = Path(__file__).resolve().parents[2]
DIGEST = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"


def load_image(path):
    image = path.read_bytes()
    if hashlib.sha256(image).hexdigest() != DIGEST:
        raise ValueError("Unrecognized DC.EXE SHA-256")
    header = struct.unpack_from("<I", image, 0x3C)[0]
    count = struct.unpack_from("<H", image, header + 6)[0]
    optional_size = struct.unpack_from("<H", image, header + 20)[0]
    base = struct.unpack_from("<I", image, header + 52)[0]
    sections = []
    for index in range(count):
        offset = header + 24 + optional_size + 40 * index
        _, relative, size, raw = struct.unpack_from("<IIII", image, offset + 8)
        flags = struct.unpack_from("<I", image, offset + 36)[0]
        if not flags & 0x80:
            sections.append((base + relative, image[raw:raw + size]))
    return sections


def read_at(sections, address, size):
    for start, data in sections:
        if start <= address and address + size <= start + len(data):
            return data[address - start:address - start + size]
    raise ValueError(f"Unmapped VA {address:#x}")


def probe(sections):
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
    from unicorn.x86_const import (
        UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
        UC_X86_REG_EDX, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
    )

    machine = Uc(UC_ARCH_X86, UC_MODE_32)
    machine.mem_map(0x400000, 0x200000)
    machine.mem_map(0x700000, 0x100000)
    for address, data in sections:
        machine.mem_write(address, data)
    palette_object, palette_data = 0x700000, 0x701000
    remap, frame, stack, stop = 0x720000, 0x760000, 0x770000, 0x780000

    def put(address, value):
        machine.mem_write(address, struct.pack("<I", value))

    def execute(start, end):
        machine.emu_start(start, end, count=1000)
        assert machine.reg_read(UC_X86_REG_EIP) == end, hex(start)

    put(palette_object + 0x14, palette_data)
    source = (ROOT / "raw_cd/DC/PALETTE.RGB").read_bytes()
    machine.mem_write(palette_data + 0xF01, source)
    for packed in range(32768):
        red, green, blue = (packed >> 10) * 8 + 7, ((packed >> 5) & 31) * 8 + 3, (packed & 31) * 8 + 1
        machine.mem_write(stack, struct.pack("<5I", stop, red, green, blue, 0))
        machine.reg_write(UC_X86_REG_ESP, stack)
        machine.reg_write(UC_X86_REG_EAX, palette_object)
        execute(0x42BB98, stop)
        assert machine.reg_read(UC_X86_REG_EAX) & 255 == source[packed]
    print("PASS native RGB quantizer: all 32768 cells with nonzero discarded low bits")

    index_map = bytes(255 - index for index in range(256))
    machine.mem_write(palette_data + 0x601, index_map)
    machine.reg_write(UC_X86_REG_ECX, palette_data)
    execute_start, execute_end = 0x44F098, 0x44F0C5
    machine.emu_start(execute_start, execute_end, count=500000)
    assert machine.reg_read(UC_X86_REG_EIP) == execute_end
    assert bytes(machine.mem_read(palette_data + 0xF01, 32768)) == bytes(index_map[value] for value in source)
    print("PASS native RGB post-load translation: all 32768 output indices")

    machine.reg_write(UC_X86_REG_EBP, frame)
    for brightness in range(32):
        machine.mem_write(0x47966C, bytes((brightness,)))
        for variant in range(256):
            put(frame - 0xC, variant)
            machine.reg_write(UC_X86_REG_EAX, 0)
            machine.reg_write(UC_X86_REG_ESI, 0)
            execute(0x436094, 0x4360AB)
            assert machine.reg_read(UC_X86_REG_EDX) & 255 == brightness * 8 + (variant & 7)
    print("PASS native queue selector: 8192 brightness/variant combinations")

    team_table, entity = 0x7A0000, 0x790000
    put(frame - 0x10, team_table)
    put(frame - 0xC, entity)
    selectors = (3, 5, 0, 7, 1, 6, 4, 2)
    for team, selector in enumerate(selectors):
        put(team_table + team * 0xE30 + 0xC98, selector)
    for owner in range(8):
        for override in range(9):
            machine.mem_write(entity + 7, bytes((owner, override)))
            execute(0x439909, 0x439931)
            expected_team = owner if override == 8 else override
            assert machine.reg_read(UC_X86_REG_EDI) == selectors[expected_team]
    print("PASS native entity selector: 72 owner/override/team-table combinations")

    machine.reg_write(UC_X86_REG_ESP, stack)
    put(stack, stop)
    machine.reg_write(UC_X86_REG_EAX, palette_object)
    machine.emu_start(0x45024C, stop, count=3000)
    assert machine.reg_read(UC_X86_REG_EIP) == stop
    assert bytes(machine.mem_read(palette_data + 0x601, 256)) == bytes(range(256))
    machine.reg_write(UC_X86_REG_EBP, frame)
    put(frame - 0x18, palette_data + 1)
    machine.mem_write(palette_data + 1, bytes([17]) * 768)
    machine.reg_write(UC_X86_REG_ECX, 256)
    execute(0x44E9F2, 0x44EA1A)
    expected_palette = bytes(3) + bytes([17]) * 762 + bytes([255]) * 3
    assert bytes(machine.mem_read(palette_data + 1, 768)) == expected_palette
    print("PASS native identity index installation and GIF black/white endpoint override")

    colors = bytes((index * 17 + channel * 73) & 255 for index in range(256) for channel in range(3))
    machine.mem_write(palette_data + 1, colors)
    special = read_at(sections, 0x47BF86 + 138, 6)
    assert list(special) == [47, 61, 65, 66, 67, 254]
    for brightness in (0, 8, 16, 31):
        for variant in range(8):
            for source_index in range(256):
                put(frame - 0xC, source_index)
                put(frame - 0x10, variant)
                put(frame - 4, 0)
                machine.reg_write(UC_X86_REG_ECX, palette_object)
                machine.reg_write(UC_X86_REG_EBX, brightness)
                execute(0x44F525, 0x44F4CC)
                selected = source_index
                reserved = 138 <= source_index < 144
                if reserved:
                    selected = special[source_index - 138] if variant == 5 else source_index - (7 - variant) * 6
                original = list(colors[selected * 3:selected * 3 + 3])
                weighted = (3 * original[0] + 6 * original[1] + original[2]) * variant
                mixed = original if reserved else [(10 * channel * (11 - variant) + weighted) // 110 for channel in original]
                expected_main = [min(255, channel * brightness // 16) for channel in mixed]
                expected_alternate = [min(255, channel * brightness // 16) for channel in original]
                actual = list(struct.unpack("<6I", machine.mem_read(frame - 0x4C, 24)))
                assert actual == expected_main + expected_alternate, (brightness, variant, source_index, actual)
    print("PASS native bank 0/2 generator channels: 8192 brightness/variant/index cases")

    put(0x4891FC, remap)
    for brightness in range(32):
        for variant in range(8):
            for source_index in (0, 138, 143, 255):
                put(frame - 0xC, source_index)
                put(frame - 0x10, variant)
                machine.reg_write(UC_X86_REG_EBX, brightness)
                execute(0x44F4CC, 0x44F4E3)
                actual = machine.reg_read(UC_X86_REG_EDX) + machine.reg_read(UC_X86_REG_EAX)
                assert actual == remap + brightness * 2048 + variant * 256 + source_index
    print("PASS native RMP generator addresses: 1024 boundary cases")

    source_rmp = (ROOT / "raw_cd/DC/PALETTE.RMP").read_bytes()
    machine.mem_write(remap, source_rmp)
    machine.reg_write(UC_X86_REG_ESI, palette_object)
    for bank in range(3):
        for row in range(256):
            machine.mem_write(frame + 2, bytes((row,)))
            for source_index in range(256):
                machine.mem_write(palette_object + 0x1D, bytes((source_index,)))
                machine.reg_write(UC_X86_REG_EAX, remap + bank * 65536)
                execute(0x45E760, 0x45E768)
                assert machine.reg_read(UC_X86_REG_EBX) & 255 == source_rmp[bank * 65536 + row * 256 + source_index]
    print("PASS native indexed pixel read: all 196608 source RMP bytes across three aligned banks")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=ROOT / "raw_cd/DC/DC.EXE")
    parser.add_argument("--disasm", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--probe", action="store_true", help="Execute native lookup instructions with Unicorn 2")
    args = parser.parse_args()
    sections = load_image(args.exe)
    print(f"SHA256 {DIGEST}")
    if args.probe:
        probe(sections)
        return
    if args.disasm:
        start, end = args.disasm
        decoder = Cs(CS_ARCH_X86, CS_MODE_32)
        for instruction in decoder.disasm(read_at(sections, start, end - start), start):
            print(f"{instruction.address:#010x}: {instruction.bytes.hex():22} "
                  f"{instruction.mnemonic:8} {instruction.op_str}")
        return
    for extension, size in (("RGB", 32768), ("RMP", 196608)):
        paths = sorted((ROOT / "raw_cd/DC").rglob(f"*.{extension}"))
        if not paths:
            raise ValueError(f"No {extension} source tables")
        for path in paths:
            data = path.read_bytes()
            print(json.dumps({"file": str(path.relative_to(ROOT)), "bytes": len(data),
                              "supported_layout": len(data) == size,
                              "sha256": hashlib.sha256(data).hexdigest()}))


if __name__ == "__main__":
    main()