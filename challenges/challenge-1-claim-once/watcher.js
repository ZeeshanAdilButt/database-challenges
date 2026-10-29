// challenges/challenge-1-claim-once/watcher.js
// The watcher from the story, as its own process. Every `pollMs` it looks
// for pending tasks, claims each one, and creates a session for it.
// The part scripts start two copies at once with toolkit/workers.js.
import { connect, sleep } from "../../toolkit/db.js";
import { workerMain } from "../../toolkit/workers.js";

// Claim style 1, the natural first try: the poll already saw the task as
// pending, so just mark it claimed. Nothing checks that it is STILL pending.
export async function claimReadThenUpdate(db, taskId, worker) {
  await db.run("UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = $2", [worker, taskId]);
  return true;
}

// Claim style 2, the fix: the UPDATE itself checks the status. If another
// watcher got there first, the WHERE matches nothing and 0 rows change.
export async function claimWithCondition(db, taskId, worker) {
  // YOUR TURN (chapter 1.7): check the status inside the UPDATE, and return true only if 1 row changed.
  await db.run("UPDATE tasks SET status = 'claimed', claimed_by = $1 WHERE id = $2", [worker, taskId]);
  return true;
  // END YOUR TURN
}

// Claim style 3: find and claim the next pending task in ONE statement, so
// there is no separate read at all. Returns the task id, or null if none.
export async function claimNext(db, worker) {
  const rows = await db.query(
    `UPDATE tasks SET status = 'claimed', claimed_by = $1
     WHERE id = (SELECT id FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 1)
       AND status = 'pending'
     RETURNING id`,
    [worker],
  );
  return rows.length === 1 ? rows[0].id : null;
}

const CLAIMS = { "read-then-update": claimReadThenUpdate, condition: claimWithCondition };

// Create the one session a claimed task should have, and log it.
// If the database refuses a second session (part 3), count it and move on.
async function createSession(db, taskId, worker) {
  try {
    await db.run("INSERT INTO sessions (task_id, worker) VALUES ($1, $2)", [taskId, worker]);
    await db.run("INSERT INTO events (task_id, kind) VALUES ($1, 'session created')", [taskId]);
    return "created";
  } catch (error) {
    const duplicate = error.code === "23505" || /UNIQUE constraint failed/.test(error.message);
    if (duplicate) return "refused";
    throw error;
  }
}

workerMain(async (name, { kind, dbName, claim, pollMs, batch }) => {
  const db = await connect(kind, dbName);
  const claimTask = CLAIMS[claim];
  return async () => {
    const report = { worker: name, polls: 0, claimed: 0, lost: 0, created: 0, refused: 0 };
    let emptyPolls = 0;
    // Stop after three empty polls in a row: the queue is drained.
    while (emptyPolls < 3) {
      if (claim === "one-statement") {
        // Claim up to `batch` tasks, one statement each, then sleep.
        report.polls++;
        let got = 0;
        while (got < batch) {
          const id = await claimNext(db, name);
          if (id === null) {
            // Nothing claimed. Were tasks still waiting? Then we lost a race.
            const [{ waiting }] = await db.query("SELECT COUNT(*) AS waiting FROM tasks WHERE status = 'pending'");
            if (waiting > 0) report.lost++;
            break;
          }
          got++;
          report.claimed++;
          report[await createSession(db, id, name)]++;
        }
        emptyPolls = got === 0 ? emptyPolls + 1 : 0;
        await sleep(pollMs);
        continue;
      }
      const pending = await db.query(
        "SELECT id FROM tasks WHERE status = 'pending' ORDER BY id LIMIT $1",
        [batch],
      );
      report.polls++;
      emptyPolls = pending.length === 0 ? emptyPolls + 1 : 0;
      for (const task of pending) {
        if (await claimTask(db, task.id, name)) {
          report.claimed++;
          report[await createSession(db, task.id, name)]++;
        } else {
          report.lost++;
        }
      }
      await sleep(pollMs);
    }
    await db.close();
    return report;
  };
});
