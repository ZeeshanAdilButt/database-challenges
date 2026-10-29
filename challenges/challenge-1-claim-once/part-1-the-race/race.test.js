// The race must show up: forced into the worst order, read-then-update
// saves two sessions for one task, on both databases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { realRun, stepByStep } from "./race.js";

for (const kind of DATABASES) {
  const skip = await skipUnless(kind);

  test(`${kind}: both watchers claim the same task`, { skip }, async () => {
    const { steps, sessions } = await stepByStep(kind);
    assert.equal(steps[1].result, "pending", "B still sees the task as pending");
    assert.equal(steps[4].result, "1 row changed", "B's unchecked UPDATE succeeds");
    assert.equal(sessions, 2, "one task, two sessions");
  });

  test(`${kind}: two real watchers save one session per claim`, { skip }, async () => {
    const run = await realRun(kind, { tasks: 50 });
    // Every task got at least one session; each extra session is a doubled task.
    assert.equal(run.sessions, run.tasks + run.doubled);
  });
}
