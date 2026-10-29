// challenges/challenge-2-all-or-nothing/part-3-valid-moves/moves.js
// A task may only move along allowed paths: pending -> claimed -> running
// -> done or failed. Two guards keep it that way: the database's CHECK
// (only known statuses) and a checked UPDATE (only from the status we
// expect). Then the watcher dies while a task runs, and on restart it
// marks that task "failed" instead of leaving it "running" forever.
//
//   node moves.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node moves.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, freshDatabase, isMain, availableDatabases, taskState, versions } from "../../../toolkit/db.js";
import { runUntilExit } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const WATCHER = new URL("../watcher.js", import.meta.url);

// Every allowed move. Anything not listed is refused before it reaches SQL.
export const ALLOWED = {
  pending: ["claimed"],
  claimed: ["running", "pending"],
  running: ["done", "failed"],
  failed: ["pending"],
  done: [],
};

// Move a task from `from` to `to`. The WHERE makes the database check that
// the task really is at `from` right now. Returns what happened.
export async function move(db, taskId, from, to) {
  if (!ALLOWED[from]?.includes(to)) return `refused by the code: ${from} to ${to} is not allowed`;
  const changed = await db.run("UPDATE tasks SET status = $1 WHERE id = $2 AND status = $3", [to, taskId, from]);
  return changed === 1 ? "moved" : `0 rows changed: the task was not ${from}`;
}

// Try good moves, a late (stale) move, a forbidden move, and a typo.
export async function tryMoves(kind) {
  const db = await freshDatabase(kind, "c2-moves");
  await addTasks(db, 1);
  const tries = [
    ["pending", "claimed"],
    ["claimed", "running"],
    ["running", "done"],
    ["claimed", "running"], // a late message from before: the task is done now
    ["done", "pending"], // not an allowed move at all
  ];
  const rows = [];
  for (const [from, to] of tries) {
    const result = await move(db, 1, from, to);
    rows.push({ move: `${from} to ${to}`, result, "status now": (await taskState(db, 1)).status });
  }
  // A typo that skips move(): the CHECK in the table refuses it.
  let typo;
  try {
    await db.run("UPDATE tasks SET status = 'compelted' WHERE id = 1");
    typo = "saved";
  } catch (e) {
    typo = `refused by the CHECK: ${e.message}`;
  }
  rows.push({ move: "done to compelted (typo)", result: typo, "status now": (await taskState(db, 1)).status });
  await db.close();
  return rows;
}

// The watcher starts task 1, it runs, and the process dies. Then the
// watcher restarts, once without recovery and once with it.
export async function dieWhileRunning(kind, { recover }) {
  const dbName = `c2-running-${recover ? "recover" : "plain"}`;
  const db = await freshDatabase(kind, dbName);
  await addTasks(db, 1);
  const first = await runUntilExit(WATCHER, {
    kind, dbName, transaction: true, startRunning: true, crashWhileRunning: true,
  });
  const afterCrash = await taskState(db, 1);
  const second = await runUntilExit(WATCHER, { kind, dbName, transaction: true, recover });
  const afterRestart = await taskState(db, 1);
  await db.close();
  return { firstSteps: first.steps, secondSteps: second.steps, afterCrash, afterRestart };
}

function drawChart() {
  const rows = readTable(RESULTS, "Dying while a task runs");
  barChart(path.join(here, "chart.svg"), {
    title: "After a restart: is anything still stuck as running?",
    unit: "tasks",
    groups: rows.map((r) => ({
      label: `${r.database}, ${r["restart with recovery"] === "yes" ? "with" : "no"} recovery`,
      bars: [
        { name: "stuck as running", value: r["status after restart"] === "running" ? 1 : 0, tone: "bad" },
        { name: "marked failed, can be retried", value: r["status after restart"] === "failed" ? 1 : 0, tone: "ok" },
      ],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = await availableDatabases();

  const moves = [];
  const deaths = [];
  for (const kind of kinds) {
    for (const row of await tryMoves(kind)) {
      moves.push({ database: kind, ...row });
      console.log(`${kind}: ${row.move}: ${row.result}`);
    }
    for (const recover of [false, true]) {
      const run = await dieWhileRunning(kind, { recover });
      deaths.push({ database: kind, recover, ...run });
      console.log(`${kind}, restart ${recover ? "with" : "without"} recovery: ${run.secondSteps.join(" > ")}; task 1 is ${run.afterRestart.status}`);
    }
  }

  writeResults(RESULTS, "Challenge 2, part 3: only valid moves", await versions(kinds), [
    {
      heading: "Moves on one task",
      text: "Each row tries one move on task 1, in order. The last row skips move() and writes a typo straight to the table.",
      columns: ["database", "move", "result", "status now"],
      rows: moves,
    },
    {
      heading: "Dying while a task runs",
      text: "The watcher commits the start of task 1, moves it to running, and is killed. Then it restarts.",
      columns: ["database", "restart with recovery", "status after crash", "status after restart", "sessions", "events", "restart steps"],
      rows: deaths.map((d) => ({
        database: d.database, "restart with recovery": d.recover ? "yes" : "no",
        "status after crash": d.afterCrash.status, "status after restart": d.afterRestart.status,
        sessions: d.afterRestart.sessions, events: d.afterRestart.events, "restart steps": d.secondSteps.join(", "),
      })),
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
