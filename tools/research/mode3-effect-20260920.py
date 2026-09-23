"""Execute original queue dispatch for unchanged VENT children; no renderer stubs."""

import base64
import importlib.util
import json
from pathlib import Path
import struct

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP

SPEC = importlib.util.spec_from_file_location("mode3_scene", Path(__file__).with_name("mission-scene-frame-20260919.py"))
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)


def pixel_proof(sections):
    machine = SOURCE.TERRAIN.machine_for(sections)
    entry = struct.unpack("<I", machine.mem_read(0x45D7C0 + 2 * 4, 4))[0]
    output = bytearray()
    for source_index in range(256):
        machine.mem_write(0x708000, bytes([source_index]) * 128)
        for half in range(2):
            machine.mem_write(0x709000, bytes(range(half * 128, (half + 1) * 128)))
            machine.reg_write(UC_X86_REG_ESI, 0x708000)
            machine.reg_write(UC_X86_REG_EDI, 0x709000)
            machine.reg_write(UC_X86_REG_EAX, 0xFC00)
            machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
            SOURCE.TERRAIN.write_word(machine, SOURCE.TERRAIN.STACK, SOURCE.TERRAIN.STOP)
            machine.emu_start(entry, SOURCE.TERRAIN.STOP, count=2000)
            assert machine.reg_read(UC_X86_REG_EIP) == SOURCE.TERRAIN.STOP
            output.extend(machine.mem_read(0x709000, 128))
    return {"writer": hex(entry), "pairs": 65536, "output": base64.b64encode(output).decode()}


def render_terrain(machine, destination, view, remap_address, light, camera_x, camera_y, pitch, rows):
    data = (SOURCE.ROOT / "raw_cd/DC/SCENARIO/DESERT.BTS").read_bytes()
    map_width = struct.unpack("<I", machine.mem_read(0x89A4B0, 4))[0]
    for tile_row in range(rows // 32):
        for tile_column in range(pitch // 32):
            cell = (camera_y // 32 + tile_row) * map_width + camera_x // 32 + tile_column
            packed = struct.unpack("<I", machine.mem_read(0xA40000 + cell * 4, 4))[0]
            background, foreground, attributes = packed & 2047, (packed >> 11) & 2047, packed >> 22
            for address, index in ((SOURCE.TERRAIN.BACKGROUND, background), (SOURCE.TERRAIN.FOREGROUND, foreground)):
                start = 780 + index * 1028
                machine.mem_write(address, data[start:start + 1024])
            foreground_pixels = bytes(machine.mem_read(SOURCE.TERRAIN.FOREGROUND, 1024))
            masks = [sum(int(foreground_pixels[row * 32 + column] != 0) << (31 - column) for column in range(32)) for row in range(32)]
            machine.mem_write(SOURCE.TERRAIN.MASK, struct.pack("<32I", *masks))
            for address, value in ((0x4891E8, SOURCE.TERRAIN.FOREGROUND), (0x4891EC, SOURCE.TERRAIN.BACKGROUND),
                (0x4891F0, light + tile_row * 32 * pitch + tile_column * 32), (0x4891F4, SOURCE.TERRAIN.MASK),
                (0x4891F8, destination + tile_row * 32 * pitch + tile_column * 32), (0x4891FC, remap_address),
                (0x489200, pitch), (0x489204, pitch), (0x489214, 4)):
                SOURCE.TERRAIN.write_word(machine, address, value)
            selector = (attributes >> 5) & (3 if foreground else 1)
            table = 0x47C030 if foreground else 0x47C040
            entry = struct.unpack("<I", machine.mem_read(table + selector * 4, 4))[0]
            machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
            SOURCE.TERRAIN.write_word(machine, SOURCE.TERRAIN.STACK, SOURCE.TERRAIN.STOP)
            machine.emu_start(entry, SOURCE.TERRAIN.STOP, count=100000)
            assert machine.reg_read(UC_X86_REG_EIP) == SOURCE.TERRAIN.STOP


def main():
    sections = SOURCE.TERRAIN.load_image(SOURCE.ROOT / "raw_cd/DC/DC.EXE")
    children, fin = SOURCE.fin_source(19, "VENT")
    assert children[3]["valueA"] == 3 and children[3]["flags"] == 16
    results = []
    for bank in ("DESERT", "JUNGLE", "ATLANTIS", "HTRAIN"):
        remap, remap_source = SOURCE.source(f"raw_cd/DC/{bank}.RMP")
        _, gif_source = SOURCE.source(f"raw_cd/DC/{bank}.GIF")
        for mirror in (0, 1):
            child_index = 3
            child = {**children[child_index], "valueB": mirror}

            def capture(machine, child, sprite, destination, view, before, queued_x, baseline,
                        camera_x, camera_y, pitch, rows, reflection, phase, cell, attributes):
                queue, frame, remap_address, light = 0xAF1000, 0x728000, 0xAC0000, 0xB80000
                raw_terrain = before
                machine.mem_write(remap_address, remap)
                light_before = bytes([128]) * len(before)
                machine.mem_write(light, light_before)
                SOURCE.TERRAIN.write_word(machine, view + 28, light)
                render_terrain(machine, destination, view, remap_address, light, camera_x, camera_y, pitch, rows)
                before = bytes(machine.mem_read(destination, len(before)))
                SOURCE.TERRAIN.write_word(machine, 0x4891FC, remap_address)
                machine.mem_write(queue, bytes(28))
                SOURCE.TERRAIN.write_word(machine, queue, sprite)
                selector = phase + (2 if reflection else 0) + (4 if baseline % 32 <= 1 else 0)
                machine.mem_write(queue + 12, struct.pack("<hhhhBBBBB", queued_x, baseline, 0, 0,
                    128 + selector, child["layer"], child["flags"], child["valueA"], child["valueB"]))
                SOURCE.TERRAIN.write_word(machine, frame - 0xCB4, queue)
                SOURCE.TERRAIN.write_word(machine, frame - 0x12, 0)
                SOURCE.TERRAIN.write_word(machine, frame - 6, 1 << 16)
                machine.reg_write(UC_X86_REG_EBP, frame)
                machine.reg_write(UC_X86_REG_EDI, view)
                machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
                calls, reads, writes = [], set(), []

                def code_hook(emulator, address, size, user):
                    calls.append(hex(address))

                def read_hook(emulator, access, address, size, value, user):
                    reads.add(address - remap_address)

                def write_hook(emulator, access, address, size, value, user):
                    writes.append([address - destination, size])

                for entry in (0x4548C3, 0x454C22, 0x4621A0, 0x460709, 0x461090):
                    machine.hook_add(UC_HOOK_CODE, code_hook, begin=entry, end=entry)
                machine.hook_add(UC_HOOK_MEM_READ, read_hook, begin=remap_address, end=remap_address + len(remap) - 1)
                machine.hook_add(UC_HOOK_MEM_WRITE, write_hook, begin=destination, end=destination + len(before) - 1)
                machine.ctl_remove_cache(0x400000, 0x480000)
                machine.emu_start(0x454846, 0x454C2B, count=3000000)
                assert machine.reg_read(UC_X86_REG_EIP) == 0x454C2B
                output = bytes(machine.mem_read(destination, len(before)))
                assert calls == ["0x4548c3", "0x454c22"]
                assert not reads and not writes and output == before
                postpass_calls = calls[:]
                machine.mem_write(0x4E686C, b"\1")
                SOURCE.TERRAIN.write_word(machine, 0x489200, pitch)
                SOURCE.TERRAIN.write_word(machine, 0x4891DC, mirror)
                machine.mem_write(0x516DB4, b"\0\0")
                variants = []
                sprite_height = struct.unpack("<H", machine.mem_read(sprite + 2, 2))[0]
                clip_height = baseline - camera_y - sprite_height // 2
                for viewport_height, enabled in ((rows, 1), (clip_height, 1), (rows, 0)):
                    machine.mem_write(light, light_before)
                    machine.mem_write(view + 14, struct.pack("<H", viewport_height))
                    machine.mem_write(0x4E686C, bytes([enabled]))
                    SOURCE.TERRAIN.write_word(machine, frame - 0x20, 1)
                    machine.reg_write(UC_X86_REG_EBP, frame)
                    machine.reg_write(UC_X86_REG_EDI, view)
                    machine.reg_write(UC_X86_REG_ESI, queue)
                    machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
                    calls.clear()
                    reads.clear()
                    writes.clear()
                    machine.emu_start(0x4546D7, 0x454713, count=3000000)
                    assert machine.reg_read(UC_X86_REG_EIP) == 0x454713
                    assert not reads and not writes
                    filters = bytes(machine.mem_read(light, len(before)))
                    if not enabled:
                        assert filters == light_before
                    primitive_calls = calls[:]
                    render_terrain(machine, destination, view, remap_address, light, camera_x, camera_y, pitch, rows)
                    output = bytes(machine.mem_read(destination, len(before)))
                    assert reads and all(offset < 65536 for offset in reads), (len(reads), min(reads, default=-1), max(reads, default=-1))
                    variants.append({"height": viewport_height, "enabled": bool(enabled), "calls": primitive_calls,
                        "filter": base64.b64encode(filters).decode(), "output": base64.b64encode(output).decode()})
                return {"child": child, "queuedX": queued_x, "baseline": baseline,
                        "camera": {"x": camera_x, "y": camera_y, "width": pitch, "height": rows},
                        "reflection": reflection, "phase": phase, "selector": selector,
                        "postpassCalls": postpass_calls, "variants": variants,
                        "terrain": base64.b64encode(raw_terrain).decode(), "before": base64.b64encode(before).decode()}

            results.append({"bank": bank, "fin": fin, "childIndex": child_index, "sourceChild": children[child_index], "controlledMirror": bool(mirror),
                            "remap": remap_source, "gif": gif_source,
                            "raster": SOURCE.raster_probe(sections, [child], capture, child["valueA"])})
    for result in results:
        assert any(frame["before"] != frame["variants"][0]["output"] for frame in result["raster"]["frames"])
    print(json.dumps({"sha256": SOURCE.TERRAIN.DIGEST, "runtimeInterceptions": 0,
                      "pixelProof": pixel_proof(sections), "cases": results}))


if __name__ == "__main__":
    main()