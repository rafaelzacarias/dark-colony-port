import assert from "node:assert/strict";
import test from "node:test";
import { AcquisitionIndex, acquireBrowserTarget } from "../../src/engine/browser-target-acquisition";
import { guardCommands } from "../../src/engine/guard-ai";
import { LEGACY_SCAN_OFFSETS } from "../../src/engine/legacy-scan-offsets";
import { acquireLegacySourceCombatTarget, type LegacySourceCombatWorld } from "../../src/engine/legacy-source-combat-acquisition";
import type { SimulationSnapshot } from "../../src/engine/simulation";

const WIDTH = 24, HEIGHT = 24;
// Types: 0 armed guard, 1 armed, 2 unarmed, 3 armed priority, 4 armor-immune to weapon class 0, 5 excluded.
const TYPES = [
  { armed: true, priority: false, armor: 1 }, { armed: true, priority: false, armor: 1 },
  { armed: false, priority: false, armor: 1 }, { armed: true, priority: true, armor: 1 },
  { armed: true, priority: false, armor: 0 }, { armed: true, priority: false, armor: 1, excluded: true },
];

function lcg(seed: number) { let state = seed >>> 0; return (limit: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % limit; }; }

interface Actor { slot: number; type: number; team: number; cell: [number, number]; air: boolean; health: number }

function build(actors: Actor[], splash: boolean) {
  const typeTable = new Array(110 * 280).fill(0);
  const view = new DataView(Uint8Array.from(typeTable).buffer);
  TYPES.forEach((type, index) => {
    const offset = index * 280;
    view.setInt32(offset + 0x18, type.armed ? 0 : -1, true);
    view.setInt32(offset + 0x40, type.armor, true);
    typeTable[offset + 0x60] = type.priority ? 1 : 0;
    typeTable[offset] = type.excluded ? 1 : 0;
    for (let team = 0; team < 8; team++) typeTable[offset + 0x30 + team] = 0;
  });
  const bytes = new Uint8Array(view.buffer);
  for (let index = 0; index < typeTable.length; index++) typeTable[index] = bytes[index] || typeTable[index];
  const weapons = new Array(72).fill(0);
  const weaponView = new DataView(new ArrayBuffer(72));
  weaponView.setInt32(0, 0, true); weaponView.setInt32(20, 4, true); weaponView.setInt32(0x1c, splash ? 1 : 0, true);
  for (let index = 0; index < 72; index++) weapons[index] = weaponView.getUint8(index);
  const relations = Array.from({ length: 100 }, (_, index) => {
    const a = Math.floor(index / 10), b = index % 10;
    return Number(a === b || (a < 3 && b < 3 && a + b === 2 && a !== 1 && b !== 1));
  });
  const size = WIDTH * HEIGHT;
  const ground = new Array(size).fill(1023), air = new Array(size).fill(1023), extra = new Array(size).fill(1023);
  const raws: Record<number, number[]> = {};
  for (const actor of actors) {
    const raw = new Array(220).fill(0), rawView = new DataView(new ArrayBuffer(220));
    raw[0] = 0; raw[1] = actor.cell[0]; raw[4] = 0; raw[5] = actor.cell[1]; raw[6] = actor.type; raw[7] = actor.team; raw[0x2c] = 5;
    rawView.setInt32(12, actor.health, true);
    for (let index = 12; index < 16; index++) raw[index] = rawView.getUint8(index);
    raws[actor.slot] = raw;
    (actor.air ? air : ground)[actor.cell[1] * WIDTH + actor.cell[0]] = actor.slot;
  }
  const groundMasked = ground.map((value, cell) => (value | (actors.some(a => a.cell[1] * WIDTH + a.cell[0] === cell) ? 1 << 16 : 0)) >>> 0);
  const damageTable = Array.from({ length: 8 }, (_, cls) => Array.from({ length: 8 }, (_, armor) => cls === 0 && armor === 0 ? 0 : 100));
  const world: LegacySourceCombatWorld = { typeTable, relations, actors: raws, cityFlags: new Array(120).fill(0), damageTable,
    scanOffsets: LEGACY_SCAN_OFFSETS.map(point => [...point]), width: WIDTH, height: HEIGHT,
    ground: groundMasked, air, extra, enemyMask: 1 << 16, weapons };
  return { world, raws };
}

function snapshot(actors: Actor[]): SimulationSnapshot {
  const alliances = Array.from({ length: 8 }, (_, a) => Array.from({ length: 8 }, (_, b) => Number(a !== b && a + b === 2 && a !== 1 && b !== 1)));
  return { tick: 0, entityCount: actors.length, timeOfDay: "day", daylightPermille: 1000, randomState: 0, resources: {} as never,
    buildings: [], staticTargets: [], resourceNodes: [], teamAlliances: alliances as never,
    units: actors.map(actor => ({ id: actor.slot + 1, faction: "human", team: actor.team, activity: "idle", xSubcells: 0, ySubcells: 0,
      cellX: actor.cell[0], cellY: actor.cell[1], health: actor.health, maxHealth: 800, cargo: 0, cargoCapacity: 0, targetId: null,
      movementPlane: actor.air ? "air" : "ground" })) } as unknown as SimulationSnapshot;
}

function scene(seed: number): Actor[] {
  const next = lcg(seed);
  const used = new Set<number>();
  const actors: Actor[] = [{ slot: 0, type: 0, team: 0, cell: [8 + next(8), 8 + next(8)], air: false, health: 400 }];
  used.add(actors[0].cell[1] * WIDTH + actors[0].cell[0]);
  const count = 5 + next(10);
  for (let slot = 1; slot <= count; slot++) {
    const cell: [number, number] = [next(WIDTH), next(HEIGHT)];
    const key = cell[1] * WIDTH + cell[0];
    const air = next(5) === 0;
    if (!air && used.has(key)) continue;
    if (!air) used.add(key);
    actors.push({ slot, type: next(6), team: [0, 1, 1, 2, 3][next(5)], cell, air, health: 1 + next(800) });
  }
  return actors;
}

for (const splash of [false, true]) {
  test(`browser acquisition matches the original scan on constructed scenes (splash=${splash})`, () => {
    let found = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const actors = scene(seed), { world, raws } = build(actors, splash);
      const radius = [4, 9, 16][seed % 3];
      const expected = acquireLegacySourceCombatTarget(0, raws[0], world, radius);
      assert.ok(expected.supported, JSON.stringify(expected));
      const shot = snapshot(actors);
      const bySlot = new Map(actors.map(actor => [actor.slot + 1, actor]));
      const actual = acquireBrowserTarget({ snapshot: shot, guardId: 1, radiusCells: radius, splash, width: WIDTH, height: HEIGHT,
        canDamage: id => TYPES[bySlot.get(id)!.type].armor !== 0,
        traits: id => { const type = TYPES[bySlot.get(id)!.type]; return { armed: type.armed, priority: type.priority, excluded: !!("excluded" in type && type.excluded) }; } });
      assert.equal(actual === null ? -1 : actual - 1, expected.target, `seed ${seed}`);
      if (actual !== null) found++;
    }
    assert.ok(found > 50, "scenes must exercise real selections");
  });
}

test("ring scan reaches (3,3) at radius 4 and picks priority over a nearer target", () => {
  const actors: Actor[] = [
    { slot: 0, type: 0, team: 0, cell: [10, 10], air: false, health: 400 },
    { slot: 1, type: 1, team: 1, cell: [11, 10], air: false, health: 400 },
    { slot: 2, type: 3, team: 1, cell: [13, 13], air: false, health: 400 },
  ];
  // Living non-splash candidates all score zero in 0x435570, so the priority bonus only shows for splash weapons.
  const request = { snapshot: snapshot(actors), guardId: 1, radiusCells: 4, canDamage: () => true, splash: true,
    traits: (id: number) => TYPES[actors[id - 1].type] };
  assert.equal(acquireBrowserTarget(request), 3);
  assert.equal(acquireBrowserTarget({ ...request, radiusCells: 2 }), 2);
  assert.equal(acquireBrowserTarget({ ...request, splash: false }), 2);
  assert.equal(new AcquisitionIndex(request.snapshot).at(13, 13).length, 1);
});

test("guardCommands: weapon range first, then radius 4 idle / 9 damaged; moving units never widen", () => {
  const actors: Actor[] = [
    { slot: 0, type: 0, team: 0, cell: [10, 10], air: false, health: 400 },
    { slot: 1, type: 1, team: 1, cell: [16, 10], air: false, health: 400 },
  ];
  const observer = { id: 1, dayRangeCells: 12, nightRangeCells: 12, weaponRangeCells: 3 };
  const idle = snapshot(actors);
  assert.deepEqual(guardCommands(idle, [observer]), []);
  const hit = [{ type: "shot", tick: 0, attackerId: 2, targetId: 1, damage: 5 }] as never;
  assert.deepEqual(guardCommands(idle, [observer], hit), [{ type: "attack", unitIds: [1], targetId: 2 }]);
  const moving = { ...idle, units: idle.units.map(unit => unit.id === 1 ? { ...unit, activity: "move" as const } : unit) };
  assert.deepEqual(guardCommands(moving, [observer], hit), []);
  assert.deepEqual(guardCommands(idle, [{ ...observer, mobile: false }], hit), []);
  assert.deepEqual(guardCommands(idle, [{ ...observer, weaponRangeCells: 6 }]), [{ type: "attack", unitIds: [1], targetId: 2 }]);
});
