"""Bounded native demand/rule evidence; never replays the world scheduler."""

import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ai_policy", Path(__file__).with_name("ai-policy-20260919.py"))
AI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AI)


def rules():
    return list(struct.iter_unpack("<IIi", AI.NATIVE.READ(0x48903C, 216)))


def capture(faction, owner, source_proof, natural_trace):
    spec = importlib.util.spec_from_file_location("placement", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    proof_bytes = Path(source_proof).read_bytes()
    proof = next(json.loads(line) for line in proof_bytes.splitlines() if json.loads(line)["mission"] == faction + "02")
    machine, _, _, width, families = AI.source_fixture(
        faction, owner, lambda *args: AI.initialize_source_world(*args, placement))
    production_spec = importlib.util.spec_from_file_location(
        "production", Path(__file__).with_name("construction-lifecycle-20260919.py"))
    production = importlib.util.module_from_spec(production_spec)
    production_spec.loader.exec_module(production)
    producer = production.source_fixture(AI.NATIVE.IMAGE)
    machine.mem_write(0x4E6D70, bytes(producer.emulator.mem_read(0x4E6D70, 110 * 52)))
    assert any(machine.mem_read(0x4E6D70, 110 * 52))
    game, policy = AI.NATIVE.GAME, AI.POLICY
    for team in proof["sourceScnInitialization"]["teams"]:
        machine.mem_write(game + 0xB98 + team["owner"] * 0xE30, bytes.fromhex(team["raw"]))
    machine.mem_write(game + 0x7D28, base64.b64decode(proof["sourceScnInitialization"]["entities"]))
    AI.put(machine, 0x479204, 0)
    encoded = lambda address, length: base64.b64encode(machine.mem_read(address, length)).decode()
    snapshot = lambda: {"policy": encoded(policy, 0x6C40), "entities": encoded(game + 0x7D28, 800 * 220),
                        "teams": encoded(game + 0xB98, 8 * 0xE30), "rngCursor": AI.dword(machine, 0x479204),
                        "forceOrder": machine.mem_read(0x489510, 1)[0]}
    matrix_pointer, columns = AI.dword(machine, 0x4F98D0), AI.dword(machine, 0x4F98C8)
    matrix_rows = int([line for line in (AI.NATIVE.ROOT / "raw_cd/DC/GAMESTAT/MBULLET.TXT").read_text().splitlines()
                       if line.strip() and not line.lstrip().startswith("%")][1])
    inputs = {"types": encoded(0x4F1880, 110 * 280), "weapons": encoded(0x4F0200, 80 * 72),
              "dependencies": encoded(0x4E6D70, 110 * 52),
              "cityDependencies": list(struct.unpack("<18i", AI.NATIVE.READ(0x488FF4, 72))),
              "matrix": [list(struct.unpack(f"<{columns}h", machine.mem_read(AI.dword(machine, matrix_pointer + row * 4), columns * 2)))
                         for row in range(matrix_rows)],
              "relations": list(machine.mem_read(game + 0x46F34, 100)),
              "visibilityMasks": [AI.dword(machine, game + 0x19C0 + team * 0xE30) for team in range(8)],
              "occupancy": [AI.dword(machine, AI.dword(machine, AI.MAP + 0x804 + tile_y * 4) + tile_x * 4)
                            for tile_y in range(len(families) // width) for tile_x in range(width)]}
    pristine = snapshot()
    AI.invoke(machine, 0x457568, eax=game, edx=owner, ebx=policy)
    machine.mem_write(policy, b"\0")
    AI.invoke(machine, 0x456AD0, eax=game, edx=owner, ebx=policy)
    prepared = snapshot()
    packets, visited, pending = [], [], []
    current_counts = []

    def hook(emulator, address, size, context):
        nonlocal current_counts
        stack = emulator.reg_read(AI.UC_X86_REG_ESP)
        if address == 0x421648:
            length = emulator.reg_read(AI.UC_X86_REG_EDX)
            packet = bytearray(emulator.mem_read(emulator.reg_read(AI.UC_X86_REG_EAX), length))
            struct.pack_into("<H", packet, 0, length)
            packets.append(packet.hex())
            emulator.reg_write(AI.UC_X86_REG_EIP, AI.dword(emulator, stack))
            emulator.reg_write(AI.UC_X86_REG_ESP, stack + 4)
        elif address == 0x4578D0:
            current_counts = list(struct.unpack("<9i", emulator.mem_read(emulator.reg_read(AI.UC_X86_REG_ECX), 36)))
        elif address == 0x457912:
            pending[-1]["result"] = emulator.reg_read(AI.UC_X86_REG_EAX)
        else:
            visited.append({"callback": hex(address), "parameter": AI.dword(emulator, stack + 4)})
            if address in {rule[0] for rule in rules()}:
                pending.append(visited[-1])

    for address in {0x421648, 0x4578D0, 0x457912} | {entry for rule in rules() for entry in rule[:2]}:
        machine.hook_add(AI.UC_HOOK_CODE, hook, begin=address, end=address)

    def restore(saved):
        machine.mem_write(policy, base64.b64decode(saved["policy"]))
        machine.mem_write(game + 0x7D28, base64.b64decode(saved["entities"]))
        machine.mem_write(game + 0xB98, base64.b64decode(saved["teams"]))
        AI.put(machine, 0x479204, saved["rngCursor"])
        machine.mem_write(0x489510, bytes((saved["forceOrder"],)))

    cases = []
    def run(label, team, pipeline=False, provenance="controlled-source-state"):
        packets.clear()
        visited.clear()
        pending.clear()
        before = snapshot()
        if pipeline:
            if machine.mem_read(policy, 1)[0]:
                AI.invoke(machine, 0x457568, eax=game, edx=team, ebx=policy)
            machine.mem_write(policy, b"\0")
            AI.invoke(machine, 0x456AD0, eax=game, edx=team, ebx=policy)
        population = AI.dword(machine, 0x4956E0 + team * 48 + 24)
        limit = AI.dword(machine, game + 0x528)
        AI.invoke(machine, 0x457940, eax=game, edx=policy, ebx=team)
        cases.append({"label": label, "team": team, "pipeline": pipeline, "provenance": provenance,
                      "population": population, "populationLimit": limit, "before": before, "after": snapshot(),
                      "counts": current_counts[:], "callbacks": visited[:], "packets": packets[:]})

    AI.put(machine, game + 0x528, 150)
    run("source-prepared", owner)
    restore(pristine)
    run("source-pipeline", owner, True)
    restore(pristine)
    machine.mem_write(game + 0xB98 + 7 * 0xE30,
                      base64.b64decode(pristine["teams"])[owner * 0xE30:(owner + 1) * 0xE30])
    for slot in range(800):
        address = game + 0x7D28 + slot * 220 + 7
        if machine.mem_read(address, 1)[0] == owner:
            machine.mem_write(address, b"\x07")
    machine.mem_write(policy + 0x6C38 + owner, b"\0")
    machine.mem_write(policy + 0x6C38 + 7, b"\x01")
    run("remapped-pipeline", 7, True)
    for team in (owner, 7):
        for total in (0, 5, 10, 15, 20, 30, 200):
            restore(prepared)
            source_team = base64.b64decode(prepared["teams"])[owner * 0xE30:(owner + 1) * 0xE30]
            side = game + 0xB98 + team * 0xE30
            machine.mem_write(side, source_team)
            machine.mem_write(side + 0xDA4, bytes(110))
            for city in range(15):
                AI.put(machine, side + 0x3C + city * 4, 100)
                AI.put(machine, side + 0xC4 + city * 4, 10)
                machine.mem_write(side + 0x78 + city, b"\0")
            AI.put(machine, side + 0x14, 100000)
            AI.put(machine, 0x4956E0 + team * 48 + 24, 0)
            for group in range(4):
                for bucket in range(16):
                    machine.mem_write(policy + group * 0x12FC + bucket * 300 + 0x1FAA, b"\xff" * 4)
            for slot in range(120, 800):
                machine.mem_write(game + 0x7D28 + slot * 220 + 0xD2, b"\xff\xff")
            for queue in range(4):
                machine.mem_write(side + 0x110 + queue * 2, b"\0\0")
            race = AI.dword(machine, side + 0x20)
            machine.mem_write(side + 0x110, struct.pack("<H", total + 2))
            machine.mem_write(side + 0x118, bytes((6 + race * 8,)) * 2 + bytes((race * 8,)) * total)
            before_complete = snapshot()
            run(f"weighted-{total}-team-{team}", team)
            if total == 0 and team == owner:
                complete = before_complete
    for label in ("harvester-empty", "harvester-one", "harvester-unaffordable", "population-cap", "negative-credits",
                  "city-missing", "city-busy", "city-restricted", "city-unaffordable", "disabled-bucket", "four-queues"):
        restore(complete)
        side = game + 0xB98 + owner * 0xE30
        AI.put(machine, 0x4956E0 + owner * 48 + 24, 0)
        race = AI.dword(machine, side + 0x20)
        if label.startswith("harvester"):
            machine.mem_write(side + 0x110, struct.pack("<H", 1 if label == "harvester-one" else 0))
            if label == "harvester-unaffordable":
                AI.put(machine, side + 0x14, 0)
        if label == "negative-credits":
            AI.put(machine, side + 0x14, 0xFFFFFFFF)
        if label == "population-cap":
            AI.put(machine, 0x4956E0 + owner * 48 + 24, 150)
        if label.startswith("city"):
            source = inputs["cityDependencies"][16 + race]
            city = AI.dword(machine, 0x4E6D70 + source * 52 + 20)
            AI.put(machine, side + 0x3C + city * 4, 0)
            if label == "city-busy":
                machine.mem_write(side + 0x78 + city, b"\x01")
            if label == "city-restricted":
                machine.mem_write(side + 0xDA4 + source, b"\x01")
            if label == "city-unaffordable":
                AI.put(machine, side + 0x14, 0)
        if label == "disabled-bucket":
            machine.mem_write(policy + 0x12FC + 300 + 0x1FAE, b"\xaa" * 18)
        if label == "four-queues":
            for queue, unit_type in enumerate((41, 49, 16, 42)):
                machine.mem_write(side + 0x110 + queue * 2, struct.pack("<H", 1))
                machine.mem_write(side + 0x118 + queue * 800, bytes((unit_type,)))
        run(label, owner)
    for index, (predicate, _, parameter) in enumerate(rules()):
        restore(complete)
        side = game + 0xB98 + owner * 0xE30
        race = AI.dword(machine, side + 0x20)
        AI.put(machine, 0x4956E0 + owner * 48 + 24, 0)
        harvesters = parameter - 1 if predicate == 0x45642C else 2
        total = parameter - 1 if predicate == 0x456664 else 200
        machine.mem_write(side + 0x110, struct.pack("<H", harvesters + total))
        machine.mem_write(side + 0x118, bytes((race * 8 + 6,)) * harvesters + bytes((race * 8,)) * total)
        expected_rule = index
        if predicate == 0x4564C8:
            source = inputs["cityDependencies"][parameter * 2 + race]
            city = AI.dword(machine, 0x4E6D70 + source * 52 + 20)
            level = AI.dword(machine, 0x4E6D70 + source * 52 + 24)
            if AI.dword(machine, 0x4E6D70 + source * 52 + 16) == 2:
                machine.mem_write(side + 0x78 + city, b"\x01")
                expected_rule = 4 if race == 0 else 12
            elif level == 0:
                AI.put(machine, side + 0x3C + city * 4, 0)
            else:
                AI.put(machine, side + 0xC4 + city * 4, level - 1)
        run(f"select-rule-{index}", owner)
        cases[-1]["expectedRule"] = expected_rule
        assert len([entry for entry in visited if "result" in entry]) == expected_rule + 1, (faction, index, visited)
    for label in ("weighted-nonzero", "weighted-overflow", "weighted-saturated", "weighted-no-candidate"):
        restore(complete)
        side = game + 0xB98 + owner * 0xE30
        race = AI.dword(machine, side + 0x20)
        AI.put(machine, 0x4956E0 + owner * 48 + 24, 0)
        queued = bytes(race * 8 + kind for kind in range(8)) * 2
        machine.mem_write(side + 0x110, struct.pack("<H", len(queued)))
        machine.mem_write(side + 0x118, queued)
        if label in ("weighted-overflow", "weighted-saturated"):
            for weight in range(7):
                AI.put(machine, policy + 0x6C18 + weight * 4, 0x7FFFFFFF if label == "weighted-overflow" else 5000)
        if label == "weighted-no-candidate":
            for source in range(110):
                if AI.dword(machine, 0x4E6D70 + source * 52 + 16) == 1:
                    machine.mem_write(side + 0xDA4 + source, b"\x01")
        run(label, owner)
    predicate_cases = []
    restore(complete)
    machine.mem_write(game + 0xB98 + owner * 0xE30 + 0x78, bytes((1,)) * 15)
    busy = snapshot()
    for saved_label, saved in (("source", prepared), ("complete", complete), ("busy", busy)):
        for count_value, population in ((0, 0), (200, 150), (2147483647, 0)):
            restore(saved)
            AI.put(machine, 0x4956E0 + owner * 48 + 24, population)
            counts = [count_value] * 9
            machine.mem_write(0x70A000, struct.pack("<9i", *counts))
            for index, (predicate, _, parameter) in enumerate(rules()):
                AI.put(machine, AI.NATIVE.STACK, AI.RETURN)
                AI.put(machine, AI.NATIVE.STACK + 4, parameter)
                for name, value in (("ESP", AI.NATIVE.STACK), ("EAX", game), ("EDX", policy), ("EBX", owner), ("ECX", 0x70A000)):
                    machine.reg_write(getattr(AI, "UC_X86_REG_" + name), value)
                machine.emu_start(predicate, AI.RETURN, count=100000)
                assert machine.reg_read(AI.UC_X86_REG_EIP) == AI.RETURN
                predicate_cases.append({"label": saved_label, "rule": index, "counts": counts, "population": population,
                                        "populationLimit": 150, "teamBytes": encoded(game + 0xB98 + owner * 0xE30, 0xE30),
                                        "result": machine.reg_read(AI.UC_X86_REG_EAX)})
    natural_bytes = Path(natural_trace).read_bytes()
    natural = json.loads(natural_bytes)
    group = next(group for group in natural["groupCompletions"] if group["group"] == 0 and group["team"] == owner)
    natural_evidence = {"sha256": hashlib.sha256(natural_bytes).hexdigest(), "frame": group["frame"],
                        "seed": natural["sourceScnInitialization"]["policyRng"],
                        "demandInputsCaptured": False,
                        "limitation": "Historical group captures start after demand; no historical demand before/team/census buffers."}
    return {"mission": faction + "02", "team": owner, "inputs": inputs, "cases": cases, "predicateCases": predicate_cases,
            "navigation": {"width": width, "height": len(families) // width,
                           "families": base64.b64encode(families).decode(), "nextFamily": encoded(AI.MAP + 0x884A8, 65536)},
            "ruleTable": base64.b64encode(AI.NATIVE.READ(0x48903C, 216)).decode(),
            "sourceProofSha256": hashlib.sha256(proof_bytes).hexdigest(), "naturalEvidence": natural_evidence,
            "externalBoundary": "0x421648 transport capture only; 0x40c13c/0x40c168 execute; receipt/lifecycle NOT executed",
            "admitted": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--source-proof", default="/tmp/dc-ai-gap-source-proof-20260919-16.jsonl")
    parser.add_argument("--human-world", default="/tmp/dc-ai-gap-natural-human-20260919-25.jsonl")
    parser.add_argument("--alien-world", default="/tmp/dc-ai-gap-natural-alien-20260919-24.jsonl")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps([{"predicate": hex(predicate), "action": hex(action), "parameter": parameter}
                          for predicate, action, parameter in rules()]))
        for address in sorted({entry for rule in rules() for entry in rule[:2]} | {0x459D98, 0x44B6A4}):
            print(f"CALLBACK {address:#x}")
            for instruction in AI.Cs(AI.CS_ARCH_X86, AI.CS_MODE_32).disasm(AI.NATIVE.READ(address, 4096), address):
                print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")
                if instruction.mnemonic.startswith("ret"):
                    break
        return
    for faction, owner, path in (("HUMAN", 2, args.human_world), ("ALIEN", 1, args.alien_world)):
        print(json.dumps(capture(faction, owner, args.source_proof, path)))


if __name__ == "__main__":
    main()