// challenges/challenge-2-all-or-nothing/part-4-not-a-lock/not-a-lock.js
// Does a transaction stop challenge 1's race? We wrap "read, then update"
// in BEGIN ... COMMIT and force the worst order again. Then we do the same
// with the checked UPDATE from challenge 1 part 2.
//
//   node not-a-lock.js           run on SQLite and PostgreSQL, write results.md and the chart
//   node not-a-lock.js --chart   redraw the chart from results.md only
import path from "node:path";
import { addTasks, connect, freshDatabase, isMain, availableDatabases, versions } from "../../../toolkit/db.js";
import { readTable, writeResults } from "../../../toolkit/results.js";
import { barChart } from "../../../toolkit/chart.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");
const CLAIMS = {
  unchecked: "UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = 1",
  // YOUR TURN (chapter 2.7): the same UPDATE, but it only claims task 1 if it is still pending.
  checked: "UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = 1",
  // END YOUR TURN
};

// Both watchers BEGIN and read task 1. A claims, starts a session and
// commits. Then B claims and starts a session, and tries to commit.
export async function bothInTransactions(kind, claim) {
  const name = `c2p4-${claim}`;
  const setup = await freshDatabase(kind, name);
  await addTasks(setup, 1);
  const a = await connect(kind, name);
  const b = await connect(kind, name);
  const steps = [];
  const step = (watcher, action, result) => steps.push({ watcher, action, result });

  await a.exec("BEGIN");
  await b.exec("BEGIN");
  step("A and B", "BEGIN", "ok");
  step("A", "reads task 1", (await a.query("SELECT status FROM tasks WHERE id = 1"))[0].status);
  step("B", "reads task 1", (await b.query("SELECT status FROM tasks WHERE id = 1"))[0].status);
  step("A", "claims task 1", `${await a.run(CLAIMS[claim], ["A"])} row changed`);
  await a.run("INSERT INTO sessions (task_id, worker) VALUES (1, 'A')");
  await a.exec("COMMIT");
  step("A", "creates a session, COMMIT", "ok");
  try {
    const changed = await b.run(CLAIMS[claim], ["B"]);
    step("B", "claims task 1", `${changed} ${changed === 1 ? "row" : "rows"} changed`);
    if (changed === 1) await b.run("INSERT INTO sessions (task_id, worker) VALUES (1, 'B')");
    await b.exec("COMMIT");
    step("B", changed === 1 ? "creates a session, COMMIT" : "skips, COMMIT", "ok");
  } catch (e) {
    step("B", "claims task 1", `error ${e.errcode ?? e.code}: ${e.errstr ?? e.message}`);
    await b.exec("ROLLBACK");
    step("B", "ROLLBACK", "ok");
  }
  const [{ sessions }] = await setup.query("SELECT COUNT(*) AS sessions FROM sessions");
  await Promise.all([a.close(), b.close(), setup.close()]);
  return { steps, sessions };
}

function drawChart() {
  const rows = readTable(RESULTS, "Sessions for task 1");
  barChart(path.join(here, "chart.svg"), {
    title: "Two watchers, each inside a transaction",
    unit: "sessions for 1 task",
    groups: rows.map((r) => ({
      label: `${r.database}, ${r.claim}`,
      bars: [{ name: "sessions", value: r.sessions, tone: r.sessions === 1 ? "ok" : "bad" }],
    })),
  });
}

async function main() {
  if (process.argv.includes("--chart")) return drawChart();
  const kinds = await availableDatabases();

  const runs = {};
  for (const kind of kinds) {
    for (const claim of ["unchecked", "checked"]) {
      runs[`${kind} ${claim}`] = await bothInTransactions(kind, claim);
      const r = runs[`${kind} ${claim}`];
      console.log(`${kind}, ${claim} UPDATE in a transaction: ${r.steps.at(-1).watcher === "B" ? r.steps.filter((s) => s.watcher === "B").map((s) => s.result).join(" > ") : ""}; ${r.sessions} session(s)`);
    }
  }

  const sections = [];
  for (const claim of ["unchecked", "checked"]) {
    const longest = Math.max(...kinds.map((k) => runs[`${k} ${claim}`].steps.length));
    sections.push({
      heading: `Step by step, ${claim} UPDATE`,
      text: claim === "unchecked"
        ? "The read, then update from challenge 1 part 1, inside BEGIN ... COMMIT."
        : "The checked UPDATE from challenge 1 part 2, inside BEGIN ... COMMIT.",
      columns: ["step", ...kinds.flatMap((k) => [`${k} watcher`, `${k} action`, `${k} result`])],
      rows: Array.from({ length: longest }, (_, i) => ({
        step: i + 1,
        ...Object.fromEntries(kinds.flatMap((k) => {
          const s = runs[`${k} ${claim}`].steps[i] ?? {};
          return [[`${k} watcher`, s.watcher ?? ""], [`${k} action`, s.action ?? ""], [`${k} result`, s.result ?? ""]];
        })),
      })),
    });
  }
  sections.push({
    heading: "Sessions for task 1",
    columns: ["database", "claim", "sessions"],
    rows: Object.entries(runs).map(([key, r]) => {
      const [database, claim] = key.split(" ");
      return { database, claim, sessions: r.sessions };
    }),
  });
  writeResults(RESULTS, "Challenge 2, part 4: a transaction is not a lock", await versions(kinds), sections);
  drawChart();
  console.log("Wrote results.md and chart.svg");
}

if (isMain(import.meta.url)) await main();
