"""Original group-2 decision and shared route helper evidence."""

import importlib.util
import argparse
import base64
import hashlib
import json
import struct
from pathlib import Path
import sys

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ai_policy", Path(__file__).with_name("ai-policy-20260919.py"))
AI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AI)


def disassemble():
    for address, length in ((0x457CC0, 0x4BC), (0x44B640, 0x64)):
        for instruction in AI.Cs(AI.CS_ARCH_X86, AI.CS_MODE_32).disasm(AI.NATIVE.READ(address, length), address):
            print(f"{instruction.address:08x} {instruction.mnemonic} {instruction.op_str}")


def capture(faction, team, natural_traces):
    spec = importlib.util.spec_from_file_location("placement", Path(__file__).with_name("scenario-placement-20260919.py"))
    placement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(placement)
    machine, _, _, width, families = AI.source_fixture(
        faction, team, lambda *args: AI.initialize_source_world(*args, placement))
    encode = lambda address, length: base64.b64encode(machine.mem_read(address, length)).decode()
    snapshot = lambda: {"policy": encode(AI.POLICY, 0x6C40),
                        "entities": encode(AI.NATIVE.GAME + 0x7D28, 800 * 220),
                        "rngCursor": AI.dword(machine, 0x479204),
                        "forceOrder": machine.mem_read(0x489510, 1)[0]}
    initial = None

    def stop_at_group(emulator, address, size, context):
        nonlocal initial
        if address == 0x4578A0 and emulator.reg_read(AI.UC_X86_REG_EBX) == 2:
            initial = snapshot()
            emulator.emu_stop()
        elif address == 0x421725:
            emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)

    hooks = [machine.hook_add(AI.UC_HOOK_CODE, stop_at_group, begin=address, end=address)
             for address in (0x4578A0, 0x421725)]
    try:
        AI.invoke(machine, 0x44BE40, eax=AI.NATIVE.GAME, edx=team)
    except AssertionError:
        assert initial is not None
    for hook in hooks:
        machine.hook_del(hook)
    assert initial is not None
    columns = AI.dword(machine, 0x4F98C8)
    rows = int([line for line in (AI.NATIVE.ROOT / "raw_cd/DC/GAMESTAT/MBULLET.TXT").read_text().splitlines()
                if line.strip() and not line.lstrip().startswith("%")][1])
    inputs = {"team": team, "types": encode(0x4F1880, 110 * 280), "weapons": encode(0x4F0200, 80 * 72),
              "matrix": [list(struct.unpack(f"<{columns}h", machine.mem_read(
                  AI.dword(machine, AI.dword(machine, 0x4F98D0) + row * 4), columns * 2))) for row in range(rows)],
              "neighbors": encode(AI.MAP + 0x984A8, 256 * 32)}
    cases, events, packets = [], [], []
    callbacks = (0x4578A0, 0x44BBEC, 0x458B44, 0x463E78)

    def observe(emulator, address, size, context):
        if address == 0x421725:
            pointer = emulator.reg_read(AI.UC_X86_REG_ESI)
            length = struct.unpack("<H", emulator.mem_read(pointer, 2))[0]
            packet = bytes(emulator.mem_read(pointer, length)).hex()
            packets.append(packet)
            events.append({"packet": packet})
            emulator.reg_write(AI.UC_X86_REG_EIP, 0x421767)
        else:
            events.append({"callback": address})

    for address in (*callbacks, 0x458680, 0x458814, 0x45817C, 0x457CC0, 0x4584EC, 0x463840, 0x421725):
        machine.hook_add(AI.UC_HOOK_CODE, observe, begin=address, end=address)

    def restore():
        machine.mem_write(AI.POLICY, base64.b64decode(initial["policy"]))
        machine.mem_write(AI.NATIVE.GAME + 0x7D28, base64.b64decode(initial["entities"]))
        AI.put(machine, 0x479204, initial["rngCursor"])
        machine.mem_write(0x489510, bytes((initial["forceOrder"],)))

    def run(label):
        events.clear()
        packets.clear()
        before = snapshot()
        stages = []
        for callback in callbacks:
            try:
                AI.invoke(machine, callback, instruction_limit=80000000 if callback == 0x458B44 else 5000000,
                          eax=AI.NATIVE.GAME, edx=AI.POLICY, ebx=2, ecx=team)
            except AssertionError as error:
                raise AssertionError((faction, label, len(events), str(error))) from error
            stages.append({"callback": callback, "after": snapshot()})
        cases.append({"label": label, "before": before, "after": snapshot(),
                      "stages": stages, "events": events[:], "packets": packets[:]})

    run("source-invocation")
    for path in natural_traces:
        content = Path(path).read_bytes()
        for line in content.splitlines():
            natural = json.loads(line)
            if natural["mission"] != faction + "02":
                continue
            assert natural["acceptance"]["naturalSchedulerActivation"]
            assert natural["executableSha256"] == AI.NATIVE.AUDIT.DIGEST
            assert natural["sourcePathInitialization"]["familyGraphSha256"] == hashlib.sha256(
                machine.mem_read(AI.MAP + 0x984A8, 256 * 32)).hexdigest()
            completed = next(group for group in natural["groupCompletions"] if group["group"] == 2)
            previous = next(group for group in natural["groupCompletions"] if group["group"] == 1)
            assert completed["team"] == team
            assert previous["frame"] == completed["frame"]
            previous_policy = base64.b64decode(previous["policy"]["after"])
            assert any(previous_policy[0x12FC + bucket * 300 + 0x1E95] for bucket in range(16))
            machine.mem_write(AI.POLICY, base64.b64decode(completed["policy"]["before"]))
            machine.mem_write(AI.NATIVE.GAME + 0x7D28, base64.b64decode(completed["entities"]["before"]))
            AI.put(machine, 0x479204, completed["rngBefore"])
            machine.mem_write(0x489510, b"\0")
            run(f"natural-frame-{completed['frame']}")
            assert cases[-1]["after"]["policy"] == completed["policy"]["after"]
            local_entities_matched = cases[-1]["after"]["entities"] == completed["entities"]["after"]
            for packet in packets:
                content_bytes = bytes.fromhex(packet)
                machine.mem_write(0x709000, content_bytes)
                AI.invoke(machine, 0x41DEFC, eax=AI.NATIVE.GAME, edx=0x709002, ebx=len(content_bytes) - 2)
            assert snapshot()["entities"] == completed["entities"]["after"]
            assert cases[-1]["after"]["rngCursor"] == completed["rngAfter"]
            assert completed["callbacks"] == [hex(callback) for callback in callbacks]
            submitted = [order["packet"] for order in natural["submittedOrders"]
                         if order["frame"] == completed["frame"] and order["team"] == team]
            assert any(submitted[index:index + len(packets)] == packets
                       for index in range(len(submitted) - len(packets) + 1))
            cases[-1]["historical"] = {"sha256": hashlib.sha256(content).hexdigest(),
                "frame": completed["frame"], "schedulerVisit": completed["schedulerVisit"],
                "forceOrderEvidence": "prior group-1 enabled bucket consumes the one-shot byte",
                "originalPolicyMatched": True, "localEntitiesMatched": local_entities_matched,
                "originalReceivedEntitiesMatched": True, "receiptCallback": "0x41defc",
                "packetSubsequenceMatched": True}
    for mode in (0, 1, 2, 3):
        restore()
        for bucket in range(2):
            machine.mem_write(AI.POLICY + 2 * 0x12FC + bucket * 300 + 0x1EA4, bytes((mode,)))
        run(f"mode-{mode}")
    group = AI.POLICY + 2 * 0x12FC
    origin = AI.dword(machine, group + 0x1E9C)
    target = next(source for source in range(1, 255) if source != origin
                  and machine.mem_read(AI.MAP + 0x884A8 + origin * 256 + source, 1)[0]
                  and source in families)

    def gathered(count=4, bucket_count=2):
        for bucket in range(16):
            base = group + bucket * 300
            machine.mem_write(base + 0x1E95, bytes((int(bucket < bucket_count),)))
            if bucket >= bucket_count:
                continue
            if bucket >= 2:
                AI.put(machine, base + 0x1E9C, origin)
                AI.put(machine, base + 0x1EA0, origin)
                machine.mem_write(base + 0x1EA4, b"\x02")
                machine.mem_write(base + 0x1EA6, bytes(2))
                machine.mem_write(base + 0x1EA8, bytes((origin,)))
            first = 400 + bucket * 8 if bucket_count > 2 else 700 + bucket * 32
            members = list(range(first, first + count))
            machine.mem_write(base + 0x1FAA, struct.pack("<hh", members[0], members[-1]))
            for index, slot in enumerate(members):
                actor = AI.NATIVE.GAME + 0x7D28 + slot * 220
                machine.mem_write(actor, bytes(220))
                machine.mem_write(actor, struct.pack("<H", machine.mem_read(AI.POLICY + origin * 18 + 2, 1)[0] * 256))
                machine.mem_write(actor + 4, struct.pack("<H", machine.mem_read(AI.POLICY + origin * 18 + 3, 1)[0] * 256))
                machine.mem_write(actor + 6, bytes((index % 8, team)))
                machine.mem_write(actor + 0x2C, b"\x01")
                machine.mem_write(actor + 0xCC, b"\x01")
                machine.mem_write(actor + 0xD2, struct.pack("<hh", members[index + 1] if index + 1 < count else -1,
                                                        members[index - 1] if index else -1))

    for control in ("no-buckets", "sixteen-buckets", "sixteen-quota", "direct-target", "weighted-target", "weighted-rejected", "rank-blocked", "rank-tie",
                    "priority-flag", "own-threat-ignored", "signed-enemy", "mode0-hold", "mode0-retreat",
                    "quota-met", "quota-unmet", "quota-total", "cleanup", "forced", "rng255", "mode2-members", "mode3-members"):
        restore()
        gathered(bucket_count=0 if control == "no-buckets" else 16 if control.startswith("sixteen") else 2)
        if control == "sixteen-quota":
            for bucket in range(16):
                machine.mem_write(group + bucket * 300 + 0x1EA4, b"\x01")
                machine.mem_write(group + bucket * 300 + 0x1FAE, struct.pack("<9H", *([3] * 9)))
        elif control in ("no-buckets", "sixteen-buckets"):
            pass
        elif control in ("mode2-members", "mode3-members"):
            for bucket in range(2):
                machine.mem_write(group + bucket * 300 + 0x1EA4, bytes((2 if control == "mode2-members" else 3,)))
        elif control.startswith("quota"):
            for bucket in range(2):
                machine.mem_write(group + bucket * 300 + 0x1EA4, b"\x01")
                machine.mem_write(group + bucket * 300 + 0x1FAE, struct.pack("<9H", *([3] * 9)))
            if control == "quota-unmet":
                machine.mem_write(group + 0x1FAE + 8 * 2, struct.pack("<H", 2))
            if control == "quota-total":
                machine.mem_write(group + 0x3154, struct.pack("<9H", *([100] * 9)))
        elif control == "cleanup":
            for slot in (700, 702, 733, 735):
                machine.mem_write(AI.NATIVE.GAME + 0x7D28 + slot * 220 + 0x2C, b"\x0a")
        elif control.startswith("mode0"):
            for bucket in range(2):
                machine.mem_write(group + bucket * 300 + 0x1EA4, b"\0")
            machine.mem_write(AI.POLICY + origin * 18 + 16, struct.pack("<H", 1))
            if control == "mode0-retreat":
                machine.mem_write(AI.POLICY + origin * 18 + 8, bytes(((team + 1) % 8,)))
                machine.mem_write(AI.POLICY + origin * 18 + 10, struct.pack("<H", 60000))
        elif control == "forced":
            machine.mem_write(0x489510, b"\x01")
            for slot in (700, 701, 702, 703, 732, 733, 734, 735):
                machine.mem_write(AI.NATIVE.GAME + 0x7D28 + slot * 220 + 0xCC, b"\x02")
        elif control == "rng255":
            AI.put(machine, 0x479204, 255)
        else:
            for source in range(256):
                machine.mem_write(AI.POLICY + source * 18 + 8, b"\xff")
                machine.mem_write(AI.POLICY + source * 18 + 10, bytes(2))
                machine.mem_write(AI.POLICY + source * 18 + 16, bytes(2))
                machine.mem_write(AI.POLICY + source * 18 + 18, b"\0")
            machine.mem_write(AI.POLICY + target * 18 + 13, bytes((255 if control == "rank-blocked" else 0,)))
            machine.mem_write(AI.POLICY + target * 18 + 18, bytes((3 if control == "priority-flag" else 1,)))
            if control != "rank-blocked":
                machine.mem_write(AI.POLICY + target * 18 + 16, struct.pack("<H", 1))
            if control == "rank-tie":
                machine.mem_write(AI.POLICY + origin * 18 + 13, b"\0")
                machine.mem_write(AI.POLICY + origin * 18 + 18, b"\x01")
                machine.mem_write(AI.POLICY + origin * 18 + 16, struct.pack("<H", 1))
            if control in ("weighted-target", "weighted-rejected", "own-threat-ignored", "signed-enemy"):
                owner = team if control == "own-threat-ignored" else 254 if control == "signed-enemy" else (team + 1) % 8
                machine.mem_write(AI.POLICY + target * 18 + 8, bytes((owner,)))
                machine.mem_write(AI.POLICY + target * 18 + 10,
                                  struct.pack("<H", 60000 if control in ("weighted-rejected", "own-threat-ignored") else 1))
                AI.put(machine, AI.POLICY + 0x6C34, 100000)
        run(control)
    print(json.dumps({"mission": faction + "02", "team": team, "binarySha256": AI.NATIVE.AUDIT.DIGEST,
                      "navigation": {"width": width, "height": len(families) // width,
                                     "families": base64.b64encode(families).decode(),
                                     "nextFamily": encode(AI.MAP + 0x884A8, 65536)},
                      "inputs": inputs, "cases": cases}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disassemble", action="store_true")
    parser.add_argument("--natural-trace", action="append", default=[])
    args = parser.parse_args()
    if args.disassemble:
        disassemble()
    else:
        for faction, team in (("HUMAN", 2), ("ALIEN", 1)):
            capture(faction, team, args.natural_trace)