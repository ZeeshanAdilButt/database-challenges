// Only allowed moves may change a task, and a restart must not leave a
// task stuck as running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresIsUp } from "../../../toolkit/db.js";
import { dieWhileRunning, tryMoves } from "./moves.js";

const pgUp = await postgresIsUp();

for (const kind of ["sqlite", "postgres"]) {
  const skip = kind === "postgres" && !pgUp && "PostgreSQL is not running (npm run db:up)";

  test(`${kind}: stale, forbidden and misspelled moves are refused`, { skip }, async () => {
    const rows = await tryMoves(kind);
    assert.deepEqual(rows.slice(0, 3).map((r) => r.result), ["moved", "moved", "moved"]);
    assert.match(rows[3].result, /^0 rows changed/);
    assert.match(rows[4].result, /^refused by the code/);
    assert.match(rows[5].result, /^refused by the CHECK/);
    assert.ok(rows.every((r, i) => i < 2 || r["status now"] === "done"), "the task stays done");
  });

  test(`${kind}: recovery marks an interrupted task failed`, { skip }, async () => {
    const plain = await dieWhileRunning(kind, { recover: false });
    assert.equal(plain.afterRestart.status, "running", "without recovery it is stuck");
    const fixed = await dieWhileRunning(kind, { recover: true });
    assert.equal(fixed.afterRestart.status, "failed");
    assert.equal(fixed.afterRestart.sessions, 1, "no second session");
  });
}
