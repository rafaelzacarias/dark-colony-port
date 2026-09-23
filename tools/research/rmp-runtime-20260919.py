"""Read-only DC.EXE RMP investigation. Requires Capstone 5, Unicorn 2, pycdlib and tsx."""

import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "raw_cd/DC"
EXE_HASH = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"


class Native:
    def __init__(self):
        self.image = (SOURCE / "DC.EXE").read_bytes()
        assert hashlib.sha256(self.image).hexdigest() == EXE_HASH
        pe = struct.unpack_from("<I", self.image, 0x3C)[0]
        count = struct.unpack_from("<H", self.image, pe + 6)[0]
        optional_size = struct.unpack_from("<H", self.image, pe + 20)[0]
        base = struct.unpack_from("<I", self.image, pe + 52)[0]
        self.sections = []
        for index in range(count):
            offset = pe + 24 + optional_size + 40 * index
            name = self.image[offset:offset + 8].rstrip(b"\0").decode("ascii")
            _, rva, size, raw = struct.unpack_from("<IIII", self.image, offset + 8)
            flags = struct.unpack_from("<I", self.image, offset + 36)[0]
            if not flags & 0x80:
                self.sections.append((name, base + rva, size, raw, flags))

    def at(self, address, size):
        for _, start, length, raw, _ in self.sections:
            if start <= address and address + size <= start + length:
                offset = raw + address - start
                return self.image[offset:offset + size]
        raise ValueError(f"Unmapped native range: {address:#x}+{size:#x}")

    def machine(self):
        from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_MEM_INVALID
        from unicorn.x86_const import UC_X86_REG_EIP, UC_X86_REG_ESP

        machine = Uc(UC_ARCH_X86, UC_MODE_32)
        machine.mem_map(0x400000, 0x200000)
        machine.mem_map(0x700000, 0x200000)
        for _, address, length, raw, _ in self.sections:
            machine.mem_write(address, self.image[raw:raw + length])
        machine.mem_write(0x70F000, struct.pack("<I", 0x70FF00))
        machine.reg_write(UC_X86_REG_ESP, 0x70F000)

        def invalid_memory(emulator, access, address, size, value, user_data):
            raise AssertionError(f"Unmapped {address:#x}+{size} at {emulator.reg_read(UC_X86_REG_EIP):#x}")

        machine.hook_add(UC_HOOK_MEM_INVALID, invalid_memory)
        return machine

    def disasm(self, start, end):
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32

        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(self.at(start, end - start), start):
            print(f"{instruction.address:#010x}: {instruction.bytes.hex():22} "
                  f"{instruction.mnemonic:8} {instruction.op_str}")

    def refs(self, targets):
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32

        decoder = Cs(CS_ARCH_X86, CS_MODE_32)
        decoder.skipdata = True
        for name, address, size, raw, flags in self.sections:
            if flags & 0x20:
                for instruction in decoder.disasm(self.image[raw:raw + size], address):
                    if any(f"0x{target:x}" in instruction.op_str for target in targets):
                        print(f"{instruction.address:#010x}: {instruction.mnemonic} {instruction.op_str}")
            for target in targets:
                cursor = raw
                while (cursor := self.image.find(struct.pack("<I", target), cursor, raw + size)) >= 0:
                    print(f"pointer {target:#x} at {address + cursor - raw:#010x} ({name})")
                    cursor += 4


def native_return(machine, result=None):
    from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EIP, UC_X86_REG_ESP

    stack = machine.reg_read(UC_X86_REG_ESP)
    destination = struct.unpack("<I", machine.mem_read(stack, 4))[0]
    machine.reg_write(UC_X86_REG_ESP, stack + 4)
    machine.reg_write(UC_X86_REG_EIP, destination)
    if result is not None:
        machine.reg_write(UC_X86_REG_EAX, result)


def string_at(machine, address):
    return bytes(machine.mem_read(address, 1024)).split(b"\0", 1)[0].decode("ascii")


def put(machine, address, value):
    machine.mem_write(address, struct.pack("<I", value))


def execute(machine, start, end, count=1000000):
    from unicorn.x86_const import UC_X86_REG_EIP

    machine.emu_start(start, end, count=count)
    assert machine.reg_read(UC_X86_REG_EIP) == end, hex(machine.reg_read(UC_X86_REG_EIP))


def scenario_probe(native):
    from unicorn import UC_HOOK_CODE
    from unicorn.x86_const import (
        UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX,
        UC_X86_REG_EDX, UC_X86_REG_ESI,
    )

    records = []
    for path in sorted((SOURCE / "SCENARIO").rglob("*.SCN")):
        machine = native.machine()
        frame, game, display, config, interface = 0x710000, 0x730000, 0x720000, 0x790000, 0x7A0000
        lines = iter(path.read_bytes().splitlines(keepends=True))
        setup_names, ui_names, callbacks = [], [], []
        put(machine, frame - 4, 1)
        put(machine, game + 0x7D18, display)
        put(machine, game + 0x544, config)
        put(machine, interface + 0x10, display)
        put(machine, display + 0x34, 0x42BCAC)

        def hook(emulator, address, size, user_data):
            if address == 0x406338:
                line = next(lines)
                destination = emulator.reg_read(UC_X86_REG_EAX)
                assert len(line) < emulator.reg_read(UC_X86_REG_EDX)
                emulator.mem_write(destination, line + b"\0")
                native_return(emulator, destination)
            elif address == 0x431130:
                setup_names.append(string_at(emulator, emulator.reg_read(UC_X86_REG_EDX)))
                native_return(emulator)
            elif address == 0x40B030:
                native_return(emulator, 123)
            elif address == 0x4231D0:
                ui_names.append(string_at(emulator, emulator.reg_read(UC_X86_REG_EBX)))
                native_return(emulator)
            elif address == 0x422D64:
                callbacks.append(string_at(emulator, emulator.reg_read(UC_X86_REG_EBX)))
                native_return(emulator)
            elif address == 0x42BCAC:
                callbacks.append(string_at(emulator, emulator.reg_read(UC_X86_REG_EDX)))
                native_return(emulator)

        machine.hook_add(UC_HOOK_CODE, hook)
        machine.reg_write(UC_X86_REG_EBP, frame)
        machine.reg_write(UC_X86_REG_ESI, game)
        execute(machine, 0x41BAFC, 0x41BB27)
        terrain = string_at(machine, game + 0x548)
        assert (SOURCE / "SCENARIO" / terrain.upper()).is_file()
        put(machine, frame - 4, game)
        machine.reg_write(UC_X86_REG_EAX, game)
        machine.reg_write(UC_X86_REG_EBX, 0x400)
        execute(machine, 0x41E944, 0x41EA18)
        basename = terrain.rsplit(".", 1)[0]
        assert setup_names == ui_names == [basename]
        put(machine, frame + 0x7E, interface)
        put(machine, frame + 0x76, frame - 0x42C)
        machine.mem_write(frame + 0x1A, b"palette\0")
        machine.mem_write(frame + 0x3A, b"unrelated-background\0")
        execute(machine, 0x423A25, 0x423A5E)
        machine.reg_write(UC_X86_REG_ECX, interface)
        machine.reg_write(UC_X86_REG_EBX, frame + 0x1A)
        execute(machine, 0x422DC8, 0x422DF3)
        assert callbacks == [basename, basename]
        resolved = SOURCE / (basename.upper() + ".RMP")
        assert resolved.is_file() and resolved.stat().st_size == 0x30000
        records.append({"scn": str(path.relative_to(SOURCE)),
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "native_terrain": terrain, "native_palette": basename,
                        "resolved_rmp": str(resolved.relative_to(SOURCE))})
    assert len(records) == 108
    assert sum("/MPLAYER/" in record["scn"] for record in records) == 56
    return records


def packages():
    records = []
    for name in ("SMALL", "MEDIUM", "LARGE"):
        path = ROOT / "raw_cd" / (name + ".LST")
        lines = path.read_bytes().decode("latin1").splitlines()
        entries = [line.strip().replace("\\", "/").lower() for line in lines[1:]]
        rmps = sorted(entry for entry in entries if entry.endswith(".rmp"))
        assert {"palette.rmp", "desert.rmp", "jungle.rmp", "htrain.rmp", "atlantis.rmp"} <= set(rmps)
        assert "scenario/mplayer/palette.rmp" not in entries
        records.append({"list": name + ".LST", "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "declared_count": int(lines[0]), "rmp_paths": rmps,
                        "short_rmp_in_list": "scenario/mplayer/palette.rmp" in entries,
                        "scn_count": sum(entry.endswith(".scn") for entry in entries),
                        "bts_paths": sorted(entry for entry in entries if entry.endswith(".bts"))})
    return records


def disc_probe():
    import pycdlib

    geometry = json.loads(subprocess.check_output([
        "node", "--import", "tsx", "--input-type=module", "-e",
        'import {readFileSync,statSync} from "node:fs"; '
        'import {parseMds} from "./tools/extractors/disc/mds.ts"; '
        'console.log(JSON.stringify(parseMds(readFileSync("Dark Colony ISO/Dark Colony.mds"),'
        'statSync("Dark Colony ISO/Dark Colony.mdf").size).tracks[0]));',
    ], cwd=ROOT, text=True))
    assert geometry["sectorSize"] == 2448 and geometry["startOffset"] == 0

    class DataTrack(io.RawIOBase):
        def __init__(self, stream):
            self.stream = stream
            self.position = 0
            self.length = geometry["sectorCount"] * 2048

        def readable(self):
            return True

        def seekable(self):
            return True

        def tell(self):
            return self.position

        def seek(self, offset, whence=0):
            self.position = offset + (self.position if whence == 1 else self.length if whence == 2 else 0)
            assert self.position >= 0
            return self.position

        def read(self, size=-1):
            remaining = self.length - self.position
            size = remaining if size < 0 else min(size, remaining)
            chunks = []
            while size > 0:
                sector, within = divmod(self.position, 2048)
                count = min(size, 2048 - within)
                self.stream.seek(sector * geometry["sectorSize"])
                header = self.stream.read(16)
                assert header[:12] == b"\x00" + b"\xff" * 10 + b"\x00" and header[15] == 1
                self.stream.seek(within, 1)
                data = self.stream.read(count)
                assert len(data) == count
                chunks.append(data)
                self.position += count
                size -= count
            return b"".join(chunks)

    targets = [SOURCE / "DC.EXE", *sorted(SOURCE.rglob("*.RMP")),
               *sorted((SOURCE / "SCENARIO").rglob("*.SCN")),
               *sorted((ROOT / "raw_cd").glob("*.LST"))]
    comparisons = []
    with (ROOT / "Dark Colony ISO/Dark Colony.mdf").open("rb") as stream:
        data_track = DataTrack(stream)
        data_track.seek(16 * 2048)
        primary = data_track.read(2048)
        assert primary[:7] == b"\x01CD001\x01"
        image = pycdlib.PyCdlib()
        image.open_fp(data_track)
        try:
            entries = {directory.rstrip("/") + "/" + filename for directory, _, filenames in image.walk(iso_path="/")
                       for filename in filenames}
            source_scenarios = {"/" + str(path.relative_to(ROOT / "raw_cd")) + ";1"
                                for path in targets if path.suffix == ".SCN"}
            disc_scenarios = {entry for entry in entries
                              if entry.startswith("/DC/SCENARIO/") and entry.endswith(".SCN;1")}
            assert disc_scenarios == source_scenarios
            assert len([entry for entry in entries if entry.startswith("/DC/") and entry.endswith(".RMP;1")]) == 21
            for target in targets:
                relative = str(target.relative_to(ROOT / "raw_cd"))
                iso_path = "/" + relative + ";1"
                assert iso_path in entries, iso_path
                output = io.BytesIO()
                image.get_file_from_iso_fp(output, iso_path=iso_path)
                original = output.getvalue()
                assert original == target.read_bytes(), relative
                comparisons.append({"iso_path": iso_path, "bytes": len(original),
                                    "sha256": hashlib.sha256(original).hexdigest()})
        finally:
            image.close()
    assert sum(record["iso_path"].endswith(".SCN;1") for record in comparisons) == 108
    assert sum(record["iso_path"].endswith(".RMP;1") for record in comparisons) == 21
    return {"geometry": geometry, "primary_volume_sha256": hashlib.sha256(primary).hexdigest(),
            "mds_sha256": hashlib.sha256((ROOT / "Dark Colony ISO/Dark Colony.mds").read_bytes()).hexdigest(),
            "byte_identical_files": comparisons}


def rmp_probe(native, basename, prior=None, local=True, cd=True, layout=None):
    from unicorn import UC_HOOK_CODE
    from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_ESP

    machine = native.machine()
    allocator, display, palette, colors, aligned = 0x710000, 0x711000, 0x712000, 0x730000, 0x810000
    machine.mem_write(allocator, struct.pack("<IIII", 0x800000, 0x50000, 0x113, 0))
    machine.mem_write(aligned, bytes([0xA5]) * 0x30000)
    put(machine, display + 0x20, palette)
    put(machine, display + 0x24, allocator)
    put(machine, palette + 0x14, colors)
    put(machine, palette + 0x114, 0x70FE00)
    put(machine, 0x48911C, 0x70FD00)
    put(machine, 0x489120, 0x70FD00)
    machine.mem_write(0x714000, basename.encode("ascii") + b"\0")
    machine.mem_write(0x494880, b"D:\\DC\\\0")
    machine.mem_write(0x494988, bytes([int(cd)]))
    machine.mem_write(0x478CD9, b"\0")
    put(machine, 0x47C06C, 0)
    if prior is not None:
        assert len(prior) == 0x30000
        machine.mem_write(aligned, prior)
        put(machine, 0x47C06C, aligned)
    machine.reg_write(UC_X86_REG_EAX, display)
    machine.reg_write(UC_X86_REG_EDX, 0x714000)
    inventory = {str(path.relative_to(SOURCE)).lower(): path for path in SOURCE.rglob("*") if path.is_file()}
    attempts, reads, reader_basenames, handles = [], [], [], {}
    positions, descriptor_reads = {}, []

    def hook(emulator, address, size, user_data):
        if address == 0x46CB74:
            stack = emulator.reg_read(UC_X86_REG_ESP)
            destination, format_address, argument = struct.unpack("<III", emulator.mem_read(stack + 4, 12))
            assert string_at(emulator, format_address) == "%s.ncy"
            output = (string_at(emulator, argument) + ".ncy").encode("ascii")
            emulator.mem_write(destination, output + b"\0")
            native_return(emulator, len(output))
        elif address == 0x46C89B:
            filename = string_at(emulator, emulator.reg_read(UC_X86_REG_EAX))
            mode = string_at(emulator, emulator.reg_read(UC_X86_REG_EDX))
            normalized = "/".join(part.rstrip(" .") for part in filename.replace("\\", "/").lower().split("/"))
            on_cd = normalized.startswith("d:/dc/")
            relative = normalized[6:] if on_cd else normalized
            available = local and (layout is None or relative in layout["rmp_paths"] or not relative.endswith(".rmp"))
            path = inventory.get(relative) if on_cd or available else None
            attempts.append({"filename": filename, "mode": mode, "opened": path is not None})
            handle = 0
            if path is not None:
                handle = 0x720000 + 0x100 * len(handles)
                handles[handle] = path
                positions[handle] = 0
                put(emulator, handle, handle + 0x80)
                put(emulator, handle + 4, 0)
                put(emulator, handle + 8, handle + 0x40)
                put(emulator, handle + 0x48, handle + 0x80)
                put(emulator, handle + 0xC, 0x41)
                put(emulator, handle + 0x10, handle)
                put(emulator, handle + 0x14, 512)
            native_return(emulator, handle)
        elif address == 0x46D00C:
            element_size = emulator.reg_read(UC_X86_REG_EDX)
            count = emulator.reg_read(UC_X86_REG_EBX)
            path = handles[emulator.reg_read(UC_X86_REG_ECX)]
            reads.append({"path": str(path.relative_to(SOURCE)), "element_size": element_size,
                          "requested": count})
        elif address == 0x46DDDC:
            descriptor = emulator.reg_read(UC_X86_REG_EAX)
            count = emulator.reg_read(UC_X86_REG_EBX)
            position = positions[descriptor]
            data = handles[descriptor].read_bytes()[position:position + count]
            if data:
                emulator.mem_write(emulator.reg_read(UC_X86_REG_EDX), data)
            positions[descriptor] += len(data)
            descriptor_reads.append({"requested": count, "returned": len(data)})
            native_return(emulator, len(data))
        elif address == 0x40638B:
            reads[-1]["returned"] = emulator.reg_read(UC_X86_REG_EAX)
        elif address == 0x46A8EE:
            native_return(emulator, 0)
        elif address in (0x44E8DC, 0x44EED0):
            register = UC_X86_REG_EAX if address == 0x44E8DC else UC_X86_REG_EDX
            reader_basenames.append(string_at(emulator, emulator.reg_read(register)))
            native_return(emulator)
        elif address in (0x70FE00, 0x70FD00):
            native_return(emulator)
        elif address == 0x44F26C:
            raise AssertionError("Unexpected open-failure generation path")

    machine.hook_add(UC_HOOK_CODE, hook)
    execute(machine, 0x42BCAC, 0x42BD54)
    assert reader_basenames == [basename, basename]
    assert len(reads) == 1 and reads[0]["element_size"] == 1 and reads[0]["requested"] == 0x30000
    rmp_attempts = [attempt for attempt in attempts if attempt["filename"].lower().endswith(".rmp")]
    expected_attempts = [basename + ".rmp"] if local else [basename + ".rmp", "D:\\DC\\" + basename + ".rmp"]
    assert [attempt["filename"] for attempt in rmp_attempts] == expected_attempts
    assert all(attempt["mode"] == "rb" for attempt in rmp_attempts)
    source = (SOURCE / reads[0]["path"]).read_bytes()
    assert reads[0]["returned"] == len(source)
    expected_descriptor_reads = [{"requested": 0x30000, "returned": len(source)}]
    if len(source) < 0x30000:
        expected_descriptor_reads.append({"requested": 0x30000 - len(source), "returned": 0})
    assert descriptor_reads == expected_descriptor_reads
    actual = bytes(machine.mem_read(aligned, 0x30000))
    expected = source + (prior[len(source):] if prior is not None else bytes(0x30000 - len(source)))
    assert actual == expected
    return {"basename": basename, "layout": layout["list"] if layout is not None else "source tree",
            "local_available": local, "cd_fallback_enabled": cd,
            "prior_buffer": "full previous RMP" if prior is not None else "first allocation",
            "gif_rgb_basenames": reader_basenames, "open_attempts": attempts, "reads": reads,
            "descriptor_reads": descriptor_reads,
            "unread_bytes": 0x30000 - len(source), "result_sha256": hashlib.sha256(actual).hexdigest(),
            "tail": "none" if len(source) == 0x30000 else "retained" if prior is not None else "zero"}


def initializer_probe(native):
    from unicorn import UC_HOOK_CODE
    from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EIP

    records = []
    for existing in (False, True):
        machine = native.machine()
        aligned = 0x810000
        initial = bytes([0xA5]) * 0x30000
        machine.mem_write(aligned, initial)
        machine.mem_write(0x710000, struct.pack("<IIII", 0x800000, 0x50000, 0x113, 0))
        machine.reg_write(UC_X86_REG_EAX, 0x710000)
        machine.mem_write(0x47C06C, struct.pack("<I", aligned if existing else 0))
        allocations = []

        def hook(emulator, address, size, user_data):
            if address == 0x40BCC0:
                allocations.append(emulator.reg_read(UC_X86_REG_EDX))

        machine.hook_add(UC_HOOK_CODE, hook)
        machine.emu_start(0x44F0D0, 0x70FF00, count=1000000)
        assert machine.reg_read(UC_X86_REG_EIP) == 0x70FF00
        assert allocations == ([] if existing else [0x3FFFF])
        assert struct.unpack("<I", machine.mem_read(0x47C06C, 4))[0] == aligned
        expected = bytearray(initial if existing else bytes(0x30000))
        if not existing:
            expected[:256] = bytes(range(256))
            expected[0x10000:0x10010] = bytes(range(16))
        assert machine.mem_read(aligned, len(expected)) == expected
        records.append({"existing_buffer": existing, "allocation_requests": allocations,
                        "identity_ranges": [] if existing else [[0, 256], [65536, 65552]],
                        "tail_67584_to_196608": "retained" if existing else "zeroed by allocator"})
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disasm", type=lambda value: int(value, 0), nargs=2, action="append")
    parser.add_argument("--refs", type=lambda value: int(value, 0), nargs="+")
    args = parser.parse_args()
    native = Native()
    if args.disasm or args.refs:
        print(f"SHA256 {EXE_HASH}")
        for start, end in args.disasm or []:
            native.disasm(start, end)
        if args.refs:
            native.refs(args.refs)
        return
    scenarios = scenario_probe(native)
    assert Counter(record["native_palette"] for record in scenarios) == {
        "desert": 45, "jungle": 42, "htrain": 15, "atlantis": 6,
    }
    package_layouts = packages()
    basenames = sorted({record["native_palette"] for record in scenarios} | {"palette"})
    reads = [rmp_probe(native, basename, layout=layout) for basename in basenames for layout in package_layouts]
    reads.extend(rmp_probe(native, basename, local=False) for basename in basenames)
    short_name = "scenario/mplayer/palette"
    short = (SOURCE / "SCENARIO/MPLAYER/PALETTE.RMP").read_bytes()
    assert len(short) == 67584
    assert hashlib.sha256(short).hexdigest() == "364faf322e0e10eda4315d25fd5561c116d613ca5c487d267c5d258a715fc61f"
    reads.extend([rmp_probe(native, short_name),
                  rmp_probe(native, short_name, prior=(SOURCE / "PALETTE.RMP").read_bytes())])
    print(json.dumps({"scope": "Pinned shipped campaign/MPLAYER setup; not a full Windows game execution",
                      "short_rmp": "Not requested by this setup graph; standalone format remains unsupported",
                      "exe_sha256": EXE_HASH, "initializer": initializer_probe(native),
                      "disc": disc_probe(), "packages": package_layouts, "scenario_count": len(scenarios),
                      "palette_counts": dict(Counter(record["native_palette"] for record in scenarios)),
                      "multiplayer_palette_counts": dict(Counter(record["native_palette"] for record in scenarios
                                                                  if "/MPLAYER/" in record["scn"])),
                      "native_reads": reads, "scenarios": scenarios}, indent=2))


if __name__ == "__main__":
    main()