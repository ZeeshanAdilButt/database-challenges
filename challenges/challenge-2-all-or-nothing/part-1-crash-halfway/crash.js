// challenges/challenge-2-all-or-nothing/part-1-crash-halfway/crash.js
// Starting a task takes three writes. With no transaction, each write is
// saved the moment it runs. We kill the watcher after the first write,
// then after the second, restart it, and look at what is left.
//
//   node crash.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node crash.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, freshDatabase, isMain, postgresIsUp, taskState, versions } from "../../../toolkit/db.js";
import { runUntilExit } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const WATCHER = new URL("../watcher.js", import.meta.url);

// One task. Kill the watcher after `crashAfter`, then start it again.
export async function crashThenRestart(kind, crashAfter, { transaction = false } = {}) {
  const dbName = `c2-crash-${transaction ? "tx" : "plain"}`;
  const db = await freshDatabase(kind, dbName);
  await addTasks(db, 1);
  const first = await runUntilExit(WATCHER, { kind, dbName, transaction, crashAfter });
  const afterCrash = await taskState(db, 1);
  const second = await runUntilExit(WATCHER, { kind, dbName, transaction });
  const afterRestart = await taskState(db, 1);
  await db.close();
  return { crashed: first.crashed, firstSteps: first.steps, secondSteps: second.steps, afterCrash, afterRestart };
}

// A task is healthy if it is still pending, or claimed with exactly one
// session and one event. Anything else is a half-written start.
export function verdict({ status, sessions, events }) {
  if (status === "pending" && sessions === 0 && events === 0) return "clean: still pending";
  if (status === "claimed" && sessions === 1 && events === 1) return "clean: started once";
  if (status === "claimed" && sessions === 0) return "stuck: claimed, no session";
  if (sessions === 1 && events === 0) return "half: session, no event";
  return "broken";
}

function drawChart() {
  const rows = readTable(RESULTS, "After the restart");
  barChart(path.join(here, "chart.svg"), {
    title: "No transaction: what a crash leaves behind",
    unit: "rows for task 1",
    groups: rows.map((r) => ({
      label: `${r.database}, crash after ${r["crash after"]}`,
      bars: [
        { name: "sessions", value: r.sessions, tone: r.sessions === 1 ? "ok" : "bad" },
        { name: "events", value: r.events, tone: r.events === 1 ? "ok" : "bad" },
      ],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = ["sqlite"];
  if (await postgresIsUp()) kinds.push("postgres");
  else console.log("PostgreSQL is not running, so only SQLite runs. Start it with: npm run db:up");

  const runs = [];
  for (const kind of kinds) {
    for (const crashAfter of ["claim", "session"]) {
      const run = await crashThenRestart(kind, crashAfter);
      runs.push({ database: kind, crashAfter, ...run });
      console.log(`${kind}, crash after ${crashAfter}: ${run.firstSteps.join(" > ")}`);
      console.log(`  restart: ${run.secondSteps.join(" > ")}`);
      console.log(`  task 1 is ${run.afterRestart.status}, ${run.afterRestart.sessions} session(s), ${run.afterRestart.events} event(s): ${verdict(run.afterRestart)}`);
    }
  }

  const row = (r, state) => ({
    database: r.database, "crash after": r.crashAfter, status: state.status, "claimed by": state.claimedBy,
    sessions: state.sessions, events: state.events, verdict: verdict(state),
  });
  const columns = ["database", "crash after", "status", "claimed by", "sessions", "events", "verdict"];
  writeResults(RESULTS, "Challenge 2, part 1: a crash halfway", await versions(kinds), [
    {
      heading: "What the watcher did before it died",
      columns: ["database", "crash after", "steps"],
      rows: runs.map((r) => ({ database: r.database, "crash after": r.crashAfter, steps: r.firstSteps.join(", ") })),
    },
    { heading: "Right after the crash", columns, rows: runs.map((r) => row(r, r.afterCrash)) },
    {
      heading: "After the restart",
      text: "The restarted watcher looks for pending tasks. Task 1 is no longer pending, so nobody will ever start it again.",
      columns,
      rows: runs.map((r) => row(r, r.afterRestart)),
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
