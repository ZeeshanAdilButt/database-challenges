# Part 4: a transaction is not a lock

Back to the [challenge 2 overview](../README.md). Part 3 is [here](../part-3-valid-moves/README.md).

## The idea

In part 2, a transaction fixed the crash. The three writes of one watcher became all or nothing. Now we ask a question from challenge 1: does a transaction also stop the race? Two watchers read the same `pending` task, and both want to claim it. If each watcher works inside `BEGIN` and `COMMIT`, is the second one stopped?

A **lock** keeps other people away from a row. A transaction does something else. It groups your own writes, so they are saved together or not at all. It does not, by itself, stop another watcher from claiming the row you only read.

We test it with the same worst order as challenge 1 part 1, but now both watchers sit inside a transaction ([not-a-lock.js#L34-L36](not-a-lock.js#L34-L36)):

1. Both watchers send `BEGIN`.
2. Both read task 1. Both see `pending`.
3. A claims task 1, creates its session and sends `COMMIT`.
4. Now B tries the same claim.

We run this twice per database: on SQLite, PostgreSQL and MySQL. First with the unchecked `UPDATE` from challenge 1 part 1, which only says `WHERE id = 1` ([not-a-lock.js#L16](not-a-lock.js#L16)). Then with the checked `UPDATE` from challenge 1 part 2, which also says `AND status = 'pending'` ([not-a-lock.js#L19](not-a-lock.js#L19)).

### On PostgreSQL: the transaction does not stop B

With the unchecked `UPDATE`, B's claim changes 1 row. B creates its session and sends `COMMIT`. Both transactions commit, and task 1 has 2 sessions. The transaction stopped nothing.

Why? By default, PostgreSQL runs each statement on the data that is saved at that moment. When B's `UPDATE` runs, A has already committed. The unchecked `UPDATE` only asks for `id = 1`. That row exists, so PostgreSQL changes it. B never looks at the `status`.

With the checked `UPDATE`, the same statement says `AND status = 'pending'`. A already changed the status to `claimed`, so no row matches. B's claim changes 0 rows, B skips the task, and task 1 has 1 session. This is the fix from challenge 1 part 2. The check did the work, not the transaction.

### On MySQL: the same as PostgreSQL

MySQL's default isolation level is Repeatable Read. That sounds stricter than PostgreSQL's Read Committed. B read task 1 before A committed, so you might expect B to keep an old picture of it. But the results are the same as on PostgreSQL. The unchecked `UPDATE` changes 1 row, and task 1 gets 2 sessions. The checked `UPDATE` changes 0 rows, and task 1 gets 1 session. An `UPDATE` reads the latest committed row, not the old picture. So B's `UPDATE` sees that A already changed the status. As on PostgreSQL, the check did the work, not the transaction.

### On SQLite: B gets an error

On SQLite, B's claim fails in both runs. The error is `517`, with the text `database is locked`. B read task 1 before A committed, so B is working from an old picture of the database (a **snapshot**). When B tries to write, SQLite sees that A changed the database in the meantime, and it refuses the write. The watcher sends `ROLLBACK`, and task 1 has 1 session.

The word "locked" is misleading here. Waiting longer does not help, because B's picture stays old. So this is not a quiet check like the one on PostgreSQL and MySQL. It is an **error that your code must handle**, for example by starting the claim again. Only SQLite has this error 517 trap. [Challenge 3 part 3](../../challenge-3-locks/part-3-one-writer/README.md) explains it, and shows that a 5,000 ms timeout does not help.

To stop the race you need a real tool: a check inside the `UPDATE` (challenge 1), or a lock on the row (challenge 3).

## What the script does

[not-a-lock.js](not-a-lock.js) runs the four steps above for each claim and each database.

| Step | What happens | Code |
| --- | --- | --- |
| 1 | Define the two claims: unchecked (`WHERE id = 1`) and checked (`AND status = 'pending'`). | [not-a-lock.js#L15-L21](not-a-lock.js#L15-L21) |
| 2 | Make a fresh database with empty tables and add 1 task. | [not-a-lock.js#L27-L28](not-a-lock.js#L27-L28) |
| 3 | Open two connections, A and B. | [not-a-lock.js#L29-L30](not-a-lock.js#L29-L30) |
| 4 | Both send `BEGIN`. | [not-a-lock.js#L34-L36](not-a-lock.js#L34-L36) |
| 5 | A reads task 1, then B reads task 1. Both see `pending`. | [not-a-lock.js#L37-L38](not-a-lock.js#L37-L38) |
| 6 | A claims task 1. One row changes. | [not-a-lock.js#L39](not-a-lock.js#L39) |
| 7 | A creates its session and sends `COMMIT`. | [not-a-lock.js#L40-L42](not-a-lock.js#L40-L42) |
| 8 | B tries the same claim and records how many rows changed. | [not-a-lock.js#L44-L45](not-a-lock.js#L44-L45) |
| 9 | If B changed 1 row, it creates its session. Then B sends `COMMIT`. | [not-a-lock.js#L46-L48](not-a-lock.js#L46-L48) |
| 10 | If the database raised an error, keep its code and text, and send `ROLLBACK`. | [not-a-lock.js#L49-L52](not-a-lock.js#L49-L52) |
| 11 | Count the sessions. | [not-a-lock.js#L54](not-a-lock.js#L54) |
| 12 | Run both claims on each database. | [not-a-lock.js#L76-L82](not-a-lock.js#L76-L82) |
| 13 | Write `results.md` with three tables. | [not-a-lock.js#L84-L112](not-a-lock.js#L84-L112) |
| 14 | Draw `chart.svg` from the `Sessions for task 1` table. | [not-a-lock.js#L59-L69](not-a-lock.js#L59-L69) |

## Where each number comes from

| In the tables | Where it comes from |
| --- | --- |
| `BEGIN`, `ok` | Both watchers send `BEGIN`, and the script records one step for the two ([not-a-lock.js#L34-L36](not-a-lock.js#L34-L36)). |
| `pending` | The `status` column that `SELECT status FROM tasks WHERE id = 1` returned to A and to B ([not-a-lock.js#L37-L38](not-a-lock.js#L37-L38)). |
| `1 row changed` (A) | `run()` returns the rows changed: `changes` on SQLite, `rowCount` on PostgreSQL and `affectedRows` on MySQL ([toolkit/db.js#L122-L124](../../../toolkit/db.js#L122-L124), [toolkit/db.js#L150-L152](../../../toolkit/db.js#L150-L152), [toolkit/db.js#L191-L194](../../../toolkit/db.js#L191-L194)). The script writes it in the step ([not-a-lock.js#L39](not-a-lock.js#L39)). |
| `1 row changed` or `0 rows changed` (B) | The same number for B's claim on PostgreSQL and MySQL. It is 1 for the unchecked `UPDATE` ([not-a-lock.js#L16](not-a-lock.js#L16)) and 0 for the checked one ([not-a-lock.js#L19](not-a-lock.js#L19)), because A already changed the status ([not-a-lock.js#L44-L45](not-a-lock.js#L44-L45)). |
| `error 517: database is locked` | The code and the text that SQLite raised for B's write ([not-a-lock.js#L50](not-a-lock.js#L50)). SQLite calls code 517 `SQLITE_BUSY_SNAPSHOT`: the snapshot B read from is out of date ([lock-worker.js#L175-L176](../../challenge-3-locks/lock-worker.js#L175-L176)). It comes from SQLite, not from our code. |
| `skips, COMMIT` | B changed 0 rows, so it creates no session and only sends `COMMIT` ([not-a-lock.js#L48](not-a-lock.js#L48)). |
| `ROLLBACK` | B's write raised an error, so B throws away its transaction ([not-a-lock.js#L51-L52](not-a-lock.js#L51-L52)). |
| `sessions` | `SELECT COUNT(*) AS sessions FROM sessions` after both watchers are done ([not-a-lock.js#L54](not-a-lock.js#L54)). |
| Bar heights in the chart | `sessions` from the `Sessions for task 1` table. A bar is green when the value is 1 and red otherwise ([not-a-lock.js#L66](not-a-lock.js#L66)). |

## The real results

These are copied from [results.md](results.md).

Recorded 2026-10-29 12:50 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

### Step by step, unchecked UPDATE

The read, then update from challenge 1 part 1, inside BEGIN ... COMMIT.

| step | sqlite watcher | sqlite action | sqlite result | postgres watcher | postgres action | postgres result | mysql watcher | mysql action | mysql result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A and B | BEGIN | ok | A and B | BEGIN | ok | A and B | BEGIN | ok |
| 2 | A | reads task 1 | pending | A | reads task 1 | pending | A | reads task 1 | pending |
| 3 | B | reads task 1 | pending | B | reads task 1 | pending | B | reads task 1 | pending |
| 4 | A | claims task 1 | 1 row changed | A | claims task 1 | 1 row changed | A | claims task 1 | 1 row changed |
| 5 | A | creates a session, COMMIT | ok | A | creates a session, COMMIT | ok | A | creates a session, COMMIT | ok |
| 6 | B | claims task 1 | error 517: database is locked | B | claims task 1 | 1 row changed | B | claims task 1 | 1 row changed |
| 7 | B | ROLLBACK | ok | B | creates a session, COMMIT | ok | B | creates a session, COMMIT | ok |

### Step by step, checked UPDATE

The checked UPDATE from challenge 1 part 2, inside BEGIN ... COMMIT.

| step | sqlite watcher | sqlite action | sqlite result | postgres watcher | postgres action | postgres result | mysql watcher | mysql action | mysql result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A and B | BEGIN | ok | A and B | BEGIN | ok | A and B | BEGIN | ok |
| 2 | A | reads task 1 | pending | A | reads task 1 | pending | A | reads task 1 | pending |
| 3 | B | reads task 1 | pending | B | reads task 1 | pending | B | reads task 1 | pending |
| 4 | A | claims task 1 | 1 row changed | A | claims task 1 | 1 row changed | A | claims task 1 | 1 row changed |
| 5 | A | creates a session, COMMIT | ok | A | creates a session, COMMIT | ok | A | creates a session, COMMIT | ok |
| 6 | B | claims task 1 | error 517: database is locked | B | claims task 1 | 0 rows changed | B | claims task 1 | 0 rows changed |
| 7 | B | ROLLBACK | ok | B | skips, COMMIT | ok | B | skips, COMMIT | ok |

### Sessions for task 1

| database | claim | sessions |
| --- | --- | --- |
| sqlite | unchecked | 1 |
| sqlite | checked | 1 |
| postgres | unchecked | 2 |
| postgres | checked | 1 |
| mysql | unchecked | 2 |
| mysql | checked | 1 |

## The chart

![Bar chart: with a transaction around each claim, task 1 gets 2 sessions on PostgreSQL and MySQL with the unchecked UPDATE and 1 session in the other four cases](chart.svg)

Four bars are green and have the value 1: both SQLite runs, and the PostgreSQL and MySQL runs with the checked `UPDATE`. Two bars are red and have the value 2: PostgreSQL and MySQL with the unchecked `UPDATE`. The two green SQLite bars hide a difference that the tables show. SQLite stopped B with an error, and PostgreSQL and MySQL stopped B with the check.

## What the test checks

[not-a-lock.test.js](not-a-lock.test.js) has five tests: two for PostgreSQL, two for MySQL and one for SQLite. The PostgreSQL and MySQL tests are skipped when that database is not running ([not-a-lock.test.js#L8-L9](not-a-lock.test.js#L8-L9)).

- **PostgreSQL and MySQL, unchecked** ([not-a-lock.test.js#L11-L13](not-a-lock.test.js#L11-L13)): `BEGIN` around read-then-update still gives 2 sessions.
- **PostgreSQL and MySQL, checked** ([not-a-lock.test.js#L15-L17](not-a-lock.test.js#L15-L17)): the checked `UPDATE` gives 1 session.
- **SQLite** ([not-a-lock.test.js#L20-L24](not-a-lock.test.js#L20-L24)): one of the steps is an error that starts with `error 517`, and the table ends with 1 session.

## Your turn

In the template you start from, the lines between `// YOUR TURN` and `// END YOUR TURN` hold starter code instead of the solution. In this part it is the `checked` statement in `CLAIMS` in `not-a-lock.js`, which starts without `AND status = 'pending'`. Chapter 2.7 walks you through it. The tests `postgres: the checked UPDATE gives one session` and `mysql: the checked UPDATE gives one session` in `not-a-lock.test.js` turn green when it is right (they need PostgreSQL and MySQL, so run `npm run db:up` first).

## Try this

Each change makes the script overwrite `results.md` and `chart.svg` with your run. If you use git, `git restore` brings the old files back. Put the code back when you are done.

1. **Let B write without reading first.** Delete the line where B reads task 1, [not-a-lock.js#L38](not-a-lock.js#L38).
   - Expect SQLite to change. With the unchecked `UPDATE`, B's claim should now say `1 row changed`, B should create a session, and task 1 should end with 2 sessions. With the checked `UPDATE`, B should change 0 rows and skip, so task 1 has 1 session. The error comes from B's old picture of the database. If B reads nothing before A commits, B has no old picture, and SQLite lets B write. PostgreSQL and MySQL should not change, because their result never depended on B's read: their `UPDATE` reads the latest committed row either way.
   - Lesson: SQLite's error 517 protects you only when B read first. It is a side effect of an old read, not a rule about claims.
2. **Ask PostgreSQL for a stricter transaction for B.** In [not-a-lock.js#L35](not-a-lock.js#L35), change `await b.exec("BEGIN");` to `await b.exec(kind === "postgres" ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN");`. This needs PostgreSQL. MySQL and SQLite keep the plain `BEGIN`.
   - Expect B's claim on PostgreSQL to fail with an error that says `could not serialize access due to concurrent update`, for both the unchecked and the checked `UPDATE`. B should then send `ROLLBACK`, and task 1 should have 1 session in both runs. With this isolation level, B keeps the picture it had when it first read, and PostgreSQL refuses a write to a row that another transaction changed and committed after that picture. SQLite and MySQL should not change, because the new `BEGIN` is only used for PostgreSQL. The test for the unchecked PostgreSQL case would fail, because it expects 2 sessions.
   - Lesson: a stricter transaction can turn the silent double into an error, like SQLite does. Then your code must handle that error, for example by trying again.
