# Adapted Aircraft Movement

## Scope and Source

ALIEN06 constructor placement:9, slot161, type13/ORTU at (12,74) is an aircraft on an impassable ground tile. The previous generic ground addUnit admission rejected it. Original SCN, TRO, MAP, executable-derived tables, assets, and native runtime admission are unchanged.

Only browser-adapted MissionView mobile projection derives movement from the existing legacyStaticOccupancyFieldsFromSource helper: GAMESTAT rawTail[2] low byte is the movement class, with rawTail[4] selecting auxiliary occupancy. A nonzero movement byte with no auxiliary field maps to air. This is not a type13 whitelist. Original types5/13 and carriers92/93 have byte1; types0/8/12 have byte0. Missing source classification falls back to ground; present malformed source fields still reject. Scripted carrier ownership remains separate.

Types5/13 have source damage targetClass2, not3. Type12 remains ground with targetClass4. Movement plane and damage class are independent; existing source weapon matrix, armor and range calculations remain authoritative, including zero coefficients. No invented attackAir flag or native hit-profile widening.

## Typed Contract

- src/engine/simulation.ts exports MovementPlane = "ground" | "air". AddUnitOptions, UnitSnapshot and checkpoint UnitState carry optional movementPlane; omission means ground.
- Air navigation uses a private same-size all-cost1 NavigationGrid. Ground terrain and static costs are never changed for aircraft. Bounds still apply.
- Straight eight-direction air segments use Euclidean subcell motion rounded to integers. Blocked direct segments use the existing deterministic cardinal A* and safe diagonal folding. This is an adapted route, not a globally optimal eight-neighbor A* or native aircraft steering reproduction.
- Mixed move selections plan one formation per plane. Ground and air may share destinations and positions. Aircraft avoid other aircraft using separate swept reservations, including diagonal corners. Static footprints affect ground only.
- movementReservations entries accept optional plane. Missing means ground; new ground serialization retains the old shape, air entries emit plane:"air". Restore rejects invalid planes, duplicate plane/index entries, and reservations belonging to a live unit on another plane.
- MissionView additionally checks every restored mobile plane against its original source definition. Old ground checkpoints remain compatible. An old ground-tagged aircraft checkpoint is not silently upgraded.
- A ground attacker targeting aircraft over impassable terrain approaches a passable firing-range cell. Air pursuit and static-target approach use the air grid. All mobile units must stop before shooting; aircraft can hover and fire but cannot fire on a movement update.

## Integration

MissionView admits player air move orders and cursor destinations over impassable cells. The pure browser AI gets one private air planning grid and filters observed occupancy by plane. Ground planning and policy are otherwise unchanged; no hidden mobile positions are introduced. AI route metadata remains the existing cardinal planning route; the simulation owns diagonal execution.

Source host height, when nonzero, offsets adapted aircraft drawing and scene capture using the existing /8 screen and *4 subcell conversions. No altitude is fabricated when the host height is zero, and no new FIN anchor or assets are invented. Browser rendering and pixel parity were not tested.

## Verification

- tools/qa/mission-air.test.ts: unchanged original ALIEN06 constructor succeeds; slot161 type13 is air at (12.5,74.5), ground (12,74) stays impassable; 200 natural simulation updates preserve all ground costs. JSON restore is exact and a source-plane substitution rejects even after its reservations are removed.
- The same test issues a public player-aircraft move to impassable (36,94), saves mid-flight, and compares 15 continuation updates exactly after restore. Mission source data is unchanged.
- tools/qa/simulation-air.test.ts: explicit bounded admission, legacy ground JSON shape, mixed-plane overlap and formations, air separation, diagonal swept motion, mid-path replay, shoreline attack approach, both original type5/type13 stationary hover fire, class2 matrix damage, zero coefficient, and static weapon shots.
- Seven focused browser AI air/source-base/static-footprint controls pass. Existing simulation checkpoint tests pass (15), including native ordinary profiles and legacy ground reservations.
- The complete neighboring ground checkpoint/diplomacy/combat-movement/fire-audit selection passes 39 tests.
- Default-profile HUMAN01 and ALIEN01 both retain omitted ground plane fields and exact legacy checkpoint round trips (one focused test, eight updates per mission). The total focused selection is 55 passing tests: nine air/view controls, seven AI controls, and 39 ground/fire regressions.
- Scoped strict TypeScript with noUnusedLocals/noUnusedParameters passes for the three runtime modules and affected tests.

This is bounded browser-adapted simulation evidence, not completed ALIEN06 gameplay, native aircraft task/flight/altitude parity, general auxiliary-plane support, or asset/render admission. Native source combat remains on its existing verified ground scope. No agents, browser, full suite, package changes, asset edits, or census artifact rewrites were used.