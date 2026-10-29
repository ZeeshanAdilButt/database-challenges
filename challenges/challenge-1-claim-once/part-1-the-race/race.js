// challenges/challenge-1-claim-once/part-1-the-race/race.js
// Two watchers claim tasks by "read, then update". First we force the bad
// order step by step, so you can see it. Then we start two real watcher
// processes at once and count the tasks that got two sessions.
//
//   node race.js           run on SQLite and PostgreSQL, write results.md and the charts
//   node race.js --chart   redraw the charts from results.md only
import path from "node:path";
import { addTasks, connect, duplicateSessions, freshDatabase, isMain, postgresIsUp, versions } from "../../../toolkit/db.js";
import { runWorkers } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart, timelineChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const PENDING = "SELECT id, status FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 1";
const CLAIM = "UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = $2";
const SESSION = "INSERT INTO sessions (task_id, worker) VALUES ($1, $2)";

// One task, two watchers, two connections. We run their steps in the worst
// order on purpose: both read before either one writes.
export async function stepByStep(kind) {
  const setup = await freshDatabase(kind, "c1p1-steps");
  await addTasks(setup, 1);
  const a = await connect(kind, "c1p1-steps");
  const b = await connect(kind, "c1p1-steps");
  const steps = [];

  const [seenByA] = await a.query(PENDING);
  steps.push({ watcher: "A", action: `reads task ${seenByA.id}`, result: seenByA.status });
  const [seenByB] = await b.query(PENDING);
  steps.push({ watcher: "B", action: `reads task ${seenByB.id}`, result: seenByB.status });
  const changedByA = await a.run(CLAIM, ["A", seenByA.id]);
  steps.push({ watcher: "A", action: `claims task ${seenByA.id}`, result: `${changedByA} row changed` });
  await a.run(SESSION, [seenByA.id, "A"]);
  steps.push({ watcher: "A", action: `creates a session for task ${seenByA.id}`, result: "saved" });
  const changedByB = await b.run(CLAIM, ["B", seenByB.id]);
  steps.push({ watcher: "B", action: `claims task ${seenByB.id}`, result: `${changedByB} row changed` });
  await b.run(SESSION, [seenByB.id, "B"]);
  steps.push({ watcher: "B", action: `creates a session for task ${seenByB.id}`, result: "saved" });

  const [{ sessions }] = await setup.query("SELECT COUNT(*) AS sessions FROM sessions");
  await Promise.all([a.close(), b.close(), setup.close()]);
  return { steps, sessions };
}

// Two real watcher processes, started at the same moment, on `tasks` tasks.
export async function realRun(kind, { tasks = 200, pollMs = 50, batch = 10 } = {}) {
  const db = await freshDatabase(kind, "c1p1-real");
  await addTasks(db, tasks);
  const reports = await runWorkers(new URL("../watcher.js", import.meta.url), 2, {
    kind, dbName: "c1p1-real", claim: "read-then-update", pollMs, batch,
  });
  const [{ sessions }] = await db.query("SELECT COUNT(*) AS sessions FROM sessions");
  const doubled = (await duplicateSessions(db)).length;
  await db.close();
  return { tasks, sessions, doubled, reports };
}

function drawCharts() {
  const steps = readTable(RESULTS, "Step by step");
  timelineChart(path.join(here, "chart.svg"), {
    title: "Read, then update: both watchers claim task 1",
    lanes: ["Watcher A", "Watcher B"],
    steps: steps.map((s) => ({
      lane: `Watcher ${s.watcher}`,
      label: `${s.action}: ${s.sqlite}`,
      tone: s.watcher === "B" && s.step >= 2 ? "bad" : "plain",
    })),
  });
  const runs = readTable(RESULTS, "Real run");
  barChart(path.join(here, "chart-real-run.svg"), {
    title: "Two watchers, read then update",
    unit: "tasks",
    groups: runs.map((r) => ({
      label: r.database,
      bars: [
        { name: "tasks added", value: r.tasks, tone: "plain" },
        { name: "tasks with two sessions", value: r["tasks with two sessions"], tone: "bad" },
      ],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawCharts();
  const kinds = ["sqlite"];
  if (await postgresIsUp()) kinds.push("postgres");
  else console.log("PostgreSQL is not running, so only SQLite runs. Start it with: npm run db:up");

  const stepRuns = {};
  const realRuns = [];
  for (const kind of kinds) {
    stepRuns[kind] = await stepByStep(kind);
    console.log(`${kind}, step by step: 1 task, ${stepRuns[kind].sessions} sessions`);
    const run = await realRun(kind);
    realRuns.push({ database: kind, ...run });
    console.log(`${kind}, real run: ${run.tasks} tasks, ${run.sessions} sessions, ${run.doubled} tasks with two sessions`);
    for (const r of run.reports) console.log(`  watcher ${r.worker}: ${r.polls} polls, ${r.claimed} claimed, ${r.created} sessions`);
  }

  writeResults(RESULTS, "Challenge 1, part 1: the race", await versions(kinds), [
    {
      heading: "Step by step",
      text: "One task, two watchers, steps forced into the worst order. The result column shows what each database answered.",
      columns: ["step", "watcher", "action", ...kinds],
      rows: stepRuns[kinds[0]].steps.map((s, i) => ({
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
      text: "Two watcher processes started at the same moment. Each polls every 50 ms and reads up to 10 pending tasks per poll.",
      columns: ["database", "tasks", "sessions", "tasks with two sessions"],
      rows: realRuns.map((r) => ({
        database: r.database, tasks: r.tasks, sessions: r.sessions, "tasks with two sessions": r.doubled,
      })),
    },
  ]);
  drawCharts();
  console.log("Wrote results.md, chart.svg and chart-real-run.svg");
}

if (isMain(import.meta.url)) await main();
