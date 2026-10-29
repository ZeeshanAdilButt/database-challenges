// A session lock outlives ROLLBACK; a transaction lock does not. And no
// advisory lock stops a program that never asks for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { rowNotProtected, scopes } from "./scope.js";

test("postgres: session lock stays after ROLLBACK, transaction lock goes", { skip: await skipUnless("postgres") }, async () => {
  const [session, xact] = await scopes("postgres");
  assert.equal(session["held after ROLLBACK"], "yes");
  assert.equal(session["held after COMMIT"], "yes");
  assert.equal(xact["held during the transaction"], "yes");
  assert.equal(xact["held after ROLLBACK"], "no");
  assert.equal(xact["held after COMMIT"], "no");
});

test("mysql: GET_LOCK stays after ROLLBACK and after COMMIT", { skip: await skipUnless("mysql") }, async () => {
  const [lock] = await scopes("mysql");
  assert.equal(lock["held after ROLLBACK"], "yes");
  assert.equal(lock["held after COMMIT"], "yes");
});

test("sqlite: the lock row is rolled back with its transaction", async () => {
  const [row] = await scopes("sqlite");
  assert.equal(row["held after ROLLBACK"], "no");
  assert.equal(row["held after COMMIT"], "yes");
});

for (const kind of DATABASES) {
  test(`${kind}: the lock does not stop a plain UPDATE`, { skip: await skipUnless(kind) }, async () => {
    assert.equal(await rowNotProtected(kind), 1);
  });
}
