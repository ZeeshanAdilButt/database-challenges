// The fix must hold: with a checked UPDATE, or a one-statement claim,
// every task gets exactly one session, on both databases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresIsUp } from "../../../toolkit/db.js";
import { realRun, stepByStep } from "./claim.js";

const pgUp = await postgresIsUp();

for (const kind of ["sqlite", "postgres"]) {
  const skip = kind === "postgres" && !pgUp && "PostgreSQL is not running (npm run db:up)";

  test(`${kind}: the second claim changes 0 rows`, { skip }, async () => {
    const { steps, sessions } = await stepByStep(kind);
    assert.equal(steps[4].result, "0 rows changed");
    assert.equal(sessions, 1);
  });

  for (const claim of ["condition", "one-statement"]) {
    test(`${kind}: two real watchers, ${claim}, no task twice`, { skip }, async () => {
      const run = await realRun(kind, claim, { tasks: 100 });
      assert.equal(run.doubled, 0);
      assert.equal(run.sessions, run.tasks);
      assert.equal(run.left, 0, "every task was claimed");
    });
  }
}
