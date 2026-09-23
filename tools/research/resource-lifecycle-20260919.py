"""Source FIN-backed resource lifecycle; no runtime task/animation interceptions."""

import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
CONSTRUCTION = runpy.run_path(str(Path(__file__).with_name("construction-lifecycle-20260919.py")))
BASE = CONSTRUCTION["BASE"]
ROOT = CONSTRUCTION["ROOT"]
GAME = BASE["GAME"]
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EBP, UC_X86_REG_ESP,
)


def vent_removal(image):
    native = CONSTRUCTION["source_fixture"](image)
    profiles = CONSTRUCTION["load_fin"](native, (40,))
    entity = GAME + 0x7D28 + 152 * 220
    native.put(entity + 6, 40, 1)
    native.put(entity + 7, 8, 1)
    native.put(entity + 0x2C, 1, 1)
    native.put(entity + 0x38, 255, 1)
    native.put(GAME + 0x468EC + 152 * 2, 152, 2)
    native.run(0x42630C, {UC_X86_REG_EAX: entity + 0x14,
                          UC_X86_REG_EDX: profiles["bindings"][0]["standBank"], UC_X86_REG_EBX: 2})
    start = len(native.calls)
    native.run(0x416308, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 152})
    trace = []
    for visit in range(512):
        native.run(0x4264C8, {UC_X86_REG_EAX: entity + 0x14, UC_X86_REG_EDX: 0})
        native.run(0x416460, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 152,
                              UC_X86_REG_EBX: entity + 0x46})
        trace.append({"visit": visit, **CONSTRUCTION["snapshot"](native, 152)})
        if native.get(entity + 0x2C, 1) == 0:
            break
    assert trace[-1]["activeSlot"] == 65535 and trace[-1]["status"] == 0
    assert native.calls[start:] == []
    return {"profiles": profiles, "trace": trace, "runtimeInterceptions": native.calls[start:]}


def main():
    image = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
    assert hashlib.sha256(image).hexdigest() == BASE["EXE_HASH"]
    sources = ["GAMESTAT/GAMESTAT.TXT", "ANIM.DAT"]
    sources += [f"SCENARIO/{race}/{race}02.{extension}" for race in ("HUMAN", "ALIEN") for extension in ("SCN", "TRO")]
    result = {
        "sha256": BASE["EXE_HASH"],
        "sourceHashes": {name: hashlib.sha256((ROOT / "raw_cd/DC" / name).read_bytes()).hexdigest() for name in sources},
        "counterContract": "Original 0x41989e..0x4198c3 increment block; no day/night rollover in bounded fixture",
        "removal": vent_removal(image),
        "cases": [lifecycle(image, race) for race in (0, 1)],
        "cancellations": [lifecycle(image, race, cancel=True) for race in (0, 1)],
        "lowHealth": [lifecycle(image, race, health=270) for race in (0, 1)],
        "boundaries": [
            lifecycle(image, 0, runtime={"credits": 2147483647, "income": 2147483647, "phaseStart": 0xFFFFFFFF}),
            lifecycle(image, 1, runtime={"reserve": 23, "aiField": 1, "aiMultiplier": 512, "creditGate": 0, "phaseStart": 0xFFFFFFFF}),
            lifecycle(image, 0, health=270, runtime={"localTeam": 1, "creditGate": 0}),
        ],
    }
    print(json.dumps(result, indent=2))


def lifecycle(image, race, cancel=False, health=-1, runtime=None):
    runtime = {"credits": 1000, "income": 0, "reserve": 100, "aiField": 0,
               "aiMultiplier": 256, "creditGate": 1, "phaseStart": 0, "localTeam": 0, **(runtime or {})}
    native = CONSTRUCTION["source_fixture"](image)
    mobile, deployed = (6, 47) if race == 0 else (14, 48)
    profiles = CONSTRUCTION["load_fin"](native, (40, mobile, deployed))
    for binding in profiles["bindings"]:
        unit_type = binding["unitType"]
        native.emulator.mem_write(0x70D800 - 0x178, binding["stem"].encode("ascii") + b"\0")
        native.put(0x70D800 - 4, 0x4F1880 + unit_type * 280)
        native.run(0x43C099, {UC_X86_REG_EBP: 0x70D800}, 0x43C18C)
        bank = native.get(0x4F1880 + unit_type * 280 + 0x94)
        descriptor = native.get(bank)
        first = native.get(descriptor + 0x20)
        delays = [native.get(first + index * 72 + 2, 1) for index in range(native.get(descriptor + 0x28))]
        binding["deployBank"] = bank
        binding["deployDelays"] = delays
        binding["removalHoldField"] = native.get(0x4F1880 + unit_type * 280 + 0x100)
        binding["deathBank"] = native.get(0x4F1880 + unit_type * 280 + 0xAC)
        binding["selectedWeapon"] = native.get(0x4F1880 + unit_type * 280 + 0x18)
    animations = []
    for bank in sorted({binding[field] for binding in profiles["bindings"]
                        for field in ("standBank", "deployBank", "deathBank")}):
        directions = []
        for direction in range(32):
            descriptor = native.get(bank + direction * 4)
            first = native.get(descriptor + 0x20)
            directions.append([native.get(first + index * 72 + 2, 1)
                               for index in range(native.get(descriptor + 0x28))])
        animations.append({"id": str(bank), "directions": directions})
    native.emulator.mem_map(0xC00000, 0x200000)
    native.put(GAME + 0x46F2C, 0xC00000)
    native.put(GAME + 0x544, 0xD00000)
    native.put(0xC9A4B0, 128)
    native.put(0xC9A4B4, 128)
    for row in range(128):
        for offset, base, stride in ((4, 0xC10000, 512), (0x804, 0xC20000, 512),
                                     (0xC04, 0xC30000, 256), (0x1004, 0xC40000, 256)):
            native.put(0xC00000 + offset + row * 4, base + row * stride)
    native.emulator.mem_write(0xC20000, struct.pack("<I", 1023) * 128 * 128)
    native.emulator.mem_write(0xC30000, struct.pack("<H", 1023) * 128 * 128)
    native.emulator.mem_write(0xC40000, struct.pack("<H", 1023) * 128 * 128)
    native.emulator.mem_write(GAME + 0x468EC, b"\xff\xff" * 800)
    native.put(GAME + 0x7D20, 154)
    native.put(GAME + 0x7D1C, runtime["localTeam"])
    native.put(GAME + 0xBB8, race)
    native.put(GAME + 0xBD4, runtime["creditGate"])
    native.put(GAME + 0xBAC, runtime["credits"])
    native.put(GAME + 0xBBC, runtime["aiField"])
    native.put(GAME + 0x19B8, runtime["aiMultiplier"])
    native.put(GAME + 0x530, runtime["phaseStart"])
    native.put(0x4956E0 + 4, runtime["income"])
    for slot, unit_type, owner, initial_health in ((152, 40, 8, runtime["reserve"]), (153, mobile, 0, health)):
        for offset, value in ((4, owner), (8, initial_health), (12, 0), (16, slot)):
            native.put(BASE["STACK"] + offset, value)
        native.run(0x41AF14, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 5,
                              UC_X86_REG_EBX: 5, UC_X86_REG_ECX: unit_type})
    source = GAME + 0x7D28 + 152 * 220
    native.put(source + 0x32, 22, 2)
    flag = 0xC10000 + 5 * 512 + 5 * 4
    native.put(flag, 0x04000000)
    start = len(native.calls)
    trace, sounds, entries = [], [], {}
    update = 0

    def observe(emulator, address, size, data):
        if address == 0x4264C8:
            target = emulator.reg_read(UC_X86_REG_EAX)
            assert native.get(target), f"null animation at {target:#x}, update {update}"
        if address in (0x413490, 0x413780, 0x416460, 0x4264C8, 0x412014, 0x434D48):
            key = hex(address)
            entries[key] = entries.get(key, 0) + 1
        if address == 0x431DA8:
            stack = emulator.reg_read(UC_X86_REG_ESP)
            sounds.append({"update": update, "edx": emulator.reg_read(UC_X86_REG_EDX),
                           "ebx": emulator.reg_read(UC_X86_REG_EBX), "ecx": emulator.reg_read(UC_X86_REG_ECX),
                           "stack": [native.get(stack + 4), native.get(stack + 8)]})

    native.emulator.hook_add(UC_HOOK_CODE, observe)

    def record():
        trace.append({"update": update, "counter": native.get(GAME + 0x530),
                      "source": {**CONSTRUCTION["snapshot"](native, 152), "direction": native.get(source + 9, 1)},
                      "extractor": {**CONSTRUCTION["snapshot"](native, 153), "direction": native.get(source + 220 + 9, 1)},
                      "tileFlag": native.get(flag), "ground": native.get(0xC20000 + 5 * 512 + 20),
                      "credits": native.get(GAME + 0xBAC),
                      "income": native.get(0x4956E0 + 4), "cycles": native.get(0x4956E0 + 20)})

    record()
    for update in range(1, 513):
        if cancel and update == 20:
            native.emulator.mem_write(0x701100, struct.pack("<hB", 153, 13))
            native.put(0x701000, 0x701100)
            native.run(0x41CE54, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
        native.put(0x70D800 - 4, GAME)
        native.run(0x41989E, {UC_X86_REG_EBP: 0x70D800}, 0x4198C3)
        assert native.get(GAME + 0x530) == (runtime["phaseStart"] + update) & 0xFFFFFFFF
        native.put(0x4956E0 + 20, 0)
        native.put(0x70D800 - 4, GAME)
        native.run(0x419BB8, {UC_X86_REG_EBP: 0x70D800}, 0x419C0E)
        record()
        if cancel and update >= 20 and trace[-1]["extractor"]["type"] == mobile:
            break
        if trace[-1]["source"]["status"] == 0 and (trace[-1]["extractor"]["type"] == mobile
                                                    or trace[-1]["extractor"]["status"] == 0):
            break
    assert trace[-1]["source"]["status"] == (1 if cancel else 0), trace[-1]
    assert trace[-1]["extractor"]["type"] == mobile or trace[-1]["extractor"]["status"] == 0, trace[-1]
    assert native.calls[start:] == [], native.calls[start:]
    return {"race": race, "cancel": cancel, "initialHealth": health, "runtime": runtime,
            "profiles": profiles, "animations": animations, "trace": trace, "sounds": sounds,
            "entries": entries, "runtimeInterceptions": native.calls[start:]}


if __name__ == "__main__":
    main()