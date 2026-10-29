// challenges/challenge-4-advisory-locks/lock-holder.js
// A watcher that starts by taking the "only one watcher" lock. If it gets
// the lock, it keeps running (here: it just waits) until it is killed.
// If it does not, it says so and exits, like a second copy should.
// Options (JSON in OPTIONS): kind, dbName, name.
import { connect } from "../../toolkit/db.js";
import { tryLock } from "./lock.js";

const { kind, dbName, name } = JSON.parse(process.env.OPTIONS);
const db = await connect(kind, dbName);
const step = (text) => new Promise((resolve) => process.send({ type: "step", step: text }, resolve));

if (await tryLock(db, name)) {
  await step(`watcher ${name} got the lock and is running`);
  // Keep the process alive until the parent kills it. (A timer is needed:
  // SQLite holds no open socket, so Node would otherwise just exit.)
  setInterval(() => {}, 1000);
} else {
  await step(`watcher ${name} found the lock taken and stopped`);
  await db.close();
}
