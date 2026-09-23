"""Bounded original death-handler gates, stopping at the carrier boundary."""

import importlib.util
import json
from pathlib import Path
import struct
import sys

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_ESP

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("actions", Path(__file__).resolve().parents[1] / "research/mission-actions.py")
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)


def probe(unit_type, team, flag, no_pickup=0, game_mode=0):
    machine = NATIVE.machine_for_probe()
    slot = 300
    actor = NATIVE.GAME + 0x7D28 + slot * 220
    machine.mem_write(actor, struct.pack("<HHHBB", 896, 0, 1152, unit_type, team))
    machine.mem_write(actor + 0x0C, struct.pack("<i", 0))
    machine.mem_write(actor + 0x2C, bytes((1,)))
    machine.mem_write(0x4F1980 + unit_type * 280, struct.pack("<I", flag))
    machine.mem_write(NATIVE.GAME + team * 0xE30 + 0xBB4, struct.pack("<I", no_pickup))
    machine.mem_write(NATIVE.GAME, bytes((game_mode,)))
    machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EDX, slot)
    observed = []

    def boundary(emulator, address, size, context):
        if address == 0x418F4C:
            stack = emulator.reg_read(UC_X86_REG_ESP)
            payload = struct.unpack("<I", emulator.mem_read(stack + 8, 4))[0]
            observed.append({"team": emulator.reg_read(UC_X86_REG_EDX),
                             "tileX": emulator.reg_read(UC_X86_REG_EBX),
                             "tileY": emulator.reg_read(UC_X86_REG_ECX),
                             "payload": bytes(emulator.mem_read(payload, 3)).hex()})
            emulator.emu_stop()
        elif address == 0x416436:
            emulator.emu_stop()

    machine.hook_add(UC_HOOK_CODE, boundary)
    machine.emu_start(0x416308, 0x70D000, count=10000)
    expected = bool(flag and not no_pickup and not game_mode)
    assert bool(observed) == expected
    assert machine.mem_read(actor + 0x2C, 1)[0] == 10
    assert struct.unpack("<i", machine.mem_read(actor + 0x0C, 4))[0] == 0
    if observed:
        assert observed == [{"team": team, "tileX": 3, "tileY": 4, "payload": "00012c"}]
    return {"type": unit_type, "team": team, "sourceTypePickupField": flag,
            "noPickup": no_pickup, "gameMode": game_mode, "carrierCalls": observed,
            "health": 0, "status": 10}


if __name__ == "__main__":
    type_spec = importlib.util.spec_from_file_location("casualty_types", NATIVE.ROOT / "tools/research/inspire-audit-20260919.py")
    type_probe = importlib.util.module_from_spec(type_spec)
    type_spec.loader.exec_module(type_probe)
    parsed = type_probe.parsed_fixture()
    flags = [struct.unpack("<I", parsed.mem_read(0x4F1980 + unit_type * 280, 4))[0] for unit_type in range(106)]
    assert [unit_type for unit_type, flag in enumerate(flags) if flag] == list(range(69, 77))
    cases = [probe(unit_type, team, flags[unit_type]) for team in range(8) for unit_type in range(69, 77)]
    cases += [probe(69, team, flags[69], no_pickup=1) for team in range(8)]
    cases += [probe(0, 0, flags[0]), probe(69, 0, flags[69], game_mode=1)]
    print(json.dumps({"sha256": NATIVE.AUDIT.DIGEST,
                      "scope": "original parsed type flags; original handler through carrier entry, not carrier execution or respawn",
                      "sourceTypesWithPickupFlag": [unit_type for unit_type, flag in enumerate(flags) if flag],
                      "cases": cases}))