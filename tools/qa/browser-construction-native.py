"""Bounded original DEPEND base-price/race lookup; not a construction lifecycle proof."""

import hashlib
import json
from pathlib import Path
import runpy

from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_EDX


ROOT = Path(__file__).resolve().parents[2]
AUDIT = runpy.run_path(str(ROOT / "tools/research/production-audit-20260919.py"))
IMAGE = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(IMAGE).hexdigest() == AUDIT["EXE_HASH"]
SOURCE, DEPENDENCIES, TABLES = AUDIT["source_probe"](IMAGE)
RESULTS = []
for race, dependency in ((0, 0), (1, 14)):
    machine = AUDIT["Native"](IMAGE)
    machine.emulator.mem_write(0x4E6D70, DEPENDENCIES)
    machine.run(0x4380D8, {UC_X86_REG_EAX: 0, UC_X86_REG_EDX: 0, UC_X86_REG_EBX: race})
    cost = machine.emulator.reg_read(UC_X86_REG_EAX)
    row = next(entry for entry in SOURCE["dependencies"] if entry["id"] == dependency)
    assert row["metadata"] == [0, 0, 0, race]
    assert cost == row["cost"] == 2000
    machine.run(0x438074, {UC_X86_REG_EAX: dependency})
    assert machine.emulator.reg_read(UC_X86_REG_EAX) == cost
    RESULTS.append({"race": race, "dependency": dependency, "slot": 0, "level": 0,
                    "nativeBaseBuildCost": cost, "metadata": row["metadata"],
                    "dependencies": row["prerequisites"], "stubCalls": machine.calls})

print(json.dumps({"scope": "source-price-only", "executableSha256": AUDIT["EXE_HASH"],
                  "helpers": ["4380d8", "438074"], "results": RESULTS,
                  "sourceHashes": TABLES["sourceHashes"]}, indent=2))