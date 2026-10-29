// Without a transaction, a crash between writes must leave a broken task
// that a restart never picks up again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { crashThenRestart, verdict } from "./crash.js";

for (const kind of DATABASES) {
  const skip = await skipUnless(kind);

  test(`${kind}: crash after the claim leaves the task stuck`, { skip }, async () => {
    const run = await crashThenRestart(kind, "claim");
    assert.ok(run.crashed, "the watcher really died");
    assert.equal(verdict(run.afterRestart), "stuck: claimed, no session");
  });

  test(`${kind}: crash after the session leaves no event`, { skip }, async () => {
    const run = await crashThenRestart(kind, "session");
    assert.equal(verdict(run.afterRestart), "half: session, no event");
  });
}
