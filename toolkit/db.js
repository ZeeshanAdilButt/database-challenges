// toolkit/db.js: one small interface for both databases, so every challenge
// script can run the same steps on SQLite and on PostgreSQL.
//
//   const db = await freshDatabase("sqlite", "race");   // or "postgres"
//   await db.query("SELECT id FROM tasks WHERE status = $1", ["pending"]); // rows
//   await db.run("UPDATE tasks SET status = $1 WHERE id = $2", ["claimed", 1]); // rows changed
//
// SQL uses $1, $2 ... placeholders. PostgreSQL reads them as they are; for
// SQLite they become ?1, ?2 ..., which mean the same thing there.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const PG_URL =
  process.env.DATABASE_URL ?? "postgresql://challenge:challenge@127.0.0.1:5440/challenges";

// PostgreSQL sends COUNT(*) as a 64-bit number, which pg gives you as a
// string. Our counts are small, so turn them into normal numbers.
pg.types.setTypeParser(20, Number);

// The tables of the running story: tasks the CLI adds, sessions the watcher
// creates (one per task), and events (a log of what happened, in order).
// The CHECK lists every status a task may have; challenge 2 explains it.
const SCHEMA = {
  sqlite: `
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'running', 'done', 'failed')),
      claimed_by TEXT
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      worker TEXT NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      kind TEXT NOT NULL
    );`,
  postgres: `
    CREATE TABLE tasks (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'running', 'done', 'failed')),
      claimed_by TEXT
    );
    CREATE TABLE sessions (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      worker TEXT NOT NULL
    );
    CREATE TABLE events (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      task_id INTEGER NOT NULL,
      kind TEXT NOT NULL
    );`,
};

const CACHE = path.resolve(import.meta.dirname, "..", ".cache");

// Where a script's SQLite file lives. Each script has its own file.
export function sqliteFile(name) {
  fs.mkdirSync(CACHE, { recursive: true });
  return path.join(CACHE, `${name}.db`);
}

// Open one connection. Each connection is one "person" talking to the
// database: two connections can be in the middle of two different things.
// busyTimeout (SQLite only): how many ms to wait for another writer before
// giving up with "database is locked".
export async function connect(kind, name = "challenge", { busyTimeout = 5000 } = {}) {
  if (kind === "sqlite") return sqliteConnection(sqliteFile(name), busyTimeout);
  if (kind === "postgres") return postgresConnection();
  throw new Error(`Unknown database "${kind}". Use "sqlite" or "postgres".`);
}

function sqliteConnection(file, busyTimeout) {
  const db = new DatabaseSync(file);
  // WAL lets readers keep reading while one writer writes.
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = ${busyTimeout};`);
  const toSqlite = (sql) => sql.replace(/\$(\d+)/g, "?$1");
  return {
    kind: "sqlite",
    async query(sql, params = []) {
      return db.prepare(toSqlite(sql)).all(...params);
    },
    async run(sql, params = []) {
      return Number(db.prepare(toSqlite(sql)).run(...params).changes);
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

async function postgresConnection() {
  // One Client, not a Pool: a Pool may send two queries of the same
  // "person" down two different connections, which breaks transactions.
  const client = new pg.Client({ connectionString: PG_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach PostgreSQL at ${PG_URL}. Start it with "npm run db:up". (${error.message})`,
    );
  }
  return {
    kind: "postgres",
    async query(sql, params = []) {
      return (await client.query(sql, params)).rows;
    },
    async run(sql, params = []) {
      return (await client.query(sql, params)).rowCount;
    },
    async exec(sql) {
      await client.query(sql);
    },
    async close() {
      await client.end();
    },
  };
}

// Throw away the old tables and make new, empty ones. `extra` is more SQL to
// run after the tables exist, for example a unique index. Returns a connection.
export async function freshDatabase(kind, name, extra = "") {
  if (kind === "sqlite") {
    const file = sqliteFile(name);
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  }
  const db = await connect(kind, name);
  if (kind === "postgres") await db.exec("DROP TABLE IF EXISTS events, sessions, tasks CASCADE");
  await db.exec(SCHEMA[kind]);
  if (extra) await db.exec(extra);
  return db;
}

// The CLI's job in the story: add `count` pending tasks.
export async function addTasks(db, count) {
  await db.exec("BEGIN");
  for (let i = 1; i <= count; i++) {
    await db.run("INSERT INTO tasks (title) VALUES ($1)", [`task ${i}`]);
  }
  await db.exec("COMMIT");
}

// Tasks that got more than one session: the bug this course hunts.
export async function duplicateSessions(db) {
  return db.query(
    `SELECT task_id, COUNT(*) AS sessions FROM sessions
     GROUP BY task_id HAVING COUNT(*) > 1 ORDER BY task_id`,
  );
}

// Is PostgreSQL running? Tests use this to skip the PostgreSQL half politely.
export async function postgresIsUp() {
  const client = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// "Node.js 24.11.0, SQLite 3.50.4, PostgreSQL 17.6": goes at the top of results.md.
export async function versions(kinds) {
  const parts = [`Node.js ${process.versions.node}`, `SQLite ${process.versions.sqlite}`];
  if (kinds.includes("postgres")) {
    const db = await connect("postgres");
    const [{ server_version }] = await db.query("SHOW server_version");
    await db.close();
    parts.push(`PostgreSQL ${server_version.split(" ")[0]}`);
  }
  return parts.join(", ");
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// True when this file was started with `node file.js`, false when another
// file imports it (a test, for example).
export const isMain = (url) => url === pathToFileURL(process.argv[1]).href;

// Everything the database knows about one task, in one object.
export async function taskState(db, taskId) {
  const [task] = await db.query("SELECT status, claimed_by FROM tasks WHERE id = $1", [taskId]);
  const [{ sessions }] = await db.query("SELECT COUNT(*) AS sessions FROM sessions WHERE task_id = $1", [taskId]);
  const [{ events }] = await db.query("SELECT COUNT(*) AS events FROM events WHERE task_id = $1", [taskId]);
  return { status: task.status, claimedBy: task.claimed_by ?? "nobody", sessions, events };
}
