"""Original TRSC and terrain pixels through native ordinary admission and mask writer."""

import importlib.util
import base64
import json
from pathlib import Path
import struct

from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX
from unicorn.x86_const import UC_X86_REG_EBP, UC_X86_REG_ESI, UC_X86_REG_ESP, UC_X86_REG_EIP

SPEC = importlib.util.spec_from_file_location("scene", Path(__file__).with_name("scene-occlusion-20260919.py"))
SCENE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCENE)
TERRAIN = SCENE.TERRAIN
ROOT = SCENE.ROOT


def source(path):
    data = (ROOT / path).read_bytes()
    return data, {"path": path, "sha256": TERRAIN.hashlib.sha256(data).hexdigest()}


def fin_source(timeline=254, name="TRSC"):
    data, evidence = source(f"raw_cd/DC/ANIMATE/{name}.FIN")
    tag, timelines, states, sprites = struct.unpack_from("<4H", data)
    assert tag == 29
    headers = 8 + sprites * 8 + states * 20
    cursor = headers + timelines * 164
    assert 0 <= timeline < timelines
    for previous in range(timeline):
        cursor += struct.unpack_from("<H", data, headers + previous * 164)[0] * 22
    count = struct.unpack_from("<H", data, headers + timeline * 164)[0]
    evidence["timeline"] = timeline
    children = []
    for index in range(count):
        record = data[cursor + index * 22:cursor + (index + 1) * 22]
        frame, horizontal, vertical, layer, flags, mode, mirror = struct.unpack_from("<HhhhHHH", record, 8)
        children.append({"sprite": record[:8].split(b"\0", 1)[0].decode(), "frame": frame,
                         "x": horizontal, "y": vertical, "layer": layer, "flags": flags,
                         "valueA": mode, "valueB": mirror})
    return children, evidence


def sprite_source(name, frame):
    data, evidence = source(f"raw_cd/DC/SPRITES/{name.upper()}.SPR")
    flags, count = struct.unpack_from("<HH", data)
    assert flags == 0x81
    cursor = 776 + count * 8
    for index in range(count):
        length = struct.unpack_from("<I", data, cursor)[0]
        cursor += 4
        if index == frame:
            return struct.unpack_from("<4H", data, 776 + index * 8), data[cursor:cursor + length], evidence
        cursor += length
    raise AssertionError("Missing source frame")


def install_children(machine, children):
    for index, child in enumerate(children):
        dimensions, raster, _ = sprite_source(child["sprite"], child["frame"])
        descriptor = 0xA10000 + index * 0x100
        frames = 0xA20000 + index * 0x10000
        payload = 0xB00000 + index * 0x10000
        TERRAIN.write_word(machine, descriptor + 8, frames)
        machine.mem_write(frames + child["frame"] * 24, struct.pack("<4HII", *dimensions, 0, payload))
        machine.mem_write(payload, raster)
        horizontal = (child["x"] * 8 + 32768) % 65536 - 32768
        vertical = (-child["y"] * 8 + 32768) % 65536 - 32768
        machine.mem_write(0xA00000 + index * 20, struct.pack("<IHhhHHHHH", descriptor, child["frame"],
                          horizontal, vertical, child["layer"] & 65535, child["flags"], child["valueA"], child["valueB"], 0))


def admission_probe(sections, children):
    cases = [
        ("ordinary", {}, len(children)), ("inactive", {"status": 0}, 0),
        ("spy-disabled", {"type": 37, "spy": 0}, 0),
        ("unseen", {"visibility": 0}, 0), ("unseen-reveal", {"visibility": 0, "reveal": 1}, len(children)),
        ("concealed-enemy", {"concealed": 1, "team": 1}, 0),
        ("detected-enemy", {"concealed": 1, "team": 1, "detected": 1}, len(children)),
        ("concealed-own", {"concealed": 1}, len(children)),
        ("outside-exclusive-bound", {"right": 1}, 0),
        ("completed-bank", {"bankMode": 2}, 0),
        ("finish-once-bank", {"bankMode": 1, "bankFrame": 1}, 0),
        ("loop-bank", {"bankFrame": 1}, len(children)),
        ("capacity-one", {"accepted": 799}, 1), ("capacity-full", {"accepted": 800}, 0),
    ]
    results = []
    for name, overrides, expected in cases:
        values = dict(status=1, type=0, team=0, spy=1, visibility=1, reveal=0, concealed=0,
                      detected=0, right=128, bankMode=0, bankFrame=0, accepted=0)
        values.update(overrides)
        machine = TERRAIN.machine_for(sections)
        machine.mem_map(0x800000, 0x500000)
        game, frame, entity = 0x800000, 0x728000, 0x800000 + 0x7D28 + 152 * 220
        install_children(machine, children)
        machine.mem_write(entity, struct.pack("<3H", 384, 0, 384))
        machine.mem_write(entity + 6, bytes([values["type"], values["team"], 0, 0]))
        machine.mem_write(entity + 0x2C, bytes([values["status"]]))
        machine.mem_write(entity + 0xCA, bytes([values["detected"]]))
        for offset in (0x14, 0x1C, 0x24):
            TERRAIN.write_word(machine, entity + offset, 0x980000)
            machine.mem_write(entity + offset + 4, bytes([values["bankFrame"] if offset == 0x14 else 0, 0,
                                                        values["bankMode"] if offset == 0x14 else 2]))
        machine.mem_write(0x980000, struct.pack("<32I", *([0x981000] * 32)))
        TERRAIN.write_word(machine, 0x981020, 0x982000)
        TERRAIN.write_word(machine, 0x981028, 1)
        machine.mem_write(0x982000, struct.pack("<HHI", len(children), 0, 0xA00000))
        for address, value in ((frame - 0x10, game), (frame - 0xC, entity), (frame + 0x14, 0),
                               (frame + 0x18, values["reveal"]), (frame - 0x6C, 0), (frame - 0x68, 0),
                               (frame - 0x64, values["right"]), (frame - 0x60, 128),
                               (game + 0x46F2C, 0x900000), (game + 0x19C0, 1), (game + 0xBE4, values["spy"]),
                               (0x900808, 0x910000), (0x910004, values["visibility"]),
                               (0x4F18E8 + values["type"] * 280, values["concealed"]),
                               (0x4E6840, 0x920000), (0x9BA4BC, 32768), (0x4E6864, values["accepted"])):
            TERRAIN.write_word(machine, address, value)
        machine.mem_write(frame - 4, b"\1")
        machine.reg_write(UC_X86_REG_EBP, frame)
        machine.reg_write(UC_X86_REG_ESI, 152)
        machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
        machine.emu_start(0x439B6D, 0x439B54, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x439B54, name
        accepted = struct.unpack("<I", machine.mem_read(0x4E6864, 4))[0] - values["accepted"]
        assert accepted == expected, (name, accepted, expected)
        queued = []
        for index in range(accepted):
            record = machine.mem_read(0x4E10AC + (values["accepted"] + index) * 28, 28)
            queued.append({"submissionWord": struct.unpack_from("<I", record, 8)[0],
                           "position": list(struct.unpack_from("<hh", record, 12))})
        results.append({"name": name, "inputs": values, "accepted": accepted, "queued": queued,
                        "bankFrameAfter": machine.mem_read(entity + 0x18, 1)[0],
                        "bankModeAfter": machine.mem_read(entity + 0x1A, 1)[0]})
    return results


def raster_probe(sections, children, mode1_capture=None, capture_mode=1):
    bts, bts_evidence = source("raw_cd/DC/SCENARIO/DESERT.BTS")
    raw_map, map_evidence = source("raw_cd/DC/SCENARIO/HUMAN/HUMAN01.MAP")
    width, height = struct.unpack_from("<II", raw_map)
    _, records = struct.unpack_from("<II", bts)
    lookup, tiles = {}, []
    for index in range(records):
        offset = 776 + index * 1028
        lookup[struct.unpack_from("<I", bts, offset)[0]] = index
        tiles.append(bts[offset + 4:offset + 1028])
    pairs = [tuple(lookup.get(key, 0) for key in struct.unpack_from("<HH", raw_map, 8 + index * 4))
             for index in range(width * height)]
    attributes = struct.unpack_from(f"<{width * height}H", raw_map, 8 + width * height * 4)
    child_index = next(index for index, child in enumerate(children) if child["flags"] == 16 and
                       child["valueA"] == (capture_mode if mode1_capture else 0) and child["valueB"] in (0, 1) and child["layer"] in (0, 1))
    child = children[child_index]
    dimensions, raster, sprite_evidence = sprite_source(child["sprite"], child["frame"])
    sprite_width, sprite_height, anchor, _ = dimensions
    mirrored = child["valueB"] == 1
    anchor_offset = 1 if mirrored else anchor
    writer = 0x46152C if mirrored else 0x461170
    results = []
    cases = [(reflection, negative_edge, phase) for phase in ((0, 1) if mirrored or mode1_capture else (0,))
             for reflection, negative_edge in ((False, False), (True, False), (False, True), (True, True))]
    for reflection, negative_edge, phase in cases:
        choose_cell = min if mode1_capture and negative_edge else max
        margin = 8 if mode1_capture else 5
        cell = choose_cell((index for index, pair in enumerate(pairs) if pair[1] and attributes[index] & 15
                and bool(attributes[index] & 0x40) == reflection and margin <= index % width < width - margin - 1
                and margin <= index // width < height - margin - 1), key=lambda index: attributes[index] & 15)
        placement_offset = 8 if mirrored and negative_edge else 0
        baseline = cell // width * 32 + 16 + phase + placement_offset
        if mode1_capture and negative_edge:
            baseline = cell // width * 32 + phase
        queued_x = cell % width * 32 + 8 - anchor_offset + phase + placement_offset
        left, top = queued_x + anchor_offset, baseline - sprite_height
        camera_x, camera_y = (left // 32 - 1) * 32, (top // 32 - 1) * 32
        if negative_edge and not mirrored and not mode1_capture:
            camera_x, camera_y = (cell % width + 1) * 32, cell // width * 32
            queued_x, baseline = camera_x - 5 - anchor_offset + phase, camera_y - 6 + sprite_height + phase
            left, top = queued_x + anchor_offset, baseline - sprite_height
        if mode1_capture:
            camera_x = (left // 32 - 3) * 32
            camera_y = (top // 32 - 2) * 32
        pitch, rows = (320, 256) if mode1_capture else (192, 192)
        machine = TERRAIN.machine_for(sections)
        machine.mem_map(0x800000, 0x400000)
        sprite, payload, masks, destination, view, cells = 0xA00000, 0xA01000, 0xA10000, 0xA20000, 0xA30000, 0xA40000
        if mode1_capture:
            destination = 0xA80000
        machine.mem_write(sprite, struct.pack("<4HII", *dimensions, 0, payload))
        machine.mem_write(payload, raster)
        machine.mem_write(TERRAIN.REMAP, bytes(range(256)) * 256)
        machine.mem_write(destination, bytes([0xEE]) * (pitch * rows))
        for map_row in range(height):
            TERRAIN.write_word(machine, 0x800004 + map_row * 4, cells + map_row * width * 4)
            for column in range(width):
                index = map_row * width + column
                background, foreground = pairs[index]
                attribute = attributes[index] if foreground else attributes[index] & ~15
                TERRAIN.write_word(machine, cells + index * 4,
                                   (background | foreground << 11 | attribute << 22) & 0xFFFFFFFF)
        for tile_row in range(rows // 32):
            for tile_column in range(pitch // 32):
                index = (camera_y // 32 + tile_row) * width + camera_x // 32 + tile_column
                background, foreground = pairs[index]
                attribute = attributes[index]
                machine.mem_write(TERRAIN.BACKGROUND, tiles[background])
                machine.mem_write(TERRAIN.FOREGROUND, tiles[foreground])
                coverage = [sum(int(tiles[foreground][row * 32 + column] != 0) << (31 - column)
                                for column in range(32)) if foreground else 0 for row in range(32)]
                machine.mem_write(TERRAIN.MASK, struct.pack("<32I", *coverage))
                for row, mask in enumerate(coverage):
                    if attribute & 0x40:
                        mask = int(f"{mask:032b}"[::-1], 2)
                    TERRAIN.write_word(machine, masks + ((tile_row * 32 + row) * (pitch // 32) + tile_column) * 4, mask)
                for address, value in ((0x4891E8, TERRAIN.FOREGROUND), (0x4891EC, TERRAIN.BACKGROUND),
                                       (0x4891F0, TERRAIN.LIGHT), (0x4891F4, TERRAIN.MASK),
                                       (0x4891F8, destination + tile_row * 32 * pitch + tile_column * 32),
                                       (0x4891FC, TERRAIN.REMAP), (0x489200, 32), (0x489204, pitch), (0x489214, 4)):
                    TERRAIN.write_word(machine, address, value)
                selector = (attribute >> 5) & (3 if foreground else 1)
                table = 0x47C030 if foreground else 0x47C040
                entry = struct.unpack("<I", machine.mem_read(table + selector * 4, 4))[0]
                machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
                TERRAIN.write_word(machine, TERRAIN.STACK, TERRAIN.STOP)
                machine.emu_start(entry, TERRAIN.STOP, count=100000)
                assert machine.reg_read(UC_X86_REG_EIP) == TERRAIN.STOP
        before = bytes(machine.mem_read(destination, pitch * rows))
        for address, value in ((view, camera_x), (view + 4, camera_y), (view + 8, destination),
                               (view + 20, 0x800000), (view + 24, masks), (0x89A4B0, width), (0x89A4B4, height),
                               (0x4891FC, TERRAIN.REMAP)):
            TERRAIN.write_word(machine, address, value)
        machine.mem_write(view + 12, struct.pack("<HHH", pitch, rows, pitch))
        if mode1_capture:
            results.append(mode1_capture(machine, child, sprite, destination, view, before,
                                         queued_x, baseline, camera_x, camera_y, pitch, rows,
                                         reflection, phase, cell, attributes[cell]))
            continue
        def draw_body(bypass):
            machine.mem_write(0x516DB4, struct.pack("<H", bypass))
            machine.reg_write(UC_X86_REG_EAX, sprite)
            machine.reg_write(UC_X86_REG_EDX, queued_x)
            machine.reg_write(UC_X86_REG_EBX, baseline)
            machine.reg_write(UC_X86_REG_ECX, 0)
            machine.reg_write(UC_X86_REG_ESP, TERRAIN.STACK)
            machine.mem_write(TERRAIN.STACK, struct.pack("<II", TERRAIN.STOP, view))
            machine.emu_start(writer, TERRAIN.STOP, count=3000000)
            assert machine.reg_read(UC_X86_REG_EIP) == TERRAIN.STOP
        draw_body(0)
        output = bytes(machine.mem_read(destination, pitch * rows))
        machine.mem_write(destination, before)
        draw_body(1)
        unmasked = bytes(machine.mem_read(destination, pitch * rows))
        crop_x, crop_y = left + sprite_width // 2 - camera_x, top + sprite_height // 3 - camera_y
        cropped = b"".join(output[(crop_y + row) * pitch + crop_x:(crop_y + row) * pitch + crop_x + 32] for row in range(32))
        results.append({"sourceCell": cell, "attributes": attributes[cell], "reflection": reflection,
                        "negativeEdge": negative_edge and not mirrored, "alternatePlacement": negative_edge and mirrored,
                        "mirrored": mirrored, "phase": phase, "writer": hex(writer), "anchorX": anchor,
                        "childIndex": child_index, "queuedX": queued_x, "baseline": baseline,
                        "camera": {"x": camera_x, "y": camera_y, "width": pitch, "height": rows},
                        "cropCamera": {"x": camera_x + crop_x, "y": camera_y + crop_y, "width": 32, "height": 32},
                        "backgroundSha256": TERRAIN.hashlib.sha256(before).hexdigest(),
                        "framebufferBase64": base64.b64encode(output).decode(),
                        "framebufferSha256": TERRAIN.hashlib.sha256(output).hexdigest(),
                        "cropSha256": TERRAIN.hashlib.sha256(cropped).hexdigest(),
                        "changedPixels": sum(left != right for left, right in zip(before, output)),
                        "maskDifferencePixels": sum(left != right for left, right in zip(unmasked, output))})
    return {"sources": [bts_evidence, map_evidence, sprite_evidence], "frames": results}


def main():
    sections = TERRAIN.load_image(ROOT / "raw_cd/DC/DC.EXE")
    children, fin = fin_source()
    mirrored_children, mirrored_fin = fin_source(276)
    print(json.dumps({"sha256": TERRAIN.DIGEST, "fin": fin, "children": children,
                      "runtimeInterceptions": 0, "admission": admission_probe(sections, children),
                      "raster": raster_probe(sections, children),
                      "mirrored": {"fin": mirrored_fin, "children": mirrored_children,
                                   "raster": raster_probe(sections, mirrored_children)}}, sort_keys=True))


if __name__ == "__main__":
    main()