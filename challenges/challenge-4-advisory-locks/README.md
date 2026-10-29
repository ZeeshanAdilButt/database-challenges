# Challenge 4: advisory locks and leases

In challenges 1 to 3 the question was: two watchers are running, how do we stop them from claiming the same task? This challenge asks an earlier question: **how do we stop the second watcher from running at all?** And a harder one: what happens to a lock, or to a task, when the watcher that owned it dies?

## Why this matters

Think of a desktop app that keeps its tasks in a database. The app has one rule: **only one watcher may run**. Two watchers would claim the same tasks and make double sessions.

The rule is easy to break by accident. A user double-clicks the app icon. A restart script starts a new watcher while the old one is still alive. A crash restarts the app, and the old copy was not really dead.

So a watcher asks for a lock called `watcher` when it starts. If it gets the lock, it runs. If the lock is taken, it knows another copy is running, and it stops.

Now the hard part. What if the watcher that holds the lock **dies**? The power goes off. The user ends the task in the task manager. The operating system kills it. A dead watcher cannot say "I am done, here is the lock". If the lock stays taken, the app can never start again. That is a **stale lock**.

Whether the lock is freed or not depends on **where the lock lives**. A lock that belongs to the database connection is freed when the connection ends. A lock that is only a row in a table is just data, and data stays.

There is a second problem. A watcher can be **stuck** and not dead: the computer slept, or the process paused for a few seconds. You cannot tell the difference from outside. If you give its task to another watcher, the stuck one may wake up and write over the new owner's work. This challenge shows the fix: a **lease** that runs out, a **renew** that keeps it alive, and a **fencing token** that stops the old owner.

The story: the same task queue. The tables are `tasks`, `sessions` and `events` (see [`toolkit/db.js`](../../toolkit/db.js)). This challenge runs on three databases: SQLite, PostgreSQL 17 and MySQL 8.4.

## 101: words you need

| Word | Meaning |
|---|---|
| connection | One "person" talking to the database. Two connections can be in the middle of two different things. A connection is also called a **session**. |
| advisory lock | A lock on a **name** that your programs agree to ask for. It locks no row and no table. The database keeps it for you, but it does not force anyone to ask. A program that never asks is not stopped. PostgreSQL and MySQL have advisory locks. SQLite does not. |
| lock name or key | What the lock is called. PostgreSQL takes a number (`2026` here). MySQL takes text (`watcher`). Every program that wants the same lock must use the same one. |
| holder | The connection (or program) that has the lock right now. |
| session lock | An advisory lock that belongs to the connection. It stays until you unlock it or the connection ends. `COMMIT` and `ROLLBACK` do not free it. PostgreSQL: `pg_advisory_lock`. MySQL: `GET_LOCK`. |
| transaction lock | An advisory lock that belongs to the transaction. It is freed by itself at `COMMIT` or `ROLLBACK`, and there is no unlock call. PostgreSQL: `pg_advisory_xact_lock`. MySQL has none. |
| SIGKILL | The hardest way to end a process. The operating system stops it at once. The program gets no chance to clean up or to unlock. It behaves like a crash or a power cut. (On Windows, Node.js ends the process in the same forced way.) |
| stale lock | A lock that is still shown as taken, but its owner is dead. Nobody can use it. |
| lease | A claim that **runs out**. The owner has the task until a time written in the database. After that time, anyone may take it. |
| expiry | The time when a lease ends. This challenge stores it in the column `lease_until`, in milliseconds (ms). |
| renew, heartbeat | The owner extends its lease again and again while it is alive. A renew sent on a regular beat is called a heartbeat. If the owner dies or gets stuck, the renews stop, and the lease runs out. |
| fencing token | A number that goes up by 1 every time a new owner takes the task. Every write carries the number the owner got. The database refuses a write with an old number. This challenge stores it in `lease_token`. |

## How to run

You need Node.js 22.13 or newer. PostgreSQL and MySQL run in Docker. SQLite is built into Node.js and needs nothing.

```
npm install
npm run db:up
npm run doctor
node challenges/challenge-4-advisory-locks/part-1-one-watcher-only/single.js
node challenges/challenge-4-advisory-locks/part-2-what-a-lock-covers/scope.js
node challenges/challenge-4-advisory-locks/part-3-lease-with-expiry/lease.js
npm test
```

- `npm run db:up` starts PostgreSQL on port 5440 and MySQL on port 5441. Stop them later with `npm run db:down`. MySQL takes about 30 seconds to start the first time.
- `npm run doctor` should show five OK lines. If MySQL is not ready yet, wait a little and run it again.
- Use `DATABASE_URL` for another PostgreSQL and `MYSQL_URL` for another MySQL.
- Start all three databases before you run a part. A script writes columns only for the databases that are running, so its tables look like the ones in this challenge only when all three are up.
- Without Docker, each script runs only the SQLite half and says so. Then the lock questions about PostgreSQL and MySQL stay unanswered, so start Docker if you can.
- Each script rewrites its own `results.md`. Parts 1 and 3 also rewrite `chart.svg`. Add `--chart` to redraw only the chart from the existing `results.md`. Part 2 has no chart: its result is two tables.
- Part 1 starts real watcher processes and kills one, so give it a few seconds. Part 3 does not wait at all: the time is passed in by the script.
- `npm test` runs every test file, one at a time. Tests skip the PostgreSQL or MySQL half if it is not running.
- Some numbers change from run to run (for example `connection 3087` in part 1 is a number the server picks). The yes and no answers do not change.

## `lock.js`: one named lock, three databases

[`lock.js`](lock.js) is used by parts 1 and 2. It is the same lock in three forms. Part 3 does not use it: a lease is built from plain columns.

| Step | What happens | Where |
|---|---|---|
| 1 | Pick the lock's name. PostgreSQL needs a number: `WATCHER_KEY` is 2026. MySQL and SQLite use the text `WATCHER_NAME`, which is `watcher`. | [L11-L13](lock.js#L11-L13) |
| 2 | SQLite only. SQLite has no advisory lock, so a table plays the part. `name` is the `PRIMARY KEY`, so a second row with the same name is refused. | [L15-L21](lock.js#L15-L21) |
| 3 | `tryLock` on PostgreSQL: `pg_try_advisory_lock(2026)` answers true or false at once. It never waits. | [L25-L28](lock.js#L29-L32) |
| 4 | `tryLock` on MySQL: `GET_LOCK('watcher', 0)`. The 0 means "wait 0 seconds". It answers 1 (you have it), 0 (someone else has it) or NULL (an error). Only 1 counts as a yes. | [L29-L33](lock.js#L33-L38) |
| 5 | `tryLock` on SQLite: `INSERT` a row with the name and the owner. If the error says `UNIQUE constraint failed`, someone has the row, so the answer is false. Any other error is thrown. | [L34-L40](lock.js#L40-L46) |
| 6 | `unlock` on PostgreSQL: `pg_advisory_unlock(2026)`. | [L45-L48](lock.js#L51-L54) |
| 7 | `unlock` on MySQL: `RELEASE_LOCK('watcher')`. | [L49-L52](lock.js#L55-L58) |
| 8 | `unlock` on SQLite: `DELETE` the row, but only if the name and the owner both match. One row deleted means true. | [L53](lock.js#L59) |
| 9 | `holder` on PostgreSQL: look in the `pg_locks` view for an advisory lock with our key, and report the connection number (`pid`). | [L58-L64](lock.js#L64-L70) |
| 10 | `holder` on MySQL: `IS_USED_LOCK('watcher')` gives the connection number of the holder, or NULL. | [L65-L68](lock.js#L71-L74) |
| 11 | `holder` on SQLite: read the `owner` column of the row. | [L69-L70](lock.js#L75-L76) |

SQLite uses file locks inside itself. You cannot call them from SQL, so they are not an advisory lock for your programs.

### `lock-holder.js`: the watcher process

[`lock-holder.js`](lock-holder.js) is a tiny watcher. Part 1 starts copies of it as separate processes.

| Step | What happens | Where |
|---|---|---|
| 1 | Read the options (`kind`, `dbName`, `name`) and open a connection. | [L9-L10](lock-holder.js#L9-L10) |
| 2 | Try to take the lock. | [L13](lock-holder.js#L13) |
| 3 | Got it: report "got the lock and is running", then stay alive until the parent kills it. | [L14-L17](lock-holder.js#L14-L17) |
| 4 | Did not get it: report "found the lock taken and stopped", close the connection and end. | [L18-L21](lock-holder.js#L18-L21) |

## The three parts

### Part 1: one watcher only

Watcher A takes the lock. Watcher B starts while A runs and is turned away. Then A is killed with SIGKILL and watcher C starts. On PostgreSQL and MySQL, C gets the lock, because the database freed it when A's connection ended. On SQLite, the lock row still says A, so C is turned away: a stale lock. Details: [part-1-one-watcher-only/README.md](part-1-one-watcher-only/README.md).

![Part 1: can a new watcher start after the first one is killed](part-1-one-watcher-only/chart.svg)

### Part 2: what a lock covers

Two questions. When is the lock given back: at `ROLLBACK`, at `COMMIT`, or only when you say so? And does the lock stop a program that never asks for it? PostgreSQL's session lock survives both `ROLLBACK` and `COMMIT`, and its transaction lock goes at either. MySQL's `GET_LOCK` survives both, and MySQL has no transaction lock. SQLite's lock row is invisible to others until `COMMIT` and vanishes on `ROLLBACK`. And a plain `UPDATE` from a program that does not ask for the lock changes 1 row on all three. Details: [part-2-what-a-lock-covers/README.md](part-2-what-a-lock-covers/README.md).

This part has no chart. Its result is two tables, in the part's README and in its `results.md`.

### Part 3: a lease with an expiry

A lease is 1,500 ms long. A renews it at 500 ms, then stops. B is refused at 1,000 ms and takes over at 2,100 ms with token 2. Without a fence, late A overwrites B's task. With the fence, A's write changes 0 rows and B finishes. You write the two small pieces that make this work. Details: [part-3-lease-with-expiry/README.md](part-3-lease-with-expiry/README.md).

![Part 3: a lease runs out, B takes over, late A is fenced out](part-3-lease-with-expiry/chart.svg)

## The rules you take away

1. An advisory lock is a promise between your programs. The database does not enforce it. Keep the checked `UPDATE` from challenge 1 anyway.
2. To keep one copy of a program running, use a session lock on PostgreSQL or MySQL. They free it when the connection ends, even after SIGKILL.
3. A lock row in SQLite (or in any table) does not know when its owner dies. It needs a lease with an expiry.
4. Know what your lock is tied to: the connection (session lock) or the transaction (transaction lock). A session lock taken in a transaction is still there after `ROLLBACK`.
5. Work that a dead or stuck owner may leave behind needs three things together: a lease, a renew, and a fencing token checked in every write.
6. Use one clock for leases: the database's own clock, or one machine's. Two machines can disagree about the time.
