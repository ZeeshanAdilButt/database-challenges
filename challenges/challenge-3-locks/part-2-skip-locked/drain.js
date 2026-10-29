// challenges/challenge-3-locks/part-2-skip-locked/drain.js
// Four workers drain a queue of 100 tasks. Each task takes 20 ms of work.
// We compare ways to claim: FOR UPDATE (wait for the locked row), FOR UPDATE
// SKIP LOCKED (take the next free row), SQLite's BEGIN IMMEDIATE (one
// writer at a time), and a short one-statement claim with the work done
// after the commit.
//
//   node drain.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node drain.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, duplicateSessions, freshDatabase, isMain, availableDatabases, versions } from "../../../toolkit/db.js";
import { runUntilExit } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const WORKER = new URL("../lock-worker.js", import.meta.url);
export const STRATEGIES = {
  postgres: ["for update", "skip locked", "short claim"],
  sqlite: ["begin immediate", "short claim"],
  mysql: ["for update", "skip locked", "short claim"],
};

export async function drainQueue(kind, strategy, { workers = 4, tasks = 100, workMs = 20 } = {}) {
  const dbName = "c3p2-queue";
  const db = await freshDatabase(kind, dbName);
  await addTasks(db, tasks);
  const t0 = Date.now() + 400;
  const runs = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      runUntilExit(WORKER, { mode: "drain", kind, dbName, t0, strategy, workMs, name: String.fromCharCode(65 + i) })),
  );
  const reports = runs.map((r) => r.steps[0]);
  const [{ sessions }] = await db.query("SELECT COUNT(*) AS sessions FROM sessions");
  const doubled = (await duplicateSessions(db)).length;
  await db.close();
  const total = Math.max(...reports.map((r) => r.done)) - Math.min(...reports.map((r) => r.start));
  const waited = reports.reduce((sum, r) => sum + r.waited, 0);
  return { tasks, sessions, doubled, total, waited, perWorker: reports.map((r) => r.claimed).join(" / ") };
}

function drawChart() {
  const rows = readTable(RESULTS, "Draining 100 tasks with 4 workers");
  const alone = Object.fromEntries(rows.filter((r) => r.workers === 1).map((r) => [r.database, r["total (ms)"]]));
  barChart(path.join(here, "chart.svg"), {
    title: "Time to drain 100 tasks (20 ms of work each) with 4 workers",
    unit: "ms",
    groups: rows.map((r) => ({
      label: `${r.database}: ${r.claim}`,
      bars: [
        { name: "total time (ms)", value: r["total (ms)"], tone: r.workers === 1 ? "plain" : r["total (ms)"] >= alone[r.database] ? "bad" : "ok" },
        { name: "time spent waiting for locks, all workers (ms)", value: r["waiting (ms)"], tone: "wait" },
      ],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = await availableDatabases();

  const rows = [];
  for (const kind of kinds) {
    // First the baseline: one worker, so nobody waits for anybody.
    const plans = [["short claim", 1], ...STRATEGIES[kind].map((s) => [s, 4])];
    for (const [strategy, workers] of plans) {
      const run = await drainQueue(kind, strategy, { workers });
      rows.push({
        database: kind, claim: workers === 1 ? "one worker alone" : strategy, workers, tasks: run.tasks, sessions: run.sessions, "tasks with two sessions": run.doubled,
        "total (ms)": run.total, "waiting (ms)": run.waited, "claimed per worker": run.perWorker,
      });
      console.log(`${kind}, ${strategy}, ${workers} worker(s): ${run.total} ms, ${run.waited} ms waiting, ${run.doubled} doubled, per worker ${run.perWorker}`);
    }
  }

  writeResults(RESULTS, "Challenge 3, part 2: skip locked", await versions(kinds), [
    {
      heading: "Draining 100 tasks with 4 workers",
      text: "Worker processes start together. Each task takes 20 ms of work (a timer, so on Windows it often takes closer to 30 ms). \"for update\", \"skip locked\" and \"begin immediate\" hold the lock during the work; \"short claim\" commits the claim first and works with no lock held. The first row of each database is one worker alone, the time to beat.",
      columns: ["database", "claim", "workers", "tasks", "sessions", "tasks with two sessions", "total (ms)", "waiting (ms)", "claimed per worker"],
      rows,
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
