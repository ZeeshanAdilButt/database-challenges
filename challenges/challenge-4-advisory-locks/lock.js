// challenges/challenge-4-advisory-locks/lock.js
// One named lock, three databases. An advisory lock is a lock on a NAME
// that your programs agree to ask for. It locks no row: the database keeps
// it for you and frees it when you say so, or when your connection ends.
//
//   PostgreSQL: pg_try_advisory_lock(key) and pg_advisory_unlock(key), key is a number
//   MySQL:      GET_LOCK(name, 0) and RELEASE_LOCK(name), name is text
//   SQLite:     no advisory locks. A row in a `locks` table plays the part,
//               and it is only as good as your code that writes it.

// PostgreSQL wants a number. Any number works if every program uses the same one.
export const WATCHER_KEY = 2026;
export const WATCHER_NAME = "watcher";

// The table SQLite uses instead. name is the PRIMARY KEY, so two rows with
// the same name cannot exist: the second INSERT fails.
export const SQLITE_LOCKS = `
  CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    owner TEXT NOT NULL
  );`;

// Try to take the lock without waiting. Returns true or false.
export async function tryLock(db, owner) {
  // YOUR TURN (chapter 4.7): on PostgreSQL and MySQL, try to take the lock without waiting, and return true or false.
  if (db.kind === "postgres" || db.kind === "mysql") return false;
  // END YOUR TURN
  try {
    await db.run("INSERT INTO locks (name, owner) VALUES ($1, $2)", [WATCHER_NAME, owner]);
    return true;
  } catch (error) {
    if (/UNIQUE constraint failed/.test(error.message)) return false;
    throw error;
  }
}

// Give the lock back. Only the owner can: the others are told no.
export async function unlock(db, owner) {
  if (db.kind === "postgres") {
    const [{ done }] = await db.query("SELECT pg_advisory_unlock($1) AS done", [WATCHER_KEY]);
    return done;
  }
  if (db.kind === "mysql") {
    const [{ done }] = await db.query("SELECT RELEASE_LOCK($1) AS done", [WATCHER_NAME]);
    return done === 1;
  }
  return (await db.run("DELETE FROM locks WHERE name = $1 AND owner = $2", [WATCHER_NAME, owner])) === 1;
}

// Who holds it right now, as the database sees it (for the report).
export async function holder(db) {
  if (db.kind === "postgres") {
    const rows = await db.query(
      "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = $1 AND granted",
      [WATCHER_KEY],
    );
    return rows.length ? `connection ${rows[0].pid}` : "nobody";
  }
  if (db.kind === "mysql") {
    const [{ id }] = await db.query("SELECT IS_USED_LOCK($1) AS id", [WATCHER_NAME]);
    return id === null ? "nobody" : `connection ${id}`;
  }
  const rows = await db.query("SELECT owner FROM locks WHERE name = $1", [WATCHER_NAME]);
  return rows.length ? `row says ${rows[0].owner}` : "nobody";
}
