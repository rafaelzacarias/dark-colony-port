"""Fresh constructor, repeated real shots and original registered death visits."""

import base64
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("death_damaged", Path(__file__).with_name("native-damaged-actor-native.py"))
DAMAGED = importlib.util.module_from_spec(spec)
spec.loader.exec_module(DAMAGED)
PROJECTILE = DAMAGED.PROJECTILE
AI, GAME = DAMAGED.AI, DAMAGED.GAME


def capture(warmup=0, policy=0):
    machines = []
    configure = PROJECTILE.FIRE.configure_fire
    original_capture = PROJECTILE.FIRE.ACTOR.capture

    def retain(machine, kinds):
        configure(machine, kinds)
        machines.append(machine)

    def configured_capture(*args, **kwargs):
        kwargs["fire_options"] = {**kwargs["fire_options"], "rngWarmup": warmup}
        return original_capture(*args, **kwargs)

    PROJECTILE.FIRE.configure_fire = retain
    PROJECTILE.FIRE.ACTOR.capture = configured_capture
    try:
        initial = PROJECTILE.capture(0, policy=policy)
    finally:
        PROJECTILE.FIRE.configure_fire = configure
        PROJECTILE.FIRE.ACTOR.capture = original_capture
    machine = machines[0]
    target, source = initial["fire"]["nearbyEnemy"]["enemySlot"], initial["fire"]["slot"]
    width, height = initial["fire"]["world"]["width"], initial["fire"]["world"]["height"]
    entries, writes, visits = [], [], []

    def snapshot():
        return {"actors": base64.b64encode(machine.mem_read(GAME + 0x7D28, 800 * 220)).decode(),
                "game": base64.b64encode(machine.mem_read(GAME, 0x471B0)).decode(),
                "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 384))),
                "typeStatistics": base64.b64encode(machine.mem_read(0x495860, 10 * 110 * 16)).decode(),
                "rngCursor": AI.dword(machine, 0x479204),
                "ground": base64.b64encode(machine.mem_read(AI.GROUND, width * height * 4)).decode(),
                "air": base64.b64encode(machine.mem_read(0xB40000, width * height * 2)).decode(),
                "extra": base64.b64encode(machine.mem_read(0xB60000, width * height * 2)).decode()}

    def observe(emulator, address, size, context):
        entries.append({"entry": hex(address), "eax": emulator.reg_read(AI.UC_X86_REG_EAX),
                        "edx": emulator.reg_read(AI.UC_X86_REG_EDX)})

    def write(emulator, access, address, size, value, context):
        if GAME <= address < GAME + 0x471B0 or 0x4956E0 <= address < 0x499D20 or address == 0x479204 or AI.GROUND <= address < AI.GROUND + width * height * 4:
            writes.append({"eip": hex(emulator.reg_read(PROJECTILE.FIRE.ACTOR.UC_X86_REG_EIP)),
                           "address": hex(address), "size": size, "value": value})

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)
             for address in (0x419248, 0x441710, 0x441930, 0x416308, 0x416460, 0x434D48, 0x419E80, 0x431BF4)]
    hooks.append(machine.hook_add(PROJECTILE.FIRE.ACTOR.UC_HOOK_MEM_WRITE, write))
    before = snapshot()
    result = {"binarySha256": initial["fire"]["binarySha256"], "initial": initial,
              "target": target, "source": source, "before": before, "visits": visits,
              "warmup": warmup, "policy": policy,
              "targetWorld": DAMAGED.actor_world(machine, initial["fire"], target),
              "sourceWorld": DAMAGED.actor_world(machine, initial["fire"], source),
              "runtimeIntercepts": [], "healthRewrites": [], "completed": False}
    fin = result["targetWorld"]["fin"]
    record = bytes(result["targetWorld"]["typeBytes"])
    for index in range(struct.unpack_from("<i", record, 0xE8)[0]):
        bank = struct.unpack_from("<I", record, 0xAC + index * 4)[0]
        directions = []
        for direction in range(32):
            descriptor = AI.dword(machine, bank + direction * 4)
            timeline, count = AI.dword(machine, descriptor + 0x20), AI.dword(machine, descriptor + 0x28)
            assert 0 < count < 256
            directions.append([machine.mem_read(timeline + frame * 72 + 2, 1)[0] for frame in range(count)])
        fin[str(bank)] = directions
    try:
        for counter in range(2, 1200):
            AI.put(machine, GAME + 0x530, counter)
            AI.put(machine, 0x478E00, 0)
            for owner in ("target", "source", "projectile"):
                if owner == "source" and machine.mem_read(GAME + 0x7D28 + target * 220 + 0x2C, 1)[0] != 1:
                    continue
                entries.clear()
                writes.clear()
                AI.invoke(machine, 0x44293C if owner == "projectile" else 0x419248, eax=GAME,
                          **({} if owner == "projectile" else {"edx": target if owner == "target" else source}))
                after = snapshot()
                changed = {}
                for key, value in after.items():
                    if value == before[key]:
                        continue
                    if isinstance(value, str):
                        previous, current = base64.b64decode(before[key]), base64.b64decode(value)
                        changed[key] = [[index, byte] for index, byte in enumerate(current) if byte != previous[index]]
                    else:
                        changed[key] = value
                victim = bytes(machine.mem_read(GAME + 0x7D28 + target * 220, 220))
                visits.append({"owner": owner, "counter": counter, "after": changed,
                               "health": struct.unpack_from("<i", victim, 12)[0], "status": victim[0x2C],
                               "entries": list(entries), "writes": list(writes)})
                before = after
                if target not in struct.unpack("<800h", machine.mem_read(GAME + 0x468EC, 1600)):
                    result["completed"] = True
                    return result
        result["blocker"] = "registered death did not remove victim within 1198 counters"
    except Exception as error:
        result["blocker"] = repr(error)
        result["failure"] = {"eip": hex(machine.reg_read(PROJECTILE.FIRE.ACTOR.UC_X86_REG_EIP)),
                             "entries": list(entries), "writes": list(writes), "snapshot": snapshot()}
    finally:
        for hook in hooks:
            machine.hook_del(hook)
    return result


if __name__ == "__main__":
    if "--disassemble" in sys.argv:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        for start, end in ((0x441930, 0x441BEC), (0x416308, 0x416500), (0x434D48, 0x434F6C)):
            for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(AI.NATIVE.READ(start, end - start), start):
                print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
    else:
        warmup = int(sys.argv[sys.argv.index("--warmup") + 1]) if "--warmup" in sys.argv else 0
        policy = int(sys.argv[sys.argv.index("--policy") + 1]) if "--policy" in sys.argv else 0
        print(json.dumps(capture(warmup, policy)), flush=True)