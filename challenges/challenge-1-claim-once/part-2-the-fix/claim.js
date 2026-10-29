// challenges/challenge-1-claim-once/part-2-the-fix/claim.js
// The same race as part 1, with one change: the UPDATE checks that the task
// is still pending, and the watcher looks at how many rows changed.
// Then two real watchers run with the fix, and with a claim that finds and
// claims the next task in one statement.
//
//   node claim.js           run on SQLite and PostgreSQL, write results.md and the charts
//   node claim.js --chart   redraw the charts from results.md only
import path from "node:path";
import { addTasks, connect, duplicateSessions, freshDatabase, isMain, availableDatabases, versions } from "../../../toolkit/db.js";
import { runWorkers } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart, timelineChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const PENDING = "SELECT id, status FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 1";
// The only line that differs from part 1: "AND status = 'pending'".
// YOUR TURN (chapter 1.8): add the status check to this UPDATE.
const CLAIM = "UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = $2";
// END YOUR TURN
const SESSION = "INSERT INTO sessions (task_id, worker) VALUES ($1, $2)";

// Same worst order as part 1: both watchers read before either writes.
export async function stepByStep(kind) {
  const setup = await freshDatabase(kind, "c1p2-steps");
  await addTasks(setup, 1);
  const a = await connect(kind, "c1p2-steps");
  const b = await connect(kind, "c1p2-steps");
  const steps = [];

  const [seenByA] = await a.query(PENDING);
  steps.push({ watcher: "A", action: `reads task ${seenByA.id}`, result: seenByA.status });
  const [seenByB] = await b.query(PENDING);
  steps.push({ watcher: "B", action: `reads task ${seenByB.id}`, result: seenByB.status });
  const changedByA = await a.run(CLAIM, ["A", seenByA.id]);
  steps.push({ watcher: "A", action: `claims task ${seenByA.id}`, result: `${changedByA} row changed` });
  if (changedByA === 1) {
    await a.run(SESSION, [seenByA.id, "A"]);
    steps.push({ watcher: "A", action: `creates a session for task ${seenByA.id}`, result: "saved" });
  }
  const changedByB = await b.run(CLAIM, ["B", seenByB.id]);
  steps.push({ watcher: "B", action: `claims task ${seenByB.id}`, result: `${changedByB} rows changed` });
  if (changedByB === 1) {
    await b.run(SESSION, [seenByB.id, "B"]);
    steps.push({ watcher: "B", action: `creates a session for task ${seenByB.id}`, result: "saved" });
  } else {
    steps.push({ watcher: "B", action: "skips the task", result: "someone else has it" });
  }

  const [{ sessions }] = await setup.query("SELECT COUNT(*) AS sessions FROM sessions");
  await Promise.all([a.close(), b.close(), setup.close()]);
  return { steps, sessions };
}

// Two real watcher processes with a fixed claim. `claim` is "condition"
// (read, then a checked UPDATE) or "one-statement" (no separate read).
export async function realRun(kind, claim, { tasks = 200, pollMs = 50, batch = 10 } = {}) {
  const db = await freshDatabase(kind, "c1p2-real");
  await addTasks(db, tasks);
  const reports = await runWorkers(new URL("../watcher.js", import.meta.url), 2, {
    kind, dbName: "c1p2-real", claim, pollMs, batch,
  });
  const [{ sessions }] = await db.query("SELECT COUNT(*) AS sessions FROM sessions");
  const [{ pending_left: left }] = await db.query("SELECT COUNT(*) AS pending_left FROM tasks WHERE status = 'pending'");
  const doubled = (await duplicateSessions(db)).length;
  await db.close();
  const lost = reports.reduce((sum, r) => sum + r.lost, 0);
  return { tasks, sessions, doubled, lost, left, reports };
}

function drawCharts() {
  const steps = readTable(RESULTS, "Step by step");
  timelineChart(path.join(here, "chart.svg"), {
    title: "Checked update: watcher B changes 0 rows and skips",
    lanes: ["Watcher A", "Watcher B"],
    steps: steps.map((s) => ({
      lane: `Watcher ${s.watcher}`,
      label: `${s.action}: ${s.sqlite}`,
      tone: s.watcher === "B" && s.step >= 4 ? "ok" : "plain",
    })),
  });
  const runs = readTable(RESULTS, "Real run");
  barChart(path.join(here, "chart-real-run.svg"), {
    title: "Two watchers, 200 tasks, with the fix",
    unit: "tasks",
    groups: runs.map((r) => ({
      label: `${r.database}, ${r.claim}`,
      bars: [
        { name: "sessions", value: r.sessions, tone: "plain" },
        { name: "tasks with two sessions", value: r["tasks with two sessions"], tone: "bad" },
        { name: "races caught (0 rows changed)", value: r["races caught"], tone: "ok" },
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
    console.log(`${kind}, step by step: 1 task, ${stepRuns[kind].sessions} session`);
    for (const claim of ["condition", "one-statement"]) {
      const run = await realRun(kind, claim);
      realRuns.push({ database: kind, claim, ...run });
      console.log(`${kind}, ${claim}: ${run.sessions} sessions for ${run.tasks} tasks, ${run.doubled} doubled, ${run.lost} races caught, ${run.left} left pending`);
    }
  }

  const steps = stepRuns[kinds[0]].steps;
  writeResults(RESULTS, "Challenge 1, part 2: the fix", await versions(kinds), [
    {
      heading: "Step by step",
      text: "One task, two watchers, the same worst order as part 1. The claim now checks the status, and the watcher looks at the rows changed.",
      columns: ["step", "watcher", "action", ...kinds],
      rows: steps.map((s, i) => ({
        step: i + 1, watcher: s.watcher, action: s.action,
        ...Object.fromEntries(kinds.map((k) => [k, stepRuns[k].steps[i].result])),
      })),
    },
    {
      heading: "Sessions after the steps",
      columns: ["database", "tasks", "sessions"],
      rows: kinds.map((k) => ({ database: k, tasks: 1, sessions: stepRuns[k].sessions })),
    },
    {
      heading: "Real run",
      text: "Two watcher processes started at the same moment, 200 tasks, a poll every 50 ms. \"races caught\" counts claims that changed 0 rows because the other watcher got there first.",
      columns: ["database", "claim", "tasks", "sessions", "tasks with two sessions", "races caught", "left pending"],
      rows: realRuns.map((r) => ({
        database: r.database, claim: r.claim, tasks: r.tasks, sessions: r.sessions,
        "tasks with two sessions": r.doubled, "races caught": r.lost, "left pending": r.left,
      })),
    },
  ]);
  drawCharts();
  console.log("Wrote results.md, chart.svg and chart-real-run.svg");
}

if (isMain(import.meta.url)) await main();
