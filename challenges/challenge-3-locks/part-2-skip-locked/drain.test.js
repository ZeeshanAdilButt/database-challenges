// Every way of claiming must drain the queue with no doubles, and on
// PostgreSQL and MySQL SKIP LOCKED must wait far less than plain FOR UPDATE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { STRATEGIES, drainQueue } from "./drain.js";

for (const kind of DATABASES) {
  const skip = await skipUnless(kind);
  for (const strategy of STRATEGIES[kind]) {
    test(`${kind}: ${strategy} claims every task once`, { skip }, async () => {
      const run = await drainQueue(kind, strategy, { tasks: 40 });
      assert.equal(run.doubled, 0);
      assert.equal(run.sessions, run.tasks);
    });
  }
}

for (const kind of ["postgres", "mysql"]) {
  test(`${kind}: skip locked is faster than for update`, { skip: await skipUnless(kind) }, async () => {
    const wait = await drainQueue(kind, "for update", { tasks: 40 });
    const skip = await drainQueue(kind, "skip locked", { tasks: 40 });
    // Total time depends on the machine; time spent waiting for locks does not
    // overlap at all: skip locked hardly waits, for update waits for every row.
    assert.ok(skip.waited * 3 < wait.waited, `waiting: skip locked ${skip.waited} ms, for update ${wait.waited} ms`);
  });
}
