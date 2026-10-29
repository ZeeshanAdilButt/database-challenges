// toolkit/db.js: one small interface for three databases, so every challenge
// script can run the same steps on SQLite, PostgreSQL and MySQL.
//
//   const db = await freshDatabase("sqlite", "race");   // or "postgres", "mysql"
//   await db.query("SELECT id FROM tasks WHERE status = $1", ["pending"]); // rows
//   await db.run("UPDATE tasks SET status = $1 WHERE id = $2", ["claimed", 1]); // rows matched
//
// SQL uses $1, $2 ... placeholders. PostgreSQL reads them as they are. For
// SQLite they become ?1, ?2 ..., which mean the same thing there. MySQL only
// knows plain ?, filled in order, so the toolkit rewrites both the SQL and
// the list of values.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import pg from "pg";

export const PG_URL =
  process.env.DATABASE_URL ?? "postgresql://challenge:challenge@127.0.0.1:5440/challenges";
export const MYSQL_URL =
  process.env.MYSQL_URL ?? "mysql://challenge:challenge@127.0.0.1:5441/challenges";

// Every database the challenges know, in the order the scripts run them.
export const DATABASES = ["sqlite", "postgres", "mysql"];

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
  // MySQL needs a length for text it can index and compare, so VARCHAR.
  mysql: `
    CREATE TABLE tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'running', 'done', 'failed')),
      claimed_by VARCHAR(50)
    );
    CREATE TABLE sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      worker VARCHAR(50) NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE TABLE events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      kind VARCHAR(100) NOT NULL
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
  if (kind === "mysql") return mysqlConnection();
  throw new Error(`Unknown database "${kind}". Use "sqlite", "postgres" or "mysql".`);
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

// "$2 ... $1" becomes "? ... ?" with the values reordered to match.
function toMysql(sql, params) {
  const values = [];
  const text = sql.replace(/\$(\d+)/g, (_, n) => {
    values.push(params[Number(n) - 1]);
    return "?";
  });
  return [text, values];
}

async function mysqlConnection() {
  let connection;
  try {
    // multipleStatements: the schema is several statements in one string.
    connection = await mysql.createConnection({ uri: MYSQL_URL, multipleStatements: true });
  } catch (error) {
    throw new Error(
      `Cannot reach MySQL at ${MYSQL_URL}. Start it with "npm run db:up". (${error.message})`,
    );
  }
  return {
    kind: "mysql",
    async query(sql, params = []) {
      const [rows] = await connection.query(...toMysql(sql, params));
      return rows;
    },
    // affectedRows counts the rows the WHERE matched, like the other two.
    // (mysql2 asks the server for "found rows"; changedRows counts only the
    // rows whose values really changed.)
    async run(sql, params = []) {
      const [result] = await connection.query(...toMysql(sql, params));
      return result.affectedRows;
    },
    async exec(sql) {
      await connection.query(sql);
    },
    async close() {
      await connection.end();
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
  if (kind === "mysql") await db.exec("DROP TABLE IF EXISTS events, sessions, tasks");
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

// Did the database refuse a second row with the same unique key?
export function isDuplicateKey(error) {
  return error.code === "23505" || error.code === "ER_DUP_ENTRY" ||
    /UNIQUE constraint failed/.test(error.message);
}

// Is PostgreSQL running? Tests use this to skip the PostgreSQL part politely.
export async function postgresIsUp() {
  const client = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// Is MySQL running?
export async function mysqlIsUp() {
  try {
    const connection = await mysql.createConnection({ uri: MYSQL_URL, connectTimeout: 5000 });
    await connection.end();
    return true;
  } catch {
    return false;
  }
}

// The databases this machine can run right now. SQLite always; the other
// two when their Docker container answers. Prints how to start the rest.
export async function availableDatabases({ quiet = false } = {}) {
  const kinds = ["sqlite"];
  const missing = [];
  if (await postgresIsUp()) kinds.push("postgres");
  else missing.push("PostgreSQL");
  if (await mysqlIsUp()) kinds.push("mysql");
  else missing.push("MySQL");
  if (missing.length && !quiet) {
    console.log(`${missing.join(" and ")} not running, so those parts are skipped. Start them with: npm run db:up`);
  }
  return kinds;
}

// For tests: false when the database is up, or the reason to skip.
export async function skipUnless(kind) {
  if (kind === "postgres" && !(await postgresIsUp())) return "PostgreSQL is not running (npm run db:up)";
  if (kind === "mysql" && !(await mysqlIsUp())) return "MySQL is not running (npm run db:up)";
  return false;
}

// "Node.js 24.11.0, SQLite 3.50.4, PostgreSQL 17.6, MySQL 8.4.6": the top of results.md.
export async function versions(kinds) {
  const parts = [`Node.js ${process.versions.node}`, `SQLite ${process.versions.sqlite}`];
  if (kinds.includes("postgres")) {
    const db = await connect("postgres");
    const [{ server_version }] = await db.query("SHOW server_version");
    await db.close();
    parts.push(`PostgreSQL ${server_version.split(" ")[0]}`);
  }
  if (kinds.includes("mysql")) {
    const db = await connect("mysql");
    const [{ version }] = await db.query("SELECT VERSION() AS version");
    await db.close();
    parts.push(`MySQL ${version}`);
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
