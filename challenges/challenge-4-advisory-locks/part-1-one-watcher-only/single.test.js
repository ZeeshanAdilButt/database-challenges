// Only one watcher may hold the lock. After the holder is killed, the
// database frees a real advisory lock; SQLite's lock row stays behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { oneWatcherOnly, twoCopiesNoLock } from "./single.js";

for (const kind of DATABASES) {
  test(`${kind}: without a lock, a second copy fails the first copy's live task`, { skip: await skipUnless(kind) }, async () => {
    const run = await twoCopiesNoLock(kind);
    assert.equal(run.before, "running");
    assert.equal(run.after, "failed");
  });

  test(`${kind}: a second watcher is turned away`, { skip: await skipUnless(kind) }, async () => {
    const run = await oneWatcherOnly(kind);
    assert.match(run.aSaid, /got the lock/);
    assert.match(run.bSaid, /found the lock taken/);
    // PostgreSQL and MySQL free the lock when A's connection dies. SQLite's
    // row does not know A died, so C is turned away too.
    assert.equal(run.cGotIt, kind !== "sqlite");
  });
}
