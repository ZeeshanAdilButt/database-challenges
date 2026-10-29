# Part 2: what a lock covers

Words like advisory lock, session lock, transaction lock and holder are explained in the [challenge README](../README.md#101-words-you-need).

## The idea

In part 1 the lock was taken once, when the watcher started. In real code a lock is often taken in the middle of work, inside a transaction. Then two questions matter:

1. **When is the lock given back?** At `ROLLBACK`? At `COMMIT`? Or only when you say so?
2. **What does the lock protect?** If A holds a lock "for task 1", can another program still change task 1?

### Question 1: when is it given back

A starts a transaction with `BEGIN`, takes the lock, and ends the transaction. Then B checks if the lock is still taken.

- **PostgreSQL has two kinds.**
  - The **session lock** (`pg_advisory_lock`) belongs to the connection. A transaction ending does not free it. Even a lock taken in a transaction that is rolled back is still held after the `ROLLBACK`.
  - The **transaction lock** (`pg_advisory_xact_lock`) belongs to the transaction. It is freed at `COMMIT` or at `ROLLBACK`, and there is no unlock call.
- **MySQL has one kind.** `GET_LOCK` is a session lock. It survives `ROLLBACK` and `COMMIT`. MySQL has no transaction-level advisory lock.
- **SQLite has no advisory lock.** The lock is a row in the `locks` table, so it follows the rules of every row. Other connections cannot see it until `COMMIT`. `ROLLBACK` throws it away. So during the transaction, B sees no lock at all.

Why does this matter? A session lock that you forget to give back, for example after an error, stays until the connection ends. A transaction lock cannot leak like that. But a transaction lock is gone as soon as the transaction ends, so it cannot protect work that happens after the `COMMIT`.

### Question 2: does it protect the row

A holds the lock and means it for task 1. B never asks for the lock. It just runs an `UPDATE` on task 1.

An advisory lock is a promise between programs that agree to ask. The database does not connect the name `watcher` to any row. So B's `UPDATE` is not stopped. On all three databases it changes 1 row.

This is why the checked `UPDATE` from challenge 1 stays in your code. The lock keeps polite programs out. The check catches the rest.

## What to expect before you run it

| Lock | During the transaction | After ROLLBACK | After COMMIT | Why |
|---|---|---|---|---|
| PostgreSQL session lock | held | held | held | It belongs to the connection. |
| PostgreSQL transaction lock | held | not held | not held | It belongs to the transaction. |
| MySQL `GET_LOCK` | held | held | held | A session lock. |
| SQLite lock row | not held | not held | held | Others cannot see the row before `COMMIT`. `ROLLBACK` removes it. |

And for question 2: all three databases will say "1 row changed".

## What the script does

[`scope.js`](scope.js) answers both questions on every database that is up. It uses the names and the table from [`lock.js`](../lock.js).

| Step | What happens | Where |
|---|---|---|
| 1 | `bCanTake`: how B checks the lock. PostgreSQL tries to take it, and gives it back at once if it got it. | [scope.js#L19-L23](scope.js#L19-L23) |
| 2 | `bCanTake` on MySQL asks `IS_FREE_LOCK`. | [scope.js#L24-L27](scope.js#L24-L27) |
| 3 | `bCanTake` on SQLite reads the `locks` table. If there is no row, the lock is free. | [scope.js#L28-L29](scope.js#L28-L29) |
| 4 | `WAYS`: how A takes the lock on each database, and how it gives it back at the end. PostgreSQL has two ways, MySQL and SQLite have one. | [scope.js#L33-L44](scope.js#L33-L44) |
| 5 | `heldAfter` makes a fresh database and opens two connections, A and B. | [scope.js#L50-L54](scope.js#L50-L54) |
| 6 | A runs `BEGIN` and takes the lock. | [scope.js#L55-L56](scope.js#L55-L56) |
| 7 | B checks: is the lock held during the transaction? | [scope.js#L57](scope.js#L57) |
| 8 | A ends the transaction (`ROLLBACK` or `COMMIT`). B checks again. | [scope.js#L58-L59](scope.js#L58-L59) |
| 9 | If the lock is still held, A gives it back. Close the connections. | [scope.js#L60-L62](scope.js#L60-L62) |
| 10 | `scopes` runs `heldAfter` twice for each way, once with `ROLLBACK` and once with `COMMIT`, and builds the table rows. | [scope.js#L79-L92](scope.js#L79-L92) |
| 11 | `rowNotProtected`: A takes the lock "for task 1". B updates task 1 without asking, and we count the rows changed. | [scope.js#L66-L77](scope.js#L66-L77) |
| 12 | Run both questions for each database that is up, then write `results.md`. | [scope.js#L94-L123](scope.js#L94-L123) |

## Where each number comes from

| Number | Meaning | Where |
|---|---|---|
| `held during the transaction` | `yes` if B could **not** take the lock while A's transaction was open. | [scope.js#L57](scope.js#L57), [L86](scope.js#L86) |
| `held after ROLLBACK` | The same check after A ran `ROLLBACK`. | [scope.js#L59](scope.js#L59), [L82](scope.js#L82), [L87](scope.js#L87) |
| `held after COMMIT` | The same check after A ran `COMMIT`. | [scope.js#L59](scope.js#L59), [L83](scope.js#L83), [L88](scope.js#L88) |
| `1 row changed` | The number of rows B's `UPDATE` reported. | [scope.js#L74](scope.js#L74), [L105](scope.js#L105) |

The toolkit takes that row count from SQLite's `changes` ([db.js#L123](../../../toolkit/db.js#L123)), from PostgreSQL's `rowCount` ([db.js#L151](../../../toolkit/db.js#L151)) and from MySQL's `affectedRows` ([db.js#L191-L194](../../../toolkit/db.js#L191-L194)). The `WHERE id = 1` row also changes from `pending` to `claimed`, so "rows matched" and "rows changed" are both 1.

## The results

Recorded 2026-10-29 12:52 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

### When is the lock given back

Connection A runs BEGIN, takes the lock, then ends the transaction. Connection B checks whether the lock is still taken.

| database | lock | held during the transaction | held after ROLLBACK | held after COMMIT |
| --- | --- | --- | --- | --- |
| sqlite | a row in the locks table | no | no | yes |
| postgres | session lock: pg_advisory_lock | yes | yes | yes |
| postgres | transaction lock: pg_advisory_xact_lock | yes | no | no |
| mysql | GET_LOCK (MySQL has no transaction lock) | yes | yes | yes |

### Does it protect the row

A holds the lock and means it for task 1. B never asks for the lock and updates task 1 directly.

| database | B's UPDATE of task 1, while A holds the lock |
| --- | --- |
| sqlite | 1 row changed |
| postgres | 1 row changed |
| mysql | 1 row changed |

How to read it:

- PostgreSQL session lock: held during the transaction, and still held after `ROLLBACK` and after `COMMIT`.
- PostgreSQL transaction lock: held during the transaction, gone after either.
- MySQL `GET_LOCK`: held after `ROLLBACK` and after `COMMIT`. MySQL has no transaction lock.
- SQLite: B sees no lock during the transaction. After `ROLLBACK` the row is gone. After `COMMIT` it stays.
- The plain `UPDATE` changed 1 row on all three. The lock did not stop it.

## No chart

This part has no `chart.svg`. The answers are yes and no, and two tables show them better than bars would.

## What the test checks

[`scope.test.js`](scope.test.js) has four kinds of test:

- PostgreSQL: the session lock is held after `ROLLBACK` and after `COMMIT`. The transaction lock is held during the transaction and gone after both ([L8-L15](scope.test.js#L8-L15)).
- MySQL: `GET_LOCK` is held after `ROLLBACK` and after `COMMIT` ([L17-L21](scope.test.js#L17-L21)).
- SQLite: the lock row is gone after `ROLLBACK` and there after `COMMIT` ([L23-L27](scope.test.js#L23-L27)).
- Every database: B's plain `UPDATE` changes 1 row ([L29-L33](scope.test.js#L29-L33)).

The PostgreSQL and MySQL tests are skipped when that database is not running.

## Try this

Each change is in [`scope.js`](scope.js). Running the script rewrites `results.md`, so save a copy first. Change the code back afterwards, because the test needs the original code.

1. **Make B ask first.** Replace the `UPDATE` line in `rowNotProtected` ([L74](scope.js#L74)) with:

   ```js
   const free = await bCanTake(b);
   const changed = free ? await b.run("UPDATE tasks SET status = 'claimed', claimed_by = 'B' WHERE id = 1") : 0;
   ```

   Expect `0 row changed` on all three databases. A holds the lock on each of them: the PostgreSQL session lock and the MySQL lock belong to A's connection, and on SQLite A's row was inserted outside a transaction, so it is committed and B can see it. Now B asks, hears "taken", and does not touch the row. The lock works, but only because B asked.
2. **Take the lock before `BEGIN`.** Swap the two lines [L55-L56](scope.js#L55-L56), so A takes the lock first and starts the transaction after. Expect these changes:
   - SQLite becomes `yes`, `yes`, `yes`. The row is now written outside the transaction, so it is committed at once, and `ROLLBACK` cannot take it back.
   - PostgreSQL session lock and MySQL `GET_LOCK` stay `yes`, `yes`, `yes`. They never depended on the transaction.
   - PostgreSQL transaction lock should become `no` in all three columns. It lasts until the end of its transaction. With no `BEGIN` yet, PostgreSQL treats the single statement as its own transaction, so the lock ends right away. This one is not in the results above, so run it and check that your prediction is right.
