"""Capture original startup CITY calls, without substituting constructors."""

import argparse
import base64
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "initializer_scheduler", Path(__file__).with_name("native-scheduler-native.py"))
SCHEDULER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCHEDULER)
AI = SCHEDULER.AI
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE


def capture(faction):
    original_fixture = AI.fixture
    calls = []
    pending = None
    stages = []

    def fixture():
        machine = original_fixture()

        def snapshot(emulator):
            encode = lambda pointer, length: base64.b64encode(
                emulator.mem_read(pointer, length)).decode()
            width = AI.dword(emulator, AI.MAP + 0x9A4B0)
            height = AI.dword(emulator, AI.MAP + 0x9A4B4)
            return {"game": encode(AI.NATIVE.GAME, 0x471B0),
                    "types": encode(0x4F1880, 110 * 280),
                    "dependencies": encode(0x4E6D70, 110 * 52),
                    "width": width, "height": height,
                    "ground": base64.b64encode(b"".join(bytes(emulator.mem_read(
                        AI.dword(emulator, AI.MAP + 0x804 + row * 4), width * 4))
                        for row in range(height))).decode(),
                    "productionDirty": emulator.mem_read(0x479684, 1)[0],
                    "rngCursor": AI.dword(emulator, 0x479204)}

        def observe(emulator, address, size, data):
            nonlocal pending
            if address in (0x41B920, 0x41C3EF, 0x41C42D, 0x41C6B4, 0x41C7EE, 0x4196F4):
                stages.append({"address": address, **snapshot(emulator)})
            if pending is not None and address == pending["returnAddress"]:
                pending["after"] = snapshot(emulator)
                calls.append(pending)
                pending = None
            if address == 0x444F14:
                assert pending is None
                stack = emulator.reg_read(AI.UC_X86_REG_ESP)
                pending = {"returnAddress": AI.dword(emulator, stack),
                    "registers": {name: emulator.reg_read(getattr(AI, "UC_X86_REG_" + name))
                                  for name in ("EAX", "EDX", "EBX", "ECX")},
                    "stack": [AI.dword(emulator, stack + offset) for offset in (4, 8, 12, 16)],
                    "before": snapshot(emulator), "writes": []}

        def write(emulator, access, address, size, value, data):
            if pending is not None and not 0x700000 <= address < 0x710000:
                pending["writes"].append({"address": address, "size": size,
                    "value": value & ((1 << (size * 8)) - 1),
                    "pc": emulator.reg_read(AI.UC_X86_REG_EIP)})

        machine.hook_add(UC_HOOK_CODE, observe)
        machine.hook_add(UC_HOOK_MEM_WRITE, write)
        return machine

    AI.fixture = fixture
    try:
        SCHEDULER.capture(faction, 1)
    finally:
        AI.fixture = original_fixture
    assert len(calls) == 120, len(calls)
    return {"schema": "source-native-city-startup-v1", "mission": faction + "02",
            "gameAddress": AI.NATIVE.GAME, "groundAddress": AI.GROUND,
            "calls": calls, "stages": stages}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mission", choices=("HUMAN", "ALIEN"), required=True)
    arguments = parser.parse_args()
    print(json.dumps(capture(arguments.mission)))