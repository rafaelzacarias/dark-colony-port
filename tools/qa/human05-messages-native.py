"""Original HUMAN05 message loader and TRO handler; file I/O, allocator and clock boundaries only."""

import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
PROBE = runpy.run_path(str(ROOT / "tools/research/ai-policy-20260919.py"))
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX,
                              UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_ESP, UC_X86_REG_EIP)


def main():
    machine = PROBE["fixture"]()
    game = PROBE["NATIVE"].GAME
    table = game + 0x46F9C
    folder = ROOT / "raw_cd/DC/SCENARIO/HUMAN"
    scenario = (folder / "HUMAN05.SCN").read_bytes()
    stem = scenario.decode("ascii").splitlines()[1]
    source = folder / (stem.upper() + ".MSG")
    content = source.read_bytes()
    lines = iter(content.splitlines(keepends=True))
    reads, opens, scanned, diagnostics = [], [], [], []
    allocation = 0xA10000

    def cstring(pointer):
        return bytes(machine.mem_read(pointer, 256)).split(b"\0", 1)[0].decode("ascii")

    def service(emulator, address, size, data):
        nonlocal allocation
        stack = emulator.reg_read(UC_X86_REG_ESP)
        result = 0
        if address == 0x406288:
            opens.append(dict(filename=cstring(emulator.reg_read(UC_X86_REG_EAX)),
                              extension=cstring(emulator.reg_read(UC_X86_REG_EDX)),
                              mode=cstring(emulator.reg_read(UC_X86_REG_EBX))))
            result = 1
        elif address in (0x406338, 0x4062B4):
            line = next(lines, None)
            if line is not None:
                result = emulator.reg_read(UC_X86_REG_EAX)
                assert len(line) < emulator.reg_read(UC_X86_REG_EDX)
                emulator.mem_write(result, line + b"\0")
                reads.append(line)
        elif address == 0x40BCC0:
            length = emulator.reg_read(UC_X86_REG_EDX)
            assert 0 < length <= 256
            result = allocation
            allocation += (length + 3) & ~3
        elif address == 0x40B030:
            result = 123456
        emulator.reg_write(UC_X86_REG_EAX, result)
        emulator.reg_write(UC_X86_REG_EIP, PROBE["dword"](emulator, stack))
        emulator.reg_write(UC_X86_REG_ESP, stack + 4)

    boundaries = (0x406288, 0x406338, 0x4062B4, 0x40636C, 0x40BCC0, 0x40B030)
    for address in boundaries:
        machine.hook_add(UC_HOOK_CODE, service, begin=address, end=address)
    machine.hook_add(UC_HOOK_CODE, lambda emulator, address, size, data:
                     scanned.append(emulator.reg_read(UC_X86_REG_EAX)), begin=0x44D794, end=0x44D794)
    filename = f"SCENARIO/HUMAN/{stem}"
    machine.mem_write(0x706000, filename.encode("ascii") + b"\0")
    PROBE["invoke"](machine, 0x44D6F0, eax=0x703000, edx=table, ebx=0x706000)
    assert b"".join(reads) == content
    assert opens == [dict(filename=filename, extension="msg", mode="r")]
    messages = []
    for identifier in range(30):
        pointer = PROBE["dword"](machine, table + identifier * 4)
        if pointer:
            messages.append(dict(id=identifier, text=cstring(pointer).rstrip("\r\n")))
    assert scanned == list(range(1, 17))
    assert messages[4] == dict(id=5, text="WARNING...WARNING...WARNING...")
    PROBE["invoke"](machine, 0x44DA88, eax=table)
    action = PROBE["NATIVE"].ACTION
    source_action = next(line for line in (folder / "HUMAN05.TRO").read_text().splitlines()
                         if line.startswith("msg ") and line.split()[3] == "5")
    arguments = list(map(int, source_action.split()[1:]))
    parsed = PROBE["NATIVE"].parse(0x43FA3C, " ".join(map(str, arguments)))
    machine.mem_write(action, bytes(parsed.mem_read(action, 28)))
    machine.reg_write(UC_X86_REG_ESI, action)
    machine.reg_write(UC_X86_REG_EDI, game)
    machine.emu_start(0x43D877, 0x43D822, count=10000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x43D822
    queue = dict(text=cstring(PROBE["dword"](machine, table + 0x78)).rstrip("\r\n"),
                 parameter3=PROBE["dword"](machine, table + 0xB8),
                 clockMilliseconds=PROBE["dword"](machine, table + 0xF8),
                 parameter4=PROBE["dword"](machine, table + 0x138),
                 presentationCode=PROBE["dword"](machine, table + 0x178),
                 initialValue=PROBE["dword"](machine, table + 0x1B8),
                 count=PROBE["dword"](machine, table + 0x1F8))
    assert queue == dict(text=messages[4]["text"], parameter3=3, clockMilliseconds=123456,
                         parameter4=3, presentationCode=0, initialValue=31, count=1)
    machine.mem_write(table + 5 * 4, struct.pack("<I", 0))

    def absent(emulator, address, size, data):
        diagnostics.append(hex(address))
        emulator.emu_stop()

    machine.hook_add(UC_HOOK_CODE, absent, begin=0x44D93D, end=0x44D93D)
    machine.reg_write(UC_X86_REG_ESI, action)
    machine.reg_write(UC_X86_REG_EDI, game)
    machine.emu_start(0x43D877, 0x43D822, count=10000)
    assert diagnostics == ["0x44d93d"]
    print(json.dumps(dict(executableSha256=hashlib.sha256(PROBE["NATIVE"].IMAGE).hexdigest(),
                         sourceSha256=hashlib.sha256(content).hexdigest(), opens=opens,
                         scannedIds=scanned, messages=messages, sourceAction=source_action,
                         arguments=arguments, queue=queue, absentEntryDiagnostic=diagnostics,
                         boundaries=[hex(address) for address in boundaries]), indent=2))


if __name__ == "__main__":
    main()