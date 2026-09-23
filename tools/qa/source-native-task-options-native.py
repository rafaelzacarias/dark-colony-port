"""Source constructor oracle for immutable native task profiles."""

import importlib.util
import json
from pathlib import Path
import argparse
import hashlib
import struct

spec = importlib.util.spec_from_file_location("task_oracle", Path(__file__).with_name("nativeactor-task-native.py"))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
AI = oracle.AI
GAME = AI.NATIVE.GAME
KINDS = (0, 8, 69, 73, 2, 3)


def scan(machine, sources, rows, faction, mission):
    AI.initialize_campaign_profile(machine, faction)
    AI.invoke(machine, 0x419D60)
    machine.reg_write(AI.UC_X86_REG_EBP, AI.NATIVE.FRAME)
    machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
    for start, end in ((0x4012B4, 0x4012E6), (0x4014C6, 0x4014ED), (0x40183B, 0x40185F)):
        AI.put(machine, AI.NATIVE.FRAME + 0x7A, 0x850000)
        machine.emu_start(start, end, count=10000)
        assert machine.reg_read(AI.UC_X86_REG_EIP) == end
    AI.put(machine, GAME + 0x7D18, 0x703000)
    AI.put(machine, 0x49469C, 0)
    machine.mem_map(0x2600000, 0x100000)
    cursor = 0x2600010
    source_lines = iter(rows)
    reads, handles, boundaries = [], {}, []
    type_bytes = bytes(machine.mem_read(0x4F1880, 110 * 280))
    dependencies = bytes(machine.mem_read(0x4E6D70, 110 * 52))
    file_reads = {extension: bytearray() for extension in ("TRO", "MSG")}

    def boundary(emulator, address, size, data):
        nonlocal cursor
        stack = emulator.reg_read(AI.UC_X86_REG_ESP)
        caller = AI.dword(emulator, stack)
        result = 0
        if address == 0x40BCC0:
            length = emulator.reg_read(AI.UC_X86_REG_EDX)
            assert 0 < length < 0x10000 and cursor + length < 0x2700000
            result = cursor
            cursor += (length + 31) & ~15
            emulator.mem_write(result, b"\xa5" * length)
        elif address == 0x43C388:
            emulator.mem_write(0x4F1880, type_bytes)
            emulator.mem_write(0x4E6D70, dependencies)
        elif address == 0x435F30:
            result = AI.MAP
        elif address == 0x40601C:
            result = 0x708000
        elif address in (0x41B8AC, 0x41B864):
            line = next(source_lines, None)
            if line is not None:
                reads.append(line)
                emulator.mem_write(emulator.reg_read(AI.UC_X86_REG_EAX), line.encode("ascii") + b"\0")
                result = 1
        elif address == 0x406288:
            filename = bytes(emulator.mem_read(emulator.reg_read(AI.UC_X86_REG_EAX), 1024)).split(b"\0", 1)[0].decode("ascii")
            extension = "TRO" if caller == 0x43FBF6 else "MSG"
            assert filename.lower().endswith(mission.lower()), filename
            result = len(handles) + 1
            handles[result] = (extension, iter(sources[extension].splitlines(keepends=True)))
        elif address in (0x406338, 0x4062B4):
            extension, lines = handles[emulator.reg_read(AI.UC_X86_REG_EBX)]
            line = next(lines, None)
            if line is not None:
                result = emulator.reg_read(AI.UC_X86_REG_EAX)
                emulator.mem_write(result, line + b"\0")
                file_reads[extension].extend(line)
        boundaries.append(hex(address))
        emulator.reg_write(AI.UC_X86_REG_EAX, result)
        emulator.reg_write(AI.UC_X86_REG_EIP, caller)
        emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4)

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, boundary, begin=address, end=address) for address in (
        0x40BCC0, 0x43C388, 0x435F30, 0x40601C, 0x41B8AC, 0x41B864,
        0x406288, 0x406338, 0x4062B4, 0x40636C, 0x406560, 0x40B030)]
    AI.invoke(machine, 0x41B920, instruction_limit=10000000, eax=GAME, edx=0x850000, ebx=0)
    for hook in hooks:
        machine.hook_del(hook)
    assert reads == rows
    assert all(bytes(file_reads[extension]) == sources[extension] for extension in file_reads)
    return {"entry": "0x41b920", "linesRead": len(reads), "externalBoundaries": sorted(set(boundaries)),
            "scenarioSha256": hashlib.sha256(sources["SCN"]).hexdigest()}


def capture(mission):
    faction = mission[:-2]
    directory = AI.NATIVE.ROOT / "raw_cd/DC/SCENARIO" / faction
    sources = {extension: (directory / f"{mission}.{extension}").read_bytes()
               for extension in ("SCN", "MAP", "MTG", "PTH", "TRO", "MSG")}
    width, height = struct.unpack_from("<II", sources["MAP"])
    rows = [line.strip() for line in sources["SCN"].decode("ascii").splitlines()
            if line.strip() and not line.lstrip().startswith("%")]
    machine = AI.fixture()
    AI.initialize_fresh_game(machine)
    AI.put(machine, GAME + 0x46F2C, AI.MAP)
    AI.put(machine, AI.MAP + 0x9A4B0, width)
    AI.put(machine, AI.MAP + 0x9A4B4, height)
    for row in range(height):
        AI.put(machine, AI.MAP + 0x804 + row * 4, AI.GROUND + row * width * 4)
        machine.mem_write(AI.GROUND + row * width * 4, struct.pack("<I", 1023) * width)
    AI.initialize_source_path(machine, sources["PTH"], width, height)
    animations = None

    def load_animations(current, source_rows):
        nonlocal animations
        kinds = set(KINDS) | {92, 93}
        kinds.update(int(line.split()[2]) for line in source_rows if len(line.split()) == 6)
        kinds.update(int(line.split()[2]) for line in source_rows if len(line.split()) == 5 and line.split()[2] == "40")
        animations = AI.load_carrier_animations(current, sorted(kinds))

    original_scan = AI.initialize_full_source_scn
    proof = None

    def initialize(current, content, source_rows):
        nonlocal proof
        proof = scan(current, content, source_rows, faction, mission)

    AI.initialize_full_source_scn = initialize
    try:
        AI.initialize_source_world(machine, sources, width, height, rows, oracle.PLACEMENT,
                                   runtime=True, animations=load_animations, full_source=True)
    finally:
        AI.initialize_full_source_scn = original_scan
    AI.put(machine, GAME + 0x544, 0x850000)
    actors = [{"slot": slot, "raw": list(machine.mem_read(GAME + 0x7D28 + slot * 220, 220))}
              for slot in range(800) if struct.unpack("<h", machine.mem_read(GAME + 0x468EC + slot * 2, 2))[0] != -1]
    world = {"width": width, "height": height,
             "ground": list(struct.unpack(f"<{width * height}I", machine.mem_read(AI.GROUND, width * height * 4))),
             "air": list(struct.unpack(f"<{width * height}H", machine.mem_read(0xB40000, width * height * 2))),
             "extra": list(struct.unpack(f"<{width * height}H", machine.mem_read(0xB60000, width * height * 2))),
             "families": [machine.mem_read(AI.dword(machine, AI.dword(machine, AI.MAP + 0x1404) + row * 4) + column * 24 + 12, 1)[0]
                          for row in range(height) for column in range(width)],
             "teams": [{"teamControl": AI.dword(machine, GAME + team * 0xE30 + 0xBBC),
                        "enemyMask": AI.dword(machine, GAME + team * 0xE30 + 0x19C0)} for team in range(8)]}
    created = []
    for index, kind in enumerate(KINDS):
        for team in (0, 1):
            machine.mem_write(AI.NATIVE.STACK + 4, struct.pack("<ii", team, -1))
            def explicit_health(emulator, address, size, context):
                AI.put(emulator, emulator.reg_read(AI.UC_X86_REG_ESP) + 8, 197)
            hook = machine.hook_add(AI.UC_HOOK_CODE, explicit_health, begin=0x41AF14, end=0x41AF14) if team == 1 else None
            AI.invoke(machine, 0x41B750, eax=GAME, edx=12 + index * 3, ebx=12 + team * 4, ecx=kind)
            if hook is not None:
                machine.hook_del(hook)
            slot = machine.reg_read(AI.UC_X86_REG_EAX)
            created.append({"slot": slot, "explicitConstructorHealth": 197 if team == 1 else None,
                            "inputBoundaryWrites": ["0x41af14:esp+8"] if team == 1 else [],
                            "raw": list(machine.mem_read(GAME + 0x7D28 + slot * 220, 220))})
    types = []
    for kind in KINDS:
        type_raw = list(machine.mem_read(0x4F1880 + kind * 280, 280))
        fin = {}
        for offset in (0x7C, 0x80):
            bank = struct.unpack_from("<I", bytes(type_raw), offset)[0]
            fin[str(bank)] = []
            for direction in range(32):
                animation = AI.dword(machine, bank + direction * 4)
                timeline, length = AI.dword(machine, animation + 0x20), AI.dword(machine, animation + 0x28)
                fin[str(bank)].append([machine.mem_read(timeline + frame * 72 + 2, 1)[0] for frame in range(length)])
        types.append({"typeId": kind, "typeBytes": type_raw, "fin": fin})
    return {"mission": mission, "binarySha256": AI.NATIVE.AUDIT.DIGEST, "sourceProof": proof,
            "runtimeIntercepts": [], "actors": actors, "created": created, "types": types, "world": world,
            "animations": animations, "sourceHashes": {name: hashlib.sha256(content).hexdigest() for name, content in sources.items()}}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mission", choices=("HUMAN01", "ALIEN01", "HUMAN02", "ALIEN02"))
    args = parser.parse_args()
    for mission in ([args.mission] if args.mission else ["HUMAN01", "ALIEN01"]):
        print(json.dumps(capture(mission)), flush=True)