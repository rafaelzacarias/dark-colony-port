"""Capture untouched source-world suffixes for the bounded host transaction."""

import argparse
import base64
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("scheduler", Path(__file__).with_name("native-scheduler-native.py"))
SCHEDULER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCHEDULER)
AI = SCHEDULER.AI


def capture(faction, updates, counters):
    original_fixture = AI.fixture
    suffixes = []
    pending = None

    def fixture():
        machine = original_fixture()

        def observe(emulator, address, size, data):
            nonlocal pending
            game = AI.NATIVE.GAME
            counter = AI.dword(emulator, game + 0x94C)
            if counter not in counters:
                return
            encode = lambda pointer, length: base64.b64encode(emulator.mem_read(pointer, length)).decode()

            def snapshot():
                policies = []
                for team in range(8):
                    pointer = AI.dword(emulator, game + 0xBC0 + team * 0xE30)
                    if pointer:
                        policies.append({"team": team, "address": pointer, "bytes": encode(pointer, 0x6C40)})
                width = AI.dword(emulator, AI.MAP + 0x9A4B0)
                height = AI.dword(emulator, AI.MAP + 0x9A4B4)
                return {"game": encode(game, 0x471B0), "policies": policies,
                        "aiState": encode(AI.dword(emulator, game + 0xB94), 8),
                        "rngCursor": AI.dword(emulator, 0x479204),
                        "crtSeed": AI.dword(emulator, 0x85400C),
                        "forceOrder": emulator.mem_read(0x489510, 1)[0],
                        "localPackets": emulator.mem_read(0x49D620, 1)[0],
                        "populations": [AI.dword(emulator, 0x4956E0 + team * 48 + 24) for team in range(8)],
                        "groundCells": [AI.dword(emulator, AI.dword(emulator, AI.MAP + 0x804 + row * 4) + column * 4)
                                        for row in range(height) for column in range(width)]}

            if address == 0x419CBC:
                pending = {"counter": counter, "before": snapshot(), "outgoing": []}
            elif address == 0x421648 and pending is not None:
                pointer = emulator.reg_read(AI.UC_X86_REG_EAX)
                length = emulator.reg_read(AI.UC_X86_REG_EDX)
                pending["outgoing"].append(bytes(emulator.mem_read(pointer, length)).hex())
            elif address == 0x419D4D and pending is not None:
                pending["after"] = snapshot()
                suffixes.append(pending)
                pending = None

        for address in (0x419CBC, 0x421648, 0x419D4D):
            machine.hook_add(SCHEDULER.UC_HOOK_CODE, observe, begin=address, end=address)
        return machine

    AI.fixture = fixture
    try:
        result = SCHEDULER.capture(faction, updates, min(counters))
    finally:
        AI.fixture = original_fixture
    result["suffixes"] = suffixes
    result["schema"] = "native-scheduler-host-observation-v1"
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mission", choices=("HUMAN", "ALIEN"), default="ALIEN")
    parser.add_argument("--updates", type=int, default=1200)
    parser.add_argument("--counters", default="1160,1184,1192")
    arguments = parser.parse_args()
    print(json.dumps(capture(arguments.mission, arguments.updates,
                             {int(value) for value in arguments.counters.split(",")})))