// challenges/challenge-3-locks/lock-worker.js
// A watcher process for challenge 3. The part scripts start several copies.
// Options (JSON in OPTIONS), by mode:
//   mode "hold":  at t0 + startAt ms, lock task `taskId`, keep the lock for
//                 holdMs, claim the task if it is still pending, commit.
//   mode "drain": claim tasks one by one until none are left, using
//                 `strategy`, and spend `workMs` on each task.
//   mode "writes": claim tasks in transactions that start with `begin`
//                 ("BEGIN" or "BEGIN IMMEDIATE"), and count the errors.
// Every copy sends one report back with times in ms since t0.
import { connect, sleep } from "../../toolkit/db.js";

const o = JSON.parse(process.env.OPTIONS);
const db = await connect(o.kind, o.dbName, { busyTimeout: o.busyTimeout ?? 5000 });
const now = () => Date.now() - o.t0;
const report = (data) => new Promise((resolve) => process.send({ type: "step", step: data }, resolve));

// Lock one task row so nobody else can claim it until we commit.
// PostgreSQL and MySQL lock just that row. SQLite has no row locks: BEGIN
// IMMEDIATE takes the one write lock for the whole database file.
async function lockTask(taskId) {
  if (db.kind === "postgres" || db.kind === "mysql") {
    await db.exec("BEGIN");
    return (await db.query("SELECT id, status FROM tasks WHERE id = $1 FOR UPDATE", [taskId]))[0];
  }
  await db.exec("BEGIN IMMEDIATE");
  return (await db.query("SELECT id, status FROM tasks WHERE id = $1", [taskId]))[0];
}

async function claimAndStart(taskId) {
  await db.run("UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = $2", [o.name, taskId]);
  await db.run("INSERT INTO sessions (task_id, worker) VALUES ($1, $2)", [taskId, o.name]);
}

async function hold() {
  if (o.waitForGo) {
    // Connected and ready: wait for the parent to say when to ask.
    // once: a listener that stays would keep this process alive after its work.
    const go = new Promise((resolve) => process.once("message", resolve));
    await report("ready");
    await go;
  }
  await sleep(Math.max(0, o.t0 + o.startAt - Date.now()));
  const asked = now();
  const task = await lockTask(o.taskId);
  const got = now();
  await report("locked"); // tell the parent, so it can start the next watcher now
  let action = "skipped: already claimed";
  if (task.status === "pending") {
    await sleep(o.holdMs); // the work done while holding the lock
    await claimAndStart(task.id);
    action = "claimed it";
  }
  await db.exec("COMMIT");
  return { name: o.name, task: o.taskId, asked, got, done: now(), saw: task.status, action };
}

// The four ways to drain a queue that part 2 compares.
const NEXT = "SELECT id FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 1";
const strategies = {
  // Lock the next pending row. If another worker holds it, wait.
  "for update": async () => {
    await db.exec("BEGIN");
    const [task] = await db.query(`${NEXT} FOR UPDATE`);
    return task ? task.id : null;
  },
  // Lock the next pending row nobody else holds. Never wait.
  "skip locked": async () => {
    // YOUR TURN (chapter 3.7): lock the next pending row that nobody else holds, and never wait.
    await db.exec("BEGIN");
    const [task] = await db.query(`${NEXT} FOR UPDATE`);
    return task ? task.id : null;
    // END YOUR TURN
  },
  // SQLite: take the database's one write lock, then pick the next task.
  "begin immediate": async () => {
    await db.exec("BEGIN IMMEDIATE");
    const [task] = await db.query(NEXT);
    return task ? task.id : null;
  },
};

// Claim the next pending task and create its session in one short
// transaction, then commit. Returns the task id, or null if none was free.
async function shortClaim() {
  // YOUR TURN (chapter 3.7): BEGIN (BEGIN IMMEDIATE on SQLite), claim the next pending task in one UPDATE
  // (RETURNING id on PostgreSQL and SQLite, LAST_INSERT_ID(id) on MySQL), insert its session, COMMIT,
  // and return the id. If nothing was claimed, COMMIT and return null.
  throw new Error("Your turn: write shortClaim() in lock-worker.js (chapter 3.7)");
  // END YOUR TURN
}

async function drain() {
  const start = now();
  let claimed = 0;
  let waited = 0;
  while (true) {
    if (o.strategy === "short claim") {
      // Claim and create the session in one short transaction (challenge 2),
      // commit at once, then do the work with no lock held.
      const t = now();
      const id = await shortClaim();
      waited += now() - t;
      if (id === null) {
        const [{ pending_left: left }] = await db.query("SELECT COUNT(*) AS pending_left FROM tasks WHERE status = 'pending'");
        if (left === 0) break;
        continue;
      }
      claimed++;
      await sleep(o.workMs);
      continue;
    }
    const t = now();
    const id = await strategies[o.strategy]();
    waited += now() - t;
    if (id === null) {
      await db.exec("COMMIT");
      // Nothing we could lock. Stop only if the queue is really empty.
      const [{ pending_left: left }] = await db.query("SELECT COUNT(*) AS pending_left FROM tasks WHERE status = 'pending'");
      if (left === 0) break;
      await sleep(2);
      continue;
    }
    await claimAndStart(id);
    await sleep(o.workMs); // work done while the lock is held
    await db.exec("COMMIT");
    claimed++;
  }
  return { name: o.name, claimed, waited, start, done: now() };
}

async function writes() {
  let committed = 0;
  const errors = {};
  while (true) {
    try {
      await db.exec(o.begin);
      const [task] = await db.query(NEXT); // read first ...
      if (!task) {
        await db.exec("COMMIT");
        break;
      }
      await sleep(o.thinkMs); // ... a short gap, as in real code ...
      const changed = await db.run( // ... then write: this needs the write lock
        "UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = $2 AND status = 'pending'",
        [o.name, task.id],
      );
      if (changed === 1) await db.run("INSERT INTO sessions (task_id, worker) VALUES ($1, $2)", [task.id, o.name]);
      await db.exec("COMMIT");
      committed++;
    } catch (e) {
      // SQLite gives a number for each kind of error: 5 is SQLITE_BUSY,
      // 517 is SQLITE_BUSY_SNAPSHOT (your snapshot is out of date).
      const key = `${e.errcode ?? e.code}: ${e.errstr ?? e.message}`;
      errors[key] = (errors[key] ?? 0) + 1;
      try {
        await db.exec("ROLLBACK");
      } catch {
        // BEGIN itself failed, so there is nothing to roll back.
      }
      await sleep(1);
    }
  }
  return { name: o.name, committed, errors };
}

const modes = { hold, drain, writes };
await report(await modes[o.mode]());
await db.close();
