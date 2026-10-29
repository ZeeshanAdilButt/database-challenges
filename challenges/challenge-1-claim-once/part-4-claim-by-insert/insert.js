// challenges/challenge-1-claim-once/part-4-claim-by-insert/insert.js
// Another way to claim: do not UPDATE the task at all. INSERT its session,
// and let a unique index on sessions(task_id) decide. The first INSERT for
// a task wins; every later one is ignored and changes 0 rows. This is how
// a real watcher can claim a task exactly once.
// Each database spells "insert, or do nothing if it already exists" its own way.
//
//   node insert.js           run on every database that is up, write results.md and the chart
//   node insert.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, availableDatabases, connect, duplicateSessions, freshDatabase, isMain, versions } from "../../../toolkit/db.js";
import { runWorkers } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart, timelineChart } from "../../../toolkit/chart.js";
import { ONE_SESSION_PER_TASK } from "../part-3-safety-net/safety.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");

// "Insert, or do nothing if this task already has a session", per database.
export const INSERT_OR_NOTHING = {
  // YOUR TURN (chapter 1.8): make each INSERT do nothing, instead of failing, when the task already has a session.
    sqlite: "INSERT INTO sessions (task_id, worker) VALUES ($1, $2)",
    postgres: "INSERT INTO sessions (task_id, worker) VALUES ($1, $2)",
    mysql: "INSERT INTO sessions (task_id, worker) VALUES ($1, $2)",
  // END YOUR TURN
};

// The same worst order as part 1: both watchers read task 1 as pending,
// then both try to claim it, this time by inserting its session.
export async function stepByStep(kind) {
  const name = "c1p4-steps";
  const setup = await freshDatabase(kind, name, ONE_SESSION_PER_TASK);
  await addTasks(setup, 1);
  const a = await connect(kind, name);
  const b = await connect(kind, name);
  const steps = [];
  const pending = "SELECT id, status FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 1";
  const [seenByA] = await a.query(pending);
  steps.push({ watcher: "A", action: `reads task ${seenByA.id}`, result: seenByA.status });
  const [seenByB] = await b.query(pending);
  steps.push({ watcher: "B", action: `reads task ${seenByB.id}`, result: seenByB.status });
  const byA = await a.run(INSERT_OR_NOTHING[kind], [seenByA.id, "A"]);
  steps.push({ watcher: "A", action: "inserts the session for task 1", result: `${byA} row changed` });
  const byB = await b.run(INSERT_OR_NOTHING[kind], [seenByB.id, "B"]);
  steps.push({ watcher: "B", action: "inserts the session for task 1", result: `${byB} rows changed` });
  const [{ sessions }] = await setup.query("SELECT COUNT(*) AS sessions FROM sessions");
  await Promise.all([a.close(), b.close(), setup.close()]);
  return { steps, sessions };
}

// Two real watcher processes that claim by insert.
export async function realRun(kind, { tasks = 200, pollMs = 50, batch = 10 } = {}) {
  const db = await freshDatabase(kind, "c1p4-real", ONE_SESSION_PER_TASK);
  await addTasks(db, tasks);
  const reports = await runWorkers(new URL("../watcher.js", import.meta.url), 2, {
    kind, dbName: "c1p4-real", claim: "insert", pollMs, batch,
  });
  const [{ sessions }] = await db.query("SELECT COUNT(*) AS sessions FROM sessions");
  const doubled = (await duplicateSessions(db)).length;
  const [{ mismatched }] = await db.query(
    `SELECT COUNT(*) AS mismatched FROM tasks t JOIN sessions s ON s.task_id = t.id
     WHERE t.claimed_by <> s.worker`,
  );
  await db.close();
  const lost = reports.reduce((sum, r) => sum + r.lost, 0);
  return { tasks, sessions, doubled, lost, mismatched };
}

function drawCharts() {
  const steps = readTable(RESULTS, "Step by step");
  timelineChart(path.join(here, "chart.svg"), {
    title: "Claim by insert: B's insert changes 0 rows",
    lanes: ["Watcher A", "Watcher B"],
    steps: steps.map((s) => ({
      lane: `Watcher ${s.watcher}`,
      label: `${s.action}: ${s.sqlite}`,
      tone: s.watcher === "B" && s.step === 4 ? "ok" : "plain",
    })),
  });
  const runs = readTable(RESULTS, "Real run");
  barChart(path.join(here, "chart-real-run.svg"), {
    title: "Two watchers, 200 tasks, claiming by insert",
    unit: "count",
    groups: runs.map((r) => ({
      label: r.database,
      bars: [
        { name: "sessions", value: r.sessions, tone: "plain" },
        { name: "tasks with two sessions", value: r["tasks with two sessions"], tone: "bad" },
        { name: "inserts ignored (0 rows changed)", value: r["inserts ignored"], tone: "ok" },
      ],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawCharts();
  const kinds = await availableDatabases();
  const stepRuns = {};
  const realRuns = [];
  for (const kind of kinds) {
    stepRuns[kind] = await stepByStep(kind);
    const run = await realRun(kind);
    realRuns.push({ database: kind, ...run });
    console.log(`${kind}: step by step ${stepRuns[kind].sessions} session; real run ${run.sessions} sessions for ${run.tasks} tasks, ${run.doubled} doubled, ${run.lost} inserts ignored, ${run.mismatched} owner mismatches`);
  }
  writeResults(RESULTS, "Challenge 1, part 4: claim by insert", await versions(kinds), [
    {
      heading: "The statement on each database",
      text: "All three mean the same: insert the session, or do nothing if this task already has one. The unique index on sessions(task_id) decides.",
      columns: ["database", "statement"],
      rows: kinds.map((k) => ({ database: k, statement: `\`${INSERT_OR_NOTHING[k]}\`` })),
    },
    {
      heading: "Step by step",
      text: "One task, two watchers, the worst order: both read before either one writes.",
      columns: ["step", "watcher", "action", ...kinds],
      rows: stepRuns[kinds[0]].steps.map((s, i) => ({
        step: i + 1, watcher: s.watcher, action: s.action,
        ...Object.fromEntries(kinds.map((k) => [k, stepRuns[k].steps[i].result])),
      })),
    },
    {
      heading: "Real run",
      text: "Two watcher processes, 200 tasks, a poll every 50 ms. Each claims by inserting the session, then marks the task claimed only if its insert changed 1 row.",
      columns: ["database", "tasks", "sessions", "tasks with two sessions", "inserts ignored", "owner mismatch"],
      rows: realRuns.map((r) => ({
        database: r.database, tasks: r.tasks, sessions: r.sessions, "tasks with two sessions": r.doubled,
        "inserts ignored": r.lost, "owner mismatch": r.mismatched,
      })),
    },
  ]);
  drawCharts();
  console.log("Wrote results.md, chart.svg and chart-real-run.svg");
}

if (isMain(import.meta.url)) await main();
