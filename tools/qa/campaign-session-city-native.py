import json
from pathlib import Path
import runpy
import struct

ROOT = Path(__file__).resolve().parents[2]
owner = runpy.run_path(str(ROOT / "tools/qa/native-construction-host-native.py"))
source = owner["SOURCE"]
snapshot = source["snapshot"]
fixture = source["source_fixture"]
machines = []


def capture_fixture(image):
    native = fixture(image)
    machines.append(native)
    return native


def raw_snapshot(native, slot):
    result = snapshot(native, slot)
    result["raw"] = list(native.emulator.mem_read(source["GAME"] + 0x7d28 + slot * 220, 220))
    return result


source["snapshot"] = raw_snapshot
source["source_fixture"] = capture_fixture
cases = [owner["receipt_case"](race) for race in (0, 1)]
print(json.dumps({"sha256": source["BASE"]["EXE_HASH"],
                  "rngTable": list(struct.unpack("<256i", machines[0].emulator.mem_read(0x478e04, 1024))),
                  "cases": cases}))