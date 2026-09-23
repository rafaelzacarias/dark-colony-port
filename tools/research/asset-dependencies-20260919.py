"""Read-only source dependency census; uses the repository's TS parsers, no exports."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "raw_cd/DC"
EXPECTED_EXE = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"

PARSER = r"""
import { readFileSync, readdirSync } from 'node:fs';
import { parseFin } from './tools/extractors/animations/fin.ts';
import { parseScenario } from './tools/extractors/data/scenario.ts';
const root = 'raw_cd/DC';
const animations = readdirSync(`${root}/ANIMATE`).filter(name => /\.fin$/i.test(name)).sort().map(name => {
  const bytes = readFileSync(`${root}/ANIMATE/${name}`);
  try { return { name, status: 'parsed', ...parseFin(bytes) }; }
  catch (error) { return { name, status: bytes.readInt16LE(0) === -3 ? 'unsupported' : 'invalid', error: error.message }; }
});
const scenarios = readdirSync(`${root}/SCENARIO`, { recursive: true }).filter(name => /\.scn$/i.test(name)).sort().map(name => {
  try { return { name, ...parseScenario(readFileSync(`${root}/SCENARIO/${name}`, 'ascii')) }; }
  catch (error) { return { name, error: error.message }; }
});
console.log(JSON.stringify({ animations, scenarios }));
"""


def native_probe(image, args):
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32

    pe = struct.unpack_from("<I", image, 0x3C)[0]
    count = struct.unpack_from("<H", image, pe + 6)[0]
    optional_size = struct.unpack_from("<H", image, pe + 20)[0]
    base = struct.unpack_from("<I", image, pe + 52)[0]
    sections = []
    for index in range(count):
        offset = pe + 24 + optional_size + 40 * index
        name = image[offset:offset + 8].rstrip(b"\0").decode("ascii")
        _, rva, size, raw = struct.unpack_from("<IIII", image, offset + 8)
        flags = struct.unpack_from("<I", image, offset + 36)[0]
        if not flags & 0x80:
            sections.append((name, base + rva, size, raw, flags))

    def at(address, size):
        for _, start, length, raw, _ in sections:
            if start <= address and address + size <= start + length:
                return image[raw + address - start:raw + address - start + size]
        return b""

    def annotation(address):
        data = at(address, 120).split(b"\0", 1)[0]
        if len(data) >= 2 and all(32 <= value < 127 or value in (10, 13) for value in data):
            return repr(data.decode("ascii"))
        return ""

    if args.probe_lists:
        from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ESP, UC_X86_REG_EIP

        for path in [SOURCE / "ANIM.DAT", *sorted((SOURCE / "INTRFACE").glob("*.DAT"))]:
            machine = Uc(UC_ARCH_X86, UC_MODE_32)
            machine.mem_map(0x400000, 0x200000)
            machine.mem_map(0x700000, 0x10000)
            for _, address, length, raw, _ in sections:
                machine.mem_write(address, image[raw:raw + length])
            lines = iter(path.read_bytes().splitlines(keepends=True))
            expected = [line.strip().upper() for line in path.read_text().splitlines()
                        if len(line.strip()) > 1 and not line.startswith("%")]
            captured = []
            opened = []
            source_name = str(path.relative_to(SOURCE)).lower()
            machine.mem_write(0x701000, source_name.encode("ascii") + b"\0")
            machine.mem_write(0x70F000, struct.pack("<I", 0x70FF00))
            machine.reg_write(UC_X86_REG_ESP, 0x70F000)
            machine.reg_write(UC_X86_REG_EAX, 0x702000)
            machine.reg_write(UC_X86_REG_EDX, 0x701000)

            def string_at(address):
                return bytes(machine.mem_read(address, 256)).split(b"\0", 1)[0].decode("ascii")

            def hook(emulator, address, size, user_data):
                if address == 0x40601C:
                    opened.append(string_at(emulator.reg_read(UC_X86_REG_EAX)))
                    emulator.reg_write(UC_X86_REG_EAX, 0x703000)
                elif address == 0x406338:
                    assert emulator.reg_read(UC_X86_REG_EBX) == 0x703000
                    line = next(lines, None)
                    destination = emulator.reg_read(UC_X86_REG_EAX)
                    if line is not None:
                        emulator.mem_write(destination, line + b"\0")
                    emulator.reg_write(UC_X86_REG_EAX, destination if line is not None else 0)
                elif address == 0x425674:
                    captured.append(string_at(emulator.reg_read(UC_X86_REG_EAX)).upper())
                elif address == 0x425EC0:
                    emulator.mem_write(0x479508, struct.pack("<I", 1))
                elif address != 0x40636C:
                    return
                stack = emulator.reg_read(UC_X86_REG_ESP)
                destination = struct.unpack("<I", emulator.mem_read(stack, 4))[0]
                emulator.reg_write(UC_X86_REG_ESP, stack + 4)
                emulator.reg_write(UC_X86_REG_EIP, destination)

            machine.hook_add(UC_HOOK_CODE, hook)
            entry = 0x404E8C if path == SOURCE / "ANIM.DAT" else 0x4267E8
            machine.emu_start(entry, 0x70FF00, count=200000)
            assert machine.reg_read(UC_X86_REG_EIP) == 0x70FF00
            assert opened == [source_name], opened
            assert captured == expected, (source_name, captured, expected)
            print(json.dumps({"list": source_name, "native_entry": hex(entry), "fin_requests": captured}))
        print("PASS original x86 list iteration; file I/O, cache reset and FIN reader are intercepted, not a game boot")
        return

    decoder = Cs(CS_ARCH_X86, CS_MODE_32)
    decoder.skipdata = True
    if args.disasm:
        for start, end in args.disasm:
            data = at(start, end - start)
            assert len(data) == end - start
            for instruction in decoder.disasm(data, start):
                strings = [annotation(int(value, 16)) for value in re.findall(r"0x[0-9a-f]+", instruction.op_str)]
                print(f"{instruction.address:#010x}: {instruction.bytes.hex():20} {instruction.mnemonic:8} {instruction.op_str:42} {' '.join(filter(None, strings))}")
    if args.refs:
        for name, address, size, raw, flags in sections:
            if flags & 0x20:
                for instruction in decoder.disasm(image[raw:raw + size], address):
                    if any(f"0x{target:x}" in instruction.op_str for target in args.refs):
                        print(f"{instruction.address:#010x}: {instruction.mnemonic} {instruction.op_str}")
            for target in args.refs:
                needle = struct.pack("<I", target)
                cursor = raw
                while (cursor := image.find(needle, cursor, raw + size)) >= 0:
                    print(f"pointer {target:#x} at {address + cursor - raw:#010x} ({name})")
                    cursor += 4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disasm", type=lambda value: int(value, 0), nargs=2, action="append")
    parser.add_argument("--refs", type=lambda value: int(value, 0), nargs="+")
    parser.add_argument("--probe-lists", action="store_true")
    args = parser.parse_args()
    image = (SOURCE / "DC.EXE").read_bytes()
    executable_hash = hashlib.sha256(image).hexdigest()
    assert executable_hash == EXPECTED_EXE, executable_hash
    if args.disasm or args.refs or args.probe_lists:
        print(f"SHA256 {executable_hash}")
        native_probe(image, args)
        return
    parsed = json.loads(subprocess.check_output(
        ["node", "--import", "tsx", "--input-type=module", "-e", PARSER], cwd=ROOT, text=True))
    stat_lines = [line.split("%", 1)[0].split() for line in
                  (SOURCE / "GAMESTAT/GAMESTAT.TXT").read_text().splitlines()]
    stat_rows = [tokens for tokens in stat_lines if tokens]
    assert len(stat_rows) - 1 == int(stat_rows[0][0]) == 106
    units = {index: tokens[0] for index, tokens in enumerate(stat_rows[1:])}
    sprites = {path.stem.upper() for path in (SOURCE / "SPRITES").glob("*.SPR")}
    manifests = {}
    for path in [SOURCE / "ANIM.DAT", *sorted((SOURCE / "INTRFACE").glob("*.DAT"))]:
        names = [line.strip().upper() for line in path.read_text().splitlines()
                 if len(line.strip()) > 1 and not line.startswith("%")]
        assert all(name.endswith(".FIN") for name in names), path
        manifests[str(path.relative_to(SOURCE))] = names
    loaded_fins = {name for names in manifests.values() for name in names}
    animation_by_name = {animation["name"]: animation for animation in parsed["animations"]}
    assert all(name in animation_by_name and animation_by_name[name]["status"] == "parsed" for name in loaded_fins)
    manifest_hashes = {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() for name in manifests}
    campaign_lists = {}
    scenario_names = {scenario["name"].upper() for scenario in parsed["scenarios"]}
    for name in ("HSCENE.TXT", "GSCENE.TXT", "HTSCENE.TXT", "GTSCENE.TXT"):
        names = [line.strip().upper() for line in (SOURCE / "GAMESTAT" / name).read_text().splitlines()
                 if line.strip().lower().endswith(".scn")]
        assert all(name in scenario_names for name in names)
        campaign_lists[name] = names
    ui_directives = []
    for path in sorted((SOURCE / "INTRFACE").iterdir()):
        if not path.is_file():
            continue
        try:
            text = path.read_bytes().decode("ascii")
        except UnicodeDecodeError:
            continue
        if "\0" in text:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            tokens = line.split()
            if tokens and tokens[0].lower() in ("animation", "palette"):
                ui_directives.append({"source": str(path.relative_to(SOURCE)), "line": number, "tokens": tokens})
                if tokens[0].lower() == "animation":
                    assert len(tokens) == 2 and tokens[1].upper() in manifests, tokens
    state_owners = {}
    for name in manifests["ANIM.DAT"]:
        for state in animation_by_name[name]["states"]:
            state_owners.setdefault(state["name"].upper(), set()).add(name)
    state_edges = []
    for unit_type, name in units.items():
        for suffix in ("MOVE", "STAND", "DIE", "DIEA", "DIEB", "DIEC", "DEPLOY", "FUNK", "FIG"):
            for direction in range(16):
                state = f"{name}{suffix}{direction}".upper()
                if state in state_owners:
                    state_edges.append({"type": unit_type, "state": state, "fins": sorted(state_owners[state])})
    roots = {}
    for unit_type, name in units.items():
        roots.setdefault(name.upper(), []).append(unit_type)
    placements = {}
    for scenario in parsed["scenarios"]:
        assert "error" not in scenario, scenario
        for row in scenario["placementRows"]:
            if len(row) == 6:
                placements.setdefault(row[2], set()).add(scenario["name"])
    missing = {}
    problems = []
    for animation in parsed["animations"]:
        name = animation["name"]
        unit_types = roots.get(Path(name).stem.upper(), [])
        owners = sorted({scenario for unit_type in unit_types for scenario in placements.get(unit_type, [])})
        if animation["status"] != "parsed":
            problems.append({**animation, "gamestat_same_basename_types": unit_types, "scn_placements": owners,
                             "manifests": [source for source, names in manifests.items() if name in names],
                             "sha256": hashlib.sha256((SOURCE / "ANIMATE" / name).read_bytes()).hexdigest()})
            continue
        for sprite in animation["spriteNames"]:
            if sprite.upper().removesuffix(".SPR") in sprites:
                continue
            entries = [entry["index"] for entry in animation["timeline"]
                       if any(child["sprite"].upper() == sprite.upper() for child in entry["children"])]
            states = [state["name"] for state in animation["states"]
                      if state["validRange"] and any(state["firstTimelineIndex"] <= entry <= state["lastTimelineIndex"] for entry in entries)]
            missing.setdefault(sprite, []).append({"fin": name, "entries": entries, "states": states,
                "manifests": [source for source, names in manifests.items() if name in names],
                "orphan_children": sum(child["sprite"].upper() == sprite.upper() for child in animation["orphanChildren"]),
                "gamestat_same_basename_types": unit_types, "scn_placements": owners})
    assert len(problems) == 13 and len(missing) == 20, (len(problems), len(missing))
    short_rmp = SOURCE / "SCENARIO/MPLAYER/PALETTE.RMP"
    assert short_rmp.stat().st_size == 67584
    print(json.dumps({"executable_sha256": executable_hash, "problem_fins": problems,
        "manifests": manifests, "manifest_sha256": manifest_hashes, "manifest_fin_count": len(loaded_fins),
        "campaign_lists": campaign_lists, "ui_directives": ui_directives,
        "gamestat_state_edges_subset": state_edges,
        "manifest_sprite_count": len({sprite.upper() for name in loaded_fins for sprite in animation_by_name[name]["spriteNames"]}),
        "missing_sprites": dict(sorted(missing.items())),
        "scenarios": [{"name": scenario["name"], "terrain": scenario["terrainBank"],
                       "placement_types": sorted({row[2] for row in scenario["placementRows"] if len(row) == 6})}
                      for scenario in parsed["scenarios"]],
        "short_rmp": {"bytes": short_rmp.stat().st_size, "sha256": hashlib.sha256(short_rmp.read_bytes()).hexdigest()},
        "limits": "Same-basename comparisons are not runtime edges. State edges cover only the traced suffix subset, not all effects or events. SCN placement absence does not exclude production or triggers. Manifest exclusion applies to the audited DC.EXE load graph, not other executables or custom content."}, indent=2))


if __name__ == "__main__":
    main()