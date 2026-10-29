// With a transaction, a crash or an error must leave nothing half-done,
// and the restarted watcher must start the task exactly once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { crashThenRestart, verdict } from "../part-1-crash-halfway/crash.js";
import { errorHalfway } from "./transaction.js";

for (const kind of DATABASES) {
  const skip = await skipUnless(kind);

  for (const crashAfter of ["claim", "session"]) {
    test(`${kind}: crash after ${crashAfter} inside a transaction`, { skip }, async () => {
      const run = await crashThenRestart(kind, crashAfter, { transaction: true });
      assert.ok(run.crashed);
      assert.equal(verdict(run.afterCrash), "clean: still pending");
      assert.equal(verdict(run.afterRestart), "clean: started once");
    });
  }

  test(`${kind}: an error halfway is rolled back`, { skip }, async () => {
    assert.equal(verdict((await errorHalfway(kind, { transaction: false })).state), "half: session, no event");
    assert.equal(verdict((await errorHalfway(kind, { transaction: true })).state), "clean: still pending");
  });
}
