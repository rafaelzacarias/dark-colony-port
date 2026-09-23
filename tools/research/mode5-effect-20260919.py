import importlib.util
import base64
import json
from pathlib import Path
import struct
import sys

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EAX

SPEC = importlib.util.spec_from_file_location("source_scene", Path(__file__).with_name("mission-scene-frame-20260919.py"))
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)


def pixel_proof(sections, remap):
    machine = SOURCE.TERRAIN.machine_for(sections)
    machine.mem_map(0x800000, 0x40000)
    machine.mem_write(0x800000, remap)
    entry = struct.unpack("<I", machine.mem_read(0x45F69B + 127 * 4, 4))[0]
    output = bytearray()
    for source in range(256):
        machine.mem_write(0x830000, bytes([source]) * 128)
        for half in range(2):
            machine.mem_write(0x830100, bytes(range(half * 128, (half + 1) * 128)))
            machine.reg_write(UC_X86_REG_ESI, 0x830000)
            machine.reg_write(UC_X86_REG_EDI, 0x830100)
            machine.reg_write(UC_X86_REG_EAX, 0x810000 + ((source + half * 127) % 256) * 256)
            machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
            SOURCE.TERRAIN.write_word(machine, SOURCE.TERRAIN.STACK, SOURCE.TERRAIN.STOP)
            machine.emu_start(entry, SOURCE.TERRAIN.STOP, count=1000)
            assert machine.reg_read(UC_X86_REG_EIP) == SOURCE.TERRAIN.STOP
            output.extend(machine.mem_read(0x830100, 128))
    assert output == remap[65536:131072]
    return {"writer": hex(entry), "pairs": 65536, "output": base64.b64encode(output).decode()}


def main():
    sections = SOURCE.TERRAIN.load_image(SOURCE.ROOT / "raw_cd/DC/DC.EXE")
    machine = SOURCE.TERRAIN.machine_for(sections)
    if "--inspect" in sys.argv:
        decoder = Cs(CS_ARCH_X86, CS_MODE_32)
        for start, size in ((0x454760, 0x230), (0x462444, 0x3A0), (0x461090, 0xE0)):
            for instruction in decoder.disasm(bytes(machine.mem_read(start, size)), start):
                print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
        return
    actual_sources = "--source-effects" in sys.argv
    excluded = []
    specifications = [("BEAC", 1, 1), ("BEAC", 3, 1), ("HUBU", 0, 1), ("HUBU", 0, 2)]
    if actual_sources:
        specifications = []
        for name, timelines in (("VENT", (19, 20, 38)), ("CENT", (0, 12, 53, 54, 76))):
            for timeline in timelines:
                children, _ = SOURCE.fin_source(timeline, name)
                for index, child in enumerate(children):
                    if child["valueA"] != 5:
                        continue
                    if child["flags"] == 16 and child["layer"] in (0, 1) and child["valueB"] in (0, 1):
                        specifications.append((name, timeline, index))
                    else:
                        excluded.append({"name": name, "timeline": timeline, "childIndex": index, "child": child})
    results, proofs = [], {}
    for bank in ("DESERT", "JUNGLE", "ATLANTIS", "HTRAIN"):
        remap, remap_source = SOURCE.source(f"raw_cd/DC/{bank}.RMP")
        _, gif_source = SOURCE.source(f"raw_cd/DC/{bank}.GIF")
        proofs[bank] = pixel_proof(sections, remap)
        for name, timeline, child_index in specifications:
            children, fin = SOURCE.fin_source(timeline, name)
            effects = [child for child in children if child["valueA"] == 5]
            child = children[child_index] if actual_sources else effects[child_index - 1] if name == "HUBU" else effects[0]

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
                                                        128 + selector, child["layer"], child["flags"], 5, child["valueB"]))
                SOURCE.TERRAIN.write_word(machine, 0x4891FC, remap_address)
                machine.mem_write(0x4891DC, struct.pack("<H", child["valueB"]))
                machine.mem_write(0x516DB4, b"\0\0")
                machine.reg_write(UC_X86_REG_ESI, queue)
                machine.reg_write(UC_X86_REG_EDI, view)
                machine.reg_write(UC_X86_REG_EBP, 0x728000)
                machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
                calls, reads = [], set()
                setup, writers = [], {"masked": 0, "unmasked": 0}

                def code_hook(emulator, address, size, data):
                    calls.append(hex(address))

                def read_hook(emulator, access, address, size, value, data):
                    reads.add(address - remap_address)

                def setup_hook(emulator, address, size, data):
                    setup.append(struct.unpack("<H", emulator.mem_read(0x516DB4, 2))[0])

                def writer_hook(emulator, address, size, data):
                    writers["masked" if address == 0x4602C1 else "unmasked"] += 1

                for entry in (0x462444, 0x4627E4, 0x461090, 0x460131):
                    machine.hook_add(UC_HOOK_CODE, code_hook, begin=entry, end=entry)
                machine.hook_add(UC_HOOK_MEM_READ, read_hook, begin=remap_address, end=remap_address + len(remap) - 1)
                if actual_sources:
                    SOURCE.TERRAIN.write_word(machine, 0x728000 - 0xCB4, queue)
                    machine.mem_write(0x728000 - 0x10, b"\0\0")
                    machine.reg_write(UC_X86_REG_EAX, 0)
                    machine.mem_write(0x516DB4, b"\xFF\xFF")
                    machine.mem_write(0x4891DC, b"\xFF\xFF")
                    machine.hook_add(UC_HOOK_CODE, setup_hook, begin=0x4548A6, end=0x4548A6)
                    for entry in (0x4602C1, 0x4602B2):
                        machine.hook_add(UC_HOOK_CODE, writer_hook, begin=entry, end=entry)
                stop = 0x45494F if child["valueB"] else 0x454979
                machine.emu_start(0x45485A if actual_sources else 0x454924, stop, count=3000000)
                assert machine.reg_read(UC_X86_REG_EIP) == stop
                output = bytes(machine.mem_read(destination, len(before)))
                result = {"child": child, "queuedX": queued_x, "baseline": baseline,
                        "camera": {"x": camera_x, "y": camera_y, "width": pitch, "height": rows},
                        "reflection": reflection, "phase": phase, "selector": selector,
                        "calls": calls, "remapOffsets": sorted(reads),
                        "before": base64.b64encode(before).decode(), "output": base64.b64encode(output).decode()}
                if actual_sources:
                    result.update({"maskBypassAtDispatch": setup, "writers": writers,
                                   "remapRestored": struct.unpack("<I", machine.mem_read(0x4891FC, 4))[0] == remap_address})
                return result

            results.append({"bank": bank, "fin": fin, "childIndex": children.index(child), "remap": remap_source,
                            "gif": gif_source, "raster": SOURCE.raster_probe(sections, [child], capture, 5)})
            if actual_sources:
                results[-1]["admission"] = SOURCE.admission_probe(sections, children)
    print(json.dumps({"sha256": SOURCE.TERRAIN.DIGEST, "runtimeInterceptions": 0, "pixelProofs": proofs,
                      "cases": results, "excluded": excluded}))


if __name__ == "__main__":
    main()