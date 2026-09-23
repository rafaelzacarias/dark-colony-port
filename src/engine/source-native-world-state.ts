import { parseScenario } from "../../tools/extractors/data/scenario";
import { authenticateLegacyNativeSchedulerSource, type LegacyNativeSchedulerSource } from "./legacy-native-scheduler";
import { parseDependencies } from "../../tools/extractors/data/tables";
import { parseFin } from "../../tools/extractors/animations/fin";
import { sourceScenarioUpgradeLevels } from "./legacy-scenario-levels";

const missions = {
  HUMAN02: "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab",
  ALIEN02: "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e",
};

export interface SourceNativeWorldPrefixSource {
  readonly scope: "source-native-world-prefix-inputs";
  readonly mission: keyof typeof missions;
}

export interface NativeWorldSourceInputs {
  readonly alliances: Uint8Array;
  readonly sharedVision: Uint8Array;
  readonly renat: Uint8Array;
  readonly renatCount: number;
}

const sources = new WeakMap<SourceNativeWorldPrefixSource, Readonly<{
  scheduler: LegacyNativeSchedulerSource;
  initial: NativeWorldSourceInputs;
  image: Uint8Array;
  scenario: ReturnType<typeof parseScenario>;
}>>();

export async function createSourceNativeWorldPrefixSource(input: Readonly<{
  executable: Uint8Array;
  scenario: Uint8Array;
}>): Promise<SourceNativeWorldPrefixSource> {
  const executable = Uint8Array.from(input.executable), scenario = Uint8Array.from(input.scenario);
  const scheduler = await authenticateLegacyNativeSchedulerSource(executable);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", scenario))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const mission = (Object.keys(missions) as (keyof typeof missions)[]).find(name => missions[name] === hash);
  if (!mission) throw new RangeError("World prefix requires original HUMAN02 or ALIEN02 SCN bytes");
  const parsed = parseScenario(new TextDecoder().decode(scenario));
  const alliances = new Uint8Array(8), sharedVision = new Uint8Array(8);
  for (const team of parsed.teams) {
    alliances[team.index] = 1 << team.index;
    sharedVision[team.index] = 1 << team.index;
    if (team.allies.length !== 8) throw new RangeError("Incomplete source alliance flags");
    team.allies.forEach((flag, other) => {
      if (flag !== 0) alliances[team.index] |= 1 << other;
    });
  }
  const rows = parsed.placementRows.filter(row => row[3] === -1);
  if (rows.length > 25) throw new RangeError("RENAT source exceeds native capacity");
  const renat = new Uint8Array(25 * 40), view = new DataView(renat.buffer);
  rows.forEach((row, index) => [row[0], row[1], row[2], row[4]].forEach((value, field) => {
    view.setInt32(index * 40 + 4 + field * 4, value, true);
  }));
  const source = Object.freeze({ scope: "source-native-world-prefix-inputs" as const, mission });
  sources.set(source, { scheduler, initial: { alliances, sharedVision, renat, renatCount: rows.length }, image: executable,
    scenario: parsed });
  return source;
}

export function requireSourceNativeWorldPrefixSource(source: SourceNativeWorldPrefixSource): LegacyNativeSchedulerSource {
  const binding = sources.get(source);
  if (!binding) throw new RangeError("Original authenticated world-prefix source identity required");
  return binding.scheduler;
}

export function sourceNativeWorldPrefixInputs(source: SourceNativeWorldPrefixSource): NativeWorldSourceInputs {
  requireSourceNativeWorldPrefixSource(source);
  return structuredClone(sources.get(source)!.initial);
}

export const sourceNativeWorldStartupBlocker = Object.freeze({
  phase: "source-startup" as const,
  boundary: 0x43c388,
  owner: "source-native-world-state" as const,
  reason: "Source SCN raw800/CITY constructors exist; complete type FIN/geometry tables, terrain/PTH/globals/heaps and local-session pointer ownership are still missing",
});

function executableBytes(image: Uint8Array, address: number, length: number): Uint8Array {
  const header = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const pe = header.getUint32(0x3c, true), table = pe + 24 + header.getUint16(pe + 20, true);
  const imageBase = header.getUint32(pe + 52, true);
  for (let index = 0; index < header.getUint16(pe + 6, true); index++) {
    const section = table + index * 40, base = imageBase + header.getUint32(section + 12, true);
    const virtualSize = header.getUint32(section + 8, true), rawSize = header.getUint32(section + 16, true);
    if (address < base || address + length > base + Math.max(virtualSize, rawSize)) continue;
    const result = new Uint8Array(length);
    if (!(header.getUint32(section + 36, true) & 0x80)) {
      const available = Math.max(0, Math.min(length, rawSize - (address - base)));
      const start = header.getUint32(section + 20, true) + address - base;
      result.set(image.subarray(start, start + available));
    }
    return result;
  }
  throw new RangeError(`Unmapped source address ${address.toString(16)}`);
}

export interface NativeWorldCityState {
  readonly game: Uint8Array;
  readonly types: Uint8Array;
  readonly dependencies: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly ground: readonly number[];
  readonly productionDirty: number;
  readonly rngCursor: number;
}

export interface NativeWorldCityWrite {
  readonly region: "game" | "dependencies" | "ground" | "productionDirty";
  readonly offset: number;
  readonly size: 1 | 2 | 4;
  readonly value: number;
}

export function constructSourceNativeCity(source: SourceNativeWorldPrefixSource, current: NativeWorldCityState,
  team: number, city: number): { state: NativeWorldCityState; writes: readonly NativeWorldCityWrite[] } {
  requireSourceNativeWorldPrefixSource(source);
  if (!Number.isInteger(team) || team < 0 || team > 7 || !Number.isInteger(city) || city < 0 || city > 14
    || current.game.length !== 0x471b0 || current.types.length !== 110 * 280
    || current.dependencies.length !== 110 * 52 || current.ground.length !== current.width * current.height)
    throw new RangeError("Complete CITY constructor boundary required");
  const state = { ...current, game: Uint8Array.from(current.game), types: Uint8Array.from(current.types),
    dependencies: Uint8Array.from(current.dependencies), ground: [...current.ground] };
  const game = new DataView(state.game.buffer), types = new DataView(state.types.buffer);
  const dependencies = new DataView(state.dependencies.buffer), writes: NativeWorldCityWrite[] = [];
  const image = sources.get(source)!.image;
  const word = (address: number) => new DataView(executableBytes(image, address, 4).buffer).getInt32(0, true);
  const write = (region: NativeWorldCityWrite["region"], offset: number, size: 1 | 2 | 4, value: number) => {
    value = size === 4 ? value >>> 0 : value & (size === 2 ? 0xffff : 0xff);
    writes.push({ region, offset, size, value });
    if (region === "ground") {
      const cell = offset / 4;
      state.ground[cell] = size === 2 ? ((state.ground[cell] & 0xffff0000) | value) >>> 0 : value;
    } else if (region === "productionDirty") state.productionDirty = value;
    else {
      const target = region === "game" ? game : dependencies;
      if (size === 1) target.setUint8(offset, value);
      else if (size === 2) target.setUint16(offset, value, true);
      else target.setUint32(offset, value, true);
    }
  };
  const slot = team * 15 + city, raw = 0x7d28 + slot * 220, side = 0xb98 + team * 0xe30;
  const health = game.getInt32(side + 0x3c + city * 4, true);
  if (health === 0) {
    write("game", raw + 0x2c, 1, 0);
    return { state, writes };
  }
  const race = game.getInt32(side + 0x20, true), level = game.getInt32(side + 0xc4 + city * 4, true);
  if ((race !== 0 && race !== 1) || level < 0 || level > 1 || city > 5
    || ![0, 10].includes(state.game[raw + 0x2c])) throw new RangeError("Fresh fixed CITY constructor required");
  const type = word(0x47afa8 + race * 120 + level * 60 + city * 4);
  const bank = types.getUint32(type * 280 + 0x80, true);
  if (!bank) throw new RangeError("Source CITY stand bank required");
  const animation = (offset: number, mode: number) => {
    if (game.getUint32(raw + offset, true) === bank && state.game[raw + offset + 6] === mode) return;
    write("game", raw + offset + 4, 1, 0);
    write("game", raw + offset + 5, 1, 0);
    write("game", raw + offset + 6, 1, mode);
    write("game", raw + offset, 4, bank);
  };
  write("game", raw + 6, 1, type);
  animation(0x14, 0); animation(0x1c, 2); animation(0x24, 2);
  write("game", raw + 0xc, 4, health);
  const baseX = game.getInt32(side + 0x2c, true), baseY = game.getInt32(side + 0x30, true);
  write("game", raw, 2, baseX * 256 + word(0x47ab70 + city * 8) * 8);
  write("game", raw + 2, 2, 0);
  write("game", raw + 0x35, 1, 255);
  write("game", raw + 9, 1, 0);
  write("game", raw + 0x2c, 1, 1);
  write("game", raw + 0x36, 1, 0);
  write("game", raw + 0xc6, 1, 0);
  write("game", raw + 4, 2, baseY * 256 + word(0x47ab74 + city * 8) * 8);
  write("game", raw + 7, 1, team);
  animation(0x14, 0); animation(0x1c, 2);
  write("game", raw + 0x39, 1, 0); write("game", raw + 0x3a, 1, 0);
  write("game", raw + 0x38, 1, 255);
  write("game", raw + 0x38, 1, 0); write("game", raw + 0x39, 1, 1);
  write("game", raw + 0x3c, 1, 3);
  write("game", raw + 0x46, 2, 65535); write("game", raw + 0x4a, 2, 0);
  write("game", raw + 0x48, 2, health);
  animation(0x14, 2);
  write("game", raw + 0x38, 1, 1); write("game", raw + 0x3b, 1, 19);
  write("game", raw + 0x3e, 1, 4); write("game", raw + 0x4c, 2, 0);
  write("game", side + 0x78 + city, 1, 1);
  if (team === game.getInt32(0x7d1c, true)) {
    for (let dependency = 0; dependency < 110; dependency++) {
      const offset = dependency * 52;
      if (!state.dependencies[offset]) continue;
      const kind = dependencies.getInt32(offset + 16, true), target = dependencies.getInt32(offset + 20, true);
      const threshold = dependencies.getInt32(offset + 24, true), required = dependencies.getInt32(offset + 28, true);
      let satisfied = false;
      if (kind === 0) satisfied = game.getInt32(side + 0x3c + target * 4, true) !== 0
        && game.getInt32(side + 0xc4 + target * 4, true) >= threshold && race === required;
      else if (kind === 2 && (threshold === 0 || threshold === 1))
        satisfied = state.types[target * 280 + (threshold ? 0x38 : 0x30) + team] >= required;
      else if (kind !== 1) throw new RangeError("Unsupported source dependency kind");
      let availability = satisfied ? 0 : 1;
      if (!satisfied) {
        for (let position = 0; position < 5; position++) {
          const prerequisite = dependencies.getInt32(offset + 32 + position * 4, true);
          if (prerequisite === -1) break;
          if (prerequisite < 0 || prerequisite >= 110) throw new RangeError("Invalid dependency source");
          const previous = prerequisite * 52;
          if (prerequisite === dependency || dependencies.getInt32(previous + 4, true) !== 0
            || dependencies.getInt32(previous + 16, true) === 0
            && state.game[side + 0x78 + dependencies.getInt32(previous + 20, true)] !== 0) availability = 2;
        }
        if (kind === 0 && state.game[side + 0x78 + target] !== 0
          || state.game[side + 0xda4 + dependency] !== 0) availability = 2;
      }
      write("dependencies", offset + 4, 4, availability);
    }
    write("productionDirty", 0, 1, 1);
  }
  if (city !== 5) {
    let previousX = -1, previousY = -1;
    for (let point = 0; point < 8; point++) {
      const column = baseX + word(0x47abe8 + city * 64 + point * 8);
      const row = baseY + word(0x47abec + city * 64 + point * 8);
      if (column === previousX && row === previousY) break;
      previousX = column; previousY = row;
      if (column < 0 || row < 0 || column >= state.width || row >= state.height)
        throw new RangeError("CITY footprint outside source terrain");
      const cell = row * state.width + column, occupied = state.ground[cell] & 1023;
      if (occupied !== 1023 && occupied !== 1022 && occupied !== slot) throw new RangeError("CITY footprint occupied");
      write("ground", cell * 4, 2, state.ground[cell] & 0xfc00);
      write("ground", cell * 4, 4, state.ground[cell] | slot);
    }
  }
  write("game", 0x468ec + slot * 2, 2, slot);
  if (slot > game.getInt32(0x7d20, true)) write("game", 0x7d20, 4, slot);
  const group = word(0x41ae30 + city * 4);
  if (group !== 4) {
    write("game", side + 0x110 + group * 2, 2, 0);
    write("game", side + 0x10c + group, 1, 0);
    write("game", side + 0x108 + group, 1, 1);
  }
  return { state, writes };
}

export interface SourceNativeCityAssets {
  readonly executable: Uint8Array;
  readonly scenario: Uint8Array;
  readonly gameStat: Uint8Array;
  readonly depend: Uint8Array;
  readonly map: Uint8Array;
  readonly animations: Readonly<Record<string, Uint8Array>>;
}

export interface SourceNativeCityStartup {
  readonly scope: "source-native-fixed-city-startup";
  readonly source: SourceNativeWorldPrefixSource;
  readonly beforeCities: NativeWorldCityState;
  readonly afterCities: NativeWorldCityState;
  readonly placementEntry: NativeWorldCityState;
  readonly calls: readonly { readonly team: number; readonly city: number; readonly writes: readonly NativeWorldCityWrite[] }[];
  readonly finFields: readonly { readonly type: number; readonly offset: 0x80; readonly id: number; readonly stem: string }[];
  readonly unowned: readonly string[];
}

export async function createSourceNativeCityStartup(input: SourceNativeCityAssets): Promise<SourceNativeCityStartup> {
  const assets = { executable: Uint8Array.from(input.executable), scenario: Uint8Array.from(input.scenario),
    gameStat: Uint8Array.from(input.gameStat), depend: Uint8Array.from(input.depend), map: Uint8Array.from(input.map),
    animations: Object.fromEntries(Object.entries(input.animations).map(([name, bytes]) => [name, Uint8Array.from(bytes)])) };
  const source = await createSourceNativeWorldPrefixSource(assets);
  const hashes: Readonly<Record<string, string>> = {
    gameStat: "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629",
    depend: "5acff29f0ed0f254f6dae17ddfb8fb1f50f6d99e92a5fe363d638f76abe54fd6",
    HUBU: "b27b20282999188e37a74872b70a273b370cc1dd219f2f8fa84f5f2f2ca3a5a4",
    ALBU: "99c3d4e4fa0badeb2cd68361a6f1b57dcf9dfbdd027f820a68d806aa18773fa1",
    TOWR: "9e5637a26681eca10a02669545d4102f1d8f33e407dfeb7a95ab70d5d50bf9e7",
    TRSC: "eb94f6f3fff53b9f46f1540abf5287c11f83a7db7957d6288b2330b13e1f3b2a",
    GRAY: "077887b708009109740a518bf8cff9c547a21145617dbf5dde575342fe5a641a",
    REAP: "44d1e85d5a28bca0ca3e45b5bc8032544f16e1dc04fdfd655c3d70ec15ab540b",
    SCYT: "a07924ca5d72d666ccf9266df0593cb77811f6ac3679a7a19e8a5b804dbd6f55",
    VENT: "9f43206aba24f71a4a0cb7df841e09ebde2a243dc20310cd34644fed2c3ea84a",
    BEAC: "034a2fbe82bb7554b74952e735f038b77c2dfda5fc33889367236973cea24dac",
    DISH: "8c6977818f28b55d79b41c583dd47de30c8d80802e26f353dfad2d64507ecaf9",
    CENT: "58cac6fae5085fe6ee203b22eeaa05af9517cb0320267285159e464713288baf",
    TONG: "5c4510ba67675eb958d77d5b6e857b122d57ab8c6294205ace45e5081380902a",
    TURR: "f0f25f1ae13cfcd6b53e3cdcae2e5efaca09e9e8290eb173bb8ce98a93d3a210",
    map: source.mission === "HUMAN02" ? "ea7377f73ad1d02974d8b2c04d929d3805f591a12b870254a8d466b65685f3c5"
      : "d5ab938493b41614ef12f2640b152970e5aad8668a15e4709d6db3df80c18bae",
  };
  for (const [name, bytes] of Object.entries({ gameStat: assets.gameStat, depend: assets.depend, map: assets.map, ...assets.animations })) {
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== hashes[name]) throw new RangeError(`Unauthenticated CITY source ${name}`);
  }
  const binding = sources.get(source)!, scenario = binding.scenario;
  const word = (address: number) => new DataView(executableBytes(assets.executable, address, 4).buffer).getInt32(0, true);
  const rows = new TextDecoder().decode(assets.gameStat).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("%"));
  if (Number(rows.shift()) !== 106 || rows.length !== 106) throw new RangeError("Incomplete GAMESTAT source");
  const columns = [null, 4, 8, 12, 20, 16, 24, 28, 32, 40, 44, 64, 68, null, 100, 104, 108,
    null, 112, 116, 220, 236, 224, 240, 244, 248, 252, 256, 260, 264, 272, 276, null];
  const types = executableBytes(assets.executable, 0x4f1880, 110 * 280), typeView = new DataView(types.buffer);
  rows.forEach((row, type) => {
    const tokens = row.split(/\s+/), base = type * 280;
    if (tokens.length !== 33) throw new RangeError("Invalid GAMESTAT row");
    columns.forEach((offset, token) => { if (offset !== null) typeView.setInt32(base + offset, Number(tokens[token]), true); });
    types[base] = Number(tokens[32]) !== 0 ? 1 : 0;
    types[base + 0x60] = Number(tokens[13]);
    types[base + 0x10c] = Number(tokens[29]) !== 0 ? 1 : 0;
    typeView.setInt32(base + 0xfc, Math.trunc((Number(tokens[26]) << 8) / 100), true);
    for (const team of scenario.teams) {
      const upgrades = sourceScenarioUpgradeLevels(team, type);
      types[base + 0x30 + team.index] = upgrades.weaponLevel;
      types[base + 0x38 + team.index] = upgrades.armorLevel;
    }
  });
  const states = new Set(Object.values(assets.animations).flatMap(bytes => parseFin(bytes).states
    .filter(state => state.validRange).map(state => state.name.toUpperCase())));
  const cityTypes = new Set(scenario.teams.flatMap(team => Array.from({ length: 6 }, (_, city) => {
    const level = city === 5 ? 1 : team.cityRows[0][city * 2];
    const health = city === 5 ? team.coordinateRows[1][1] !== 0 ? 1 : 0 : team.cityRows[0][city * 2 + 1];
    return team.coordinateRows[1][0] !== 0 && level > 0 && health !== 0
      ? word(0x47afa8 + team.race * 120 + (level - 1) * 60 + city * 4) : -1;
  })).filter(type => type >= 0));
  const finFields = [...cityTypes].map(type => {
    const stem = rows[type].split(/\s+/)[0];
    if (!Array.from({ length: 16 }, (_, direction) => `${stem}STAND${direction}`.toUpperCase()).some(name => states.has(name)))
      throw new RangeError(`Missing original CITY FIN ${stem}STAND`);
    const id = 0x10000000 + type * 280 + 0x80;
    typeView.setUint32(type * 280 + 0x80, id, true);
    return { type, offset: 0x80 as const, id, stem };
  });
  for (const row of scenario.placementRows) {
    if (row[3] === -1) continue;
    let type = row[2];
    if (row[3] < 8 && typeView.getInt32(type * 280 + 4, true) !== scenario.teams[row[3]].race) {
      const counterpart = typeView.getInt32(type * 280 + 0x114, true);
      if (counterpart !== -1) type = counterpart;
    }
    if (finFields.some(field => field.type === type)) continue;
    const stem = rows[type].split(/\s+/)[0];
    if (!Array.from({ length: 16 }, (_, direction) => `${stem}STAND${direction}`.toUpperCase()).some(name => states.has(name))) continue;
    const id = 0x10000000 + type * 280 + 0x80;
    typeView.setUint32(type * 280 + 0x80, id, true);
    finFields.push({ type, offset: 0x80, id, stem });
  }
  const dependencies = executableBytes(assets.executable, 0x4e6d70, 110 * 52);
  const dependencyView = new DataView(dependencies.buffer);
  for (const entry of parseDependencies(new TextDecoder().decode(assets.depend))) {
    const base = entry.id * 52;
    dependencies[base] = 1;
    dependencyView.setInt32(base + 8, entry.cost, true);
    dependencyView.setInt32(base + 12, entry.interfaceId, true);
    entry.rawFields.forEach((value, index) => dependencyView.setInt32(base + 16 + index * 4, value, true));
    [...entry.dependencies, -1].forEach((value, index) => dependencyView.setInt32(base + 32 + index * 4, value, true));
  }
  const game = new Uint8Array(0x471b0), gameView = new DataView(game.buffer);
  const set = (offset: number, value: number) => gameView.setInt32(offset, value, true);
  game[0x30c] = 1;
  set(4, 150); set(0x314, -1); set(0x954, -1); set(0x964, 1); set(0x970, 66);
  for (let index = 0; index < 64; index++) set(0x208 + index * 4, 66);
  for (let team = 0; team < 8; team++) set(0x974 + team * 4, 33);
  game.set(new TextEncoder().encode(scenario.terrainBank), 0x548);
  set(0x53c, Number(scenario.rawHeader[1])); set(0x534, Number(scenario.rawHeader[2]));
  set(0x530, Number(scenario.rawHeader[3])); set(0x538, Number(scenario.rawHeader[4]));
  set(0x540, Number(scenario.rawHeader[1]) * 256);
  gameView.setInt16(0x468e8, -1, true); gameView.setInt16(0x468ea, -1, true);
  for (let slot = 0; slot < 800; slot++) {
    game[0x7d28 + slot * 220 + 8] = slot < 120 ? Math.trunc(slot / 15) : 8;
    gameView.setInt16(0x468ec + slot * 2, -1, true);
  }
  for (let projectile = 0; projectile < 2024; projectile++) gameView.setInt16(0x32cbc + projectile * 40, -1, true);
  for (const team of scenario.teams) {
    const base = 0xb98 + team.index * 0xe30, [baseX, baseY] = team.coordinateRows[1];
    set(base + 0x14, team.money); set(base + 0x20, team.race); set(base + 0x24, team.ai);
    set(base + 0x100, team.teamColor >= 0 && team.teamColor <= 7 ? team.teamColor : team.index);
    set(base + 0x104, team.index);
    set(base + 0x2c, baseX); set(base + 0x30, baseY);
    const camera = team.coordinateRows[0];
    set(base + 0x34, camera[0] || camera[1] ? camera[0] : baseX);
    set(base + 0x38, camera[0] || camera[1] ? camera[1] : baseY);
    for (const dependency of team.dependencies) game[base + 0xda4 + dependency] = 1;
    if (baseX === 0 || baseY === 0) { game[base + 0xda4] = 1; game[base + 0xdb2] = 1; }
    for (let city = 0; city < 15; city++) set(base + 0x88 + city * 4, -1);
    for (let city = 0; city < 5; city++) {
      const level = team.cityRows[0][city * 2], health = team.cityRows[0][city * 2 + 1];
      if (baseX === 0 || level <= 0) continue;
      const defaultType = word(0x47afa8 + (level - 1) * 60 + city * 4);
      set(base + 0x3c + city * 4, health === -1 ? typeView.getInt32(defaultType * 280 + 0x44, true) : health);
      set(base + 0xc4 + city * 4, level - 1);
    }
    set(base + 0x50, baseX !== 0 && baseY !== 0 ? 1 : 0);
    for (let group = 0; group < 4; group++) {
      game[base + 0x108 + group] = 1;
      gameView.setInt16(base + 0xd9c + group * 2, -1, true);
    }
    set(base + 0xe1c, 3); set(base + 0xe28, 0x40000000 >>> team.index);
    game[0x46f3d + team.index * 10] = 1; game[0x46f8e + team.index] = 1;
  }
  const map = new DataView(assets.map.buffer), width = map.getUint32(0, true), height = map.getUint32(4, true);
  const beforeCities: NativeWorldCityState = { game, types, dependencies, width, height,
    ground: Array<number>(width * height).fill(1023), productionDirty: 0, rngCursor: 0 };
  let afterCities = beforeCities;
  const calls: { team: number; city: number; writes: readonly NativeWorldCityWrite[] }[] = [];
  for (let team = 0; team < 8; team++) for (let city = 0; city < 15; city++) {
    const result = constructSourceNativeCity(source, afterCities, team, city);
    afterCities = result.state;
    calls.push({ team, city, writes: result.writes });
  }
  const placementEntry = structuredClone(afterCities);
  new DataView(placementEntry.game.buffer).setInt32(0x7d20, 152, true);
  return { scope: "source-native-fixed-city-startup", source, beforeCities, afterCities, placementEntry, calls, finFields,
    unowned: ["game pointer allocations: application/configuration/command buffer/map/messages/alliance objects",
      "type+7c..d8 FIN banks/idle count, type+e4/e8 variant counts; full FIN geometry/armor-loader transforms",
      "SCN mobile/resource placements at 0x41c453 and post-placement startup",
      "TRO/message/AI heaps, terrain/PTH planes, resource/statistic globals and first world-call composition"] };
}

export interface SourceNativeScenarioStartup {
  readonly scope: "source-native-scn-constructor-prefix";
  readonly boundary: 0x41c6b4;
  readonly cities: SourceNativeCityStartup;
  readonly state: NativeWorldCityState;
  readonly scnReturnGame: Uint8Array;
  readonly unallocatedGamePointerFields: readonly number[];
  readonly renat: Uint8Array;
  readonly renatCount: number;
  readonly resourceTerrainCells: readonly number[];
  readonly placements: readonly { readonly sourceRow: number; readonly slot: number; readonly type: number }[];
  readonly unowned: readonly string[];
}

export async function createSourceNativeScenarioStartup(assets: SourceNativeCityAssets): Promise<SourceNativeScenarioStartup> {
  const cities = await createSourceNativeCityStartup(assets);
  const scenario = sources.get(cities.source)!.scenario;
  const state = structuredClone(cities.placementEntry), game = new DataView(state.game.buffer), types = new DataView(state.types.buffer);
  const ground = [...state.ground], resourceTerrainCells: number[] = [];
  const placements: { sourceRow: number; slot: number; type: number }[] = [];
  let slot = 152;
  for (const [sourceRow, row] of scenario.placementRows.entries()) {
    const [column, line, sourceType, sourceTeam, sourceHealth] = row;
    if (sourceTeam === -1) continue;
    let type = sourceType;
    if (sourceTeam < 8 && types.getInt32(type * 280 + 4, true) !== scenario.teams[sourceTeam].race) {
      const counterpart = types.getInt32(type * 280 + 0x114, true);
      if (counterpart !== -1) type = counterpart;
    }
    if (type === 37 || type >= 69 && type <= 76 || column < 0 || line < 0 || column >= state.width || line >= state.height)
      throw new RangeError("Unowned SCN placement branch");
    const team = type === 40 ? 8 : sourceTeam;
    const raw = 0x7d28 + slot * 220, base = type * 280;
    const stand = types.getUint32(base + 0x80, true);
    if (!cities.finFields.some(field => field.type === type && field.id === stand))
      throw new RangeError(`Original FIN required for SCN type ${type}`);
    if (state.types[base + 0x60] !== 0 || types.getInt32(base + 0x68, true) !== 0)
      throw new RangeError(`Unowned SCN air/extra plane constructor ${type}`);
    game.setUint16(raw, column * 256 + 128, true);
    game.setUint16(raw + 4, line * 256 + 128, true);
    state.game[raw + 0xcd] = column; state.game[raw + 0xce] = line;
    state.game[raw + 6] = type; state.game[raw + 7] = team; state.game[raw + 0x35] = 255;
    state.game[raw + 0x2c] = 1; state.game[raw + 9] = state.types[base + 0xe0];
    state.game[raw + 0xcb] = type === 40 ? 0 : row[5] ?? 0;
    state.game[raw + 0xd1] = 255;
    state.game[raw + 0x39] = 1; state.game[raw + 0x3c] = 3;
    game.setUint16(raw + 0x46, 65535, true);
    state.game[raw + 0xa] = 64;
    game.setInt32(raw + 0xc, sourceHealth <= -1 ? types.getInt32(base + 0x44, true) : sourceHealth, true);
    game.setInt16(raw + 0xd2, -2, true); game.setInt16(raw + 0xd4, -2, true);
    for (const offset of [0x14, 0x1c, 0x24]) {
      game.setUint32(raw + offset, stand, true);
      state.game[raw + offset + 6] = offset === 0x14 ? 0 : 2;
    }
    if (type === 40) {
      game.setUint16(raw + 0x32, sourceTeam, true);
      resourceTerrainCells.push(line * state.width + column);
    } else {
      const cell = line * state.width + column;
      ground[cell] = ((ground[cell] & ~1023) | slot) >>> 0;
    }
    game.setInt16(0x468ec + slot * 2, slot, true);
    placements.push({ sourceRow, slot, type });
    slot++;
    game.setInt32(0x7d20, slot, true);
  }
  const prefix = sourceNativeWorldPrefixInputs(cities.source);
  const scnReturnGame = Uint8Array.from(state.game), scnReturn = new DataView(scnReturnGame.buffer);
  let checksum = [0x534, 0x538, 0x53c, 0x540, 0x94c, 0x7d20, 0x7d24]
    .reduce((sum, offset) => sum + game.getUint16(offset, true), 0);
  for (let index = 0; index <= game.getInt32(0x7d20, true); index++) {
    const raw = 0x7d28 + index * 220, status = state.game[raw + 0x2c];
    checksum += status;
    if (status) checksum += game.getUint16(raw, true) + game.getUint16(raw + 4, true)
      + game.getUint16(raw + 12, true) + state.game[raw + 7] + state.game[raw + 6];
  }
  scnReturn.setUint16(0x994, checksum & 65535, true);
  const unallocatedGamePointerFields = [0x544, 0x958, 0x7d18, 0x46f2c, 0x471a0, 0x471a4];
  return { scope: "source-native-scn-constructor-prefix", boundary: 0x41c6b4, cities, state: { ...state, ground },
    scnReturnGame, unallocatedGamePointerFields,
    renat: prefix.renat, renatCount: prefix.renatCount, resourceTerrainCells, placements,
    unowned: cities.unowned.filter(value => !value.startsWith("SCN mobile/resource"))
      .concat("message pointer array game+46fa0..4719b and local-session startup before cycle 1") };
}