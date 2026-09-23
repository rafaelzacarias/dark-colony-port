"""Direct original 43d840 setter evidence; no AI policy execution."""

import importlib.util
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("policy", Path(__file__).parents[1] / "research/ai-policy-20260919.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
native = policy.NATIVE

instructions = [{"address": hex(instruction.address), "instruction": instruction.mnemonic + " " + instruction.op_str}
                for instruction in policy.Cs(policy.CS_ARCH_X86, policy.CS_MODE_32).disasm(native.READ(0x43D840, 64), 0x43D840)]
cases = []
for team in range(8):
    for mode in (-32768, -1, 0, 1, 2, 3, 4, 5, 32767):
        machine = native.machine_for_probe()
        before = [0x12340000 + index for index in range(8)]
        for index, value in enumerate(before):
            policy.put(machine, native.GAME + 0xBBC + index * 0xE30, value)
        before_game = bytes(machine.mem_read(native.GAME, 0x50000))
        before_statistics = bytes(machine.mem_read(0x4956E0, 0x3900))
        before_rng = policy.dword(machine, 0x479204)
        machine.mem_write(native.ACTION + 4, struct.pack("<hh", team, mode))
        machine.reg_write(policy.UC_X86_REG_ESI, native.ACTION)
        machine.reg_write(policy.UC_X86_REG_EDI, native.GAME)
        machine.emu_start(0x43D840, 0x43D822, count=100)
        assert machine.reg_read(policy.UC_X86_REG_EIP) == 0x43D822
        after = [policy.dword(machine, native.GAME + 0xBBC + index * 0xE30) for index in range(8)]
        expected_game = bytearray(before_game)
        struct.pack_into("<i", expected_game, 0xBBC + team * 0xE30, mode)
        assert machine.mem_read(native.GAME, 0x50000) == expected_game
        assert machine.mem_read(0x4956E0, 0x3900) == before_statistics
        assert policy.dword(machine, 0x479204) == before_rng
        cases.append({"team": team, "mode": mode, "before": before, "after": after,
                      "onlySelectorDwordChanged": True, "statisticsUnchanged": True, "rngUnchanged": True})

parsing = []
for text in ("2 -1", "7 32768", "65538 65539", "2 (1+2)", "(1+1) 3"):
    machine = native.parse(0x43E989, text)
    parsing.append({"text": text, "words": list(struct.unpack("<hh", machine.mem_read(native.ACTION + 4, 4)))})

scenarios = []
for faction in ("HUMAN", "ALIEN"):
    source = (native.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.SCN").read_bytes()
    lines = [line.strip() for line in source.decode("ascii").splitlines()]
    values = [int(lines[index - 1]) for index, line in enumerate(lines) if line == "%AI"]
    assert len(values) == 8
    machine = native.machine_for_probe()
    initialized = []
    for team, mode in enumerate(values):
        policy.put(machine, native.GAME + 0xBBC + team * 0xE30, 0xA5A5A5A5)
        machine.mem_write(native.FRAME - 0x47C, str(mode).encode("ascii") + b"\0")
        machine.reg_write(policy.UC_X86_REG_EDI, native.GAME + 0xB98 + team * 0xE30)
        machine.emu_start(0x41BE27, 0x41BE35, count=10000)
        assert machine.reg_read(policy.UC_X86_REG_EIP) == 0x41BE35
        initialized.append(struct.unpack("<i", machine.mem_read(native.GAME + 0xBBC + team * 0xE30, 4))[0])
    assert initialized == values
    scenarios.append({"mission": faction + "02", "sourceSha256": policy.hashlib.sha256(source).hexdigest(),
                      "entry": "0x41be27..0x41be35", "initialModes": initialized})

callback_proof = StringIO()
with redirect_stdout(callback_proof):
    policy.selector_probe()
print(json.dumps({"entry": "0x43d840", "sourceSha256": policy.hashlib.sha256(native.IMAGE).hexdigest(),
                  "instructions": instructions, "cases": cases, "parsing": parsing, "scenarios": scenarios,
                  "callbackProof": callback_proof.getvalue().splitlines()}))