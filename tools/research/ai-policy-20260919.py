"""Hash-pinned AI callback goldens and fail-closed mission activation research."""

import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("mission_actions", Path(__file__).with_name("mission-actions.py"))
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDX, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
    UC_X86_REG_GDTR, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS,
)

RETURN = 0x70D000
POLICY = 0x880000
MAP = 0x900000
PATH_ROWS = 0x9A0000
GROUND = 0x9B0000
PATH_CELLS = 0xA00000
GROUP_STRIDE = 0x12FC
SOURCE_HASHES = {
    "HUMAN": (
        "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab",
        "ea7377f73ad1d02974d8b2c04d929d3805f591a12b870254a8d466b65685f3c5",
        "623c4e65f710527bc27f02f99644eb13828a3f4aaf533a1fd4f4accc8d3ba2df",
    ),
    "ALIEN": (
        "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e",
        "d5ab938493b41614ef12f2640b152970e5aad8668a15e4709d6db3df80c18bae",
        "1e6633ca04693915fb2187d06fa16f4a52c973c5eb6617e73afd7797a0850155",
    ),
}
CALLBACKS = (
    (0x4578A0, 0x44B920, 0x4598B0, 0x44BBDC, 0x459D98, 0x459E40),
    (0x4578A0, 0x4593A8, 0x463E78, 0x44BBEC, 0x44B6A4, 0x459660),
    (0x4578A0, 0x458B44, 0x463E78, 0x44BBEC, 0x44B6A4, 0x458F3C),
    (0x459F24, 0x44B920, 0x459F80, 0x44BBDC, 0x44B6A4, 0x45A724),
)


def dword(machine, address):
    return struct.unpack("<I", machine.mem_read(address, 4))[0]


def put(machine, address, value):
    machine.mem_write(address, struct.pack("<I", value))


def switch_to_mode3(machine, team):
    machine.mem_write(NATIVE.ACTION + 4, struct.pack("<hh", team, 3))
    machine.reg_write(UC_X86_REG_ESI, NATIVE.ACTION)
    machine.reg_write(UC_X86_REG_EDI, NATIVE.GAME)
    machine.emu_start(0x43D840, 0x43D822, count=100)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x43D822
    assert dword(machine, NATIVE.GAME + 0xBBC + team * 0xE30) == 3


def call(machine, address, team):
    put(machine, NATIVE.STACK, RETURN)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EDX, team)
    machine.emu_start(address, RETURN, count=1000000)


def invoke(machine, address, instruction_limit=5000000, **registers):
    put(machine, NATIVE.STACK, RETURN)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    for name, value in registers.items():
        machine.reg_write(globals()["UC_X86_REG_" + name.upper()], value)
    machine.emu_start(address, RETURN, count=instruction_limit)
    assert machine.reg_read(UC_X86_REG_EIP) == RETURN, (
        f"native entry={address:#x} instruction limit={instruction_limit} exhausted at "
        f"{machine.reg_read(UC_X86_REG_EIP):#x}")


def fixture():
    machine = NATIVE.machine_for_probe()
    machine.ai_output_boundaries = []
    machine.mem_write(0x707000, bytes(8) + bytes.fromhex("ffff0000009acf00ffff00000092cf00"))
    machine.reg_write(UC_X86_REG_GDTR, (0, 0x707000, 23, 0))
    machine.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
        machine.reg_write(register, 16)
    machine.mem_map(MAP, 0x200000)

    def diagnostics(emulator, address, size, data):
        if address in (0x46C996, 0x46CB3E):
            stack = emulator.reg_read(UC_X86_REG_ESP)
            caller = dword(emulator, stack)
            if address == 0x46C996 and caller in (0x43AF42, 0x43AF68):
                emulator.ai_output_boundaries.append({"kind": "broadcast-debug-output", "caller": hex(caller),
                    "arguments": bytes(emulator.mem_read(stack + 4, 20)).hex()})
                emulator.reg_write(UC_X86_REG_EAX, 0)
                emulator.reg_write(UC_X86_REG_EIP, caller)
                emulator.reg_write(UC_X86_REG_ESP, stack + 4)
                return
            raise AssertionError(f"native diagnostic at {address:#x}; caller={dword(emulator, stack):#x}; "
                                 f"stack={bytes(emulator.mem_read(stack + 4, 20)).hex()}")

    for address in (0x46C996, 0x46CB3E):
        machine.hook_add(UC_HOOK_CODE, diagnostics, begin=address, end=address)
    return machine


def initialize_fresh_game(machine):
    storage = {0x471B0: NATIVE.GAME, 0x2000: 0x858000}
    for length, pointer in storage.items():
        machine.mem_write(pointer, b"\xa5" * length)
        for register, value in ((UC_X86_REG_ECX, pointer - 16), (UC_X86_REG_EDI, length),
                                (UC_X86_REG_ESI, 0x705000), (UC_X86_REG_EDX, 0)):
            machine.reg_write(register, value)
        machine.emu_start(0x40BDDC, 0x40BDEF, count=1000000)
        assert machine.mem_read(pointer, length) == bytes(length)
    allocations = []

    def allocate(emulator, address, size, data):
        length = emulator.reg_read(UC_X86_REG_EDX)
        allocations.append(length)
        stack = emulator.reg_read(UC_X86_REG_ESP)
        emulator.reg_write(UC_X86_REG_EAX, storage[length])
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hook = machine.hook_add(UC_HOOK_CODE, allocate, begin=0x40BCC0, end=0x40BCC0)
    invoke(machine, 0x40C0A0, eax=0x703000)
    machine.hook_del(hook)
    assert allocations == [0x471B0, 0x2000]
    assert machine.reg_read(UC_X86_REG_EAX) == NATIVE.GAME
    assert dword(machine, NATIVE.GAME + 0x958) == 0x858000
    assert [dword(machine, NATIVE.GAME + 0xC9C + owner * 0xE30) for owner in range(8)] == list(range(8))


def initialize_source_path(machine, content, width, height):
    cursor = 0
    allocations = []

    def file_boundary(emulator, address, size, data):
        nonlocal cursor
        stack = emulator.reg_read(UC_X86_REG_ESP)
        if address == 0x40BCC0:
            length = emulator.reg_read(UC_X86_REG_EDX)
            assert length == 0x238
            allocations.append(length)
            pointer = PATH_ROWS
            emulator.mem_write(pointer, b"\xa5" * length)
            result = pointer
        elif address == 0x40625C:
            result = 0x708000
        elif address == 0x406378:
            length = emulator.reg_read(UC_X86_REG_EDX)
            assert length == 65536 and cursor == 0
            emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), content[:length])
            cursor += length
            result = length
        elif address == 0x406348:
            result = content[cursor]
            cursor += 1
        else:
            assert cursor == len(content)
            result = 0
        emulator.reg_write(UC_X86_REG_EAX, result)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hooks = [machine.hook_add(UC_HOOK_CODE, file_boundary, begin=address, end=address)
             for address in (0x40BCC0, 0x40625C, 0x406378, 0x406348, 0x40636C)]
    put(machine, NATIVE.STACK, RETURN)
    put(machine, NATIVE.STACK + 4, height)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.reg_write(UC_X86_REG_EAX, 0x703000)
    machine.reg_write(UC_X86_REG_EDX, NATIVE.SOURCE)
    machine.reg_write(UC_X86_REG_EBX, MAP + 0x1404)
    machine.reg_write(UC_X86_REG_ECX, width)
    machine.emu_start(0x442B7C, RETURN, count=5000000)
    for hook in hooks:
        machine.hook_del(hook)
    assert machine.reg_read(UC_X86_REG_EIP) == RETURN
    assert cursor == len(content) and allocations == [0x238]
    rows = dword(machine, MAP + 0x1404)
    for tile_y in range(height):
        for tile_x in range(width):
            cell = dword(machine, rows + tile_y * 4) + tile_x * 24
            assert dword(machine, cell) == 0 and dword(machine, cell + 4) == 0xFFFFFFFF
            assert machine.mem_read(cell + 8, 2) == bytes((tile_x, tile_y))
            assert machine.mem_read(cell + 12, 2) == bytes((content[65536 + tile_y * width + tile_x], 0))
    assert machine.mem_read(MAP + 0x884A8, 65536) == content[:65536]
    return {"entry": "0x442b7c", "bytesRead": cursor, "allocationBytes": allocations,
            "cellStride": 24, "familyOffset": 12, "cacheOffset": 13,
            "coordinateOffsets": [8, 9], "routeSentinelOffset": 4,
            "familyGraphSha256": hashlib.sha256(machine.mem_read(MAP + 0x984A8, 256 * 32)).hexdigest(),
            "sourceYMatches": True, "sourceSha256": hashlib.sha256(content).hexdigest()}


def source_fixture(faction, team, prepare=None, initialize_policy=True, fresh_game=False):
    machine = fixture()
    if fresh_game:
        initialize_fresh_game(machine)
    directory = NATIVE.ROOT / "raw_cd/DC/SCENARIO" / faction
    sources = {extension: (directory / f"{faction}02.{extension}").read_bytes()
               for extension in ("SCN", "MAP", "PTH")}
    assert tuple(hashlib.sha256(data).hexdigest() for data in sources.values()) == SOURCE_HASHES[faction]
    if prepare is not None:
        sources["MTG"] = (directory / f"{faction}02.MTG").read_bytes()
        assert hashlib.sha256(sources["MTG"]).hexdigest() == "615e95f568d1c83d750f63255b12de32db470a45017f4fe5fa02ed1336f0cc49"
    width, height = struct.unpack_from("<II", sources["MAP"])
    assert len(sources["PTH"]) == 65536 + width * height
    rows = [line.strip() for line in sources["SCN"].decode("ascii").splitlines()
            if line.strip() and not line.startswith("%")]
    start = next(index for index, line in enumerate(rows) if line.startswith(f"TEAM {team} "))
    city_rows = [tuple(map(int, rows[start + offset].split())) for offset in (8, 9)]
    assert city_rows == ([(56, 61), (0, 0)] if faction == "HUMAN" else [(7, 70), (0, 0)])
    assert int(rows[start + 3]) == 4
    unit_rows = [tuple(map(int, line.split())) for line in rows if len(line.split()) == 6]
    assert not any(row[2] in (6, 14) and row[3] == team for row in unit_rows)
    for offsets, values in zip(((0xBCC, 0xBD0), (0xBC4, 0xBC8)), city_rows):
        for offset, value in zip(offsets, values):
            put(machine, NATIVE.GAME + team * 0xE30 + offset, value)
    put(machine, NATIVE.GAME + 0x46F2C, MAP)
    put(machine, MAP + 0x9A4B0, width)
    put(machine, MAP + 0x9A4B4, height)
    put(machine, MAP + 0x1404, PATH_ROWS)
    machine.mem_write(MAP + 0x884A8, sources["PTH"][:65536])
    families = sources["PTH"][65536:]
    for tile_y in range(height):
        put(machine, PATH_ROWS + tile_y * 4, PATH_CELLS + tile_y * width * 24)
        put(machine, MAP + 0x804 + tile_y * 4, GROUND + tile_y * width * 4)
        machine.mem_write(GROUND + tile_y * width * 4, struct.pack("<I", 1023) * width)
        for tile_x in range(width):
            machine.mem_write(PATH_CELLS + (tile_y * width + tile_x) * 24 + 12,
                              bytes((families[tile_y * width + tile_x],)))
    machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
    machine.reg_write(UC_X86_REG_ESI, MAP + 0x1404)
    machine.reg_write(UC_X86_REG_EDI, 1)
    machine.emu_start(0x442E2B, 0x442E41, count=5000000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x442E41
    if fresh_game:
        machine.source_path_initialization = initialize_source_path(machine, sources["PTH"], width, height)
    if prepare is not None:
        prepare(machine, sources, width, height, rows)
    if not initialize_policy:
        return machine
    put(machine, NATIVE.GAME + 0x7D18, 0x703000)
    put(machine, NATIVE.GAME + 0xBBC + team * 0xE30, 4)
    switch_to_mode3(machine, team)
    allocations = []

    def initialize(emulator, address, size, data):
        if address == 0x40BCC0:
            assert emulator.reg_read(UC_X86_REG_EDX) == 0x6C40
            allocations.append(POLICY)
            stack = emulator.reg_read(UC_X86_REG_ESP)
            emulator.reg_write(UC_X86_REG_EAX, POLICY)
            emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
            emulator.reg_write(UC_X86_REG_ESP, stack + 4)
        elif address == 0x457568:
            emulator.emu_stop()
        elif address == 0x44BE36:
            emulator.ai_initialized_policy = bytes(emulator.mem_read(POLICY, 0x6C40))

    hooks = [machine.hook_add(UC_HOOK_CODE, initialize, begin=address, end=address)
             for address in (0x40BCC0, 0x457568, 0x44BE36)]
    put(machine, NATIVE.STACK, RETURN)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EDX, team)
    machine.emu_start(0x41AB20, RETURN, count=5000000)
    for hook in hooks:
        machine.hook_del(hook)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x457568
    assert allocations == [POLICY]
    assert dword(machine, NATIVE.GAME + 0xBC0 + team * 0xE30) == POLICY
    assert struct.unpack("<8I", machine.mem_read(POLICY + 0x6C14, 32)) == (192, 1, 1, 2, 4, 2, 4, 2)
    assert machine.mem_read(POLICY + 0x6A94, 18 * 12) == NATIVE.READ(0x48903C, 18 * 12)
    resource_rows = [tuple(map(int, line.split())) for line in rows
                     if len(line.split()) == 5 and line.split()[2] == "40"]
    for group in range(4):
        callbacks = struct.unpack("<6I", machine.mem_read(POLICY + group * GROUP_STRIDE + 0x3168, 24))
        assert callbacks == CALLBACKS[group]
    regions = [(families[tile_y * width + tile_x],
                machine.mem_read(POLICY + 18 * families[tile_y * width + tile_x] + 13, 1)[0])
               for tile_x, tile_y, *_ in resource_rows]
    assert regions == ([(21, 11), (214, 13), (70, 6), (160, 11)] if faction == "HUMAN"
                       else [(226, 4), (80, 21), (108, 17)])
    return machine, city_rows, resource_rows, width, families


def resource_probe(faction, team, control="baseline"):
    machine, city_rows, resource_rows, width, families = source_fixture(faction, team)
    slot = 200
    extractor = NATIVE.GAME + 0x7D28 + slot * 220
    tile_x, tile_y = city_rows[0]
    machine.mem_write(extractor, struct.pack("<H", tile_x * 256 + 128))
    machine.mem_write(extractor + 4, struct.pack("<H", tile_y * 256 + 128))
    machine.mem_write(extractor + 6, bytes((14 if faction == "HUMAN" else 6, team)))
    machine.mem_write(extractor + 0x2C, b"\x01")
    machine.mem_write(extractor + 0xD2, b"\xff\xff")
    machine.mem_write(POLICY + 0x1FAA, struct.pack("<h", slot))
    if control == "route-score":
        for region in range(256):
            machine.mem_write(POLICY + region * 18 + 8, b"\x07")
            machine.mem_write(POLICY + region * 18 + 10, b"\x01\x00")
    elif control == "no-route":
        origin = families[tile_y * width + tile_x]
        machine.mem_write(MAP + 0x884A8 + origin * 256, bytes(256))
    for index, (tile_x, tile_y, kind, rate, reserve) in enumerate(resource_rows):
        entity = NATIVE.GAME + 0x7D28 + (300 + index) * 220
        machine.mem_write(entity, struct.pack("<H", tile_x * 256 + 128))
        machine.mem_write(entity + 4, struct.pack("<H", tile_y * 256 + 128))
        machine.mem_write(entity + 6, bytes((kind, 8)))
        machine.mem_write(entity + 0x2C, bytes((0 if control == "dead" else 10 if control == "rotting" else 1,)))
        machine.mem_write(entity + 0x32, struct.pack("<H", rate if control != "zero-rate" else 0))
        preferred = (69, 48) if faction == "HUMAN" else (4, 80)
        if control == "occupied" or (control == "preferred-occupied" and (tile_x, tile_y) == preferred):
            put(machine, GROUND + (tile_y * width + tile_x) * 4, 123)
    packets = []
    route_results = []

    def capture(emulator, address, size, data):
        if address in (0x4584C8, 0x45824E):
            route_results.append(emulator.reg_read(UC_X86_REG_EAX))
        elif address == 0x421725:
            packet = emulator.reg_read(UC_X86_REG_ESI)
            packets.append(bytes(emulator.mem_read(packet, struct.unpack("<H", emulator.mem_read(packet, 2))[0])))
            emulator.reg_write(UC_X86_REG_EIP, 0x421767)

    for address in (0x4584C8, 0x45824E, 0x421725):
        machine.hook_add(UC_HOOK_CODE, capture, begin=address, end=address)
    invoke(machine, 0x4598B0, eax=NATIVE.GAME, edx=POLICY, ebx=0, ecx=team)
    assigned = machine.mem_read(extractor + 0x11, 1)[0]
    if control not in ("baseline", "preferred-occupied"):
        assert packets == [] and assigned == 0, (control, packets, assigned)
    else:
        expected = (70, "11000701010080458030c80005c8000200") if faction == "HUMAN" else (
            226, "11000701010080048050c80005c8000200")
        if control == "preferred-occupied":
            expected = (160, "1100070101008035801bc80005c8000200") if faction == "HUMAN" else (
                80, "11000701010080418036c80005c8000200")
        assert (assigned, [packet.hex() for packet in packets]) == (expected[0], [expected[1]])
        assert route_results and all(value == 0 for value in route_results)
    if control == "route-score":
        assert route_results and all(0 < value < 256 for value in route_results), route_results
    elif control == "no-route":
        assert route_results and all(value == 0xFFFFFFFF for value in route_results), route_results
    print(f"RESOURCE {faction}02 synthetic-extractor control={control} assigned={assigned} packets={[packet.hex() for packet in packets]}")


def selector_probe():
    assert NATIVE.READ(0x47B318, 36) == struct.pack("<9I", 0x44BC5C, 0x44BE40, 0, 0,
                                                                  0x47B318, 0x44C780, 0x44CFA8, 0x44D6D8, 0x44BF54)
    assert NATIVE.READ(0x44BC5C, 10).hex() == "5589e5b8010000005dc3"
    assert struct.unpack("<d", NATIVE.READ(0x47380C, 8))[0] == 1 / 32767
    random_values = struct.unpack("<256i", NATIVE.READ(0x478E04, 1024))
    assert min(random_values) == 668 and max(random_values) == 32434
    for team in (1, 2):
        machine = NATIVE.machine_for_probe()
        visited = []

        def observe(emulator, address, size, data):
            if address in (0x44BC5C, 0x44BE40, 0x44D6E0, 0x44D6E8, 0x44BD2C):
                visited.append(address)
            if address == 0x44BD2C:
                emulator.emu_stop()

        machine.hook_add(UC_HOOK_CODE, observe)
        put(machine, NATIVE.GAME + 0xBBC + team * 0xE30, 4)
        call(machine, 0x41AB20, team)
        assert machine.reg_read(UC_X86_REG_EIP) == RETURN
        assert visited == [0x44D6E0], visited
        switch_to_mode3(machine, team)
        visited.clear()
        call(machine, 0x41AB20, team)
        assert visited == [0x44BC5C, 0x44BE40, 0x44BD2C], visited
        assert machine.reg_read(UC_X86_REG_EIP) == 0x44BD2C
        print(f"PASS team={team} mode4=no action; mode3=weight 1 -> real action -> lazy initialization boundary")


def callback_goldens():
    assert struct.unpack("<4i", NATIVE.READ(0x4563E0, 16)) == (40, 30, 20, 0)
    cases = []
    shapes = ([], [1], [10], [10, 1, 10, 1, 10], [1, 10, 10, 1], [10, 10, 10])
    for group in range(4):
        for statuses in shapes:
            machine = fixture()
            policy = bytearray(b"\xa5" * 0x6C40)
            entities = bytearray(b"\x5a" * (800 * 220))
            base = group * GROUP_STRIDE
            struct.pack_into("<I", policy, base + 0x3168, CALLBACKS[group][0])
            struct.pack_into("<I", policy, base + 0x3174, CALLBACKS[group][3])
            for bucket in range(16):
                policy[base + 0x1E95 + bucket * 300] = 0
                struct.pack_into("<hh", policy, base + 0x1FAA + bucket * 300, -1, -1)
            struct.pack_into("<I", policy, base + 0x1E8C, 0xFFFFFFF0)
            buckets = [0] if group in (0, 3) else [0, 3, 15]
            for bucket in buckets:
                policy[base + 0x1E95 + bucket * 300] = 1
                slots = [152 + bucket * 8 + index for index in range(len(statuses))]
                if slots:
                    struct.pack_into("<hh", policy, base + 0x1FAA + bucket * 300, slots[0], slots[-1])
                for index, slot in enumerate(slots):
                    entities[slot * 220 + 0x2C] = statuses[index]
                    struct.pack_into("<hh", entities, slot * 220 + 0xD2,
                                     slots[index + 1] if index + 1 < len(slots) else -1,
                                     slots[index - 1] if index else -1)
            machine.mem_write(POLICY, bytes(policy))
            machine.mem_write(NATIVE.GAME + 0x7D28, bytes(entities))
            rng = dword(machine, 0x479204)
            invoke(machine, CALLBACKS[group][0], eax=NATIVE.GAME, edx=POLICY, ebx=group)
            accumulator = dword(machine, POLICY + base + 0x1E8C)
            expected = ((0xFFFFFFF0 + (1000 if not statuses else 0)) & 0xFFFFFFFF) if group == 3 else 0
            assert accumulator == expected
            invoke(machine, CALLBACKS[group][3], eax=NATIVE.GAME, edx=POLICY, ebx=group)
            assert dword(machine, 0x479204) == rng
            after_policy = bytes(machine.mem_read(POLICY, len(policy)))
            after_entities = bytes(machine.mem_read(NATIVE.GAME + 0x7D28, len(entities)))
            cases.append({"group": group, "statuses": statuses, "buckets": buckets,
                          "accumulator": accumulator,
                          "policySha256": hashlib.sha256(after_policy).hexdigest(),
                          "entitiesSha256": hashlib.sha256(after_entities).hexdigest()})
    scheduler = []
    for mode in (3, 4):
        machine = fixture()
        put(machine, NATIVE.GAME + 2 * 0xE30 + 0xBBC, mode)
        actions = []

        def stop_action(emulator, address, size, data):
            actions.append(address)
            emulator.emu_stop()

        machine.hook_add(UC_HOOK_CODE, stop_action, begin=0x44BE40, end=0x44BE40)
        machine.hook_add(UC_HOOK_CODE, stop_action, begin=0x44D6E8, end=0x44D6E8)
        cursors = []
        for cursor in range(256):
            actions.clear()
            put(machine, 0x479204, cursor)
            call(machine, 0x41AB20, 2)
            assert actions == ([0x44BE40] if mode == 3 else [])
            assert dword(machine, 0x479204) == (cursor + 1) % 256
            cursors.append(dword(machine, 0x479204))
        scheduler.append({"mode": mode, "weight": 1 if mode == 3 else 0,
                          "actionsPerCall": 1 if mode == 3 else 0, "cursors": cursors})
    print(json.dumps({"callbackCases": cases, "scheduler": scheduler,
                      "rngTable": struct.unpack("<256i", NATIVE.READ(0x478E04, 1024))}))


def initialize_combat_tables(machine):
    directory = NATIVE.ROOT / "raw_cd/DC/GAMESTAT"
    weapon_rows = [line.split() for line in (directory / "WEAPSTAT.TXT").read_text().splitlines()
                   if line.strip() and not line.lstrip().startswith("%")]
    assert int(weapon_rows[0][0]) == len(weapon_rows) - 1
    for tokens in weapon_rows[1:]:
        machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        machine.reg_write(UC_X86_REG_ESI, int(tokens[0]) * 9)
        machine.emu_start(0x43B78B, 0x43B7CA, count=10000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43B7CA
        stack = machine.reg_read(UC_X86_REG_ESP)
        destinations = struct.unpack("<12I", machine.mem_read(stack + 8, 48))
        machine.mem_write(destinations[0], tokens[1].encode("ascii") + b"\0")
        for destination, token in zip(destinations[1:], tokens[2:]):
            put(machine, destination, int(token) & 0xFFFFFFFF)
        machine.reg_write(UC_X86_REG_ESI, 0x4F0200 + int(tokens[0]) * 72)
        machine.emu_start(0x43B7CF, 0x43B7E0, count=10000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43B7E0
        machine.emu_start(0x43B935, 0x43B955, count=10000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43B955
    matrix = [line.split() for line in (directory / "MBULLET.TXT").read_text().splitlines()
              if line.strip() and not line.lstrip().startswith("%")]
    columns, count = int(matrix[0][0]), int(matrix[1][0])
    assert len(matrix) == count + 2
    put(machine, 0x4F98C8, columns)
    put(machine, 0x4F98D0, 0xB80000)
    for index, percentages in enumerate(matrix[2:]):
        assert len(percentages) == columns
        pointer = 0xB81000 + index * 256
        put(machine, 0xB80000 + index * 4, pointer)
        machine.mem_write(NATIVE.SOURCE, " ".join(percentages).encode("ascii") + b"\0")
        put(machine, NATIVE.FRAME - 0x10, NATIVE.SOURCE)
        put(machine, NATIVE.FRAME - 4, index)
        machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        machine.reg_write(UC_X86_REG_EDI, 0)
        machine.emu_start(0x43B24B, 0x43B2EF, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43B2EF
        assert struct.unpack(f"<{columns}h", machine.mem_read(pointer, columns * 2)) == tuple(
            int(int(value) * 0.01 * 256) for value in percentages)


def initialize_source_world(machine, sources, width, height, rows, placement, runtime=False, animations=None,
                            full_source=False):
    for name, expected in (
        ("GAMESTAT.TXT", "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629"),
        ("WEAPSTAT.TXT", "391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0"),
        ("MBULLET.TXT", "2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22"),
    ):
        assert hashlib.sha256((NATIVE.ROOT / "raw_cd/DC/GAMESTAT" / name).read_bytes()).hexdigest() == expected
    parsed = placement.TYPE_PROBE.parsed_fixture()
    machine.mem_write(placement.TYPES, bytes(parsed.mem_read(placement.TYPES, 110 * 280)))
    if runtime:
        type_rows = [line.split() for line in (NATIVE.ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT").read_text().splitlines()
                     if line.strip() and not line.lstrip().startswith("%")]
        type_count = int(type_rows[0][0])
        assert type_count == len(type_rows) - 1
        put(machine, NATIVE.FRAME - 0xC, type_count)
        machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
        machine.emu_start(0x43BB62, 0x43BB6A, count=10)
        assert dword(machine, 0x4F98D4) == type_count
    if animations is not None:
        animations(machine, rows)
    machine.mem_map(0xB00000, 0x100000)
    initialize_combat_tables(machine)
    if runtime:
        invoke(machine, 0x40BF80, eax=NATIVE.GAME)
        assert machine.mem_read(NATIVE.GAME + 0x468E8, 4) == b"\xff" * 4
        assert machine.mem_read(NATIVE.GAME + 0x468EC, 1600) == b"\xff\xff" * 800
        assert all(machine.mem_read(NATIVE.GAME + 0x32CBC + index * 40, 2) == b"\xff\xff"
                   for index in range(2024))
    for tile_y in range(height):
        for offset, base, size in ((4, 0xB00000, 4), (0xC04, 0xB40000, 2), (0x1004, 0xB60000, 2)):
            put(machine, MAP + offset + tile_y * 4, base + tile_y * width * size)
            if size == 2:
                machine.mem_write(base + tile_y * width * size, struct.pack("<H", 1023) * width)
        assert tuple(sources["MTG"][:2]) == (width, height)
        machine.mem_write(0xB40000 + tile_y * width * 2, b"".join(struct.pack("<H",
            ((sources["MTG"][2 + (height - 1 - tile_y) * width + tile_x] << 10) | 1023) & 0xFFFF)
            for tile_x in range(width)))
        attributes = struct.unpack_from(f"<{width}H", sources["MAP"],
                                        8 + width * height * 4 + tile_y * width * 2)
        machine.mem_write(0xB00000 + tile_y * width * 4, b"".join(
            struct.pack("<I", (attribute << 22) & 0xFFFFFFFF) for attribute in attributes))
    put(machine, MAP + 0x9A4B8, width * 256)
    put(machine, MAP + 0x9A4BC, height * 256)
    if full_source:
        initialize_full_source_scn(machine, sources, rows)
        return
    for owner in range(8):
        put(machine, NATIVE.FRAME - 4, NATIVE.GAME)
        put(machine, NATIVE.FRAME - 8, owner)
        machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
        machine.emu_start(0x41993F, 0x41996A, count=10000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x41996A
        assert dword(machine, NATIVE.GAME + owner * 0xE30 + 0x19C0) == 0x40000000 >> owner
        start = next(index for index, line in enumerate(rows) if line.startswith(f"TEAM {owner} "))
        side = NATIVE.GAME + owner * 0xE30
        for offset, index in ((0xBB8, 1), (0xBAC, 2), (0xBBC, 3)):
            put(machine, side + offset, int(rows[start + index]))
        for offset, index in ((0xBCC, 8), (0xBC4, 9)):
            machine.mem_write(side + offset, struct.pack("<2I", *map(int, rows[start + index].split())))
        city_lines = rows[start + 10:start + 19]
        reads = []

        def supply_line(emulator, address, size, data):
            text = city_lines[len(reads)]
            reads.append(text)
            emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), text.encode("ascii") + b"\0")
            stack = emulator.reg_read(UC_X86_REG_ESP)
            emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
            emulator.reg_write(UC_X86_REG_ESP, stack + 4)

        hook = machine.hook_add(UC_HOOK_CODE, supply_line, begin=0x41B8AC, end=0x41B8AC)
        put(machine, NATIVE.FRAME - 8, 0x708000)
        put(machine, NATIVE.FRAME - 12, owner)
        for register, value in ((UC_X86_REG_EBP, NATIVE.FRAME), (UC_X86_REG_ESP, NATIVE.STACK),
                                (UC_X86_REG_ESI, NATIVE.GAME), (UC_X86_REG_EDI, side + 0xB98)):
            machine.reg_write(register, value)
        machine.emu_start(0x41C0CD, 0x41C31B, count=1000000)
        machine.hook_del(hook)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x41C31B and reads == city_lines
        assert machine.mem_read(side + 0xB98 + 0x108, 4) == b"\x01" * 4
        assert machine.mem_read(side + 0xB98 + 0xD9C, 8) == b"\xff" * 8
        assert dword(machine, side + 0xB98 + 0xE1C) == 3
    put(machine, NATIVE.FRAME - 8, 0x708000)
    put(machine, NATIVE.FRAME - 0x14, 0)
    put(machine, 0x7094A0, 0)
    put(machine, NATIVE.GAME + 0x7D20, 152)
    put(machine, placement.RESOURCE.AUDIT.SCALE, 256)
    put(machine, placement.RESOURCE.AUDIT.STATISTICS + 96, 256)
    put(machine, 0x4796B0, 0)
    put(machine, 0x4796B4, 0)
    machine.reg_write(UC_X86_REG_ESI, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EDI, 152)
    start = next(index for index, line in enumerate(rows) if line.startswith("TEAM 7 ")) + 19
    for text in rows[start:]:
        machine.mem_write(NATIVE.FRAME - 0x47C, text.encode("ascii") + b"\0")
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        placement.RESOURCE.execute(machine, 0x41C453, 0x41C438)


def initialize_full_source_scn(machine, sources, rows):
    faction = "HUMAN" if hashlib.sha256(sources["SCN"]).hexdigest() == SOURCE_HASHES["HUMAN"][0] else "ALIEN"
    machine.source_profile = initialize_campaign_profile(machine, faction)
    invoke(machine, 0x419D60)
    machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.emu_start(0x4012B4, 0x4012E6, count=10000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x4012E6
    put(machine, NATIVE.FRAME + 0x7A, 0x850000)
    machine.emu_start(0x4014C6, 0x4014ED, count=10000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x4014ED
    machine.emu_start(0x40183B, 0x40185F, count=10000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x40185F
    assert [dword(machine, address) for address in (0x494690, 0x494694, 0x495710, 0x495740)] == [256] * 4
    put(machine, NATIVE.GAME + 0x7D18, 0x703000)
    put(machine, 0x49469C, 0)
    put(machine, 0x479204, 197)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.emu_start(0x40150B, 0x401515, count=1000)
    assert dword(machine, 0x479204) == 0
    machine.mem_map(0x2600000, 0x100000)
    cursor = 0x2600010
    source_lines = iter(rows)
    reads, boundaries, cities, teams, setup_calls = [], [], [], [], []
    seed_cursor = None
    files = {extension: (NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.{extension}").read_bytes()
             for extension in ("TRO", "MSG")}
    handles, file_reads = {}, {extension: bytearray() for extension in files}
    type_bytes = bytes(machine.mem_read(0x4F1880, 110 * 280))
    dependency_bytes = bytes(machine.mem_read(0x4E6D70, 110 * 52))

    def boundary(emulator, address, size, data):
        nonlocal cursor
        stack = emulator.reg_read(UC_X86_REG_ESP)
        caller = dword(emulator, stack)
        result = 0
        if address == 0x40BCC0:
            length = emulator.reg_read(UC_X86_REG_EDX)
            assert 0 < length < 0x10000 and cursor + length < 0x2700000
            result = cursor
            cursor += (length + 31) & ~15
            emulator.mem_write(result, b"\xa5" * length)
        elif address == 0x43C388:
            emulator.mem_write(0x4F1880, type_bytes)
            emulator.mem_write(0x4E6D70, dependency_bytes)
        elif address == 0x435F30:
            result = MAP
        elif address == 0x40601C:
            result = 0x708000
        elif address in (0x41B8AC, 0x41B864):
            line = next(source_lines, None)
            if line is not None:
                reads.append(line)
                emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), line.encode("ascii") + b"\0")
                result = 1
        elif address == 0x406288:
            filename = bytes(emulator.mem_read(emulator.reg_read(UC_X86_REG_EAX), 1024)).split(b"\0", 1)[0].decode("ascii")
            extension = "TRO" if caller == 0x43FBF6 else "MSG"
            assert filename.lower().endswith(f"{faction.lower()}02"), (hex(caller), filename)
            assert extension in files, (hex(caller), filename)
            result = len(handles) + 1
            handles[result] = (extension, iter(files[extension].splitlines(keepends=True)))
        elif address in (0x406338, 0x4062B4):
            extension, lines = handles[emulator.reg_read(UC_X86_REG_EBX)]
            line = next(lines, None)
            if line is not None:
                result = emulator.reg_read(UC_X86_REG_EAX)
                emulator.mem_write(result, line + b"\0")
                file_reads[extension].extend(line)
        boundaries.append({"entry": hex(address), "caller": hex(caller), "result": result})
        emulator.reg_write(UC_X86_REG_EAX, result)
        emulator.reg_write(UC_X86_REG_EIP, caller)
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    def observe(emulator, address, size, data):
        nonlocal seed_cursor
        setup_calls.append({"entry": hex(address), "eax": emulator.reg_read(UC_X86_REG_EAX),
                            "edx": emulator.reg_read(UC_X86_REG_EDX), "ebx": emulator.reg_read(UC_X86_REG_EBX),
                            "ecx": emulator.reg_read(UC_X86_REG_ECX)})
        if address == 0x41B938:
            seed_cursor = dword(emulator, 0x479204)
        if address == 0x444F14:
            cities.append([emulator.reg_read(UC_X86_REG_EDX), emulator.reg_read(UC_X86_REG_EBX)])
        elif address == 0x41C31B:
            side = emulator.reg_read(UC_X86_REG_EDI)
            teams.append({"owner": dword(emulator, emulator.reg_read(UC_X86_REG_EBP) - 12),
                          "queueEnabled": list(emulator.mem_read(side + 0x108, 4)),
                          "queueWords": list(struct.unpack("<4h", emulator.mem_read(side + 0xD9C, 8))),
                          "flags": dword(emulator, side + 0xE1C),
                          "dependencies": [index for index, value in enumerate(emulator.mem_read(side + 0xDA4, 110)) if value],
                          "colour": dword(emulator, side + 0x100),
                          "raw": bytes(emulator.mem_read(side, 0xE30)).hex()})

    hooks = [machine.hook_add(UC_HOOK_CODE, boundary, begin=address, end=address) for address in (
        0x40BCC0, 0x43C388, 0x435F30, 0x40601C, 0x41B8AC, 0x41B864,
        0x406288, 0x406338, 0x4062B4, 0x40636C, 0x406560, 0x40B030)]
    hooks.extend(machine.hook_add(UC_HOOK_CODE, observe, begin=address, end=address)
                 for address in (0x41B938, 0x444F14, 0x41C31B, 0x445570, 0x412014, 0x41822C,
                                 0x41AF14, 0x437BC4, 0x44AC28, 0x41E7A0, 0x41E7D8))
    put(machine, 0x479204, 197)
    try:
        invoke(machine, 0x41B920, instruction_limit=10000000, eax=NATIVE.GAME, edx=0x850000, ebx=0)
    finally:
        for hook in hooks:
            machine.hook_del(hook)
    assert reads == rows
    assert file_reads == files, {key: len(value) for key, value in file_reads.items()}
    assert cities == [[owner, slot] for owner in range(8) for slot in range(15)]
    assert seed_cursor == 0
    assert all(record["queueEnabled"] == [1] * 4 and record["queueWords"] == [-1] * 4
               and record["flags"] == 3 for record in teams)
    pointers = [dword(machine, NATIVE.GAME + offset) for offset in (0x471A0, 0x471A4)]
    alliance, visibility = [list(machine.mem_read(pointer, 8)) for pointer in pointers]
    machine.source_relations = {"freshSetup": "inside 0x41b920", "constructor": "0x41e7a0",
                               "population": "0x41bf45..0x41c029", "allocationBytes": [8, 8],
                               "allianceRows": alliance, "visibilityRows": visibility,
                               "mutualAlliances": [[int(bool(alliance[owner] & (1 << other) and alliance[other] & (1 << owner)))
                                                   for other in range(8)] for owner in range(8)]}
    width, height = dword(machine, MAP + 0x9A4B0), dword(machine, MAP + 0x9A4B4)
    actors = []
    for slot in range(800):
        actor = bytes(machine.mem_read(NATIVE.GAME + 0x7D28 + slot * 220, 220))
        registered = struct.unpack("<h", machine.mem_read(NATIVE.GAME + 0x468EC + slot * 2, 2))[0]
        if registered != -1:
            actors.append({"slot": slot, "registry": registered, "type": actor[6], "owner": actor[7],
                           "positionQ8": [struct.unpack_from("<H", actor)[0], struct.unpack_from("<H", actor, 4)[0]],
                           "health": struct.unpack_from("<i", actor, 12)[0], "raw": actor.hex(),
                           "footprint": [[tile_x, tile_y] for tile_y in range(height) for tile_x in range(width)
                                         if (dword(machine, dword(machine, MAP + 0x804 + tile_y * 4) + tile_x * 4) & 1023) == slot]})
    machine.source_scn = {"entry": "0x41b920", "returned": True, "sourceSha256": hashlib.sha256(sources["SCN"]).hexdigest(),
                          "linesRead": len(reads), "teams": teams, "cityCalls": cities,
                          "setupCalls": setup_calls,
                          "resourceScales": {"calls": ["0x419d60", "0x4012b4..0x4012e6", "0x4014c6..0x4014ed",
                                                       "0x40183b..0x40185f"], "rate": 256, "reserve": 256},
                          "actors": actors, "entities": base64.b64encode(machine.mem_read(NATIVE.GAME + 0x7D28, 800 * 220)).decode(),
                          "registry": base64.b64encode(machine.mem_read(NATIVE.GAME + 0x468EC, 1600)).decode(),
                          "policyRng": {"startup": "0x40150b..0x401515", "scnSetter": "0x41b931..0x41b938",
                                        "setter": "0x411da4", "seed": 0, "poisonBeforeEachSetter": 197,
                                        "afterScnSetter": seed_cursor, "afterLoader": dword(machine, 0x479204)},
                          "externalBoundaries": boundaries}


def policy_seed_controls():
    controls = []
    for seed in (0, 1, 255, 256, 0x1234):
        machine = fixture()
        put(machine, 0x49469C, seed)
        values = []
        for entry, stop in ((0x40150B, 0x401515), (0x41B920, 0x41B938)):
            put(machine, 0x479204, 197)
            machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
            machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
            machine.reg_write(UC_X86_REG_EDX, 0x850000)
            machine.reg_write(UC_X86_REG_EBX, seed)
            machine.emu_start(entry, stop, count=1000)
            assert machine.reg_read(UC_X86_REG_EIP) == stop
            values.append(dword(machine, 0x479204))
        assert values == [seed & 255] * 2
        controls.append({"seed": seed, "startup": values[0], "scn": values[1], "poison": 197})
    return controls


def source_continuation(faction, team, decisions=False, active=False):
    spec = importlib.util.spec_from_file_location(
        "ai_placement", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    machine, _, _, width, families = source_fixture(faction, team, lambda *args: initialize_source_world(*args, placement))
    high_water = dword(machine, NATIVE.GAME + 0x7D20)
    assert high_water == (170 if faction == "HUMAN" else 193)
    visited, packets, rules = [], [], []
    rule_addresses = set(struct.unpack("<54I", NATIVE.READ(0x48903C, 216))[0::3]) | set(
        struct.unpack("<54I", NATIVE.READ(0x48903C, 216))[1::3])
    entries = {0x457568, 0x456AD0, 0x457940, 0x4578D0,
               *(address for callbacks in CALLBACKS for address in callbacks)}
    captures, pending, return_hooks = [], [], []
    group_invocation = None
    capturing_callbacks = decisions
    active_inputs = None
    if active:
        matrix_pointer = dword(machine, 0x4F98D0)
        matrix_columns = dword(machine, 0x4F98C8)
        matrix_rows = int([line for line in (NATIVE.ROOT / "raw_cd/DC/GAMESTAT/MBULLET.TXT").read_text().splitlines()
                           if line.strip() and not line.lstrip().startswith("%")][1])
        active_inputs = {
            "types": base64.b64encode(machine.mem_read(0x4F1880, 110 * 280)).decode(),
            "weapons": base64.b64encode(machine.mem_read(0x4F0200, 80 * 72)).decode(),
            "matrix": [list(struct.unpack(f"<{matrix_columns}h", machine.mem_read(
                dword(machine, matrix_pointer + index * 4), matrix_columns * 2))) for index in range(matrix_rows)],
            "relations": list(machine.mem_read(NATIVE.GAME + 0x46F34, 100)),
            "visibilityMasks": [dword(machine, NATIVE.GAME + 0x19C0 + owner * 0xE30) for owner in range(8)],
            "occupancy": [dword(machine, dword(machine, MAP + 0x804 + tile_y * 4) + tile_x * 4)
                          for tile_y in range(len(families) // width) for tile_x in range(width)],
            "teamBytes": base64.b64encode(machine.mem_read(NATIVE.GAME + 0xB98 + team * 0xE30, 0xE30)).decode(),
            "dependencies": base64.b64encode(machine.mem_read(0x4E6D70, 110 * 52)).decode(),
            "rules": base64.b64encode(NATIVE.READ(0x48903C, 216)).decode(),
            "initializedPolicy": base64.b64encode(machine.ai_initialized_policy).decode(),
            "rngTable": list(struct.unpack("<256i", NATIVE.READ(0x478E04, 1024))),
        }

    def snapshot():
        return {"policy": base64.b64encode(machine.mem_read(POLICY, 0x6C40)).decode(),
                "entities": base64.b64encode(machine.mem_read(NATIVE.GAME + 0x7D28, 800 * 220)).decode(),
                "rngCursor": dword(machine, 0x479204), "forceOrder": machine.mem_read(0x489510, 1)[0]}

    def returned(emulator, address, size, data):
        if pending and pending[-1][0] == address:
            _, capture = pending.pop()
            capture["after"] = snapshot()
            captures.append(capture)
            if active and capture["group"] == 1 and capture["callback"] == "0x463e78":
                group_invocation["after"] = snapshot()
                group_invocation["packets"] = capture["packets"]
            if capture["group"] == 2 and capture["callback"] == "0x463e78":
                emulator.emu_stop()

    def observe(emulator, address, size, data):
        nonlocal group_invocation
        group = emulator.reg_read(UC_X86_REG_EBX)
        if active and capturing_callbacks and address == 0x4578A0 and group == 1:
            group_invocation = {"group": 1, "callback": "group-1", "before": snapshot(), "packets": []}
        if capturing_callbacks and ((address in (0x4593A8, 0x458B44, 0x463E78) and group in (1, 2))
                        or (active and address in (0x457568, 0x456AD0))):
            return_address = dword(emulator, emulator.reg_read(UC_X86_REG_ESP))
            capture = {"group": group, "callback": hex(address), "before": snapshot(), "packets": []}
            pending.append((return_address, capture))
            return_hooks.append(machine.hook_add(UC_HOOK_CODE, returned,
                                                 begin=return_address, end=return_address))
        if address in rule_addresses:
            rules.append({"address": hex(address), "parameter": dword(emulator, emulator.reg_read(UC_X86_REG_ESP) + 4)})
        if address in entries:
            visited.append(hex(address))
        if address == 0x421725:
            packet = emulator.reg_read(UC_X86_REG_ESI)
            length = struct.unpack("<H", emulator.mem_read(packet, 2))[0]
            packets.append(bytes(emulator.mem_read(packet, length)).hex())
            if decisions and pending:
                pending[-1][1]["packets"].append(packets[-1])
            unit_count = struct.unpack("<H", emulator.mem_read(packet + 4, 2))[0]
            if unit_count and not decisions:
                emulator.emu_stop()
            else:
                emulator.reg_write(UC_X86_REG_EIP, 0x421767)

    for address in entries | rule_addresses | {0x421725}:
        machine.hook_add(UC_HOOK_CODE, observe, begin=address, end=address)
    failure = None
    try:
        invoke(machine, 0x44BE40, eax=NATIVE.GAME, edx=team)
    except Exception as error:
        if machine.reg_read(UC_X86_REG_EIP) != 0x421725 and not (decisions and len(captures) == (7 if active else 4)):
            failure = str(error)
    assert failure is None, (failure, [(capture["callback"], capture["group"]) for capture in captures])
    if decisions:
        assert len(captures) == (7 if active else 4), (len(captures), hex(machine.reg_read(UC_X86_REG_EIP)))
        capturing_callbacks = False
        for hook in return_hooks:
            machine.hook_del(hook)
        controls = []
        if faction == "ALIEN":
            source = next(capture for capture in captures if capture["group"] == 1 and capture["callback"] == "0x463e78")
            for label in ("forced", "mode2-hold", "mode2-saturated", "near-type1", "near-type9",
                          "near-arrival", "near-forced", "route-step", "disabled", "repeat-61"):
                machine.mem_write(POLICY, base64.b64decode(source["before"]["policy"]))
                machine.mem_write(NATIVE.GAME + 0x7D28, base64.b64decode(source["before"]["entities"]))
                machine.mem_write(0x489510, bytes((1 if label in ("forced", "near-forced", "disabled")
                                                  else source["before"]["forceOrder"],)))
                base = POLICY + GROUP_STRIDE
                bucket = next(index for index in range(16) if machine.mem_read(base + index * 300 + 0x1E95, 1)[0]
                              and struct.unpack("<h", machine.mem_read(base + index * 300 + 0x1FAA, 2))[0] >= 0)
                base += bucket * 300
                slot = struct.unpack("<h", machine.mem_read(base + 0x1FAA, 2))[0]
                entity = NATIVE.GAME + 0x7D28 + slot * 220
                tile_x = struct.unpack("<H", machine.mem_read(entity, 2))[0] >> 8
                tile_y = struct.unpack("<H", machine.mem_read(entity + 4, 2))[0] >> 8
                if label.startswith("mode2") or label.startswith("near-type"):
                    machine.mem_write(entity + 0xCC, bytes((1, tile_x, tile_y, 59 if label == "mode2-saturated" else 3)))
                if label.startswith("near-"):
                    target = dword(machine, base + 0x1E9C)
                    tile_x, tile_y = machine.mem_read(POLICY + target * 18 + 2, 2)
                    family = families[tile_y * width + tile_x]
                    assert family != 0
                    machine.mem_write(entity, struct.pack("<H", tile_x << 8))
                    machine.mem_write(entity + 4, struct.pack("<H", tile_y << 8))
                    machine.mem_write(entity + 0xCD, bytes((tile_x, tile_y, 3)))
                    if label.startswith("near-type"):
                        machine.mem_write(entity + 6, bytes((1 if label == "near-type1" else 9,)))
                    put(machine, base + 0x1E9C, family)
                    put(machine, base + 0x1EA0, family)
                    machine.mem_write(base + 0x1EA6, b"\0\0" + bytes((family,)))
                if label == "route-step":
                    origin = dword(machine, base + 0x1E9C)
                    for destination in range(1, 255):
                        path = [origin]
                        while path[-1] != destination and len(path) < 256:
                            next_region = machine.mem_read(MAP + 0x884A8 + path[-1] * 256 + destination, 1)[0]
                            if next_region == 0 or next_region in path:
                                break
                            path.append(next_region)
                        if path[-1] == destination and len(path) > 2:
                            break
                    assert path[-1] == destination and len(path) > 2
                    put(machine, base + 0x1EA0, destination)
                    machine.mem_write(base + 0x1EA6, struct.pack("<h", 1) + bytes(path))
                if label == "disabled":
                    for index in range(16):
                        machine.mem_write(POLICY + GROUP_STRIDE + index * 300 + 0x1E95, b"\0")
                capture = {"group": 1, "callback": "0x463e78", "control": label,
                           "before": snapshot(), "packets": [], "invocations": 61 if label == "repeat-61" else 1}

                def capture_packet(emulator, address, size, data):
                    pointer = emulator.reg_read(UC_X86_REG_ESI)
                    length = struct.unpack("<H", emulator.mem_read(pointer, 2))[0]
                    capture["packets"].append(bytes(emulator.mem_read(pointer, length)).hex())

                hook = machine.hook_add(UC_HOOK_CODE, capture_packet, begin=0x421725, end=0x421725)
                for _ in range(capture["invocations"]):
                    invoke(machine, 0x463E78, eax=NATIVE.GAME, edx=POLICY, ebx=1, ecx=team)
                    pending.clear()
                machine.hook_del(hook)
                capture["after"] = snapshot()
                if label.startswith("near-type"):
                    assert any(bytes.fromhex(packet)[2:] == bytes((5, slot & 255, slot >> 8, 13, 0))
                               for packet in capture["packets"]), (label, capture["packets"])
                if label.startswith("mode2"):
                    assert any(len(bytes.fromhex(packet)) == 17 and bytes.fromhex(packet)[-2] == 2
                               for packet in capture["packets"]), (label, capture["packets"])
                if label == "route-step":
                    assert dword(machine, base + 0x1E9C) == path[1]
                    assert struct.unpack("<h", machine.mem_read(base + 0x1EA6, 2))[0] == 2
                if label in ("near-arrival", "near-forced"):
                    assert machine.mem_read(entity + 0xCC, 1)[0] == (1 if label == "near-arrival" else 2)
                if label == "disabled":
                    assert capture["packets"] == [] and capture["before"] == capture["after"]
                controls.append(capture)
        active_controls = []
        if active:
            source = next(capture for capture in captures if capture["callback"] == "0x456ad0")
            source_entities = base64.b64decode(source["before"]["entities"])
            actor = next(slot for slot in range(152, 800)
                         if source_entities[slot * 220 + 7] < 8
                         and source_entities[slot * 220 + 7] != team
                         and source_entities[slot * 220 + 0x2C] not in (0, 10))
            entity = NATIVE.GAME + 0x7D28 + actor * 220
            tile_x = struct.unpack_from("<H", source_entities, actor * 220)[0] >> 8
            tile_y = struct.unpack_from("<H", source_entities, actor * 220 + 4)[0] >> 8
            ally = (team + 1) % 8
            for label in ("same-family-hostile-visible", "same-family-friendly-negative", "allied-visible-hostile", "allied-visible-friendly",
                          "dead-visible-memory-clear", "remembered-hidden", "live-owner-neutral-negative",
                          "zero-family-free-cell"):
                machine.mem_write(POLICY, base64.b64decode(source["before"]["policy"]))
                machine.mem_write(NATIVE.GAME + 0x7D28, source_entities)
                for slot in range(800):
                    machine.mem_write(POLICY + 0x1204 + slot * 4, b"\xff")
                masks = [1 << (10 + owner) for owner in range(8)]
                for owner, mask in enumerate(masks):
                    put(machine, NATIVE.GAME + 0x19C0 + owner * 0xE30, mask)
                occupancy = [1023] * len(families)
                observer = ally if label.startswith("allied") else team
                if label not in ("remembered-hidden", "live-owner-neutral-negative"):
                    occupancy[tile_y * width + tile_x] |= masks[observer]
                for row in range(len(families) // width):
                    machine.mem_write(dword(machine, MAP + 0x804 + row * 4),
                                      struct.pack(f"<{width}I", *occupancy[row * width:(row + 1) * width]))
                machine.mem_write(POLICY + 0x6C38, bytes(8))
                machine.mem_write(POLICY + 0x6C38 + observer, b"\x01")
                owner = source_entities[actor * 220 + 7]
                relations = list(active_inputs["relations"])
                relations[team * 10 + owner] = int(label in ("allied-visible-friendly", "same-family-friendly-negative"))
                machine.mem_write(NATIVE.GAME + 0x46F34, bytes(relations))
                machine.mem_write(entity + 0xCA, b"\xff")
                if label in ("dead-visible-memory-clear", "remembered-hidden", "live-owner-neutral-negative"):
                    machine.mem_write(POLICY + 0x1202 + actor * 4,
                                      bytes((tile_x, tile_y, source_entities[actor * 220 + 6], owner)))
                if label == "dead-visible-memory-clear":
                    machine.mem_write(entity + 0x2C, b"\0")
                if label == "live-owner-neutral-negative":
                    machine.mem_write(entity + 7, b"\x08")
                control_families = bytearray(families)
                if label == "zero-family-free-cell":
                    control_families[tile_y * width + tile_x] = 0
                    path_rows = dword(machine, MAP + 0x1404)
                    machine.mem_write(dword(machine, path_rows + tile_y * 4) + tile_x * 24 + 12, b"\0")
                capture = {"control": label, "callback": "0x456ad0", "group": -1, "actor": actor,
                           "before": snapshot(), "packets": [], "inputs": {"occupancy": occupancy,
                           "visibilityMasks": masks, "relations": relations},
                           "families": base64.b64encode(control_families).decode()}
                invoke(machine, 0x456AD0, eax=NATIVE.GAME, edx=team, ebx=POLICY)
                capture["after"] = snapshot()
                active_controls.append(capture)
            for row in range(len(families) // width):
                machine.mem_write(dword(machine, MAP + 0x804 + row * 4), struct.pack(f"<{width}I",
                    *active_inputs["occupancy"][row * width:(row + 1) * width]))
            machine.mem_write(dword(machine, dword(machine, MAP + 0x1404) + tile_y * 4) + tile_x * 24 + 12,
                              bytes((families[tile_y * width + tile_x],)))
            source = next(capture for capture in captures if capture["callback"] == "0x457568")
            for label in ("assignment-live-owner-changed", "assignment-state10", "assignment-already-linked"):
                machine.mem_write(POLICY, base64.b64decode(source["before"]["policy"]))
                machine.mem_write(NATIVE.GAME + 0x7D28, base64.b64decode(source["before"]["entities"]))
                actor = next(slot for slot in range(120, 800) if machine.mem_read(
                    NATIVE.GAME + 0x7D28 + slot * 220 + 7, 1)[0] == team and machine.mem_read(
                    NATIVE.GAME + 0x7D28 + slot * 220 + 0x2C, 1)[0] not in (0, 10))
                entity = NATIVE.GAME + 0x7D28 + actor * 220
                if label == "assignment-live-owner-changed":
                    machine.mem_write(entity + 7, bytes(((team + 1) % 8,)))
                elif label == "assignment-state10":
                    machine.mem_write(entity + 0x2C, b"\x0a")
                else:
                    machine.mem_write(entity + 0xD2, b"\xff\xff")
                capture = {"control": label, "callback": "0x457568", "group": -1, "actor": actor,
                           "before": snapshot(), "packets": []}
                invoke(machine, 0x457568, eax=NATIVE.GAME, edx=team, ebx=POLICY)
                capture["after"] = snapshot()
                active_controls.append(capture)
            def allocate_policy(emulator, address, size, data):
                assert emulator.reg_read(UC_X86_REG_EDX) == 0x6C40
                stack = emulator.reg_read(UC_X86_REG_ESP)
                emulator.reg_write(UC_X86_REG_EAX, POLICY)
                emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
                emulator.reg_write(UC_X86_REG_ESP, stack + 4)
            hook = machine.hook_add(UC_HOOK_CODE, allocate_policy, begin=0x40BCC0, end=0x40BCC0)
            for label, seed in (("initializer-poison", b"\xa5" * 0x6C40),
                                ("initializer-pattern", bytes((index * 37 + 19) & 255 for index in range(0x6C40)))):
                machine.mem_write(POLICY, seed)
                capture = {"control": label, "callback": "0x44bd2c", "group": -1,
                           "before": snapshot(), "packets": []}
                invoke(machine, 0x44BD2C, eax=NATIVE.GAME, edx=team)
                capture["after"] = snapshot()
                active_controls.append(capture)
            machine.hook_del(hook)
        print(json.dumps({"mission": f"{faction}02", "team": team, "captures": captures,
                          "activeControls": active_controls, "groupInvocation": group_invocation,
                          "inputs": active_inputs,
                          "controls": controls,
                          "navigation": {"width": width, "height": len(families) // width,
                                         "families": base64.b64encode(families).decode(),
                                         "nextFamily": base64.b64encode(machine.mem_read(MAP + 0x884A8, 65536)).decode()},
                          "executableSha256": NATIVE.AUDIT.DIGEST,
                          "scope": "source-initialized callbacks; transport submission bypassed",
                          "admitted": False}))
        return
    assert machine.reg_read(UC_X86_REG_EIP) == 0x421725
    assert packets == (["0b00070100000034003e00"] * 3 + ["110007010100003b0015a50005a5000700"]
                       if faction == "HUMAN" else ["11000701010000010049a10005a1000700"])
    assert all(hex(address) in visited for address in (0x457568, 0x456AD0, 0x457940, 0x4578D0))
    if faction == "HUMAN":
        assert all(hex(address) in visited for address in (0x4598B0, 0x4593A8, 0x458B44, 0x459F80))
    result = {"mission": f"{faction}02", "team": team,
              "scope": "native source placement/city rows with PTH and populated occupancy, NOT activation-time world",
              "visited": visited, "rules": rules, "packets": packets, "failure": failure,
              "admitted": False, "precedingTriggersExecuted": False,
              "eip": hex(machine.reg_read(UC_X86_REG_EIP)),
                "actors": [{"slot": slot, "type": machine.mem_read(NATIVE.GAME + 0x7D28 + slot * 220 + 6, 1)[0],
                          "link": struct.unpack("<h", machine.mem_read(
                            NATIVE.GAME + 0x7D28 + slot * 220 + 0xD2, 2))[0]}
                        for slot in range(152, high_water)
                        if machine.mem_read(NATIVE.GAME + 0x7D28 + slot * 220 + 7, 1)[0] == team]}
    print(json.dumps(result))


def load_carrier_animations(machine, unit_types=(92, 93)):
    hashes = {
        "raw_cd/DC/ANIMATE/SAWS.FIN": "7c9b19edfd72193b537e97661884912d593ad21763659ad9133b113b8dfadf27",
        "raw_cd/DC/ANIMATE/DROP.FIN": "66e8da41ff0a47229c1a33db4aae9e7f37307ec943f5bbd860acc832b07fc433",
        "raw_cd/DC/ANIMATE/SAUC.FIN": "e3378e2f627df2550e899844e8e13e4b65c5e3c10db1d792f1479096a6d58dd7",
    }
    for filename, expected in hashes.items():
        assert hashlib.sha256((NATIVE.ROOT / filename).read_bytes()).hexdigest() == expected
    spec = importlib.util.spec_from_file_location(
        "ai_carrier_animations", Path(__file__).with_name("construction-lifecycle-20260919.py"))
    construction = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(construction)
    native = construction.source_fixture(NATIVE.IMAGE)
    _, _, source_tables = construction.parsed_source(NATIVE.IMAGE)
    idle_token = source_tables["unitScannerOffsetsByToken"].index(0xDC)
    type_rows = [line.split() for line in (NATIVE.ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT").read_text().splitlines()
                 if line.strip() and not line.lstrip().startswith("%")][1:]
    machine.mem_write(0x4E6D70, bytes(native.emulator.mem_read(0x4E6D70, 110 * 52)))
    bindings = construction.load_fin(native, unit_types, attack=True)
    assert {source["source"]: source["sha256"] for source in bindings["sources"]
            if source["source"] in hashes} == hashes
    original_formatter = native.stubs[0x46CB74]

    def format_variant(context):
        stack = context.emulator.reg_read(UC_X86_REG_ESP)
        template = construction.cstring(context, context.get(stack + 8))
        if "%c" in template:
            assert template.count("%") == 1
            text = template.replace("%c", chr(context.get(stack + 12)))
            context.emulator.mem_write(context.get(stack + 4), text.encode("ascii") + b"\0")
            context.emulator.reg_write(UC_X86_REG_EAX, len(text))
        else:
            original_formatter(context)

    native.stubs[0x46CB74] = format_variant
    for binding in bindings["bindings"]:
        pointer = construction.TYPES + binding["unitType"] * 280
        native.emulator.mem_write(0x70D800 - 0x178, binding["stem"].encode("ascii") + b"\0")
        native.put(0x70D800 - 4, pointer)
        native.run(0x43BE2A, {UC_X86_REG_EBP: 0x70D800}, 0x43BE59)
        native.run(0x43C099, {UC_X86_REG_EBP: 0x70D800}, 0x43C18C)
        native.run(0x43C217, {UC_X86_REG_EBP: 0x70D800}, 0x43C36D)
        if binding["unitType"] in (92, 93):
            assert native.get(pointer + 0x7C) != 0
    machine.mem_map(construction.HEAP, 0x1000000)
    machine.mem_write(construction.HEAP, bytes(native.emulator.mem_read(construction.HEAP, 0x1000000)))
    profiles = []
    for unit_type in unit_types:
        pointer = construction.TYPES + unit_type * 280
        idle_control = int(type_rows[unit_type][idle_token])
        assert native.get(pointer + 0xDC) == idle_control
        machine.mem_write(pointer, bytes(native.emulator.mem_read(pointer, 280)))
        banks = {}
        for offset in range(0x7C, 0xD8, 4):
            bank = native.get(pointer + offset)
            if bank:
                assert construction.HEAP <= native.get(bank) < construction.HEAP + 0x1000000
                machine.mem_write(bank, bytes(native.emulator.mem_read(bank, 128)))
                banks[hex(offset)] = hex(bank)
        profiles.append({"unitType": unit_type, "banks": banks,
                         "idleControl": {"offset": "0xdc", "scannerArgument": "0x43bc2f", "sourceToken": idle_token,
                                         "sourceValue": idle_control, "nativeValue": native.get(pointer + 0xDC)},
                 "idleVariantCount": native.get(pointer + 0xD8),
                 "constructionBank": hex(native.get(pointer + 0x98)),
                 "typeBytes": bytes(native.emulator.mem_read(pointer, 280)).hex()})
    return {"sources": [{"source": source["source"], "sha256": source["sha256"]}
                        for source in bindings["sources"]], "profiles": profiles,
            "externalBoundaries": sorted(set(native.calls)),
            "boundaryKinds": "FIN registry lookup and CRT formatting only; native bank binding and delays"}


def load_source_messages(machine, faction):
    path = NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.MSG"
    content = path.read_bytes()
    lines = iter(content.splitlines(keepends=True))
    reads, boundaries = [], []
    cursor = 0xB90000

    def service(emulator, address, size, data):
        nonlocal cursor
        stack = emulator.reg_read(UC_X86_REG_ESP)
        result = 0
        if address == 0x406288:
            result = 1
        elif address in (0x406338, 0x4062B4):
            line = next(lines, None)
            if line is not None:
                result = emulator.reg_read(UC_X86_REG_EAX)
                assert len(line) < emulator.reg_read(UC_X86_REG_EDX)
                emulator.mem_write(result, line + b"\0")
                reads.append(line)
        elif address == 0x40BCC0:
            length = emulator.reg_read(UC_X86_REG_EDX)
            assert 0 < length <= 256 and cursor + length < 0xBA0000
            result = cursor
            cursor += (length + 3) & ~3
        boundaries.append({"address": hex(address), "caller": hex(dword(emulator, stack)),
                           "result": result})
        emulator.reg_write(UC_X86_REG_EAX, result)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hooks = [machine.hook_add(UC_HOOK_CODE, service, begin=address, end=address)
             for address in (0x406288, 0x406338, 0x4062B4, 0x40636C, 0x40BCC0)]
    machine.mem_write(0x706000, str(path).encode("ascii") + b"\0")
    invoke(machine, 0x44D6F0, eax=0x703000, edx=NATIVE.GAME + 0x46F9C, ebx=0x706000)
    for hook in hooks:
        machine.hook_del(hook)
    assert b"".join(reads) == content
    invoke(machine, 0x44DA88, eax=NATIVE.GAME + 0x46F9C)
    return {"source": str(path.relative_to(NATIVE.ROOT)), "sha256": hashlib.sha256(content).hexdigest(),
            "loader": "0x44d6f0(eax=allocator, edx=messageState, ebx=filename)",
            "externalBoundaries": boundaries}


def load_source_sound(machine, faction):
    scenario = NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.SCN"
    terrain = Path(scenario.read_text().splitlines()[0]).stem.upper()
    sources = {f"SOUND/{name}": (NATIVE.ROOT / "raw_cd/DC/SOUND" / name).read_bytes()
               for name in ("SLIST.DAT", f"{terrain}.AMB")}
    handles, consumed, boundaries = {}, {}, []

    def file_service(emulator, address, size, data):
        stack = emulator.reg_read(UC_X86_REG_ESP)
        result = 0
        if address == 0x40601C:
            pointer = emulator.reg_read(UC_X86_REG_EAX)
            filename = bytes(emulator.mem_read(pointer, 1024)).split(b"\0", 1)[0].decode("ascii")
            filename = filename.replace("\\", "/").upper()
            assert filename in sources, filename
            result = len(handles) + 1
            handles[result] = (filename, iter(sources[filename].splitlines(keepends=True)))
            consumed[filename] = bytearray()
        elif address == 0x406338:
            filename, lines = handles[emulator.reg_read(UC_X86_REG_EBX)]
            line = next(lines, None)
            if line is not None:
                result = emulator.reg_read(UC_X86_REG_EAX)
                assert len(line) < emulator.reg_read(UC_X86_REG_EDX)
                emulator.mem_write(result, line + b"\0")
                consumed[filename].extend(line)
        boundaries.append({"address": hex(address), "caller": hex(dword(emulator, stack)), "result": result})
        emulator.reg_write(UC_X86_REG_EAX, result)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hooks = [machine.hook_add(UC_HOOK_CODE, file_service, begin=address, end=address)
             for address in (0x40601C, 0x406338, 0x40636C)]
    machine.mem_write(0x706000, terrain.encode("ascii") + b"\0")
    invoke(machine, 0x431130, eax=0x498F60, edx=0x706000)
    for hook in hooks:
        machine.hook_del(hook)
    assert consumed == sources
    assert machine.mem_read(0x47963C, 2) == b"\0\x01"
    return {"sources": {name: hashlib.sha256(content).hexdigest() for name, content in sources.items()},
            "externalBoundaries": boundaries,
            "initializer": "0x431130(eax=0x498f60 interface, edx=terrain basename)"}


def initialize_source_relations(machine, faction):
    source = NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.SCN"
    rows = [line.strip() for line in source.read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("%")]
    allocations = []

    def allocate(emulator, address, size, data):
        stack = emulator.reg_read(UC_X86_REG_ESP)
        assert dword(emulator, stack) == 0x41E7B8
        assert emulator.reg_read(UC_X86_REG_EDX) == 8
        pointer = 0xBA0010 + len(allocations) * 32
        emulator.mem_write(pointer - 8, b"\xa5" * 24)
        allocations.append(pointer)
        emulator.reg_write(UC_X86_REG_EAX, pointer)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hook = machine.hook_add(UC_HOOK_CODE, allocate, begin=0x40BCC0, end=0x40BCC0)
    put(machine, NATIVE.GAME + 0x7D18, 0x703000)
    machine.reg_write(UC_X86_REG_ESI, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.emu_start(0x41B93D, 0x41B965, count=10000)
    machine.hook_del(hook)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x41B965
    assert len(allocations) == 2
    assert [dword(machine, NATIVE.GAME + offset) for offset in (0x471A0, 0x471A4)] == allocations
    assert all(machine.mem_read(pointer, 8) == bytes(8) for pointer in allocations)
    expected = []
    for owner in range(8):
        start = next(index for index, line in enumerate(rows) if line.startswith(f"TEAM {owner} "))
        line = rows[start + 6]
        values = list(map(int, line.split()))
        assert len(values) == 9 and values[-1] == -1
        expected.append(sum(1 << other for other in range(8) if values[other] or other == owner))
        reads = []

        def supply_line(emulator, address, size, data):
            reads.append(line)
            emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), line.encode("ascii") + b"\0")
            stack = emulator.reg_read(UC_X86_REG_ESP)
            emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
            emulator.reg_write(UC_X86_REG_ESP, stack + 4)

        hook = machine.hook_add(UC_HOOK_CODE, supply_line, begin=0x41B8AC, end=0x41B8AC)
        put(machine, NATIVE.FRAME - 0xC, owner)
        machine.reg_write(UC_X86_REG_ESI, NATIVE.GAME)
        machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        machine.emu_start(0x41BF45, 0x41C029, count=100000)
        machine.hook_del(hook)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x41C029 and reads == [line]
    assert list(machine.mem_read(allocations[0], 8)) == expected
    assert list(machine.mem_read(allocations[1], 8)) == [1 << owner for owner in range(8)]
    mutual = []
    for owner in range(8):
        mutual.append([])
        for other in range(8):
            invoke(machine, 0x41E820, eax=allocations[0], edx=owner, ebx=other)
            actual = machine.reg_read(UC_X86_REG_EAX) & 255
            assert actual == int(bool(expected[owner] & (1 << other) and expected[other] & (1 << owner)))
            mutual[-1].append(actual)
    for pointer in allocations:
        assert machine.mem_read(pointer - 8, 8) == machine.mem_read(pointer + 8, 8) == b"\xa5" * 8
    return {"freshSetup": "0x41b93d..0x41b965", "constructor": "0x41e7a0",
            "population": "0x41bf45..0x41c029", "allocationBytes": [8, 8],
            "poisonClearedByNative": True, "guardsIntact": True,
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "allianceRows": expected, "visibilityRows": [1 << owner for owner in range(8)],
            "mutualAlliances": mutual}


def world_service_boundary(source_machine, changes=(), priming_changes=()):
    machine = NATIVE.Uc(NATIVE.UC_ARCH_X86, NATIVE.UC_MODE_32)
    for start, end, permissions in source_machine.mem_regions():
        machine.mem_map(start, end - start + 1, permissions)
        machine.mem_write(start, bytes(source_machine.mem_read(start, end - start + 1)))
    machine.context_restore(source_machine.context_save())
    calls = []

    def observe(emulator, address, size, data):
        calls.append({"entry": hex(address), "caller": hex(dword(emulator, emulator.reg_read(UC_X86_REG_ESP))),
                      "eax": hex(emulator.reg_read(UC_X86_REG_EAX)), "edx": emulator.reg_read(UC_X86_REG_EDX),
                      "ebx": emulator.reg_read(UC_X86_REG_EBX)})

    hooks = [machine.hook_add(UC_HOOK_CODE, observe, begin=address, end=address)
             for address in (0x41E6AC, 0x41E820)]
    failure = None

    def update():
        put(machine, NATIVE.FRAME - 4, NATIVE.GAME)
        machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        machine.emu_start(0x41989E, 0x419990, count=5000000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x419990

    for table, owner, other, value in priming_changes:
        invoke(machine, 0x41E7D8, eax=dword(machine, NATIVE.GAME + 0x471A0 + table * 4),
               edx=owner, ebx=other, ecx=value)
    if changes:
        update()
        for table, owner, other, value in changes:
            invoke(machine, 0x41E7D8, eax=dword(machine, NATIVE.GAME + 0x471A0 + table * 4),
                   edx=owner, ebx=other, ecx=value)
        calls.clear()
    try:
        update()
    except Exception as error:
        failure = str(error)
    tables = [list(machine.mem_read(dword(machine, NATIVE.GAME + offset), 8))
              for offset in (0x471A0, 0x471A4)]
    alliances = [list(machine.mem_read(NATIVE.GAME + 0x46F34 + owner * 10, 8)) for owner in range(8)]
    masks = [dword(machine, NATIVE.GAME + 0x19C0 + owner * 0xE30) for owner in range(8)]
    if failure is None:
        assert alliances == [[int(bool(tables[0][owner] & (1 << other) and tables[0][other] & (1 << owner)))
                              for other in range(8)] for owner in range(8)]
        assert masks == [sum(0x40000000 >> other for other in range(8)
                             if other == owner or (tables[1][owner] & (1 << other) and tables[1][other] & (1 << owner)))
                         for owner in range(8)]
    result = {"scope": "contiguous original world-service prefix in a separate Unicorn instance; replay machine untouched",
              "entry": "0x41989e", "expectedEnd": "0x419990", "failure": failure,
              "eip": hex(machine.reg_read(UC_X86_REG_EIP)), "calls": calls,
              "allianceCache": alliances, "visibilityMasks": masks, "relationRows": tables,
              "changes": changes, "primingChanges": priming_changes, "primedBeforeChanges": bool(changes),
              "allianceObjects": [hex(dword(machine, NATIVE.GAME + offset)) for offset in (0x471A0, 0x471A4)]}
    for hook in hooks:
        machine.hook_del(hook)
    return result


def relation_controls(machine):
    source_rows = machine.mem_read(dword(machine, NATIVE.GAME + 0x471A0), 8)
    source_owner, source_ally = next((owner, other) for owner in range(8) for other in range(owner + 1, 8)
                                    if source_rows[owner] & (1 << other) and source_rows[other] & (1 << owner))
    controls = {
        "unilateral-alliance": [(0, 0, 7, 1)],
        "mutual-alliance-no-shared-vision": [(0, 0, 7, 1), (0, 7, 0, 1)],
        "nontransitive-alliance": [(0, 0, 7, 1), (0, 7, 0, 1), (0, 7, 6, 1), (0, 6, 7, 1)],
        "unilateral-vision": [(1, 0, 7, 1)],
        "mutual-vision-no-alliance": [(1, 0, 7, 1), (1, 7, 0, 1)],
        "revoke-source-alliance": [(0, source_owner, source_ally, 0)],
        "clear-vision-diagonal": [(1, 0, 0, 0)],
        "revoke-shared-vision": [(1, 0, 7, 0)],
    }
    results = []
    for label, changes in controls.items():
        priming = [(1, 0, 7, 1), (1, 7, 0, 1)] if label == "revoke-shared-vision" else ()
        result = world_service_boundary(machine, changes, priming)
        assert result["failure"] is None, result
        result.pop("calls")
        result["label"] = label
        results.append(result)
    return results


def initialize_source_clock(machine, faction):
    source = NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.SCN"
    rows = [line.strip() for line in source.read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("%")]
    lines = iter(rows[4:8])
    consumed = []

    def supply_line(emulator, address, size, data):
        line = next(lines)
        consumed.append(line)
        emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), line.encode("ascii") + b"\0")
        stack = emulator.reg_read(UC_X86_REG_ESP)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hook = machine.hook_add(UC_HOOK_CODE, supply_line, begin=0x41B8AC, end=0x41B8AC)
    machine.reg_write(UC_X86_REG_ESI, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.emu_start(0x41BC2F, 0x41BCD0, count=100000)
    machine.hook_del(hook)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x41BCD0 and consumed == rows[4:8]
    assert [dword(machine, NATIVE.GAME + offset) for offset in (0x53C, 0x534, 0x530, 0x538)] == list(map(int, consumed))
    return {"loader": "0x41bc2f..0x41bcd0", "phasePeriodTimeTransition": list(map(int, consumed))}


def initialize_campaign_profile(machine, faction):
    configuration = 0x850000
    machine.mem_write(configuration, b"\xa5" * 0x19F0)
    for register, value in ((UC_X86_REG_ECX, configuration - 16), (UC_X86_REG_EDI, 0x19F0),
                            (UC_X86_REG_ESI, 0x705000), (UC_X86_REG_EDX, 0)):
        machine.reg_write(register, value)
    machine.emu_start(0x40BDDC, 0x40BDEF, count=100000)
    assert machine.mem_read(configuration, 0x19F0) == bytes(0x19F0)
    machine.reg_write(UC_X86_REG_EAX, configuration)
    machine.reg_write(UC_X86_REG_ESI, 0x4750A4)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.emu_start(0x4298E7, 0x429A34, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x429A34
    header = [1, 0, 0 if faction == "HUMAN" else 1, 0, 0, 0, 0, 0]

    def file_header(emulator, address, size, data):
        if address == 0x40695C:
            assert emulator.reg_read(UC_X86_REG_EAX) == 0x21340002
            result = 1
        else:
            assert emulator.reg_read(UC_X86_REG_EDX) == 8
            emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), struct.pack("<8i", *header))
            result = 8
        stack = emulator.reg_read(UC_X86_REG_ESP)
        emulator.reg_write(UC_X86_REG_EAX, result)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hooks = [machine.hook_add(UC_HOOK_CODE, file_header, begin=address, end=address)
             for address in (0x40695C, 0x40667C)]
    machine.reg_write(UC_X86_REG_EAX, configuration)
    machine.reg_write(UC_X86_REG_EDX, 1)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.emu_start(0x429F28, 0x42A00B, count=100000)
    for hook in hooks:
        machine.hook_del(hook)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x42A00B
    assert dword(machine, configuration + 0x14A0) == 0
    assert dword(machine, configuration + 0x1494) == header[2]
    assert machine.mem_read(configuration + 0x152D, 1) == b"\0"
    put(machine, NATIVE.GAME + 0x544, configuration)
    return {"provenance": "explicit selected mode0 source campaign; not recovered installed settings",
            "constructor": "0x4298e7..0x429a34", "allocatorClear": "0x40bddc..0x40bdef",
            "headerLoader": "0x429f28..0x42a00b", "header": header, "freshSaveName": ""}


def initialize_session_transport(machine):
    machine.mem_map(0x2400000, 0x20000)
    allocations = []
    cursor = 0x2400010

    def allocate(emulator, address, size, data):
        nonlocal cursor
        length = emulator.reg_read(UC_X86_REG_EAX)
        assert length in (0x80, 0x10024, 0x24C)
        pointer = cursor
        cursor += (length + 47) & ~15
        emulator.mem_write(pointer - 8, b"\xa5" * (length + 16))
        allocations.append({"pointer": hex(pointer), "length": length})
        stack = emulator.reg_read(UC_X86_REG_ESP)
        emulator.reg_write(UC_X86_REG_EAX, pointer)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hook = machine.hook_add(UC_HOOK_CODE, allocate, begin=0x46A6EF, end=0x46A6EF)
    invoke(machine, 0x40BB6C)
    interface = machine.reg_read(UC_X86_REG_EAX)
    invoke(machine, 0x40B050, eax=interface)
    server = machine.reg_read(UC_X86_REG_EAX)
    machine.hook_del(hook)
    queue = dword(machine, interface + 0x58)
    frame = 0x70A000
    transport = frame - 0x4E
    machine.mem_write(transport - 8, b"\xa5" * 32)
    put(machine, frame + 0x5E, interface)
    put(machine, frame + 0x62, server)
    put(machine, frame + 0x76, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EBP, frame)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.reg_write(UC_X86_REG_ESI, 0)
    machine.emu_start(0x4013A6, 0x401405, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x401405
    assert dword(machine, NATIVE.GAME + 0x950) == transport
    assert dword(machine, transport) == interface
    assert bytes(machine.mem_read(transport + 4, 4)) == b"\0\0\xa5\xa5"
    assert [dword(machine, transport + offset) for offset in (8, 12)] == [1, 0]
    assert dword(machine, queue) == 1
    assert [allocation["length"] for allocation in allocations] == [0x80, 0x10024, 0x24C]
    assert all(machine.mem_read(int(allocation["pointer"], 16) - 8, 8) == b"\xa5" * 8
               and machine.mem_read(int(allocation["pointer"], 16) + allocation["length"], 8) == b"\xa5" * 8
               for allocation in allocations)
    assert machine.mem_read(transport - 8, 8) == b"\xa5" * 8
    assert machine.mem_read(transport + 16, 8) == b"\xa5" * 8
    result = {"factory": "0x40bb6c", "module": "local.c", "constructor": "0x40ba00",
            "assignment": "0x4013a6..0x401405", "interface": hex(interface), "queue": hex(queue),
            "server": hex(server), "serverConstructor": "0x40b050",
            "transport": hex(transport), "allocations": allocations, "guardsIntact": True,
            "transportBytes": bytes(machine.mem_read(transport, 16)).hex(),
            "queueLengths": [dword(machine, queue + 0x10014 + index * 4) for index in range(4)],
            "methods": {hex(offset): hex(dword(machine, interface + offset)) for offset in range(0x5C, 0x80, 4)},
            "scope": "original local client/server constructors and ready handshake; no OS network stub"}
    machine.reg_write(UC_X86_REG_EBP, frame)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.emu_start(0x401984, 0x401A34, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x401A34
    length = dword(machine, queue + 0x10014)
    result["readyPacket"] = bytes(machine.mem_read(queue + 4, length)).hex()

    def clock(emulator, address, size, data):
        stack = emulator.reg_read(UC_X86_REG_ESP)
        emulator.reg_write(UC_X86_REG_EAX, 0)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hook = machine.hook_add(UC_HOOK_CODE, clock, begin=0x40B030, end=0x40B030)
    if not hasattr(machine, "source_scn"):
        put(machine, frame - 8, dword(machine, NATIVE.GAME + 0x544))
        machine.reg_write(UC_X86_REG_EBP, frame)
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        machine.reg_write(UC_X86_REG_ESI, NATIVE.GAME)
        machine.emu_start(0x41B9D3, 0x41BAB7, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x41BAB7
    assert dword(machine, NATIVE.GAME + 0x954) == 0xFFFFFFFF
    assert dword(machine, NATIVE.GAME + 0x970) == 66
    result["receiveInitializer"] = "0x41b9d3..0x41bab7"
    invoke(machine, 0x40B3CC, eax=server)
    machine.hook_del(hook)
    assert dword(machine, server + 0x230) == 2
    assert dword(machine, queue + 0x10014) == 0
    result["readyState"] = 2
    result["readyPump"] = "0x40b3cc"
    return result


def path_initialization_controls(source_machine, faction):
    original = (NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.PTH").read_bytes()
    width = dword(source_machine, MAP + 0x9A4B0)
    valid, blocked, goal = (((43, 68), (42, 67), (47, 69)) if faction == "HUMAN"
                            else ((6, 54), (4, 52), (2, 56)))
    results = []
    for label, unit_type, origin in (("native-ground-origin", 25, valid),
                                      ("adversarial-zero-ground-origin", 25, blocked),
                                      ("air-zero-ground-family", 24, blocked)):
        machine = NATIVE.Uc(NATIVE.UC_ARCH_X86, NATIVE.UC_MODE_32)
        for start, end, permissions in source_machine.mem_regions():
            machine.mem_map(start, end - start + 1, permissions)
            machine.mem_write(start, bytes(source_machine.mem_read(start, end - start + 1)))
        machine.context_restore(source_machine.context_save())
        calls = []

        def observe(emulator, address, size, data):
            stack = emulator.reg_read(UC_X86_REG_ESP)
            calls.append({"entry": hex(address), "caller": hex(dword(emulator, stack))})
            if address in (0x46C996, 0x46CB3E):
                raise AssertionError(f"native diagnostic at {address:#x}; caller={dword(emulator, stack):#x}")

        for address in (0x41AF14, 0x414CE4, 0x44492C, 0x444628, 0x46C996, 0x46CB3E):
            machine.hook_add(UC_HOOK_CODE, observe, begin=address, end=address)
        slot = 700
        entity = NATIVE.GAME + 0x7D28 + slot * 220
        machine.mem_write(NATIVE.STACK, struct.pack("<5I", RETURN, 9, 0xFFFFFFFF, 0, slot))
        for register, value in ((UC_X86_REG_ESP, NATIVE.STACK), (UC_X86_REG_EAX, NATIVE.GAME),
                                (UC_X86_REG_EDX, origin[0]), (UC_X86_REG_EBX, origin[1]),
                                (UC_X86_REG_ECX, unit_type)):
            machine.reg_write(register, value)
        machine.emu_start(0x41AF14, RETURN, count=1000000)
        assert machine.reg_read(UC_X86_REG_EIP) == RETURN
        position = [struct.unpack("<H", machine.mem_read(entity + offset, 2))[0] for offset in (0, 4)]
        assert position == [value * 256 + 128 for value in origin]
        machine.mem_write(entity + 0x2E, struct.pack("<2H", *(value * 256 + 128 for value in goal)))
        failure = None
        try:
            invoke(machine, 0x414CE4, eax=NATIVE.GAME, edx=slot, ebx=1, ecx=0)
        except Exception as error:
            failure = str(error)
        family = original[65536 + origin[1] * width + origin[0]]
        assert machine.mem_read(MAP + 0x884A8, 65536) == original[:65536]
        rows = dword(machine, MAP + 0x1404)
        assert all(machine.mem_read(dword(machine, rows + tile_y * 4) + tile_x * 24 + 12, 1)[0]
                   == original[65536 + tile_y * width + tile_x]
                   for tile_y in range(dword(machine, MAP + 0x9A4B4)) for tile_x in range(width))
        if label == "adversarial-zero-ground-origin":
            assert family == 0 and failure == "native diagnostic at 0x46c996; caller=0x414faf"
            assert not any(call["entry"] == "0x44492c" for call in calls)
        else:
            assert failure is None, failure
            assert any(call["entry"] == "0x444628" for call in calls) == (unit_type == 24)
        results.append({"label": label, "type": unit_type, "origin": origin, "positionQ8": position,
                        "goal": goal, "family": family,
                        "movementClass": machine.mem_read(0x4F1880 + unit_type * 280 + 0x60, 1)[0],
                        "constructor": "0x41af14", "taskBuilder": "0x414ce4", "calls": calls,
                        "failure": failure, "eip": hex(machine.reg_read(UC_X86_REG_EIP)),
                        "sourcePthUnchanged": True, "worldTicks": 0})
    return results


def activation_boundary(faction, team, scan=False, world_boundary=False, full_world=False, prefix_limit=None,
                        path_proof=False, path_cell_control=None, source_proof=False):
    spec = importlib.util.spec_from_file_location(
        "ai_activation_placement", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    path = NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.TRO"
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    assert digest == {"HUMAN": "0e5a6593768b4fff717be69609d8ed5eb2aea48d1bab68c30c8d5d621d7e080d",
                      "ALIEN": "b219fa5bf2b13ba122271295679d488bb70077556dae20dfa76b00aa9968f50e"}[faction]
    blocks = json.loads(subprocess.check_output([
        "node", "--import", "tsx", "--input-type=module", "-e",
        "import {readFileSync} from 'node:fs';"
        "import {parseTriggerScript} from './tools/extractors/data/triggers.ts';"
        "console.log(JSON.stringify(parseTriggerScript(readFileSync(process.argv[1],'utf8'))));", str(path)
    ], cwd=NATIVE.ROOT))
    animation_sources = None

    def initialize_animations(emulator, rows):
        nonlocal animation_sources
        unit_types = {92, 93}
        if full_world:
            unit_types.update(value for value in struct.unpack("<60i", NATIVE.READ(0x47AFA8, 240)) if 0 <= value < 106)
        if path_proof:
            unit_types.add(24)
        unit_types.update(int(line.split()[2]) for line in rows if len(line.split()) == 6)
        unit_types.update(int(line.split()[2]) for line in rows
                  if len(line.split()) == 5 and line.split()[2] == "40")
        for trigger in blocks:
            for action in trigger["actions"]:
                tokens = action["raw"].split()
                if tokens[0] in ("reinforce", "reinforce2"):
                    unit_types.update(int(tokens[index]) for index in range(4, 14, 2)
                                      if int(tokens[index + 1]) != 0)
        animation_sources = load_carrier_animations(emulator, sorted(unit_types))

    machine = source_fixture(faction, team, lambda *args: initialize_source_world(
        *args, placement, runtime=scan, animations=initialize_animations if scan else None, full_source=full_world), False,
        fresh_game=full_world)
    if source_proof:
        print(json.dumps({"mission": f"{faction}02", "sourceScnInitialization": machine.source_scn,
                          "profile": machine.source_profile, "animations": animation_sources,
                          "policySeedControls": policy_seed_controls(), "admitted": False}))
        return
    if path_proof:
        print(json.dumps({"mission": f"{faction}02", "initialization": machine.source_path_initialization,
                          "controls": path_initialization_controls(machine, faction), "admitted": False}))
        return
    if path_cell_control is not None:
        assert full_world and prefix_limit == 64 and path_cell_control in (
            "zero-coordinates", "zero-sentinel", "zero-coordinates-and-sentinel")
        path_rows = dword(machine, MAP + 0x1404)
        for tile_y in range(dword(machine, MAP + 0x9A4B4)):
            for tile_x in range(dword(machine, MAP + 0x9A4B0)):
                cell = dword(machine, path_rows + tile_y * 4) + tile_x * 24
                if path_cell_control != "zero-sentinel":
                    machine.mem_write(cell + 8, bytes(2))
                if path_cell_control != "zero-coordinates":
                    machine.mem_write(cell + 4, bytes(4))
    lines = iter(content.splitlines(keepends=True))
    reads = []
    trigger_file_boundaries = []

    def file_service(emulator, address, size, data):
        result = 1 if address == 0x406288 else 0
        if address == 0x406338:
            line = next(lines, None)
            if line is not None:
                result = emulator.reg_read(UC_X86_REG_EAX)
                assert len(line) < emulator.reg_read(UC_X86_REG_EDX)
                emulator.mem_write(result, line + b"\0")
                reads.append(line)
        stack = emulator.reg_read(UC_X86_REG_ESP)
        trigger_file_boundaries.append({"address": hex(address), "caller": hex(dword(emulator, stack)),
                        "result": result})
        emulator.reg_write(UC_X86_REG_EAX, result)
        emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    hooks = [machine.hook_add(UC_HOOK_CODE, file_service, begin=address, end=address)
             for address in (0x406288, 0x406338, 0x40636C)]
    if full_world:
        reads.extend(content.splitlines(keepends=True))
    else:
        invoke(machine, 0x43FB90)
    for hook in hooks:
        machine.hook_del(hook)
    assert b"".join(reads) == content
    action_count = 0
    for block in blocks:
        trigger = 0x4FBC48 + block["id"] * 16
        assert machine.mem_read(trigger + 8, 1)[0] == (block["flag"] or 0)
        first = action_count
        action_count += len(block["actions"])
        pointer = dword(machine, trigger + 12)
        for index in range(action_count - 1, first - 1, -1):
            assert pointer == NATIVE.ACTION + index * 28
            pointer = dword(machine, pointer + 24)
        assert pointer == 0
    assert dword(machine, 0x4FC448) == action_count
    block = next(block for block in blocks if block["id"] == (17 if faction == "HUMAN" else 0))
    events = []

    if scan:
        message_source = ({"source": f"raw_cd/DC/SCENARIO/{faction}/{faction}02.MSG",
                           "sha256": hashlib.sha256((NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.MSG").read_bytes()).hexdigest(),
                           "loader": "0x44d6f0 inside 0x41b920"} if full_world else load_source_messages(machine, faction))
        sound_source = load_source_sound(machine, faction)
        relations = machine.source_relations if full_world else initialize_source_relations(machine, faction)
        source_clock = ({"loader": "inside 0x41b920", "phasePeriodTimeTransition":
                        [dword(machine, NATIVE.GAME + offset) for offset in (0x53C, 0x534, 0x530, 0x538)]}
                        if full_world else None)
        external_boundaries = []
        put(machine, 0x516A94, 0x854000)
        invoke(machine, 0x44E251, eax=1)
        assert dword(machine, 0x85400C) == 1
        external_boundaries.append({"kind": "explicit-crt-thread-state", "pointer": "0x854000",
                        "seed": 1, "initializer": "0x44e251(eax=seed)",
                        "randomImplementation": "unchanged 0x44e22d"})
        put(machine, 0x498F60 + 8, 0x852000)
        put(machine, 0x852000 + 0x80, 0x70C000)

        def audio_output(emulator, address, size, data):
            stack = emulator.reg_read(UC_X86_REG_ESP)
            external_boundaries.append({"address": hex(address), "caller": hex(dword(emulator, stack)),
                                       "kind": "external-audio-output-only", "sample": emulator.reg_read(UC_X86_REG_EAX),
                                       "volume": emulator.reg_read(UC_X86_REG_EDX), "pan": emulator.reg_read(UC_X86_REG_EBX),
                                       "rngCursor": dword(emulator, 0x479204), "result": -1})
            emulator.reg_write(UC_X86_REG_EAX, 0xFFFFFFFF)
            emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
            emulator.reg_write(UC_X86_REG_ESP, stack + 4)

        machine.hook_add(UC_HOOK_CODE, audio_output, begin=0x70C000, end=0x70C000)
        machine.mem_map(0x2000000, 0x200000)
        allocation_cursor = 0x2000000

        def allocate(emulator, address, size, data):
            nonlocal allocation_cursor
            stack = emulator.reg_read(UC_X86_REG_ESP)
            length = emulator.reg_read(UC_X86_REG_EDX)
            assert 0 < length and allocation_cursor + length <= 0x2200000
            pointer = allocation_cursor
            allocation_cursor += (length + 15) & ~15
            external_boundaries.append({"address": hex(address), "caller": hex(dword(emulator, stack)),
                                       "kind": "allocation", "length": length, "result": hex(pointer)})
            emulator.reg_write(UC_X86_REG_EAX, pointer)
            emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
            emulator.reg_write(UC_X86_REG_ESP, stack + 4)

        machine.hook_add(UC_HOOK_CODE, allocate, begin=0x40BCC0, end=0x40BCC0)
        session = None
        if full_world:
            profile = machine.source_profile
            session = {"profile": profile, **initialize_session_transport(machine)}
            put(machine, 0x70A000 + 0x7A, 0x850000)
            machine.reg_write(UC_X86_REG_EBP, 0x70A000)
            machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
            machine.emu_start(0x40177E, 0x4017BA, count=100000)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x4017BA
        put(machine, NATIVE.GAME + 0x7D18, 0x703000)
        invoke(machine, 0x41AA70, eax=NATIVE.GAME)
        invoke(machine, 0x421630, eax=NATIVE.GAME)
        clock_milliseconds = 0

        def clock_service(emulator, address, size, data):
            stack = emulator.reg_read(UC_X86_REG_ESP)
            milliseconds = clock_milliseconds if full_world else dword(emulator, NATIVE.GAME + 0x530) * 1000 // 16
            external_boundaries.append({"address": hex(address), "caller": hex(dword(emulator, stack)),
                                       "kind": "millisecond-clock", "value": milliseconds})
            emulator.reg_write(UC_X86_REG_EAX, milliseconds)
            emulator.reg_write(UC_X86_REG_EIP, dword(emulator, stack))
            emulator.reg_write(UC_X86_REG_ESP, stack + 4)

        machine.hook_add(UC_HOOK_CODE, clock_service, begin=0x40B030, end=0x40B030)
        world_services = world_service_boundary(machine)
        world_services["sourceRelations"] = relations
        if world_boundary:
            world_services["adversarialControls"] = relation_controls(machine)
            print(json.dumps({"mission": f"{faction}02", "worldServices": world_services, "admitted": False}))
            return
        def trace_scan(emulator, address, size, data):
            if address == 0x43D814:
                events.append({"kind": "action-chain", "pointer": hex(emulator.reg_read(UC_X86_REG_EDX))})
            elif address == 0x418F4C:
                events.append({"kind": "carrier-constructor", "team": emulator.reg_read(UC_X86_REG_EDX)})
            elif address == 0x43D840:
                events.append({"kind": "ai", "words": list(struct.unpack("<2h", emulator.mem_read(
                    emulator.reg_read(UC_X86_REG_ESI) + 4, 4)))})

        for address in (0x43D814, 0x418F4C, 0x43D840):
            machine.hook_add(UC_HOOK_CODE, trace_scan, begin=address, end=address)
        failure = None
        completed = []
        carrier_updates = []
        native_calls = []
        current_entity = {}
        policy_calls = []
        group_completions = []
        pending_group = None
        orders = []
        consumption = []
        before_order = None
        task_consumption = []
        pending_task = None
        ordered_at = {}
        ordered_by = {}
        scheduler_visits = []
        selector_team = None
        completed_world_updates = 0
        world_stages = []
        audit = {"worldEntries": 0, "worldReturns": 0, "policyRngDraws": 0, "crtRngDraws": 0,
                 "combatEvents": [], "projectileReclaims": 0, "ticks": [], "scans": [],
                 "pathBoundary": None, "runtimeCoreInterceptions": [], "actorConstructors": []}
        tick_entities = None
        source_path = (NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.PTH").read_bytes()[65536:]

        def observe_audit(emulator, address, size, data):
            nonlocal tick_entities
            frame_counter = dword(emulator, NATIVE.GAME + 0x94C)
            if address == 0x4196F4:
                audit["worldEntries"] += 1
                tick_entities = bytes(emulator.mem_read(NATIVE.GAME + 0x7D28, 800 * 220))
            elif address == 0x419D55:
                audit["worldReturns"] += 1
                current = bytes(emulator.mem_read(NATIVE.GAME + 0x7D28, 800 * 220))
                changes = []
                for slot in range(800):
                    previous = tick_entities[slot * 220:(slot + 1) * 220]
                    actor = current[slot * 220:(slot + 1) * 220]
                    if previous[0x2C:0x2E] != actor[0x2C:0x2E] or previous[12:16] != actor[12:16]:
                        changes.append({"slot": slot, "type": actor[6], "owner": actor[7],
                                        "beforeStatusBytes": previous[0x2C:0x2E].hex(),
                                        "afterStatusBytes": actor[0x2C:0x2E].hex(),
                                        "beforeHealth": struct.unpack_from("<i", previous, 12)[0],
                                        "afterHealth": struct.unpack_from("<i", actor, 12)[0]})
                relation_bytes = bytes(emulator.mem_read(NATIVE.GAME + 0x46F34, 80))
                audit["ticks"].append({"frame": frame_counter, "troCounter": dword(emulator, NATIVE.GAME + 0x52C),
                    "sourceClock": dword(emulator, NATIVE.GAME + 0x530), "rngCursor": dword(emulator, 0x479204),
                    "crtState": dword(emulator, 0x85400C), "statusChanges": changes,
                    "entitiesSha256": hashlib.sha256(current).hexdigest(),
                    "relations": relation_bytes.hex(),
                    "visibilityMasks": [dword(emulator, NATIVE.GAME + 0x19C0 + owner * 0xE30) for owner in range(8)],
                    "projectileHighWater": dword(emulator, NATIVE.GAME + 0x7D24)})
            elif address in (0x411DB4, 0x44E22D):
                audit["policyRngDraws" if address == 0x411DB4 else "crtRngDraws"] += 1
            elif address in (0x441710, 0x4121D8):
                audit["combatEvents"].append({"entry": hex(address), "frame": frame_counter, "update": counter,
                    "slot": emulator.reg_read(UC_X86_REG_EDX), "ebx": emulator.reg_read(UC_X86_REG_EBX),
                    "ecx": emulator.reg_read(UC_X86_REG_ECX), "rngCursor": dword(emulator, 0x479204)})
            elif address == 0x44168C:
                audit["projectileReclaims"] += 1
            elif address == 0x43E4D0:
                audit["scans"].append({"frame": frame_counter, "counter": dword(emulator, NATIVE.GAME + 0x52C)})
            elif address == 0x41AF14:
                stack = emulator.reg_read(UC_X86_REG_ESP)
                audit["actorConstructors"].append({"frame": frame_counter, "caller": hex(dword(emulator, stack)),
                    "tile": [emulator.reg_read(UC_X86_REG_EDX), emulator.reg_read(UC_X86_REG_EBX)],
                    "type": emulator.reg_read(UC_X86_REG_ECX), "owner": dword(emulator, stack + 4),
                    "slot": dword(emulator, stack + 16)})
            elif address == 0x414F8F:
                frame = emulator.reg_read(UC_X86_REG_EBP)
                tile_x, tile_y = dword(emulator, frame - 0x18), dword(emulator, frame - 0x1C)
                width = dword(emulator, MAP + 0x9A4B0)
                cell = dword(emulator, dword(emulator, MAP + 0x1404) + tile_y * 4) + tile_x * 24
                actor = bytes(emulator.mem_read(NATIVE.GAME + 0x7D28 + current_entity["slot"] * 220, 220))
                audit["pathBoundary"] = {"module": "ticker.c", "line": 1695, "branch": "0x414f8f",
                    "assertion": "state->map->path.paths[ys][xs].family", "sourceTile": [tile_x, tile_y],
                    "positionQ8": list(struct.unpack_from("<H", actor)) + list(struct.unpack_from("<H", actor, 4)),
                    "goalQ8": list(struct.unpack_from("<2H", actor, 0x2E)),
                    "airDispatchFlag": emulator.mem_read(frame - 8, 1)[0],
                    "typeBytes": bytes(emulator.mem_read(placement.TYPES + actor[6] * 280, 280)).hex(),
                    "inputPlanes": {hex(offset): bytes(emulator.mem_read(
                        dword(emulator, MAP + offset + tile_y * 4) + tile_x * stride, stride)).hex()
                        for offset, stride in ((4, 4), (0x804, 4), (0xC04, 2), (0x1004, 2))},
                    "sourceFamilyFlippedY": source_path[(dword(emulator, MAP + 0x9A4B4) - 1 - tile_y) * width + tile_x],
                    "destinationTile": [dword(emulator, frame - 0xC), emulator.reg_read(UC_X86_REG_EDI)],
                    "cell": hex(cell), "cellBytes": bytes(emulator.mem_read(cell, 24)).hex(),
                    "family": emulator.mem_read(cell + 12, 1)[0], "sourceFamily": source_path[tile_y * width + tile_x],
                    "actor": dict(current_entity), "actorBytes": actor.hex(), "nativeFrame": frame_counter,
                    "requiredHostState": "original source placement/navigation lifecycle leading to a nonzero origin family; not a fabricated family or task result"}

        for address in (0x4196F4, 0x419D55, 0x411DB4, 0x44E22D, 0x441710, 0x4121D8, 0x44168C, 0x43E4D0, 0x414F8F, 0x41AF14):
            machine.hook_add(UC_HOOK_CODE, observe_audit, begin=address, end=address)
        initial_entities = bytes(machine.mem_read(NATIVE.GAME + 0x7D28, 800 * 220))
        initial_map = bytes(machine.mem_read(0xB00000, dword(machine, MAP + 0x9A4B0) * dword(machine, MAP + 0x9A4B4) * 4))
        limit = (14096 if faction == "HUMAN" else 1136) + (64 if full_world else 0)
        if prefix_limit is not None:
            assert full_world and 0 < prefix_limit <= limit
            limit = prefix_limit
        put(machine, NATIVE.GAME + 0x544, 0x850000)

        def observe_update(emulator, address, size, data):
            nonlocal before_order, pending_group, pending_task, selector_team
            stack = emulator.reg_read(UC_X86_REG_ESP)
            record = {"address": hex(address)}
            if address not in (0x419BE5, 0x421725, 0x421741, 0x44BEC6, 0x44BED7, 0x44BEE7, 0x44BEF8, 0x44BF09):
                record["caller"] = hex(dword(emulator, stack))
            native_calls.append(record)
            del native_calls[:-12]
            if address in (0x4456F0, 0x44A6D4, 0x439F40, 0x44293C):
                world_stages.append({**record, "update": counter})
            if address == 0x419248:
                slot = emulator.reg_read(UC_X86_REG_EDX)
                entity = NATIVE.GAME + 0x7D28 + slot * 220
                previous = bytes(emulator.mem_read(entity, 220))
                if full_world and previous[0x36] and slot in ordered_at:
                    pending_task = {"slot": slot, "before": previous.hex(), "pendingBefore": previous[0x36],
                                    "receivedFrame": ordered_at[slot], "frame": dword(emulator, NATIVE.GAME + 0x94C),
                                    "team": ordered_by[slot],
                                    "entry": "0x419248", "handlers": []}
                top = struct.unpack("<b", emulator.mem_read(entity + 0x38, 1))[0]
                current_entity.clear()
                current_entity.update({"slot": slot, "type": emulator.mem_read(entity + 6, 1)[0],
                                       "top": top, "opcode": emulator.mem_read(entity + 0x39 + top * 2, 1)[0],
                                       "animationBank": hex(dword(emulator, entity + 0x14)), "update": counter})
                if current_entity["type"] in (92, 93):
                    carrier_updates.append(dict(current_entity))
            elif address == 0x419BE5 and pending_task is not None:
                current = bytes(emulator.mem_read(NATIVE.GAME + 0x7D28 + pending_task["slot"] * 220, 220))
                previous = bytes.fromhex(pending_task["before"])
                pending_task.update(after=current.hex(), pendingAfter=current[0x36],
                                    taskStackChanged=previous[0x38:0xA6] != current[0x38:0xA6],
                                    reason="native-pending-cleared" if not current[0x36] else "native-task-retained-pending")
                task_consumption.append(pending_task)
                pending_task = None
            elif address == 0x412014 and pending_task is not None:
                pending_task["handlers"].append(hex(address))
            elif address == 0x41AB20:
                selector_team = emulator.reg_read(UC_X86_REG_EDX)
                scheduler_visits.append({"team": selector_team, "frame": dword(emulator, NATIVE.GAME + 0x94C),
                                         "caller": hex(dword(emulator, stack)), "update": counter,
                                         "mode": dword(emulator, NATIVE.GAME + 0xBBC + selector_team * 0xE30)})
            elif address in (0x4598B0, 0x4593A8, 0x458B44, 0x459F80, 0x463E78):
                policy_calls.append({"entry": hex(address), "group": emulator.reg_read(UC_X86_REG_EBX),
                                     "update": counter, "rngCursor": dword(emulator, 0x479204)})
            elif address == 0x421725:
                packet = emulator.reg_read(UC_X86_REG_ESI)
                length = struct.unpack("<H", emulator.mem_read(packet, 2))[0]
                orders.append({"update": counter, "frame": dword(emulator, NATIVE.GAME + 0x94C),
                               "team": selector_team, "packet": bytes(emulator.mem_read(packet, length)).hex()})
            elif address == 0x41DEFC:
                before_order = bytes(emulator.mem_read(NATIVE.GAME + 0x7D28, 800 * 220))
            elif address == 0x421741:
                assert before_order is not None
                after_order = bytes(emulator.mem_read(NATIVE.GAME + 0x7D28, 800 * 220))
                changed = []
                for slot in range(800):
                    previous = before_order[slot * 220:(slot + 1) * 220]
                    current = after_order[slot * 220:(slot + 1) * 220]
                    if previous != current:
                        changed.append({"slot": slot, "beforeTaskState": previous[0x36:0xA6].hex(),
                                        "afterTaskState": current[0x36:0xA6].hex()})
                        ordered_at[slot] = dword(emulator, NATIVE.GAME + 0x94C)
                        ordered_by[slot] = selector_team
                consumption.append({"update": counter, "frame": dword(emulator, NATIVE.GAME + 0x94C),
                                    "decoder": "0x41defc", "changedEntities": changed,
                                    "reason": "native-entity-writes" if changed else "native-decoder-no-entity-writes"})
                before_order = None
            elif address == 0x44BEC6 and (full_world or counter == limit):
                frame = emulator.reg_read(UC_X86_REG_EBP)
                group = dword(emulator, frame - 8)
                if dword(emulator, frame - 0xC) == team and not any(record["group"] == group for record in group_completions):
                    pending_group = {"group": dword(emulator, frame - 8), "returns": [],
                                     "team": team, "frame": dword(emulator, NATIVE.GAME + 0x94C),
                                     "schedulerVisit": scheduler_visits[-1] if scheduler_visits else None,
                                     "policy": emulator.reg_read(UC_X86_REG_ESI),
                                     "beforePolicy": bytes(emulator.mem_read(emulator.reg_read(UC_X86_REG_ESI), 0x6C40)),
                                     "beforeEntities": bytes(emulator.mem_read(NATIVE.GAME + 0x7D28, 800 * 220)),
                                     "rngBefore": dword(emulator, 0x479204)}
            elif address in (0x44BED7, 0x44BEE7, 0x44BEF8, 0x44BF09) and pending_group is not None:
                pending_group["returns"].append(hex(address))
                if address == 0x44BF09:
                    record = pending_group
                    group = record["group"]
                    assert record["returns"] == ["0x44bed7", "0x44bee7", "0x44bef8", "0x44bf09"]
                    callback_table = struct.unpack("<6I", emulator.mem_read(record["policy"] + group * GROUP_STRIDE + 0x3168, 24))
                    assert callback_table == CALLBACKS[group]
                    record["callbacks"] = [hex(callback_table[index]) for index in (0, 3, 1, 2)]
                    for label, pointer, length in (("Policy", record["policy"], 0x6C40),
                                                   ("Entities", NATIVE.GAME + 0x7D28, 800 * 220)):
                        previous = record.pop("before" + label)
                        current = bytes(emulator.mem_read(pointer, length))
                        record[label.lower()] = {"beforeSha256": hashlib.sha256(previous).hexdigest(),
                                                "afterSha256": hashlib.sha256(current).hexdigest(),
                                                "before": base64.b64encode(previous).decode(),
                                                "after": base64.b64encode(current).decode(),
                                                "changedBytes": sum(before != after for before, after in zip(previous, current))}
                    record["rngAfter"] = dword(emulator, 0x479204)
                    group_completions.append(record)
                    pending_group = None

        for address in (0x419248, 0x419BE5, 0x412014, 0x4264C8, 0x42630C, 0x44D918, 0x41AB20,
                        0x4598B0, 0x4593A8, 0x458B44, 0x459F80, 0x463E78, 0x421725,
                        0x41DEFC, 0x421741, 0x41CE54, 0x44BEC6, 0x44BED7, 0x44BEE7, 0x44BEF8, 0x44BF09,
                        0x4456F0, 0x44A6D4, 0x439F40, 0x44293C):
            machine.hook_add(UC_HOOK_CODE, observe_update, begin=address, end=address)
        for counter in range(limit + 1):
            try:
                if full_world and counter < limit:
                    invoke(machine, 0x40B3CC, eax=int(session["server"], 16))
                    clock_milliseconds += dword(machine, int(session["server"], 16) + 0x234)
                    invoke(machine, 0x40B3CC, eax=int(session["server"], 16))
                    invoke(machine, 0x41E4F4, instruction_limit=50000000, eax=NATIVE.GAME)
                    assert machine.reg_read(UC_X86_REG_EAX) != 0xFFFFFFFF, "native client receive returned failure"
                    assert dword(machine, NATIVE.GAME + 0x94C) == counter + 1, (
                        f"native clock advanced to {dword(machine, NATIVE.GAME + 0x94C)} at pump {counter}")
                    completed_world_updates += 1
                    if (counter + 1) % 8 == 0:
                        completed.append(counter + 1)
                    continue
                if not full_world and counter % 8 == 0:
                    invoke(machine, 0x43E4D0, eax=NATIVE.GAME)
                    completed.append(counter)
                if counter == limit:
                    if not full_world and dword(machine, NATIVE.GAME + team * 0xE30 + 0xBBC) == 3:
                        invoke(machine, 0x42163C, eax=1)
                        invoke(machine, 0x41AB20, instruction_limit=50000000, eax=NATIVE.GAME, edx=team)
                        invoke(machine, 0x42163C, eax=0)
                        assert [record["group"] for record in group_completions] == [0, 1, 2, 3]
                        ordered_slots = sorted({record["slot"] for receipt in consumption if receipt["update"] == limit
                                                for record in receipt["changedEntities"]})
                        for slot in ordered_slots:
                            entity = NATIVE.GAME + 0x7D28 + slot * 220
                            previous = bytes(machine.mem_read(entity, 220))
                            invoke(machine, 0x419248, eax=NATIVE.GAME, edx=slot)
                            current = bytes(machine.mem_read(entity, 220))
                            task_consumption.append({"slot": slot, "entry": "0x419248", "clock": counter,
                                                     "before": previous.hex(), "after": current.hex(),
                                                     "pendingBefore": previous[0x36], "pendingAfter": current[0x36],
                                                     "taskStackChanged": previous[0x38:0xA6] != current[0x38:0xA6]})
                            assert previous[0x36] == 1 and current[0x36] == 0
                            assert previous[0x38:0xA6] != current[0x38:0xA6]
                    break
                put(machine, NATIVE.FRAME - 4, NATIVE.GAME)
                machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
                machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
                machine.emu_start(0x41989E, 0x4198C3, count=1000)
                assert machine.reg_read(UC_X86_REG_EIP) == 0x4198C3
                machine.emu_start(0x419BB8, 0x419C0E, count=5000000)
                assert machine.reg_read(UC_X86_REG_EIP) == 0x419C0E
                put(machine, NATIVE.GAME + 0x94C, counter + 1)
                invoke(machine, 0x42163C, eax=1)
                invoke(machine, 0x41AC2C, instruction_limit=50000000, eax=NATIVE.GAME)
                invoke(machine, 0x42163C, eax=0)
            except Exception as error:
                failure = str(error)
                break
        activation_frame = group_completions[0].get("frame") if group_completions and full_world else None
        target_consumption = [record for record in task_consumption if activation_frame is not None
                              and record["team"] == team and record["receivedFrame"] >= activation_frame
                              and record["frame"] > record["receivedFrame"] and record["pendingAfter"] == 0]
        print(json.dumps({"mission": f"{faction}02", "sourceSha256": digest,
                          "executableSha256": NATIVE.AUDIT.DIGEST,
                          "allSourceConsumed": True, "compiledBlocks": len(blocks), "compiledActions": action_count,
                          "triggerFileBoundaries": trigger_file_boundaries,
                          "completedScanCounters": completed, "attemptedCounter": counter,
                          "carrierUpdates": carrier_updates,
                          "carrierAnimations": animation_sources,
                          "messageSource": message_source, "externalBoundaries": external_boundaries,
                          "debugOutputBoundaries": machine.ai_output_boundaries,
                          "soundSource": sound_source,
                          "worldServices": world_services,
                          "sourceClock": source_clock,
                          "sourcePathInitialization": getattr(machine, "source_path_initialization", None),
                          "sourceScnInitialization": getattr(machine, "source_scn", None),
                          "pathCellControl": path_cell_control,
                          "sessionTransport": session,
                          "nativeAudit": audit,
                          "contiguousWorld": {"enabled": full_world, "entry": "0x4196f4",
                                              "completedUpdates": completed_world_updates,
                                              "stages": world_stages,
                                              "nativeReset": {"entry": "0x40bf80", "entityRegistryWords": 800,
                                                              "projectileRecords": 2024, "projectileStride": 40,
                                                              "projectileHeads": [-1, -1]},
                                              "projectileAllocationCounter": dword(machine, NATIVE.GAME + 0x7D24),
                                              "changedEntityBytes": sum(before != after for before, after in zip(initial_entities,
                                                  machine.mem_read(NATIVE.GAME + 0x7D28, len(initial_entities)))),
                                              "changedMapBytes": sum(before != after for before, after in zip(initial_map,
                                                  machine.mem_read(0xB00000, len(initial_map)))),
                                              "nextInstruction": next((f"{instruction.mnemonic} {instruction.op_str}"
                                                  for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(
                                                      bytes(machine.mem_read(machine.reg_read(UC_X86_REG_EIP), 16)),
                                                      machine.reg_read(UC_X86_REG_EIP))), None) if failure else None,
                                              "registers": {name: hex(machine.reg_read(globals()["UC_X86_REG_" + name]))
                                                            for name in ("EAX", "EBX", "ECX", "EDX", "ESI", "EDI", "EBP", "ESP")}},
                          "lastNativeCalls": native_calls, "currentEntity": current_entity,
                          "policyCalls": policy_calls, "submittedOrders": orders,
                          "orderConsumption": consumption,
                          "groupCompletions": group_completions,
                          "schedulerVisits": scheduler_visits,
                          "taskConsumptionProbe": {"scope": ("registered dispatcher returns inside subsequent original world ticks" if full_world else
                                                               "one native dispatcher visit per ordered actor at frozen activation clock, NOT another historical world tick"),
                                                   "actors": task_consumption},
                          "acceptance": {"allFourGroupsReturned": len(group_completions) == 4,
                                         "actorOrdersConsumed": sum(record["pendingAfter"] == 0 for record in task_consumption),
                                         "emptyOrdersRejected": not any(record["pendingAfter"] == 0 for record in task_consumption),
                                         "targetActorOrdersConsumed": len(target_consumption),
                                         "targetActorSlots": sorted({record["slot"] for record in target_consumption}),
                                         "targetEmptyOrdersRejected": not target_consumption,
                                         "sourceInitializationComplete": full_world and machine.source_scn["returned"],
                                         "completeWorldHistory": full_world and failure is None and completed_world_updates == limit,
                                         "naturalSchedulerActivation": full_world and len(group_completions) == 4,
                                         "subsequentWorldFeedback": bool(target_consumption)},
                          "fixtureInterfaces": {
                              "mode": ("original constructor and explicit selected mode0 header at game+0x544 -> 0x850000" if full_world else
                                       "game+0x544 -> 0x850000, explicit zero-initialized mode record"),
                              "audioOutput": "0x498f60+8 -> 0x852000; method +0x80(eax=sample, edx=volume, ebx=pan) returns -1 only; camera Q8=(0,0)",
                              "crtRandom": "0x516a94 -> 0x854000; explicit seed1 via native 0x44e251; native 0x44e22d draws",
                              "frame": ("native clock packets increment game+0x94c via 0x41cb2c; external time follows queued native server period" if full_world else
                                        "game+0x94c supplied by outer harness, one per native entity loop"),
                              "scheduler": "0x41aa70(eax=game), then 0x41ac2c(eax=game) each frame",
                              "transport": ("local.c client/server ready handshake; 0x40b3cc -> 0x41e4f4 -> 0x41defc; native AI-local bracket retained" if full_world else
                                            "0x421630(eax=game); native 0x42163c(eax=1/0) brackets AI; 0x41defc consumes packets"),
                              "activationPolicy": ("only historical round-robin 0x41ac2c calls; no extra selector or actor dispatch" if full_world else
                                                   "explicit 0x41ab20(eax=game, edx=targetTeam) at update limit if mode3"),
                              "entityLoop": "0x419bb8..0x419c0e, [ebp-4]=game; native registered slots",
                              "scanner": ("0x43e4d0 inside original world updater at native counters divisible by eight" if full_world else
                                          "0x43e4d0(eax=game), every eight counters")},
                          "updateLimit": limit, "instructionLimitPerWorldLoop": 50000000 if full_world else 5000000,
                          "instructionLimitPerPolicyCall": 50000000,
                          "events": events, "failure": failure, "eip": hex(machine.reg_read(UC_X86_REG_EIP)),
                          "selector": dword(machine, NATIVE.GAME + team * 0xE30 + 0xBBC),
                          "scope": ("contiguous native world updater; fail-closed at first missing dependency" if full_world else
                                    "unchanged TRO scan with native counters and registered entity updates; incomplete world services"),
                          "admitted": False}))
        return

    def boundary(emulator, address, size, data):
        if address == 0x43D840:
            events.append({"kind": "ai", "words": list(struct.unpack("<2h", emulator.mem_read(
                emulator.reg_read(UC_X86_REG_ESI) + 4, 4)))})
        elif address == 0x43E1B1:
            pointer = emulator.reg_read(UC_X86_REG_ESI)
            selected, carrier = emulator.mem_read(pointer + 4, 2)
            events.append({"kind": "blocked-commander-lifecycle", "selectedTeam": selected,
                           "carrierTeam": carrier, "requiredField": hex(0x1934 + selected * 0xE30),
                           "sourceInitializationDoesNotSupplyCommander": True})
            emulator.emu_stop()
        elif address == 0x418F4C:
            stack = emulator.reg_read(UC_X86_REG_ESP)
            types, counts = dword(emulator, stack + 4), dword(emulator, stack + 8)
            events.append({"kind": "blocked-transport-constructor", "team": emulator.reg_read(UC_X86_REG_EDX),
                           "tile": [emulator.reg_read(UC_X86_REG_EBX), emulator.reg_read(UC_X86_REG_ECX)],
                           "types": list(emulator.mem_read(types, 5)), "counts": list(emulator.mem_read(counts, 5))})
            emulator.emu_stop()

    for address in (0x43D840, 0x43E1B1, 0x418F4C):
        machine.hook_add(UC_HOOK_CODE, boundary, begin=address, end=address)
    pointer = dword(machine, 0x4FBC48 + block["id"] * 16 + 12)
    put(machine, NATIVE.STACK, RETURN)
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EDX, pointer)
    machine.emu_start(0x43D814, RETURN, count=1000000)
    assert machine.reg_read(UC_X86_REG_EIP) == (0x418F4C if faction == "HUMAN" else 0x43E1B1)
    assert dword(machine, NATIVE.GAME + team * 0xE30 + 0xBBC) == (3 if faction == "HUMAN" else 4)
    print(json.dumps({"mission": f"{faction}02", "sourceSha256": digest,
                      "compiledBlocks": len(blocks), "compiledActions": action_count,
                      "allSourceConsumed": True, "activation": block,
                      "nativeExecutionOrder": [action["raw"] for action in reversed(block["actions"])],
                      "events": events, "precedingTriggersExecuted": False,
                      "admitted": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", nargs=2, metavar=("ADDRESS", "LENGTH"), type=lambda value: int(value, 0))
    parser.add_argument("--source-continuation", action="store_true")
    parser.add_argument("--callback-goldens", action="store_true")
    parser.add_argument("--activation-boundary", action="store_true")
    parser.add_argument("--decision-goldens", action="store_true")
    parser.add_argument("--active-consumer-goldens", action="store_true")
    parser.add_argument("--activation-scan", action="store_true")
    parser.add_argument("--mission", choices=("HUMAN", "ALIEN"))
    parser.add_argument("--world-service-boundary", action="store_true")
    parser.add_argument("--world-activation-scan", action="store_true")
    parser.add_argument("--world-prefix-limit", type=int)
    parser.add_argument("--path-initialization-proof", action="store_true")
    parser.add_argument("--path-cell-controls", action="store_true")
    parser.add_argument("--session-transport", action="store_true")
    parser.add_argument("--source-initialization-proof", action="store_true")
    args = parser.parse_args()
    if args.source_initialization_proof:
        for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
            if args.mission is None or args.mission == faction:
                activation_boundary(faction, team, scan=True, full_world=True, source_proof=True)
        return
    if args.path_cell_controls:
        for control in ("zero-coordinates", "zero-sentinel", "zero-coordinates-and-sentinel"):
            for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
                if args.mission is None or args.mission == faction:
                    activation_boundary(faction, team, True, False, True, 64, path_cell_control=control)
        return
    if args.session_transport:
        machine = fixture()
        profile = initialize_campaign_profile(machine, args.mission or "HUMAN")
        print(json.dumps({"profile": profile, **initialize_session_transport(machine)}))
        return
    if args.world_prefix_limit is not None and not args.world_activation_scan:
        parser.error("--world-prefix-limit requires --world-activation-scan")
    if args.activation_scan or args.world_service_boundary or args.world_activation_scan or args.path_initialization_proof:
        for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
            if args.mission is None or args.mission == faction:
                activation_boundary(faction, team, True, args.world_service_boundary,
                                    args.world_activation_scan or args.path_initialization_proof,
                                    args.world_prefix_limit, args.path_initialization_proof)
        return
    if args.decision_goldens or args.active_consumer_goldens:
        for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
            source_continuation(faction, team, True, args.active_consumer_goldens)
        return
    if args.activation_boundary:
        for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
            activation_boundary(faction, team)
        return
    if args.callback_goldens:
        callback_goldens()
        return
    if args.source_continuation:
        for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
            source_continuation(faction, team)
        return
    if args.disassemble:
        address, length = args.disassemble
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(NATIVE.READ(address, length), address):
            print(f"{instruction.address:08x} {instruction.bytes.hex():22} {instruction.mnemonic} {instruction.op_str}")
        return
    print(f"SHA256 {NATIVE.AUDIT.DIGEST}")
    selector_probe()
    for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
        for control in ("baseline", "preferred-occupied", "zero-rate", "dead", "rotting", "occupied", "route-score", "no-route"):
            resource_probe(faction, team, control)
    print("PASS native mode3 initialization and 16 bounded resource-objective fixtures; NOT a complete mission tick")


if __name__ == "__main__":
    main()