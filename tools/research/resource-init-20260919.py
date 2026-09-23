"""Hash-pinned type40 resource research; requires Capstone 5 and Unicorn 2."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE, UcError
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
    UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
    UC_X86_REG_GDTR, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS,
)

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "resource_action_audit", Path(__file__).with_name("mission02-audit-20260919.py")
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
NATIVE = AUDIT.NATIVE
STOP = 0x70D000
TASK = 0x709000
SOURCE_SLOT = 152
SOURCE_ENTITY = NATIVE.GAME + 0x7D28 + 220 * SOURCE_SLOT
EXTRACTOR = NATIVE.GAME + 0x7D28 + 220 * 153


def fixture():
    machine = NATIVE.machine_for_probe()
    machine.mem_write(0x707000, bytes(8) + bytes.fromhex("ffff0000009acf00ffff00000092cf00"))
    machine.reg_write(UC_X86_REG_GDTR, (0, 0x707000, 23, 0))
    machine.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
        machine.reg_write(register, 16)
    return machine


def put(machine, address, value, fmt="I"):
    machine.mem_write(address, struct.pack("<" + fmt, value))


def get(machine, address, fmt="I"):
    return struct.unpack("<" + fmt, machine.mem_read(address, struct.calcsize(fmt)))[0]


def execute(machine, start, stop, count=200000):
    trail = []

    def observe(emulator, address, size, data):
        trail.append(address)
        if len(trail) > 16:
            trail.pop(0)

    hook = machine.hook_add(UC_HOOK_CODE, observe)
    try:
        machine.emu_start(start, stop, count=count)
    except UcError as error:
        raise RuntimeError(f"native fault EIP={machine.reg_read(UC_X86_REG_EIP):#x}; "
                           f"trail={[hex(address) for address in trail]}") from error
    finally:
        machine.hook_del(hook)
    assert machine.reg_read(UC_X86_REG_EIP) == stop, [hex(address) for address in trail]


def invoke(machine, start, slot, task=TASK, stop=STOP):
    put(machine, NATIVE.STACK, STOP)
    for register, value in ((UC_X86_REG_EAX, NATIVE.GAME), (UC_X86_REG_EDX, slot),
                            (UC_X86_REG_EBX, task), (UC_X86_REG_ESP, NATIVE.STACK)):
        machine.reg_write(register, value)
    execute(machine, start, stop)


def initialization_probe():
    machine = fixture()
    execute(machine, 0x4012B4, 0x4012E6)
    assert get(machine, 0x494690) == get(machine, 0x494694) == 4
    put(machine, NATIVE.FRAME + 0x7A, 0x708000)
    execute(machine, 0x4014C6, 0x4014ED)
    assert get(machine, 0x494690) == get(machine, 0x494694) == 256
    execute(machine, 0x40183B, 0x40185F)
    assert get(machine, AUDIT.SCALE) == get(machine, AUDIT.STATISTICS + 96) == 256
    put(machine, 0x494690, 65536)
    execute(machine, 0x40183B, 0x40184D)
    assert get(machine, AUDIT.SCALE) == 65536
    return {"configuration": 4, "shift": 6, "rateScale": 256, "reserveScale": 256,
            "fullwidthCopy": 65536}


def placement_probe(row="69 48 40 22 12000", scale=256, reserve_scale=256, type_reserve=300):
    machine = fixture()
    machine.mem_map(0x900000, 0x100000)
    put(machine, NATIVE.GAME + 0x46F2C, 0x900000)
    put(machine, 0x99A4B0, 128)
    put(machine, 0x99A4B4, 128)
    for tile_y in range(128):
        put(machine, 0x900004 + tile_y * 4, 0x9A0000 + tile_y * 512)
    put(machine, AUDIT.SCALE, scale, "i")
    put(machine, AUDIT.STATISTICS + 96, reserve_scale, "i")
    put(machine, 0x4F1880 + 40 * 280 + 0x44, type_reserve, "i")
    put(machine, 0x4F1880 + 40 * 280 + 4, -1, "i")
    put(machine, 0x4F1880 + 40 * 280 + 0x114, -1, "i")
    machine.mem_write(NATIVE.FRAME - 0x47C, row.encode("ascii") + b"\0")
    machine.reg_write(UC_X86_REG_ESI, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EDI, SOURCE_SLOT)
    execute(machine, 0x41C453, 0x41C69D)
    tile_x, tile_y = map(int, row.split()[:2])
    assert get(machine, SOURCE_ENTITY, "H") == tile_x * 256 + 128
    assert get(machine, SOURCE_ENTITY + 4, "H") == tile_y * 256 + 128
    assert get(machine, SOURCE_ENTITY + 6, "B") == 40
    assert get(machine, SOURCE_ENTITY + 0x39, "B") == 1
    assert get(machine, SOURCE_ENTITY + 0x46, "H") == 65535
    return {"row": row, "owner": get(machine, SOURCE_ENTITY + 7, "B"),
            "status": get(machine, SOURCE_ENTITY + 0x2C, "B"),
            "reserve": get(machine, SOURCE_ENTITY + 0xC, "i"),
            "rateWord": get(machine, SOURCE_ENTITY + 0x32, "H"),
            "idleCountdownWord": get(machine, SOURCE_ENTITY + 0x46, "H"),
            "tileFlag": get(machine, 0x9A0000 + tile_y * 512 + tile_x * 4)}


def countdown_probe(timer, occupant_type, animation=0, rate=22):
    machine = fixture()
    machine.mem_map(0x900000, 0x100000)
    put(machine, NATIVE.GAME + 0x46F2C, 0x900000)
    put(machine, 0x99A4B0, 128)
    put(machine, 0x99A4B4, 128)
    put(machine, 0x900804, 0x9A0000)
    put(machine, 0x9A0000, 153 if occupant_type is not None else 1023)
    machine.mem_write(SOURCE_ENTITY + 6, bytes((40, 8)))
    put(machine, SOURCE_ENTITY + 0x32, rate, "H")
    put(machine, SOURCE_ENTITY + 0x1A, animation, "B")
    machine.mem_write(EXTRACTOR + 6, bytes((occupant_type or 0, 0)))
    put(machine, EXTRACTOR + 0x2C, 1, "B")
    put(machine, EXTRACTOR + 0x38, 255, "B")
    put(machine, NATIVE.GAME + 0x7D1C, 7)
    put(machine, TASK, timer, "H")
    invoke(machine, 0x413490, SOURCE_SLOT)
    return {"timer": get(machine, TASK, "H"),
            "activated": machine.reg_read(UC_X86_REG_EAX),
            "occupantType": get(machine, EXTRACTOR + 6, "B"),
            "taskBytes": list(machine.mem_read(EXTRACTOR + 0x36, 12))}


def extraction_probe(counter=16, reserve=100, rate=22, ai=0, multiplier=256,
                     credit_gate=1, depletion=False, partner=None, partner_gate=1):
    machine = fixture()
    put(machine, SOURCE_ENTITY + 0xC, reserve, "i")
    put(machine, SOURCE_ENTITY + 0x32, rate & 65535, "H")
    machine.mem_write(EXTRACTOR + 6, bytes((47, 0)))
    put(machine, NATIVE.GAME + 0x530, counter)
    put(machine, NATIVE.GAME + 0xBBC, ai)
    put(machine, NATIVE.GAME + 0x19B8, multiplier, "i")
    put(machine, NATIVE.GAME + 0xBD4, credit_gate)
    put(machine, NATIVE.GAME + 0xBAC, 1000)
    put(machine, TASK, SOURCE_SLOT, "H")
    if partner is not None:
        put(machine, TASK + 4, 154, "H")
        partner_entity = NATIVE.GAME + 0x7D28 + 220 * 154
        machine.mem_write(partner_entity + 6, bytes((partner, 1)))
        put(machine, partner_entity + 0x2C, 1, "B")
        put(machine, NATIVE.GAME + 0xE30 + 0xBD4, partner_gate)
    invoke(machine, 0x413780, 153, stop=0x41383F if depletion else STOP)
    return {"counter": counter, "reserve": get(machine, SOURCE_ENTITY + 0xC, "i"),
            "credits": get(machine, NATIVE.GAME + 0xBAC, "i"),
            "incomeStatistic": get(machine, AUDIT.STATISTICS + 4, "i"),
            "cyclesStatistic": get(machine, AUDIT.STATISTICS + 20, "i"),
            "partnerCredits": get(machine, NATIVE.GAME + 0xE30 + 0xBAC, "i"),
            "partnerIncome": get(machine, AUDIT.STATISTICS + 48 + 4, "i"),
            "partnerSlot": get(machine, TASK + 4, "H"),
            "boundary": hex(machine.reg_read(UC_X86_REG_EIP))}


def depletion_probe():
    machine = fixture()
    machine.mem_map(0x900000, 0x100000)
    put(machine, NATIVE.GAME + 0x46F2C, 0x900000)
    put(machine, 0x900004, 0x9A0000)
    put(machine, 0x9A0000, 0x4000000)
    machine.mem_write(SOURCE_ENTITY + 6, bytes((40, 8)))
    put(machine, SOURCE_ENTITY + 0x2C, 1, "B")
    put(machine, SOURCE_ENTITY + 0xC, 22)
    put(machine, SOURCE_ENTITY + 0x32, 22, "H")
    machine.mem_write(EXTRACTOR + 6, bytes((47, 0)))
    put(machine, EXTRACTOR + 0x2C, 1, "B")
    put(machine, EXTRACTOR + 0xC, 300)
    put(machine, NATIVE.GAME + 0x7D1C, 7)
    put(machine, NATIVE.GAME + 0xBAC, 1000)
    put(machine, NATIVE.GAME + 0x530, 15)
    put(machine, TASK, SOURCE_SLOT, "H")
    invoke(machine, 0x413780, 153)
    result = {"sourceStatus": get(machine, SOURCE_ENTITY + 0x2C, "B"),
              "sourceTask": get(machine, SOURCE_ENTITY + 0x39, "B"),
              "reserve": get(machine, SOURCE_ENTITY + 0xC),
              "tileFlag": get(machine, 0x9A0000),
              "extractorHP": get(machine, EXTRACTOR + 0xC),
              "extractorTask": get(machine, EXTRACTOR + 0x3B, "B"),
              "extractorCountdown": get(machine, EXTRACTOR + 0x4C, "H"),
              "credits": get(machine, NATIVE.GAME + 0xBAC)}
    assert result == {"sourceStatus": 10, "sourceTask": 10, "reserve": 22,
                      "tileFlag": 0, "extractorHP": 30, "extractorTask": 13,
                      "extractorCountdown": 50, "credits": 1000}, result
    invoke(machine, 0x416460, SOURCE_SLOT, task=SOURCE_ENTITY + 0x46, stop=0x4164D8)
    assert machine.reg_read(UC_X86_REG_EBX) == 0
    result["nextRemovalBoundary"] = {
        "instruction": "0x4164d8 idiv ebx", "divisor": 0,
        "requiredInput": "Loaded VENT type+0xe8 death-variant count and corresponding animation pointers",
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--find", help="Find decoded native instructions containing text")
    arguments = parser.parse_args()
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    if arguments.disassemble:
        start, end = arguments.disassemble
        decoder.skipdata = True
        for instruction in decoder.disasm(NATIVE.READ(0x401000, end - 0x401000), 0x401000):
            if instruction.address >= start:
                print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
        return
    if arguments.find:
        decoder.skipdata = True
        for name, address, length, raw in NATIVE.SECTIONS:
            if address != 0x401000:
                continue
            for instruction in decoder.disasm(NATIVE.IMAGE[raw:raw + length], address):
                text = f"{instruction.mnemonic} {instruction.op_str}"
                if arguments.find in text:
                    print(f"{instruction.address:#x}: {text}")
        return
    result = AUDIT.golden_case("fullwidth-scale", "1 11 68", 65536, 256)
    initialization = initialization_probe()
    depletion = depletion_probe()
    placement = placement_probe()
    assert placement["owner"] == 8 and placement["status"] == 1, placement
    assert placement["reserve"] == 12000 and placement["rateWord"] == 22, placement
    extraction = extraction_probe()
    assert extraction["reserve"] == 78 and extraction["credits"] == 1022, extraction
    assert extraction["incomeStatistic"] == 22 and extraction["cyclesStatistic"] == 1, extraction
    sources = []
    placements = []
    for faction in ("HUMAN", "ALIEN"):
        stem = AUDIT.ROOT / "raw_cd/DC/SCENARIO" / faction / f"{faction}02"
        for extension in ("SCN", "TRO"):
            path = stem.with_suffix("." + extension)
            sources.append({"path": str(path.relative_to(AUDIT.ROOT)),
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        for line in stem.with_suffix(".SCN").read_text().splitlines():
            fields = line.split()
            if len(fields) == 5 and fields[2] == "40":
                observed = placement_probe(" ".join(fields))
                assert observed["owner"] == 8 and observed["status"] == 1, observed
                assert observed["rateWord"] == int(fields[3]), observed
                assert observed["reserve"] == int(fields[4]), observed
                assert observed["tileFlag"] == 0x4000000, observed
                placements.append(observed)
    scaled = placement_probe("69 48 40 15 12001", 128, 128)
    assert scaled["rateWord"] == 7 and scaled["reserve"] == 6000, scaled
    fullwidth = placement_probe("69 48 40 1 12000", 65536)
    assert fullwidth["rateWord"] == 256, fullwidth
    fallback = placement_probe("69 48 40 22 -1", type_reserve=789)
    assert fallback["reserve"] == 789, fallback
    countdowns = []
    for timer, occupant, animation, rate, expected_timer, expected_active in (
        (50, None, 0, 22, 50, 0), (1, 5, 0, 22, 50, 0),
        (50, 6, 0, 22, 49, 0), (0, 6, 0, 22, 0, 0),
        (1, 6, 0, 22, 0, 1), (65535, 14, 0, 22, 65534, 1),
        (1, 6, 2, 22, 50, 0), (1, 6, 0, 0, 1, 0),
    ):
        observed = countdown_probe(timer, occupant, animation, rate)
        assert (observed["timer"], observed["activated"]) == (expected_timer, expected_active), observed
        if expected_active:
            assert observed["occupantType"] == (47 if occupant == 6 else 48), observed
        countdowns.append(observed)
    settlements = []
    for inputs, expected in (
        ({"counter": 15}, (100, 1000, 0, 0)),
        ({"counter": 0}, (78, 1022, 22, 1)),
        ({"ai": 1, "multiplier": 384}, (67, 1033, 33, 1)),
        ({"credit_gate": 0}, (78, 1000, 0, 0)),
        ({"reserve": 22, "depletion": True}, (22, 1000, 0, 0)),
        ({"reserve": 21, "counter": 15, "depletion": True}, (21, 1000, 0, 0)),
        ({"reserve": 23}, (1, 1022, 22, 1)),
        ({"reserve": 23, "ai": 1, "multiplier": 512}, (-21, 1044, 44, 1)),
        ({"rate": -7}, (107, 993, -7, 1)),
        ({"rate": 0}, (100, 1000, 0, 1)),
        ({"partner": 77, "rate": 25}, (75, 1012, 12, 1)),
        ({"partner": 78, "rate": 25, "partner_gate": 0}, (75, 1012, 12, 1)),
        ({"partner": 4}, (78, 1022, 22, 1)),
    ):
        observed = extraction_probe(**inputs)
        actual = tuple(observed[key] for key in ("reserve", "credits", "incomeStatistic", "cyclesStatistic"))
        assert actual == expected, (inputs, observed, expected)
        if inputs.get("partner") == 77:
            assert observed["partnerCredits"] == observed["partnerIncome"] == 12, observed
        if inputs.get("partner") == 4:
            assert observed["partnerSlot"] == 0, observed
        settlements.append({"inputs": inputs, "observed": observed})
    print(json.dumps({"sha256": NATIVE.AUDIT.DIGEST, "newrate": result,
                      "initialization": initialization, "sources": sources,
                      "placements": placements, "scaledPlacement": scaled,
                      "fullwidthPlacement": fullwidth, "countdowns": countdowns,
                      "settlements": settlements, "depletion": depletion, "result": "PASS"}, indent=2))


if __name__ == "__main__":
    main()