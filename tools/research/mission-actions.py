"""Hash-pinned native mission action probes; requires Capstone 5 and Unicorn 2."""

import importlib.util
from pathlib import Path
import struct
import sys

from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("transport_audit", Path(__file__).with_name("transport-audit.py"))
AUDIT = importlib.util.module_from_spec(SPEC)
sys.dont_write_bytecode = True
SPEC.loader.exec_module(AUDIT)
IMAGE, SECTIONS, READ = AUDIT.load_image(ROOT / "raw_cd/DC/DC.EXE")
FRAME, STACK, SOURCE, ACTION, GAME = 0x70F000, 0x70E000, 0x702000, 0x4FC44C, 0x800000


def machine_for_probe():
    machine = Uc(UC_ARCH_X86, UC_MODE_32)
    machine.mem_map(0x400000, 0x200000)
    machine.mem_map(0x700000, 0x10000)
    machine.mem_map(GAME, 0x100000)
    for _, address, length, raw in SECTIONS:
        machine.mem_write(address, IMAGE[raw:raw + length])
    for register, value in ((UC_X86_REG_EBP, FRAME), (UC_X86_REG_ESP, STACK),
                            (UC_X86_REG_ESI, 0), (UC_X86_REG_EDI, GAME)):
        machine.reg_write(register, value)
    return machine


def parse(entry, source):
    machine = machine_for_probe()
    previous = 0x709000
    machine.reg_write(UC_X86_REG_ESI, previous)
    machine.mem_write(SOURCE, source.encode("ascii") + b"\0")
    machine.mem_write(FRAME - 0x30, struct.pack("<I", SOURCE))
    machine.mem_write(ACTION, b"\xa5" * 28)
    machine.emu_start(entry, 0x43E8B7, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x43E8B7
    assert struct.unpack("<I", machine.mem_read(ACTION + 0x18, 4))[0] == previous
    assert machine.reg_read(UC_X86_REG_ESI) == ACTION
    return machine


def waypoint_probe():
    for points in ([(40, 14)], [(40, 14), (41, 12)], [(index, 255 - index) for index in range(8)]):
        values = [41, 12, len(points), *[value for point in points for value in point]]
        machine = parse(0x43F339, " ".join(map(str, values)))
        assert machine.mem_read(ACTION, 1) == b"\x0a"
        assert machine.mem_read(ACTION + 4, len(values)) == bytes(values)
        for matched in (True, False):
            entities = bytearray(800 * 220)
            if matched:
                for slot in (152, 153):
                    entities[slot * 220 + 1] = 41
                    entities[slot * 220 + 5] = 12
            machine.mem_write(GAME + 0x7D28, bytes(entities))
            machine.reg_write(UC_X86_REG_ESI, ACTION)
            machine.reg_write(UC_X86_REG_EDI, GAME)
            machine.emu_start(0x43E08D, 0x43E4BE if not matched else 0x43D822, count=100000)
            assert machine.reg_read(UC_X86_REG_EIP) == (0x43E4BE if not matched else 0x43D822)
            if matched:
                offset = 152 * 220
                entities[offset + 0x36:offset + 0x38] = bytes((1, 9))
                entities[offset + 0xC6] = len(points)
                for index, (tile_x, tile_y) in enumerate(points):
                    struct.pack_into("<HH", entities, offset + 0xA6 + 4 * index,
                                     tile_x * 256 + 128, tile_y * 256 + 128)
            assert machine.mem_read(GAME + 0x7D28, len(entities)) == entities
    print("PASS waypoint: native literal parser, 1/2/8 points, inactive first match, exact writes, no match")


def economy_probe():
    for team, value in ((0, 0), (4, 37), (7, 255)):
        machine = parse(0x43F642, f"{team} {value}")
        assert machine.mem_read(ACTION, 1) == b"\x0c"
        assert machine.mem_read(ACTION + 4, 2) == bytes((team, value))
        sides = bytearray(b"\xa5" * (8 * 0xE30 + 0xBB0))
        machine.mem_write(GAME, bytes(sides))
        before_statistics = bytes(machine.mem_read(0x4956E0, 0x3900))
        machine.reg_write(UC_X86_REG_ESI, ACTION)
        machine.reg_write(UC_X86_REG_EDI, GAME)
        machine.emu_start(0x43D900, 0x43D822, count=1000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43D822
        struct.pack_into("<I", sides, team * 0xE30 + 0x19B4, value)
        assert machine.mem_read(GAME, len(sides)) == sides
        assert machine.mem_read(0x4956E0, 0x3900) == before_statistics
    wrapped = parse(0x43F642, "4 256")
    assert wrapped.mem_read(ACTION + 4, 2) == bytes((4, 0))
    print("PASS exomoney: byte parser (including native wrap), exact side dword assignment, no statistic writes")


def message_probe():
    for values in ((2, 0, 1, 3, 8), (255, 0, 29, 254, 255)):
        machine = parse(0x43FA3C, " ".join(map(str, values)))
        assert machine.mem_read(ACTION, 1) == b"\x0b"
        assert machine.mem_read(ACTION + 4, 5) == bytes(values)
        messages = GAME + 0x46F9C
        text = 0x703000
        machine.mem_write(messages + 4 * values[2], struct.pack("<I", text))
        machine.mem_write(text, b"probe\0")

        def clock_hook(emulator, address, size, user_data):
            if address == 0x40B030:
                pointer = emulator.reg_read(UC_X86_REG_ESP)
                destination = struct.unpack("<I", emulator.mem_read(pointer, 4))[0]
                emulator.reg_write(UC_X86_REG_EAX, 123456)
                emulator.reg_write(UC_X86_REG_ESP, pointer + 4)
                emulator.reg_write(UC_X86_REG_EIP, destination)

        machine.hook_add(UC_HOOK_CODE, clock_hook)
        machine.reg_write(UC_X86_REG_ESI, ACTION)
        machine.reg_write(UC_X86_REG_EDI, GAME)
        machine.emu_start(0x43D877, 0x43D822, count=10000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43D822
        for offset, expected in ((0x78, text), (0xB8, values[3]), (0xF8, 123456),
                                 (0x138, values[4]), (0x178, values[0]), (0x1B8, 31), (0x1F8, 1)):
            assert struct.unpack("<I", machine.mem_read(messages + offset, 4))[0] == expected
    print("PASS msg: five-byte parser and native queue insertion; only millisecond clock intercepted")


if __name__ == "__main__":
    print(f"SHA256 {AUDIT.DIGEST}")
    for keyword, address, opcode, handler in ((b"msg\0", 0x476BE0, 11, 0x43D877),
                                              (b"waypoint\0", 0x476B34, 10, 0x43E08D),
                                              (b"exomoney\0", 0x476BA8, 12, 0x43D900)):
        assert READ(address, len(keyword)) == keyword
        assert struct.unpack("<I", READ(0x43D7BC + opcode * 4, 4))[0] == handler
    waypoint_probe()
    economy_probe()
    message_probe()
    print("PASS native opcode dispatch and action predecessor links: parsed actions prepend in reverse source order")