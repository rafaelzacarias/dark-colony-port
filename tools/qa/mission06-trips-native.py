"""Compile unchanged HUMAN06.TRO and execute its original spatial dispatch gates."""

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "control_actions", ROOT / "tools/research/mission02-control-actions-20260919.py")
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)
NATIVE = CONTROL.NATIVE

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_EDX, UC_X86_REG_EIP, UC_X86_REG_ESP


def main():
    source = ROOT / "raw_cd/DC/SCENARIO/HUMAN/HUMAN06.TRO"
    content = source.read_bytes()
    mtg = source.with_suffix(".MTG").read_bytes()
    assert len(mtg) == 2 + mtg[0] * mtg[1]
    machine = NATIVE.machine_for_probe()
    lines = iter(content.splitlines(keepends=True))
    consumed = []

    def file_service(emulator, address, size, user_data):
        if address == 0x406288:
            CONTROL.return_from_hook(emulator, 1)
        elif address == 0x406338:
            line = next(lines, None)
            destination = emulator.reg_read(UC_X86_REG_EAX)
            if line is not None:
                assert len(line) < emulator.reg_read(UC_X86_REG_EDX)
                emulator.mem_write(destination, line + b"\0")
                consumed.append(line)
            CONTROL.return_from_hook(emulator, destination if line is not None else 0)
        elif address == 0x40636C:
            CONTROL.return_from_hook(emulator, 0)
        elif address in (0x46C996, 0x46CB3E):
            raise AssertionError(f"Native parser diagnostic at {address:#x}")

    machine.hook_add(UC_HOOK_CODE, file_service)
    machine.mem_write(CONTROL.TRIGGERS, b"\xa5" * 0x800)
    machine.mem_write(NATIVE.STACK, struct.pack("<I", 0x70D000))
    machine.emu_start(0x43FB90, 0x70D000, count=2000000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x70D000
    assert b"".join(consumed) == content
    headers = {int(fields[0]): fields for line in content.decode("ascii").splitlines()
               if (fields := line.split()) and fields[0].isdigit()}
    tags = sorted({tag & 63 for tag in mtg[2:]} - {0})
    absent = sorted(set(tags) - set(headers))
    assert 7 in absent
    for trigger_id in set(range(128)) - set(headers):
        assert machine.mem_read(CONTROL.TRIGGERS + trigger_id * 16 + 4, 5) == b"\0" * 5
    ranges = [(CONTROL.TRIGGERS, 0x800), (NATIVE.GAME, 0x471B0), (CONTROL.STATISTICS, CONTROL.STATISTICS_SIZE)]
    before = [bytes(machine.mem_read(address, length)) for address, length in ranges]
    reached = []

    def boundary(emulator, address, size, user_data):
        if address in (0x43CF2C, 0x43D814):
            reached.append(address)
            emulator.emu_stop()
        elif address == 0x70D000:
            emulator.emu_stop()

    machine.hook_add(UC_HOOK_CODE, boundary)
    records = []
    for trigger_id in sorted(set(absent + [2, 3, 1])):
        reached.clear()
        machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
        machine.mem_write(NATIVE.STACK, struct.pack("<I", 0x70D000))
        machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
        machine.reg_write(UC_X86_REG_EDX, trigger_id)
        machine.reg_write(UC_X86_REG_EBX, 152)
        machine.emu_start(0x43E530, 0, count=1000)
        if trigger_id == 1:
            assert reached == [0x43CF2C]
        else:
            assert reached == []
            assert machine.reg_read(UC_X86_REG_EIP) == 0x70D000
        assert [bytes(machine.mem_read(address, length)) for address, length in ranges] == before
        records.append({"id": trigger_id, "conditionReached": bool(reached), "unchanged": True})
    print(json.dumps({"exeSha256": hashlib.sha256(NATIVE.IMAGE).hexdigest(),
                      "troSha256": hashlib.sha256(content).hexdigest(),
                      "mtgSha256": hashlib.sha256(mtg).hexdigest(), "tags": tags,
                      "absent": absent, "dispatch": records,
                      "scope": "Original TRO loader and trip gates; enabled trip stops at condition entry."}))


if __name__ == "__main__":
    main()