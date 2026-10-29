# Part 3: one writer at a time

Words like write lock, deferred transaction, busy timeout, `SQLITE_BUSY`, `SQLITE_BUSY_SNAPSHOT` and snapshot are explained in the [challenge README](../README.md#101-words-you-need).

## The idea

SQLite lets only one connection write at a time. So when two watchers want to write, one must wait. That is what the busy timeout is for: the waiting connection keeps trying for up to 5,000 ms.

But there is a trap. A plain `BEGIN` in SQLite is **deferred**: it takes no lock at the start. A watcher that uses it does this:

1. `BEGIN`. No lock yet.
2. Read the next `pending` task. The transaction now has a **snapshot**: a fixed picture of the database at this moment.
3. Write. Only now does it ask for the write lock.

Between steps 2 and 3, another watcher can write and commit. Then the picture is out of date. If SQLite let this watcher write on top of it, it could overwrite the other watcher's change without knowing. So SQLite refuses at once with error 517 (`SQLITE_BUSY_SNAPSHOT`), and the message reads "database is locked".

Waiting cannot help here. The picture stays old however long you wait, so SQLite does not wait. The busy timeout does not matter. In the trap run below, the error comes after **0 ms**, with a 5,000 ms timeout.

`BEGIN IMMEDIATE` avoids the trap. It asks for the write lock in step 1, before the read. If another writer holds it, the busy timeout works as you expect: the watcher waits, gets the lock, and then reads. Nothing can change between its read and its write.

PostgreSQL has no such trap in its default mode. Each statement looks at the latest committed data. B's checked `UPDATE` finds that the row is no longer `pending`, changes 0 rows, and gives no error.

## What the script does

[`writers.js`](writers.js) has two experiments.

**Experiment 1: the trap, one step at a time.**

| Step | What happens | Where |
| --- | --- | --- |
| 1 | Make a fresh database with 1 task. | [writers.js#L23-L25](writers.js#L23-L25) |
| 2 | Open two connections, A and B, each with a 5,000 ms busy timeout. | [writers.js#L26-L27](writers.js#L26-L27) |
| 3 | Both run a plain `BEGIN`. | [writers.js#L31-L34](writers.js#L31-L34) |
| 4 | Both read task 1: both see `pending`. | [writers.js#L35-L36](writers.js#L35-L36) |
| 5 | A claims task 1 and commits. | [writers.js#L37-L39](writers.js#L37-L39) |
| 6 | B tries the same checked claim. Measure how long it takes and what comes back. | [writers.js#L40-L47](writers.js#L40-L47) |

The claim is a checked `UPDATE`, written once in [writers.js#L19](writers.js#L19): `... WHERE id = 1 AND status = 'pending'`.

**Experiment 2: four writers.**

| Step | What happens | Where |
| --- | --- | --- |
| 1 | Make a fresh database with 100 tasks. | [writers.js#L56-L58](writers.js#L56-L58) |
| 2 | Start 4 writer processes in `writes` mode, with the `begin` text and the busy timeout to test. | [writers.js#L59-L62](writers.js#L59-L62) |
| 3 | Each writer repeats: `begin`, read the next task, wait 2 ms, checked `UPDATE`, insert the session, `COMMIT`. | [lock-worker.js#L143-L157](../lock-worker.js#L143-L157) |
| 4 | If anything fails, count the error by its code, roll back and try again. | [lock-worker.js#L158-L168](../lock-worker.js#L158-L168) |
| 5 | Add the errors of all writers, count sessions and doubles. | [writers.js#L63-L71](writers.js#L63-L71) |
| 6 | Run the five settings: SQLite `BEGIN` with timeout 0 and 5000, SQLite `BEGIN IMMEDIATE` with timeout 0 and 5000, and PostgreSQL. | [writers.js#L97-L111](writers.js#L97-L111) |

## Where each number comes from

| Number | Meaning | Where |
| --- | --- | --- |
| trap step results | What each step returned. `1 row changed` is `db.run` returning the row count. | [writers.js#L29-L37](writers.js#L29-L37) |
| `after N ms` | Time from just after A's `COMMIT` until B's `UPDATE` answered. | [writers.js#L40](writers.js#L40), [L47](writers.js#L47) |
| `error 517: ...` | The error code and text, as SQLite sends them. | [writers.js#L45](writers.js#L45) |
| `failed transactions` | All errors of all four writers added up. | [writers.js#L70](writers.js#L70) |
| `errors` | How many of each kind: `count x code: text`. | [lock-worker.js#L161-L162](../lock-worker.js#L161-L162), [writers.js#L108](writers.js#L108) |
| `total (ms)` | Wall time of the run. It includes starting the four processes. | [writers.js#L60](writers.js#L60), [L63](writers.js#L63) |
| `sessions`, `tasks with two sessions` | At the end: 100 and 0 are the goal. | [writers.js#L67-L68](writers.js#L67-L68) |

## The results

Recorded 2026-10-29 08:57 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

### The deferred trap, step by step

Both connections have a 5,000 ms busy timeout. Watch how long B's claim takes to fail.

| step | watcher | action | sqlite | postgres |
| --- | --- | --- | --- | --- |
| 1 | A | BEGIN | ok | ok |
| 2 | B | BEGIN | ok | ok |
| 3 | A | reads task 1 | pending | pending |
| 4 | B | reads task 1 | pending | pending |
| 5 | A | claims task 1 | 1 row changed | 1 row changed |
| 6 | A | COMMIT | ok | ok |
| 7 | B | claims task 1 | error 517: database is locked (after 0 ms) | 0 rows changed, no error (after 1 ms) |

### Four writers

Four processes claim 100 tasks. Each claim is one transaction: read the next pending task, wait 2 ms, update it, insert a session, commit. A failed transaction is rolled back and tried again.

| database | begin | busy timeout (ms) | sessions | tasks with two sessions | failed transactions | total (ms) | errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | BEGIN | 0 | 100 | 0 | 222 | 2231 | 178 x 5: database is locked; 44 x 517: database is locked |
| sqlite | BEGIN | 5000 | 100 | 0 | 225 | 2239 | 171 x 5: database is locked; 54 x 517: database is locked |
| sqlite | BEGIN IMMEDIATE | 0 | 100 | 0 | 324 | 1771 | 324 x 5: database is locked |
| sqlite | BEGIN IMMEDIATE | 5000 | 100 | 0 | 0 | 1984 | none |
| postgres | BEGIN | none | 100 | 0 | 0 | 1786 | none |

How to read it:

- **Step 7.** SQLite gives error 517 after 0 ms, though the busy timeout is 5,000 ms. PostgreSQL changes 0 rows and gives no error. Both outcomes are safe: B did not claim task 1. They differ in how B finds out: with an error, or with a row count of 0.
- **Plain `BEGIN`, timeout 0: 222 failures.** 178 are error 5 (another writer holds the lock now) and 44 are error 517 (the snapshot is out of date).
- **Plain `BEGIN`, timeout 5,000: 225 failures.** About the same. A long timeout did not help: a transaction that has already read does not wait for the write lock, because waiting would not make its snapshot fresh.
- **`BEGIN IMMEDIATE`, timeout 0: 324 failures.** All error 5, and all at `BEGIN`, where the lock is requested. With no waiting allowed, any busy moment is a failure.
- **`BEGIN IMMEDIATE`, timeout 5,000: 0 failures.** Writers keep retrying until they get the lock, and every claim succeeds. This took 1,984 ms, close to PostgreSQL (1,786 ms).
- **No doubles anywhere.** The column `tasks with two sessions` is 0 in every row, and sessions are 100. Every claim was a checked `UPDATE` (challenge 1), and the code adds a session only if exactly one row changed ([lock-worker.js#L151-L155](../lock-worker.js#L151-L155)). The errors cost time, not correctness.

The rule: in SQLite, a transaction that will write should start with `BEGIN IMMEDIATE`, and every connection needs a busy timeout. You need both.

## The chart

![Part 3 chart: failed transactions while 4 writers claim 100 tasks](chart.svg)

Look at the red bars on the plain `BEGIN` rows and the `BEGIN IMMEDIATE`, timeout 0 row. Only two rows stay at 0: `BEGIN IMMEDIATE` with timeout 5000, and PostgreSQL.

## What the test checks

[`writers.test.js`](writers.test.js) has four tests:

- On SQLite, B's last step is an error that starts with `error 517: database is locked` ([L10-L13](writers.test.js#L10-L13)).
- On PostgreSQL, B's last step starts with `0 rows changed, no error` ([L15-L18](writers.test.js#L15-L18)). Skipped if PostgreSQL is not running.
- On SQLite, plain `BEGIN` with a 5,000 ms timeout and 40 tasks has some failures, and still no doubles ([L20-L24](writers.test.js#L20-L24)).
- On SQLite, `BEGIN IMMEDIATE` with a 5,000 ms timeout and 40 tasks has 0 failures and 40 sessions ([L26-L30](writers.test.js#L26-L30)).

## Try this

Each change is in [`writers.js`](writers.js). Running the script rewrites `results.md` and `chart.svg`, so save a copy first.

1. **A much longer timeout.** In the plan list change the plain `BEGIN` timeout `5000` to `30000` ([L98](writers.js#L98)). Expect about the same number of failures as before (225 here; it varies). The timeout does not change what a transaction that has already read does.
2. **A very short timeout.** Change the `BEGIN IMMEDIATE` timeout `5000` to `1` ([L99](writers.js#L99)). Each transaction holds the write lock for at least the 2 ms pause, so waiting only 1 ms is not enough. Expect failures to come back, all with error 5. The count will differ from run to run.
