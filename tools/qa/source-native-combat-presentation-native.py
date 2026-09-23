"""Original fresh HUMAN02 VENT constructor capture; no resource visits."""

import json
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True
probe = runpy.run_path(str(Path(__file__).with_name("source-resource-options-native.py")))
construction = probe["CONSTRUCTION"]
snapshot = construction["snapshot"]


def capture(native, slot):
    result = snapshot(native, slot)
    address = probe["BASE"]["GAME"] + 0x7D28 + slot * 220
    result["raw220"] = list(native.emulator.mem_read(address, 220))
    result["standField"] = native.get(0x4F1880 + result["type"] * 280 + 0x80)
    return result


construction["snapshot"] = capture
mission = probe["mission_probe"]("HUMAN02")
print(json.dumps({"executableSha256": probe["BASE"]["EXE_HASH"],
                  "sourceEntry": "0x41b9ce..0x41c7ee", "resourceVisits": 0,
                  "mission": mission}))