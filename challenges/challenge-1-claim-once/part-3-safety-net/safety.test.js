// The unique index must refuse a second session, and only the fixed claim
// keeps the task's owner and its session in agreement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { realRun, secondInsert } from "./safety.js";

for (const kind of DATABASES) {
  const skip = await skipUnless(kind);

  test(`${kind}: a second session for the same task is refused`, { skip }, async () => {
    assert.match(await secondInsert(kind), /UNIQUE constraint failed|23505|ER_DUP_ENTRY/);
  });

  test(`${kind}: with the bug, the index stops doubles but not wrong owners`, { skip }, async () => {
    const run = await realRun(kind, "read-then-update", { tasks: 100 });
    assert.equal(run.doubled, 0);
    assert.equal(run.sessions, run.tasks);
    // A refused session means two watchers both ran their UPDATE. If the
    // loser's UPDATE ran last, claimed_by now names the wrong watcher.
    assert.ok(run.mismatched <= run.refused);
    assert.ok(run.refused === 0 || run.mismatched > 0, "some tasks name the wrong owner");
  });

  test(`${kind}: with the fix and the index, nothing is refused`, { skip }, async () => {
    const run = await realRun(kind, "condition", { tasks: 100 });
    assert.equal(run.refused, 0);
    assert.equal(run.mismatched, 0);
  });
}
