// A transaction alone must not stop the race on PostgreSQL or MySQL; the
// checked UPDATE must. SQLite stops the second claim with an error instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { skipUnless } from "../../../toolkit/db.js";
import { bothInTransactions } from "./not-a-lock.js";

for (const kind of ["postgres", "mysql"]) {
  const skip = await skipUnless(kind);

  test(`${kind}: BEGIN around read-then-update still gives two sessions`, { skip }, async () => {
    assert.equal((await bothInTransactions(kind, "unchecked")).sessions, 2);
  });

  test(`${kind}: the checked UPDATE gives one session`, { skip }, async () => {
    assert.equal((await bothInTransactions(kind, "checked")).sessions, 1);
  });
}

test("sqlite: the stale second claim fails with error 517", async () => {
  const { steps, sessions } = await bothInTransactions("sqlite", "unchecked");
  assert.ok(steps.some((s) => /^error 517/.test(s.result)));
  assert.equal(sessions, 1);
});
