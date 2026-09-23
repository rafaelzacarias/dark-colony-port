import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("source_task", Path(__file__).with_name("source-native-task-options-native.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
original = source.AI.invoke
initial = None
initializers = []


def observe(machine, address, **arguments):
    global initial
    if address == 0x419D60:
        machine.mem_write(0x4956E0, b"\xa5" * 384)
        machine.mem_write(0x495860, b"\xa5" * 0x3700)
        result = original(machine, address, **arguments)
        assert machine.mem_read(0x4956E0, 384) == bytes(384)
        assert machine.mem_read(0x495860, 0x3700) == bytes(0x3700)
        initializers.append({"entry": "0x419d60", "poisonedClearBytes": [384, 0x3700]})
        return result
    if address == 0x41B750 and initial is None:
        initial = {
            "registry": list(struct.unpack("<800h", machine.mem_read(source.GAME + 0x468EC, 1600))),
            "statistics": list(struct.unpack("<96i", machine.mem_read(0x4956E0, 384))),
            "typeStatistics": list(struct.unpack("<4400i", machine.mem_read(0x495860, 17600))),
            "commanderSlots": [struct.unpack("<h", machine.mem_read(source.GAME + 0x1934 + team * 0xE30, 2))[0]
                               for team in range(8)],
        }
    return original(machine, address, **arguments)


source.AI.invoke = observe
captured = source.capture("HUMAN02")
print(json.dumps({"binarySha256": captured["binarySha256"], "sourceProof": captured["sourceProof"],
                  "initializers": initializers, "actors": captured["actors"], "initial": initial}), flush=True)