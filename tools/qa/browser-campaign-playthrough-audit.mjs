import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const reports = process.argv.slice(2).map(journal => {
  const events = readFileSync(journal, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const harness = events.find(event => event.kind === "harness").data;
  const faction = harness.faction;
  const collectorType = faction === "human" ? 6 : 14;
  const collectorDependency = faction === "human" ? 7 : 21;
  const summary = JSON.parse(readFileSync(join(dirname(journal), "result-summary.json"), "utf8"));
  let spent = 0;
  const purchases = events.filter(event => event.kind === "action" && event.data.kind === "purchase" && event.data.accepted);
  for (const event of purchases) {
    const action = event.data;
    assert.ok([collectorDependency, faction === "human" ? 9 : 23].includes(action.dependency));
    assert.equal(action.cost, action.dependency === collectorDependency ? 1500 : 350);
    assert.ok(action.before >= action.cost);
    spent += action.cost;
    assert.ok(action.earned >= spent);
  }
  const harvests = events.filter(event => event.kind === "action" && event.data.kind === "harvest" && event.data.accepted);
  for (const event of harvests) {
    assert.equal(event.data.visible, true);
    assert.ok(event.data.rate > 0 && event.data.remaining > 0);
  }
  assert.equal(summary.publishedIncome - summary.spent, summary.credits);
  assert.ok(summary.earned >= summary.publishedIncome);
  const verified = events.filter(event => ["checkpoint-verified", "winning-boundary-verified"].includes(event.kind));
  if (summary.status === "WIN") {
    assert.deepEqual(summary.outcome, { resultCode: 0, reasonCode: 1, ready: true });
    assert.ok(summary.objective.value >= summary.objective.required);
    assert.ok(verified.some(event => event.kind === "winning-boundary-verified"));
  }
  const actorTypes = new Map(events.filter(event => event.kind === "actor").map(event => [event.data.id, event.data.source?.type]));
  return { faction, journal, status: summary.status, tick: summary.tick, objective: summary.objective,
    outcome: summary.outcome, diagnostic: summary.diagnostic, earned: summary.earned,
    publishedIncome: summary.publishedIncome, spent: summary.spent, credits: summary.credits,
    purchases: summary.purchases, shots: summary.shots, deaths: summary.deaths,
    health: summary.playerHealth.filter(row => row.type === collectorType || row.type === (faction === "human" ? 69 : 73)),
    replacements: purchases.filter(event => event.data.dependency === collectorDependency),
    collectorHarvests: harvests.filter(event => event.data.ids.some(id => actorTypes.get(id) === collectorType)),
    remaining: summary.economy.remaining, harvestOrders: summary.economy.orders,
    restoreProof: verified, failures: events.filter(event => event.kind === "harness-failure"),
    checkpoint: events.findLast(event => event.kind === "checkpoint")?.data,
    runtimeHashes: harness.runtimeHashes,
    recordedStrategyHash: harness.runtimeHashes["tools/qa/fixtures/browser-campaign-playthrough.ts"] };
});
assert.ok(reports.length > 0, "Pass one or more playthrough journal paths");
console.log(JSON.stringify(reports, null, 2));