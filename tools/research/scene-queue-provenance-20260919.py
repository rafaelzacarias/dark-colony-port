"""Execute native scene counter/queue admission; caller order remains a separate gate."""

import importlib.util
import json
from pathlib import Path
import struct

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
    UC_X86_REG_EBP, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESP,
)

SPEC = importlib.util.spec_from_file_location("scene_probe", Path(__file__).with_name("scene-occlusion-20260919.py"))
SCENE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCENE)
TERRAIN = SCENE.TERRAIN


def counter_probe(sections):
    machine = TERRAIN.machine_for(sections)
    machine.mem_map(0x800000, 0x100000)
    TERRAIN.write_word(machine, 0x4E6840, 0x800000)
    TERRAIN.write_word(machine, 0x89A4BC, 32768)
    machine.mem_write(0x708000, struct.pack("<HHHHII", 48, 160, 0, 0, 0, 0x709000))

    def call(address, arguments=()):
        machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
        machine.mem_write(TERRAIN.STACK, struct.pack("<" + "I" * (1 + len(arguments)), TERRAIN.STOP, *arguments))
        machine.emu_start(address, TERRAIN.STOP, count=1000)
        assert machine.reg_read(UC_X86_REG_EIP) == TERRAIN.STOP

    def word(address):
        return struct.unpack("<I", machine.mem_read(address, 4))[0]

    results = []
    for seed in (0, 1, 7, 8, 9, 255, 256, 257, 65535, 0xFFFFFFFF):
        call(0x435FB0)
        assert word(0x4E6864) == 0
        machine.reg_write(UC_X86_REG_EAX, seed)
        call(0x435FC0)
        reset = word(0x4E685C)
        assert reset == seed & 0xFFFFFFF8
        submissions = []
        for child in range(3):
            machine.reg_write(UC_X86_REG_EAX, 384)
            machine.reg_write(UC_X86_REG_EDX, 31087)
            machine.reg_write(UC_X86_REG_EBX, 0)
            machine.reg_write(UC_X86_REG_ECX, 0)
            call(0x435FCC, (0, 0, 0x708000, 0))
            submissions.append(word(0x4E10B4 + 28 * child))
            assert submissions[-1] == (reset - child) & 0xFFFFFFFF
            assert word(0x4E6864) == child + 1
            assert word(0x4E685C) == (reset - child - 1) & 0xFFFFFFFF
        results.append({"seed": seed, "reset": reset, "submissions": submissions})
    TERRAIN.write_word(machine, 0x4E6864, 800)
    before = word(0x4E685C)
    call(0x435FCC, (0, 0, 0x708000, 0))
    assert word(0x4E6864) == 800 and word(0x4E685C) == before
    projections = []
    for q10 in (0, 1, 2, 3, 4, 29, 30, 31, 32, 33, 1023, 1024, 1025, 1026, 1027):
        q8 = (q10 + 2) // 4
        call(0x435FB0)
        machine.reg_write(UC_X86_REG_EAX, q8)
        machine.reg_write(UC_X86_REG_EDX, q8)
        machine.reg_write(UC_X86_REG_EBX, 0)
        machine.reg_write(UC_X86_REG_ECX, 0)
        call(0x435FCC, (0, 0, 0x708000, 0))
        horizontal, vertical = struct.unpack("<hh", machine.mem_read(0x4E10B8, 4))
        assert (horizontal, vertical) == (q8 >> 3, (32768 - q8 - 1) >> 3)
        projections.append({"q10": q10, "q8": q8, "x": horizontal, "y": vertical})
    return {"resets": results, "fullQueueLeavesCounterUnchanged": True, "q10Projection": projections}


def direct_callers(sections, target):
    callers = []
    for base, payload in sections:
        if base != 0x401000:
            continue
        for offset in range(len(payload) - 4):
            if payload[offset] == 0xE8 and base + offset + 5 + struct.unpack_from("<i", payload, offset + 1)[0] == target:
                callers.append(hex(base + offset))
    return callers


def dispatch_probe(sections):
    spec = importlib.util.spec_from_file_location("placement_probe", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    results = []
    for name in ("HUMAN02", "ALIEN02"):
        source = placement.stream(name)
        machine = TERRAIN.machine_for(sections)
        machine.mem_map(0x800000, 0x200000)
        game, frame, terrain = 0x800000, 0x728000, 0x900000
        records = [record for record in source["records"] if "slot" in record]
        for record in records:
            machine.mem_write(game + 0x7D28 + record["slot"] * 220, bytes.fromhex(record["entityHex"]))
        TERRAIN.write_word(machine, frame - 0x10, game)
        TERRAIN.write_word(machine, frame - 0xC, game + 0x7D28)
        TERRAIN.write_word(machine, frame + 0x14, 0)
        TERRAIN.write_word(machine, frame + 0x18, 0)
        machine.mem_write(frame - 0x7C, struct.pack("<4I", 1, 2, 4, 4))
        TERRAIN.write_word(machine, game + 0x46F2C, terrain)
        for row in range(4):
            TERRAIN.write_word(machine, terrain + 0x804 + row * 4, 0x9A0000 + row * 1024)
        visits, active, cells = [], [], []

        def observe(emulator, address, size, user_data):
            if address == 0x439B6D:
                visits.append(emulator.reg_read(UC_X86_REG_ESI))
            elif address == 0x43961C:
                active.append(emulator.reg_read(UC_X86_REG_ESI))
                emulator.reg_write(UC_X86_REG_EIP, 0x439B54)
            elif address == 0x444C80:
                stack = emulator.reg_read(UC_X86_REG_ESP)
                emulator.reg_write(UC_X86_REG_EAX, 0)
                emulator.reg_write(UC_X86_REG_EIP, struct.unpack("<I", emulator.mem_read(stack, 4))[0])
                emulator.reg_write(UC_X86_REG_ESP, stack + 4)
            elif address == 0x439C5B:
                cells.append([emulator.reg_read(UC_X86_REG_EDI), struct.unpack("<I", emulator.mem_read(frame - 0x18, 4))[0]])

        machine.hook_add(UC_HOOK_CODE, observe)
        machine.reg_write(UC_X86_REG_EBP, frame)
        machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
        machine.emu_start(0x439615, 0x439D7D, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x439D7D
        assert visits == list(range(800))
        expected = [record["slot"] for record in records if bytes.fromhex(record["entityHex"])[0x2C]]
        assert active == expected
        assert cells == [[column, row] for column in range(1, 4) for row in range(2, 4)]
        results.append({"scenario": name, "sourceSha256": source["sourceSha256"], "visitedSlots": len(visits),
                        "activeSlots": active, "mapCells": cells, "sourceEntity": records[0],
                        "interceptions": ["43961c: skip entity admission/body", "444c80: unseen empty low-slot city"],
                        "renderAdmissionVerified": False})
    return results


def child_probe(sections, entity):
    results = []
    for filename in (SCENE.ROOT / "raw_cd/DC/ANIM.DAT").read_text().splitlines():
        path = SCENE.ROOT / "raw_cd/DC/ANIMATE" / filename.strip().upper()
        data = path.read_bytes()
        if len(data) < 8:
            continue
        tag, timeline_count, state_count, sprite_count = struct.unpack_from("<4H", data)
        if tag != 29:
            continue
        timelines = 8 + sprite_count * 8 + state_count * 20
        cursor = timelines + timeline_count * 164
        for timeline in range(timeline_count):
            count = struct.unpack_from("<H", data, timelines + timeline * 164)[0]
            children = [data[cursor + index * 22:cursor + (index + 1) * 22] for index in range(count)]
            cursor += count * 22
            if not 2 <= count <= 8:
                continue
            machine = TERRAIN.machine_for(sections)
            machine.mem_map(0x800000, 0x100000)
            machine.mem_map(0x1000000, 0x200000)
            frame, entity_address, timeline_address, children_address = 0x728000, 0x80A000, 0x708000, 0x709000
            machine.mem_write(entity_address, bytes.fromhex(entity["entityHex"]))
            origin_x, height, origin_y = struct.unpack("<3H", machine.mem_read(entity_address, 6))
            TERRAIN.write_word(machine, 0x4E6840, 0x800000)
            TERRAIN.write_word(machine, 0x89A4BC, 32768)
            TERRAIN.write_word(machine, frame - 0xC, entity_address)
            TERRAIN.write_word(machine, frame - 0x10, 0x800000)
            TERRAIN.write_word(machine, frame - 0x54, timeline_address)
            machine.mem_write(frame - 4, b"\1")
            machine.mem_write(timeline_address, struct.pack("<HHI", count, 0, children_address))
            expected = []
            for index, child in enumerate(children):
                sprite_frame, horizontal, vertical, layer, flags, mode, mirror = struct.unpack_from("<HhhhHHH", child, 8)
                descriptor = 0x70A000 + index * 16
                frames = 0x1000000 + index * 0x20000
                TERRAIN.write_word(machine, descriptor + 8, frames)
                machine.mem_write(frames + sprite_frame * 24, struct.pack("<HHHHII", 48, 160, 0, 0, 0, 0x709000))
                loaded_x = (horizontal * 8 + 32768) % 65536 - 32768
                loaded_y = (-vertical * 8 + 32768) % 65536 - 32768
                machine.mem_write(children_address + index * 20,
                                  struct.pack("<IHhhHHHHH", descriptor, sprite_frame, loaded_x, loaded_y,
                                              layer & 65535, flags, mode, mirror, 0))
                expected.append({"sprite": child[:8].split(b"\0", 1)[0].decode("ascii"), "frame": sprite_frame,
                                 "childX": horizontal, "childY": vertical, "layer": layer & 255,
                                 "flags": flags, "mode": mode, "mirror": mirror,
                                 "submissionWord": ((origin_y & ~7) - index) & 0xFFFFFFFF,
                                 "x": (origin_x + loaded_x) >> 3,
                                 "y": (32768 - origin_y - loaded_y - 1) >> 3,
                                 "heightOffset": -(height >> 3)})
            machine.reg_write(UC_X86_REG_EBP, frame)
            machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
            machine.emu_start(0x4398FB, 0x4399DC, count=10000)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x4399DC
            assert struct.unpack("<I", machine.mem_read(0x4E6864, 4))[0] == count
            for index, child in enumerate(expected):
                queued = bytes(machine.mem_read(0x4E10AC + index * 28, 28))
                assert struct.unpack_from("<I", queued, 8)[0] == child["submissionWord"]
                assert struct.unpack_from("<hh", queued, 12) == (child["x"], child["y"])
                assert struct.unpack_from("<h", queued, 18)[0] == child["heightOffset"]
                assert queued[21] == child["layer"]
            results.append({"source": str(path.relative_to(SCENE.ROOT)), "sha256": TERRAIN.hashlib.sha256(data).hexdigest(),
                            "timeline": timeline, "originQ8": [origin_x, origin_y, height],
                            "mapHeightQ8": 32768, "children": expected, "runtimeInterceptions": 0,
                            "spriteHeaders": "synthetic valid dimensions; source FIN offsets/order unchanged"})
            break
        if len(results) == 4:
            break
    assert len(results) == 4
    return results


def main():
    sections = TERRAIN.load_image(SCENE.ROOT / "raw_cd/DC/DC.EXE")
    dispatch = dispatch_probe(sections)
    print(json.dumps({"sha256": TERRAIN.DIGEST, "counter": counter_probe(sections),
                      "dispatch": dispatch, "children": child_probe(sections, dispatch[0]["sourceEntity"]),
                      "directCallCandidates": {hex(target): direct_callers(sections, target)
                                               for target in (0x435FB0, 0x435FC0, 0x435FCC)}}, sort_keys=True))


if __name__ == "__main__":
    main()