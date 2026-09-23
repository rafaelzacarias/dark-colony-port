"""Observe the first four original world prefixes without runtime substitutions."""

import argparse
import base64
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "world_scheduler", Path(__file__).with_name("native-scheduler-native.py"))
SCHEDULER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCHEDULER)
AI = SCHEDULER.AI
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE

BOUNDARIES = (0x4196F4, 0x4197B4, 0x41981C, 0x419880, 0x41989E,
              0x4198C3, 0x4198CE, 0x419990, 0x419A28, 0x419A30,
              0x419BB8, 0x419D4D)


def capture(faction):
    original_fixture = AI.fixture
    prefixes = []
    current = None

    def fixture():
        machine = original_fixture()

        def observe(emulator, address, size, data):
            nonlocal current
            game = AI.NATIVE.GAME
            encode = lambda pointer, length: base64.b64encode(
                emulator.mem_read(pointer, length)).decode()
            if address == 0x4196F4:
                current = {"counter": AI.dword(emulator, game + 0x94C),
                           "boundaries": [], "writes": []}
                prefixes.append(current)
            if current is None:
                return
            current["boundaries"].append({
                "address": address, "game": encode(game, 0x471B0),
                "statistics": encode(0x4956E0, 8 * 48),
                "typeStatistics": encode(0x495860, 10 * 110 * 16),
                "alliances": encode(AI.dword(emulator, game + 0x471A0), 8),
                "sharedVision": encode(AI.dword(emulator, game + 0x471A4), 8),
                "renatCount": AI.dword(emulator, 0x4796B0),
                "renat": encode(0x4FE06C, 25 * 40),
                "rngCursor": AI.dword(emulator, 0x479204),
                "crtSeed": AI.dword(emulator, 0x85400C),
                "pathStamp": AI.dword(emulator, 0x47A980),
                "visibilityDirty": AI.dword(emulator, 0x4796A8)})
            if address == 0x419D4D:
                current = None

        def write(emulator, access, address, size, value, data):
            if current is None or current["boundaries"][-1]["address"] >= 0x419990:
                return
            if (AI.NATIVE.GAME <= address < AI.NATIVE.GAME + 0x471B0
                    or 0x4956E0 <= address < 0x4956E0 + 8 * 48
                    or 0x495860 <= address < 0x495860 + 10 * 110 * 16):
                current["writes"].append({"phase": current["boundaries"][-1]["address"],
                    "address": address, "size": size,
                    "value": value & ((1 << (size * 8)) - 1)})

        for address in BOUNDARIES:
            machine.hook_add(UC_HOOK_CODE, observe, begin=address, end=address)
        machine.hook_add(UC_HOOK_MEM_WRITE, write)
        return machine

    AI.fixture = fixture
    try:
        result = SCHEDULER.capture(faction, 4)
    finally:
        AI.fixture = original_fixture
    assert len(prefixes) == 4
    assert all(len(prefix["boundaries"]) == len(BOUNDARIES) for prefix in prefixes)
    result["schema"] = "native-world-prefix-observation-v1"
    result["prefixes"] = prefixes
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mission", choices=("HUMAN", "ALIEN"), required=True)
    arguments = parser.parse_args()
    print(json.dumps(capture(arguments.mission)))