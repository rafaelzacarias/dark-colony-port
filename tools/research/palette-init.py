"""Hash-pinned, read-only DC.EXE palette initialization investigation."""

import argparse
from collections import deque
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_32


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("palette_audit", Path(__file__).with_name("palette-audit.py"))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def probe(sections):
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
    from unicorn.x86_const import (
        UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
        UC_X86_REG_EDX, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
    )

    machine = Uc(UC_ARCH_X86, UC_MODE_32)
    machine.mem_map(0x400000, 0x200000)
    machine.mem_map(0x700000, 0x200000)
    for address, data in sections:
        machine.mem_write(address, data)
    frame, game, entity, palette_object, palette_data = 0x710000, 0x720000, 0x730000, 0x740000, 0x750000

    def put(address, value):
        machine.mem_write(address, struct.pack("<I", value & 0xFFFFFFFF))

    def execute(start, end, count=10000):
        machine.emu_start(start, end, count=count)
        assert machine.reg_read(UC_X86_REG_EIP) == end, hex(start)

    machine.reg_write(UC_X86_REG_EBP, frame)
    for team in range(8):
        put(frame - 0xC, team)
        machine.reg_write(UC_X86_REG_EDI, game + 0xB98 + team * 0xE30)
        for color in (-2147483648, -1, *range(9), 2147483647):
            machine.reg_write(UC_X86_REG_EAX, color & 0xFFFFFFFF)
            execute(0x41BE65, 0x41BE7D)
            actual = struct.unpack("<I", machine.mem_read(game + team * 0xE30 + 0xC98, 4))[0]
            assert actual == (color if 0 <= color <= 7 else team)
    selectors = (2, 7, 0, 6, 3, 1, 5, 4)
    for team, selector in enumerate(selectors):
        put(game + team * 0xE30 + 0xC98, selector)
    put(frame - 0x10, game)
    put(frame - 0xC, entity)
    for owner in range(256):
        for override in range(256):
            machine.mem_write(entity + 7, bytes((owner, override)))
            execute(0x439909, 0x439931)
            selected = (owner if override == 8 else override) & 7
            assert machine.reg_read(UC_X86_REG_EDI) == selectors[selected]
    print("PASS SCN signed selector fallback and all 65536 owner/override byte combinations")

    machine.reg_write(UC_X86_REG_EBX, 123)
    execute(0x43628E, 0x436298)
    execute(0x4362A4, 0x4362AA)
    assert struct.unpack("<I", machine.mem_read(0x47966C, 4))[0] == 16
    print("PASS FIN frame initialization explicitly resets queue brightness to 16")

    put(palette_object + 0x14, palette_data)
    gif = (ROOT / "raw_cd/DC/DESERT.GIF").read_bytes()
    colors = bytes(3) + gif[16:778] + bytes((255, 255, 255))
    machine.mem_write(palette_data + 1, colors)
    machine.reg_write(UC_X86_REG_ESI, palette_data + 1)
    machine.reg_write(UC_X86_REG_EDI, palette_data + 0x301)
    machine.reg_write(UC_X86_REG_ECX, 768)
    machine.reg_write(UC_X86_REG_ESP, frame)
    execute(0x42BD21, 0x42BD31)
    assert bytes(machine.mem_read(palette_data + 0x301, 768)) == colors
    machine.reg_write(UC_X86_REG_EAX, palette_object)
    machine.reg_write(UC_X86_REG_ESP, frame)
    execute(0x42F370, 0x42F3EE)
    assert bytes(machine.mem_read(palette_data + 0x601, 256)) == bytes(range(256))
    output = bytes(machine.mem_read(machine.reg_read(UC_X86_REG_EBP) - 0x400, 1024))
    expected = b"".join(colors[index:index + 3] + bytes((4,)) for index in range(0, 768, 3))
    assert output == expected
    print("PASS DESERT DirectDraw palette: identity indices, unchanged RGB8, flag byte 4 (not alpha)")

    machine.reg_write(UC_X86_REG_EBP, frame)
    execute(0x453A56, 0x453ABB, count=400000)
    expected = bytes(((end * pixel + start * (31 - pixel)) // 31) << 3
                     for start in range(17) for end in range(17) for pixel in range(32))
    assert bytes(machine.mem_read(0x51462C, len(expected))) == expected
    assert expected[(16 * 17 + 16) * 32: (16 * 17 + 17) * 32] == bytes((128,)) * 32
    print("PASS all 9248 terrain interpolation bytes; uniform visible brightness is 16")

    for phase in (0, 1):
        put(game + 0x53C, phase)
        machine.reg_write(UC_X86_REG_ESI, game)
        execute(0x41BCD0, 0x41BCE8)
        assert struct.unpack("<I", machine.mem_read(game + 0x540, 4))[0] == phase * 256
    for blend in range(257):
        machine.reg_write(UC_X86_REG_EDX, blend)
        execute(0x40AC75, 0x40AC8D)
        variant = 7 * blend // 256
        assert machine.reg_read(UC_X86_REG_EDX) == variant
    for variant in range(8):
        machine.reg_write(UC_X86_REG_ESI, variant)
        execute(0x453BCE, 0x453C35)
        assert bytes(machine.mem_read(0x51462C, len(expected))) == bytes(value | variant for value in expected)
    print("PASS both SCN phase endpoints, all 257 day/night variants, all terrain low-bit installations")

    put(frame - 4, game)
    put(game + 0x534, 6750)
    put(game + 0x538, 75)
    for phase in (0, 1):
        for elapsed in (*range(77), 6749, 6750, 6751):
            put(game + 0x530, elapsed)
            put(game + 0x53C, phase)
            put(game + 0x540, phase * 256)
            execute(0x419990, 0x419A28)
            next_phase = 1 - phase if elapsed > 6750 else phase
            next_elapsed = 0 if elapsed > 6750 else elapsed
            fraction = next_elapsed * 256 // 75
            wanted = (fraction if next_phase else 256 - fraction) if next_elapsed <= 75 else phase * 256
            assert struct.unpack("<I", machine.mem_read(game + 0x53C, 4))[0] == next_phase
            assert struct.unpack("<I", machine.mem_read(game + 0x530, 4))[0] == next_elapsed
            assert struct.unpack("<I", machine.mem_read(game + 0x540, 4))[0] == wanted
    print("PASS native day/night transition endpoints, plateau retention and strict cycle rollover")

    put(frame + 0x56, 0x760000)
    put(0x760000, 0x761000)
    put(frame + 0x72, 0)
    put(frame + 0x3A, 0x40000000)
    put(frame + 0x4A, 10)
    for ignore_fog in (0, 1):
        machine.mem_write(frame + 0x8E, bytes((ignore_fog,)))
        for flags in (0, 0x40000000, 0x80000000, 0xC0000000):
            put(0x761000, flags)
            machine.reg_write(UC_X86_REG_EAX, 0)
            machine.reg_write(UC_X86_REG_EDX, 0)
            execute(0x453CEF, 0x453D02)
            machine.reg_write(UC_X86_REG_EAX, 0)
            machine.reg_write(UC_X86_REG_ESI, 0)
            execute(0x453D44, 0x453D85)
            actual = struct.unpack("<I", machine.mem_read(frame + 0x5A, 4))[0]
            wanted = 16 if ignore_fog else (16 if flags & 0x40000000 else 10) if flags & 0x80000000 else 0
            assert actual == wanted, (flags, ignore_fog, actual, wanted)
    print("PASS visible=16, remembered=10, unexplored=0 and ignore-fog visibility samples")

    background, light, destination, remap, stop = 0x770000, 0x771000, 0x772000, 0x780000, 0x7C0000
    rmp = (ROOT / "raw_cd/DC/DESERT.RMP").read_bytes()
    pixels = bytes(range(256)) * 4
    machine.mem_write(background, pixels)
    machine.mem_write(remap, rmp)
    background_entry = struct.unpack("<I", AUDIT.read_at(sections, 0x47C040, 4))[0]
    for address, value in (
        (0x4891EC, background), (0x4891F0, light), (0x4891F8, destination),
        (0x4891F4, 0x773000),
        (0x4891FC, remap), (0x489200, 32), (0x489204, 32), (0x489214, 4),
    ):
        put(address, value)
    for row in (0, 80, 128, 135):
        machine.mem_write(light, bytes((row,)) * 1024)
        machine.mem_write(destination, bytes((0xEE,)) * 1024)
        machine.reg_write(UC_X86_REG_ESP, frame)
        put(frame, stop)
        execute(background_entry, stop, count=100000)
        actual = bytes(machine.mem_read(destination, 1024))
        assert actual == bytes(rmp[row * 256 + value] for value in pixels)
    print("PASS 4096 native DESERT background pixels, including opaque source zero and unmodified source indices")

    machine.mem_write(background, bytes((0, 138, 143)))
    for selector in range(8):
        row = 128 + selector
        offset = 2 * 65536 + row * 256
        machine.mem_write(destination, bytes((0xEE,)) * 5)
        machine.reg_write(UC_X86_REG_ESP, frame)
        put(frame, stop)
        machine.reg_write(UC_X86_REG_EAX, remap + offset)
        machine.reg_write(UC_X86_REG_ESI, background)
        machine.reg_write(UC_X86_REG_EDI, destination + 3)
        execute(0x4658B9, stop)
        assert bytes(machine.mem_read(destination, 5)) == bytes((0xEE, rmp[offset + 143], rmp[offset + 138], rmp[offset], 0xEE))
    print("PASS native FIN bank-2 literal writes for all selectors: source zero writes, no SPR RGB translation")


def contract():
    resources = []
    for relative in ("DESERT.GIF", "DESERT.RGB", "DESERT.RMP", "SCENARIO/DESERT.BTS",
                     "SCENARIO/HUMAN/HUMAN01.SCN", "SCENARIO/ALIEN/ALIEN01.SCN"):
        path = ROOT / "raw_cd/DC" / relative
        data = path.read_bytes()
        resources.append({"path": str(path.relative_to(ROOT)), "bytes": len(data),
                          "sha256": hashlib.sha256(data).hexdigest()})
    missions = []
    for faction in ("HUMAN", "ALIEN"):
        path = ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}01.SCN"
        lines = [line.strip() for line in path.read_text().splitlines()
                 if line.strip() and not line.lstrip().startswith("%")]
        phase = int(lines[4])
        teams = []
        for position, line in enumerate(lines):
            if line.startswith("TEAM "):
                team = int(line.split()[1])
                color = int(lines[position + 4])
                selector = color if 0 <= color <= 7 else team
                teams.append({"team": team, "scnColor": color, "selector": selector, "finBank": 2, "finRow": 128 + selector})
        missions.append({"id": lines[1], "initialPhase": phase, "initialBlend": phase * 256,
                         "visibleTerrainBank": 0, "visibleTerrainRow": 128 + phase * 7, "teams": teams})
    print(json.dumps({"schema": "darkcolony.palette-init.v1", "executableSha256": AUDIT.DIGEST,
                      "resources": resources, "missions": missions,
                      "palette": {"sourceOffset": 13, "bytes": 768, "endpointOverride": {"0": [0, 0, 0], "255": [255, 255, 255]}},
                      "rmp": {"width": 256, "height": 768, "bytes": 196608},
                      "coverage": {"terrainBackground": "opaque", "terrainForeground": "source-zero",
                                   "rawSprite": "source-zero", "compressedSprite": "decoded-run-mask"},
                      "sourceIndexTranslation": "identity; no SPR/BTS RGB requantization"}, indent=2, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disasm", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--refs", nargs="+", type=lambda value: int(value, 0))
    parser.add_argument("--calls", nargs="+", type=lambda value: int(value, 0))
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--find", help="Regex against candidate code instructions (linear sweep)")
    parser.add_argument("--context", type=int, default=0)
    parser.add_argument("--contract", action="store_true", help="Print deterministic JSON; does not write assets")
    args = parser.parse_args()
    sections = AUDIT.load_image(ROOT / "raw_cd/DC/DC.EXE")
    if not args.contract:
        print(f"SHA256 {AUDIT.DIGEST}")
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    if args.contract:
        contract()
    elif args.probe:
        probe(sections)
    elif args.disasm:
        start, end = args.disasm
        for instruction in decoder.disasm(AUDIT.read_at(sections, start, end - start), start):
            print(f"{instruction.address:#010x}: {instruction.bytes.hex():22} "
                  f"{instruction.mnemonic:8} {instruction.op_str}")
    elif args.refs:
        for target in args.refs:
            needle = struct.pack("<I", target)
            for base, data in sections:
                offset = data.find(needle)
                while offset >= 0:
                    print(f"{target:#010x}: operand/data at {base + offset:#010x}")
                    offset = data.find(needle, offset + 1)
    elif args.calls:
        for base, data in sections:
            for offset in range(len(data) - 4):
                if data[offset] in (0xE8, 0xE9):
                    target = base + offset + 5 + struct.unpack_from("<i", data, offset + 1)[0]
                    if target in args.calls:
                        print(f"{target:#010x}: candidate call/jump at {base + offset:#010x}")
    elif args.find:
        decoder.skipdata = True
        for base, data in sections:
            if base >= 0x470000:
                continue
            previous = deque(maxlen=args.context)
            following = 0
            for instruction in decoder.disasm(data, base):
                text = f"{instruction.mnemonic} {instruction.op_str}"
                if re.search(args.find, text):
                    for line in previous:
                        print(line)
                    previous.clear()
                    following = args.context
                    print(f"{instruction.address:#010x}: {text}")
                elif following:
                    print(f"{instruction.address:#010x}: {text}")
                    following -= 1
                else:
                    previous.append(f"{instruction.address:#010x}: {text}")
    else:
        parser.error("Choose --contract, --probe, --disasm, --refs, --calls or --find")


if __name__ == "__main__":
    main()