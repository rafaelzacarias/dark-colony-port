"""Original x86 startup evidence for the bounded live production options builder."""

import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
BASE = runpy.run_path(str(ROOT / "tools/research/production-audit-20260919.py"))
CITY = runpy.run_path(str(ROOT / "tools/research/scenario-city-layout.py"))
IMAGE = (ROOT / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(IMAGE).hexdigest() == BASE["EXE_HASH"]

from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBP,
                              UC_X86_REG_EDI, UC_X86_REG_ESI, UC_X86_REG_ESP,
                              UC_X86_REG_GDTR, UC_X86_REG_CS, UC_X86_REG_DS,
                              UC_X86_REG_ES, UC_X86_REG_SS)
LIFECYCLE = runpy.run_path(str(ROOT / "tools/research/construction-lifecycle-20260919.py"))


def startup_teams(focused=False):
    native = LIFECYCLE["source_fixture"](IMAGE)
    machine = native.emulator
    machine.mem_write(0x707000, bytes(8) + bytes.fromhex("ffff0000009acf00ffff00000092cf00"))
    machine.reg_write(UC_X86_REG_GDTR, (0, 0x707000, 23, 0))
    machine.reg_write(UC_X86_REG_CS, 8)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
        machine.reg_write(register, 16)
    frame, configuration = 0x70F800, 0x840000
    native.put(frame - 8, configuration)
    machine.mem_write(configuration + 0x1494, b"\xa5" * 24)
    native.run(0x429952, {UC_X86_REG_EDX: configuration}, 0x429984)
    assert native.get(configuration + 0x14A0) == native.get(configuration + 0x1494) == 0
    native.stubs.update({0x41E7D8: None})
    results = []
    for path in sorted((ROOT / "raw_cd/DC/SCENARIO").rglob("*.SCN")):
        if focused and path.stem not in ("HUMAN01", "HUMAN02", "ALIEN01", "ALIEN02"):
            continue
        machine.mem_write(0x4F1880, LIFECYCLE["parsed_source"](IMAGE)[0])
        source = path.read_bytes()
        lines = [line.strip() for line in source.decode("ascii").splitlines()
                 if line.strip() and not line.lstrip().startswith("%")]
        player_start = next(index for index, line in enumerate(lines) if line.startswith("TEAM 0 "))
        load_configuration_header(native, configuration, int(lines[player_start + 1]))
        teams = []
        for team in range(8):
            start = next(index for index, line in enumerate(lines) if line.startswith(f"TEAM {team} "))
            rows = iter(lines[start + 1:start + 19])
            reads = []
            def read_line(current):
                line = next(rows)
                reads.append(line)
                current.emulator.mem_write(current.emulator.reg_read(UC_X86_REG_EAX), line.encode("ascii") + b"\0")
            native.stubs[0x41B8AC] = read_line
            side = BASE["GAME"] + 0xB98 + team * 0xE30
            machine.mem_write(side, b"\xa5" * 0xE30)
            native.put(frame - 12, team)
            native.run(0x41BD90, {UC_X86_REG_EBP: frame, UC_X86_REG_EDI: side,
                                UC_X86_REG_ESI: BASE["GAME"]}, 0x41C2B0)
            assert len(reads) == 18
            result = dict(team=team, race=native.get(side + 0x20), credits=native.get(side + 0x14),
                          costAccumulator=native.get(side + 0x18),
                          base=[native.get(side + 0x2C), native.get(side + 0x30)],
                          health=[native.get(side + 0x3C + slot * 4) for slot in range(5)],
                          levels=[native.get(side + 0xC4 + slot * 4) for slot in range(5)],
                          busy=[native.get(side + 0x78 + slot, 1) for slot in range(5)],
                          counts=[native.get(side + 0x110 + queue * 2, 2) for queue in range(4)],
                          ready=[native.get(side + 0x108 + queue, 1) for queue in range(4)],
                          delays=[native.get(side + 0x10C + queue, 1) for queue in range(4)],
                          restrictions=[identifier for identifier in range(110) if native.get(side + 0xDA4 + identifier, 1)],
                          upgrades=[[native.get(0x4F18B0 + unit_type * 280 + team, 1),
                                     native.get(0x4F18B8 + unit_type * 280 + team, 1)] for unit_type in range(106)])
            assert result["costAccumulator"] == 0
            assert result["counts"] == result["delays"] == [0] * 4
            assert result["ready"] == [1] * 4
            assert result["busy"] == [0] * 5
            teams.append(result)
        results.append(dict(path=str(path.relative_to(ROOT / "raw_cd/DC")),
                            sha256=hashlib.sha256(source).hexdigest(), teams=teams))
    assert len(results) == (4 if focused else 108)
    return results


def census_accessor():
    native = BASE["Native"](IMAGE)
    results = []
    for team in range(8):
        value = 101 + team
        native.put(0x4956E0 + team * 48 + 6 * 4, value)
        native.run(0x41A538, {UC_X86_REG_EAX: 6, UC_X86_REG_EDX: team})
        actual = native.emulator.reg_read(UC_X86_REG_EAX)
        assert actual == value
        results.append(actual)
    return results


def census_policy():
    native = BASE["Native"](IMAGE)
    game = BASE["GAME"]
    native.emulator.mem_write(game + 0x468EC, b"\xff" * 1600)
    fixtures = [(151, 0, 1, 100, True), (152, 0, 0, 0, True),
                (153, 0, 10, 0, True), (154, 1, 1, 100, True),
                (155, 8, 1, 100, True), (156, 0, 1, 100, False),
                (799, 0, 1, 100, True)]
    for slot, team, status, health, registered in fixtures:
        entity = game + 0x7D28 + slot * 220
        native.put(entity + 7, team, 1)
        native.put(entity + 0x2C, status, 1)
        native.put(entity + 12, health)
        native.put(game + 0x468EC + slot * 2, slot if registered else 65535, 2)
    native.run(0x4196F4, {UC_X86_REG_EAX: game}, 0x4197B4)
    populations = [native.get(0x4956F8 + team * 48) for team in range(8)]
    assert populations == [3, 1, 0, 0, 0, 0, 0, 0]
    return dict(fixtures=fixtures, populations=populations)


def cap_policy():
    results = []
    for ceiling, colonies, neutral, renat in [(150, 1, 7, 0), (150, 8, 7, 9),
                                             (75, 2, 10, 4), (150, 0, 20, 0)]:
        native = BASE["Native"](IMAGE)
        game = BASE["GAME"]
        native.put(game + 4, 0xA5A5A5A5)
        native.run(0x41BA36, {UC_X86_REG_ESI: game}, 0x41BA3D)
        assert native.get(game + 4) == 150
        native.put(game + 4, ceiling)
        for team in range(colonies):
            native.put(game + 0xB98 + team * 0xE30 + 0x3C, 1)
        for slot in range(152, 152 + neutral):
            native.put(game + 0x7D28 + slot * 220 + 7, 8, 1)
            native.put(game + 0x7D28 + slot * 220 + 0x2C, 1, 1)
        native.put(0x4796B0, 1)
        native.put(0x4FE07C, renat)
        native.run(0x41E6AC, {UC_X86_REG_EAX: game})
        limit = native.emulator.reg_read(UC_X86_REG_EAX)
        assert limit == min(ceiling, int((648 - neutral - renat - 100) / max(1, colonies)))
        results.append(dict(ceiling=ceiling, colonies=colonies, neutral=neutral, renat=renat, limit=limit))
    return results


def load_configuration_header(native, configuration, race):
    header = [1, 0, race, 0, 0, 0, 0, 0]
    def signature(machine):
        assert machine.emulator.reg_read(UC_X86_REG_EAX) == 0x21340002
        machine.emulator.reg_write(UC_X86_REG_EAX, 1)
    def read_words(machine):
        assert machine.emulator.reg_read(UC_X86_REG_EDX) == 8
        machine.emulator.mem_write(machine.emulator.reg_read(UC_X86_REG_EAX), struct.pack("<8i", *header))
        machine.emulator.reg_write(UC_X86_REG_EAX, 8)
    native.stubs.update({0x40695C: signature, 0x40667C: read_words})
    native.run(0x429F28, {UC_X86_REG_EAX: configuration, UC_X86_REG_EDX: 1}, 0x42A00B)
    assert native.get(configuration + 0x14A0) == 0
    assert native.get(configuration + 0x1494) == race
    return dict(provenance="explicit-user-selected-header-not-installed-config", header=header,
                mode=native.get(configuration + 0x14A0), race=native.get(configuration + 0x1494))


def configuration_loader():
    results = []
    for race in (0, 1):
        native = BASE["Native"](IMAGE)
        configuration = 0x840000
        native.emulator.mem_write(configuration, b"\xa5" * 0x1940)
        results.append(load_configuration_header(native, configuration, race))
    return results


def producer_sources():
    selectors = LIFECYCLE["parsed_source"](IMAGE)[2]["sourceUnitQueues"]
    native = LIFECYCLE["source_fixture"](IMAGE)
    for entry in selectors:
        address = 0x41ADD0 + entry["queue"] * 24 + entry["exitSelector"] * 8
        entry["exitOffset"] = dict(zip(("x", "y"), struct.unpack("<ii", native.emulator.mem_read(address, 8))))
    loaded = LIFECYCLE["load_fin"](native, (0, 8))
    profiles = []
    for binding in loaded["bindings"]:
        state = binding["constructionState"]
        bank = binding["constructionBank"]
        directions = []
        for direction in range(32):
            descriptor = native.get(bank + direction * 4)
            frames = native.get(descriptor + 0x20)
            directions.append([native.get(frames + index * 72 + 2, 1)
                               for index in range(native.get(descriptor + 0x28))])
        profiles.append(dict(unitType=binding["unitType"], id=state["name"], bankField=152,
                             finSha256=next(entry["sha256"] for entry in loaded["sources"] if entry["source"] == state["source"]),
                             directions=directions))
    return dict(units=selectors, profiles=profiles)


def mission_population(scenarios):
    placement = runpy.run_path(str(ROOT / "tools/research/scenario-placement-20260919.py"))
    resource = placement["RESOURCE"]
    results = []
    for name in ("HUMAN01", "HUMAN02", "ALIEN01", "ALIEN02"):
        data, races, rows = placement["source"](name)
        machine = placement["fixture"](races, 152, 152, 0)
        game, frame, stack = placement["GAME"], placement["FRAME"], placement["STACK"]
        machine.mem_write(game + 0x468EC, b"\xa5" * 1600)
        machine.reg_write(UC_X86_REG_EDX, game)
        resource.execute(machine, 0x40C058, 0x40C079)
        assert machine.mem_read(game + 0x468EC, 1600) == b"\xff" * 1600
        for text in rows:
            machine.mem_write(frame - 0x47C, text.encode("ascii") + b"\0")
            machine.reg_write(UC_X86_REG_ESP, stack)
            resource.execute(machine, 0x41C453, 0x41C438)
        source = next(entry for entry in scenarios if Path(entry["path"]).stem == name)
        for team in source["teams"]:
            for slot, health in enumerate(team["health"]):
                resource.put(machine, game + 0xB98 + team["team"] * 0xE30 + 0x3C + slot * 4, health)
        machine.reg_write(UC_X86_REG_ESI, game)
        resource.execute(machine, 0x41BA36, 0x41BA3D)
        machine.reg_write(UC_X86_REG_ESP, stack)
        machine.reg_write(UC_X86_REG_EAX, game)
        resource.execute(machine, 0x4196F4, 0x4197B4)
        population = [resource.get(machine, 0x4956F8 + team * 48) for team in range(8)]
        machine.reg_write(UC_X86_REG_ESP, stack)
        machine.reg_write(UC_X86_REG_EAX, game)
        resource.put(machine, stack, resource.STOP)
        resource.execute(machine, 0x41E6AC, resource.STOP)
        limit = machine.reg_read(UC_X86_REG_EAX)
        entities = []
        for slot in range(152, 800):
            entity = game + 0x7D28 + slot * 220
            status = resource.get(machine, entity + 0x2C, "B")
            registered = resource.get(machine, game + 0x468EC + slot * 2, "h") != -1
            if status or registered:
                entities.append(dict(slot=slot, team=resource.get(machine, entity + 7, "B"), status=status,
                                     registered=registered, unitType=resource.get(machine, entity + 6, "B")))
        results.append(dict(name=name, sourceSha256=hashlib.sha256(data).hexdigest(), population=population,
                            limit=limit, entities=entities, renatCount=resource.get(machine, 0x4796B0),
                            renatHex=bytes(machine.mem_read(0x4FE06C, 1000)).hex()))
    for result in results:
        assert sum(result["population"]) == sum(entity["registered"] and entity["team"] < 8 for entity in result["entities"])
        assert sum(result["population"]) <= len(result["entities"])
    return results


if __name__ == "__main__":
    scenarios = startup_teams("--focused" in sys.argv)
    print(json.dumps({"executableSha256": BASE["EXE_HASH"], "censusAccessor": census_accessor(),
                      "census": census_policy(), "caps": cap_policy(),
                      "configuration": configuration_loader(), "production": producer_sources(),
                      "scenarios": scenarios, "missions": mission_population(scenarios)}))