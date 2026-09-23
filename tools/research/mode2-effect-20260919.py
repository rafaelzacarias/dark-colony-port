"""Bounded original mode2 inspection; no OS window or rendering replacements."""

import importlib.util
from pathlib import Path
import struct
import base64
import json
import sys

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP

SPEC = importlib.util.spec_from_file_location("mode2_scene", Path(__file__).with_name("mission-scene-frame-20260919.py"))
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)


def main():
    sections = SOURCE.TERRAIN.load_image(SOURCE.ROOT / "raw_cd/DC/DC.EXE")
    machine = SOURCE.TERRAIN.machine_for(sections)
    assert struct.unpack("<I", machine.mem_read(0x454664 + 2 * 4, 4))[0] == 0x454BCD
    if "--inspect" in sys.argv:
        decoder = Cs(CS_ARCH_X86, CS_MODE_32)
        for instruction in decoder.disasm(bytes(machine.mem_read(0x454BCD, 90)), 0x454BCD):
            print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
        return
    data = (SOURCE.ROOT / "raw_cd/DC/ANIMATE/ALBU.FIN").read_bytes()
    sources = []
    for timeline in range(struct.unpack_from("<H", data, 2)[0]):
        children, evidence = SOURCE.fin_source(timeline, "ALBU")
        for child_index, child in enumerate(children):
            if child["valueA"] == 2:
                sources.append((child, evidence, child_index))
    assert sources
    results = []
    for bank in ("DESERT", "JUNGLE", "ATLANTIS", "HTRAIN"):
        remap, remap_source = SOURCE.source(f"raw_cd/DC/{bank}.RMP")
        _, gif_source = SOURCE.source(f"raw_cd/DC/{bank}.GIF")
        for source_child, fin, child_index in (sources[0], sources[-1]):
            for mirror in (0, 1):
                child = {**source_child, "valueB": mirror}

                def capture(machine, child, sprite, destination, view, before, queued_x, baseline,
                            camera_x, camera_y, pitch, rows, reflection, phase, cell, attributes):
                    remap_address, queue = 0xAC0000, 0xAF1000
                    machine.mem_write(remap_address, remap)
                    before = bytes(remap[128 * 256 + value] for value in before)
                    machine.mem_write(destination, before)
                    machine.mem_write(queue, bytes(28))
                    SOURCE.TERRAIN.write_word(machine, queue, sprite)
                    selector = phase + (2 if reflection else 0) + (4 if baseline % 32 <= 1 else 0)
                    machine.mem_write(queue + 12, struct.pack("<hhhhBBBBB", queued_x, baseline, 0, 0,
                                                            128 + selector, child["layer"], child["flags"], 2, mirror))
                    SOURCE.TERRAIN.write_word(machine, 0x4891FC, remap_address)
                    machine.mem_write(0x4891DC, struct.pack("<H", mirror))
                    machine.mem_write(0x4E686D, b"\1")
                    machine.mem_write(0x516DB4, b"\0\0")
                    machine.reg_write(UC_X86_REG_ESI, queue)
                    machine.reg_write(UC_X86_REG_EDI, view)
                    machine.reg_write(UC_X86_REG_EBP, 0x728000)
                    machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
                    calls, reads = [], set()

                    def code_hook(emulator, address, size, user):
                        calls.append(hex(address))

                    def read_hook(emulator, access, address, size, value, user):
                        reads.add(address - remap_address)

                    for entry in (0x4618C0, 0x461D14, 0x461170, 0x46152C, 0x461090):
                        machine.hook_add(UC_HOOK_CODE, code_hook, begin=entry, end=entry)
                    machine.hook_add(UC_HOOK_MEM_READ, read_hook, begin=remap_address, end=remap_address + len(remap) - 1)
                    stop = 0x454BF8 if mirror else 0x454C22
                    machine.emu_start(0x454BCD, stop, count=3000000)
                    assert machine.reg_read(UC_X86_REG_EIP) == stop
                    output = bytes(machine.mem_read(destination, len(before)))
                    assert output != before
                    assert reads and all(72 * 256 <= offset < 73 * 256 for offset in reads)
                    assert not {"0x461170", "0x46152c"}.intersection(calls)
                    sprite_height = struct.unpack("<H", machine.mem_read(sprite + 2, 2))[0]
                    clip_height = baseline - camera_y - sprite_height // 2
                    machine.mem_write(destination, before)
                    machine.mem_write(view + 14, struct.pack("<H", clip_height))
                    machine.mem_write(0x516DB4, b"\0\0")
                    machine.reg_write(UC_X86_REG_ESI, queue)
                    machine.reg_write(UC_X86_REG_EDI, view)
                    machine.reg_write(UC_X86_REG_EBP, 0x728000)
                    machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
                    machine.emu_start(0x454BCD, stop, count=3000000)
                    assert machine.reg_read(UC_X86_REG_EIP) == stop
                    clipped = bytes(machine.mem_read(destination, len(before)))
                    assert clipped[clip_height * pitch:] == before[clip_height * pitch:]
                    return {"child": child, "queuedX": queued_x, "baseline": baseline,
                            "camera": {"x": camera_x, "y": camera_y, "width": pitch, "height": rows},
                            "reflection": reflection, "phase": phase, "selector": selector,
                            "calls": calls[:2], "remapOffsets": sorted(reads), "clipHeight": clip_height,
                            "clipped": base64.b64encode(clipped).decode(),
                            "before": base64.b64encode(before).decode(), "output": base64.b64encode(output).decode()}

                results.append({"bank": bank, "fin": fin, "childIndex": child_index, "sourceChild": source_child,
                                "controlledMirror": mirror != source_child["valueB"], "remap": remap_source, "gif": gif_source,
                                "raster": SOURCE.raster_probe(sections, [child], capture, 2)})
    frames = [frame for result in results for frame in result["raster"]["frames"]]
    assert any(frame["clipped"] != frame["output"] for frame in frames)
    assert any(frame["clipped"] != frame["before"] for frame in frames)
    print(json.dumps({"sha256": SOURCE.TERRAIN.DIGEST, "runtimeInterceptions": 0, "cases": results}))


if __name__ == "__main__":
    main()