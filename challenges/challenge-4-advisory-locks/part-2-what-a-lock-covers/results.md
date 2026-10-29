# Challenge 4, part 2: what a lock covers

Recorded 2026-10-29 12:52 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## When is the lock given back

Connection A runs BEGIN, takes the lock, then ends the transaction. Connection B checks whether the lock is still taken.

| database | lock | held during the transaction | held after ROLLBACK | held after COMMIT |
| --- | --- | --- | --- | --- |
| sqlite | a row in the locks table | no | no | yes |
| postgres | session lock: pg_advisory_lock | yes | yes | yes |
| postgres | transaction lock: pg_advisory_xact_lock | yes | no | no |
| mysql | GET_LOCK (MySQL has no transaction lock) | yes | yes | yes |

## Does it protect the row

A holds the lock and means it for task 1. B never asks for the lock and updates task 1 directly.

| database | B's UPDATE of task 1, while A holds the lock |
| --- | --- |
| sqlite | 1 row changed |
| postgres | 1 row changed |
| mysql | 1 row changed |
