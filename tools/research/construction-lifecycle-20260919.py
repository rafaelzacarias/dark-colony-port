"""Fail-closed, source-backed native construction lifecycle research."""

import argparse
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
    UC_X86_REG_EBP, UC_X86_REG_EDI, UC_X86_REG_ESI, UC_X86_REG_EIP, UC_X86_REG_ESP,
)


ROOT = Path(__file__).resolve().parents[2]
BASE = runpy.run_path(str(Path(__file__).with_name("production-audit-20260919.py")))
SOURCE = runpy.run_path(str(Path(__file__).with_name("inspire-audit-20260919.py")))
GAME = BASE["GAME"]
TYPES = 0x4F1880
HEAP = 0x1000000


class UnresolvedTransition(RuntimeError):
    pass


@lru_cache(maxsize=1)
def parsed_source(image):
    parsed = SOURCE["parsed_fixture"]()
    source, dependencies, tables = BASE["source_probe"](image)
    for dependency, race in ((2, 0), (16, 1)):
        assert any(row["id"] == dependency and row["kind"] == 0 and row["metadata"] == [0, 3, 0, race]
                   for row in source["dependencies"]), "source science building is not constructible"
    return bytes(parsed.mem_read(TYPES, 106 * 280)), dependencies, tables


def source_fixture(image):
    native = BASE["Native"](image)
    types, dependencies, _ = parsed_source(image)
    native.emulator.mem_write(TYPES, types)
    native.emulator.mem_write(0x4E6D70, dependencies)
    return native


def cstring(native, address):
    result = bytearray()
    for offset in range(256):
        value = native.get(address + offset, 1)
        if not value:
            return result.decode("ascii")
        result.append(value)
    raise UnresolvedTransition(f"unterminated string at {address:#x}")


def load_fin(native, unit_types, attack=False):
    native.emulator.mem_map(HEAP, 0x1000000)
    cursor = HEAP
    registry = {}
    state_sources = {}
    profiles = []
    events = []
    def concatenate(machine):
        destination = machine.emulator.reg_read(UC_X86_REG_EAX)
        source = machine.emulator.reg_read(UC_X86_REG_EDX)
        count = machine.emulator.reg_read(UC_X86_REG_EBX)
        text = cstring(machine, destination) + cstring(machine, source)[:count]
        machine.emulator.mem_write(destination, text.encode("ascii") + b"\0")

    def format_string(machine):
        stack = machine.emulator.reg_read(UC_X86_REG_ESP)
        destination = machine.get(stack + 4)
        template = cstring(machine, machine.get(stack + 8))
        first = cstring(machine, machine.get(stack + 12))
        second = machine.get(stack + 16)
        if template == "%s%s":
            text = first + cstring(machine, second)
        elif template == "%s%d":
            text = first + str(second)
        else:
            raise UnresolvedTransition(f"unhandled native formatting template {template!r}")
        machine.emulator.mem_write(destination, text.encode("ascii") + b"\0")
        machine.emulator.reg_write(UC_X86_REG_EAX, len(text))

    native.stubs.update({0x46D51A: concatenate, 0x46CB74: format_string})
    rows = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/GAMESTAT.TXT").read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("%")][1:]
    sources = []
    for filename in (ROOT / "raw_cd/DC/ANIM.DAT").read_text().splitlines():
        path = ROOT / "raw_cd/DC/ANIMATE" / filename.strip().upper()
        data = path.read_bytes()
        if len(data) < 8 or struct.unpack_from("<H", data)[0] != 29:
            continue
        _, _, state_count, sprite_count = struct.unpack_from("<4H", data)
        names = [data[8 + sprite_count * 8 + index * 20:24 + sprite_count * 8 + index * 20]
                 .split(b"\0", 1)[0].decode("ascii") for index in range(state_count)]
        sources.append((path, data, names))
    stems = [rows[unit_type][0].upper() for unit_type in unit_types]
    if attack:
        stems.append("WEAPONS")
    for path, data, names in sources:
        if not any(name.upper().startswith(stem) for name in names for stem in stems):
            continue
        tag, timeline_count, state_count, sprite_count = struct.unpack_from("<4H", data)
        assert tag == 29
        states_offset = 8 + sprite_count * 8
        timeline_offset = states_offset + state_count * 20
        children_offset = timeline_offset + timeline_count * 164
        assert children_offset <= len(data) and (len(data) - children_offset) % 22 == 0
        frames = cursor
        cursor += timeline_count * 72
        delays = []
        child_count = 0
        for index in range(timeline_count):
            count, field = struct.unpack_from("<HH", data, timeline_offset + index * 164)
            child_count += count
            record = frames + index * 72
            native.put(record, count, 2)
            native.put(record + 2, field, 2)
            if attack:
                for event_index in range(8):
                    event_offset = timeline_offset + index * 164 + 4 + event_index * 20
                    event_name = data[event_offset:event_offset + 16].split(b"\0", 1)[0].decode("ascii")
                    horizontal, vertical = struct.unpack_from("<hh", data, event_offset + 16)
                    events.append((record + 8 + event_index * 8, event_name, horizontal, vertical))
            native.put(0x70E062, frames)
            native.run(0x425B21, {UC_X86_REG_EAX: record, UC_X86_REG_EDI: index,
                                  UC_X86_REG_EBP: 0x70E000}, 0x425B6F)
            delays.append(native.get(record + 2, 1))
        assert child_count <= (len(data) - children_offset) // 22
        states = []
        for index in range(state_count):
            offset = states_offset + index * 20
            name = data[offset:offset + 16].split(b"\0", 1)[0].decode("ascii")
            first, last = struct.unpack_from("<HH", data, offset + 16)
            if not first <= last < timeline_count:
                if any(name.upper().startswith(stem) for stem in stems):
                    raise UnresolvedTransition(f"invalid source range for {name}: {first}..{last}")
                continue
            descriptor = cursor
            cursor += 48
            native.put(descriptor + 0x20, frames + first * 72)
            native.put(descriptor + 0x24, frames + last * 72)
            native.put(descriptor + 0x28, last - first + 1)
            registry[name.upper()] = descriptor
            state_sources[descriptor] = {"name": name, "source": str(path.relative_to(ROOT)),
                                         "first": first, "last": last, "delays": delays[first:last + 1],
                                         "sourceField2": [struct.unpack_from("<H", data, timeline_offset + frame * 164 + 2)[0]
                                                          for frame in range(first, last + 1)]}
            if any(name.upper().startswith(stem) for stem in stems):
                states.append(state_sources[descriptor])
        profiles.append({"source": str(path.relative_to(ROOT)),
                         "sha256": hashlib.sha256(data).hexdigest(), "states": states})

    def lookup(machine):
        name = cstring(machine, machine.emulator.reg_read(UC_X86_REG_EAX))
        suffix = cstring(machine, machine.emulator.reg_read(UC_X86_REG_EDX))
        machine.emulator.reg_write(UC_X86_REG_EAX, registry.get((name + suffix).upper(), 0))

    native.stubs[0x4254D4] = lookup
    if attack:
        suffix = cstring(native, 0x474BBC)
        all_names = {name.upper() for _, _, names in sources for name in names}
        for address, name, horizontal, vertical in events:
            key = (name + suffix).upper()
            descriptor = registry.get(key, 0)
            if key in all_names and not descriptor:
                raise UnresolvedTransition(f"unloaded FIN event dependency {key}")
            native.put(address, descriptor)
            native.put(address + 4, horizontal, 2)
            native.put(address + 6, vertical, 2)
    bindings = []
    native.animation_sources = {}
    for unit_type in unit_types:
        stem = rows[unit_type][0]
        native.emulator.mem_write(0x70D000, stem.encode("ascii") + b"\0")
        native.run(0x4265E0, {UC_X86_REG_EAX: 0x70D000, UC_X86_REG_EDX: 0x4767E8})
        bank = native.emulator.reg_read(UC_X86_REG_EAX)
        native.put(TYPES + unit_type * 280 + 0x80, bank)
        native.run(0x4260A8, {UC_X86_REG_EAX: bank, UC_X86_REG_EDX: 0x70D000,
                              UC_X86_REG_EBX: 0x4767E8})
        native.emulator.mem_write(0x70D800 - 0x178, stem.encode("ascii") + b"\0")
        native.put(0x70D800 - 4, TYPES + unit_type * 280)
        if attack:
            native.run(0x43B970, {UC_X86_REG_EAX: TYPES + unit_type * 280, UC_X86_REG_EDX: 0x70D000})
        native.run(0x43C18C, {UC_X86_REG_EBP: 0x70D800}, 0x43C217)
        construction = native.get(TYPES + unit_type * 280 + 0x98)
        native.run(0x43BF46, {UC_X86_REG_EBP: 0x70D800}, 0x43C099)
        for offset in (0x80, 0x98, 0xA0, 0xA4, 0xA8, 0xAC, 0xB0, 0xB4):
            selected = native.get(TYPES + unit_type * 280 + offset)
            if selected:
                native.animation_sources[selected] = state_sources[native.get(selected)]
        bindings.append({"unitType": unit_type, "stem": stem, "standBank": bank,
                         "constructionBank": construction,
                 "deathVariants": native.get(TYPES + unit_type * 280 + 0xE8),
                         "standState": state_sources[native.get(bank)],
                         "constructionState": state_sources[native.get(construction)] if construction else None})
    return {"sources": profiles, "bindings": bindings}


def animation_comparison(native, binding):
    bank = binding["constructionBank"]
    delays = binding["constructionState"]["delays"]
    results = []
    for seed_first_delay in (False, True):
        native.emulator.mem_write(0x703000, bytes(8))
        native.run(0x42630C, {UC_X86_REG_EAX: 0x703000, UC_X86_REG_EDX: bank, UC_X86_REG_EBX: 1})
        if seed_first_delay:
            native.put(0x703005, delays[0], 1)
        updates = 0
        while native.get(0x703006, 1) != 2:
            updates += 1
            assert updates < 4096
            native.run(0x4264C8, {UC_X86_REG_EAX: 0x703000, UC_X86_REG_EDX: 0})
        expected = sum(delays if seed_first_delay else delays[1:]) + 1
        assert updates == expected, (updates, expected)
        results.append({"seedFirstDelay": seed_first_delay, "initialDelay": delays[0] if seed_first_delay else 0,
                        "updates": updates, "sumDelaysPlusOne": sum(delays) + 1})
    return results


def snapshot(native, native_id):
    entity = GAME + 0x7D28 + native_id * 220
    depth = native.get(entity + 0x38, 1)
    depth = depth if depth < 128 else depth - 256
    task = native.get(entity + 0x39 + depth * 2, 1)
    auxiliary = entity + 0x46 + native.get(entity + 0x3A + depth * 2, 1) * 2
    bank = native.get(entity + 0x14)
    frame = native.get(entity + 0x18, 1)
    profile = native.animation_sources.get(bank)
    return {"id": native_id, "type": native.get(entity + 6, 1),
            "team": native.get(entity + 7, 1),
            "activeSlot": native.get(GAME + 0x468EC + native_id * 2, 2),
            "status": native.get(entity + 0x2C, 1), "hp": native.get(entity + 0xC),
            "pendingOrder": native.get(entity + 0x36, 1), "order": native.get(entity + 0x37, 1),
            "taskDepth": depth, "task": task,
            "phase": native.get(auxiliary + (2 if task == 20 else 0), 2) if task in (19, 20) else None,
            "movementCounter": native.get(auxiliary + 8, 2) if task == 22 else None,
            "taskWords": [native.get(auxiliary + offset * 2, 2) for offset in range(6)],
            "animation": {"bank": bank, "frame": frame,
                          "delay": native.get(entity + 0x19, 1), "mode": native.get(entity + 0x1A, 1),
                          "source": profile["source"] if profile else None,
                          "state": profile["name"] if profile else None,
                          "sourceTimeline": profile["first"] + frame if profile else None,
                          "sourceDelay": profile["delays"][frame] if profile and frame < len(profile["delays"]) else None}}


def populate_footprint(native, team, slot):
    team_base = GAME + team * 0xE30
    native.put(0xC00000 + 0x9A4B8, 128 * 256)
    native.put(0xC00000 + 0x9A4BC, 128 * 256)
    native.emulator.mem_write(0xC10000, struct.pack("<I", 1023) * (128 * 128))
    native.emulator.mem_write(0xC30000, struct.pack("<H", 1023) * (128 * 128))
    native.emulator.mem_write(0xC40000, struct.pack("<H", 1023) * (128 * 128))
    for row in range(128):
        for offset, base, stride in ((0x804, 0xC10000, 512), (0xC04, 0xC30000, 256),
                                     (0x1004, 0xC40000, 256)):
            native.put(0xC00000 + offset + row * 4, base + row * stride)
    native.put(team_base + 0xBC4, 32)
    native.put(team_base + 0xBC8, 32)
    cells = []
    for index in range(8):
        offset = 0x47ABE8 + slot * 64 + index * 8
        column = 32 + struct.unpack("<i", native.emulator.mem_read(offset, 4))[0]
        row = 32 + struct.unpack("<i", native.emulator.mem_read(offset + 4, 4))[0]
        address = 0xC10000 + row * 512 + column * 4
        if cells and cells[-1] == address:
            break
        assert 0 <= column < 128 and 0 <= row < 128
        native.put(0xC00000 + 0x804 + row * 4, 0xC10000 + row * 512)
        native.put(address, team * 15 + slot)
        cells.append(address)
    assert cells
    return cells


def load_damage(native, unit_type):
    tables = BASE["source_probe"](native.image)[0]
    weapon_rows = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").read_text().splitlines()
                   if line.strip() and not line.lstrip().startswith("%")]
    assert int(weapon_rows[0][0]) == len(weapon_rows) - 1
    for tokens in weapon_rows[1:]:
        native.run(0x43B78B, {UC_X86_REG_EBP: 0x70D800, UC_X86_REG_ESI: int(tokens[0]) * 9}, 0x43B7CA)
        stack = native.emulator.reg_read(UC_X86_REG_ESP)
        assert cstring(native, native.get(stack + 4)).split() == ["%s"] + ["%d"] * 11
        destinations = struct.unpack("<12I", native.emulator.mem_read(stack + 8, 48))
        native.emulator.mem_write(destinations[0], tokens[1].encode("ascii") + b"\0")
        for destination, token in zip(destinations[1:], tokens[2:]):
            native.put(destination, int(token))
        weapon_record = 0x4F0200 + int(tokens[0]) * 72
        native.run(0x43B7CF, {UC_X86_REG_EBP: 0x70D800, UC_X86_REG_ESI: weapon_record}, 0x43B7E0)
        native.run(0x43B935, {UC_X86_REG_ESI: weapon_record}, 0x43B955)
        if int(tokens[0]) == 1:
            native.run(0x43B84F, {UC_X86_REG_EBP: 0x70D800, UC_X86_REG_ESI: weapon_record}, 0x43B955)
    boom_rows = [line.split() for line in (ROOT / "raw_cd/DC/GAMESTAT/BOOMSTAT.TXT").read_text().splitlines()
                 if line.strip() and not line.lstrip().startswith("%")]
    assert boom_rows[1] == ["0", "1"]
    native.emulator.mem_write(0x70D800 - 0x118, " ".join(boom_rows[1]).encode("ascii") + b"\0")
    native.run(0x43B407, {UC_X86_REG_EBP: 0x70D800}, 0x43B49E)
    assert native.get(0x4F90E0, 1) == 1
    assert [native.get(0x4F0200 + 72 + offset) for offset in (0, 8, 12, 16, 20, 28)] == [0, 15, 100, 60, 4, 0]
    for row_index, percentages in enumerate(tables["damageMatrixPercentages"]):
        native.emulator.mem_write(0x701000, " ".join(map(str, percentages)).encode("ascii") + b"\0")
        native.put(0x70D800 - 0x10, 0x701000)
        native.put(0x70D800 - 4, row_index)
        native.put(0x4F98C8, len(percentages))
        native.put(0x4F98D0, 0x704000)
        native.put(0x704000 + row_index * 4, 0x705000 + row_index * 256)
        native.run(0x43B24B, {UC_X86_REG_EBP: 0x70D800, UC_X86_REG_EDI: 0}, 0x43B2EF)
        assert [native.get(0x705000 + row_index * 256 + index * 2, 2)
            for index in range(len(percentages))] == [int(value * 0.01 * 256) for value in percentages]
    native.put(0x70D800 - 4, TYPES + unit_type * 280)
    native.run(0x43BD46, {UC_X86_REG_EBP: 0x70D800}, 0x43BDAE)
    weapon = tables["weapons"][0]
    native.put(0x703000, weapon["weaponClass"])
    native.put(0x70300C, weapon["damage"])
    return weapon


def projectile_hit(native, column=33, row=32):
    projectile, frame, source_id = 0x706000, 0x70C800, 200
    source_entity = GAME + 0x7D28 + source_id * 220
    native.put(source_entity + 6, 0, 1)
    native.put(source_entity + 7, 0, 1)
    native.put(projectile, column * 256 + 128, 2)
    native.put(projectile + 2, row * 256 + 128, 2)
    native.put(projectile + 0xE, source_id, 2)
    native.put(projectile + 0x18, 65535, 2)
    native.put(frame - 0xC, 0x703000)
    native.run(0x442570, {UC_X86_REG_EBP: frame, UC_X86_REG_ESI: projectile,
                          UC_X86_REG_EDI: GAME}, 0x442750)
    target = native.get(frame - 8)
    if target != 0xFFFFFFFF:
        native.run(0x442775, {UC_X86_REG_EBP: frame, UC_X86_REG_ESI: projectile,
                              UC_X86_REG_EDI: GAME}, 0x44287C)
    return target


def occupancy_membership(native, native_id):
    result = {}
    for name, base, width, format_code in (("ground", 0xC10000, 4, "I"),
                                          ("air", 0xC30000, 2, "H"),
                                          ("hidden", 0xC40000, 2, "H")):
        values = struct.unpack(f"<{128 * 128}{format_code}", native.emulator.mem_read(base, 128 * 128 * width))
        result[name] = [[index % 128, index // 128] for index, value in enumerate(values)
                        if value & 1023 == native_id]
    return result


def timed_weapon_contract(result, entry, executed, native):
    events = result["attackEvents"]
    launches = [event["update"] for event in events if event["eip"] == "0x441710"]
    impacts = [event["update"] for event in events if event["eip"] == "0x441930"]
    busy_clear = next(write["update"] for write in result["writes"]
                      if write["field"] == "busy" and write["before"] == 1 and write["after"] == 0)
    rejected = [event for event in events if event["eip"] == "0x435974"
                and event["candidate"] == 18 and event["busy"] == 1]
    expected_launches = (((146, 163, 180), (147, 164, 181), (151, 168, 185), (136, 153, 170)),
                         ((240,), (241,), (198, 215, 232), (196, 213, 230)))
    assert launches == list(expected_launches[result["race"]][result["interruption"]["phase"]]), launches
    hit_count = len(launches)
    assert all(later - earlier == 17 for earlier, later in zip(launches, launches[1:]))
    assert impacts == [launch + 1 for launch in launches]
    assert all(launch >= busy_clear for launch in launches)
    if result["interruption"]["phase"] < 3:
        assert rejected, "no real occupied building candidate reached the busy guard"
    if result["race"] == 1 and result["interruption"]["phase"] < 2:
        wait_update = 193 + result["interruption"]["phase"]
        assert any(event["eip"] == "0x412274" and event["update"] == wait_update and event["ebx"] == 45
                   for event in events)
        assert any(item["stage"] == "pair-dispatched" and item["update"] == busy_clear
                   and item["attacker"]["task"] == 3 and item["attacker"]["taskWords"][0] > 0
                   for item in result["trace"] if "attacker" in item)
    assert all(executed.get(address) == hit_count for address in ("0x442767", "0x442877", "0x441930"))
    assert not any(executed.get(address) for address in ("0x416308", "0x434d48", "0x4453a8"))
    assert entry["main"]["hp"] == 2400 - 4 * hit_count and entry["main"]["activeSlot"] == 18
    assert entry["main"]["task"] == 1 and entry["main"]["status"] == 1
    assert entry["footprint"] == [18] * 4
    assert entry["auxiliary"]["hp"] == 800 and entry["auxiliary"]["activeSlot"] == 65535
    assert entry["update"] == (186 if result["race"] == 0 else 246)
    assert (entry["busy"], entry["latch"]) == (0, 0)
    assert executed.get("0x418504") == 2 and executed.get("0x4186e0") == 3
    attacker = snapshot(native, result["attackerId"])
    assert attacker["hp"] == 800 and attacker["activeSlot"] == result["attackerId"]
    result["attackerFinal"] = attacker
    result["timedWeaponGolden"] = {"launchUpdates": launches, "impactUpdates": impacts,
        "busyClearUpdate": busy_clear, "busyCandidateRejections": len(rejected),
        "damagePerImpact": 4, "totalDamage": 4 * hit_count, "destructionProven": False,
        "contract": "one native trooper, weapon 1/profile 0, visible installed footprint; nonlethal construction completion only"}


def lifecycle(image, counter, race=0, interruption=None):
    native = source_fixture(image)
    result = {"initializationCounter": counter, "race": race, "interruption": interruption,
              "accepted": False, "trace": [], "writes": []}
    kind = interruption["kind"] if interruption else None
    try:
        unit_type = 20 if race == 0 else 32
        timed = kind == "timed-weapon"
        result["profiles"] = load_fin(native, (unit_type, 92 if race == 0 else 93) + ((0,) if timed else ()), attack=timed)
        result["animationComparison"] = animation_comparison(native, result["profiles"]["bindings"][0])
        team, slot = 1, 3
        native_id = team * 15 + slot
        entity = GAME + 0x7D28 + native_id * 220
        team_base = GAME + team * 0xE30
        native.put(GAME + 0x7D1C, team)
        native.put(GAME + 0x94C, counter)
        native.put(team_base + 0xBB8, race)
        native.put(entity + 6, unit_type, 1)
        native.put(entity + 7, team, 1)
        native.put(entity + 0xC, native.get(TYPES + unit_type * 280 + 0x44))
        native.put(team_base + 0xBD4 + slot * 4, native.get(entity + 0xC))
        native.put(entity + 0x2C, 1, 1)
        native.put(entity + 0x38, 255, 1)
        native.emulator.mem_write(GAME + 0x468EC, b"\xff\xff" * 800)
        native.put(GAME + 0x468EC + native_id * 2, native_id, 2)
        native.put(GAME + 0x7D20, team * 15 + 6)
        native.put(GAME + 0x468EC + (team * 15 + 6) * 2, 65535, 2)
        native.emulator.mem_map(0xC00000, 0x200000)
        native.put(GAME + 0x46F2C, 0xC00000)
        native.put(0xC00000 + 0x9A4B0, 128)
        native.put(0xC00000 + 0x9A4B4, 128)
        native.put(GAME + 0x544, 0xD00000)
        if interruption:
            result["footprintCells"] = populate_footprint(native, team, slot)
            if kind in ("damage", "projectile", "auxiliary-guard", "timed-weapon"):
                result["weapon"] = load_damage(native, unit_type)
        if timed:
            native.put(entity, 33 * 256 + 128, 2)
            native.put(entity + 4, 32 * 256 + 128, 2)
            native.put(0x70D800 - 4, GAME)
            native.put(0x70D800 - 8, 0)
            native.run(0x41993F, {UC_X86_REG_EBP: 0x70D800}, 0x41996A)
            assert native.get(GAME + 0x19C0) == 0x40000000
            for address in result["footprintCells"]:
                native.put(address, native.get(address) | native.get(GAME + 0x19C0))
            result["visibilityFixture"] = "Four target footprint cells visible to team 0; native own-team mask initialization; fog updates not reproduced"
            native.put(GAME + 0x468E8, 65535, 2)
            native.put(GAME + 0x468EA, 65535, 2)
            native.put(GAME + 0x7D20, 152)
            result["attackEvents"] = []
            result["combatSource"] = {"weaponId": 1, "sourceType": 0,
                "weaponRecord": list(struct.unpack("<18I", native.emulator.mem_read(0x4F0248, 72))),
                "effectId": 0, "effectWidth": native.get(0x4F90E0, 1),
                "effectBoundary": "Profile 0 width selects direct damage; unused area/render records are not marshalled",
                "sourceHashes": {name: hashlib.sha256((ROOT / "raw_cd/DC/GAMESTAT" / name).read_bytes()).hexdigest()
                    for name in ("WEAPSTAT.TXT", "BOOMSTAT.TXT", "MBULLET.TXT", "GAMESTAT.TXT")}}
        for offset in (0x1C, 0x24):
            native.run(0x42630C, {UC_X86_REG_EAX: entity + offset,
                                  UC_X86_REG_EDX: native.get(TYPES + unit_type * 280 + 0x80),
                                  UC_X86_REG_EBX: 2})
        auxiliary_id = team * 15 + 6
        auxiliary_entity = GAME + 0x7D28 + auxiliary_id * 220
        tracked = {entity + 0x46: "mainTaskWord0", entity + 0x1A: "mainAnimationMode",
                   entity + 0x2C: "mainStatus", entity + 0x38: "mainTaskDepth",
                   entity + 0xC: "mainHP", team_base + 0xBD4 + slot * 4: "colonyHP",
                   GAME + 0x468EC + native_id * 2: "mainActiveSlot",
                   team_base + 0xC10 + slot: "busy", team_base + 0x19AA: "latch",
                   GAME + 0x468EC + auxiliary_id * 2: "auxiliaryActiveSlot",
                   auxiliary_entity + 0x2C: "auxiliaryStatus", auxiliary_entity + 0x38: "auxiliaryTaskDepth"}
        update = 0
        runtime_call_start = len(native.calls)
        executed = {}
        native_entries = {0x419248, 0x41822C, 0x4187E4, 0x418504, 0x41B750,
                  0x41AF14, 0x411DD8, 0x412014, 0x4182E8, 0x4183B8,
                  0x4186E0, 0x4264C8, 0x437BC4, 0x441930, 0x416308,
                  0x434D48, 0x4453A8, 0x41CE54, 0x434F6C, 0x4351F7, 0x43515D,
                  0x435C14, 0x412D00, 0x441710, 0x44293C, 0x442767, 0x442877}

        def record_write(emulator, access, address, size, value, user_data):
            value &= (1 << (size * 8)) - 1
            if address in tracked and native.get(address, size) != value:
                result["writes"].append({"update": update, "eip": hex(emulator.reg_read(UC_X86_REG_EIP)),
                                         "field": tracked[address], "before": native.get(address, size), "after": value})

        def record(stage):
            entry = {"update": update, "stage": stage, "main": snapshot(native, native_id),
                     "auxiliary": snapshot(native, auxiliary_id),
                     "busy": native.get(team_base + 0xC10 + slot, 1),
                     "latch": native.get(team_base + 0x19AA, 1),
                     "colonyHP": native.get(team_base + 0xBD4 + slot * 4),
                     "footprint": [native.get(address) & 0x3FF for address in result.get("footprintCells", [])]}
            result["trace"].append(entry)
            if timed and "attackerId" in result:
                entry["attacker"] = snapshot(native, result["attackerId"])
            return entry

        def record_dispatch(emulator, address, size, user_data):
            if address in native_entries:
                executed[hex(address)] = executed.get(hex(address), 0) + 1
            if address == 0x419BE5:
                record("entity-dispatched")
            if timed and address in (0x435124, 0x4357F3, 0x435974, 0x412D00, 0x4120FC,
                                      0x4121D8, 0x412274, 0x441710, 0x442767, 0x441930):
                result["attackEvents"].append({"update": update, "eip": hex(address),
                    "eax": emulator.reg_read(UC_X86_REG_EAX), "edx": emulator.reg_read(UC_X86_REG_EDX),
                    "ebx": emulator.reg_read(UC_X86_REG_EBX),
                    "candidate": native.get(emulator.reg_read(UC_X86_REG_EBP) - 4)
                        if address in (0x435124, 0x4357F3, 0x435974) else None,
                    "busy": native.get(team_base + 0xC10 + slot, 1),
                    "mainHP": native.get(entity + 0xC),
                    "auxiliaryActiveSlot": native.get(GAME + 0x468EC + auxiliary_id * 2, 2)})

        native.emulator.hook_add(UC_HOOK_MEM_WRITE, record_write)
        native.emulator.hook_add(UC_HOOK_CODE, record_dispatch, begin=0x411DD8, end=0x445560)
        native.run(0x41822C, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: native_id})
        record("initialized")
        interrupted = False
        for update in range(1, 4097):
            current = snapshot(native, native_id)
            if interruption and not interrupted and current["task"] == 19 and current["phase"] == interruption["phase"]:
                record("before-interruption")
                if kind == "timed-weapon":
                    result["auxiliaryOccupancyAtAttackStart"] = occupancy_membership(native, auxiliary_id)
                    assert all(not cells for cells in result["auxiliaryOccupancyAtAttackStart"].values())
                    native.put(BASE["STACK"] + 4, 0)
                    native.put(BASE["STACK"] + 8, 0xFFFFFFFF)
                    native.run(0x41B750, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 30,
                                          UC_X86_REG_EBX: 32, UC_X86_REG_ECX: 0})
                    result["attackerId"] = native.emulator.reg_read(UC_X86_REG_EAX)
                    result["attackerInitial"] = snapshot(native, result["attackerId"])
                    assert result["attackerInitial"]["hp"] == native.get(TYPES + 0x44)
                    assert result["attackerInitial"]["activeSlot"] == result["attackerId"]
                    assert native.get(0xC10000 + 32 * 512 + 30 * 4) & 1023 == result["attackerId"]
                    result["attackerOccupancy"] = occupancy_membership(native, result["attackerId"])
                elif kind == "queued-order":
                    assert native.get(0x479384 + 4 * 4) == 0x41CE54
                    assert native.get(0x4792BC) == 0x412654, "order one is not native idle"
                    native.emulator.mem_write(0x701100, struct.pack("<hB", native_id, 1))
                    native.put(0x701000, 0x701100)
                    native.run(0x41CE54, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: 0x701000})
                    assert native.get(entity + 0x36, 1) == 1
                    after_order = snapshot(native, native_id)
                    assert (after_order["task"], after_order["phase"], after_order["hp"]) == (19, current["phase"], 2400)
                elif kind == "auxiliary-guard":
                    assert native.get(auxiliary_entity + 7, 1) == 8
                    assert native.get(GAME + 0x468EC + auxiliary_id * 2, 2) == auxiliary_id
                    marker = 0xC30000 + 40 * 256 + 40 * 2
                    assert native.get(marker, 2) == 1023
                    native.put(marker, auxiliary_id, 2)
                    target = projectile_hit(native, 40, 40)
                    native.put(marker, 1023, 2)
                    assert target == 0xFFFFFFFF
                    assert executed.get("0x43515d", 0) > 0
                    assert not executed.get("0x441930", 0)
                    result["guardGolden"] = {"target": target, "team": 8,
                                             "fixture": "adversarial air-cell candidate, restored after query",
                                             "legalAuxiliaryDeathProven": False}
                elif kind == "projectile":
                    targets = []
                    while native.get(entity + 0x2C, 1) != 10:
                        target = projectile_hit(native)
                        targets.append(target)
                        if target == 0xFFFFFFFF:
                            assert native.get(team_base + 0xC10 + slot, 1) == 1
                            break
                        assert target == native_id
                        assert len(targets) < 1024
                    result["projectileTargets"] = targets
                    if interruption["phase"] < 3:
                        assert targets == [0xFFFFFFFF]
                        assert executed.get("0x4351f7", 0) > 0
                        assert not executed.get("0x441930", 0)
                    else:
                        assert len(targets) == 600 and set(targets) == {native_id}
                        assert all(native.get(address) & 0x3FF == 0x3FF for address in result["footprintCells"])
                elif kind == "damage":
                    hits = 0
                    while native.get(entity + 0x2C, 1) != 10:
                        before_hp = native.get(entity + 0xC)
                        for offset, value in ((4, team), (8, 0), (12, native_id)):
                            native.put(BASE["STACK"] + offset, value)
                        native.run(0x441930, {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: native_id,
                                              UC_X86_REG_EBX: 0x703000, UC_X86_REG_ECX: 256})
                        hits += 1
                        assert native.get(entity + 0xC) != before_hp, "source weapon did no damage"
                        assert hits < 1024
                    result["damageHits"] = hits
                    assert all(native.get(address) & 0x3FF == 0x3FF for address in result["footprintCells"])
                else:
                    native.run(interruption["entry"], {UC_X86_REG_EAX: GAME, UC_X86_REG_EDX: native_id})
                interrupted = True
                record("after-interruption")
            native.put(0x70D800 - 4, GAME)
            native.run(0x419BB8, {UC_X86_REG_EBP: 0x70D800}, 0x419C0E)
            if timed:
                native.run(0x44293C, {UC_X86_REG_EAX: GAME})
            entry = record("pair-dispatched")
            if entry["busy"] == entry["latch"] == 0:
                if timed:
                    timed_weapon_contract(result, entry, executed, native)
                    assert len(native.calls) == runtime_call_start, "timed attack call was intercepted"
                    result["accepted"] = True
                    break
                assert not interruption or interrupted, "interruption point not reached"
                if counter > 3 and kind not in ("damage", "native-death-entry", "native-order-reset"):
                    phases = [entry["after"] for entry in result["writes"] if entry["field"] == "mainTaskWord0"]
                    assert all(phase in phases for phase in (1, 2, 3, 4)), phases
                    assert executed.get("0x418504") == 2
                    assert executed.get("0x4186e0") == 3, "expected two arrival continuations and one departure continuation"
                    assert update == (186 if race == 0 else 246)
                    assert entry["auxiliary"]["activeSlot"] == 65535
                if counter == 3:
                    assert update == 1 and "0x418504" not in executed
                if kind in ("queued-order", "projectile", "auxiliary-guard"):
                    assert entry["main"]["hp"] == entry["colonyHP"] == 2400
                    assert entry["main"]["task"] == 1
                    assert entry["footprint"] == [native_id] * 4
                    if counter > 3:
                        assert entry["auxiliary"]["hp"] == 800
                if kind == "queued-order":
                    assert entry["main"]["pendingOrder"] == 0 and entry["main"]["order"] == 255
                assert len(native.calls) == runtime_call_start, "lifecycle call was intercepted"
                result["accepted"] = True
                break
            if interrupted and update > 512:
                if kind == "projectile" and interruption["phase"] == 3:
                    assert (entry["busy"], entry["latch"], entry["colonyHP"]) == (0, 1, 0)
                    assert entry["main"]["status"] == entry["main"]["hp"] == 0
                    assert entry["main"]["activeSlot"] == entry["auxiliary"]["activeSlot"] == 65535
                    assert entry["main"]["task"] == 10 and entry["main"]["taskWords"][0] == 150
                    assert entry["auxiliary"]["status"] == 1 and entry["auxiliary"]["hp"] == 800
                    assert entry["footprint"] == [1023] * 4
                    assert all(executed.get(address) == 1 for address in ("0x416308", "0x434d48", "0x4453a8"))
                    assert any(write["eip"] == "0x4187a0" and write["after"] == 4
                               for write in result["writes"] if write["field"] == "mainTaskWord0")
                    assert len(native.calls) == runtime_call_start
                    result["componentGolden"] = True
                    raise UnresolvedTransition(
                        "collision-to-death component reproduced busy=0/latch=1, but 600 impacts are batched; "
                        "missing legal weapon launch/timing, effect-profile selection and source blast/occupancy state; "
                        "do not accept this as a reachable faithful stuck latch")
                raise UnresolvedTransition("interruption has no proved cleanup: busy/latch still set after 512 native update pairs")
        if not result["accepted"]:
            raise UnresolvedTransition("native dispatch did not release busy and latch within 4096 updates")
    except (RuntimeError, AssertionError, OSError) as error:
        result["blocker"] = str(error).split("; stubs=")[0] or type(error).__name__
        result["eip"] = hex(native.emulator.reg_read(UC_X86_REG_EIP))
        if result["trace"]:
            record("failure")
    result["interceptedCalls"] = sorted(set(native.calls))
    if result["trace"]:
        result["nativeEntriesExecuted"] = executed
        result["lifecycleInterceptedCalls"] = native.calls[runtime_call_start:]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    parser.add_argument("--probe", choices=("queued-order", "damage", "projectile", "auxiliary-guard", "timed-weapon"))
    parser.add_argument("--phase", type=int, choices=range(4), default=2)
    parser.add_argument("--race", type=int, choices=(0, 1), default=0)
    args = parser.parse_args()
    image = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
    assert hashlib.sha256(image).hexdigest() == BASE["EXE_HASH"], "unrecognized executable"
    native = source_fixture(image)
    if args.disassemble:
        start, end = args.disassemble
        decoder = Cs(CS_ARCH_X86, CS_MODE_32)
        decoder.skipdata = True
        for instruction in decoder.disasm(bytes(native.emulator.mem_read(start, end - start)), start):
            print(f"{instruction.address:#x}: {instruction.mnemonic} {instruction.op_str}")
        return 0
    if args.probe:
        case = lifecycle(image, 4, args.race, {"kind": args.probe, "phase": args.phase})
        print(json.dumps(case, indent=2))
        return 0 if case["accepted"] else 1
    cases = [lifecycle(image, counter, race) for race in (0, 1) for counter in (3, 4)]
    for race in (0, 1):
        cases.extend(lifecycle(image, counter, race, {"kind": "queued-order", "phase": phase})
                     for counter, phase in ((3, 0), (4, 0), (4, 1), (4, 2), (4, 3)))
        cases.extend(lifecycle(image, 4, race, {"kind": "projectile", "phase": phase}) for phase in range(4))
        cases.extend(lifecycle(image, 4, race, {"kind": "auxiliary-guard", "phase": phase}) for phase in (1, 3))
    negative_controls = [lifecycle(image, counter, 0, {"kind": "native-order-reset", "entry": 0x412014, "phase": phase})
                         for counter, phase in ((3, 0), (4, 0), (4, 1), (4, 2), (4, 3))]
    negative_controls.append(lifecycle(image, 4, 0, {"kind": "native-death-entry", "entry": 0x416308, "phase": 2}))
    timed_cases = [lifecycle(image, 4, race, {"kind": "timed-weapon", "phase": phase})
                   for race in (0, 1) for phase in range(4)]
    for control in negative_controls:
        assert not control["accepted"] and "cleanup" in control["blocker"]
        assert control["trace"][-1]["update"] == 513
        assert not control["lifecycleInterceptedCalls"]
        control["classification"] = "internal-entry negative control, not a legal cancellation/death command"
    report = {"executableSha256": BASE["EXE_HASH"], "accepted": all(case["accepted"] for case in cases + timed_cases),
              "sourceHashes": parsed_source(image)[2]["sourceHashes"],
              "animationRegistrySha256": hashlib.sha256((ROOT / "raw_cd/DC/ANIM.DAT").read_bytes()).hexdigest(),
              "gates": {"normalLifecycle": all(case["accepted"] for case in cases[:4]),
                        "queuedIdleOrder": all(case["accepted"] for case in cases if case["interruption"] and case["interruption"]["kind"] == "queued-order"),
                        "directHitGuards": all(case["accepted"] for case in cases if case["interruption"] and (case["interruption"]["kind"] == "auxiliary-guard" or (case["interruption"]["kind"] == "projectile" and case["interruption"]["phase"] < 3))),
                        "interruptionCleanup": all(case["accepted"] for case in cases[4:]),
                        "timedWeaponNonlethal": all(case["accepted"] for case in timed_cases),
                        "productionWorkflow": False},
              "remainingBlocker": "Weapon 1/profile 0 launches under the bounded visible fixture, but causes only 4 or 12 damage by latch release. Reachable lethal phase-3 or area-effect/auxiliary destruction remains unproved; the 600-hit components remain rejected.",
              "boundaries": {
                  "queuedOrder": "Native opcode-4 decoder and order-1 initializer; ordinary UI issuance and active-cancel policy not proven.",
                  "projectile": "Executes 0x442570..0x442750 then, on a hit, 0x442775..0x44287c; effect-profile selection and weapon launch are not executed.",
                  "auxiliaryGuard": "Adversarial occupancy marker proves the native team-8 filter, not a legal auxiliary death or actual spatial registration.",
                  "areaDamage": "0x441bec occupancy scan calls damage at 0x44219b without the direct-hit busy/team-8 guards; source blast profiles and legal occupancy remain required."},
              "negativeControls": negative_controls, "cases": cases, "timedWeaponCases": timed_cases}
    print(json.dumps(report, indent=2))
    return 0 if report["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())