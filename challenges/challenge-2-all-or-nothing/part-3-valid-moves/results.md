# Challenge 2, part 3: only valid moves

Recorded 2026-10-29 12:50 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## Moves on one task

Each row tries one move on task 1, in order. The last row skips move() and writes a typo straight to the table.

| database | move | result | status now |
| --- | --- | --- | --- |
| sqlite | pending to claimed | moved | claimed |
| sqlite | claimed to running | moved | running |
| sqlite | running to done | moved | done |
| sqlite | claimed to running | 0 rows changed: the task was not claimed | done |
| sqlite | done to pending | refused by the code: done to pending is not allowed | done |
| sqlite | done to compelted (typo) | refused by the CHECK: CHECK constraint failed: status IN ('pending', 'claimed', 'running', 'done', 'failed') | done |
| postgres | pending to claimed | moved | claimed |
| postgres | claimed to running | moved | running |
| postgres | running to done | moved | done |
| postgres | claimed to running | 0 rows changed: the task was not claimed | done |
| postgres | done to pending | refused by the code: done to pending is not allowed | done |
| postgres | done to compelted (typo) | refused by the CHECK: new row for relation "tasks" violates check constraint "tasks_status_check" | done |
| mysql | pending to claimed | moved | claimed |
| mysql | claimed to running | moved | running |
| mysql | running to done | moved | done |
| mysql | claimed to running | 0 rows changed: the task was not claimed | done |
| mysql | done to pending | refused by the code: done to pending is not allowed | done |
| mysql | done to compelted (typo) | refused by the CHECK: Check constraint 'tasks_chk_1' is violated. | done |

## Dying while a task runs

The watcher commits the start of task 1, moves it to running, and is killed. Then it restarts.

| database | restart with recovery | status after crash | status after restart | sessions | events | restart steps |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | no | running | running | 1 | 1 | no pending task found |
| sqlite | yes | running | failed | 1 | 2 | recovered 1 interrupted task(s), no pending task found |
| postgres | no | running | running | 1 | 1 | no pending task found |
| postgres | yes | running | failed | 1 | 2 | recovered 1 interrupted task(s), no pending task found |
| mysql | no | running | running | 1 | 1 | no pending task found |
| mysql | yes | running | failed | 1 | 2 | recovered 1 interrupted task(s), no pending task found |
