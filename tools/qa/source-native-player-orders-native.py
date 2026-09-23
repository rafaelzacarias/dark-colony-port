"""Original packet receiver and registered command initializer, isolated from UI parity."""

import importlib.util
import json
from pathlib import Path
import struct
import sys
from unicorn import UC_HOOK_CODE

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("player_order_actor", Path(__file__).with_name("nativeactor-task-native.py"))
actor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actor)

if "--packet" in sys.argv:
    visibility_spec = importlib.util.spec_from_file_location("player_order_visibility", Path(__file__).with_name("native-visibility-native.py"))
    visibility = importlib.util.module_from_spec(visibility_spec)
    visibility_spec.loader.exec_module(visibility)
    request = json.load(sys.stdin)
    packet = bytes(request["packet"])
    source = request["source"]
    target = request.get("target")
    assert struct.unpack_from("<H", packet)[0] == len(packet)
    assert packet[2] == 5 and struct.unpack_from("<h", packet, 3)[0] == source["slot"]
    assert len(packet) == (7 if packet[5] == 13 else 17)
    native = actor.AI
    game = actor.GAME

    def animations(machine, rows):
        kinds = {0, 2, 3, 8, 69, 73, 92, 93}
        kinds.update(int(line.split()[2]) for line in rows if len(line.split()) == 6)
        kinds.update(int(line.split()[2]) for line in rows if len(line.split()) == 5 and line.split()[2] == "40")
        native.load_carrier_animations(machine, sorted(kinds))

    def prepare(machine, sources, width, height, rows):
        original = native.initialize_full_source_scn

        def with_terrain(machine, sources, rows):
            visibility.load_terrain(machine, sources, rows)
            original(machine, sources, rows)

        native.initialize_full_source_scn = with_terrain
        try:
            native.initialize_source_world(machine, sources, width, height, rows, actor.PLACEMENT,
                runtime=True, animations=animations, full_source=True)
        finally:
            native.initialize_full_source_scn = original

    machine = native.source_fixture("HUMAN", 2, prepare, False, fresh_game=True)
    native.put(machine, game + 0x544, 0x850000)
    native.put(machine, game + 0x530, 1)
    native.put(machine, game + 0x94C, 1)
    native.put(machine, native.NATIVE.FRAME - 4, game)
    machine.reg_write(native.UC_X86_REG_EBP, native.NATIVE.FRAME)
    machine.reg_write(native.UC_X86_REG_ESP, native.NATIVE.STACK)
    machine.emu_start(0x41989E, 0x419990, count=5000000)
    assert machine.reg_read(actor.UC_X86_REG_EIP) == 0x419990
    width = native.dword(machine, native.MAP + 0x9A4B0)
    original_registry = list(struct.unpack("<800h", machine.mem_read(game + 0x468EC, 1600)))

    def construct(identity):
        cell = native.GROUND + (identity["row"] * width + identity["column"]) * 4
        assert native.dword(machine, cell) & 1023 == 1023
        machine.mem_write(native.NATIVE.STACK + 4, struct.pack("<ii", identity["team"], -1))
        native.invoke(machine, 0x41B750, eax=game, edx=identity["column"], ebx=identity["row"], ecx=0)
        return machine.reg_read(native.UC_X86_REG_EAX)

    identities = {source["slot"]: source, **({target["slot"]: target} if target else {})}
    constructed = []
    for slot in range(170, max(identities) + 1):
        identity = identities.get(slot, {"column": 67 + slot - 170, "row": 48, "team": source["team"]})
        assert construct(identity) == slot
        constructed.append(slot)

    def receive(stream):
        machine.mem_write(0x709000, stream)
        native.invoke(machine, 0x41DEFC, eax=game, edx=0x709000, ebx=len(stream))
        assert machine.reg_read(native.UC_X86_REG_EAX) == 0

    target_proof = None
    if target:
        cell = native.GROUND + (target["row"] * width + target["column"]) * 4
        assert source["team"] == native.dword(machine, game + 0x7D1C) == 0
        mask = native.dword(machine, game + source["team"] * 0xE30 + 0x19C0)
        assert mask & 0x40000000
        before_visibility = native.dword(machine, cell)
        excluded = []
        high_water = native.dword(machine, game + 0x7D20)
        for slot in range(high_water + 1):
            raw = machine.mem_read(game + 0x7D28 + slot * 220, 220)
            if raw[0x2C] and raw[7] <= 7 and raw[0xCB] not in (1, 2) and slot != source["slot"]:
                excluded.append(slot)

        def bounded_visibility(emulator, address, size, context):
            slot = emulator.reg_read(native.UC_X86_REG_EDI)
            if slot in excluded:
                emulator.reg_write(actor.UC_X86_REG_EIP, 0x44AB5B)

        hook = machine.hook_add(UC_HOOK_CODE, bounded_visibility, begin=0x44A74C, end=0x44A74C)
        native.put(machine, game + 0x94C, 16)
        native.put(machine, native.NATIVE.FRAME - 4, game)
        machine.reg_write(native.UC_X86_REG_EBP, native.NATIVE.FRAME)
        machine.reg_write(native.UC_X86_REG_ESP, native.NATIVE.STACK)
        machine.reg_write(native.UC_X86_REG_EAX, game)
        machine.emu_start(0x419A30, 0x419A46, count=5000000)
        machine.hook_del(hook)
        assert machine.reg_read(actor.UC_X86_REG_EIP) == 0x419A46
        after_visibility = native.dword(machine, cell)
        assert after_visibility & 0xC0000000 == 0xC0000000, (source, target, hex(before_visibility), hex(after_visibility))
        target_proof = {"enemySlot": target["slot"],
            "enemyRaw": list(machine.mem_read(game + 0x7D28 + target["slot"] * 220, 220)),
            "visibility": {"before": before_visibility, "after": after_visibility, "counter": 16,
                "cell": target["row"] * width + target["column"],
                "producer": source["slot"], "excluded": excluded, "localTeam": 0, "mask": mask,
                "localTeamSetter": "0x40bf80", "maskSetter": "0x41993f..0x41996a",
                "caller": "0x419a30", "phases": ["0x4456f0", "0x44a6d4"],
                "producerExclusionBoundary": "0x44a74c->0x44ab5b",
                "terrain": machine.visibility_terrain_source}}
        native.invoke(machine, 0x435570, eax=game, edx=source["slot"], ebx=4)
        assert machine.reg_read(native.UC_X86_REG_EAX) == target["slot"]
        target_proof["acquired"] = machine.reg_read(native.UC_X86_REG_EAX)
    address = game + 0x7D28 + source["slot"] * 220
    before = list(machine.mem_read(address, 220))
    receive(packet[2:])
    received = list(machine.mem_read(address, 220))
    consume = request.get("consume", True)
    if consume:
        native.invoke(machine, 0x419248, eax=game, edx=source["slot"])
    after = list(machine.mem_read(address, 220))
    assert received[0x36:0x38] == [1, packet[5]]
    if consume:
        assert after[0x36:0x38] == [0, 255]
    registry = list(struct.unpack("<800h", machine.mem_read(game + 0x468EC, 1600)))
    assert all(registry[slot] == entry for slot, entry in enumerate(original_registry) if entry != -1)
    print(json.dumps({"packet": list(packet), "constructed": constructed, "before": before, "received": received,
        "after": after, "consumed": consume, "stack": [{"task": after[0x39]}], "target": target_proof,
        "originalRegistry": original_registry, "registry": registry,
        "binarySha256": native.NATIVE.AUDIT.DIGEST, "runtimeIntercepts": []}), flush=True)
    sys.exit(0)

for name, mode, order in (("MoveOnly", 7, 2), ("Attack", 7, 7), ("Stop", 5, 13), ("ZeroControl", 5, 0)):
    try:
        result = actor.capture(0, mode, 1, 1, order=order, updates=1, combat_inputs=True)
    except AssertionError as error:
        if name != "ZeroControl" or "caller=0x41948c" not in str(error):
            raise
        result = {"diagnostic": str(error), "order": order}
    else:
        assert name != "ZeroControl", "Order zero unexpectedly accepted"
    result["command"] = name
    print(json.dumps(result), flush=True)