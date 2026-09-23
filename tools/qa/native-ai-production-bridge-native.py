"""Observe paid receipts and producer allocations in the original scheduler."""

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


def capture(updates):
    original_fixture = AI.fixture
    events = []
    machines = []

    def fixture():
        machine = original_fixture()
        machines.append(machine)
        pending = {}
        hooked_returns = set()

        def observe(emulator, address, size, data):
            counter = AI.dword(emulator, AI.NATIVE.GAME + 0x94C)
            encode = lambda pointer, length: base64.b64encode(emulator.mem_read(pointer, length)).decode()

            def snapshot():
                width = AI.dword(emulator, AI.MAP + 0x9A4B0)
                height = AI.dword(emulator, AI.MAP + 0x9A4B4)
                return {"game": encode(AI.NATIVE.GAME, 0x471B0),
                        "rngCursor": AI.dword(emulator, 0x479204),
                        "populations": [AI.dword(emulator, 0x4956E0 + team * 48 + 24) for team in range(8)],
                        "groundCells": [AI.dword(emulator, AI.dword(emulator, AI.MAP + 0x804 + row * 4) + column * 4)
                                        for row in range(height) for column in range(width)]}

            if address in pending:
                event = pending.pop(address)
                event["after"] = snapshot()
                events.append(event)
            if address in (0x41C7F8, 0x41B750, 0x41AF14, 0x414314):
                if address != 0x41C7F8 and counter not in (1199, 1200):
                    return
                stack = emulator.reg_read(AI.UC_X86_REG_ESP)
                returned = AI.dword(emulator, stack)
                event = {"counter": counter, "address": address, "returnAddress": returned,
                         "before": snapshot(), "registers": {name: emulator.reg_read(getattr(AI, "UC_X86_REG_" + name))
                                                               for name in ("EAX", "EDX", "EBX", "ECX")},
                         "stack": [AI.dword(emulator, stack + offset) for offset in (4, 8, 12, 16)]}
                if address == 0x41C7F8:
                    cursor = AI.dword(emulator, emulator.reg_read(AI.UC_X86_REG_EDX))
                    event["payload"] = list(emulator.mem_read(cursor, 3))
                pending[returned] = event
                if returned not in hooked_returns:
                    hooked_returns.add(returned)
                    emulator.hook_add(SCHEDULER.UC_HOOK_CODE, observe, begin=returned, end=returned)

        for entry_address in (0x41C7F8, 0x41B750, 0x41AF14, 0x414314):
            machine.hook_add(SCHEDULER.UC_HOOK_CODE, observe, begin=entry_address, end=entry_address)
        return machine

    AI.fixture = fixture
    try:
        result = SCHEDULER.capture("ALIEN", updates, 1152)
    finally:
        AI.fixture = original_fixture
    result["productionEvents"] = list(events)
    result["schema"] = "native-ai-production-bridge-observation-v1"
    result["control"] = production_control(machines[-1])
    return result


def production_control(machine):
    game = AI.NATIVE.GAME
    team = game + 0xB98
    actor = game + 0x7D28 + 220
    width = AI.dword(machine, AI.MAP + 0x9A4B0)
    height = AI.dword(machine, AI.MAP + 0x9A4B4)
    unit_type = 8
    build_bank = AI.dword(machine, 0x4F1880 + unit_type * 280 + 0x98)
    stand_bank = AI.dword(machine, 0x4F1880 + 29 * 280 + 0x80)
    troop_stand = AI.dword(machine, 0x4F1880 + unit_type * 280 + 0x80)

    def snapshot():
        return {"game": base64.b64encode(machine.mem_read(game, 0x471B0)).decode(),
                "rngCursor": AI.dword(machine, 0x479204),
                "populations": [AI.dword(machine, 0x4956E0 + owner * 48 + 24) for owner in range(8)],
                "groundCells": [AI.dword(machine, AI.dword(machine, AI.MAP + 0x804 + row * 4) + column * 4)
                                for row in range(height) for column in range(width)]}

    original_credits = AI.dword(machine, team + 0x14)
    AI.put(machine, team + 0x14, 1000)
    before_debit = snapshot()
    AI.put(machine, team + 0x14, 650)
    before = snapshot()
    machine.mem_write(0x709000, bytes([10, unit_type, 0, 1, 0]))
    AI.invoke(machine, 0x41DEFC, eax=game, edx=0x709000, ebx=5)
    assert machine.reg_read(AI.UC_X86_REG_EAX) == 0
    received = snapshot()
    visits = []
    for iteration in range(100):
        before_visit = snapshot()
        if iteration:
            AI.invoke(machine, 0x4264C8, eax=actor + 0x24, edx=0)
        handler_entry = snapshot()
        AI.invoke(machine, 0x414314, eax=game, edx=1, ebx=actor)
        visits.append({"before": before_visit, "handlerEntry": handler_entry, "after": snapshot()})
        if machine.mem_read(team + 0x110, 2) == bytes(2):
            break
    assert len(visits) < 100
    return {"label": "funded isolated original ALIEN02 player-producer control; not natural AI demand",
            "originalCredits": original_credits, "funding": 1000, "cost": 350, "width": width, "height": height,
            "unitType": unit_type, "producerSlot": 1, "beforeDebit": before_debit,
            "before": before, "received": received, "visits": visits,
            "banks": {"build": build_bank, "producerStand": stand_bank, "troopStand": troop_stand}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--updates", type=int, default=1200)
    arguments = parser.parse_args()
    print(json.dumps(capture(arguments.updates)))