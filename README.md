# Dark Colony browser port

This repository is a clean-room browser reimplementation scaffold for the 1997
RTS *Dark Colony*. Users must provide their own game disc data.

Phase 1 is complete, and the Phase 2 extraction pipeline is operational. The
mixed-mode MDF/MDS image is validated, every disc file is fingerprinted, all 284
SPR archives decode into deterministic PNG atlases, and 164 standard FIN files
decode into named animation timelines. Four BTS banks decode into 4,764 keyed
terrain tiles, and all 108 MAP/MTG/PTH bundles export to typed binary layers.
All 259 WAVs, 59 AVIs, and four Red Book tracks also convert to browser-native
media. HUMAN01 and ALIEN01 now run as source-driven mission slices using their
original SCN placements, initial TRO reinforcements, 96x84 MAP layers,
GAMESTAT units, and shipped 640x480 interface frame. The remaining TRO runtime
and unresolved MAP composition are not complete. Generated proprietary content
remains ignored and must be produced from a user-owned disc.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A mounted or extracted Dark Colony disc tree for inventory generation

## GitHub Pages

The game runs as a static site; no application server or database is required.
The configured playable site is
**https://rafaelzacarias.github.io/darkcolony-assets/**.
It is built by the `darkcolony-assets` repository's Actions workflow, combining
its generated assets with a pinned commit from this public source repository.

An alternative single-repository Actions deployment is also included here.
See [the deployment guide](docs/github-pages.md)
for repository setup, the separately supplied game-asset bundle, and testing a
repository-prefix URL. This repository's alternative workflow stays disabled until its asset URL and
SHA-256 repository variables are configured. Do not publish the original game
assets unless you have permission to redistribute them.

## Commands

```sh
npm install
npm run extract-assets -- --source raw_cd --output asset_manifest.json
npm test
npm run typecheck
npm run build
npm run dev
```

`extract-assets` writes `asset_manifest.json`, sprite atlases and metadata under
`public/assets/generated/sprites/`, animation timelines under `animations/`,
terrain atlases under `terrain/`, map layers under `maps/`, original mission
tables/scripts under `data/`, and browser-native interface screens under
`interface/`. Pass `--inventory-only` to skip format conversion. `npm run dev`
opens a full-screen game menu using the original planet artwork. **New game**
starts either campaign; **Mission select** inside that screen exposes all 30
missions. **Options > Extras: asset browser** opens the sprite, terrain, media,
and simulation inspection tools. Use `--disc-descriptor <file.mds>` when the descriptor is not
at the default `Dark Colony ISO/Dark Colony.mds` path.

For phone testing on the same trusted Wi-Fi network, run
`npm run dev -- --host 0.0.0.0` and open `http://<computer-LAN-IP>:5173`
(or the port printed by Vite). Asset SHA-256 verification also works on plain
HTTP, where browsers do not expose `crypto.subtle`; the game uses its bundled
SHA-256 implementation instead. Use HTTPS for public hosting.

Phone user agents also get a touch command deck during missions. Hold the
direction buttons to pan; **Select screen** selects your living units inside the current
viewport (not the whole map). **Clear**, **Stop**, **Move**, and **Assault** provide
keyboard-free orders. **Build** opens a large-button build/research menu; tapping
an available item orders one immediately using the normal costs and prerequisites.
**Options** includes objectives, saving/loading, sound, and returning to the main menu.
The battle continues while this menu is open. The deck adapts to portrait and
landscape and is not enabled for desktop or tablet user agents, even on a small
window or touchscreen.

## Main menu and saved games

The opening cinematic does not play on startup. **Options > Watch introduction**
plays it on demand; campaign briefings and outcome movies keep their existing
behavior. The menu and phone controls share charcoal, beveled steel, and warm
red accents inspired by the original interface.

Saving is **manual only**, with three independent slots. In a mission, choose
**Save game** from the original options panel or the phone's **Options** menu,
then select a slot. Replacing an occupied slot requires confirmation.
**Load game** is available both in-game and on the main menu; **Continue**
resumes the most recently committed save. The save/load dialog pauses the
mission while it is open. Existing single-slot saves migrate to slot 1.
Saves store only the current mission state, not the full input history. A
save of about 3,000 ticks in mission 2 is roughly 1.2 MB instead of 11 MB, and
it loads in about 0.2 seconds instead of 5. Loading checks the state's
structure and consistency plus a SHA-256 checksum, which detects corruption
but does not seal the file against editing. Continuing play from a state-only
save matches a full-history replay exactly. Older full-history saves still
load by replaying their history. **Load game** and **Continue** show a
progress bar while that runs, and saving such a game again writes the compact
format. Compact saves also stay far below the 32 MiB save limit that long
full-history missions could exceed.

Saves preserve the mission checkpoint and control groups in IndexedDB in this
browser, on this device and site address. They survive reloads, but are not cloud
saves: another browser, device, or site address has separate storage, and clearing
site data deletes them. Storage and load failures are shown without replacing
the last committed save. Exiting a mission warns about unsaved progress.

Firing briefly reveals the attacker's tile to the target's team, even outside
normal sight range (including attacks on Human 2's captured satellite dishes).
The reveal uses the unit's original GAMESTAT duration, refreshes with each shot,
and follows shared vision. It applies to the battlefield, radar, and targeting;
it does not reveal a surrounding area. Remaining reveal time survives saves and
loads, and expires on simulation ticks rather than wall-clock time.

Click and drag selection use the current unit sprite's body bounds, rather
than only its ground position, including when the viewport is scaled on a
phone. A quick flick counts as a drag from its press and release points, even
if the browser delivered no pointer movement in between. Living player commanders always have a gold star above their heads,
independent of selection or Inspire recharge.

The bottom mission strip displays **FPS** (last second), **AVG** and **LOW**
(rolling five-second average and 1% low FPS), beside the simulation tick.
Hover the statistics for average frame time in milliseconds. These count
rendered animation frames, not simulation ticks; loading and hidden-tab time
are excluded.

HUD refreshes use bounded current-state data instead of copying accumulated
replay history, so the status/build menus do not slow down as a mission's tick
count grows. Full history is retained for saving and replay validation.
Indexed unit bodies and shadows share a per-frame pixel buffer instead of
reading the canvas back for each overlapping sprite. Formation orders use
incremental reachability searches and reuse valid routes, avoiding full-map
searches for every nearby destination. Neither optimization skips simulation
ticks, reduces visual effects, or changes formation destinations.

Playable campaign ground units use eight-direction pathfinding and normalized
diagonal movement. Routes cannot cut blocked corners, and diagonal movement
reserves its swept cells against other units. Loading an older save preserves
its existing path and enables diagonal routing for subsequent orders. The
movement policy is stored in new saves; native-owned research fixtures retain
their original movement semantics.
Reinforcements may leave an already shared spawn tile; blocked routes cannot
enter an unbounded same-frame replanning loop.

Weapon range uses the original DC.EXE ring table (`0x434090`): a cell offset is
in range R when `floor(sqrt(dx² + dy²)) <= R`. A range-1 melee unit can
therefore strike from any of the eight neighboring cells, and pursuit picks the
nearest reachable cell that is in range. When a ground route runs into another
unit, the mover first tries the original bounded local reroute (256 search
steps to the next free route cell). If that fails, the allied occupant is
asked to step aside, and the mover waits the original five updates. As in
DC.EXE, the request is also recorded on allies that are moving or fighting, and
they act on it the next time they are idle, so an arriving unit may shift one
cell. The pushed unit tries sideways, then forward diagonals, then back
diagonals, then straight ahead (DC.EXE `0x412bc8`/`0x4126a8`), falling back to
the original shuffled order. Hostile, resource-owned and air units are never
pushed. A move whose final cell is held by a unit that will neither step aside
nor move on ends beside it, instead of queueing forever. Pending step-aside
requests and waits are saved with the mission.

Weapons with a WEAPSTAT speed fire real projectiles (DC.EXE projectile phase
`0x44293c`). Each shot keeps the heading it launched with, travels four substeps
per tick for the original lifetime (`0x43b935`), and deals damage when it hits,
so moving targets can dodge. After a launch the weapon reloads for its rate of
fire plus two updates, the original cadence. Mines apply the original BOOMSTAT
BOOM2 7x7 falloff weights. Projectiles and impacts use the weapon's original FIN
art and stay hidden in fog, like units.

Units pick targets with the original scan (`0x435c14`/`0x435570`): they search
the weapon-range rings in source order and score candidates by armament,
priority type and splash crowding. Idle units that find nothing widen the
search to radius 4, or 9 after being shot. Moving units do not look for targets.
Ground units turn toward each route leg at their GAMESTAT turn speed before
moving (the original route turn task), and sprites face the simulated heading.
Hit units flash one of their original BLOOD reaction banks. A hit plays the
weapon's EXP impact sound, and a projectile's gun sound plays when it launches.

Structures show a health bar and the original damage stages (DC.EXE
`0x414314`): above 11/16 of maximum health they look intact, then they burn,
and at or below 5/16 they are scorched and burning. Each hit also plays one of
the structure's original fire and smoke overlays. A destroyed structure keeps
its death frame, or its scorched ruin when it has no death animation.

Camera panning is continuous: hold the arrow keys or rest the mouse at a
battlefield edge. The phone direction pad uses the same frame-timed speed;
diagonal movement is normalized and does not snap to tile rows or columns.
Releasing input, leaving the battlefield edge, opening a dialog, or switching
away stops panning without a catch-up jump.

Rocket exhaust and flame effects use the mission's original effect blend table
rather than the gray preview atlases. Native-verified effect paths remain intact;
the browser fallback handles mirrored/elevated effects and RGB fog/overlays with
screen-space blending, without claiming exact native terrain-mask parity.

See `ARCHITECTURE.md` for disc geometry, discovered formats, ownership rules,
and phase gates.
