# Challenge 2, part 4: a transaction is not a lock

Recorded 2026-10-29 12:50 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## Step by step, unchecked UPDATE

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

## Step by step, checked UPDATE

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

## Sessions for task 1

| database | claim | sessions |
| --- | --- | --- |
| sqlite | unchecked | 1 |
| sqlite | checked | 1 |
| postgres | unchecked | 2 |
| postgres | checked | 1 |
| mysql | unchecked | 2 |
| mysql | checked | 1 |
