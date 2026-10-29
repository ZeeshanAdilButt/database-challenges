# Challenge 3, part 3: one writer at a time

Recorded 2026-10-29 08:57 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

## The deferred trap, step by step

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

## Four writers

Four processes claim 100 tasks. Each claim is one transaction: read the next pending task, wait 2 ms, update it, insert a session, commit. A failed transaction is rolled back and tried again.

| database | begin | busy timeout (ms) | sessions | tasks with two sessions | failed transactions | total (ms) | errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | BEGIN | 0 | 100 | 0 | 222 | 2231 | 178 x 5: database is locked; 44 x 517: database is locked |
| sqlite | BEGIN | 5000 | 100 | 0 | 225 | 2239 | 171 x 5: database is locked; 54 x 517: database is locked |
| sqlite | BEGIN IMMEDIATE | 0 | 100 | 0 | 324 | 1771 | 324 x 5: database is locked |
| sqlite | BEGIN IMMEDIATE | 5000 | 100 | 0 | 0 | 1984 | none |
| postgres | BEGIN | none | 100 | 0 | 0 | 1786 | none |
