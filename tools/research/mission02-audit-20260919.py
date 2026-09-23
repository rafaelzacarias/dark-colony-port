"""Focused, hash-pinned mission02 newrate probe; requires Capstone 5 and Unicorn 2."""

import importlib.util
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

from unicorn import UC_HOOK_CODE, UcError
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
    UC_X86_REG_EDI, UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP,
)


sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "mission_actions", Path(__file__).with_name("mission-actions.py")
)
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)
ROOT = Path(__file__).resolve().parents[2]
STATISTICS = 0x4956E0
SCALE = STATISTICS + 48
AUDIO_DEVICE = 0x709800


def preflight():
    program = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {campaignPreflight} from './src/game-data.ts';
import {parseTriggerScript} from './tools/extractors/data/triggers.ts';
const results = [];
for (const faction of ['HUMAN', 'ALIEN']) {
  const stem = `${faction}/${faction}02`;
  const source = parseTriggerScript(readFileSync(`raw_cd/DC/SCENARIO/${stem}.TRO`, 'utf8'));
  const generated = JSON.parse(readFileSync(`public/assets/generated/data/triggers/${stem}.json`, 'utf8'));
  assert.deepEqual(source, generated.blocks);
  const scenario = JSON.parse(readFileSync(`public/assets/generated/data/scenarios/${stem}.json`, 'utf8'));
  const diagnostics = campaignPreflight(scenario, source);
  const expected = faction === 'HUMAN' ? [[8, 'newrate'], [16, 'newrate'], [17, 'ai'], [18, 'setarray']]
    : [[0, 'ai'], [10, 'newrate'], [11, 'setarray']];
  const expectedDiagnostics = expected.map(([id, name]) =>
    `TRO ${id}: ${name}: argument parsing and world semantics are not verified by this controller`);
  if (faction === 'ALIEN') expectedDiagnostics.unshift('TRO program: Trigger 8 requires explicit lives');
  assert.deepEqual(diagnostics, expectedDiagnostics);
  results.push({mission: stem, blocks: source.length, sourcePreserved: true, diagnostics});
}
console.log(JSON.stringify(results));
"""
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", program],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)


def source_evidence():
    result = []
    for faction, expected in (
        ("HUMAN", ["newrate 12 11 68", "newrate 12 88 72"]),
        ("ALIEN", ["newrate 15 13 51"]),
    ):
        stem = ROOT / "raw_cd/DC/SCENARIO" / faction / f"{faction}02"
        script = stem.with_suffix(".TRO").read_bytes()
        scenario = stem.with_suffix(".SCN").read_bytes()
        actions = [line.strip() for line in script.decode("ascii").splitlines()
                   if line.strip().startswith("newrate ")]
        assert actions == expected
        placements = []
        for action in actions:
            _, rate, tile_x, tile_y = action.split()
            matches = []
            for line in scenario.decode("ascii").splitlines():
                fields = line.split()
                if len(fields) == 5 and all(field.lstrip("-").isdigit() for field in fields):
                    row = list(map(int, fields))
                    if row[:3] == [int(tile_x), int(tile_y), 40]:
                        matches.append(row)
            assert len(matches) == 1 and matches[0][3] == 0
            placements.append({"action": action, "sourcePlacement": matches[0]})
        result.append({"mission": stem.name, "troSha256": hashlib.sha256(script).hexdigest(),
                       "scnSha256": hashlib.sha256(scenario).hexdigest(), "targets": placements})
    return result


def golden_case(label, source, scale, expected_word, *, slot=152, old_rate=7,
                team=0, missing=False, decoys=False):
    values = tuple(int(value) & 255 for value in source.split())
    rate, tile_x, tile_y = values
    machine = NATIVE.parse(0x43EFD9, source)
    assert machine.mem_read(NATIVE.ACTION, 1) == b"\x05"
    assert machine.mem_read(NATIVE.ACTION + 4, 3) == bytes(values)
    machine.mem_write(NATIVE.ACTION + 0x18, struct.pack("<I", 0))
    world = bytearray(b"\xa5" * 0x50000)
    entities = bytearray(800 * 220)

    def place(index, unit_type, status, previous_rate, owner):
        offset = index * 220
        struct.pack_into("<H", entities, offset, tile_x * 256 + 255)
        struct.pack_into("<H", entities, offset + 4, tile_y * 256 + 1)
        entities[offset + 6] = unit_type
        entities[offset + 7] = owner
        entities[offset + 0x2C] = status
        struct.pack_into("<H", entities, offset + 0x32, previous_rate)

    if not missing:
        place(slot, 40, 1, old_rate, team)
        if slot < 799:
            place(slot + 1, 40, 1, 99, 7)
    if decoys:
        place(0, 40, 0, 55, 0)
        place(1, 39, 1, 66, 0)
    world[0x7D28:0x7D28 + len(entities)] = entities
    machine.mem_write(NATIVE.GAME, bytes(world))
    statistics = bytearray(b"\x5a" * 0x3900)
    struct.pack_into("<i", statistics, 48, scale)
    machine.mem_write(STATISTICS, bytes(statistics))
    machine.mem_write(0x47963D, b"\x01")
    machine.mem_write(0x47963C, b"\x00")
    machine.mem_write(0x4F98D4, struct.pack("<I", 2))
    audio_record = 0x4CBC54 + 104 + 7 * 13
    machine.mem_write(audio_record, bytes((1, 0, 0, 37)) + bytes(9))
    machine.mem_write(0x4D1994, struct.pack("<I", 0x708000))
    machine.mem_write(0x708008, struct.pack("<I", 0x708100))
    machine.mem_write(0x708180, struct.pack("<I", AUDIO_DEVICE))
    machine.mem_write(0x516A94, struct.pack("<I", 0x708200))
    machine.mem_write(0x70820C, struct.pack("<I", 1))
    audio_calls = []
    visited = set()

    def observe(emulator, address, size, user_data):
        visited.add(address)
        if address == AUDIO_DEVICE:
            audio_calls.append({"sample": emulator.reg_read(UC_X86_REG_EAX),
                                "level": emulator.reg_read(UC_X86_REG_EDX),
                                "pan": emulator.reg_read(UC_X86_REG_EBX)})
            pointer = emulator.reg_read(UC_X86_REG_ESP)
            destination = struct.unpack("<I", emulator.mem_read(pointer, 4))[0]
            emulator.reg_write(UC_X86_REG_ESP, pointer + 4)
            emulator.reg_write(UC_X86_REG_EIP, destination)
        if address == 0x43DBC1:
            emulator.emu_stop()

    machine.hook_add(UC_HOOK_CODE, observe)
    machine.reg_write(UC_X86_REG_ESI, NATIVE.ACTION)
    machine.reg_write(UC_X86_REG_EDI, NATIVE.GAME)
    try:
        machine.emu_start(0x43D822, 0x43E4C6, count=100000)
    except UcError as error:
        raise RuntimeError(f"{label}: native fault at {machine.reg_read(UC_X86_REG_EIP):#x}") from error
    assert 0x43DAF7 in visited, label
    assert machine.reg_read(UC_X86_REG_EIP) == (0x43DBC1 if missing else 0x43E4C6), label
    if not missing:
        struct.pack_into("<H", world, 0x7D28 + slot * 220 + 0x32, expected_word)
        assert 0x41A538 in visited, label
    assert machine.mem_read(NATIVE.GAME, len(world)) == world, label
    assert machine.mem_read(STATISTICS, len(statistics)) == statistics, label
    expected_audio = [] if missing or old_rate != 0 or rate == 0 else [{"sample": 37, "level": 1, "pan": 0}]
    assert audio_calls == expected_audio, (label, audio_calls)
    assert (0x431BF4 in visited) == bool(expected_audio), label
    return {"case": label, "source": f"newrate {source}", "scale_s_1_0": scale,
            "selectedSlot": None if missing else slot, "rateWord": None if missing else expected_word,
            "audioDeviceCalls": audio_calls, "statisticsUnchanged": True,
            "exactWorldWrites": True, "boundary": hex(machine.reg_read(UC_X86_REG_EIP))}


def main():
    assert NATIVE.READ(0x476B0C, 8) == b"newrate\0"
    assert struct.unpack("<I", NATIVE.READ(0x43D7BC + 5 * 4, 4))[0] == 0x43DAF7
    cases = [
        golden_case("human-trigger-8", "12 11 68", 256, 12, old_rate=0),
        golden_case("human-trigger-16", "12 88 72", 256, 12, old_rate=0),
        golden_case("alien-trigger-10", "15 13 51", 256, 15, old_rate=0),
        golden_case("first-active-type40", "12 11 68", 384, 18, decoys=True, team=7),
        golden_case("slot-zero", "15 13 51", 256, 15, slot=0),
        golden_case("last-slot", "15 13 51", 256, 15, slot=799),
        golden_case("fraction-truncation", "15 13 51", 128, 7),
        golden_case("zero-rate", "0 13 51", 256, 0, old_rate=0),
        golden_case("deactivate", "0 13 51", 256, 0),
        golden_case("zero-scale-still-notifies", "15 13 51", 0, 0, old_rate=0),
        golden_case("negative-scale-truncation", "15 13 51", -128, 65529),
        golden_case("product-int32-wrap", "12 11 68", 2147483647, 0),
        golden_case("byte-maximum", "255 255 255", 256, 255),
        golden_case("parser-byte-wrap", "256 267 324", 256, 0),
        golden_case("missing-target-error", "12 11 68", 256, 0, missing=True),
        golden_case("inactive-and-wrong-type-error", "12 11 68", 256, 0, missing=True, decoys=True),
    ]
    print(json.dumps({"audit": "mission02-newrate-20260919", "result": "PASS",
                      "executableSha256": NATIVE.AUDIT.DIGEST, "sources": source_evidence(),
                      "preflight": preflight(), "goldenCases": cases,
                      "limitations": ["Native fragments, not full mission execution",
                                      "Only the external audio-device callback is replaced",
                                      "Missing-target probes stop at the diagnostic branch before logging/assertion"]}, indent=2))


if __name__ == "__main__":
    main()