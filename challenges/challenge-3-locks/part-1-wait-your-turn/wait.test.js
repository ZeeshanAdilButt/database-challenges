// PostgreSQL's FOR UPDATE locks one row; SQLite's BEGIN IMMEDIATE locks the
// whole database for writing. The waits must show it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresIsUp } from "../../../toolkit/db.js";
import { race, sqliteHasNoForUpdate } from "./wait.js";

const pgUp = await postgresIsUp();
const skip = !pgUp && "PostgreSQL is not running (npm run db:up)";

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

test("postgres: B waits only for the same row", { skip }, async () => {
  const same = await race("postgres", 1);
  assert.ok(same.bWaited >= 200, `B waited ${same.bWaited} ms`);
  assert.equal(same.b.saw, "claimed", "after the wait B sees A's committed change");
  assert.equal(same.sessions, 1);
  const other = await race("postgres", 2);
  assert.ok(other.bWaited < 100, `B waited ${other.bWaited} ms`);
  assert.equal(other.sessions, 2);
});
