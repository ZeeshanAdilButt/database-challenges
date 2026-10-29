// Claiming by insert must give exactly one session per task on every
// database, and the task's owner must always match its session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { realRun, stepByStep } from "./insert.js";

for (const kind of DATABASES) {
  const skip = await skipUnless(kind);

  test(`${kind}: the second insert changes 0 rows`, { skip }, async () => {
    const { steps, sessions } = await stepByStep(kind);
    assert.equal(steps[2].result, "1 row changed");
    assert.equal(steps[3].result, "0 rows changed");
    assert.equal(sessions, 1);
  });

  test(`${kind}: two real watchers claiming by insert, no task twice`, { skip }, async () => {
    const run = await realRun(kind, { tasks: 100 });
    assert.equal(run.doubled, 0);
    assert.equal(run.sessions, run.tasks);
    assert.equal(run.mismatched, 0, "only the winner marks the task claimed");
  });
}
