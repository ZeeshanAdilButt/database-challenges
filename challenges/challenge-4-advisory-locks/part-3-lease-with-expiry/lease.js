// challenges/challenge-4-advisory-locks/part-3-lease-with-expiry/lease.js
// With two watchers, a dead watcher's task must be taken over, but a slow
// one's must not be stolen too early. A lease is a claim that runs out:
// the owner keeps renewing it, and once it has run out anyone may take the
// task. A fencing number (lease_token) goes up on every new claim, so an
// old owner that wakes up late cannot overwrite the new owner's work.
//
// The script passes the time in (`now`, in ms), so every run gives the same
// answer. In your app, use the database's clock or Date.now() on one machine.
//
//   node lease.js           run on every database that is up, write results.md and the chart
//   node lease.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, availableDatabases, connect, freshDatabase, isMain, versions } from "../../../toolkit/db.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { timelineChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
export const LEASE_MS = 1500;

// Three more columns on tasks: who holds the lease, until when, and the
// fencing number. Separate statements, so all three databases accept them.
const LEASE_COLUMNS = `
  ALTER TABLE tasks ADD COLUMN lease_owner VARCHAR(50);
  ALTER TABLE tasks ADD COLUMN lease_until BIGINT;
  ALTER TABLE tasks ADD COLUMN lease_token INTEGER NOT NULL DEFAULT 0;`;

// Take the lease if the task is free, or if the last lease has run out.
// Returns the new fencing number, or null if someone else holds a live lease.
export async function takeLease(db, taskId, worker, now) {
  // YOUR TURN (chapter 4.7): also allow the claim when the task is running but its lease ran out before `now`.
  const changed = await db.run(
    `UPDATE tasks
     SET status = 'running', lease_owner = $1, lease_until = $2, lease_token = lease_token + 1
     WHERE id = $3 AND status = 'pending'`,
    [worker, now + LEASE_MS, taskId],
  );
  // END YOUR TURN
  if (changed !== 1) return null;
  const [{ token }] = await db.query("SELECT lease_token AS token FROM tasks WHERE id = $1", [taskId]);
  return token;
}

// Renew a lease you still hold. 0 rows changed means you lost it.
export async function renew(db, taskId, token, now) {
  return db.run(
    "UPDATE tasks SET lease_until = $1 WHERE id = $2 AND lease_token = $3 AND status = 'running'",
    [now + LEASE_MS, taskId, token],
  );
}

// Finish the task, but only if your fencing number is still the current one.
export async function finish(db, taskId, token, worker) {
  // YOUR TURN (chapter 4.7): finish only if `token` is still the task's lease_token and the task is still running.
  return db.run("UPDATE tasks SET status = 'done', claimed_by = $1 WHERE id = $2", [worker, taskId]);
  // END YOUR TURN
}

// The same finish with no fence: it trusts that the caller still owns the task.
export async function finishUnfenced(db, taskId, worker) {
  return db.run("UPDATE tasks SET status = 'done', claimed_by = $1 WHERE id = $2", [worker, taskId]);
}

// One story, step by step, at fixed times. A takes task 1 and then stops
// renewing (it died, or it paused). B tries before and after the lease runs
// out. Then A wakes up and tries to finish.
export async function story(kind, { fenced }) {
  const name = `c4p3-${kind}`;
  const setup = await freshDatabase(kind, name, LEASE_COLUMNS);
  await addTasks(setup, 1);
  const a = await connect(kind, name);
  const b = await connect(kind, name);
  const steps = [];
  const log = (t, watcher, action, result) => steps.push({ "time (ms)": t, watcher, action, result });

  const tokenA = await takeLease(a, 1, "A", 0);
  log(0, "A", `takes the lease on task 1 until ${LEASE_MS} ms`, tokenA === null ? "refused" : `got it, token ${tokenA}`);
  log(500, "A", "renews", (await renew(a, 1, tokenA, 500)) === 1 ? `renewed until ${500 + LEASE_MS} ms` : "lost it");
  log(600, "A", "stops renewing (killed, or paused)", "no more renewals");
  const early = await takeLease(b, 1, "B", 1000);
  log(1000, "B", "tries to take task 1", early === null ? "refused: A's lease runs until 2000 ms" : `got it, token ${early}`);
  const tokenB = await takeLease(b, 1, "B", 2100);
  log(2100, "B", "tries again after the lease ran out", tokenB === null ? "refused" : `got it, token ${tokenB}`);
  const lateA = fenced ? await finish(a, 1, tokenA, "A") : await finishUnfenced(a, 1, "A");
  log(2300, "A", fenced ? `wakes up, finishes with token ${tokenA}` : "wakes up, finishes with no token check",
    lateA === 1 ? "1 row changed: A overwrote B's task" : "0 rows changed: fenced out");
  const doneB = await finish(b, 1, tokenB, "B");
  log(2600, "B", `finishes with token ${tokenB}`, doneB === 1 ? "1 row changed" : "0 rows changed: the task was already marked done by A");

  const [final] = await setup.query("SELECT status, claimed_by, lease_token FROM tasks WHERE id = 1");
  await Promise.all([a.close(), b.close(), setup.close()]);
  return { steps, final };
}

function drawChart() {
  const steps = readTable(RESULTS, "With a fencing token");
  timelineChart(path.join(here, "chart.svg"), {
    title: "A lease runs out, B takes over, late A is fenced out",
    lanes: ["Watcher A", "Watcher B"],
    steps: steps.map((s) => ({
      lane: `Watcher ${s.watcher}`,
      label: `${s["time (ms)"]} ms: ${s.action}`,
      tone: /fenced out|got it, token 2/.test(s.sqlite) ? "ok" : /refused|stops/.test(s.sqlite) ? "wait" : "plain",
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = await availableDatabases();
  const runs = {};
  for (const kind of kinds) {
    for (const fenced of [false, true]) {
      runs[`${kind} ${fenced}`] = await story(kind, { fenced });
      const r = runs[`${kind} ${fenced}`];
      console.log(`${kind}, ${fenced ? "fenced" : "no fence"}: task 1 ends ${r.final.status}, done by ${r.final.claimed_by}`);
    }
  }
  const section = (fenced, heading, text) => ({
    heading,
    text,
    columns: ["time (ms)", "watcher", "action", ...kinds],
    rows: runs[`${kinds[0]} ${fenced}`].steps.map((s, i) => ({
      "time (ms)": s["time (ms)"], watcher: s.watcher, action: s.action,
      ...Object.fromEntries(kinds.map((k) => [k, runs[`${k} ${fenced}`].steps[i].result])),
    })),
  });
  writeResults(RESULTS, "Challenge 4, part 3: a lease with an expiry", await versions(kinds), [
    section(false, "Without a fencing token", `The lease lasts ${LEASE_MS} ms. A stops renewing at 600 ms. When A wakes up, it finishes the task with an UPDATE that checks nothing.`),
    section(true, "With a fencing token", "The same story, but every finish checks lease_token. A still holds token 1; B took token 2."),
    {
      heading: "Who finished task 1",
      columns: ["database", "fence", "status", "finished by", "lease_token"],
      rows: Object.entries(runs).map(([key, r]) => {
        const [database, fenced] = key.split(" ");
        return { database, fence: fenced === "true" ? "token checked" : "none", status: r.final.status, "finished by": r.final.claimed_by, lease_token: r.final.lease_token };
      }),
    },
  ]);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
