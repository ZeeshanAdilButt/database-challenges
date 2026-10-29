// challenges/challenge-2-all-or-nothing/part-2-transaction/transaction.js
// The same crashes as part 1, with one change: the three writes sit inside
// BEGIN ... COMMIT. Then an error halfway, with and without a transaction.
//
//   node transaction.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node transaction.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, freshDatabase, isMain, postgresIsUp, taskState, versions } from "../../../toolkit/db.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";
import { crashThenRestart, verdict } from "../part-1-crash-halfway/crash.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");

// Start task 1, but the third write fails (an event with no kind breaks the
// NOT NULL rule). With a transaction we catch the error and ROLLBACK.
export async function errorHalfway(kind, { transaction }) {
  const db = await freshDatabase(kind, `c2-error-${transaction ? "tx" : "plain"}`);
  await addTasks(db, 1);
  let error = "none";
  // YOUR TURN (chapter 2.7): when `transaction` is true, add BEGIN before the writes, COMMIT after them, and ROLLBACK in the catch.
  try {
    await db.run("UPDATE tasks SET status = 'claimed', claimed_by = 'A' WHERE id = 1 AND status = 'pending'");
    await db.run("INSERT INTO sessions (task_id, worker) VALUES (1, 'A')");
    await db.run("INSERT INTO events (task_id, kind) VALUES (1, NULL)");
  } catch (e) {
    error = e.message;
  }
  // END YOUR TURN
  const state = await taskState(db, 1);
  await db.close();
  return { error, state };
}

function drawChart() {
  const rows = readTable(RESULTS, "After the restart");
  barChart(path.join(here, "chart.svg"), {
    title: "With a transaction: a crash leaves nothing half-done",
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
  const errors = [];
  for (const kind of kinds) {
    for (const crashAfter of ["claim", "session"]) {
      const run = await crashThenRestart(kind, crashAfter, { transaction: true });
      runs.push({ database: kind, crashAfter, ...run });
      console.log(`${kind}, crash after ${crashAfter}: ${run.firstSteps.join(" > ")}`);
      console.log(`  right after the crash: task 1 is ${run.afterCrash.status}, ${run.afterCrash.sessions} session(s)`);
      console.log(`  restart: ${run.secondSteps.join(" > ")}`);
      console.log(`  task 1 is ${run.afterRestart.status}, ${run.afterRestart.sessions} session(s), ${run.afterRestart.events} event(s): ${verdict(run.afterRestart)}`);
    }
    for (const transaction of [false, true]) {
      const { error, state } = await errorHalfway(kind, { transaction });
      errors.push({ database: kind, transaction: transaction ? "yes" : "no", error, ...state, verdict: verdict(state) });
    }
  }

  const row = (r, state) => ({
    database: r.database, "crash after": r.crashAfter, status: state.status, "claimed by": state.claimedBy,
    sessions: state.sessions, events: state.events, verdict: verdict(state),
  });
  const columns = ["database", "crash after", "status", "claimed by", "sessions", "events", "verdict"];
  writeResults(RESULTS, "Challenge 2, part 2: a transaction", await versions(kinds), [
    {
      heading: "What the watcher did before it died",
      columns: ["database", "crash after", "steps"],
      rows: runs.map((r) => ({ database: r.database, "crash after": r.crashAfter, steps: r.firstSteps.join(", ") })),
    },
    {
      heading: "Right after the crash",
      text: "The writes before the crash were never committed, so the database threw them away.",
      columns,
      rows: runs.map((r) => row(r, r.afterCrash)),
    },
    {
      heading: "After the restart",
      text: "Task 1 was still pending, so the restarted watcher found it and started it, once.",
      columns,
      rows: runs.map((r) => row(r, r.afterRestart)),
    },
    {
      heading: "An error halfway",
      text: "The third write fails. Without a transaction the first two stay saved. With one, ROLLBACK removes them.",
      columns: ["database", "transaction", "error", "status", "sessions", "events", "verdict"],
      rows: errors,
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
