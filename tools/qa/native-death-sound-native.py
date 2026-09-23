"""Dedicated original visible death sound selection probe."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("death_sound_base", Path(__file__).with_name("native-death-native.py"))
DEATH = importlib.util.module_from_spec(spec)
spec.loader.exec_module(DEATH)
AI, GAME = DEATH.AI, DEATH.GAME
ACTOR = DEATH.PROJECTILE.FIRE.ACTOR
ROOT = Path(__file__).resolve().parents[2]
DESCRIPTOR = 0x4CBC54 + 3 * 13
DEVICE = 0x708600
THREAD = 0x708400
PLATFORM = {DEVICE: ("GetStatus", 2), DEVICE + 16: ("SetVolume", 2),
            DEVICE + 32: ("SetPan", 2), DEVICE + 48: ("Play", 4)}


def capture():
    machines = []
    configure = DEATH.PROJECTILE.FIRE.configure_fire

    def retain(machine, kinds):
        configure(machine, kinds)
        machines.append(machine)

    DEATH.PROJECTILE.FIRE.configure_fire = retain
    try:
        initial = DEATH.PROJECTILE.capture(0, policy=0)
    finally:
        DEATH.PROJECTILE.FIRE.configure_fire = configure
    machine = machines[0]
    fire = initial["fire"]
    target, source = fire["nearbyEnemy"]["enemySlot"], fire["slot"]
    width, height = fire["world"]["width"], fire["world"]["height"]
    for counter in range(2, 529):
        AI.put(machine, GAME + 0x530, counter)
        AI.put(machine, 0x478E00, 0)
        AI.invoke(machine, 0x419248, eax=GAME, edx=target)
        AI.invoke(machine, 0x419248, eax=GAME, edx=source)
        if counter != 528:
            AI.invoke(machine, 0x44293C, eax=GAME)
    assert AI.dword(machine, GAME + 0x7D28 + target * 220 + 12) == 25
    world = DEATH.DAMAGED.actor_world(machine, fire, target)
    for bank_offset in (0xAC, 0xB0, 0xB4):
        bank = AI.dword(machine, 0x4F1880 + bank_offset)
        world["fin"][str(bank)] = []
        for direction in range(32):
            descriptor = AI.dword(machine, bank + direction * 4)
            timeline, count = AI.dword(machine, descriptor + 0x20), AI.dword(machine, descriptor + 0x28)
            world["fin"][str(bank)].append([machine.mem_read(timeline + index * 72 + 2, 1)[0] for index in range(count)])
    slist = (ROOT / "raw_cd/DC/SOUND/SLIST.DAT").read_bytes()
    sound_rows = []
    for line in (ROOT / "raw_cd/DC/SOUND/SOUND2.DAT").read_text().splitlines():
        if not line.split() or line.split()[0] not in ("28", "90", "153", "154"):
            continue
        machine.mem_write(0x70D800 - 0x2B2, line.encode() + b"\0")
        machine.reg_write(AI.UC_X86_REG_EBP, 0x70D800)
        machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
        machine.emu_start(0x430830, 0x430905, count=100000)
        assert machine.reg_read(ACTOR.UC_X86_REG_EIP) == 0x430905
        sound_id = int(line.split()[0])
        sound_rows.append({"id": sound_id, "raw116": list(machine.mem_read(0x4C61B0 + sound_id * 116, 116))})
    row = next(line for line in slist.decode().splitlines() if line.split()[:2] == ["0", "DEA"])
    machine.mem_write(0x708800, (" " + " ".join(row.split()[1:])).encode() + b"\0")
    AI.put(machine, 0x70D800 - 0x24, 0x708800)
    AI.put(machine, 0x70D800 - 4, 0)
    machine.reg_write(AI.UC_X86_REG_EBP, 0x70D800)
    machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
    machine.emu_start(0x431237, 0x4314EE, count=100000)
    assert machine.reg_read(ACTOR.UC_X86_REG_EIP) == 0x4314EE
    startup = list(machine.mem_read(DESCRIPTOR, 13))
    assert startup[:7] == [4, 0, 0, 28, 90, 153, 154], startup
    machine.mem_write(0x47963D, b"\x01")
    machine.mem_write(0x47963C, b"\x00")
    category_count = AI.dword(machine, 0x4F98D4)
    assert category_count > 0, category_count
    AI.put(machine, 0x4D1994, 0x708000)
    AI.put(machine, 0x708008, 0x708200)
    AI.put(machine, 0x708280, 0x430F50)
    AI.put(machine, 0x47960C, 0)
    AI.put(machine, 0x708700, 0x708720)
    for method_offset, address in ((0x24, DEVICE), (0x3C, DEVICE + 16), (0x40, DEVICE + 32), (0x30, DEVICE + 48)):
        AI.put(machine, 0x708720 + method_offset, address)
    for sound_id in (28, 90, 153, 154):
        AI.put(machine, 0x4C61B0 + sound_id * 116 + 76, 0x708700)
    AI.put(machine, 0x516A94, THREAD)
    AI.invoke(machine, 0x44E251, eax=1)
    victim = bytes(machine.mem_read(GAME + 0x7D28 + target * 220, 220))
    horizontal, vertical = struct.unpack_from("<H", victim)[0], struct.unpack_from("<H", victim, 4)[0]
    AI.put(machine, 0x708108, horizontal - 256)
    AI.put(machine, 0x708110, vertical)
    cell = (vertical >> 8) * width + (horizontal >> 8)
    original_cell = AI.dword(machine, AI.GROUND + cell * 4)
    AI.put(machine, AI.GROUND + cell * 4, original_cell | 0x80000000)
    entries, calls, rng_writes, platform_calls = [], [], [], []

    def snapshot():
        return {"actors": base64.b64encode(machine.mem_read(GAME + 0x7D28, 800 * 220)).decode(),
                "game": base64.b64encode(machine.mem_read(GAME, 0x471B0)).decode(),
                "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 384))),
                "typeStatistics": base64.b64encode(machine.mem_read(0x495860, 4400 * 4)).decode(),
                "ground": base64.b64encode(machine.mem_read(AI.GROUND, width * height * 4)).decode(),
                "air": base64.b64encode(machine.mem_read(0xB40000, width * height * 2)).decode(),
                "extra": base64.b64encode(machine.mem_read(0xB60000, width * height * 2)).decode(),
                "rngCursor": AI.dword(machine, 0x479204),
                "soundDescriptor": list(machine.mem_read(DESCRIPTOR, 13)),
                "soundSeed": AI.dword(machine, THREAD + 12)}

    def observe(emulator, address, size, context):
        entries.append(hex(address))
        if address == 0x431D79:
            calls.append({"id": emulator.reg_read(AI.UC_X86_REG_EAX),
                          "volume": emulator.reg_read(AI.UC_X86_REG_EDX),
                          "pan": emulator.reg_read(AI.UC_X86_REG_EBX),
                          "descriptor": emulator.reg_read(AI.UC_X86_REG_ECX)})
        if address in PLATFORM:
            name, argument_count = PLATFORM[address]
            stack = emulator.reg_read(AI.UC_X86_REG_ESP)
            arguments = [AI.dword(emulator, stack + 4 + index * 4) for index in range(argument_count)]
            platform_calls.append({"method": name, "arguments": arguments})
            if name == "GetStatus":
                AI.put(emulator, arguments[1], 0)
            destination = AI.dword(emulator, stack)
            emulator.reg_write(AI.UC_X86_REG_EAX, 0)
            emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4 + argument_count * 4)
            emulator.reg_write(ACTOR.UC_X86_REG_EIP, destination)

    def write(emulator, access, address, size, value, context):
        if address in (0x479204, THREAD + 12, DESCRIPTOR + 1):
            rng_writes.append({"address": hex(address), "value": value})

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
             for address in (0x441930, 0x416308, 0x434D48, 0x431DA8, 0x431BF4, 0x431D79, 0x430F50,
                             0x44E22D, 0x45A7A6, *PLATFORM)]
    hooks.append(machine.hook_add(ACTOR.UC_HOOK_MEM_WRITE, write))
    before = snapshot()
    AI.invoke(machine, 0x44293C, eax=GAME)
    after = snapshot()
    assert len(calls) == 1 and calls[0]["id"] == 28, calls
    assert after["soundSeed"] == 1103527590 and after["soundDescriptor"][1] == 2
    assert before["rngCursor"] == after["rngCursor"]
    primary_entries, primary_calls, primary_writes = list(entries), list(calls), list(rng_writes)
    primary_platform = list(platform_calls)
    cases = []
    variants = [(f"source-selection-{warmup}", warmup, 1, 1024, 512, False, True) for warmup in range(8)]
    variants += [("right-pan", 2, 0xffffffff, -1024, 512, False, True),
                 ("muted", 2, 0, 1024, 0, True, True),
                 ("outside-distance", 2, 1, 32768, 0, False, True),
                 ("distance-edge-admitted", 2, 1, 32381, 0, False, True),
                 ("distance-edge-rejected", 2, 1, 32384, 0, False, True),
                 ("invisible", 2, 1, 1024, 0, False, False),
                 ("signed-distance-overflow", 2, 1, 65535, 65535, False, True)]
    for label, warmup, seed, delta_x, delta_y, disabled, visible in variants:
        for field, address in (("game", GAME), ("typeStatistics", 0x495860), ("ground", AI.GROUND),
                               ("air", 0xB40000), ("extra", 0xB60000)):
            machine.mem_write(address, base64.b64decode(before[field]))
        machine.mem_write(0x4956E0, struct.pack("<96i", *before["statistics"]))
        AI.put(machine, 0x479204, before["rngCursor"])
        machine.mem_write(DESCRIPTOR, bytes(startup))
        machine.mem_write(0x47963C, b"\0")
        AI.put(machine, 0x708108, horizontal)
        AI.put(machine, 0x708110, vertical)
        AI.invoke(machine, 0x44E251, eax=seed)
        for _ in range(warmup):
            AI.put(machine, AI.NATIVE.STACK + 4, vertical)
            AI.invoke(machine, 0x431BF4, eax=0, edx=3, ebx=1, ecx=horizontal)
        listener = {"x": horizontal - delta_x, "y": vertical - delta_y}
        AI.put(machine, 0x708108, listener["x"] & 0xffffffff)
        AI.put(machine, 0x708110, listener["y"] & 0xffffffff)
        machine.mem_write(0x47963C, bytes((int(disabled),)))
        AI.put(machine, AI.GROUND + cell * 4, original_cell | (0x80000000 if visible else 0))
        entries.clear(); calls.clear(); rng_writes.clear(); platform_calls.clear()
        case_before = snapshot()
        AI.invoke(machine, 0x44293C, eax=GAME)
        case_after = snapshot()
        case_entries, case_calls, case_writes = list(entries), list(calls), list(rng_writes)
        case_platform = list(platform_calls)
        entries.clear(); calls.clear(); rng_writes.clear(); platform_calls.clear()
        AI.put(machine, GAME + 0x530, 529)
        AI.invoke(machine, 0x419248, eax=GAME, edx=target)
        cases.append({"label": label, "warmup": warmup, "seed": seed, "listener": listener, "disabled": disabled,
                      "before": case_before, "after": case_after, "entries": case_entries, "calls": case_calls,
                      "rngWrites": case_writes, "firstVisit": snapshot(), "visitRngWrites": list(rng_writes),
                      "visitCalls": list(calls), "platformCalls": case_platform})
    for hook in hooks:
        machine.hook_del(hook)
    return {"binarySha256": fire["binarySha256"], "initial": initial, "world": world,
            "target": target, "source": source, "counter": 528, "before": before, "after": after,
            "sourceHashes": {name: hashlib.sha256((ROOT / "raw_cd/DC/SOUND" / name).read_bytes()).hexdigest()
                             for name in ("SOUND2.DAT", "SLIST.DAT")},
            "startupDescriptor": startup, "sourceSoundRows": sound_rows, "categoryCount": category_count,
            "entries": primary_entries, "calls": primary_calls, "rngWrites": primary_writes, "cases": cases,
            "platformCalls": primary_platform,
            "visibility": {"label": "controlled bit31 input fixture; NOT normal mission visibility",
                           "cell": cell, "before": original_cell, "after": original_cell | 0x80000000},
            "listener": {"x": horizontal - 256, "y": vertical},
            "runtimeIntercepts": [{"address": hex(address), "boundary": f"DirectSoundBuffer::{name} platform only"}
                                  for address, (name, _) in PLATFORM.items()],
            "initialization": ["original SLIST row decoder 0x431237..0x4314ee", "original SOUND2 scanner 0x430830..0x430905",
                               "explicit audio initialized/enabled state",
                               "fixture listener and audio vtable", "original srand(1) and real CRT thread accessor"],
            "healthRewrites": []}


def disassemble():
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32
    for start, end in ((0x441930, 0x441BEC), (0x431bf4, 0x431e18), (0x44e210, 0x44e261)):
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(AI.NATIVE.READ(start, end - start), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    if "--disassemble" in sys.argv:
        disassemble()
    else:
        print(json.dumps(capture()), flush=True)