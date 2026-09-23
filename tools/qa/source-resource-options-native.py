"""Bounded original-x86 evidence for fresh source resource options."""

import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
PRODUCTION = runpy.run_path(str(ROOT / "tools/qa/source-production-startup-native.py"))
BASE = PRODUCTION["BASE"]
IMAGE = PRODUCTION["IMAGE"]
from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX,
                              UC_X86_REG_EDX, UC_X86_REG_EBP, UC_X86_REG_EDI,
                              UC_X86_REG_ESI, UC_X86_REG_GDTR, UC_X86_REG_CS,
                              UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS,
                              UC_X86_REG_ESP, UC_X86_REG_EIP)
CONSTRUCTION = PRODUCTION["LIFECYCLE"]


def configuration_probe():
    native = BASE["Native"](IMAGE)
    configuration, frame = 0x850000, 0x70F800
    native.emulator.mem_write(configuration, b"\xa5" * 0x1940)
    native.run(0x429952, {UC_X86_REG_EDX: configuration, UC_X86_REG_ECX: configuration}, 0x4299CD)
    percentages = [native.get(configuration + 0x14C4 + team * 4) for team in range(8)]
    assert percentages == [100] * 8
    native.put(frame + 0x76, BASE["GAME"])
    native.put(frame + 0x7A, configuration)
    native.run(0x40177E, {UC_X86_REG_EBP: frame}, 0x4017BA)
    multipliers = [native.get(BASE["GAME"] + 0x19B8 + team * 0xE30) for team in range(8)]
    assert multipliers == [256] * 8
    native.emulator.mem_write(0x4956E0, b"\xa5" * 0x180)
    native.run(0x419D60, {})
    income = [native.get(0x4956E4 + team * 48) for team in range(8)]
    assert income == [0] * 8
    native.put(BASE["GAME"] + 0x7D1C, 0xA5A5A5A5)
    native.run(0x40BF80, {UC_X86_REG_EAX: BASE["GAME"]})
    assert native.get(BASE["GAME"] + 0x7D1C) == 0
    loaded_gates = []
    for serialized in (0, 1, -1):
        native.put(frame - 0x132, serialized)
        native.run(0x40D984, {UC_X86_REG_EBP: frame, UC_X86_REG_EDI: BASE["GAME"]}, 0x40D99F)
        loaded_gates.append(native.get(BASE["GAME"] + 0x948, 1))
    assert loaded_gates == [0, 1, 1]
    native.put(BASE["GAME"] + 0x948, 0, 1)
    native.run(0x43C500, {UC_X86_REG_EAX: BASE["GAME"]})
    assert native.get(BASE["GAME"] + 0x948, 1) == 1
    headers = [PRODUCTION["load_configuration_header"](native, configuration, race) for race in (0, 1)]
    assert [native.get(configuration + 0x14C4 + team * 4) for team in range(8)] == percentages
    return dict(constructorPercentages=percentages, multipliers=multipliers,
                initialIncome=income, localTeam=0, loadedGates=loaded_gates, modeGate=1, headers=headers)


def mission_probe(name):
    placement = runpy.run_path(str(ROOT / "tools/research/scenario-placement-20260919.py"))
    data, races, rows = placement["source"](name)
    native = CONSTRUCTION["source_fixture"](IMAGE)
    native.emulator.mem_write(0x707000, bytes(8) + bytes.fromhex("ffff0000009acf00ffff00000092cf00"))
    native.emulator.reg_write(UC_X86_REG_GDTR, (0, 0x707000, 23, 0))
    native.emulator.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
        native.emulator.reg_write(register, 16)
    game, frame = BASE["GAME"], 0x70D800
    native.emulator.mem_write(game, b"\xa5" * 0x471B0)
    native.run(0x40BDDC, {UC_X86_REG_ECX: game - 16, UC_X86_REG_EDI: 0x471B0,
                          UC_X86_REG_ESI: 0x705000, UC_X86_REG_EDX: 0}, 0x40BDEF)
    assert native.emulator.mem_read(game, 0x471B0) == bytes(0x471B0)
    profiles = CONSTRUCTION["load_fin"](native, (40, 6, 14, 47, 48))
    animations = {}
    for binding in profiles["bindings"]:
        record = 0x4F1880 + binding["unitType"] * 280
        native.emulator.mem_write(frame - 0x178, binding["stem"].encode() + b"\0")
        native.put(frame - 4, record)
        native.run(0x43C099, {UC_X86_REG_EBP: frame}, 0x43C18C)
        binding.update(deployBank=native.get(record + 0x94), deathBank=native.get(record + 0xAC),
                       removalHoldField=native.get(record + 0x100), selectedWeapon=native.get(record + 0x18))
        for field in ("standBank", "deployBank", "deathBank"):
            bank = binding[field]
            directions = []
            for direction in range(32):
                descriptor = native.get(bank + direction * 4)
                frames = native.get(descriptor + 0x20)
                directions.append([native.get(frames + index * 72 + 2, 1)
                                   for index in range(native.get(descriptor + 0x28))])
            animations[str(bank)] = directions
    native.emulator.mem_map(0xC00000, 0x200000)
    native.put(game + 0x46F2C, 0xC00000)
    native.put(0xC9A4B0, 128)
    native.put(0xC9A4B4, 128)
    for row in range(128):
        for offset, base, stride in ((4, 0xC10000, 512), (0x804, 0xC20000, 512),
                                     (0xC04, 0xC30000, 256), (0x1004, 0xC40000, 256)):
            native.put(0xC00000 + offset + row * 4, base + row * stride)
    native.emulator.mem_write(0xC20000, struct.pack("<I", 1023) * 128 * 128)
    native.emulator.mem_write(0xC30000, struct.pack("<H", 1023) * 128 * 128)
    native.emulator.mem_write(0xC40000, struct.pack("<H", 1023) * 128 * 128)
    native.run(0x40BF80, {UC_X86_REG_EAX: game})
    configuration = 0x850000
    native.run(0x429952, {UC_X86_REG_EDX: configuration, UC_X86_REG_ECX: configuration}, 0x4299CD)
    PRODUCTION["load_configuration_header"](native, configuration, races[0])
    native.emulator.mem_write(0x4956E0, b"\xa5" * 0x180)
    native.run(0x419D60, {})
    native.put(frame + 0x76, game)
    native.put(frame + 0x7A, configuration)
    native.run(0x40177E, {UC_X86_REG_EBP: frame}, 0x4017BA)
    native.put(frame - 8, configuration)
    native.put(game + 0x544, configuration)
    native.put(game + 0x7D20, 152)
    native.put(0x495710, 256)
    native.put(0x495740, 256)
    for team, race in enumerate(races):
        native.put(game + 0xBB8 + team * 0xE30, race)
    lines = iter(line.strip() for line in data.decode("ascii").splitlines()
                 if line.strip() and not line.lstrip().startswith("%"))
    def read_line(machine):
        line = next(lines, None)
        if line is not None:
            machine.emulator.mem_write(machine.emulator.reg_read(UC_X86_REG_EAX), line.encode() + b"\0")
        machine.emulator.reg_write(UC_X86_REG_EAX, int(line is not None))
    native.put(game + 0x7D18, 0x704000)
    native.put(frame - 0x14, 0)
    del native.stubs[0x46CB74]
    external = {0x43C388: None, 0x40B030: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 0),
                0x40601C: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 1),
                0x435F30: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 0xC00000),
                0x43FB90: None, 0x44D6F0: None, 0x445570: None, 0x41E7D8: None,
                0x444F14: None, 0x406560: None, 0x40636C: None, 0x44AC28: None, 0x437BC4: None,
                0x41B8AC: read_line, 0x41B864: read_line}
    native.stubs.update(external)
    native.put(BASE["STACK"], BASE["STOP"])
    for register, value in ((UC_X86_REG_ESP, BASE["STACK"]), (UC_X86_REG_EAX, 0x704000),
                            (UC_X86_REG_ESI, game), (UC_X86_REG_EBP, frame)):
        native.emulator.reg_write(register, value)
    native.emulator.emu_start(0x41B9CE, 0x41C7EE, count=2000000)
    assert native.emulator.reg_read(UC_X86_REG_EIP) == 0x41C7EE
    assert next(lines, None) is None
    fresh = dict(cancellationGate=native.get(game + 0x948, 1), localTeam=native.get(game + 0x7D1C),
                 initialIncome=[native.get(0x4956E4 + team * 48) for team in range(8)])
    assert fresh == dict(cancellationGate=0, localTeam=0, initialIncome=[0] * 8)
    assert [native.get(game + 0x19B8 + team * 0xE30) for team in range(8)] == [256] * 8
    for address in external:
        del native.stubs[address]
    records = []
    cursor = 152
    for index, text in enumerate(rows):
        row = list(map(int, text.split()))
        if row[3] == -1:
            continue
        if row[2] in (40, 6, 14):
            entity = game + 0x7D28 + cursor * 220
            records.append(dict(sourceRow=index, row=row, slot=cursor,
                                direction=native.get(entity + 9, 1),
                                rateWord=native.get(entity + 0x32, 2),
                                constructor=CONSTRUCTION["snapshot"](native, cursor)))
        cursor += 1
    assert len([record for record in records if record["row"][2] == 40]) == (4 if name == "HUMAN02" else 3)
    harvesters = []
    for slot, unit_type, owner in ((798, 6, races.index(0)), (799, 14, races.index(1))):
        for offset, value in ((4, owner), (8, -1), (12, 0), (16, slot)):
            native.put(BASE["STACK"] + offset, value)
        native.run(0x41AF14, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 5,
                              UC_X86_REG_EBX: 5, UC_X86_REG_ECX: unit_type})
        harvesters.append(dict(direction=native.get(game + 0x7D28 + slot * 220 + 9, 1),
                               constructor=CONSTRUCTION["snapshot"](native, slot)))
    return dict(name=name, sha256=hashlib.sha256(data).hexdigest(), records=records,
                fresh=fresh, scnExternalBoundaries=[hex(address) for address in external], harvesters=harvesters,
                directionSearch=struct.unpack("<32i", native.emulator.mem_read(0x47950C, 128)),
                profiles=profiles, animations=[dict(id=bank, directions=directions) for bank, directions in animations.items()])


if __name__ == "__main__":
    print(json.dumps(dict(executableSha256=hashlib.sha256(IMAGE).hexdigest(), configuration=configuration_probe(),
                         missions=[mission_probe(name) for name in ("HUMAN02", "ALIEN02")])))