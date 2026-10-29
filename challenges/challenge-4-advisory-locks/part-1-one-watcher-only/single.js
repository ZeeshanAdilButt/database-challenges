// challenges/challenge-4-advisory-locks/part-1-one-watcher-only/single.js
// Only one watcher may run at a time. Each watcher takes a named lock when
// it starts. We start A, then B while A runs, then kill A the hard way and
// start C. Does C get the lock?
//
//   node single.js           run on every database that is up, write results.md and the chart
//   node single.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, availableDatabases, freshDatabase, isMain, taskState, versions } from "../../../toolkit/db.js";
import { runUntilExit, startProcess } from "../../../toolkit/workers.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";
import { SQLITE_LOCKS, holder } from "../lock.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const HOLDER = new URL("../lock-holder.js", import.meta.url);

// Why the lock is needed: two copies of the SAME named watcher, no lock.
// Copy 1 starts task 1 and keeps working on it. Copy 2 starts, and its
// recovery step (challenge 2 part 3) marks "its own" running task failed.
const WATCHER_C2 = new URL("../../challenge-2-all-or-nothing/watcher.js", import.meta.url);
export async function twoCopiesNoLock(kind) {
  const dbName = "c4p1-nolock";
  const db = await freshDatabase(kind, dbName);
  await addTasks(db, 1);
  const copy1 = startProcess(WATCHER_C2, { kind, dbName, name: "A", transaction: true, startRunning: true, holdWhileRunning: true });
  await copy1.waitFor(/still working/);
  const before = (await taskState(db, 1)).status;
  const copy2 = await runUntilExit(WATCHER_C2, { kind, dbName, name: "A", transaction: true, recover: true });
  const after = (await taskState(db, 1)).status;
  await copy1.kill();
  await db.close();
  return { before, copy2Said: copy2.steps[0], after };
}

export async function oneWatcherOnly(kind) {
  const dbName = "c4p1-single";
  const db = await freshDatabase(kind, dbName, kind === "sqlite" ? SQLITE_LOCKS : "");
  if (kind === "sqlite") await db.run("DELETE FROM locks");
  const start = (name) => startProcess(HOLDER, { kind, dbName, name });

  const a = start("A");
  const aSaid = await a.firstStep();
  const b = start("B");
  const bSaid = await b.firstStep();
  await b.exited;
  const heldBeforeKill = await holder(db);
  await a.kill();
  // Give the server a moment to notice the closed connection.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const heldAfterKill = await holder(db);
  const c = start("C");
  const cSaid = await c.firstStep();
  if (cSaid.includes("got the lock")) await c.kill();
  else await c.exited;
  await db.close();
  return { aSaid, bSaid, heldBeforeKill, heldAfterKill, cSaid, cGotIt: cSaid.includes("got the lock") };
}

function drawChart() {
  const rows = readTable(RESULTS, "After A is killed");
  barChart(path.join(here, "chart.svg"), {
    title: "Can a new watcher start after the first one is killed?",
    unit: "1 = yes",
    groups: rows.map((r) => ({
      label: r.database,
      bars: [{ name: "C got the lock", value: r["C got the lock"] === "yes" ? 1 : 0, tone: r["C got the lock"] === "yes" ? "ok" : "bad" }],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = await availableDatabases();
  const runs = [];
  const noLock = [];
  for (const kind of kinds) {
    const without = await twoCopiesNoLock(kind);
    noLock.push({ database: kind, "task 1 while copy 1 works": without.before, "copy 2 on start": without.copy2Said, "task 1 after copy 2 started": without.after });
    console.log(`${kind}, no lock: copy 2 ${without.copy2Said}; task 1 went from ${without.before} to ${without.after} while copy 1 was still working`);
    const run = await oneWatcherOnly(kind);
    runs.push({ database: kind, ...run });
    console.log(`${kind}: ${run.aSaid}; ${run.bSaid}; after killing A: ${run.heldAfterKill}; ${run.cSaid}`);
  }
  writeResults(RESULTS, "Challenge 4, part 1: one watcher only", await versions(kinds), [
    {
      heading: "Without a lock: two copies of watcher A",
      text: "Copy 1 starts task 1 and keeps working on it. Copy 2, with the same name, starts and runs its recovery step from challenge 2 part 3.",
      columns: ["database", "task 1 while copy 1 works", "copy 2 on start", "task 1 after copy 2 started"],
      rows: noLock,
    },
    {
      heading: "While A runs",
      text: "A starts first and takes the lock. B starts while A is still running.",
      columns: ["database", "watcher A", "watcher B", "lock held by"],
      rows: runs.map((r) => ({ database: r.database, "watcher A": r.aSaid, "watcher B": r.bSaid, "lock held by": r.heldBeforeKill })),
    },
    {
      heading: "After A is killed",
      text: "A is killed with SIGKILL: no cleanup, no unlock. Then C starts.",
      columns: ["database", "lock held by", "watcher C", "C got the lock"],
      rows: runs.map((r) => ({ database: r.database, "lock held by": r.heldAfterKill, "watcher C": r.cSaid, "C got the lock": r.cGotIt ? "yes" : "no" })),
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
