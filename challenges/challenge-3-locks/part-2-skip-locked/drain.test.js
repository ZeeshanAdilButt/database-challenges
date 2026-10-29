// Every way of claiming must drain the queue with no doubles, and on
// PostgreSQL SKIP LOCKED must beat plain FOR UPDATE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresIsUp } from "../../../toolkit/db.js";
import { STRATEGIES, drainQueue } from "./drain.js";

const pgUp = await postgresIsUp();

for (const kind of ["sqlite", "postgres"]) {
  const skip = kind === "postgres" && !pgUp && "PostgreSQL is not running (npm run db:up)";
  for (const strategy of STRATEGIES[kind]) {
    test(`${kind}: ${strategy} claims every task once`, { skip }, async () => {
      const run = await drainQueue(kind, strategy, { tasks: 40 });
      assert.equal(run.doubled, 0);
      assert.equal(run.sessions, run.tasks);
    });
  }
}

test("postgres: skip locked is faster than for update", { skip: !pgUp && "PostgreSQL is not running" }, async () => {
  const wait = await drainQueue("postgres", "for update", { tasks: 40 });
  const skip = await drainQueue("postgres", "skip locked", { tasks: 40 });
  // Total time depends on the machine; time spent waiting for locks does not
  // overlap at all: skip locked hardly waits, for update waits for every row.
  assert.ok(skip.waited * 3 < wait.waited, `waiting: skip locked ${skip.waited} ms, for update ${wait.waited} ms`);
});
