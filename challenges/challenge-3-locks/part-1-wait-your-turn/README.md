# Part 1: wait your turn

Words like lock, row lock, write lock and `BEGIN IMMEDIATE` are explained in the [challenge README](../README.md#101-words-you-need).

## The idea

A claim has three steps: read the task, see that it is `pending`, write `claimed`. The bug from challenge 1 lives between the read and the write. Another watcher can read the same `pending` in that gap.

A lock closes the gap. The watcher asks for the lock first. Only then does it read. If another watcher holds the lock, the new one **waits**. When the lock is free, the new watcher reads again, and now it sees the truth: the task is `claimed`, so it skips it.

In this part, watcher A takes the lock first and keeps it for 300 ms. Watcher B asks for a lock right after A holds its own. We then measure how long B waits.

The three databases lock different amounts:

- **PostgreSQL** locks one row. `SELECT ... FOR UPDATE` locks only the row the `SELECT` returns. A watcher that wants a different task does not wait.
- **MySQL** works the same way as PostgreSQL here. It also has `SELECT ... FOR UPDATE`, and it also locks only the row.
- **SQLite** has no row locks. It answers `FOR UPDATE` with a syntax error. The only way to lock before reading is `BEGIN IMMEDIATE`. It takes the one write lock for the whole database file. A watcher that wants a different task still waits.

The error text from this run:

```
near "FOR": syntax error
```

## What to expect before you run it

Make six predictions from the idea above, then check them against the results table.

| Database | B wants | Does B wait for A? | Why |
| --- | --- | --- | --- |
| PostgreSQL | same task | Yes | Both want the same row lock. |
| PostgreSQL | different task | No | Different rows have different locks. |
| MySQL | same task | Yes | Both want the same row lock. |
| MySQL | different task | No | Different rows have different locks. |
| SQLite | same task | Yes | One write lock for the file. |
| SQLite | different task | Yes | The same one write lock. |

B always asks right after A holds its lock. The script makes sure of that, so a busy machine cannot change the order. When B waits, expect a wait close to 300 ms, because that is how long A keeps the lock.

There is one more thing to look for. When B waits and then gets the lock, it must **read again**. The status it sees is not the status from 300 ms ago. In the same-task rows, the `saw` column for B says `claimed`, and B skips. That is the point of locking first: the read happens after the lock, so the read is true.

## What the script does

[`wait.js`](wait.js) runs the same race six times: three databases, and two cases (B wants the same task as A, or a different one).

| Step | What happens | Where |
| --- | --- | --- |
| 1 | Send `SELECT ... FOR UPDATE` to SQLite and keep its error text. | [wait.js#L20-L30](wait.js#L20-L30) |
| 2 | Make a fresh database with 2 tasks. | [wait.js#L37-L38](wait.js#L37-L38) |
| 3 | Note the start time. Start watcher B first (its task is 1 or 2). B connects, reports `ready`, and waits for a go signal. | [wait.js#L39-L42](wait.js#L39-L42) |
| 4 | Start watcher A (task 1) and wait until A reports `locked`. A holds its lock for `HOLD_MS` = 300 ms. | [wait.js#L43-L44](wait.js#L43-L44) |
| 5 | Send B the go signal, so B asks for its lock right after A got its own. Wait until both watchers are done. | [wait.js#L45-L46](wait.js#L45-L46) |
| 6 | Count the sessions that exist at the end. Subtract A's `asked` time from every time, so the table counts ms after A asked. Work out how long B waited. | [wait.js#L47-L53](wait.js#L47-L53) |
| 7 | Run the race for each database and for each case, and collect the rows. | [wait.js#L82-L93](wait.js#L82-L93) |
| 8 | Write `results.md`, then draw the chart. | [wait.js#L95-L110](wait.js#L95-L110) |

Inside each watcher, the `hold` mode of [`lock-worker.js`](../lock-worker.js#L35-L56) does this:

| Step | What happens | Where |
| --- | --- | --- |
| a | If it was told to wait for a go signal (watcher B): report `ready`, then wait for `go`. | [lock-worker.js#L36-L42](../lock-worker.js#L36-L42) |
| b | Note the time (`asked`), then ask for the lock. | [lock-worker.js#L44-L45](../lock-worker.js#L44-L45) |
| c | Note the time again (`got`). The gap is the wait. Report `locked`, so the script can start the next step. | [lock-worker.js#L46-L47](../lock-worker.js#L46-L47) |
| d | If the status it read is `pending`: keep the lock for 300 ms, then claim. | [lock-worker.js#L48-L53](../lock-worker.js#L48-L53) |
| e | `COMMIT` releases the lock. Report the times. | [lock-worker.js#L54-L55](../lock-worker.js#L54-L55) |

## Where each number comes from

| Number | Meaning | Where |
| --- | --- | --- |
| `asked (ms)` | Time when the watcher asked for the lock. The worker counts from the start time. The script then subtracts A's own `asked`, so the table counts ms after A asked. | [lock-worker.js#L44](../lock-worker.js#L44), [wait.js#L52](wait.js#L52) |
| `got lock (ms)` | Time when the lock was its own. | [lock-worker.js#L46](../lock-worker.js#L46) |
| `done (ms)` | Time after `COMMIT`. | [lock-worker.js#L55](../lock-worker.js#L55) |
| `saw` | The task status the watcher read once it had the lock. | [lock-worker.js#L24](../lock-worker.js#L24), [L27](../lock-worker.js#L27) |
| `action` | `claimed it` if `saw` was `pending`, else `skipped: already claimed`. | [lock-worker.js#L48-L53](../lock-worker.js#L48-L53) |
| B's wait | `got lock` minus `asked` for B. Not a column: you compute it. | [wait.js#L53](wait.js#L53) |

A's `asked` is always 0, because the table counts from the moment A asked. B's `asked` is not 0. In the recorded run it is between 4 and 15 ms. B is told to go only after A holds its lock, and the messages between the processes take a little time.

## The results

Recorded 2026-10-29 13:20 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

### SQLite has no FOR UPDATE

The same SELECT ... FOR UPDATE that PostgreSQL accepts, sent to SQLite:

| database | answer |
| --- | --- |
| sqlite | near "FOR": syntax error |

### Who waited

A locks task 1 and keeps the lock for 300 ms. B asks for a lock as soon as A holds its own. PostgreSQL uses SELECT ... FOR UPDATE on one row; SQLite uses BEGIN IMMEDIATE, its only way to lock before reading. Times are ms after A asked for its lock.

| database | scenario | watcher | task | asked (ms) | got lock (ms) | done (ms) | saw | action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | same task | A | 1 | 0 | 1 | 315 | pending | claimed it |
| sqlite | same task | B | 1 | 14 | 341 | 341 | claimed | skipped: already claimed |
| sqlite | different task | A | 1 | 0 | 0 | 320 | pending | claimed it |
| sqlite | different task | B | 2 | 4 | 425 | 737 | pending | claimed it |
| postgres | same task | A | 1 | 0 | 7 | 324 | pending | claimed it |
| postgres | same task | B | 1 | 15 | 326 | 332 | claimed | skipped: already claimed |
| postgres | different task | A | 1 | 0 | 7 | 321 | pending | claimed it |
| postgres | different task | B | 2 | 14 | 26 | 348 | pending | claimed it |
| mysql | same task | A | 1 | 0 | 8 | 351 | pending | claimed it |
| mysql | same task | B | 1 | 15 | 353 | 355 | claimed | skipped: already claimed |
| mysql | different task | A | 1 | 0 | 8 | 334 | pending | claimed it |
| mysql | different task | B | 2 | 14 | 23 | 348 | pending | claimed it |

How to read it. B's wait is `got lock` minus `asked`:

| database | B wants | B waited |
| --- | --- | --- |
| postgres | same task | 311 ms (15 to 326) |
| postgres | different task | 12 ms (14 to 26) |
| mysql | same task | 338 ms (15 to 353) |
| mysql | different task | 9 ms (14 to 23) |
| sqlite | same task | 327 ms (14 to 341) |
| sqlite | different task | 421 ms (4 to 425) |

- PostgreSQL, same task: A commits at 324 ms. B gets the lock at 326 ms, so B waited 311 ms. It reads `claimed` and skips. One session exists at the end.
- MySQL, same task: A commits at 351 ms. B gets the lock at 353 ms, so B waited 338 ms. It reads `claimed` and skips.
- PostgreSQL and MySQL, different task: B waits 12 ms on PostgreSQL and 9 ms on MySQL. The two watchers lock two different rows. Both claim, and their work overlaps. On PostgreSQL, B has its lock at 26 ms while A is still working until 321 ms.
- SQLite, both cases: B waits for A, even for task 2. A holds the write lock for the whole file. In the different-task case B starts its own 300 ms of work only at 425 ms and ends at 737 ms. The two jobs run one after the other.
- SQLite wakes B late. SQLite does not tell B when A commits. B uses the busy handler: it tries, sleeps, and tries again, and the sleeps grow longer, up to 100 ms. So B can find the lock free some time after A's commit. In the same-task case A is done at 315 ms, but B gets the lock at 341 ms, which is 26 ms later. In the different-task case A is done at 320 ms, but B gets the lock at 425 ms, which is 105 ms later. PostgreSQL and MySQL woke B 2 ms after A's commit (324 to 326, and 351 to 353).

## The chart

![Part 1 chart: A holds a lock for 300 ms. Does B wait?](chart.svg)

Look at the amber "waits" bars on the B lanes: long on SQLite for both tasks, long on PostgreSQL and MySQL only for the same task, almost gone for a different task.

## What the test checks

[`wait.test.js`](wait.test.js) has four tests:

- SQLite answers `FOR UPDATE` with a message that matches `syntax error` ([L9-L11](wait.test.js#L9-L11)).
- On SQLite, B waits at least 200 ms for the same task and for a different task. After the same-task wait, B skips. Two sessions exist after the different-task run ([L13-L20](wait.test.js#L13-L20)).
- On PostgreSQL and on MySQL, B waits at least 200 ms for the same task and sees `claimed`, with one session. For a different task, B's wait must be less than a third of the wait for the locked row, and two sessions exist ([L22-L34](wait.test.js#L22-L34)). This test is one test for each database. It is skipped if that database is not running.

## Try this

Each change is in [`wait.js`](wait.js). Running the script rewrites `results.md` and `chart.svg`, so save a copy first. Change the code back afterwards, because the test needs the original values.

1. **Hold longer.** Change `HOLD_MS` to `600` ([L17](wait.js#L17)). A now holds its lock for about 600 ms. Expect B's wait to grow by about 300 ms wherever it waited before: same task on all three databases, and different task on SQLite. Expect PostgreSQL and MySQL with a different task to stay at a few ms, because their rows do not touch.
2. **Ask later.** Change `b.send({ type: "go" });` ([L45](wait.js#L45)) to `setTimeout(() => b.send({ type: "go" }), 500);`. B now asks 500 ms after A got its lock. A is finished at about 300 ms, so B finds no lock. Expect B's wait to be a few ms in all six cases. In the same-task case B still reads `claimed` and skips, because A's commit is already visible.
