"""Observe the complete original registered phase in fresh full-SCN sessions."""

import argparse
import base64
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("registered_scheduler", Path(__file__).with_name("native-scheduler-native.py"))
SCHEDULER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCHEDULER)
AI = SCHEDULER.AI
from unicorn import UC_HOOK_MEM_WRITE


def capture(faction, updates):
    original_fixture = AI.fixture
    phases = []
    pending = None
    visit = None
    inputs = None
    previous_registry = None
    phase_memory = {}

    def fixture():
        machine = original_fixture()

        def encode(pointer, length):
            return base64.b64encode(machine.mem_read(pointer, length)).decode()

        def timeline(bank):
            directions = []
            for direction in range(32):
                descriptor = AI.dword(machine, bank + direction * 4)
                first = AI.dword(machine, descriptor + 0x20)
                count = AI.dword(machine, descriptor + 0x28)
                assert 0 < count <= 255, (bank, direction, count)
                directions.append([machine.mem_read(first + frame * 72 + 2, 1)[0]
                                   for frame in range(count)])
            return directions

        def snapshot():
            width = AI.dword(machine, AI.MAP + 0x9A4B0)
            height = AI.dword(machine, AI.MAP + 0x9A4B4)
            planes = {}
            for name, offset in (("ground", 0x804), ("air", 0xC04), ("extra", 0x1004)):
                stride = 4 if name == "ground" else 2
                planes[name] = [int.from_bytes(machine.mem_read(AI.dword(machine, AI.MAP + offset + row * 4) + column * stride, stride), "little")
                                for row in range(height) for column in range(width)]
            return {"game": encode(AI.NATIVE.GAME, 0x471B0), "planes": planes,
                    "dependencies": encode(0x4E6D70, 110 * 52),
                    "productionDirty": machine.mem_read(0x479684, 1)[0],
                    "width": width, "height": height,
                    "rngCursor": AI.dword(machine, 0x479204), "crtSeed": AI.dword(machine, 0x85400C),
                    "task6Budget": AI.dword(machine, 0x478E00),
                    "carrierFin": {str(bank): timeline(bank) for bank in
                                   (AI.dword(machine, 0x4F1880 + kind * 280 + 0x80) for kind in (92, 93))}}

        def observe(emulator, address, size, data):
            nonlocal pending, visit, inputs, previous_registry, phase_memory
            game = AI.NATIVE.GAME
            if address == 0x419BB8:
                if inputs is None:
                    inputs = {"types": encode(0x4F1880, 110 * 280),
                              "weapons": encode(0x4F0200, 80 * 72),
                              "dependencies": encode(0x4E6D70, 110 * 52)}
                    banks = {}
                    for kind in range(106):
                        for offset in range(0x7C, 0xD8, 4):
                            bank = AI.dword(machine, 0x4F1880 + kind * 280 + offset)
                            if not bank or str(bank) in banks:
                                continue
                            banks[str(bank)] = timeline(bank)
                    inputs["fin"] = banks
                pending = {"counter": AI.dword(machine, game + 0x94C),
                           "resourceClock": AI.dword(machine, game + 0x530),
                           "before": snapshot(), "visits": [], "writes": []}
                phase_memory = {}
                previous_registry = struct.unpack("<800h", machine.mem_read(game + 0x468EC, 1600))
            elif address == 0x419248 and pending is not None:
                slot = emulator.reg_read(AI.UC_X86_REG_EDX)
                raw = bytes(machine.mem_read(game + 0x7D28 + slot * 220, 220))
                visit = {"slot": slot, "type": raw[6], "status": raw[0x2C],
                         "task": raw[0x39 + struct.unpack_from("<b", raw, 0x38)[0] * 2],
                         "before": base64.b64encode(raw).decode(), "writes": [], "dispatches": [],
                         "rngBefore": AI.dword(machine, 0x479204),
                         "budgetBefore": AI.dword(machine, 0x478E00),
                         "highWaterBefore": AI.dword(machine, game + 0x7D20)}
            elif address == 0x419BE5 and visit is not None:
                registry = struct.unpack("<800h", machine.mem_read(game + 0x468EC, 1600))
                after = bytes(machine.mem_read(game + 0x7D28 + visit["slot"] * 220, 220))
                visit.update(after=encode(game + 0x7D28 + visit["slot"] * 220, 220),
                             taskAfter=after[0x39 + struct.unpack_from("<b", after, 0x38)[0] * 2],
                             registryChanges=[{"index": index, "before": previous_registry[index], "slot": value}
                                              for index, value in enumerate(registry) if value != previous_registry[index]],
                             rngAfter=AI.dword(machine, 0x479204),
                             budgetAfter=AI.dword(machine, 0x478E00),
                             highWaterAfter=AI.dword(machine, game + 0x7D20))
                previous_registry = registry
                pending["visits"].append(visit)
                visit = None
            elif address == 0x419C0E and pending is not None:
                pending["after"] = snapshot()
                pending["touchedMemory"] = [{"address": pointer, "before": before,
                                             "after": machine.mem_read(pointer, 1)[0]}
                                            for pointer, before in sorted(phase_memory.items())]
                phases.append(pending)
                pending = None

        def write(emulator, access, address, size, value, data):
            if pending is None or 0x700000 <= address < 0x710000:
                return
            record = {"address": address, "size": size, "value": value,
                      "before": bytes(emulator.mem_read(address, size)).hex()}
            for position, before in enumerate(bytes.fromhex(record["before"])):
                phase_memory.setdefault(address + position, before)
            pending["writes"].append(record)
            if visit is not None:
                visit["writes"].append(record)

        def dispatch(emulator, address, size, data):
            if visit is None:
                return
            raw = bytes(machine.mem_read(AI.NATIVE.GAME + 0x7D28 + visit["slot"] * 220, 220))
            visit["dispatches"].append({"address": address,
                                       "task": raw[0x39 + struct.unpack_from("<b", raw, 0x38)[0] * 2],
                                       "registers": {name: emulator.reg_read(getattr(AI, "UC_X86_REG_" + name))
                                                     for name in ("EAX", "EBX", "ECX", "EDX")},
                                       "stack": encode(emulator.reg_read(AI.UC_X86_REG_ESP), 20),
                                       "raw": base64.b64encode(raw).decode()})

        handlers = struct.unpack("<23I", machine.mem_read(0x479310, 23 * 4))
        helpers = (0x412014, 0x414CE4, 0x44492C, 0x44302C, 0x4430B0, 0x4150A9, 0x4150BF, 0x4150EF)
        for address in {*handlers, *helpers}:
            if 0x410000 <= address < 0x450000:
                machine.hook_add(SCHEDULER.UC_HOOK_CODE, dispatch, begin=address, end=address)
        for address in (0x419BB8, 0x419248, 0x419BE5, 0x419C0E):
            machine.hook_add(SCHEDULER.UC_HOOK_CODE, observe, begin=address, end=address)
        machine.hook_add(UC_HOOK_MEM_WRITE, write)
        return machine

    AI.fixture = fixture
    try:
        result = SCHEDULER.capture(faction, updates)
    finally:
        AI.fixture = original_fixture
    result.update(schema="native-registered-host-observation-v1", registeredPhases=phases, inputs=inputs)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mission", choices=("HUMAN", "ALIEN"), required=True)
    parser.add_argument("--updates", type=int, default=32)
    arguments = parser.parse_args()
    print(json.dumps(capture(arguments.mission, arguments.updates)))