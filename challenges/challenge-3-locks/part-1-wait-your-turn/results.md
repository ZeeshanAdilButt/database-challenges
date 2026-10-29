# Challenge 3, part 1: wait your turn

Recorded 2026-10-29 13:20 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## SQLite has no FOR UPDATE

The same SELECT ... FOR UPDATE that PostgreSQL accepts, sent to SQLite:

| database | answer |
| --- | --- |
| sqlite | near "FOR": syntax error |

## Who waited

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
