// challenges/challenge-1-claim-once/part-3-safety-net/safety.js
// A unique index on sessions(task_id) makes the database itself refuse a
// second session for the same task, even when the code has the part 1 bug.
// We run the BROKEN watcher with the index, then the fixed one with it.
//
//   node safety.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node safety.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, connect, duplicateSessions, freshDatabase, isMain, postgresIsUp, versions } from "../../../toolkit/db.js";
import { runWorkers } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
// The safety net: at most one session row per task, checked by the database.
// YOUR TURN (chapter 1.7): write the CREATE UNIQUE INDEX statement named one_session_per_task.
export const ONE_SESSION_PER_TASK = "";
// END YOUR TURN

// Insert the same session twice and capture the database's own error.
export async function secondInsert(kind) {
  const db = await freshDatabase(kind, "c1p3-insert", ONE_SESSION_PER_TASK);
  await addTasks(db, 1);
  await db.run("INSERT INTO sessions (task_id, worker) VALUES (1, 'A')");
  let error = "none";
  try {
    await db.run("INSERT INTO sessions (task_id, worker) VALUES (1, 'B')");
  } catch (e) {
    error = e.code ? `${e.code}: ${e.message}` : e.message;
  }
  await db.close();
  return error;
}

// Two real watchers with the index in place. `claim` is "read-then-update"
// (the part 1 bug) or "condition" (the part 2 fix).
export async function realRun(kind, claim, { tasks = 200, pollMs = 50, batch = 10 } = {}) {
  const db = await freshDatabase(kind, "c1p3-real", ONE_SESSION_PER_TASK);
  await addTasks(db, tasks);
  const reports = await runWorkers(new URL("../watcher.js", import.meta.url), 2, {
    kind, dbName: "c1p3-real", claim, pollMs, batch,
  });
  const [{ sessions }] = await db.query("SELECT COUNT(*) AS sessions FROM sessions");
  const doubled = (await duplicateSessions(db)).length;
  // The task says one watcher owns it, but the session belongs to the other.
  const [{ mismatched }] = await db.query(
    `SELECT COUNT(*) AS mismatched FROM tasks t JOIN sessions s ON s.task_id = t.id
     WHERE t.claimed_by <> s.worker`,
  );
  await db.close();
  const refused = reports.reduce((sum, r) => sum + r.refused, 0);
  return { tasks, sessions, doubled, refused, mismatched };
}

function drawChart() {
  const runs = readTable(RESULTS, "Real run");
  barChart(path.join(here, "chart.svg"), {
    title: "With a unique index on sessions(task_id)",
    unit: "count",
    groups: runs.map((r) => ({
      label: `${r.database}, ${r.claim}`,
      bars: [
        { name: "tasks with two sessions", value: r["tasks with two sessions"], tone: "bad" },
        { name: "second sessions refused", value: r["refused by the index"], tone: "wait" },
        { name: "task owner does not match session", value: r["owner mismatch"], tone: "bad" },
      ],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = ["sqlite"];
  if (await postgresIsUp()) kinds.push("postgres");
  else console.log("PostgreSQL is not running, so only SQLite runs. Start it with: npm run db:up");

  const errors = [];
  const runs = [];
  for (const kind of kinds) {
    errors.push({ database: kind, "error on the second insert": await secondInsert(kind) });
    for (const claim of ["read-then-update", "condition"]) {
      const run = await realRun(kind, claim);
      runs.push({ database: kind, claim, ...run });
      console.log(`${kind}, ${claim}: ${run.sessions} sessions, ${run.doubled} doubled, ${run.refused} refused, ${run.mismatched} owner mismatches`);
    }
  }
  for (const e of errors) console.log(`${e.database}: ${e["error on the second insert"]}`);

  writeResults(RESULTS, "Challenge 1, part 3: the safety net", await versions(kinds), [
    {
      heading: "The database refuses a second session",
      text: `With \`${ONE_SESSION_PER_TASK}\`, a second INSERT for task 1 fails. This is each database's own error.`,
      columns: ["database", "error on the second insert"],
      rows: errors,
    },
    {
      heading: "Real run",
      text: "Two watcher processes, 200 tasks, the unique index in place. \"owner mismatch\" counts tasks whose claimed_by names one watcher while the saved session belongs to the other.",
      columns: ["database", "claim", "tasks", "sessions", "tasks with two sessions", "refused by the index", "owner mismatch"],
      rows: runs.map((r) => ({
        database: r.database, claim: r.claim, tasks: r.tasks, sessions: r.sessions,
        "tasks with two sessions": r.doubled, "refused by the index": r.refused, "owner mismatch": r.mismatched,
      })),
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
