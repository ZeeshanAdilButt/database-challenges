// PostgreSQL's FOR UPDATE locks one row; SQLite's BEGIN IMMEDIATE locks the
// whole database for writing. The waits must show it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { skipUnless } from "../../../toolkit/db.js";
import { race, sqliteHasNoForUpdate } from "./wait.js";


test("sqlite: FOR UPDATE is a syntax error", async () => {
  assert.match(await sqliteHasNoForUpdate(), /syntax error/);
});

test("sqlite: B waits for A even for a different task", async () => {
  const same = await race("sqlite", 1);
  assert.ok(same.bWaited >= 200, `B waited ${same.bWaited} ms`);
  assert.equal(same.b.action, "skipped: already claimed");
  const other = await race("sqlite", 2);
  assert.ok(other.bWaited >= 200, `B waited ${other.bWaited} ms`);
  assert.equal(other.sessions, 2);
});

for (const kind of ["postgres", "mysql"]) {
  test(`${kind}: B waits only for the same row`, { skip: await skipUnless(kind) }, async () => {
    const same = await race(kind, 1);
    assert.ok(same.bWaited >= 200, `B waited ${same.bWaited} ms`);
    assert.equal(same.b.saw, "claimed", "after the wait B sees A's committed change");
    assert.equal(same.sessions, 1);
    const other = await race(kind, 2);
    // A busy laptop adds a few ms to any wait, so compare the two waits:
    // a different row must cost far less than the locked one.
    assert.ok(other.bWaited * 3 < same.bWaited, `B waited ${other.bWaited} ms for another row, ${same.bWaited} ms for the locked one`);
    assert.equal(other.sessions, 2);
  });
}
