"""Bounded source building-level receipts; initializer/eligibility are explicit stubs."""

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
GAME = AUDIT["GAME"]
RESULTS = []
for race in (0, 1):
    for slot, dependency in ((2, 5 + race * 14), (3, 4 + race * 14)):
        row = next(entry for entry in SOURCE["dependencies"] if entry["id"] == dependency)
        assert row["metadata"] == [0, slot, 1, race]
        upgraded_type = {2: 19, 3: 21}[slot] + race * 12
        maximum = SOURCE["units"][upgraded_type]["health"]
        for health in (1, 1200, 2400):
            native = AUDIT["Native"](IMAGE)
            native.emulator.mem_write(0x4E6D70, DEPENDENCIES)
            native.run(0x4380D8, {UC_X86_REG_EAX: slot, UC_X86_REG_EDX: 1, UC_X86_REG_EBX: race})
            cost = native.emulator.reg_read(UC_X86_REG_EAX)
            assert cost == row["cost"]
            team = 1
            team_base = GAME + team * 0xE30
            for unit in SOURCE["units"]:
                native.put(0x4F18C4 + unit["index"] * 280, unit["health"])
            native.put(GAME + 0x7D1C, team)
            native.put(team_base + 0xBB8, race)
            native.put(team_base + 0xBD4 + slot * 4, health)
            native.put(team_base + 0xC5C + slot * 4, 0)
            native.put(team_base + 0xBAC, 777)
            native.put(team_base + 0xBB0, 100)
            native.emulator.mem_write(0x701100, bytes([slot, 1, team]))
            native.put(0x701000, 0x701100)
            native.stubs = {0x444F14: None, 0x437BC4: None}
            native.run(0x41C8D4, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
            output = {"race": race, "slot": slot, "dependency": dependency,
                      "selector": 1, "cost": cost, "inputHealth": health,
                      "upgradedType": upgraded_type, "upgradedMaxHealth": maximum,
                      "outputHealth": native.get(team_base + 0xBD4 + slot * 4),
                      "outputLevel": native.get(team_base + 0xC5C + slot * 4),
                      "credits": native.get(team_base + 0xBAC),
                      "accounting": native.get(team_base + 0xBB0), "stubCalls": native.calls}
            assert output["outputLevel"] == 1
            assert output["credits"] == 777 and output["accounting"] == 100 + cost
            assert output["outputHealth"] == maximum, output
            assert "0x444f14" in native.calls
            RESULTS.append(output)

print(json.dumps({"scope": "building-selector1-receiver-not-full-lifecycle",
                  "executableSha256": AUDIT["EXE_HASH"], "sourceHashes": TABLES["sourceHashes"],
                  "results": RESULTS}, indent=2))