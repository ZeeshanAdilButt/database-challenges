// A deferred SQLite transaction that reads and then writes must fail even
// with a busy timeout; BEGIN IMMEDIATE with a timeout must not fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresIsUp } from "../../../toolkit/db.js";
import { deferredTrap, fourWriters } from "./writers.js";

const pgUp = await postgresIsUp();

test("sqlite: the stale reader cannot write, and the timeout does not help", async () => {
  const last = (await deferredTrap("sqlite")).at(-1);
  assert.match(last.result, /^error 517: database is locked/);
});

test("postgres: the same steps change 0 rows, with no error", { skip: !pgUp && "PostgreSQL is not running" }, async () => {
  const last = (await deferredTrap("postgres")).at(-1);
  assert.match(last.result, /^0 rows changed, no error/);
});

test("sqlite: plain BEGIN fails under load even with a 5,000 ms timeout", async () => {
  const run = await fourWriters("sqlite", "BEGIN", 5000, { tasks: 40 });
  assert.ok(run.failed > 0, "expected some 'database is locked' errors");
  assert.equal(run.doubled, 0, "the checked UPDATE still prevents doubles");
});

test("sqlite: BEGIN IMMEDIATE with a timeout never fails", async () => {
  const run = await fourWriters("sqlite", "BEGIN IMMEDIATE", 5000, { tasks: 40 });
  assert.equal(run.failed, 0);
  assert.equal(run.sessions, 40);
});
