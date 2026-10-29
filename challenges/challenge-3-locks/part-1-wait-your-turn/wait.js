// challenges/challenge-3-locks/part-1-wait-your-turn/wait.js
// Watcher A locks a task and works on it for 300 ms. Watcher B asks for a
// lock 50 ms later. We measure how long B waits and what it sees, when B
// wants the SAME task and when it wants a DIFFERENT one.
//
//   node wait.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node wait.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, freshDatabase, isMain, postgresIsUp, taskState, versions } from "../../../toolkit/db.js";
import { runUntilExit } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { waitChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const WORKER = new URL("../lock-worker.js", import.meta.url);
const HOLD_MS = 300;

// What SQLite says when it meets PostgreSQL's row lock syntax.
export async function sqliteHasNoForUpdate() {
  const db = await freshDatabase("sqlite", "c3p1-syntax");
  try {
    await db.query("SELECT id FROM tasks WHERE id = 1 FOR UPDATE");
    return "accepted";
  } catch (e) {
    return e.message;
  } finally {
    await db.close();
  }
}

// Start A and B as two processes. B asks for its lock 50 ms after A.
export async function race(kind, bTask) {
  const dbName = `c3p1-${bTask}`;
  const db = await freshDatabase(kind, dbName);
  await addTasks(db, 2);
  const t0 = Date.now() + 400; // time for both processes to connect first
  const common = { mode: "hold", kind, dbName, t0, holdMs: HOLD_MS };
  const [a, b] = await Promise.all([
    runUntilExit(WORKER, { ...common, name: "A", taskId: 1, startAt: 0 }),
    runUntilExit(WORKER, { ...common, name: "B", taskId: bTask, startAt: 50 }),
  ]);
  const sessions = (await taskState(db, 1)).sessions + (await taskState(db, 2)).sessions;
  await db.close();
  const [ra, rb] = [a.steps[0], b.steps[0]];
  return { a: ra, b: rb, bWaited: rb.got - rb.asked, sessions };
}

function drawChart() {
  const rows = readTable(RESULTS, "Who waited");
  const lanes = [];
  const bars = [];
  for (const r of rows) {
    const lane = `${r.database} ${r.scenario === "same task" ? "same" : "other"}: ${r.watcher}`;
    lanes.push(lane);
    if (r["got lock (ms)"] - r["asked (ms)"] > 5) {
      bars.push({ lane, from: r["asked (ms)"], to: r["got lock (ms)"], label: "waits", tone: "wait" });
    }
    bars.push({ lane, from: r["got lock (ms)"], to: Math.max(r["done (ms)"], r["got lock (ms)"] + 3), label: r.action, tone: r.action === "claimed it" ? "ok" : "plain" });
  }
  waitChart(path.join(here, "chart.svg"), {
    title: "A holds a lock for 300 ms. Does B wait?",
    lanes,
    bars,
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = ["sqlite"];
  if (await postgresIsUp()) kinds.push("postgres");
  else console.log("PostgreSQL is not running, so only SQLite runs. Start it with: npm run db:up");

  const syntax = await sqliteHasNoForUpdate();
  console.log(`SQLite and FOR UPDATE: ${syntax}`);
  const rows = [];
  for (const kind of kinds) {
    for (const [scenario, bTask] of [["same task", 1], ["different task", 2]]) {
      const run = await race(kind, bTask);
      console.log(`${kind}, ${scenario}: B waited ${run.bWaited} ms, saw "${run.b.saw}", ${run.b.action}; ${run.sessions} session(s)`);
      for (const w of [run.a, run.b]) {
        rows.push({
          database: kind, scenario, watcher: w.name, task: w.task, "asked (ms)": w.asked, "got lock (ms)": w.got,
          "done (ms)": w.done, saw: w.saw, action: w.action,
        });
      }
    }
  }

  writeResults(RESULTS, "Challenge 3, part 1: wait your turn", await versions(kinds), [
    {
      heading: "SQLite has no FOR UPDATE",
      text: "The same SELECT ... FOR UPDATE that PostgreSQL accepts, sent to SQLite:",
      columns: ["database", "answer"],
      rows: [{ database: "sqlite", answer: syntax }],
    },
    {
      heading: "Who waited",
      text: `A locks task 1 at 0 ms and keeps the lock for ${HOLD_MS} ms. B asks for a lock at 50 ms. PostgreSQL uses SELECT ... FOR UPDATE on one row; SQLite uses BEGIN IMMEDIATE, its only way to lock before reading. Times are ms after the start.`,
      columns: ["database", "scenario", "watcher", "task", "asked (ms)", "got lock (ms)", "done (ms)", "saw", "action"],
      rows,
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
