import hashlib
import json
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True

from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parents[2]
BASE = runpy.run_path(str(ROOT / "tools/research/production-audit-20260919.py"))
LIFECYCLE = runpy.run_path(str(ROOT / "tools/research/construction-lifecycle-20260919.py"))
IMAGE = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(IMAGE).hexdigest() == BASE["EXE_HASH"]


def fixture(unit_type, blocked=False, delay=0, population=0):
    native = LIFECYCLE["source_fixture"](IMAGE)
    loaded = LIFECYCLE["load_fin"](native, (unit_type,))
    binding = loaded["bindings"][0]
    bank = binding["constructionBank"]
    directions = []
    for direction in range(32):
        descriptor = native.get(bank + direction * 4)
        frames = native.get(descriptor + 0x20)
        directions.append([native.get(frames + index * 72 + 2, 1)
                           for index in range(native.get(descriptor + 0x28))])
    source = binding["constructionState"]
    profile = dict(unitType=unit_type, id=source["name"], bankField=0x98,
                   finSha256=next(entry["sha256"] for entry in loaded["sources"] if entry["source"] == source["source"]),
                   directions=directions)
    game = BASE["GAME"]
    team = game + 0xb98 + 0xe30
    entity = game + 0x7d28 + 16 * 220
    native.emulator.mem_map(0xc00000, 0x100000)
    native.put(game + 0x46f2c, 0xc00000)
    native.put(0xc9a4b0, 128)
    native.put(0xc9a4b4, 128)
    native.put(0xc00804 + 47 * 4, 0xcc0000)
    cell = 0xcc0000 + 50 * 4
    native.put(cell, 152 if blocked else 1023)
    native.put(game + 0x7d28 + 152 * 220 + 0x35, 99, 1)
    native.put(entity + 6, 17 if unit_type == 0 else 29, 1)
    native.put(entity + 7, 1, 1)
    native.put(entity + 0x1a, 1, 1)
    native.put(team + 0x2c, 50)
    native.put(team + 0x30, 50)
    native.put(team + 0x108, 1, 1)
    native.put(team + 0x10c, delay, 1)
    native.put(team + 0x110, 1, 2)
    native.put(team + 0x118, unit_type, 1)
    native.put(team + 0x14, 650)
    native.put(team + 0x18, 350)
    native.put(game + 0x528, 10)
    spawns = []

    def spawn(machine):
        emulator = machine.emulator
        spawns.append([emulator.reg_read(UC_X86_REG_ECX), emulator.reg_read(UC_X86_REG_EDX),
                       emulator.reg_read(UC_X86_REG_EBX), machine.get(emulator.reg_read(UC_X86_REG_ESP) + 4)])

    def copy(machine):
        emulator = machine.emulator
        emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), bytes(emulator.mem_read(
            emulator.reg_read(UC_X86_REG_EDX), emulator.reg_read(UC_X86_REG_EBX))))

    native.stubs.update({0x41a538: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, population),
                         0x41b750: spawn, 0x43afde: copy})
    native.stub_cleanup[0x41b750] = 8

    def visit(advance):
        if advance:
            native.run(0x4264c8, {UC_X86_REG_EAX: entity + 0x24, UC_X86_REG_EDX: 0})
        native.run(0x414314, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 16, UC_X86_REG_EBX: entity})
        return dict(frame=native.get(entity + 0x28, 1), delay=native.get(entity + 0x29, 1),
                    mode=native.get(entity + 0x2a, 1), ready=native.get(team + 0x108, 1),
                    producerDelay=native.get(team + 0x10c, 1), count=native.get(team + 0x110, 2),
                    credits=native.get(team + 0x14), accounting=native.get(team + 0x18),
                    blockerFlag=native.get(game + 0x7d28 + 152 * 220 + 0x35, 1), exit=native.get(cell) & 1023)

    trace = [visit(False)]
    if not blocked and delay == 0 and population < 10:
        assert native.get(entity + 0x24) == bank
        while trace[-1]["count"]:
            assert len(trace) < 2000
            trace.append(visit(True))
        assert len(spawns) == 1
    return dict(profile=profile, source=source, trace=trace, spawns=spawns)


selectors = LIFECYCLE["parsed_source"](IMAGE)[2]["sourceUnitQueues"]
selector_machine = BASE["Native"](IMAGE)
for selector in selectors:
    address = 0x41add0 + selector["queue"] * 24 + selector["exitSelector"] * 8
    selector["exitOffset"] = {axis: int.from_bytes(selector_machine.emulator.mem_read(address + offset, 4), "little", signed=True)
                              for axis, offset in (("x", 0), ("y", 4))}

print(json.dumps(dict(sha256=BASE["EXE_HASH"], units=selectors, cases=[fixture(0), fixture(8)],
                      blocked=fixture(0, blocked=True, delay=2, population=10)["trace"],
                      delay=fixture(0, delay=1)["trace"], cap=fixture(0, population=10)["trace"])))