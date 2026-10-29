# Part 2: a transaction

Back to the [challenge 2 overview](../README.md). Part 1 is [here](../part-1-crash-halfway/README.md).

## The idea

In part 1, the same kills left task 1 `claimed` with 0 sessions, or with 1 session and 0 events. The watcher saved each write the moment it ran.

Now we change one thing. The watcher sends `BEGIN` before the three writes and `COMMIT` after them ([watcher.js#L55-L58](../watcher.js#L55-L58) and [watcher.js#L64-L67](../watcher.js#L64-L67)). Everything between `BEGIN` and `COMMIT` is one **transaction**. The database does not make these writes permanent one by one. It makes them permanent all together, at the `COMMIT`, or not at all.

The kill lands before the `COMMIT` ([watcher.js#L62](../watcher.js#L62) comes before [watcher.js#L64](../watcher.js#L64)). So the transaction is never finished. The database throws away every write of an unfinished transaction:

- **SQLite** discards them the next time a connection opens the database file.
- **PostgreSQL** discards them when it sees that the watcher's connection is gone.

The result is the one you see below. After the kill, task 1 is `pending`, with `claimed by = nobody`, 0 sessions and 0 events. It is as if the watcher never started. Because task 1 is `pending`, the restarted watcher finds it (it looks for `pending`, see [watcher.js#L46](../watcher.js#L46)) and starts it. The restart is safe because the first attempt left nothing behind.

The second half of this part is an **error** instead of a crash. The third write fails, because we give the event a `NULL` kind and the column is `NOT NULL`. Without a transaction, the first two writes stay saved. With a transaction, we catch the error and send `ROLLBACK`, which throws away everything since `BEGIN`.

One limit: a transaction makes several writes all or nothing. It does not, by itself, stop two watchers from racing for the same task. That is challenge 1 and challenge 3.

## What the script does

[transaction.js](transaction.js) reuses `crashThenRestart` and `verdict` from part 1 ([transaction.js#L11](transaction.js#L11)), this time with `transaction: true`.

| Step | What happens | Code |
| --- | --- | --- |
| 1 | For each database and each crash point, run the part 1 function with a transaction. | [transaction.js#L69-L72](transaction.js#L69-L72) |
| 2 | That function adds task 1, starts the watcher with `BEGIN` and a kill after the chosen write, and reads task 1. | [crash.js#L19-L24](../part-1-crash-halfway/crash.js#L19-L24) |
| 3 | It starts the watcher again, also inside `BEGIN` and `COMMIT`, and reads task 1 again. | [crash.js#L25-L26](../part-1-crash-halfway/crash.js#L25-L26) |
| 4 | Run the error test twice per database: without and with a transaction. | [transaction.js#L78-L81](transaction.js#L78-L81) |
| 5 | In the error test, send `BEGIN` only when a transaction is asked for. | [transaction.js#L31](transaction.js#L31) |
| 6 | Write 1 claims task 1, write 2 adds a session. | [transaction.js#L32-L33](transaction.js#L32-L33) |
| 7 | Write 3 adds an event with `NULL` as its kind. The database refuses it. | [transaction.js#L34](transaction.js#L34) |
| 8 | Catch the error and keep its message. With a transaction, send `ROLLBACK`. | [transaction.js#L36-L39](transaction.js#L36-L39) |
| 9 | Read task 1 and report its state. | [transaction.js#L41-L43](transaction.js#L41-L43) |
| 10 | Write `results.md` with four tables. | [transaction.js#L89-L113](transaction.js#L89-L113) |
| 11 | Draw `chart.svg` from the `After the restart` table. | [transaction.js#L46-L59](transaction.js#L46-L59) |

## Where each number comes from

| In the tables | Where it comes from |
| --- | --- |
| `steps` | The messages the watcher sent before it died. This time the first one is `BEGIN` ([watcher.js#L57](../watcher.js#L57)). There is no `COMMIT` in the list, because the watcher never got there. |
| `status`, `claimed by`, `sessions`, `events` | `taskState` reads them from the database ([toolkit/db.js#L195-L199](../../../toolkit/db.js#L195-L199)). `claimed by` shows `nobody` when `claimed_by` is empty. |
| `verdict` | The `verdict` function from part 1 ([crash.js#L33-L39](../part-1-crash-halfway/crash.js#L33-L39)). `pending` with 0 and 0 is `clean: still pending`. `claimed` with 1 and 1 is `clean: started once`. |
| `error` | The message of the error the database raised for the third write ([transaction.js#L37](transaction.js#L37)). It comes from SQLite or PostgreSQL, not from our code. |
| Rule behind the error | The `kind` column is declared `NOT NULL` ([toolkit/db.js#L43](../../../toolkit/db.js#L43) for SQLite, [toolkit/db.js#L61](../../../toolkit/db.js#L61) for PostgreSQL). |
| Bar heights in the chart | `sessions` and `events` from the `After the restart` table. A bar is green when the value is 1 ([transaction.js#L54-L55](transaction.js#L54-L55)). |

## The real results

These are copied from [results.md](results.md).

Recorded 2026-10-29 08:49 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

### What the watcher did before it died

| database | crash after | steps |
| --- | --- | --- |
| sqlite | claim | BEGIN, claim written for task 1, process killed |
| sqlite | session | BEGIN, claim written for task 1, session written for task 1, process killed |
| postgres | claim | BEGIN, claim written for task 1, process killed |
| postgres | session | BEGIN, claim written for task 1, session written for task 1, process killed |

### Right after the crash

The writes before the crash were never committed, so the database threw them away.

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | pending | nobody | 0 | 0 | clean: still pending |
| sqlite | session | pending | nobody | 0 | 0 | clean: still pending |
| postgres | claim | pending | nobody | 0 | 0 | clean: still pending |
| postgres | session | pending | nobody | 0 | 0 | clean: still pending |

### After the restart

Task 1 was still pending, so the restarted watcher found it and started it, once.

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | claimed | A | 1 | 1 | clean: started once |
| sqlite | session | claimed | A | 1 | 1 | clean: started once |
| postgres | claim | claimed | A | 1 | 1 | clean: started once |
| postgres | session | claimed | A | 1 | 1 | clean: started once |

### An error halfway

The third write fails. Without a transaction the first two stay saved. With one, ROLLBACK removes them.

| database | transaction | error | status | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | no | NOT NULL constraint failed: events.kind | claimed | 1 | 0 | half: session, no event |
| sqlite | yes | NOT NULL constraint failed: events.kind | pending | 0 | 0 | clean: still pending |
| postgres | no | null value in column "kind" of relation "events" violates not-null constraint | claimed | 1 | 0 | half: session, no event |
| postgres | yes | null value in column "kind" of relation "events" violates not-null constraint | pending | 0 | 0 | clean: still pending |

Two things to see in the tables:

- The crash cases and the `transaction = no` error cases end in the same half-written state as part 1: `claimed`, 1 session, 0 events.
- The `transaction = yes` error cases end in the same state as the crash cases: `pending`, 0 sessions, 0 events. A crash and a `ROLLBACK` have the same effect on the data.

## The chart

![Bar chart: after a crash inside a transaction and a restart, task 1 has 1 session and 1 event in every case](chart.svg)

Every bar is green and has the value 1: after the restart, each case has exactly one session and one event. The chart only shows the `After the restart` table. The half-written states are in the tables above.

## What the test checks

[transaction.test.js](transaction.test.js) runs on both databases. PostgreSQL tests are skipped when PostgreSQL is not running ([transaction.test.js#L12](transaction.test.js#L12)).

- For a crash after the claim and a crash after the session ([transaction.test.js#L14-L21](transaction.test.js#L14-L21)): the watcher really died, the verdict right after the crash is `clean: still pending`, and the verdict after the restart is `clean: started once`.
- For an error halfway ([transaction.test.js#L23-L26](transaction.test.js#L23-L26)): without a transaction the verdict is `half: session, no event`, and with a transaction it is `clean: still pending`.

## Your turn

In the template you start from, the lines between `// YOUR TURN` and `// END YOUR TURN` hold starter code instead of the solution. In this part it is the `try` and `catch` in `errorHalfway` in `transaction.js`, which starts without `BEGIN`, `COMMIT` and `ROLLBACK`. Chapter 2.7 walks you through it. The test `sqlite: an error halfway is rolled back` in `transaction.test.js` turns green when it is right (on PostgreSQL the same test starts with `postgres:`).

## Try this

Each change makes the script overwrite `results.md` and `chart.svg` with your run. If you use git, `git restore` brings the old files back. Put the code back when you are done.

1. **Kill the watcher after the third write, still before the COMMIT.** In [transaction.js#L70](transaction.js#L70), change `["claim", "session"]` to `["claim", "session", "event"]`.
   - Expect a third case per database. Its steps should end with `event written for task 1, process killed`. All three writes ran, but the `COMMIT` did not, so right after the crash task 1 should still be `pending` with 0 sessions and 0 events. After the restart it should be `claimed`, with 1 session and 1 event.
   - Lesson: what matters is the `COMMIT`, not how many writes were done.
2. **Make the third write valid.** In [transaction.js#L34](transaction.js#L34), change `NULL` to `'session created'`.
   - Expect the `error` column to show `none` in all four rows of `An error halfway`. Both the run with a transaction and the run without one should end with `claimed`, 1 session, 1 event and the verdict `clean: started once`. With nothing failing, there is nothing to roll back.
   - Lesson: a transaction only changes what happens when something goes wrong. When nothing goes wrong, the two versions look the same.
