import importlib.util
import base64
import json
from pathlib import Path
import struct
import sys

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_ECX, UC_X86_REG_EBX

SPEC = importlib.util.spec_from_file_location("source_scene", Path(__file__).with_name("mission-scene-frame-20260919.py"))
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)


def palette_proof(sections, bank, remap):
    gif, gif_source = SOURCE.source(f"raw_cd/DC/{bank}.GIF")
    rgb, rgb_source = SOURCE.source(f"raw_cd/DC/{bank}.RGB")
    palette = bytes(3) + gif[16:778] + bytes([255]) * 3
    assert len(palette) == 768 and len(rgb) == 32768
    machine = SOURCE.TERRAIN.machine_for(sections)
    machine.mem_map(0x800000, 0x80000)
    SOURCE.TERRAIN.write_word(machine, 0x800014, 0x801000)
    machine.mem_write(0x801001, palette)
    machine.mem_write(0x801F01, rgb)
    machine.mem_write(0x820000, remap)
    frame = 0x728000
    machine.reg_write(UC_X86_REG_EBP, frame)
    channels, quantized, pixels = [], [], []
    for index in range(256):
        for offset, value in ((-12, index), (-16, 0), (-4, 0)):
            SOURCE.TERRAIN.write_word(machine, frame + offset, value)
        machine.reg_write(UC_X86_REG_ECX, 0x800000)
        machine.reg_write(UC_X86_REG_EBX, 9)
        machine.emu_start(0x44F525, 0x44F4CC, count=1000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x44F4CC
        actual = struct.unpack("<3I", machine.mem_read(frame - 0x4C, 12))
        selected = index - 42 if 138 <= index < 144 else index
        assert actual == tuple(value * 9 // 16 for value in palette[selected * 3:selected * 3 + 3])
        channels.append(list(actual))
        machine.mem_write(SOURCE.TERRAIN.STACK, struct.pack("<5I", SOURCE.TERRAIN.STOP, *actual, 0))
        machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
        machine.reg_write(UC_X86_REG_EAX, 0x800000)
        machine.emu_start(0x42BB98, SOURCE.TERRAIN.STOP, count=1000)
        assert machine.reg_read(UC_X86_REG_EIP) == SOURCE.TERRAIN.STOP
        quantized.append(machine.reg_read(UC_X86_REG_EAX) & 255)
        machine.mem_write(0x860000, bytes([index]))
        machine.reg_write(UC_X86_REG_EAX, 0x824800)
        machine.reg_write(UC_X86_REG_EDI, 0x860000)
        machine.reg_write(UC_X86_REG_ESP, SOURCE.TERRAIN.STACK)
        SOURCE.TERRAIN.write_word(machine, SOURCE.TERRAIN.STACK, SOURCE.TERRAIN.STOP)
        machine.emu_start(0x45B812, SOURCE.TERRAIN.STOP, count=20)
        assert machine.reg_read(UC_X86_REG_EIP) == SOURCE.TERRAIN.STOP
        pixels.append(machine.mem_read(0x860000, 1)[0])
    return {"gif": gif_source, "rgb": rgb_source, "channels": channels, "quantized": quantized, "pixels": pixels,
            "sourceRow": list(remap[72 * 256:73 * 256])}


def main():
    terrain = SOURCE.TERRAIN
    sections = terrain.load_image(SOURCE.ROOT / "raw_cd/DC/DC.EXE")
    if "--inspect" in sys.argv:
        machine = terrain.machine_for(sections)
        decoder = Cs(CS_ARCH_X86, CS_MODE_32)
        print("dispatch", [hex(value) for value in struct.unpack("<6I", machine.mem_read(0x454664, 24))])
        entry = struct.unpack("<I", machine.mem_read(0x45CFA0, 4))[0]
        for start, size in ((0x460696, 0x150), (entry, 64)):
            for instruction in decoder.disasm(bytes(machine.mem_read(start, size)), start):
                print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
        for name in ("TRSC", "GRAY"):
            animation = json.loads((SOURCE.ROOT / f"public/assets/generated/animations/{name}.json").read_text())
            for mirror in (0, 1):
                candidates = [(index, item["children"]) for index, item in enumerate(animation["timeline"])
                              if len(item["children"]) == 1 and item["children"][0]["valueA"] == 1
                              and item["children"][0]["valueB"] == mirror]
                print(name, mirror, candidates[:4])
        return
    results = []
    for bank in ((sys.argv[sys.argv.index("--bank") + 1],) if "--bank" in sys.argv else ("DESERT", "JUNGLE", "ATLANTIS", "HTRAIN")):
        remap, remap_source = SOURCE.source(f"raw_cd/DC/{bank}.RMP")
        assert len(remap) == 196608
        palette = palette_proof(sections, bank, remap)
        for name, timeline in (("TRSC", 0), ("TRSC", 268), ("GRAY", 0), ("GRAY", 250),
                       ("TRSC", 380), ("TRSC", 401), ("GRAY", 306), ("GRAY", 348)):
            children, fin = SOURCE.fin_source(timeline, name)
            assert len(children) == 1 and children[0]["valueA"] == 1

            def capture(machine, child, sprite, destination, view, before, queued_x, baseline,
                        camera_x, camera_y, pitch, rows, reflection, phase, cell, attributes):
                remap_address, queue = 0xAC0000, 0xAF1000
                machine.mem_write(remap_address, remap)
                before = bytes(remap[128 * 256 + value] for value in before)
                machine.mem_write(destination, before)
                machine.mem_write(queue, bytes(28))
                terrain.write_word(machine, queue, sprite)
                selector = phase + (2 if reflection else 0) + (4 if baseline % 32 <= 1 else 0)
                machine.mem_write(queue + 12, struct.pack("<hhhhBBBBB", queued_x, baseline, 0, 0,
                                                        128 + selector, child["layer"], child["flags"], 1, child["valueB"]))
                terrain.write_word(machine, 0x4891FC, remap_address)
                machine.mem_write(0x4891DC, struct.pack("<H", child["valueB"]))
                machine.mem_write(0x4E686D, b"\1")
                machine.mem_write(0x516DB4, b"\0\0")
                machine.reg_write(UC_X86_REG_ESI, queue)
                machine.reg_write(UC_X86_REG_EDI, view)
                machine.reg_write(UC_X86_REG_EBP, 0x728000)
                machine.reg_write(UC_X86_REG_ESP, terrain.STACK)
                calls, reads, shadow, segments, cutoffs = [], set(), [], [], []

                def code_hook(emulator, address, size, data):
                    if address == 0x461090:
                        cutoffs.append(hex(address))
                    if address == 0x468927:
                        segments.append({"mask": struct.unpack("<I", emulator.mem_read(0x4891F4, 4))[0] - 0xA10000,
                                         "cutoff": struct.unpack("<h", emulator.mem_read(0x514624, 2))[0],
                                         "skip": list(struct.unpack("<ii", emulator.mem_read(0x514614, 8)))})
                    if address in (0x4618C0, 0x461D14, 0x461170, 0x46152C):
                        calls.append(hex(address))
                        if address in (0x461170, 0x46152C):
                            shadow.append(bytes(emulator.mem_read(destination, len(before))))

                def read_hook(emulator, access, address, size, value, data):
                    reads.add(address - remap_address)

                for entry in (0x4618C0, 0x461D14, 0x461170, 0x46152C, 0x468927, 0x461090):
                    machine.hook_add(UC_HOOK_CODE, code_hook, begin=entry, end=entry)
                machine.hook_add(UC_HOOK_MEM_READ, read_hook, begin=remap_address, end=remap_address + len(remap) - 1)
                machine.emu_start(0x4549F6, 0x454AE5, count=3000000)
                assert machine.reg_read(UC_X86_REG_EIP) == 0x454AE5
                output = bytes(machine.mem_read(destination, len(before)))
                assert len(shadow) == 1
                return {"child": child, "queuedX": queued_x, "baseline": baseline,
                        "camera": {"x": camera_x, "y": camera_y, "width": pitch, "height": rows},
                        "reflection": reflection, "phase": phase, "selector": selector, "sourceCell": cell, "attributes": attributes,
                        "calls": calls, "cutoffs": cutoffs, "segments": segments, "remapOffsets": sorted(reads),
                        "before": base64.b64encode(before).decode(),
                        "shadow": base64.b64encode(shadow[0]).decode(),
                        "output": base64.b64encode(output).decode()}

            results.append({"bank": bank, "fin": fin, "remap": remap_source, "palette": palette,
                            "raster": SOURCE.raster_probe(sections, children, capture)})
    print(json.dumps({"sha256": terrain.DIGEST, "runtimeInterceptions": 0, "cases": results}))


if __name__ == "__main__":
    main()