// challenges/challenge-2-all-or-nothing/watcher.js
// A watcher that handles one task and then exits. Starting a task takes
// three writes: claim it, create its session, log an event.
// Options (sent by the part scripts as JSON in OPTIONS):
//   transaction  true: wrap the three writes in BEGIN ... COMMIT
//   crashAfter   "claim", "session" or "event": kill this process right
//                after that write, like a power cut or a closed laptop lid
//   startRunning true: after the commit, move the task on to "running"
//   crashWhileRunning  true: then die while the task is running
//   recover      true: on start, first mark tasks this watcher left running
//                as "failed" (what a restarted watcher should do)
import { connect } from "../../toolkit/db.js";

const options = JSON.parse(process.env.OPTIONS);
const { kind, dbName, transaction, crashAfter, startRunning, crashWhileRunning, recover } = options;
const me = options.name ?? "A";
const db = await connect(kind, dbName);

// Tell the parent script what just happened. Wait until the message is
// sent, because a crash right after would lose it.
const step = (text) => new Promise((resolve) => process.send({ type: "step", step: text }, resolve));

// Die the hard way: no cleanup, no COMMIT, no closing the connection.
async function crash() {
  await step("process killed");
  process.kill(process.pid, "SIGKILL");
  await new Promise(() => {}); // never continue
}

if (recover) {
  // Work left "running" by this watcher's last life was cut off. We cannot
  // know how far it got, so say so: running -> failed is an allowed move.
  // YOUR TURN (chapter 2.7): mark this watcher's running tasks as failed, log an event for each, and report how many.
  const interrupted = [];
  // END YOUR TURN
  await step(`recovered ${interrupted.length} interrupted task(s)`);
}

const [task] = await db.query("SELECT id FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 1");
if (!task) {
  await step("no pending task found");
} else {
  const writes = [
    ["claim", "UPDATE tasks SET status = 'claimed', claimed_by = $2 WHERE id = $1 AND status = 'pending'"],
    ["session", "INSERT INTO sessions (task_id, worker) VALUES ($1, $2)"],
    ["event", "INSERT INTO events (task_id, kind) VALUES ($1, 'session created')"],
  ];
  if (transaction) {
    await db.exec("BEGIN");
    await step("BEGIN");
  }
  for (const [name, sql] of writes) {
    await db.run(sql, name === "event" ? [task.id] : [task.id, me]);
    await step(`${name} written for task ${task.id}`);
    if (crashAfter === name) await crash();
  }
  if (transaction) {
    await db.exec("COMMIT");
    await step("COMMIT");
  }
  if (startRunning) {
    await db.run("UPDATE tasks SET status = 'running' WHERE id = $1 AND status = 'claimed'", [task.id]);
    await step(`task ${task.id} is running`);
    if (crashWhileRunning) await crash();
  }
}
await db.close();
