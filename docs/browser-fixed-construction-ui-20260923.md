# Fixed-Slot Construction UI

This is the historical purchase-only v2 report. The final opt-in upgrade
integration is documented in [Browser City Building-Level Upgrades](browser-building-upgrades-20260923.md#final-integration),
including level-1 laboratory access to slot4, exact legacy profile restoration
and passing project typechecks. Claims below about unavailable upgrades and
concurrent typecheck blockers describe this earlier verification only.

The v2 consumer integration is in MissionView, main, game-data's construction
policy helper, and the construction panel. Research, production AI, and the
building-upgrade engine are not changed by this integration.

## Feature Gates

- Main opts fresh browser-adapted missions 4+ into slots 1, 2, 3, 4. ALIEN10
  additionally includes slot 0 so its previously available central purchase
  remains accessible. The ordinary loader still requires explicit opt-in;
  main's M02/M03 defaults and mission-03 expanded production are unchanged.
- `campaignConstructionPolicy` reads saved duration and the exact saved slot
  subset. Absent options stay absent; duration-only v1 stays central-only.
  MissionView and CampaignSession still authenticate and replay the full save.
- Build lists Central base (when admitted), Barracks, Vehicle plant, Science
  laboratory and Research center with source prices, available/queued/busy/
  complete/blocked states, and individual child progress. Existing source
  allocations are not offered as rebuilds. Build/Units tabs share the original
  sidebar; existing production and equipment-upgrade UI remains unchanged.
- Purchase is explicit, paid, and fixed to the source home footprint. It takes
  120 committed visits after purchase (6 simulation seconds). No automatic
  build, free money, relocation, repair, refund or building-level upgrade is
  exposed. Original ALIEN10 still has 1500 against a 2000 central price.
- Barracks/laboratory require central. Vehicle plant requires barracks and
  laboratory. Research center requires laboratory level 1; its disabled label
  explains that building upgrades are unavailable in this UI. Source restrictions
  take precedence, including ALIEN03's restriction on the research center.
- Each purchased slot preloads source art, binds generation 0, projects source
  Q8 position/HP/four-cell footprint, and forwards nonlethal damage through
  `browserConstructionDamage`. V1 retains its scalar damage input. Existing
  source buildings remain outside construction receipt ownership.

## Verification

- Existing central-only full-view tests: 3 passed, including funded control,
  projection rollback, pending/ready saves, collector spawn and M02/M03 absence.
  Log: `/tmp/dc-fixedview-check-179016-own01.log`.
- New fixed-view tests: 3 passed (policy plus two races). Original HUMAN10 and
  explicitly opted-in ALIEN03 spend existing source funds on slot3, bind exact
  footprints, preserve pending/full-view saves, finish at visit120, retain
  production access and reject a different saved subset.
  Log: `/tmp/dc-fixedview-v2-own05.log`. No earned-income or mission-win claim.
- Application typechecking passed (`tsc -p tsconfig.app.json`), and owned files
  had no editor diagnostics. Full project typechecking remains blocked only by
  concurrent income-interception QA API drift (`sourceLinks`/`remainder`).
  Logs: `/tmp/dc-fixedview-app-types-own11.log` and
  `/tmp/dc-fixedview-finaltypes-own08.log`.
- The bounded headed Chromium harness is
  [construction-panel-browser.mjs](../tools/qa/construction-panel-browser.mjs).
  Its final run passed at desktop1280x900 and mobile390x844: actual panel click,
  queued label, 3000->1000 source credit debit, one slot3 binding, repeat purchase
  disabled, nonblank source art (185593 colored pixels), full last-row reachability,
  no horizontal text overflow and no overlap with commands. Screenshots reviewed.
  This uses a cloned original HUD with the real MissionView/panel, not main's
  campaign progression or tab-click workflow. Log:
  `/tmp/dc-fixedview-browser-own12.log`; screenshots/report:
  `/var/folders/ql/l6htjzt524z177vst3ntm98h0000gn/T/dc-fixed-construction-browser-AVKSA2/`.
  Earlier source loading was temporarily blocked by concurrent upgrade-engine
  missing helpers, subsequently supplied by its owner without edits here.
- No agents, full suite, or long mission playthroughs were run.