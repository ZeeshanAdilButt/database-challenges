# Challenge 3, part 3: one writer at a time

Recorded 2026-10-29 12:51 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## The deferred trap, step by step

Both connections have a 5,000 ms busy timeout. Watch how long B's claim takes to fail.

| step | watcher | action | sqlite | postgres | mysql |
| --- | --- | --- | --- | --- | --- |
| 1 | A | BEGIN | ok | ok | ok |
| 2 | B | BEGIN | ok | ok | ok |
| 3 | A | reads task 1 | pending | pending | pending |
| 4 | B | reads task 1 | pending | pending | pending |
| 5 | A | claims task 1 | 1 row changed | 1 row changed | 1 row changed |
| 6 | A | COMMIT | ok | ok | ok |
| 7 | B | claims task 1 | error 517: database is locked (after 1 ms) | 0 rows changed, no error (after 2 ms) | 0 rows changed, no error (after 3 ms) |

## Four writers

Four processes claim 100 tasks. Each claim is one transaction: read the next pending task, wait 2 ms, update it, insert a session, commit. A failed transaction is rolled back and tried again.

| database | begin | busy timeout (ms) | sessions | tasks with two sessions | failed transactions | total (ms) | errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | BEGIN | 0 | 100 | 0 | 227 | 2554 | 171 x 5: database is locked; 56 x 517: database is locked |
| sqlite | BEGIN | 5000 | 100 | 0 | 262 | 2913 | 203 x 5: database is locked; 59 x 517: database is locked |
| sqlite | BEGIN IMMEDIATE | 0 | 100 | 0 | 323 | 2030 | 323 x 5: database is locked |
| sqlite | BEGIN IMMEDIATE | 5000 | 100 | 0 | 0 | 2184 | none |
| postgres | BEGIN | none | 100 | 0 | 0 | 3427 | none |
| mysql | BEGIN | none | 100 | 0 | 0 | 3913 | none |
