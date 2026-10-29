# Part 2: skip locked

Words like lock, `FOR UPDATE`, `SKIP LOCKED`, busy handler and `BEGIN IMMEDIATE` are explained in the [challenge README](../README.md#101-words-you-need).

## The idea

Part 1 showed that a watcher waits when it asks for a lock someone else holds. One watcher is fine. But a real queue has many workers, so the waiting adds up.

Here is the test. Four workers drain a queue of 100 tasks. Each task needs about 20 ms of work. A timer on Windows rounds that up to about 30 ms. One worker alone needs 3.1 seconds on SQLite (3,107 ms), 5.1 seconds on PostgreSQL (5,138 ms) and 5.5 seconds on MySQL (5,476 ms). Each database has its own speed, and the numbers change from run to run, so always compare rows of the same database. If four workers truly share the work, the queue should be done in about a quarter of the time of one worker alone.

The question is **when the lock is held**. There are two choices:

- **Hold the lock during the work.** Lock the task, do the 20 ms of work, then commit. While you work, nobody else can lock the same thing. On PostgreSQL and MySQL, all four workers aim for the same next `pending` row, so three of them wait. The work is done one task at a time, so four workers do little better than one.
- **Hold the lock only to claim.** Mark the task `claimed`, commit, and then work with no lock. The lock lasts for a few milliseconds, not 20.

PostgreSQL and MySQL have a third choice. `FOR UPDATE SKIP LOCKED` locks the next `pending` row that nobody else holds, and skips the rows that are locked. The worker never waits. Four workers take four different rows at the same time.

SQLite has no `SKIP LOCKED`. Its lock covers the whole file, so there are no free rows to skip to.

## The ways at a glance

| Way | Database | Lock held during the 20 ms of work? | What the other three workers do |
| --- | --- | --- | --- |
| `for update` | PostgreSQL and MySQL | Yes, on one row | Wait for the row. |
| `skip locked` | PostgreSQL and MySQL | Yes, on one row | Take another row at once. |
| `begin immediate` | SQLite | Yes, on the whole file | Sleep in the busy handler. |
| `short claim` | All three | No, only for the claim | Wait a few ms for the claim, then work at the same time. |

Count the cost for `for update` on PostgreSQL. Each task takes about 41 ms from lock to commit (4,069 ms for 100 tasks). While worker A holds task 1, workers B, C and D can only wait. When A commits, one of them takes the next task, and the other two keep waiting. The queue moves at about one task per 41 ms, which is not much better than one worker alone (about 51 ms per task). On MySQL it is the same story: 4,743 ms for 100 tasks, against 5,476 ms for one worker alone.

Count the cost for `skip locked`. A takes task 1. B skips it and takes task 2. C takes task 3. D takes task 4. All four work at the same time. In the best case 100 tasks take a quarter of 5,138 ms on PostgreSQL, about 1,284 ms. The measured 1,216 ms is close. On MySQL a quarter of 5,476 ms is about 1,369 ms, and the measured 1,557 ms is close too.

### The short claim on MySQL

The `short claim` claims the next task and creates its session in one short transaction. PostgreSQL and SQLite claim with `UPDATE ... RETURNING id`. MySQL has no `RETURNING`. It also refuses an `UPDATE` whose subquery reads the same table (error 1093). So on MySQL the claim is `UPDATE ... SET id = LAST_INSERT_ID(id) ... ORDER BY id LIMIT 1`, followed by `SELECT LAST_INSERT_ID()` to read the claimed id ([lock-worker.js#L94-L101](../lock-worker.js#L94-L101)).

## What the script does

[`drain.js`](drain.js) runs each way of claiming and measures the time.

| Step | What happens | Where |
| --- | --- | --- |
| 1 | List the ways to claim for each database. PostgreSQL and MySQL: `for update`, `skip locked`, `short claim`. SQLite: `begin immediate`, `short claim`. | [drain.js#L19-L23](drain.js#L19-L23) |
| 2 | Make a fresh database with 100 tasks. | [drain.js#L27-L28](drain.js#L27-L28) |
| 3 | Start 4 worker processes in `drain` mode. They share a start time 400 ms ahead. | [drain.js#L29-L33](drain.js#L29-L33) |
| 4 | When they finish, count the sessions and the tasks with two sessions. | [drain.js#L34-L36](drain.js#L34-L36) |
| 5 | Work out the total time and the total waiting. | [drain.js#L38-L39](drain.js#L38-L39) |
| 6 | First run one worker alone as the time to beat, then each strategy with 4 workers. | [drain.js#L65-L68](drain.js#L65-L68) |
| 7 | Write `results.md`, then draw the chart. | [drain.js#L77-L86](drain.js#L77-L86) |

What a worker does for each strategy, in [`lock-worker.js`](../lock-worker.js):

| Strategy | What the worker does | Where |
| --- | --- | --- |
| `for update` | `BEGIN`, then lock the next `pending` row with `FOR UPDATE`. If another worker holds it, wait. | [lock-worker.js#L61-L65](../lock-worker.js#L61-L65) |
| `skip locked` | `BEGIN`, then `FOR UPDATE SKIP LOCKED`. Take the next row nobody holds. Never wait. | [lock-worker.js#L67-L76](../lock-worker.js#L67-L76) |
| `begin immediate` | SQLite. `BEGIN IMMEDIATE`, then pick the next task. | [lock-worker.js#L77-L82](../lock-worker.js#L77-L82) |
| the three above, then | Claim the task, do the work **while holding the lock**, then `COMMIT`. | [lock-worker.js#L147-L150](../lock-worker.js#L147-L150) |
| `short claim`, SQLite and PostgreSQL | One short transaction: `UPDATE` the next `pending` task with `RETURNING id`, insert the session, `COMMIT`. The work comes after the commit. | [lock-worker.js#L85-L114](../lock-worker.js#L85-L114) |
| `short claim`, MySQL | The same, but the `UPDATE` uses `LAST_INSERT_ID(id)` and the id is read with `SELECT LAST_INSERT_ID()`. | [lock-worker.js#L94-L101](../lock-worker.js#L94-L101) |
| `short claim`, no row back | If the `UPDATE` claimed no row, commit and count the `pending` tasks. If some are left, try again. If none are left, stop. | [lock-worker.js#L110-L112](../lock-worker.js#L110-L112) and [L127-L131](../lock-worker.js#L127-L131) |

## Where each number comes from

| Column | Meaning | Where |
| --- | --- | --- |
| `workers` | How many worker processes. | [drain.js#L25](drain.js#L25) |
| `tasks`, `sessions` | Tasks put in, and sessions found at the end. They must match. | [drain.js#L25](drain.js#L25), [drain.js#L35](drain.js#L35) |
| `tasks with two sessions` | Doubles. Must be 0. | [drain.js#L36](drain.js#L36), [toolkit/db.js#L229-L234](../../../toolkit/db.js#L229-L234) |
| `total (ms)` | From the first worker's start to the last worker's finish. | [drain.js#L38](drain.js#L38) |
| `waiting (ms)` | The sum over all workers of the time spent getting a lock. For the three lock-holding strategies this is the time until the row or file lock is won. For `short claim` it is the whole short transaction. | [drain.js#L39](drain.js#L39), [lock-worker.js#L136-L138](../lock-worker.js#L136-L138), [L124-L126](../lock-worker.js#L124-L126) |
| `claimed per worker` | How many tasks each worker A, B, C, D claimed. | [lock-worker.js#L132](../lock-worker.js#L132), [L150](../lock-worker.js#L150), [drain.js#L40](drain.js#L40) |

The waiting of one worker alone (369 ms on SQLite, 2,212 ms on PostgreSQL, 2,706 ms on MySQL) is not real waiting. It is the time of its own transactions. Compare other rows with it.

## The results

Recorded 2026-10-29 12:50 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

### Draining 100 tasks with 4 workers

Worker processes start together. Each task takes 20 ms of work (a timer, so on Windows it often takes closer to 30 ms). "for update", "skip locked" and "begin immediate" hold the lock during the work; "short claim" commits the claim first and works with no lock held. The first row of each database is one worker alone, the time to beat.

| database | claim | workers | tasks | sessions | tasks with two sessions | total (ms) | waiting (ms) | claimed per worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | one worker alone | 1 | 100 | 100 | 0 | 3107 | 369 | 100 |
| sqlite | begin immediate | 4 | 100 | 100 | 0 | 3379 | 9694 | 100 / 0 / 0 / 0 |
| sqlite | short claim | 4 | 100 | 100 | 0 | 1584 | 3494 | 25 / 23 / 27 / 25 |
| postgres | one worker alone | 1 | 100 | 100 | 0 | 5138 | 2212 | 100 |
| postgres | for update | 4 | 100 | 100 | 0 | 4069 | 12070 | 24 / 34 / 6 / 36 |
| postgres | skip locked | 4 | 100 | 100 | 0 | 1216 | 493 | 26 / 25 / 25 / 24 |
| postgres | short claim | 4 | 100 | 100 | 0 | 1598 | 2991 | 28 / 19 / 27 / 26 |
| mysql | one worker alone | 1 | 100 | 100 | 0 | 5476 | 2706 | 100 |
| mysql | for update | 4 | 100 | 100 | 0 | 4743 | 14184 | 25 / 25 / 25 / 25 |
| mysql | skip locked | 4 | 100 | 100 | 0 | 1557 | 588 | 26 / 24 / 25 / 25 |
| mysql | short claim | 4 | 100 | 100 | 0 | 2415 | 6801 | 25 / 25 / 25 / 25 |

How to read it:

- **PostgreSQL `for update`: 4,069 ms.** One worker alone took 5,138 ms. Four workers gave only a small gain (about 1.3 times faster). The waiting adds up to 12,070 ms, which is about 3 workers times 4 seconds: three workers were waiting almost all the time.
- **MySQL `for update`: 4,743 ms.** One worker alone took 5,476 ms, so the gain is about 1.2 times. The waiting adds up to 14,184 ms, about 3 workers times 4.7 seconds. The 100 tasks were shared evenly, 25 for each worker.
- **PostgreSQL `skip locked`: 1,216 ms.** About 4.2 times faster than one worker (5,138 / 1,216). Little waiting (493 ms). The tasks spread evenly: 26, 25, 25, 24.
- **MySQL `skip locked`: 1,557 ms.** About 3.5 times faster than one worker (5,476 / 1,557). Little waiting (588 ms). The tasks spread evenly: 26, 24, 25, 25.
- **PostgreSQL `short claim`: 1,598 ms.** Fast, about 3.2 times faster than one worker. The waiting is higher than `skip locked` (2,991 ms) because this number counts the whole claim transaction, and two workers can pick the same row, so one must wait for the other.
- **MySQL `short claim`: 2,415 ms.** About 2.3 times faster than one worker. The waiting is 6,801 ms, for the same reason as on PostgreSQL, and higher than the 2,991 ms there in this run.
- **SQLite `begin immediate`: 3,379 ms.** Slower than one worker (3,107 ms). Worker A claimed all 100 tasks. B, C and D claimed 0. The 9,694 ms of waiting is about 3 workers times 3.2 seconds.
- **SQLite `short claim`: 1,584 ms.** About twice as fast as one worker (3,107 / 1,584). It cannot reach 4 times, because every claim still needs the one write lock.
- **No doubles in any row.** The column `tasks with two sessions` is 0 everywhere. In the lock-holding strategies the lock prevents doubles. In `short claim` a checked `UPDATE` does, as in challenge 1.

Why did one SQLite worker take everything? When A commits, it goes straight back to `BEGIN IMMEDIATE` and gets the lock again. The other three are asleep inside the busy handler, which tries again on a timer. The lock is free for only a moment, and A is awake. The busy handler is not a line of people, so a waiting worker has no turn coming. The run finished in 3.4 seconds, under the busy timeout of 5,000 ms. A longer run would have made the sleeping workers give up with "database is locked".

## The chart

![Part 2 chart: time to drain 100 tasks with 4 workers](chart.svg)

Look at the red total-time bar (`sqlite: begin immediate`): it is taller than the grey "one worker alone" bar of its database. The `for update` bars on PostgreSQL and MySQL are green but only a little shorter than the grey ones. The `skip locked` bars are much shorter. The amber bars show the waiting.

## What the test checks

[`drain.test.js`](drain.test.js) uses 40 tasks to stay quick.

- For every strategy on every database, the queue is drained with no doubles, and the number of sessions equals the number of tasks ([L8-L17](drain.test.js#L8-L17)).
- On PostgreSQL and on MySQL, the time `skip locked` spends waiting for locks is less than a third of the time `for update` spends ([L19-L27](drain.test.js#L19-L27)). The test compares waiting, not total time, because total time depends on the machine.

The tests of a database that is not running are skipped.

## Your turn

In the template you start from, the lines between `// YOUR TURN` and `// END YOUR TURN` hold starter code instead of the solution. Part 2 has two such places in `lock-worker.js`: the `skip locked` strategy and the function `shortClaim`. Chapter 3.7 walks you through both. The test `postgres: skip locked is faster than for update` in `drain.test.js` turns green when the first one is right (on MySQL the same test starts with `mysql:`), and `sqlite: short claim claims every task once` turns green when the second one is right. For MySQL, `shortClaim` needs the `LAST_INSERT_ID(id)` form, because MySQL has no `RETURNING`.

## Try this

Each change is in [`drain.js`](drain.js). Running the script rewrites `results.md` and `chart.svg`, so save a copy first.

1. **No work.** Change `workMs = 20` to `workMs = 0` ([L25](drain.js#L25)). The lock is now held for almost no time even in `for update`. Expect the gap between `for update` and `skip locked` to become much smaller, and every total time to drop. The numbers will differ from the table, because the table is for 20 ms of work.
2. **More workers.** In the plan list change `[s, 4]` to `[s, 8]` ([L66](drain.js#L66)). In the `skip locked` rows, `claimed per worker` should now show 8 numbers of about 12 each (100 tasks / 8 workers). In the `for update` rows, expect the total to stay close to one worker alone, as in the table above, and the waiting to grow, because 7 workers now wait.
