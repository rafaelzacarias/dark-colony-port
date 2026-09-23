"""Bounded, hash-pinned original-x86 mission02 control-action goldens."""

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("mission_actions", Path(__file__).with_name("mission-actions.py"))
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_EDI, UC_X86_REG_EDX, UC_X86_REG_EIP,
    UC_X86_REG_ESI, UC_X86_REG_ESP,
)

TRIGGERS = 0x4FBC48
BYTECODE = 0x704000
STATISTICS = 0x4956E0
STATISTICS_SIZE = 0x3900


def word(machine, address):
    return struct.unpack("<I", machine.mem_read(address, 4))[0]


def instruction_probe():
    for address, expected, label in (
        (0x43E9D1, "66899850c44f00", "ai first literal word"),
        (0x43E9F5, "66899052c44f00", "ai second literal word"),
        (0x43D852, "899407bc0b0000", "ai persistent side dword"),
        (0x41BE32, "894724", "SCN initial AI store"),
        (0x41ABAD, "8b04856c934700", "AI implementation selector"),
        (0x44D6E0, "5589e531c05dc3", "mode four task weight returns zero"),
        (0x43F545, "66899050c44f00", "setarray index word"),
        (0x43F55F, "898254c44f00", "setarray compiled expression pointer"),
        (0x43DAD6, "e851f4ffff", "setarray calls native expression VM"),
        (0x41A495, "81fe20030000", "statistic index upper bound 800"),
        (0x41A529, "899060584900", "statistic dword assignment"),
        (0x43E808, "e8a3ee0200", "unconditional lives decimal conversion"),
        (0x43E878, "889050bc4f00", "initial lives byte store"),
        (0x43E515, "80b950bc4f0000", "zero lives scan gate"),
        (0x401779, "e8e2850100", "statistic reset caller"),
    ):
        actual = NATIVE.READ(address, len(bytes.fromhex(expected)))
        assert actual.hex() == expected, (hex(address), actual.hex(), expected)
        print(f"ANCHOR {address:#x} bytes={expected} {label}")


def return_from_hook(machine, result):
    stack = machine.reg_read(UC_X86_REG_ESP)
    machine.reg_write(UC_X86_REG_EAX, result)
    machine.reg_write(UC_X86_REG_EIP, word(machine, stack))
    machine.reg_write(UC_X86_REG_ESP, stack + 4)


def compile_source(content, faction):
    machine = NATIVE.machine_for_probe()
    lines = iter(content.splitlines(keepends=True))
    read_count = []

    def file_service(emulator, address, size, user_data):
        if address == 0x406288:
            return_from_hook(emulator, 1)
        elif address == 0x406338:
            line = next(lines, None)
            destination = emulator.reg_read(UC_X86_REG_EAX)
            if line is not None:
                assert len(line) < emulator.reg_read(UC_X86_REG_EDX)
                emulator.mem_write(destination, line + b"\0")
                read_count.append(line)
            return_from_hook(emulator, destination if line is not None else 0)
        elif address == 0x40636C:
            return_from_hook(emulator, 0)
        elif address in (0x46C996, 0x46CB3E):
            raise AssertionError(f"native parser diagnostic at {address:#x}")

    machine.hook_add(UC_HOOK_CODE, file_service)
    machine.mem_write(NATIVE.STACK, struct.pack("<I", 0x70D000))
    machine.mem_write(TRIGGERS, b"\xa5" * 0x800)
    machine.emu_start(0x43FB90, 0x70D000, count=2000000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x70D000
    assert b"".join(read_count) == content
    blocks = []
    for line in content.decode("ascii").splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0].isdigit():
            blocks.append((int(fields[0]), 0 if fields[2].startswith("(") else int(fields[2]), []))
        elif fields[0] != "end":
            blocks[-1][2].append(line)
    action_count = 0
    for trigger_id, lives, actions in blocks:
        record = TRIGGERS + trigger_id * 16
        assert word(machine, record) == 0
        assert machine.mem_read(record + 8, 1) == bytes((lives,))
        first = action_count
        action_count += len(actions)
        cursor = word(machine, record + 12)
        for index in range(action_count - 1, first - 1, -1):
            assert cursor == NATIVE.ACTION + index * 28
            cursor = word(machine, cursor + 24)
        assert cursor == 0
        if trigger_id in ((17, 18, 19) if faction == "HUMAN" else (0, 8, 11, 12)):
            print(f"COMPILED {faction}02 block={trigger_id} lives={lives} reverse_actions={list(reversed(actions))}")
    assert word(machine, 0x4FC448) == action_count
    present = {trigger_id for trigger_id, _, _ in blocks}
    for trigger_id in set(range(128)) - present:
        assert machine.mem_read(TRIGGERS + trigger_id * 16 + 4, 5) == b"\0" * 5
    print(f"PASS complete native {faction}02 compilation: {len(blocks)} blocks, {action_count} actions, every source byte consumed")


def dispatch(machine):
    visits = []

    def boundary(emulator, address, size, user_data):
        if address == 0x43D822:
            visits.append(address)
            if len(visits) == 2:
                emulator.emu_stop()

    hook = machine.hook_add(UC_HOOK_CODE, boundary)
    machine.reg_write(UC_X86_REG_ESI, NATIVE.ACTION)
    machine.reg_write(UC_X86_REG_EDI, NATIVE.GAME)
    machine.emu_start(0x43D822, 0, count=100000)
    machine.hook_del(hook)
    assert visits == [0x43D822, 0x43D822]
    assert machine.reg_read(UC_X86_REG_ESI) == 0x709000


def ai_probe():
    assert NATIVE.READ(0x476AB0, 3) == b"ai\0"
    assert NATIVE.READ(0x43D7BC, 4) == struct.pack("<I", 0x43D840)
    for source, team, value in (("1 3", 1, 3), ("2 3", 2, 3), ("0 0", 0, 0),
                                ("7 32767", 7, 32767), ("7 32768", 7, -32768),
                                ("65538 65539", 2, 3), ("2 -1", 2, -1)):
        machine = NATIVE.parse(0x43E989, source)
        expected_record = bytearray(b"\xa5" * 28)
        expected_record[0] = 0
        struct.pack_into("<HH", expected_record, 4, team, value & 0xFFFF)
        struct.pack_into("<I", expected_record, 24, 0x709000)
        assert machine.mem_read(NATIVE.ACTION, 28) == expected_record
        game = bytearray(b"\xa5" * 0x50000)
        machine.mem_write(NATIVE.GAME, bytes(game))
        statistics = bytes(machine.mem_read(0x4956E0, 0x3900))
        dispatch(machine)
        struct.pack_into("<i", game, 0xBBC + team * 0xE30, value)
        assert machine.mem_read(NATIVE.GAME, len(game)) == game
        assert machine.mem_read(0x4956E0, len(statistics)) == statistics
        print(f"AI {source!r} record={expected_record.hex()} team={team} signed_value={value}")
    for source, expected_words in (("-1 3", (65535, 3)), ("32768 3", (32768, 3)),
                                   ("2 (1+2)", (2, 0)), ("(1+1) 3", (0, 0))):
        machine = NATIVE.parse(0x43E989, source)
        assert machine.mem_read(NATIVE.ACTION + 4, 4) == struct.pack("<HH", *expected_words)
        if "(" in source:
            assert word(machine, NATIVE.FRAME - 0x30) == NATIVE.SOURCE + (1 if source.startswith("2 ") else 0)
        print(f"AI PARSE ONLY {source!r} words={expected_words}; no unsafe host dispatch")
    print("PASS ai: literal word parsing, signed dispatch, exact persistent side-state assignment")


def ai_host_probe():
    for team in (1, 2):
        machine = NATIVE.parse(0x43E989, f"{team} 3")
        machine.mem_write(NATIVE.FRAME - 0x47C, b"4\0")
        machine.reg_write(UC_X86_REG_EDI, NATIVE.GAME + 0xB98 + team * 0xE30)
        machine.emu_start(0x41BE27, 0x41BE35, count=10000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x41BE35
        assert word(machine, NATIVE.GAME + 0xBBC + team * 0xE30) == 4
        for expected_mode, expected_task in ((4, 0x47B33C), (3, 0x47B318)):
            machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
            machine.reg_write(UC_X86_REG_EDX, team)
            machine.emu_start(0x41AB20, 0x41ABCA, count=10000)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x41ABCA
            assert machine.reg_read(UC_X86_REG_EBX) == expected_task
            assert machine.reg_read(UC_X86_REG_EDX) == team
            assert machine.reg_read(UC_X86_REG_EAX) == NATIVE.GAME
            machine.reg_write(UC_X86_REG_EBP, NATIVE.FRAME)
            machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
            if expected_mode == 4:
                dispatch(machine)
        print(f"PASS AI HOST team={team}: native SCN scalar 4 -> action 3 -> task table 0x47b33c -> 0x47b318")


def evaluate(machine, code):
    machine.mem_write(0x706000, code)
    machine.mem_write(NATIVE.STACK, struct.pack("<I", 0x70D000))
    machine.reg_write(UC_X86_REG_ESP, NATIVE.STACK)
    machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
    machine.reg_write(UC_X86_REG_EDX, 0x706000)
    machine.reg_write(UC_X86_REG_EBX, 0xFFFFFFFF)
    machine.emu_start(0x43CF2C, 0x70D000, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x70D000
    return struct.unpack("<i", struct.pack("<I", machine.reg_read(UC_X86_REG_EAX)))[0]


def statistic_reset_probe():
    machine = NATIVE.machine_for_probe()
    machine.mem_write(STATISTICS, b"\xa5" * STATISTICS_SIZE)
    machine.mem_write(NATIVE.STACK, struct.pack("<I", 0x70D000))
    machine.emu_start(0x419D60, 0x70D000, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x70D000
    assert machine.mem_read(STATISTICS, STATISTICS_SIZE) == b"\0" * 0x3880 + b"\xa5" * 0x80
    assert evaluate(machine, bytes.fromhex("0700000702000700001116")) == 0
    print("PASS native statistic reset: exactly 0x3880 zero bytes; s(0,2,0) reads zero")


def parse_array(source):
    machine = NATIVE.machine_for_probe()
    machine.reg_write(UC_X86_REG_ESI, 0x709000)
    machine.mem_write(NATIVE.SOURCE, source.encode("ascii") + b"\0")
    machine.mem_write(NATIVE.FRAME - 0x30, struct.pack("<I", NATIVE.SOURCE))
    machine.mem_write(NATIVE.FRAME - 0x2C, struct.pack("<I", BYTECODE))
    machine.mem_write(NATIVE.ACTION, b"\xa5" * 28)
    machine.mem_write(NATIVE.GAME + 0x52C, struct.pack("<I", 16 * 900))
    machine.emu_start(0x43F500, 0x43E8B7, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x43E8B7
    end = word(machine, NATIVE.FRAME - 0x2C)
    code = bytes(machine.mem_read(BYTECODE, end - BYTECODE))
    return machine, code


def array_probe():
    assert NATIVE.READ(0x476B90, 9) == b"setarray\0"
    assert NATIVE.READ(0x43D7BC + 6 * 4, 4) == struct.pack("<I", 0x43DACC)
    for source, index, golden_code, results in (
        ("0 (c+45)", 0, "08072d000b16", ((0, 45), (16 * 100, 145), (16 * 32767, -32724), (0xFFFFFFF0, 44))),
        ("799 32768", 799, "07008016", ((0, -32768),)),
        ("65536 65535", 0, "07ffff16", ((0, -1),)),
        ("1 (s(0,2,0)+1)", 1, "070000070200070000110701000b16", ((0, 124),)),
    ):
        machine, code = parse_array(source)
        assert code.hex() == golden_code
        expected_record = bytearray(b"\xa5" * 28)
        expected_record[0] = 6
        struct.pack_into("<H", expected_record, 4, index)
        struct.pack_into("<I", expected_record, 8, BYTECODE)
        struct.pack_into("<I", expected_record, 24, 0x709000)
        assert machine.mem_read(NATIVE.ACTION, 28) == expected_record
        for counter, expected in results:
            machine.mem_write(NATIVE.GAME + 0x52C, struct.pack("<I", counter))
            game = bytes(machine.mem_read(NATIVE.GAME, 0x50000))
            statistics = bytearray(b"\xa5" * STATISTICS_SIZE)
            struct.pack_into("<i", statistics, 0x495868 - STATISTICS, 123)
            machine.mem_write(STATISTICS, bytes(statistics))
            dispatch(machine)
            struct.pack_into("<i", statistics, 0x495868 - STATISTICS + index * 16, expected)
            assert machine.mem_read(STATISTICS, STATISTICS_SIZE) == statistics
            assert machine.mem_read(NATIVE.GAME, len(game)) == game
            readback = b"\x07\0\0\x07\x02\0\x07" + struct.pack("<H", index) + b"\x11\x16"
            assert evaluate(machine, readback) == expected
            print(f"ARRAY {source!r} counter={counter} signed_dword={expected} code={code.hex()}")
    for index in (800, 65535):
        machine, _ = parse_array(f"{index} 1")
        game = bytes(machine.mem_read(NATIVE.GAME, 0x50000))
        statistics = bytes(machine.mem_read(STATISTICS, STATISTICS_SIZE))
        machine.reg_write(UC_X86_REG_ESI, NATIVE.ACTION)
        machine.reg_write(UC_X86_REG_EDI, NATIVE.GAME)
        machine.emu_start(0x43D822, 0x41A49D, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x41A49D
        assert machine.mem_read(NATIVE.GAME, len(game)) == game
        assert machine.mem_read(STATISTICS, STATISTICS_SIZE) == statistics
        print(f"PASS ARRAY invalid index={index}: diagnostic before any host write")
    print("PASS setarray: native literal/expression parser, dispatch-time signed-word evaluation, exact statistic assignment")


def header_probe():
    records = []
    for token, expected in (("", 0), ("0 ", 0), ("1 ", 1), ("256 ", 0)):
        machine = NATIVE.machine_for_probe()
        source = f"8 norm {token}(s(1,0,86)>2)"
        machine.mem_write(NATIVE.FRAME - 0x430, source.encode("ascii") + b"\0")
        machine.mem_write(NATIVE.FRAME - 8, struct.pack("<I", BYTECODE))
        machine.mem_write(TRIGGERS, b"\xa5" * 0x800)
        machine.emu_start(0x43E67B, 0x43E8B7, count=100000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x43E8B7
        record = bytes(machine.mem_read(TRIGGERS + 8 * 16, 16))
        assert record == struct.pack("<II", 0, BYTECODE) + bytes((expected,)) + b"\xa5" * 7, record.hex()
        end = word(machine, NATIVE.FRAME - 0x2C)
        code = bytes(machine.mem_read(BYTECODE, end - BYTECODE))
        assert code.hex() == "070100070000075600110702000616"
        records.append(code)
        print(f"HEADER {source!r} record={record.hex()} code={code.hex()}")
    assert len(set(records)) == 1
    machine = NATIVE.machine_for_probe()
    machine.mem_write(TRIGGERS, b"\0" * 0x800)
    machine.mem_write(TRIGGERS + 8 * 16 + 4, struct.pack("<I", BYTECODE))
    machine.mem_write(BYTECODE, records[0])
    machine.mem_write(0x495860 + 86 * 16, struct.pack("<I", 3))
    calls = []

    def unexpected_dispatch(emulator, address, size, user_data):
        if address in (0x43CF2C, 0x43D814):
            calls.append(address)

    machine.hook_add(UC_HOOK_CODE, unexpected_dispatch)
    machine.mem_write(NATIVE.STACK, struct.pack("<I", 0x70D000))
    machine.reg_write(UC_X86_REG_EAX, NATIVE.GAME)
    machine.emu_start(0x43E4D0, 0x70D000, count=100000)
    assert machine.reg_read(UC_X86_REG_EIP) == 0x70D000
    assert calls == []
    print("PASS omitted lives: native decimal conversion yields zero; condition is preserved")
    print("PASS native normal scan: zero lives skips even condition evaluation")


def source_probe():
    for faction, digest, count in (
        ("HUMAN", "0e5a6593768b4fff717be69609d8ed5eb2aea48d1bab68c30c8d5d621d7e080d", 20),
        ("ALIEN", "b219fa5bf2b13ba122271295679d488bb70077556dae20dfa76b00aa9968f50e", 12),
    ):
        source = NATIVE.ROOT / f"raw_cd/DC/SCENARIO/{faction}/{faction}02.TRO"
        content = source.read_bytes()
        assert hashlib.sha256(content).hexdigest() == digest
        assert sum(line.strip() == b"end" for line in content.splitlines()) == count
        print(f"SOURCE {source.relative_to(NATIVE.ROOT)} sha256={digest} blocks={count}")
        offset = 0
        for line_number, line in enumerate(content.splitlines(keepends=True), 1):
            if line.startswith((b"ai ", b"setarray ")) or (faction == "ALIEN" and line.startswith(b"8 norm ")):
                raw = line.rstrip(b"\r\n")
                print(f"RANGE {faction}02.TRO line={line_number} bytes=[{offset},{offset + len(raw)}) hex={raw.hex()}")
            offset += len(line)
        scenario = source.with_suffix(".SCN").read_bytes()
        scenario_digest = hashlib.sha256(scenario).hexdigest()
        assert scenario_digest == {
            "HUMAN": "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab",
            "ALIEN": "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e",
        }[faction]
        rows = [line.strip() for line in scenario.decode("ascii").splitlines() if line.strip() and not line.startswith("%")]
        modes = [int(rows[index + 3]) for index, line in enumerate(rows) if line.startswith("TEAM ")]
        assert modes == ([0, 0, 4, 3, 3, 0, 0, 0] if faction == "HUMAN" else [0, 4, 4, 0, 0, 0, 0, 0])
        print(f"SCN {faction}02 sha256={scenario_digest} team_ai={modes}")
        compile_source(content, faction)


def preflight_probe():
    spec = importlib.util.spec_from_file_location("mission02_audit", Path(__file__).with_name("mission02-audit-20260919.py"))
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    print("PREFLIGHT " + json.dumps(audit.preflight()))
    print("PASS complete-source preflight goldens: both missions remain rejected; no runtime integration claimed")


if __name__ == "__main__":
    print(f"EXE SHA256 {NATIVE.AUDIT.DIGEST}")
    instruction_probe()
    source_probe()
    header_probe()
    ai_probe()
    ai_host_probe()
    statistic_reset_probe()
    array_probe()
    preflight_probe()