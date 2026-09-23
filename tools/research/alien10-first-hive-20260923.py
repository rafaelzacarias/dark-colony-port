"""Read-only ALIEN10 startup economy and executable call-site evidence."""

import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_EDX, UC_X86_REG_EBP,
    UC_X86_REG_EDI, UC_X86_REG_ESI, UC_X86_REG_GDTR, UC_X86_REG_CS,
    UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS,
)

ROOT = Path(__file__).resolve().parents[2]
STARTUP = runpy.run_path(str(ROOT / "tools/qa/source-production-startup-native.py"))
BASE, LIFECYCLE, IMAGE = STARTUP["BASE"], STARTUP["LIFECYCLE"], STARTUP["IMAGE"]


def disassemble(native, start, end):
    return [f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}"
            for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(
                bytes(native.emulator.mem_read(start, end - start)), start)]


def startup_probe():
    spec = importlib.util.spec_from_file_location("alien10_visibility_research", ROOT / "tools/qa/native-visibility-native.py")
    visibility = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(visibility)
    ai = visibility.AI
    machine = ai.fixture()
    header = struct.unpack_from("<I", IMAGE, 0x3C)[0]
    sections = header + 24 + struct.unpack_from("<H", IMAGE, header + 20)[0]
    for index in range(struct.unpack_from("<H", IMAGE, header + 6)[0]):
        section = sections + index * 40
        virtual_size, relative = struct.unpack_from("<II", IMAGE, section + 8)
        if struct.unpack_from("<I", IMAGE, section + 36)[0] & 0x80:
            machine.mem_write(0x400000 + relative, bytes(virtual_size))
    ai.initialize_fresh_game(machine)
    directory = ROOT / "raw_cd/DC/SCENARIO/ALIEN"
    sources = {extension: (directory / f"ALIEN10.{extension}").read_bytes()
               for extension in ("SCN", "MAP", "PTH", "MTG", "TRO", "MSG")}
    width, height = struct.unpack_from("<II", sources["MAP"])
    rows = [line.strip() for line in sources["SCN"].decode("ascii").splitlines()
            if line.strip() and not line.lstrip().startswith("%")]
    ai.put(machine, ai.NATIVE.GAME + 0x46F2C, ai.MAP)
    ai.put(machine, ai.MAP + 0x9A4B0, width)
    ai.put(machine, ai.MAP + 0x9A4B4, height)
    ai.put(machine, ai.MAP + 0x1404, ai.PATH_ROWS)
    machine.mem_write(ai.MAP + 0x884A8, sources["PTH"][:65536])
    for tile_y in range(height):
        ai.put(machine, ai.PATH_ROWS + tile_y * 4, ai.PATH_CELLS + tile_y * width * 24)
        ai.put(machine, ai.MAP + 0x804 + tile_y * 4, ai.GROUND + tile_y * width * 4)
        machine.mem_write(ai.GROUND + tile_y * width * 4, struct.pack("<I", 1023) * width)
    ai.initialize_source_path(machine, sources["PTH"], width, height)
    original = inspect.getsource(ai.initialize_full_source_scn)
    assert original.count("{faction}02") == 1 and original.count("{faction.lower()}02") == 1
    routed = original.replace("{faction}02", "{faction}10").replace("{faction.lower()}02", "{faction.lower()}10")
    namespace = dict(ai.__dict__)
    exec(compile(routed, "<ALIEN10 research-only file routing>", "exec"), namespace)
    loader = namespace["initialize_full_source_scn"]

    def initialize_scn(current, content, lines):
        visibility.load_terrain(current, content, lines)
        loader(current, content, lines)

    def animations(current, lines):
        unit_types = {40, 69, 73, 92, 93}
        unit_types.update(value for value in struct.unpack("<60i", ai.NATIVE.READ(0x47AFA8, 240)) if 0 <= value < 106)
        unit_types.update(int(line.split()[2]) for line in lines if len(line.split()) == 6)
        ai.load_carrier_animations(current, sorted(unit_types))

    ai.initialize_full_source_scn = initialize_scn
    ai.initialize_source_world(machine, sources, width, height, rows, visibility.ACTOR.PLACEMENT,
                               runtime=True, animations=animations, full_source=True)
    evidence = machine.source_scn
    player = [actor for actor in evidence["actors"] if actor["owner"] == 0]
    money = ai.dword(machine, ai.NATIVE.GAME + 0xBAC)
    assert money == 1500
    assert not any(actor["type"] in (14, 28, 73, 74, 75, 76) for actor in player)
    city_before = bytes(machine.mem_read(ai.NATIVE.GAME + 0xBD4, 15 * 4))
    dependencies_before = bytes(machine.mem_read(0x4E6D70, 110 * 52))
    machine.mem_write(ai.NATIVE.STACK + 4, struct.pack("<i", 0))
    ai.invoke(machine, 0x41B634, eax=ai.NATIVE.GAME, edx=111, ebx=8, ecx=73)
    commander_slot = machine.reg_read(ai.UC_X86_REG_EAX)
    commander = bytes(machine.mem_read(ai.NATIVE.GAME + 0x7D28 + commander_slot * 220, 220))
    assert commander[6:8] == bytes((73, 0))
    assert ai.dword(machine, ai.NATIVE.GAME + 0xBAC) == money
    assert bytes(machine.mem_read(ai.NATIVE.GAME + 0xBD4, 15 * 4)) == city_before
    assert bytes(machine.mem_read(0x4E6D70, 110 * 52)) == dependencies_before
    assert all((directory / f"ALIEN10.{extension}").read_bytes() == content
               for extension, content in sources.items())
    commander_control = {"scope": "direct-delivery-constructor-control-not-TRO-or-carrier-progression",
                         "entry": "41b634", "requestedSourceDelivery": [0, 111, 8, 73],
                         "slot": commander_slot, "raw": commander.hex(),
                         "moneyUnchanged": True, "cityHealthUnchanged": True,
                         "dependenciesUnchanged": True}
    return {"scope": "complete-original-ALIEN10-SCN-loader-not-world-cycles",
            "harnessAdaptation": "two mission02 TRO/MSG path substitutions in memory only",
            "executableSha256": BASE["EXE_HASH"],
            "sourceHashes": {key: hashlib.sha256(value).hexdigest() for key, value in sources.items()},
            "creditsAfterLoader": money, "profile": machine.source_profile,
            "headerState": {hex(offset): ai.dword(machine, ai.NATIVE.GAME + offset)
                            for offset in (0x530, 0x534, 0x538, 0x53C, 0x540)},
            "sourceInputsUnchanged": True,
            "scn": {key: value for key, value in evidence.items() if key not in ("entities", "registry", "actors")},
            "playerActors": player, "actorCount": len(evidence["actors"]),
            "commanderConstructorControl": commander_control,
            "localTeam": ai.dword(machine, ai.NATIVE.GAME + 0x7D1C),
            "centralDependencyCost": ai.dword(machine, 0x4E6D78 + 14 * 52)}


def probe():
    native = LIFECYCLE["source_fixture"](IMAGE)
    machine = native.emulator
    machine.mem_write(0x707000, bytes(8) + bytes.fromhex("ffff0000009acf00ffff00000092cf00"))
    machine.reg_write(UC_X86_REG_GDTR, (0, 0x707000, 23, 0))
    machine.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
        machine.reg_write(register, 16)
    frame, configuration = 0x70F800, 0x850000
    native.put(frame - 8, configuration)
    native.run(0x429952, {UC_X86_REG_EDX: configuration}, 0x429984)
    profile = STARTUP["load_configuration_header"](native, configuration, 1)
    native.stubs[0x41E7D8] = None
    scenario = ROOT / "raw_cd/DC/SCENARIO/ALIEN/ALIEN10.SCN"
    rows = [line.strip() for line in scenario.read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("%")]
    teams = []
    for team in range(8):
        start = next(index for index, line in enumerate(rows) if line.startswith(f"TEAM {team} "))
        source_rows = rows[start + 1:start + 19]
        reads = []

        def read_line(current):
            line = source_rows[len(reads)]
            reads.append(line)
            current.emulator.mem_write(current.emulator.reg_read(UC_X86_REG_EAX), line.encode("ascii") + b"\0")

        native.stubs[0x41B8AC] = read_line
        side = BASE["GAME"] + 0xB98 + team * 0xE30
        machine.mem_write(side, bytes(0xE30))
        native.put(frame - 12, team)
        native.run(0x41BD90, {UC_X86_REG_EBP: frame, UC_X86_REG_EDI: side,
                              UC_X86_REG_ESI: BASE["GAME"]}, 0x41C2B0)
        assert reads == source_rows
        teams.append({"team": team, "sourceMoney": int(source_rows[1]),
                      "nativeMoney": native.get(side + 0x14),
                      "costAccumulator": native.get(side + 0x18),
                      "race": native.get(side + 0x20),
                      "cityHealth": [native.get(side + 0x3C + slot * 4) for slot in range(5)]})
    native.run(0x437BC4, {UC_X86_REG_EAX: BASE["GAME"]})
    eligibility = {str(dependency): {"state": native.get(0x4E6D74 + dependency * 52),
                                    "cost": native.get(0x4E6D78 + dependency * 52)}
                   for dependency in (0, 14, 16, 21)}
    menu, menu_queue = 0x702000, 0x704000
    native.put(menu + 0xC, BASE["GAME"])
    native.put(menu + 0x7F4, menu_queue)
    queue_writes = []

    def menu_event(current):
        current.put(current.emulator.reg_read(UC_X86_REG_EBX), 205)
        current.emulator.reg_write(UC_X86_REG_EAX, 4)

    native.stubs.update({0x4240DC: menu_event,
                         0x42776C: lambda current: current.emulator.reg_write(UC_X86_REG_EAX, 0),
                         0x4277FC: lambda current: queue_writes.append(current.emulator.reg_read(UC_X86_REG_EBX))})
    world_before = bytes(machine.mem_read(BASE["GAME"], 0x471B0))
    native.run(0x433124, {UC_X86_REG_EAX: menu})
    assert bytes(machine.mem_read(BASE["GAME"], 0x471B0)) == world_before
    assert queue_writes == []
    menu_control = {"entry": "433124", "scope": "UI-event-and-queue-read-stubs-only",
                    "interfaceId": 205, "sourceCredits": 1500,
                    "worldUnchanged": True, "queueWrites": queue_writes,
                    "result": "purchase-refused"}
    prices = []
    for race in (0, 1):
        for slot in (0, 3):
            native.run(0x4380D8, {UC_X86_REG_EAX: slot, UC_X86_REG_EDX: 0, UC_X86_REG_EBX: race})
            prices.append({"helper": "4380d8", "race": race, "slot": slot,
                           "cost": machine.reg_read(UC_X86_REG_EAX)})
    for unit_type in (6, 14, 16, 28, 73):
        native.run(0x438090, {UC_X86_REG_EAX: unit_type})
        prices.append({"helper": "438090", "unitType": unit_type,
                       "cost": machine.reg_read(UC_X86_REG_EAX)})
    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.skipdata = True
    instructions = list(decoder.disasm(
        bytes(machine.mem_read(0x401000, 0x73000)), 0x401000))
    targets = {"0x438074", "0x438090", "0x4380d8", "0x41c8d4", "0x444f14"}
    calls = []
    for index, instruction in enumerate(instructions):
        if instruction.mnemonic == "call" and instruction.op_str in targets:
            calls.append({"target": instruction.op_str, "address": hex(instruction.address),
                          "context": [f"{entry.address:08x} {entry.mnemonic} {entry.op_str}"
                                      for entry in instructions[max(0, index - 10):index + 8]]})
    assert teams[0]["nativeMoney"] == teams[0]["sourceMoney"] == 1500
    assert teams[0]["cityHealth"] == [0] * 5
    return {"scope": "bounded-original-team-scanner-and-price-helpers-not-full-startup",
            "executableSha256": BASE["EXE_HASH"], "configuration": profile,
            "sourceHashes": {extension: hashlib.sha256(scenario.with_suffix("." + extension).read_bytes()).hexdigest()
                             for extension in ("SCN", "TRO", "TXT")},
            "teams": teams, "prices": prices, "liveDependencies": eligibility, "callSites": calls,
            "menuAffordabilityControl": menu_control,
            "teamMoneyScanner": disassemble(native, 0x41BD90, 0x41BF00),
            "constructionReceiver": disassemble(native, 0x41C8D4, 0x41CB20),
            "stubAddresses": [hex(address) for address in native.stubs]}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--startup":
        print(json.dumps(startup_probe(), indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "--disassemble":
        native = BASE["Native"](IMAGE)
        print(json.dumps({bounds: disassemble(native, *[int(value, 16) for value in bounds.split(":")])
                          for bounds in sys.argv[2:]}, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "--calls":
        native = BASE["Native"](IMAGE)
        code = bytes(native.emulator.mem_read(0x401000, 0x73000))
        targets = {int(value, 16) for value in sys.argv[2:]}
        calls = []
        for offset in range(len(code) - 5):
            if code[offset] != 0xE8:
                continue
            target = 0x401000 + offset + 5 + int.from_bytes(code[offset + 1:offset + 5], "little", signed=True)
            if target in targets:
                address = 0x401000 + offset
                calls.append({"address": hex(address), "target": hex(target),
                              "context": disassemble(native, address - 32, address + 24)})
        print(json.dumps(calls, indent=2))
    else:
        print(json.dumps(probe(), indent=2))