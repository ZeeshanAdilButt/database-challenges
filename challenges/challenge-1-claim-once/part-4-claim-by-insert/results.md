# Challenge 1, part 4: claim by insert

Recorded 2026-10-29 12:51 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## The statement on each database

All three mean the same: insert the session, or do nothing if this task already has one. The unique index on sessions(task_id) decides.

| database | statement |
| --- | --- |
| sqlite | `INSERT OR IGNORE INTO sessions (task_id, worker) VALUES ($1, $2)` |
| postgres | `INSERT INTO sessions (task_id, worker) VALUES ($1, $2) ON CONFLICT (task_id) DO NOTHING` |
| mysql | `INSERT IGNORE INTO sessions (task_id, worker) VALUES ($1, $2)` |

## Step by step

One task, two watchers, the worst order: both read before either one writes.

| step | watcher | action | sqlite | postgres | mysql |
| --- | --- | --- | --- | --- | --- |
| 1 | A | reads task 1 | pending | pending | pending |
| 2 | B | reads task 1 | pending | pending | pending |
| 3 | A | inserts the session for task 1 | 1 row changed | 1 row changed | 1 row changed |
| 4 | B | inserts the session for task 1 | 0 rows changed | 0 rows changed | 0 rows changed |

## Real run

Two watcher processes, 200 tasks, a poll every 50 ms. Each claims by inserting the session, then marks the task claimed only if its insert changed 1 row.

| database | tasks | sessions | tasks with two sessions | inserts ignored | owner mismatch |
| --- | --- | --- | --- | --- | --- |
| sqlite | 200 | 200 | 0 | 124 | 0 |
| postgres | 200 | 200 | 0 | 164 | 0 |
| mysql | 200 | 200 | 0 | 189 | 0 |
