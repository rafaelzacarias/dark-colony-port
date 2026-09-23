"""Bounded original-x86 scene ordering and MAP cutoff evidence, not live parity."""

import argparse
from functools import cmp_to_key
import importlib.util
import json
from pathlib import Path
import struct

from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDI, UC_X86_REG_EDX, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
    UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_FS, UC_X86_REG_GS,
    UC_X86_REG_GDTR, UC_X86_REG_SS,
)

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("terrain_probe", Path(__file__).with_name("terrain-transforms.py"))
TERRAIN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TERRAIN)


def signed32(value):
    return (value + 0x80000000) % 0x100000000 - 0x80000000


def priority(layer):
    return ((layer >> 1) + 1) * 3000 if layer & 1 else -(layer >> 1) * 3000


def key(record):
    return signed32(((priority(record["layer"]) + record["submissionWord"]) << 16) + record["x"])


def comparator_probe(sections):
    machine = TERRAIN.machine_for(sections)
    machine.mem_write(0x727000, struct.pack("<QQQ", 0, 0x00CF9A000000FFFF, 0x00CF92000000FFFF))
    machine.reg_write(UC_X86_REG_GDTR, (0, 0x727000, 23, 0))
    machine.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_FS, UC_X86_REG_GS, UC_X86_REG_SS):
        machine.reg_write(register, 16)
    machine.mem_write(0x708000, struct.pack("<II", 0x709000, 0x70A000))

    def compare(left, right):
        for address, record in ((0x709000, left), (0x70A000, right)):
            machine.mem_write(address, bytes(28))
            machine.mem_write(address + 8, struct.pack("<Ih", record["submissionWord"] & 0xffffffff, record["x"]))
            machine.mem_write(address + 21, bytes([record["layer"]]))
        machine.reg_write(UC_X86_REG_EAX, 0x708000)
        machine.reg_write(UC_X86_REG_EDX, 0x708004)
        machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
        TERRAIN.write_word(machine, TERRAIN.STACK, TERRAIN.STOP)
        machine.emu_start(0x454590, TERRAIN.STOP, count=200)
        assert machine.reg_read(UC_X86_REG_EIP) == TERRAIN.STOP
        actual = signed32(machine.reg_read(UC_X86_REG_EAX))
        assert actual == signed32(key(right) - key(left)), (left, right, actual)
        return actual

    crowded = [
        {"id": "rear-body", "layer": 0, "submissionWord": 100, "x": 160},
        {"id": "front-body", "layer": 0, "submissionWord": 99, "x": 160},
        {"id": "rear-effect", "layer": 2, "submissionWord": 100, "x": 160},
        {"id": "front-underlay", "layer": 1, "submissionWord": 99, "x": 160},
        {"id": "right-tie", "layer": 0, "submissionWord": 100, "x": 161},
        {"id": "identical-key", "layer": 0, "submissionWord": 100, "x": 160},
    ]
    extremes = [{"layer": layer, "submissionWord": order, "x": coord}
                for layer in (0, 1, 2, 21, 22, 127, 128, 254, 255)
                for order in (0, 1, 65535) for coord in (-32768, -1, 0, 32767)]
    records = crowded + extremes
    for left in records:
        for right in records:
            compare(left, right)
    unique = crowded[:-1]
    for index, record in enumerate(unique):
        address = 0x710000 + index * 28
        TERRAIN.write_word(machine, 0x708000 + index * 4, address)
        machine.mem_write(address + 8, struct.pack("<Ih", record["submissionWord"], record["x"]))
        machine.mem_write(address + 21, bytes([record["layer"]]))
    machine.reg_write(UC_X86_REG_EAX, 0x708000)
    machine.reg_write(UC_X86_REG_EDX, len(unique))
    machine.reg_write(UC_X86_REG_EBX, 4)
    machine.reg_write(UC_X86_REG_ECX, 0x454590)
    machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
    TERRAIN.write_word(machine, TERRAIN.STACK, TERRAIN.STOP)
    machine.emu_start(0x440933, TERRAIN.STOP, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == TERRAIN.STOP
    native_order = [unique[(address - 0x710000) // 28]["id"] for address in
                    struct.unpack(f"<{len(unique)}I", machine.mem_read(0x708000, len(unique) * 4))]
    expected_order = [record["id"] for record in sorted(unique, key=lambda record: -key(record))]
    assert native_order == expected_order
    machine.mem_write(0x708000, struct.pack("<II", 0x709000, 0x70A000))
    return {"pairs": len(records) ** 2, "crowded": crowded,
            "nativeSortUniqueOrder": native_order,
            "stableComparatorOrder": [record["id"] for record in sorted(crowded, key=cmp_to_key(compare))],
            "nativeEqualKeySortStability": "not established"}


def cutoff_probe(sections):
    machine = TERRAIN.machine_for(sections)
    frame, cell, output, sprite = 0x728000, 0x708000, 0x709000, 0x70A000
    machine.reg_write(UC_X86_REG_EBP, frame)
    TERRAIN.write_word(machine, frame + 0x10, output)
    TERRAIN.write_word(machine, frame - 8, sprite)
    cases = []
    for height in (33, 73, 160):
        machine.mem_write(sprite + 2, struct.pack("<H", height))
        for nibble in range(16):
            for local_y in range(32):
                TERRAIN.write_word(machine, cell, 1 | (2 << 11) | (nibble << 22))
                machine.reg_write(UC_X86_REG_EAX, cell)
                machine.reg_write(UC_X86_REG_EBX, local_y)
                machine.reg_write(UC_X86_REG_ECX, 0)
                machine.emu_start(0x461120, 0x46115A, count=100)
                assert machine.reg_read(UC_X86_REG_EIP) == 0x46115A
                cutoff = struct.unpack("<h", machine.mem_read(output, 2))[0]
                assert cutoff == height + 31 - local_y - 32 * nibble
                cases.append({"height": height, "nibble": nibble, "localY": local_y, "cutoff": cutoff})
    return {"cases": len(cases), "tallForeground": [case for case in cases
            if case["height"] == 160 and case["localY"] == 17 and case["nibble"] in (0, 1, 4, 8, 15)]}


def body_probe(sections):
    results = []
    for nibble, transparent_remap in ((0, False), (1, False), (4, False), (8, False), (15, False), (4, True)):
        machine = TERRAIN.machine_for(sections)
        machine.mem_map(0x800000, 0x200000)
        sprite, raster, masks, destination, remap, view, cells = (
            0x900000, 0x901000, 0x910000, 0x920000, 0x930000, 0x940000, 0x950000)
        width, height, left, bottom, pitch = 48, 160, 48, 210, 128
        machine.mem_write(sprite, struct.pack("<HHHHII", width, height, 0, 99, 0, raster))
        payload = bytearray()
        for row in range(height):
            for column in range(width):
                if transparent_remap and (column + row) % 11 == 3:
                    payload.append(255)
                else:
                    payload.extend((0, 1 + (column + row) % 200))
        machine.mem_write(raster, bytes(payload))
        machine.mem_write(destination, bytes([0xEE]) * (pitch * 256))
        machine.mem_write(remap, bytes((value + 37) & 255 if transparent_remap else value for value in range(256)))
        for address, value in ((view + 8, destination), (view + 20, 0x800000), (view + 24, masks),
                               (0x800000 + 0x9A4B0, 8), (0x800000 + 0x9A4B4, 8),
                               (0x4891FC, remap)):
            TERRAIN.write_word(machine, address, value)
        machine.mem_write(view + 12, struct.pack("<HHH", 128, 256, pitch))
        for row in range(8):
            TERRAIN.write_word(machine, 0x800004 + row * 4, cells + row * 32)
            for column in range(8):
                attribute = nibble if column == 1 else max(0, nibble - 2)
                TERRAIN.write_word(machine, cells + row * 32 + column * 4, 1 | (2 << 11) | (attribute << 22))
        for row in range(256):
            for column in range(4):
                mask = sum(int((column * 32 + bit + 3 * row) % 7 < 3) << (31 - bit) for bit in range(32))
                TERRAIN.write_word(machine, masks + row * 16 + column * 4, mask)
        machine.reg_write(UC_X86_REG_EAX, sprite)
        machine.reg_write(UC_X86_REG_EDX, left)
        machine.reg_write(UC_X86_REG_EBX, bottom)
        machine.reg_write(UC_X86_REG_ECX, 0)
        machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
        machine.mem_write(TERRAIN.STACK, struct.pack("<II", TERRAIN.STOP, view))
        machine.emu_start(0x461170, TERRAIN.STOP, count=3000000)
        assert machine.reg_read(UC_X86_REG_EIP) == TERRAIN.STOP
        expected = bytearray([0xEE]) * (pitch * 256)
        visible = 0
        for row in range(height):
            for column in range(width):
                world_x, world_y = left + column, bottom - height + row
                attribute = nibble if world_x // 32 == 1 else max(0, nibble - 2)
                cutoff = height + 31 - (bottom & 31) - 32 * attribute
                covered = (world_x + 3 * world_y) % 7 < 3
                transparent = transparent_remap and (column + row) % 11 == 3
                if (row <= cutoff or not covered) and not transparent:
                    value = 1 + (column + row) % 200
                    expected[world_y * pitch + world_x] = (value + 37) & 255 if transparent_remap else value
                    visible += 1
        actual = bytes(machine.mem_read(destination, len(expected)))
        assert actual == expected, (nibble, next((index, observed, wanted)
            for index, (observed, wanted) in enumerate(zip(actual, expected)) if observed != wanted))
        results.append({"nibble": nibble, "transparentRemap": transparent_remap, "width": width, "height": height, "left": left,
                        "bottom": bottom, "visiblePixels": visible, "framebufferSha256": TERRAIN.hashlib.sha256(actual).hexdigest()})
    return results


def bypass_probe(sections):
    machine = TERRAIN.machine_for(sections)
    machine.reg_write(UC_X86_REG_ESI, 0x708000)
    results = []
    for layer in (0, 1, 2, 3, 254, 255):
        for height in (-1, 0, 1):
            machine.reg_write(UC_X86_REG_EBX, layer << 8)
            machine.mem_write(0x708012, struct.pack("<h", height))
            machine.emu_start(0x45487D, 0x4548A6, count=100)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x4548A6
            actual = struct.unpack("<H", machine.mem_read(0x516DB4, 2))[0]
            assert actual == int(layer == 2 or height != 0)
            results.append({"layer": layer, "heightOffset": height, "bypass": bool(actual)})
    return results


def origin_probe(sections):
    machine = TERRAIN.machine_for(sections)
    machine.mem_map(0x800000, 0x100000)
    frame = 0x728000
    TERRAIN.write_word(machine, 0x4E6840, 0x800000)
    TERRAIN.write_word(machine, 0x800000 + 0x9A4BC, 32768)
    machine.reg_write(UC_X86_REG_EBP, frame)
    results = []
    for position in (-9, -8, -1, 0, 1, 7, 8, 9, 511):
        TERRAIN.write_word(machine, frame - 4, position & 0xffffffff)
        TERRAIN.write_word(machine, frame - 8, position & 0xffffffff)
        machine.reg_write(UC_X86_REG_EDI, position)
        machine.reg_write(UC_X86_REG_ESI, 0x708000)
        machine.emu_start(0x43604E, 0x4360CC, count=100)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x4360CC
        horizontal, vertical = struct.unpack("<hh", machine.mem_read(0x4E10B8, 4))
        elevation = struct.unpack("<h", machine.mem_read(0x4E10BE, 2))[0]
        assert (horizontal, vertical, elevation) == (position >> 3, (32768 - position - 1) >> 3, -(position >> 3))
        results.append({"position": position, "x": horizontal, "y": vertical, "elevation": elevation})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=ROOT / "raw_cd/DC/DC.EXE")
    args = parser.parse_args()
    sections = TERRAIN.load_image(args.exe)
    print(json.dumps({"sha256": TERRAIN.DIGEST, "comparator": comparator_probe(sections),
                      "cutoff": cutoff_probe(sections), "body": body_probe(sections),
                      "origin": origin_probe(sections), "bypass": bypass_probe(sections)}, sort_keys=True))


if __name__ == "__main__":
    main()