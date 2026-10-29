# Challenge 4, part 3: a lease with an expiry

Recorded 2026-10-29 12:52 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## Without a fencing token

The lease lasts 1500 ms. A stops renewing at 600 ms. When A wakes up, it finishes the task with an UPDATE that checks nothing.

| time (ms) | watcher | action | sqlite | postgres | mysql |
| --- | --- | --- | --- | --- | --- |
| 0 | A | takes the lease on task 1 until 1500 ms | got it, token 1 | got it, token 1 | got it, token 1 |
| 500 | A | renews | renewed until 2000 ms | renewed until 2000 ms | renewed until 2000 ms |
| 600 | A | stops renewing (killed, or paused) | no more renewals | no more renewals | no more renewals |
| 1000 | B | tries to take task 1 | refused: A's lease runs until 2000 ms | refused: A's lease runs until 2000 ms | refused: A's lease runs until 2000 ms |
| 2100 | B | tries again after the lease ran out | got it, token 2 | got it, token 2 | got it, token 2 |
| 2300 | A | wakes up, finishes with no token check | 1 row changed: A overwrote B's task | 1 row changed: A overwrote B's task | 1 row changed: A overwrote B's task |
| 2600 | B | finishes with token 2 | 0 rows changed: the task was already marked done by A | 0 rows changed: the task was already marked done by A | 0 rows changed: the task was already marked done by A |

## With a fencing token

The same story, but every finish checks lease_token. A still holds token 1; B took token 2.

| time (ms) | watcher | action | sqlite | postgres | mysql |
| --- | --- | --- | --- | --- | --- |
| 0 | A | takes the lease on task 1 until 1500 ms | got it, token 1 | got it, token 1 | got it, token 1 |
| 500 | A | renews | renewed until 2000 ms | renewed until 2000 ms | renewed until 2000 ms |
| 600 | A | stops renewing (killed, or paused) | no more renewals | no more renewals | no more renewals |
| 1000 | B | tries to take task 1 | refused: A's lease runs until 2000 ms | refused: A's lease runs until 2000 ms | refused: A's lease runs until 2000 ms |
| 2100 | B | tries again after the lease ran out | got it, token 2 | got it, token 2 | got it, token 2 |
| 2300 | A | wakes up, finishes with token 1 | 0 rows changed: fenced out | 0 rows changed: fenced out | 0 rows changed: fenced out |
| 2600 | B | finishes with token 2 | 1 row changed | 1 row changed | 1 row changed |

## Who finished task 1

| database | fence | status | finished by | lease_token |
| --- | --- | --- | --- | --- |
| sqlite | none | done | A | 2 |
| sqlite | token checked | done | B | 2 |
| postgres | none | done | A | 2 |
| postgres | token checked | done | B | 2 |
| mysql | none | done | A | 2 |
| mysql | token checked | done | B | 2 |
