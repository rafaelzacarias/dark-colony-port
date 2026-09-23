"""Original full caller and receipt against constructor-backed session inputs."""

import base64
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("session_full_ai", ROOT / "tools/research/ai-full-policy-20260919.py")
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)
AI = PROBE.AI
PLACEMENT_SPEC = importlib.util.spec_from_file_location("session_full_placement", ROOT / "tools/research/scenario-placement-20260919.py")
PLACEMENT = importlib.util.module_from_spec(PLACEMENT_SPEC)
PLACEMENT_SPEC.loader.exec_module(PLACEMENT)


def capture(request):
    config = request["config"]
    buffers = request["buffers"]
    source = config["sources"]
    profile = config["fullPolicy"]
    team = config["team"]
    machine, _, _, width, families = AI.source_fixture(request["mission"][:-2], team,
        lambda *args: AI.initialize_source_world(*args, PLACEMENT))
    game = AI.NATIVE.GAME
    pool = game + 0x7D28
    side = game + 0xB98 + team * 0xE30
    assert profile["policyAddress"] == AI.POLICY
    assert bytes(source["navigation"]["families"]) == families
    assert bytes(source["navigation"]["nextFamily"]) == bytes(machine.mem_read(AI.MAP + 0x884A8, 65536))
    assert bytes(profile["ruleTable"]) == AI.NATIVE.READ(0x48903C, 216)
    assert profile["rngTable"] == list(struct.unpack("<256i", AI.NATIVE.READ(0x478E04, 1024)))
    for address, values in ((AI.POLICY, buffers["policy"]), (pool, buffers["entities"]),
                            (side, buffers["teamBytes"]), (0x4F1880, source["types"]),
                            (0x4F0200, source["weapons"]), (0x4E6D70, source["dependencies"]),
                            (AI.MAP + 0x984A8, profile["neighbors"]), (game + 0x46F34, buffers["relations"])):
        machine.mem_write(address, bytes(values))
    matrix = AI.dword(machine, 0x4F98D0)
    for row, values in enumerate(source["matrix"]):
        assert list(struct.unpack(f"<{len(values)}h", machine.mem_read(AI.dword(machine, matrix + row * 4), len(values) * 2))) == values
    assert source["cityDependencies"] == list(struct.unpack("<18i", AI.NATIVE.READ(0x488FF4, 72)))
    for owner, mask in enumerate(buffers["visibilityMasks"]):
        AI.put(machine, game + 0x19C0 + owner * 0xE30, mask)
    for index, word in enumerate(buffers["occupancy"]):
        pointer = AI.dword(machine, AI.MAP + 0x804 + (index // width) * 4)
        AI.put(machine, pointer + (index % width) * 4, word & 0xFFFFFFFF)
    AI.put(machine, game + 0x528, buffers["populationLimit"])
    AI.put(machine, 0x4956E0 + team * 48 + 24, buffers["population"])
    AI.put(machine, 0x479204, buffers["rngCursor"])
    machine.mem_write(0x489510, bytes((buffers["forceOrder"],)))
    AI.put(machine, 0x4793F0, game)
    machine.mem_write(0x49D620, b"\x01")
    packets, rng_events, allocations = [], [], []
    stage = "demand"

    def observe(emulator, address, size, context):
        nonlocal stage
        if address == 0x40BCC0:
            assert emulator.reg_read(AI.UC_X86_REG_EDX) == 0x6C40
            allocations.append(AI.POLICY)
            stack = emulator.reg_read(AI.UC_X86_REG_ESP)
            emulator.reg_write(AI.UC_X86_REG_EAX, AI.POLICY)
            emulator.reg_write(AI.UC_X86_REG_EIP, AI.dword(emulator, stack))
            emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4)
        elif address == 0x421725:
            pointer = emulator.reg_read(AI.UC_X86_REG_ESI)
            length = struct.unpack("<H", emulator.mem_read(pointer, 2))[0]
            packet = bytes(emulator.mem_read(pointer, length))
            packets.append({"stage": stage, "packet": packet.hex()})
            if profile["actorTransport"] == "deferred" or packet[2] in (9, 10):
                emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)
        elif address == 0x411DB4:
            rng_events.append(AI.dword(emulator, 0x479204))
        else:
            stage = emulator.reg_read(AI.UC_X86_REG_EBX)

    for address in (0x40BCC0, 0x421725, 0x411DB4, 0x4578A0, 0x459F24):
        machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)

    def snapshot():
        return {**{key: base64.b64encode(machine.mem_read(address, length)).decode()
                   for key, address, length in (("policy", AI.POLICY, 0x6C40), ("entities", pool, 800 * 220), ("teamBytes", side, 0xE30))},
                "rngCursor": AI.dword(machine, 0x479204), "forceOrder": machine.mem_read(0x489510, 1)[0]}

    AI.invoke(machine, 0x44BE40, instruction_limit=80000000, eax=game, edx=team)
    computed = snapshot()
    for record in packets:
        packet = bytes.fromhex(record["packet"])
        assert packet[2] != 9, "This receipt probe does not execute city construction"
        if packet[2] == 10 or profile["actorTransport"] == "deferred":
            machine.mem_write(0x709000, packet)
            AI.invoke(machine, 0x41DEFC, eax=game, edx=0x709002, ebx=len(packet) - 2)
            assert machine.reg_read(AI.UC_X86_REG_EAX) == 0
    return {"sha256": AI.NATIVE.AUDIT.DIGEST, "computed": computed, "received": snapshot(),
            "packets": packets, "rngEvents": rng_events, "allocations": allocations}


print(json.dumps(capture(json.load(sys.stdin))))