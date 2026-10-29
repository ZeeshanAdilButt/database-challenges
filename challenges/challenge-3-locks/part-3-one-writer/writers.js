// challenges/challenge-3-locks/part-3-one-writer/writers.js
// SQLite lets one connection write at a time. A transaction that starts with
// a plain BEGIN reads first and asks for the write lock later, and that is
// where "database is locked" comes from, even with a long busy timeout.
// BEGIN IMMEDIATE asks for the write lock first. We show the trap step by
// step, then count errors with four real writers.
//
//   node writers.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node writers.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, connect, duplicateSessions, freshDatabase, isMain, postgresIsUp, versions } from "../../../toolkit/db.js";
import { runUntilExit } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const WORKER = new URL("../lock-worker.js", import.meta.url);
const CLAIM = "UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = 1 AND status = 'pending'";

// Both watchers BEGIN and read. A writes and commits. Then B tries to write.
export async function deferredTrap(kind) {
  const setup = await freshDatabase(kind, "c3p3-trap");
  await addTasks(setup, 1);
  await setup.close();
  const a = await connect(kind, "c3p3-trap", { busyTimeout: 5000 });
  const b = await connect(kind, "c3p3-trap", { busyTimeout: 5000 });
  const steps = [];
  const step = (watcher, action, result) => steps.push({ watcher, action, result });

  await a.exec("BEGIN");
  step("A", "BEGIN", "ok");
  await b.exec("BEGIN");
  step("B", "BEGIN", "ok");
  step("A", "reads task 1", (await a.query("SELECT status FROM tasks WHERE id = 1"))[0].status);
  step("B", "reads task 1", (await b.query("SELECT status FROM tasks WHERE id = 1"))[0].status);
  step("A", "claims task 1", `${await a.run(CLAIM, ["A"])} row changed`);
  await a.exec("COMMIT");
  step("A", "COMMIT", "ok");
  const started = Date.now();
  let result;
  try {
    result = `${await b.run(CLAIM, ["B"])} rows changed, no error`;
  } catch (e) {
    result = `error ${e.errcode ?? e.code}: ${e.errstr ?? e.message}`;
  }
  step("B", "claims task 1", `${result} (after ${Date.now() - started} ms)`);
  await b.exec("ROLLBACK").catch(() => {});
  await Promise.all([a.close(), b.close()]);
  return steps;
}

// Four writer processes claim 100 tasks, each in its own transaction that
// reads, waits 2 ms, then writes. Count what failed.
export async function fourWriters(kind, begin, busyTimeout, { tasks = 100 } = {}) {
  const dbName = "c3p3-writers";
  const db = await freshDatabase(kind, dbName);
  await addTasks(db, tasks);
  const t0 = Date.now() + 400;
  const started = Date.now();
  const runs = await Promise.all(["A", "B", "C", "D"].map((name) =>
    runUntilExit(WORKER, { mode: "writes", kind, dbName, t0, begin, busyTimeout, thinkMs: 2, name })));
  const totalMs = Date.now() - started;
  const reports = runs.map((r) => r.steps[0]);
  const errors = {};
  for (const r of reports) for (const [k, n] of Object.entries(r.errors)) errors[k] = (errors[k] ?? 0) + n;
  const [{ sessions }] = await db.query("SELECT COUNT(*) AS sessions FROM sessions");
  const doubled = (await duplicateSessions(db)).length;
  await db.close();
  const failed = Object.values(errors).reduce((s, n) => s + n, 0);
  return { sessions, doubled, failed, errors, totalMs };
}

function drawChart() {
  const rows = readTable(RESULTS, "Four writers");
  barChart(path.join(here, "chart.svg"), {
    title: "Failed transactions while 4 writers claim 100 tasks",
    unit: "failed",
    groups: rows.map((r) => ({
      label: `${r.database}: ${r.begin}, timeout ${r["busy timeout (ms)"]}`,
      bars: [{ name: "failed transactions (rolled back, tried again)", value: r["failed transactions"], tone: r["failed transactions"] ? "bad" : "ok" }],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = ["sqlite"];
  if (await postgresIsUp()) kinds.push("postgres");
  else console.log("PostgreSQL is not running, so only SQLite runs. Start it with: npm run db:up");

  const traps = {};
  for (const kind of kinds) {
    traps[kind] = await deferredTrap(kind);
    console.log(`${kind}: B's claim after A committed: ${traps[kind].at(-1).result}`);
  }
  const plans = [
    ["sqlite", "BEGIN", 0], ["sqlite", "BEGIN", 5000],
    ["sqlite", "BEGIN IMMEDIATE", 0], ["sqlite", "BEGIN IMMEDIATE", 5000],
  ];
  if (kinds.includes("postgres")) plans.push(["postgres", "BEGIN", "none"]);
  const writers = [];
  for (const [kind, begin, timeout] of plans) {
    const run = await fourWriters(kind, begin, timeout === "none" ? 0 : timeout);
    writers.push({
      database: kind, begin, "busy timeout (ms)": timeout, sessions: run.sessions, "tasks with two sessions": run.doubled,
      "failed transactions": run.failed, "total (ms)": run.totalMs,
      errors: Object.entries(run.errors).map(([k, n]) => `${n} x ${k}`).join("; ") || "none",
    });
    console.log(`${kind}, ${begin}, timeout ${timeout}: ${run.failed} failed, ${run.sessions} sessions, ${run.totalMs} ms`);
  }

  writeResults(RESULTS, "Challenge 3, part 3: one writer at a time", await versions(kinds), [
    {
      heading: "The deferred trap, step by step",
      text: "Both connections have a 5,000 ms busy timeout. Watch how long B's claim takes to fail.",
      columns: ["step", "watcher", "action", ...kinds],
      rows: traps[kinds[0]].map((s, i) => ({
        step: i + 1, watcher: s.watcher, action: s.action,
        ...Object.fromEntries(kinds.map((k) => [k, traps[k][i].result])),
      })),
    },
    {
      heading: "Four writers",
      text: "Four processes claim 100 tasks. Each claim is one transaction: read the next pending task, wait 2 ms, update it, insert a session, commit. A failed transaction is rolled back and tried again.",
      columns: ["database", "begin", "busy timeout (ms)", "sessions", "tasks with two sessions", "failed transactions", "total (ms)", "errors"],
      rows: writers,
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
