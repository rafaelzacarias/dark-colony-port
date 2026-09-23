"""Original ground-route boundaries; no path-helper replacement."""

import argparse
import base64
import importlib.util
import json
from pathlib import Path
import struct
import sys
import time
import zlib

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ground_registered", Path(__file__).with_name("native-registered-host-native.py"))
REGISTERED = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REGISTERED)
AI = REGISTERED.AI
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE


def capture(mission, updates, occupied=False, endpoint=False):
    original_fixture = AI.fixture
    calls = []
    occupied_calls = []
    endpoint_calls = []
    endpoint_steps = []
    phases = []
    controls = []
    access = {}
    direct = None

    def fixture():
        machine = original_fixture()
        pending = []
        phase = None

        def encode(address, length):
            return base64.b64encode(machine.mem_read(address, length)).decode()

        def snapshot():
            width = AI.dword(machine, AI.MAP + 0x9A4B0)
            height = AI.dword(machine, AI.MAP + 0x9A4B4)
            rows = AI.dword(machine, AI.MAP + 0x1404)
            return {"registers": {name: machine.reg_read(getattr(AI, "UC_X86_REG_" + name))
                                  for name in ("EAX", "EBX", "ECX", "EDX", "ESI", "EDI", "EBP", "ESP")},
                    "stack": encode(machine.reg_read(AI.UC_X86_REG_ESP), 80),
                    "game": encode(AI.NATIVE.GAME, 0x471B0),
                    "map": encode(AI.MAP, 0x9A4B8), "width": width, "height": height,
                    "pathRows": [{"address": AI.dword(machine, rows + row * 4),
                                  "bytes": encode(AI.dword(machine, rows + row * 4), width * 24)}
                                 for row in range(height)],
                    "globals": encode(0x479000, 0x2000),
                    "searchGlobals": encode(0x4FE65C, 0x134),
                    "groundRows": [{"address": AI.dword(machine, AI.MAP + 0x804 + row * 4),
                                    "bytes": encode(AI.dword(machine, AI.MAP + 0x804 + row * 4), width * 4)}
                                   for row in range(height)],
                    "rngCursor": AI.dword(machine, 0x479204), "crtSeed": AI.dword(machine, 0x85400C)}

        def returned(emulator, address, size, data):
            if pending and pending[-1]["returnAddress"] == address:
                call = pending.pop()
                call["after"] = snapshot()

        def enter(emulator, address, size, data):
            if direct is not None:
                return
            counter = AI.dword(machine, AI.NATIVE.GAME + 0x94C)
            if counter < 8:
                return
            return_address = AI.dword(machine, emulator.reg_read(AI.UC_X86_REG_ESP))
            call = {"address": address, "counter": counter, "returnAddress": return_address,
                    "before": snapshot(), "writes": []}
            (endpoint_calls if address == 0x414CE4 else occupied_calls
             if address in (0x415458, 0x41518C, 0x444540) else calls).append(call)
            pending.append(call)
            machine.hook_add(UC_HOOK_CODE, returned, begin=return_address, end=return_address)

        def write(emulator, access, address, size, value, data):
            if 0x700000 <= address < 0x710000:
                return
            if direct is not None:
                direct["writes"].append({"address": address, "size": size, "value": value,
                                          "before": bytes(emulator.mem_read(address, size)).hex()})
                return
            for call in pending:
                call["writes"].append({"address": address, "size": size, "value": value,
                                       "before": bytes(emulator.mem_read(address, size)).hex()})

        def route_state():
            return {"address": AI.MAP + 0x1404, "bytes": encode(AI.MAP + 0x1404, 0x990AC),
                    "stamp": AI.dword(machine, 0x47A980), "familyMask": encode(0x4FE65C, 256),
                    "neighbors": list(struct.unpack("<9I", machine.mem_read(0x4FE75C, 36))),
                    "dynamic": AI.dword(machine, 0x47A9AC) != 0,
                    "air": machine.mem_read(0x47A9B0, 1)[0] != 0}

        def registered(emulator, address, size, data):
            nonlocal phase
            if address == 0x419BB8:
                phase = {"counter": AI.dword(machine, AI.NATIVE.GAME + 0x94C), "before": route_state()}
            elif phase is not None:
                phase["after"] = route_state()
                phases.append(phase)
                phase = None

        for address in (0x44492C, 0x44302C, 0x4430B0):
            machine.hook_add(UC_HOOK_CODE, enter, begin=address, end=address)
        if occupied or endpoint:
            for address in (0x415458, 0x41518C, 0x444540):
                machine.hook_add(UC_HOOK_CODE, enter, begin=address, end=address)
        if endpoint:
            machine.hook_add(UC_HOOK_CODE, enter, begin=0x414CE4, end=0x414CE4)

            def endpoint_step(emulator, address, size, data):
                if direct is not None:
                    return
                actor = machine.reg_read(AI.UC_X86_REG_ESI)
                endpoint_steps.append({"address": address, "counter": AI.dword(machine, AI.NATIVE.GAME + 0x94C),
                                       "slot": (actor - AI.NATIVE.GAME - 0x7D28) // 220,
                                       "raw": encode(actor, 220), "rngCursor": AI.dword(machine, 0x479204)})

            for address in (0x4155D5, 0x4156B7, 0x4156EA, 0x4156F9, 0x4157CB):
                machine.hook_add(UC_HOOK_CODE, endpoint_step, begin=address, end=address)
        machine.hook_add(UC_HOOK_MEM_WRITE, write)
        for address in (0x419BB8, 0x419C0E):
            machine.hook_add(UC_HOOK_CODE, registered, begin=address, end=address)
        access.update(machine=machine, snapshot=snapshot)
        return machine

    AI.fixture = fixture
    try:
        source = REGISTERED.capture(mission, updates)
    finally:
        AI.fixture = original_fixture
    machine = access["machine"]

    def stop_direct(emulator, address, size, data):
        if direct is not None and direct["returnAddress"] == address:
            emulator.emu_stop()

    for return_address in {call["returnAddress"] for call in calls}:
        machine.hook_add(UC_HOOK_CODE, stop_direct, begin=return_address, end=return_address)

    def restore(before):
        for address, name in ((AI.NATIVE.GAME, "game"), (AI.MAP, "map"), (0x479000, "globals"), (0x4FE65C, "searchGlobals")):
            machine.mem_write(address, base64.b64decode(before[name]))
        for row in before["groundRows"]:
            machine.mem_write(row["address"], base64.b64decode(row["bytes"]))
        for name, value in before["registers"].items():
            machine.reg_write(getattr(AI, "UC_X86_REG_" + name), value)
        machine.mem_write(before["registers"]["ESP"], base64.b64decode(before["stack"]))

    serialization = next(call for call in calls if call["address"] == 0x4430B0)
    for label, start, count in (("odd-offset", 1, 6), ("short-prefix", 3, 3), ("zero-count", 0, 0)):
        restore(serialization["before"])
        stack = machine.reg_read(AI.UC_X86_REG_ESP)
        machine.mem_write(stack + 4, struct.pack("<III", start, 32, count))
        machine.mem_write(machine.reg_read(AI.UC_X86_REG_ECX), bytes([0xA5]) * 32)
        direct = {"label": label, "address": 0x4430B0, "returnAddress": serialization["returnAddress"],
              "before": access["snapshot"](), "writes": []}
        started = time.perf_counter_ns()
        try:
            machine.emu_start(0x4430B0, serialization["returnAddress"], count=100000)
        except Exception:
            print(json.dumps({"control": label, "entry": direct["before"]["registers"],
                              "stack": direct["before"]["stack"], "return": serialization["returnAddress"],
                              "eip": machine.reg_read(AI.UC_X86_REG_EIP),
                              "esp": machine.reg_read(AI.UC_X86_REG_ESP)}), file=sys.stderr)
            raise
        assert machine.reg_read(AI.UC_X86_REG_EIP) == serialization["returnAddress"]
        direct.update(after=access["snapshot"](), unicornNanoseconds=time.perf_counter_ns() - started)
        controls.append(direct)
        direct = None

    search = next(call for call in calls if call["address"] == 0x44492C)
    restore(search["before"])
    width, height = search["before"]["width"], search["before"]["height"]
    target_column = search["before"]["registers"]["ECX"]
    target_row = struct.unpack_from("<I", base64.b64decode(search["before"]["stack"]), 4)[0]
    selected = None
    for delta_column, delta_row in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        column, row = target_column + delta_column, target_row + delta_row
        if not 0 <= column < width or not 0 <= row < height:
            continue
        path_row = search["before"]["pathRows"][row]
        family = base64.b64decode(path_row["bytes"])[column * 24 + 12]
        ground = AI.dword(machine, AI.dword(machine, AI.MAP + 0x804 + row * 4) + column * 4)
        if family not in (0, 255) and ground & 1023 == 1023:
            selected = (column, row)
            break
    assert selected is not None
    for dynamic in (False, True):
        restore(search["before"])
        machine.reg_write(AI.UC_X86_REG_ECX, selected[0])
        machine.mem_write(machine.reg_read(AI.UC_X86_REG_ESP) + 4, struct.pack("<I", selected[1]))
        machine.mem_write(0x47A9AC, struct.pack("<I", int(dynamic)))
        machine.mem_write(0x47A9B0, b"\0")
        machine.mem_write(0x4FE780, struct.pack("<IIII", width, AI.MAP + 0x804, height, AI.MAP + 0xC04))
        direct = {"label": "dynamic-occupancy" if dynamic else "static-occupancy", "address": 0x44492C,
              "returnAddress": search["returnAddress"],
                  "before": access["snapshot"](), "writes": []}
        started = time.perf_counter_ns()
        machine.emu_start(0x44492C, search["returnAddress"], count=20000000)
        assert machine.reg_read(AI.UC_X86_REG_EIP) == search["returnAddress"]
        direct.update(after=access["snapshot"](), unicornNanoseconds=time.perf_counter_ns() - started)
        controls.append(direct)
        direct = None
    restore(search["before"])
    origin_column = search["before"]["registers"]["EDX"]
    origin_row = search["before"]["registers"]["EBX"]
    families = [list(base64.b64decode(row["bytes"])[12::24]) for row in search["before"]["pathRows"]]
    origin_family = families[origin_row][origin_column]
    prefix = bytes(machine.mem_read(AI.MAP + 0x884A8, 65536))
    candidates = []
    for row in range(height):
        for column in range(width):
            family = families[row][column]
            if family not in (0, 255) and (family == origin_family or prefix[origin_family * 256 + family]):
                candidates.append((abs(column - origin_column) + abs(row - origin_row), column, row))
    _, target_column, target_row = max(candidates)
    machine.reg_write(AI.UC_X86_REG_ECX, target_column)
    machine.mem_write(machine.reg_read(AI.UC_X86_REG_ESP) + 4, struct.pack("<I", target_row))
    direct = {"label": "long-route-search", "address": 0x44492C, "returnAddress": search["returnAddress"],
              "before": access["snapshot"](), "writes": []}
    started = time.perf_counter_ns()
    machine.emu_start(0x44492C, search["returnAddress"], count=20000000)
    assert machine.reg_read(AI.UC_X86_REG_EIP) == search["returnAddress"]
    direct.update(after=access["snapshot"](), unicornNanoseconds=time.perf_counter_ns() - started)
    controls.append(direct)
    direct = None
    distance = next(call for call in calls if call["address"] == 0x44302C)
    machine.reg_write(AI.UC_X86_REG_EAX, AI.MAP + 0x1404)
    machine.reg_write(AI.UC_X86_REG_EDX, target_column)
    machine.reg_write(AI.UC_X86_REG_EBX, target_row)
    machine.reg_write(AI.UC_X86_REG_ESP, distance["before"]["registers"]["ESP"])
    machine.mem_write(distance["before"]["registers"]["ESP"], base64.b64decode(distance["before"]["stack"]))
    direct = {"label": "long-route-distance", "address": 0x44302C, "returnAddress": distance["returnAddress"],
              "before": access["snapshot"](), "writes": []}
    machine.emu_start(0x44302C, distance["returnAddress"], count=100000)
    assert machine.reg_read(AI.UC_X86_REG_EIP) == distance["returnAddress"]
    length = machine.reg_read(AI.UC_X86_REG_EAX)
    assert 32 < length < 0x8000, length
    direct["after"] = access["snapshot"]()
    controls.append(direct)
    direct = None
    machine.reg_write(AI.UC_X86_REG_EAX, AI.MAP + 0x1404)
    machine.reg_write(AI.UC_X86_REG_EDX, target_column)
    machine.reg_write(AI.UC_X86_REG_EBX, target_row)
    machine.reg_write(AI.UC_X86_REG_ECX, serialization["before"]["registers"]["ECX"])
    stack = serialization["before"]["registers"]["ESP"]
    machine.reg_write(AI.UC_X86_REG_ESP, stack)
    machine.mem_write(stack, base64.b64decode(serialization["before"]["stack"]))
    machine.mem_write(stack + 4, struct.pack("<III", 0, 32, 32))
    direct = {"label": "long-route-first32", "address": 0x4430B0, "returnAddress": serialization["returnAddress"],
              "before": access["snapshot"](), "writes": []}
    machine.emu_start(0x4430B0, serialization["returnAddress"], count=100000)
    assert machine.reg_read(AI.UC_X86_REG_EIP) == serialization["returnAddress"]
    direct["after"] = access["snapshot"]()
    controls.append(direct)
    direct = None
    return {"schema": "native-ground-route-v1", "mission": mission, "calls": calls, "phases": phases,
            "controls": controls, "source": source, "occupiedCalls": occupied_calls,
            "endpointCalls": endpoint_calls, "endpointSteps": endpoint_steps}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mission", choices=("HUMAN", "ALIEN"), default="HUMAN")
    parser.add_argument("--updates", type=int, default=8)
    parser.add_argument("--occupied", action="store_true")
    parser.add_argument("--endpoint", action="store_true")
    parser.add_argument("--disassemble", nargs=2, type=lambda value: int(value, 0))
    arguments = parser.parse_args()
    if arguments.disassemble:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        machine = AI.fixture()
        start, end = arguments.disassemble
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes(machine.mem_read(start, end - start)), start):
            print(f"{instruction.address:08x} {instruction.mnemonic:8} {instruction.op_str}")
    else:
        result = capture(arguments.mission, arguments.updates, arguments.occupied, arguments.endpoint)

        def compact(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key in ("game", "map", "bytes") and isinstance(child, str) and len(child) > 4096:
                        value[key] = "z:" + base64.b64encode(zlib.compress(base64.b64decode(child))).decode()
                    else:
                        compact(child)
            elif isinstance(value, list):
                for child in value:
                    compact(child)

        compact(result)
        print(json.dumps(result))