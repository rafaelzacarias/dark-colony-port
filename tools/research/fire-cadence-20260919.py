"""Bounded, hash-gated native fire cadence evidence; Capstone 5 / Unicorn 2."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
    UC_X86_REG_EDX, UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
)

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "fire_combat_evidence", Path(__file__).with_name("combat-callers-20260919.py"))
COMBAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMBAT)
NATIVE = COMBAT.NATIVE
put, get = COMBAT.put, COMBAT.get
GAME, TYPES, FRAME, STACK = NATIVE.GAME, NATIVE.TYPES, NATIVE.FRAME, NATIVE.STACK


def disassemble(start, end):
    return [f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}"
            for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(
                NATIVE.READ(start, end - start), start)]


def delay_probe():
    results = []
    for rate, count, delay, counter in ((15, -1, -1, 0), (10, 3, 30, 0),
                                      (10, 3, 30, 1), (10, 3, 30, 2)):
        machine = NATIVE.fixture()
        weapon, entity = 0x702000, 0x703000
        for offset, value in ((8, rate), (32, count), (36, delay)):
            put(machine, weapon + offset, value)
        machine.mem_write(entity + 0x34, bytes((counter,)))
        machine.reg_write(UC_X86_REG_EDI, weapon)
        machine.reg_write(UC_X86_REG_ESI, entity)
        NATIVE.run_slice(machine, 0x413181, 0x4131A3)
        actual = [machine.reg_read(UC_X86_REG_EBX), machine.mem_read(entity + 0x34, 1)[0]]
        expected = [rate, counter] if count <= 0 else (
            [delay, 0] if counter + 1 >= count else [rate, counter + 1])
        assert actual == expected, (actual, expected)
        results.append({"input": [rate, count, delay, counter], "delayAndCounter": actual})
    return results


def word(machine, address):
    return struct.unpack("<H", machine.mem_read(address, 2))[0]


def invoke(machine, entry, argument=GAME, slot=200, third=0, fourth=0):
    for register, value in ((UC_X86_REG_EDX, slot), (UC_X86_REG_EBX, third),
                            (UC_X86_REG_ECX, fourth)):
        machine.reg_write(register, value)
    return NATIVE.invoke(machine, entry, argument)


def fin_fixture(machine, name):
    source = ROOT / "raw_cd/DC/ANIMATE" / (name + ".FIN")
    data = source.read_bytes()
    tag, timeline_count, state_count, sprite_count = struct.unpack_from("<4H", data)
    assert tag == 29
    state_start = 8 + sprite_count * 8
    timeline_start = state_start + state_count * 20
    groups = {"STAND": 0x710000, "FIREA": 0x710100, "FIREB": 0x710200}
    machine.mem_map(0x710000, 0x20000)
    states, cursor = [], 0x711000
    for index in range(state_count):
        offset = state_start + index * 20
        label = data[offset:offset + 16].split(b"\0", 1)[0].decode("ascii")
        for group, pointers in groups.items():
            prefix = name + group
            if not label.startswith(prefix):
                continue
            direction = int(label[len(prefix):])
            first, last = struct.unpack_from("<2H", data, offset + 16)
            assert 0 <= first <= last < timeline_count
            state, frames = cursor, cursor + 0x40
            cursor += 0x1000
            put(machine, pointers + ((12 - direction) & 15) * 4, state)
            put(machine, state + 0x20, frames)
            put(machine, state + 0x24, frames + (last - first) * 72)
            put(machine, state + 0x28, last - first + 1)
            durations = []
            for local, timeline in enumerate(range(first, last + 1)):
                disk = timeline_start + timeline * 164
                frame = frames + local * 72
                children, duration = struct.unpack_from("<2H", data, disk)
                machine.mem_write(frame, struct.pack("<2H", children, duration))
                machine.reg_write(UC_X86_REG_EBP, FRAME)
                machine.reg_write(UC_X86_REG_EDI, 0)
                machine.reg_write(UC_X86_REG_EAX, frame)
                put(machine, FRAME + 0x62, frame)
                NATIVE.run_slice(machine, 0x425B21, 0x425B6F)
                durations.append(word(machine, frame + 2))
                marker = disk + 4 + 7 * 20
                marker_name = data[marker:marker + 16].split(b"\0", 1)[0]
                assert marker_name in (b"", b"NONAME"), (label, timeline, marker_name)
                assert data[marker + 16:marker + 20] == bytes(4)
            states.append({"name": label, "range": [first, last],
                           "durations": durations, "slot7Markers": 0})
    for pointers in groups.values():
        machine.mem_write(FRAME - 0x94, bytes(machine.mem_read(pointers, 64)))
        put(machine, FRAME - 0xC, pointers)
        machine.reg_write(UC_X86_REG_EBP, FRAME)
        NATIVE.run_slice(machine, 0x42623E, 0x426303)
        assert all(struct.unpack("<32I", machine.mem_read(pointers, 128)))
    return groups, {"source": str(source.relative_to(ROOT)),
                    "sha256": hashlib.sha256(data).hexdigest(), "states": states}


def launch_fixture(type_id=0):
    machine = COMBAT.combat_tables()
    source = GAME + 0x7D28 + 200 * 220
    target = GAME + 0x7D28 + 201 * 220
    name = COMBAT.source_rows("GAMESTAT.TXT")[type_id + 1][0]
    groups, evidence = fin_fixture(machine, name)
    record = TYPES + type_id * 280
    put(machine, record + 0x80, groups["STAND"])
    put(machine, record + 0xA0, groups["FIREA"])
    put(machine, record + 0xA4, groups["FIREB"])
    put(machine, record + 0xE4, 2)
    machine.mem_write(source, struct.pack("<3H", 0x1080, 0, 0x1080))
    machine.mem_write(target, struct.pack("<3H", 0x1280, 0, 0x1080))
    machine.mem_write(source + 6, bytes((type_id, 0)))
    machine.mem_write(target + 6, bytes((8, 1)))
    machine.mem_write(source + 0x2C, b"\x01")
    machine.mem_write(target + 0x2C, b"\x01")
    machine.mem_write(source + 0x38, b"\xff")
    machine.mem_write(GAME + 0x468E8, b"\xff" * 4)
    put(machine, GAME + 0x544, NATIVE.UI)
    events = []

    def observe(emulator, address, size, user_data):
        if address == 0x431DA8:
            NATIVE.return_from_call(emulator, 8)
        elif address in (0x441710, 0x4121D8):
            events.append(hex(address))

    machine.hook_add(UC_HOOK_CODE, observe)
    direction = invoke(machine, 0x4121A0, source, 0x1280, 0x1080)
    machine.mem_write(source + 9, bytes((direction,)))
    for offset in (0x14, 0x1C, 0x24):
        invoke(machine, 0x42630C, source + offset, groups["STAND"])
    return machine, source, target, record, direction, events, evidence


def launch_probe(type_id=0):
    machine, source, target, record, direction, events, evidence = launch_fixture(type_id)
    invoke(machine, 0x41481C, GAME, 200, 201, source)
    assert events == ["0x441710", "0x4121d8"], events
    projectile = GAME + 0x32CA8
    assert word(machine, projectile + 0x1C) == 1
    weapon_id = get(machine, record + 0x18)
    delay = get(machine, 0x4F0200 + weapon_id * 72 + 8)
    assert weapon_id == (1 if type_id == 0 else 15 if type_id == 8 else 5 if type_id <= 72 else 62)
    assert delay == 15
    assert struct.unpack("<2i", machine.mem_read(0x4F0200 + weapon_id * 72 + 32, 8)) == (-1, -1)
    assert word(machine, source + 0x46) == delay
    assert machine.mem_read(source + 0x39, 1) == b"\x0b"
    trace = []
    for update in range(delay + 2):
        trace.append({"update": update, "remaining": word(machine, source + 0x46),
                      "taskTop": machine.mem_read(source + 0x38, 1)[0],
                      "fin": list(machine.mem_read(source + 0x18, 3))})
        if update <= delay:
            invoke(machine, 0x4264C8, source + 0x14, ((direction + 8) & 255) // 16 * 2)
            invoke(machine, 0x4121F8, GAME, 200, source + 0x46)
    assert trace[-2]["taskTop"] == 0 and trace[-1]["taskTop"] == 255
    return {"type": type_id, "weapon": weapon_id, "events": events,
            "projectileStatus": word(machine, projectile + 0x1C),
            "reload": trace, "fin": evidence}


def continuous_probe(type_id=0, case="continuous"):
    machine, source, target, record, direction, events, evidence = launch_fixture(type_id)
    branches = struct.unpack("<5I", NATIVE.READ(0x4157D8, 20))
    mode = branches.index(0x4159DA)
    payload = invoke(machine, 0x411DD8, GAME, 200, 6, 8)
    machine.mem_write(payload, struct.pack("<8h", 0, 0, 16, 16, mode, -1, -1, 0))
    machine.mem_write(source + 0x32, struct.pack("<h", 201))
    replacement = GAME + 0x7D28 + 202 * 220
    machine.mem_write(replacement, bytes(machine.mem_read(target, 220)))
    launches, trace = [], []
    for update in range(18 if case in ("pending-interruption", "target-gone") else 52):
        if update == 5:
            if case == "pending-interruption":
                machine.mem_write(source + 0x36, bytes((1, 1)))
            elif case == "target-gone":
                machine.mem_write(target + 0x2C, b"\0")
            elif case == "retarget-field":
                machine.mem_write(source + 0x32, struct.pack("<h", 202))
        before = get(machine, GAME + 0x7D24)
        put(machine, 0x478E00, 0)
        put(machine, GAME + 0x530, update + 1)
        if case == "pending-interruption" and update == 17:
            machine.mem_write(STACK, struct.pack("<I", NATIVE.STOP))
            for register, value in ((UC_X86_REG_ESP, STACK), (UC_X86_REG_EAX, GAME),
                                    (UC_X86_REG_EDX, 200)):
                machine.reg_write(register, value)
            NATIVE.run_slice(machine, 0x419248, 0x435C14)
        else:
            invoke(machine, 0x419248, GAME, 200)
        after = get(machine, GAME + 0x7D24)
        if after > before:
            launches.append(update)
        top = machine.mem_read(source + 0x38, 1)[0]
        kind = machine.mem_read(source + 0x39 + top * 2, 1)[0]
        trace.append({"update": update, "shots": after - before, "task": kind,
                      "remaining": word(machine, payload + 16) if kind == 11 else None,
                      "target": word(machine, source + 0x32),
                      "pending": machine.mem_read(source + 0x36, 1)[0],
                      "mode": word(machine, payload + 8),
                      "fin": list(machine.mem_read(source + 0x18, 3))})
    expected = [0] if case in ("pending-interruption", "target-gone") else [0, 17, 34, 51]
    assert launches == expected, launches
    if case == "pending-interruption":
        assert trace[16]["pending"] == 1 and trace[17]["pending"] == 0
        assert trace[17]["task"] == 1
    if case == "target-gone":
        assert trace[16]["mode"] == mode and trace[17]["mode"] == 1
    if case == "retarget-field":
        assert trace[17]["target"] == 202
    return {"type": type_id, "case": case, "launchUpdates": launches, "trace": trace,
            "boundary": "target acquisition not executed" if case in
            ("pending-interruption", "target-gone") else "installed in-range target task"}


def clock_probe():
    machine = NATIVE.fixture()
    machine.reg_write(UC_X86_REG_ESI, GAME)
    NATIVE.run_slice(machine, 0x41BA2C, 0x41BA36)
    assert get(machine, GAME + 0x970) == 66
    machine.mem_write(GAME + 0x468E8, b"\xff" * 4)
    calls = []

    def observe(emulator, address, size, user_data):
        if address == 0x4423F8:
            calls.append(address)

    machine.hook_add(UC_HOOK_CODE, observe)
    invoke(machine, 0x44293C)
    assert len(calls) == 4
    return {"initialUpdateIntervalMs": 66, "projectilePassesPerUpdate": len(calls)}


def alignment_probe():
    results = []
    for type_id in (0, 8):
        machine, source, target, record, direction, events, evidence = launch_fixture(type_id)
        machine.mem_write(source + 9, bytes(((direction + 20) & 255,)))
        invoke(machine, 0x41481C, GAME, 200, 201, source)
        assert not events and get(machine, GAME + 0x7D24) == 0
        assert machine.mem_read(source + 9, 1)[0] == (direction + 10) & 255
        invoke(machine, 0x41481C, GAME, 200, 201, source)
        assert events == ["0x441710", "0x4121d8"]
        results.append({"type": type_id, "initialAngularDifference": 20,
                        "launchInvocation": 1, "turnPerInvocation": 10})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--full", action="store_true", help="Include complete per-update and FIN traces")
    args = parser.parse_args()
    if args.disassemble:
        print("\n".join(disassemble(*args.disassemble)))
        return
    roster = (0, 8, *range(69, 77))
    launches = [launch_probe(type_id) for type_id in roster]
    sequences = [continuous_probe(type_id, case) for type_id in roster
                 for case in ("continuous", "pending-interruption", "retarget-field", "target-gone")]
    if not args.full:
        launches = [{key: value for key, value in result.items() if key not in ("reload", "fin")}
                    for result in launches]
        sequences = [{key: value for key, value in result.items() if key != "trace"}
                     for result in sequences]
    print(json.dumps({"executableSha256": NATIVE.AUDIT.DIGEST,
                      "sourceSha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in [ROOT / "raw_cd/DC/GAMESTAT" / name for name in
                                       ("GAMESTAT.TXT", "WEAPSTAT.TXT")]
                          + [ROOT / "raw_cd/DC/ANIMATE" / (name + ".FIN") for name in ("TRSC", "GRAY")]},
                      "clock": clock_probe(), "delaySelection": delay_probe(),
                      "alignment": alignment_probe(),
                      "launch": launches, "sequences": sequences,
                      "decision": "bounded installed-task reducer; command intake and acquisition require host handoff"}, indent=2))


if __name__ == "__main__":
    main()