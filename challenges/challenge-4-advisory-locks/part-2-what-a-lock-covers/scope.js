// challenges/challenge-4-advisory-locks/part-2-what-a-lock-covers/scope.js
// Two questions about an advisory lock, asked on every database:
//   1. When is it given back: at ROLLBACK, at COMMIT, or only when you say so?
//   2. Does it stop a program that never asks for it from changing a row?
// Connection A takes the lock in different ways; connection B checks.
//
//   node scope.js           run on every database that is up, write results.md
//   node scope.js --chart   (no chart: this part's result is a table)
import path from "node:path";
import { addTasks, availableDatabases, connect, freshDatabase, isMain, versions } from "../../../toolkit/db.js";
import { writeResults } from "../../../toolkit/results.js";
import { SQLITE_LOCKS, WATCHER_KEY, WATCHER_NAME } from "../lock.js";

const here = import.meta.dirname;
const RESULTS = path.join(here, "results.md");

// Can B take the lock right now? Then B gives it straight back.
async function bCanTake(b) {
  if (b.kind === "postgres") {
    const [{ got }] = await b.query("SELECT pg_try_advisory_lock($1) AS got", [WATCHER_KEY]);
    if (got) await b.query("SELECT pg_advisory_unlock($1)", [WATCHER_KEY]);
    return got;
  }
  if (b.kind === "mysql") {
    const [{ free }] = await b.query("SELECT IS_FREE_LOCK($1) AS free", [WATCHER_NAME]);
    return free === 1;
  }
  const rows = await b.query("SELECT owner FROM locks WHERE name = $1", [WATCHER_NAME]);
  return rows.length === 0;
}

// The ways each database offers to take the lock inside a transaction.
const WAYS = {
  postgres: [
    ["session lock: pg_advisory_lock", "SELECT pg_advisory_lock($1)", [WATCHER_KEY], "SELECT pg_advisory_unlock($1)"],
    ["transaction lock: pg_advisory_xact_lock", "SELECT pg_advisory_xact_lock($1)", [WATCHER_KEY], null],
  ],
  mysql: [
    ["GET_LOCK (MySQL has no transaction lock)", "SELECT GET_LOCK($1, 0)", [WATCHER_NAME], "SELECT RELEASE_LOCK($1)"],
  ],
  sqlite: [
    ["a row in the locks table", "INSERT INTO locks (name, owner) VALUES ($1, 'A')", [WATCHER_NAME], "DELETE FROM locks WHERE name = $1"],
  ],
};

// A takes the lock inside BEGIN, then ends the transaction with `end`.
// Is the lock still held afterwards?
async function heldAfter(kind, way, end) {
  const [, take, params, release] = way;
  const name = `c4p2-${kind}`;
  const setup = await freshDatabase(kind, name, kind === "sqlite" ? SQLITE_LOCKS : "");
  await setup.close();
  const a = await connect(kind, name);
  const b = await connect(kind, name);
  await a.exec("BEGIN");
  await a.query(take, params);
  const duringTransaction = !(await bCanTake(b));
  await a.exec(end);
  const afterEnd = !(await bCanTake(b));
  if (release && afterEnd) await a.query(release, release.includes("$1") ? params.slice(0, 1) : []);
  await Promise.all([a.close(), b.close()]);
  return { duringTransaction, afterEnd };
}

// A holds the lock "for task 1". B never asks for the lock and updates task 1.
export async function rowNotProtected(kind) {
  const name = `c4p2-row-${kind}`;
  const setup = await freshDatabase(kind, name, kind === "sqlite" ? SQLITE_LOCKS : "");
  await addTasks(setup, 1);
  const a = await connect(kind, name);
  const b = await connect(kind, name);
  const [, take, params] = WAYS[kind][0];
  await a.query(take, params);
  const changed = await b.run("UPDATE tasks SET status = 'claimed', claimed_by = 'B' WHERE id = 1");
  await Promise.all([a.close(), b.close(), setup.close()]);
  return changed;
}

export async function scopes(kind) {
  const rows = [];
  for (const way of WAYS[kind]) {
    const rolledBack = await heldAfter(kind, way, "ROLLBACK");
    const committed = await heldAfter(kind, way, "COMMIT");
    rows.push({
      lock: way[0],
      "held during the transaction": rolledBack.duringTransaction ? "yes" : "no",
      "held after ROLLBACK": rolledBack.afterEnd ? "yes" : "no",
      "held after COMMIT": committed.afterEnd ? "yes" : "no",
    });
  }
  return rows;
}

async function main() {
  if (process.argv.includes("--chart")) return;
  const kinds = await availableDatabases();
  const scopeRows = [];
  const rowRows = [];
  for (const kind of kinds) {
    for (const row of await scopes(kind)) {
      scopeRows.push({ database: kind, ...row });
      console.log(`${kind}, ${row.lock}: after ROLLBACK ${row["held after ROLLBACK"]}, after COMMIT ${row["held after COMMIT"]}`);
    }
    const changed = await rowNotProtected(kind);
    rowRows.push({ database: kind, "B's UPDATE of task 1, while A holds the lock": `${changed} row changed` });
    console.log(`${kind}: B updated task 1 while A held the lock: ${changed} row changed`);
  }
  writeResults(RESULTS, "Challenge 4, part 2: what a lock covers", await versions(kinds), [
    {
      heading: "When is the lock given back",
      text: "Connection A runs BEGIN, takes the lock, then ends the transaction. Connection B checks whether the lock is still taken.",
      columns: ["database", "lock", "held during the transaction", "held after ROLLBACK", "held after COMMIT"],
      rows: scopeRows,
    },
    {
      heading: "Does it protect the row",
      text: "A holds the lock and means it for task 1. B never asks for the lock and updates task 1 directly.",
      columns: ["database", "B's UPDATE of task 1, while A holds the lock"],
      rows: rowRows,
    },
  ]);
  console.log("Wrote results.md");
}

if (isMain(import.meta.url)) await main();
