"""Observe original local-session world calls without replacing game handlers."""

import argparse
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "scheduler_ai_probe", Path(__file__).parents[1] / "research/ai-policy-20260919.py")
AI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AI)
VISIBILITY_SPEC = importlib.util.spec_from_file_location(
    "scheduler_visibility_probe", Path(__file__).with_name("native-visibility-native.py"))
VISIBILITY = importlib.util.module_from_spec(VISIBILITY_SPEC)
VISIBILITY_SPEC.loader.exec_module(VISIBILITY)
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EDX, UC_X86_REG_ESP, UC_X86_REG_EBP

PHASES = {
    0x4196F4: "world-enter", 0x4197B4: "census-done",
    0x41981C: "population-flags-done", 0x419880: "platform-flags-done",
    0x4198CE: "relations-enter", 0x419A5B: "trigger-prelude-enter",
    0x419AAF: "commander-cleanup", 0x419B3A: "income-enter",
    0x419C2E: "frame-report",
    0x41989E: "clock-enter", 0x4198C3: "population-cap",
    0x419990: "relations-done", 0x419A28: "daylight-done",
    0x44461C: "world-maintenance", 0x419A30: "visibility-gate",
    0x4456F0: "visibility-clear", 0x44A6D4: "visibility-compute",
    0x439F40: "visibility-followup", 0x419A4B: "trigger-gate",
    0x43FEAC: "trigger-prelude", 0x43E4D0: "trigger-scan",
    0x419B2E: "income-gate", 0x419B7E: "team-maintenance",
    0x419BB8: "actors-enter", 0x419248: "actor", 0x419BE5: "actor-return",
    0x44293C: "projectiles", 0x419C13: "projectiles-return",
    0x44AC28: "frame-record", 0x419CBC: "ai-local-enter",
    0x41AC2C: "ai-scheduler", 0x41AB20: "ai-selector",
    0x41ABCC: "policy-weight", 0x41AC21: "policy-dispatch",
    0x44BE40: "full-policy", 0x419CCE: "ai-local-exit",
    0x44BF0E: "full-policy-return",
    0x419CD5: "timing-enter", 0x419580: "timing-feedback",
    0x419CEB: "timing-clock-return", 0x4195B7: "feedback-clock-return",
    0x421394: "period-packet", 0x42125C: "latency-packet",
    0x41C7F8: "unit-production-receipt", 0x41C8D4: "city-production-receipt",
    0x41DEFC: "command-receipt", 0x421725: "command-emission",
    0x444F14: "city-constructor", 0x41822C: "city-task-initialize",
    0x41AF14: "actor-constructor", 0x416104: "movement-task",
    0x419D4D: "world-exit",
}


def capture(faction, limit, first_counter=1):
    events = []
    policies = []
    pending_policy = None
    original_fixture = AI.fixture
    original_scn = AI.initialize_full_source_scn

    def initialize_scn(machine, sources, rows):
        VISIBILITY.load_terrain(machine, sources, rows)
        original_scn(machine, sources, rows)

    def fixture():
        machine = original_fixture()
        image = AI.NATIVE.IMAGE
        header = struct.unpack_from("<I", image, 0x3C)[0]
        section_count = struct.unpack_from("<H", image, header + 6)[0]
        section_offset = header + 24 + struct.unpack_from("<H", image, header + 20)[0]
        image_base = struct.unpack_from("<I", image, header + 52)[0]
        for index in range(section_count):
            section = section_offset + index * 40
            virtual_size, relative = struct.unpack_from("<II", image, section + 8)
            flags = struct.unpack_from("<I", image, section + 36)[0]
            if flags & 0x80:
                machine.mem_write(image_base + relative, bytes(virtual_size))
        active = False
        previous_registry = None

        def registry_snapshot(emulator):
            game = AI.NATIVE.GAME
            registry = struct.unpack("<800h", emulator.mem_read(game + 0x468EC, 1600))
            raw = bytes(emulator.mem_read(game + 0x7D28, 800 * 220))
            return [(slot, raw[slot * 220 + 6] if slot >= 0 else -1) for slot in registry]

        def observe(emulator, address, size, data):
            nonlocal active, previous_registry, pending_policy
            if address == 0x4196F4:
                active = True
            if not active:
                return
            game = AI.NATIVE.GAME
            word = lambda offset: AI.dword(emulator, game + offset)
            if word(0x94C) < first_counter:
                if address == 0x419D4D:
                    active = False
                return
            policy = word(0xB94)
            target_team = 2 if faction == "HUMAN" else 1
            encode = lambda pointer, length: base64.b64encode(emulator.mem_read(pointer, length)).decode()

            def policy_snapshot(team):
                pointer = word(0xBC0 + team * 0xE30)
                return {"policy": encode(pointer, 0x6C40) if pointer else base64.b64encode(bytes(0x6C40)).decode(),
                        "entities": encode(game + 0x7D28, 800 * 220),
                        "teamBytes": encode(game + 0xB98 + team * 0xE30, 0xE30),
                        "rngCursor": AI.dword(emulator, 0x479204),
                        "forceOrder": emulator.mem_read(0x489510, 1)[0], "policyAddress": pointer}

            if address == 0x44BE40 and emulator.reg_read(AI.UC_X86_REG_EDX) == target_team:
                width, height = AI.dword(emulator, AI.MAP + 0x9A4B0), AI.dword(emulator, AI.MAP + 0x9A4B4)
                columns, matrix = AI.dword(emulator, 0x4F98C8), AI.dword(emulator, 0x4F98D0)
                matrix_rows = int([line for line in (AI.NATIVE.ROOT / "raw_cd/DC/GAMESTAT/MBULLET.TXT").read_text().splitlines()
                                   if line.strip() and not line.lstrip().startswith("%")][1])
                path_rows = AI.dword(emulator, AI.MAP + 0x1404)
                pending_policy = {"counter": word(0x94C), "team": target_team,
                    "before": policy_snapshot(target_team), "packets": [],
                    "population": AI.dword(emulator, 0x4956E0 + target_team * 48 + 24),
                    "populationLimit": word(0x528),
                    "navigation": {"width": width, "height": height,
                        "families": [emulator.mem_read(AI.dword(emulator, path_rows + row * 4) + column * 24 + 12, 1)[0]
                                     for row in range(height) for column in range(width)],
                        "nextFamily": encode(AI.MAP + 0x884A8, 65536)},
                    "inputs": {"types": encode(0x4F1880, 110 * 280), "weapons": encode(0x4F0200, 80 * 72),
                        "dependencies": encode(0x4E6D70, 110 * 52),
                        "cityDependencies": list(struct.unpack("<18i", AI.NATIVE.READ(0x488FF4, 72))),
                        "matrix": [list(struct.unpack(f"<{columns}h", emulator.mem_read(AI.dword(emulator, matrix + row * 4), columns * 2)))
                                   for row in range(matrix_rows)],
                        "relations": list(emulator.mem_read(game + 0x46F34, 100)),
                        "visibilityMasks": [word(0x19C0 + team * 0xE30) for team in range(8)],
                        "occupancy": [AI.dword(emulator, AI.dword(emulator, AI.MAP + 0x804 + row * 4) + column * 4)
                                      for row in range(height) for column in range(width)],
                        "neighbors": encode(AI.MAP + 0x984A8, 8192)},
                    "ruleTable": base64.b64encode(AI.NATIVE.READ(0x48903C, 216)).decode()}
            if address == 0x421725 and pending_policy is not None:
                pointer = emulator.reg_read(AI.UC_X86_REG_ESI)
                length = struct.unpack("<H", emulator.mem_read(pointer, 2))[0]
                pending_policy["packets"].append(bytes(emulator.mem_read(pointer, length)).hex())
            if address == 0x44BF0E and pending_policy is not None:
                pending_policy["after"] = policy_snapshot(target_team)
                policies.append(pending_policy)
                pending_policy = None
            record = {
                "phase": PHASES[address], "address": address,
                "counter": word(0x94C), "troCounter": word(0x52C),
                "resourceClock": word(0x530), "period": word(0x534),
                "transition": word(0x538), "dayPhase": word(0x53C),
                "daylight": word(0x540), "task6Budget": AI.dword(emulator, 0x478E00),
                "rngCursor": AI.dword(emulator, 0x479204),
                "crtSeed": AI.dword(emulator, 0x85400C),
                "aiLastCounter": AI.dword(emulator, policy),
                "aiNextTeam": AI.dword(emulator, policy + 4),
                "ringIndex": word(0x308), "framePeriod": word(0x970),
                "highWater": word(0x7D20), "projectileHighWater": word(0x7D24),
                "pathStamp": AI.dword(emulator, 0x47A980),
                "visibilityDirty": AI.dword(emulator, 0x4796A8),
            }
            if address in (0x419CEB, 0x4195B7):
                record["tick"] = emulator.reg_read(AI.UC_X86_REG_EAX)
            if address in (0x421394, 0x42125C):
                record["value"] = emulator.reg_read(AI.UC_X86_REG_EBX if address == 0x421394 else AI.UC_X86_REG_EDX)
            if address in (0x41C7F8, 0x41C8D4, 0x41DEFC, 0x421725, 0x444F14, 0x41822C, 0x41AF14, 0x416104):
                record["registers"] = {name: emulator.reg_read(getattr(AI, "UC_X86_REG_" + name))
                                       for name in ("EAX", "EBX", "ECX", "EDX")}
                record["caller"] = AI.dword(emulator, emulator.reg_read(AI.UC_X86_REG_ESP))
            if address in (0x4196F4, 0x419BB8, 0x41AC2C, 0x419D4D):
                registry = registry_snapshot(emulator)
                record["registry"] = [
                    {"index": index, "slot": slot, "type": kind}
                    for index, (slot, kind) in enumerate(registry) if slot != -1]
                if address == 0x419BB8:
                    previous_registry = registry
                record["teamModes"] = [word(0xBBC + team * 0xE30) for team in range(8)]
                record["teamControllers"] = [word(0xC9C + team * 0xE30) for team in range(8)]
                record["localTeam"] = word(0x7D1C)
            if address == 0x419BE5:
                registry = registry_snapshot(emulator)
                record["registryChanges"] = [{"index": index, "slot": slot, "type": kind}
                    for index, (slot, kind) in enumerate(registry) if (slot, kind) != previous_registry[index]]
                previous_registry = registry
            if address in (0x419CD5, 0x419580, 0x419D4D):
                record["timing"] = {
                    "durations": [word(8 + index * 4) for index in range(64)],
                    "timestamps": [word(0x108 + index * 4) for index in range(64)],
                    "periods": [word(0x208 + index * 4) for index in range(64)],
                    "teamLatencies": [word(0x974 + index * 4) for index in range(8)],
                    "requestedLatency": word(0x96C), "populationCeiling": word(4),
                }
            if address == 0x419248:
                slot = emulator.reg_read(UC_X86_REG_EDX)
                raw = bytes(emulator.mem_read(game + 0x7D28 + slot * 220, 220))
                record.update(slot=slot, type=raw[6], status=raw[0x2C],
                              health=struct.unpack_from("<i", raw, 12)[0],
                              task=raw[0x39 + struct.unpack_from("<b", raw, 0x38)[0] * 2],
                              caller=AI.dword(emulator, emulator.reg_read(UC_X86_REG_ESP)))
            if address == 0x41AB20:
                record["team"] = emulator.reg_read(UC_X86_REG_EDX)
            if address in (0x41ABCC, 0x41AC21):
                frame = emulator.reg_read(UC_X86_REG_EBP)
                record["selectorLocals"] = bytes(emulator.mem_read(frame - 0x10, 16)).hex()
                record["eax"] = emulator.reg_read(AI.UC_X86_REG_EAX)
                record["ecx"] = emulator.reg_read(AI.UC_X86_REG_ECX)
            events.append(record)
            if address == 0x419D4D:
                active = False

        for address in PHASES:
            machine.hook_add(UC_HOOK_CODE, observe, begin=address, end=address)
        return machine

    AI.fixture = fixture
    AI.initialize_full_source_scn = initialize_scn
    output = io.StringIO()
    try:
        with contextlib.redirect_stdout(output):
            AI.activation_boundary(faction, 2 if faction == "HUMAN" else 1,
                                   scan=True, full_world=True, prefix_limit=limit)
    finally:
        AI.fixture = original_fixture
        AI.initialize_full_source_scn = original_scn
    source = json.loads(output.getvalue())
    assert source["failure"] is None, source["failure"]
    assert source["contiguousWorld"]["completedUpdates"] == limit
    assert source["nativeAudit"]["runtimeCoreInterceptions"] == []
    return {
        "schema": "native-scheduler-observation-v1", "mission": faction + "02",
        "executableSha256": source["executableSha256"],
        "sourceScnInitialization": source["sourceScnInitialization"],
        "setupLoaderSubstitutions": ["0x43c388: preloaded native type/dependency tables",
                                     "0x435f30: preloaded map/path object; original terrain decoder 0x453421..0x453790"],
        "sourceClock": source["sourceClock"], "sessionTransport": source["sessionTransport"],
        "externalBoundaries": source["externalBoundaries"],
        "debugOutputBoundaries": source["debugOutputBoundaries"],
        "runtimeCoreInterceptions": [], "completedUpdates": limit, "events": events,
        "fullPolicies": policies,
        "firstCapturedCounter": first_counter,
        "naturalActivation": [{"frame": group["frame"], "team": group["team"], "group": group["group"],
                       "rngBefore": group["rngBefore"], "rngAfter": group["rngAfter"]}
                      for group in source["groupCompletions"]],
        "acceptance": source["acceptance"],
        "tables": {hex(address): AI.NATIVE.READ(address, length).hex()
                   for address, length in ((0x47936C, 16), (0x47380C, 8), (0x479310, 23 * 4))},
        "scope": "original full-SCN native caller; observation only; no runtime admission",
    }


def controls():
    machine = AI.fixture()
    clock_cases = []
    for resource_clock, period, transition, day_phase, daylight in (
            (0, 6300, 75, 0, 256), (74, 6300, 75, 0, 4), (75, 6300, 75, 0, 0),
            (6299, 6300, 75, 0, 0), (6300, 6300, 75, 0, 0),
            (0, 6750, 75, 1, 0), (74, 6750, 75, 1, 252), (6750, 6750, 75, 1, 256)):
        before = {"counter": 16, "troCounter": 99, "resourceClock": resource_clock,
                  "period": period, "transition": transition, "dayPhase": day_phase, "daylight": daylight}
        offsets = {"counter": 0x94C, "troCounter": 0x52C, "resourceClock": 0x530,
                   "period": 0x534, "transition": 0x538, "dayPhase": 0x53C, "daylight": 0x540}
        for name, offset in offsets.items():
            AI.put(machine, AI.NATIVE.GAME + offset, before[name])
        AI.put(machine, AI.NATIVE.FRAME - 4, AI.NATIVE.GAME)
        machine.reg_write(AI.UC_X86_REG_EBP, AI.NATIVE.FRAME)
        machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
        machine.emu_start(0x41989E, 0x4198C3, count=100)
        machine.emu_start(0x419990, 0x419A28, count=100)
        assert machine.reg_read(AI.UC_X86_REG_EIP) == 0x419A28
        clock_cases.append({"before": before, "after": {name: AI.dword(machine, AI.NATIVE.GAME + offset)
                                                        for name, offset in offsets.items()}})
    timing_cases = []
    tick = 0

    def clock(emulator, address, size, data):
        stack = emulator.reg_read(AI.UC_X86_REG_ESP)
        emulator.reg_write(AI.UC_X86_REG_EAX, tick)
        emulator.reg_write(AI.UC_X86_REG_EIP, AI.dword(emulator, stack))
        emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4)

    hook = machine.hook_add(UC_HOOK_CODE, clock, begin=0x40B030, end=0x40B030)
    for duration, period, elapsed, latency in ((0, 66, 2112, 0), (10, 66, 2112, 67),
            (32, 33, 1000, 101), (500, 66, 100, 151), (10, 66, 0, 201), (7, 33, 123, 251)):
        timing = {"ringIndex": 32, "durations": [duration] * 64,
                  "timestamps": [1000] * 64, "periods": [period] * 64}
        tick = 1000 + elapsed
        for offset, key in ((8, "durations"), (0x108, "timestamps"), (0x208, "periods")):
            machine.mem_write(AI.NATIVE.GAME + offset, struct.pack("<64I", *timing[key]))
        AI.put(machine, AI.NATIVE.GAME + 0x308, timing["ringIndex"])
        machine.reg_write(AI.UC_X86_REG_EAX, AI.NATIVE.GAME)
        machine.reg_write(AI.UC_X86_REG_ESP, AI.NATIVE.STACK)
        machine.emu_start(0x419580, 0x419609, count=10000)
        assert machine.reg_read(AI.UC_X86_REG_EIP) == 0x419609
        computed_period = machine.reg_read(AI.UC_X86_REG_EAX)
        latencies = [latency] * 8
        machine.mem_write(AI.NATIVE.GAME + 0x974, struct.pack("<8I", *latencies))
        machine.reg_write(AI.UC_X86_REG_ECX, AI.NATIVE.GAME)
        machine.emu_start(0x41961F, 0x419695, count=1000)
        assert machine.reg_read(AI.UC_X86_REG_EIP) == 0x419695
        timing_cases.append({"timing": timing, "input": {"tick": tick, "teamLatencies": latencies,
                             "requestedLatency": 20}, "period": computed_period,
                             "populationCeiling": AI.dword(machine, AI.NATIVE.GAME + 4)})
    machine.hook_del(hook)
    return {"scope": "isolated original instruction controls; not mission history",
            "clock": clock_cases, "timing": timing_cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mission", choices=("HUMAN", "ALIEN"), default="HUMAN")
    parser.add_argument("--updates", type=int, default=32)
    parser.add_argument("--from-counter", type=int, default=1)
    parser.add_argument("--controls", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(controls() if arguments.controls else
                     capture(arguments.mission, arguments.updates, arguments.from_counter)))