# Part 1: wait your turn

Words like lock, row lock, write lock and `BEGIN IMMEDIATE` are explained in the [challenge README](../README.md#101-words-you-need).

## The idea

A claim has three steps: read the task, see that it is `pending`, write `claimed`. The bug from challenge 1 lives between the read and the write. Another watcher can read the same `pending` in that gap.

A lock closes the gap. The watcher asks for the lock first. Only then does it read. If another watcher holds the lock, the new one **waits**. When the lock is free, the new watcher reads again, and now it sees the truth: the task is `claimed`, so it skips it.

The two databases lock different amounts:

- **PostgreSQL** locks one row. `SELECT ... FOR UPDATE` locks only the row the `SELECT` returns. A watcher that wants a different task does not wait.
- **SQLite** has no row locks. It answers `FOR UPDATE` with a syntax error. The only way to lock before reading is `BEGIN IMMEDIATE`. It takes the one write lock for the whole database file. A watcher that wants a different task still waits.

The error text from this run:

```
near "FOR": syntax error
```

## What to expect before you run it

Make four predictions from the idea above, then check them against the results table.

| Database | B wants | Does B wait for A? | Why |
| --- | --- | --- | --- |
| PostgreSQL | same task | Yes | Both want the same row lock. |
| PostgreSQL | different task | No | Different rows have different locks. |
| SQLite | same task | Yes | One write lock for the file. |
| SQLite | different task | Yes | The same one write lock. |

There is a fifth thing to look for. When B waits and then gets the lock, it must **read again**. The status it sees is not the status from 300 ms ago. In the same-task rows, the `saw` column for B says `claimed`, and B skips. That is the point of locking first: the read happens after the lock, so the read is true.

## What the script does

[`wait.js`](wait.js) runs the same race four times: two databases, and two cases (B wants the same task as A, or a different one).

| Step | What happens | Where |
| --- | --- | --- |
| 1 | Send `SELECT ... FOR UPDATE` to SQLite and keep its error text. | [wait.js#L20-L30](wait.js#L20-L30) |
| 2 | Make a fresh database with 2 tasks. | [wait.js#L35-L36](wait.js#L35-L36) |
| 3 | Set the start time 400 ms ahead, so both processes can connect first. | [wait.js#L37](wait.js#L37) |
| 4 | Start watcher A (task 1, at 0 ms) and watcher B (its task, at 50 ms). A holds for `HOLD_MS` = 300 ms. | [wait.js#L38-L42](wait.js#L38-L42) |
| 5 | Count the sessions that exist at the end, and work out how long B waited. | [wait.js#L43-L46](wait.js#L43-L46) |
| 6 | Run the race for each database and for each case, and collect the rows. | [wait.js#L77-L88](wait.js#L77-L88) |
| 7 | Write `results.md`, then draw the chart. | [wait.js#L90-L104](wait.js#L90-L104) |

Inside each watcher, the `hold` mode of [`lock-worker.js`](../lock-worker.js#L35-L48) does this:

| Step | What happens | Where |
| --- | --- | --- |
| a | Sleep until its start time. | [lock-worker.js#L36](../lock-worker.js#L36) |
| b | Note the time (`asked`), then ask for the lock. | [lock-worker.js#L37-L38](../lock-worker.js#L37-L38) |
| c | Note the time again (`got`). The gap is the wait. | [lock-worker.js#L39](../lock-worker.js#L39) |
| d | If the status it read is `pending`: keep the lock for 300 ms, then claim. | [lock-worker.js#L41-L45](../lock-worker.js#L41-L45) |
| e | `COMMIT` releases the lock. Report the times. | [lock-worker.js#L46-L47](../lock-worker.js#L46-L47) |

## Where each number comes from

| Number | Meaning | Where |
| --- | --- | --- |
| `asked (ms)` | Time (ms after the start) when the watcher asked for the lock. | [lock-worker.js#L37](../lock-worker.js#L37) |
| `got lock (ms)` | Time when the lock was its own. | [lock-worker.js#L39](../lock-worker.js#L39) |
| `done (ms)` | Time after `COMMIT`. | [lock-worker.js#L47](../lock-worker.js#L47) |
| `saw` | The task status the watcher read once it had the lock. | [lock-worker.js#L24](../lock-worker.js#L24), [L27](../lock-worker.js#L27) |
| `action` | `claimed it` if `saw` was `pending`, else `skipped: already claimed`. | [lock-worker.js#L40-L45](../lock-worker.js#L40-L45) |
| B's wait | `got lock` minus `asked` for B. Not a column: you compute it. | [wait.js#L46](wait.js#L46) |

A starts at 0 ms, but its `asked` is 10 to 13 ms. Waking up from a timer and connecting is not instant.

## The results

Recorded 2026-10-29 08:54 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

### SQLite has no FOR UPDATE

The same SELECT ... FOR UPDATE that PostgreSQL accepts, sent to SQLite:

| database | answer |
| --- | --- |
| sqlite | near "FOR": syntax error |

### Who waited

A locks task 1 at 0 ms and keeps the lock for 300 ms. B asks for a lock at 50 ms. PostgreSQL uses SELECT ... FOR UPDATE on one row; SQLite uses BEGIN IMMEDIATE, its only way to lock before reading. Times are ms after the start.

| database | scenario | watcher | task | asked (ms) | got lock (ms) | done (ms) | saw | action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | same task | A | 1 | 13 | 14 | 324 | pending | claimed it |
| sqlite | same task | B | 1 | 60 | 381 | 381 | claimed | skipped: already claimed |
| sqlite | different task | A | 1 | 11 | 11 | 322 | pending | claimed it |
| sqlite | different task | B | 2 | 58 | 334 | 648 | pending | claimed it |
| postgres | same task | A | 1 | 11 | 21 | 346 | pending | claimed it |
| postgres | same task | B | 1 | 58 | 347 | 351 | claimed | skipped: already claimed |
| postgres | different task | A | 1 | 10 | 15 | 334 | pending | claimed it |
| postgres | different task | B | 2 | 56 | 61 | 375 | pending | claimed it |

How to read it. B's wait is `got lock` minus `asked`:

| database | B wants | B waited |
| --- | --- | --- |
| postgres | same task | 289 ms (58 to 347) |
| postgres | different task | 5 ms (56 to 61) |
| sqlite | same task | 321 ms (60 to 381) |
| sqlite | different task | 276 ms (58 to 334) |

- PostgreSQL, same task: B waits until A commits at 346 ms. B gets the lock at 347 ms, reads `claimed`, and skips. One session exists at the end.
- PostgreSQL, different task: B waits 5 ms. The two watchers lock two different rows. Both claim, and their work overlaps.
- SQLite, both cases: B waits for A, even for task 2. A holds the write lock for the whole file. In the different-task case B starts its own 300 ms of work only at 334 ms and ends at 648 ms. The two jobs run one after the other.
- SQLite wakes B late. A is done at 324 ms, but B gets the lock at 381 ms. The busy handler sleeps between tries. PostgreSQL woke B 1 ms after A committed (346 to 347).

## The chart

![Part 1 chart: A holds a lock for 300 ms. Does B wait?](chart.svg)

Look at the amber "waits" bars on the B lanes: long on SQLite for both tasks, long on PostgreSQL only for the same task, almost gone for a different task.

## What the test checks

[`wait.test.js`](wait.test.js) has three tests:

- SQLite answers `FOR UPDATE` with a message that matches `syntax error` ([L11-L13](wait.test.js#L11-L13)).
- On SQLite, B waits at least 200 ms for the same task and for a different task. After the same-task wait, B skips. Two sessions exist after the different-task run ([L15-L22](wait.test.js#L15-L22)).
- On PostgreSQL, B waits at least 200 ms for the same task and sees `claimed`, with one session. For a different task, B waits less than 100 ms, and two sessions exist ([L24-L32](wait.test.js#L24-L32)). This test is skipped if PostgreSQL is not running.

## Try this

Each change is in [`wait.js`](wait.js). Running the script rewrites `results.md` and `chart.svg`, so save a copy first. Change the code back afterwards, because the test needs the original values.

1. **Hold longer.** Change `HOLD_MS` to `600` ([L17](wait.js#L17)). A now commits at about 650 ms. Expect B's wait to grow by about 300 ms wherever it waited before: same task on both databases, and different task on SQLite. Expect PostgreSQL with a different task to stay at a few ms, because its rows do not touch.
2. **Ask later.** Change B's `startAt: 50` to `startAt: 500` ([L41](wait.js#L41)). A is finished at about 350 ms, so B finds no lock. Expect B's wait to be a few ms in all four cases. In the same-task case B still reads `claimed` and skips, because A's commit is already visible.
