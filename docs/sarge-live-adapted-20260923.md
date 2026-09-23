# Live Adapted SARGE Deployment

## Implemented

The browser-adapted MissionView now exposes `deploySelected()` and
`undeploySelected()`. The command toolbar uses a Lucide satellite-dish toggle
for eligible player SARGE selections. Strict-profile commands return an empty
result without changing state.

Deployment has a separate economy owner. Original source type 4, actor key,
slot, generation and simulation ID remain unchanged. Rendering uses the actual
type-77 SARGSTL FIN/assets. A final Stop command before each simulation advance
suppresses movement and firing; player movement/attack commands exclude deployed
units. Undeployment releases the actor. Source 4/77 health, target class and armor
upgrades must match; type 77 must have zero movement and no weapons. No source
actor transformation or newtype receipt is fabricated.

Acquisition and split semantics follow the bounded evidence in
[sarge-partner-range-20260923.md](sarge-partner-range-20260923.md):

- Ordered band 0..11, offset -22..22, four-cell scan. No nearest/lowest-collector
  fallback and no Euclidean radius.
- Different team, including allied teams; current ground occupancy and team
  visibility bits are required at acquisition.
- Source-bound 6/14 collectors have virtual current type 47/48 only while their
  live economy order is extracting a real, active source VENT. Airborne, moving,
  stopped, dead and same-team collectors are excluded.
- One persistent partner per deployment and one interceptor per collector.
  An occupied first candidate rejects without scanning for a second candidate.
  An unsuccessful acquisition requires explicit undeploy/redeploy to retry.
- Later distance or visibility loss does not erase a link. Collector movement,
  disappearance, death or loss of extraction ends it and releases deployment.
  Interceptor death/undeployment ends interception without erasing earned history.
- Each gross payout is divided into two independently truncated halves:
  25 depletes the reserve by 25, credits 12/12 and records 1 dissipated.
  There is no carried remainder.

Computer-controlled source collectors now receive deterministic adapted harvest
orders to reachable active VENTs, nearest Manhattan distance then source slot.
Player collectors remain manual. This changes adapted enemy income, including
script conditions that consume its real accumulated income; it is not a grant.

## Checkpoints

`economy.incomeInterception` remains optional. Absence retains legacy no-deployment
behavior. The new state uses `browser-adapted-income-interception-v2` and policy
`ordered-source-cells/persistent-partner/truncated-halves`. Old v1 carry-half
interception states are rejected rather than silently reinterpreted. Ordinary
older checkpoints without interception remain supported.

Acquisition stores partner identity, current counterpart type, tick, selected
cell, occupancy/visibility words, visibility mask and pose. Restore checks source
actor/type/binding identity, partner generation/type, historical interceptor
bindings, uniqueness and the exact credited-plus-dissipated reserve equation.
The session income ledger receives only credited totals; its existing reserve
upper bound already accepts source dissipation and was not changed.

## Verification

Focused tests:

```sh
node --import tsx --test tools/qa/browser-income-interception.test.ts tools/qa/sarge-native-policy.test.ts tools/qa/sarge-economy.test.ts tools/qa/sarge-deployment-view.test.ts
node --import tsx --test tools/qa/browser-campaign-economy.test.ts
npm run typecheck
```

- Final SARGE run: 13/13 passed, `/tmp/dc-sarge-controls-final-03.log`.
- Existing economy neighbors: 10/10 passed, included in the 18-test earlier
  combined run `/tmp/dc-sarge-economy-neighbors-01.log`.
- Application typecheck and strict/no-unused scoped QA typecheck passed:
  `/tmp/dc-sarge-project-types-final.log`, `/tmp/dc-sarge-qa-types-final.log`.
- Actual HUMAN10, unchanged source assets: public movement of an original
  aircraft to MTG trip 1 obtains the script-provided SARGE. An original enemy
  collector naturally extracts. Public Stop/deploy acquires it and earns real
  intercepted income, without scenario edits, purchases or fund grants.
- Public H10 replay before acquisition and exact JSON restore/continuation
  after linking passed. Simulation controls cover movement, both deaths,
  one-time link removal, armed attack suppression and resumed mobile fire.
- Eight caller masks, L-envelope boundaries, occupied-link rejection, allied
  different-team selection, odd loss and checkpoint tampering are covered.

## Remaining Limits

This is live **adapted** deployment, not full-game or native scheduler parity.
The native probe's 390 cases were read as evidence, not rerun in this integration.

H10 acquisition uses the full live ground projection and native visibility bit
layout, populated by MissionView's existing adapted day/night and shared-vision
fog. It does not claim the native terrain-occluded visibility producer: the
existing authenticated native visibility configuration admits only HUMAN02 and
ALIEN02 and excludes these deployment producers. Extending that configuration
requires separate source work, not a forged H10 admission.

Deployment completion is immediate at the adapted command boundary; the original
nine FIN visits are not asserted as browser ticks. Existing adapted extraction
periods, adjacent-VENT mining positions and computer harvest routing remain
adapted. Native AI payout multipliers and independent credit gates are not added.
Mobile source equipment metadata remains bound to type 4, while the deployment
owner suppresses actual attacks; no native task stack or reciprocal task bytes
are claimed.

Only player SARGE 4/77 deployment is exposed. Automatic enemy deployment and
PSYC 12/78 are not implemented. Actual H10 death-to-session-loss replay was not
run; death lifecycle controls use explicit simulation fixtures. Source assets
load in the Node renderer, but interactive browser screenshots/pixel fidelity
were not verified. No agents, full test suite, whole-campaign win or native
full-game acceptance run was performed.