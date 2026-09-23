import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const sum = values => values.reduce((total, value) => total + value, 0);
const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
const runs = process.argv.slice(2).map(journal => {
  const events = readFileSync(journal, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const source = events.find(event => event.kind === "harness").data;
  const admission = events.find(event => event.kind === "admission").data;
  const resultEvent = events.find(event => event.kind === "result");
  const observation = resultEvent ?? events.filter(event => event.kind === "progress").at(-1);
  assert.ok(observation, `${journal}: no outcome or progress evidence`);
  const result = observation.data;
  const failure = events.filter(event => event.kind === "failure" || event.kind === "harness-failure").at(-1);
  const deaths = unique(events.filter(event => event.kind === "combat").flatMap(event => event.data.deaths));
  const shots = unique(events.filter(event => event.kind === "combat").flatMap(event => event.data.combat));
  const actors = new Map(events.filter(event => event.kind === "actor").map(event => [event.data.id, event.data]));
  const faction = source.faction.toUpperCase();
  const rawSourceUnchanged = Object.entries(source.rawHashes).every(([extension, expected]) =>
    hash(readFileSync(`${root}raw_cd/DC/SCENARIO/${faction}/${faction}02.${extension}`)) === expected);
  const initialReserve = sum(admission.economy.nodes.map(node => node.amount));
  const remainingReserve = sum(Object.values(result.economy.remaining));
  const allTeamEarnings = sum(Object.values(result.economy.earned));
  const finiteReserveBalanced = initialReserve - remainingReserve === allTeamEarnings;
  const readyWin = !!resultEvent && result.status === "WIN" && result.outcome?.ready === true && result.outcome.resultCode === 0 &&
    result.objective.value >= result.objective.required && !result.diagnostic;
  const checkpointVerified = !!resultEvent && events.some(event => event.kind === "checkpoint-verified" && event.tick === resultEvent.tick);
  const currencyAudit = result.currencyAudit ?? { delivered: result.earned, published: result.publishedIncome,
    spent: result.spent, credits: result.credits, unposted: result.earned - result.publishedIncome,
    balanced: result.publishedIncome - result.spent === result.credits };
  return { journal, source, status: resultEvent ? result.status : "INCOMPLETE", tick: result.tick,
    observationTick: observation.tick, stoppedTick: failure?.tick ?? resultEvent?.tick ?? null, outcome: result.outcome,
    completedResult: !!resultEvent,
    diagnostic: resultEvent ? result.diagnostic : failure?.data.diagnostic ?? failure?.data.message ?? "No completed result recorded",
    objective: result.objective, readyWin,
    rawSourceUnchanged, sourceUnchanged: !!result.sourceUnchanged && rawSourceUnchanged, checkpointVerified,
    uniqueDeaths: deaths.length, uniqueShots: shots.length, reportedDeaths: result.deaths, reportedShots: result.shots,
    lastDeath: deaths.at(-1), lastVictim: actors.get(deaths.at(-1)?.targetId),
    purchases: result.purchases, commands: result.commandCount, currencyAudit,
    reserveAudit: { initialReserve, remainingReserve, allTeamEarnings, finiteReserveBalanced },
    selectors: events.filter(event => event.kind === "ai-selector"),
    aiOrderCount: events.filter(event => event.kind === "ai-order").length,
    statistics: Object.fromEntries(Object.entries(result.statistics ?? {}).filter(([, value]) => value !== 0)),
    progress: events.filter(event => event.kind === "progress").map(event => ({ tick: event.tick,
      elapsedMs: event.data.elapsedMs, objective: event.data.objective.value, earned: event.data.earned,
      purchases: event.data.purchases, deaths: event.data.deaths })) };
});
assert.equal(new Set(runs.map(run => run.source.faction)).size, runs.length, "Only one run per faction");
const passed = runs.length === 2 && runs.every(run => run.readyWin && run.sourceUnchanged &&
  run.checkpointVerified && run.currencyAudit.balanced && run.reserveAudit.finiteReserveBalanced && run.aiOrderCount > 0);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), milestone: passed ? "PASS" : "FAIL",
  fullGame: "FAIL", fullGameReason: "Completion of all 30 missions has not been demonstrated",
  limitations: ["Node actual-loader public API run; no browser, raster, audio or persistent browser save proof",
    "Disk hashes recorded per mission may differ from modules already loaded in the shared test process",
    "INCOMPLETE rows use the last recorded progress for accounting; observationTick is not a terminal outcome",
    "Unique combat events remove repeats emitted by the QA observer on a diagnostic-stalled tick"], runs }, null, 2));
process.exitCode = passed ? 0 : 1;