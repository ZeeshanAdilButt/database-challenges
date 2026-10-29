# Challenge 3, part 1: wait your turn

Recorded 2026-10-29 08:54 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

## SQLite has no FOR UPDATE

The same SELECT ... FOR UPDATE that PostgreSQL accepts, sent to SQLite:

| database | answer |
| --- | --- |
| sqlite | near "FOR": syntax error |

## Who waited

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
