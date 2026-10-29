# Challenge 1, part 3: the safety net

Recorded 2026-10-29 08:46 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

## The database refuses a second session

With `CREATE UNIQUE INDEX one_session_per_task ON sessions (task_id)`, a second INSERT for task 1 fails. This is each database's own error.

| database | error on the second insert |
| --- | --- |
| sqlite | ERR_SQLITE_ERROR: UNIQUE constraint failed: sessions.task_id |
| postgres | 23505: duplicate key value violates unique constraint "one_session_per_task" |

## Real run

Two watcher processes, 200 tasks, the unique index in place. "owner mismatch" counts tasks whose claimed_by names one watcher while the saved session belongs to the other.

| database | claim | tasks | sessions | tasks with two sessions | refused by the index | owner mismatch |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | read-then-update | 200 | 200 | 0 | 87 | 87 |
| sqlite | condition | 200 | 200 | 0 | 0 | 0 |
| postgres | read-then-update | 200 | 200 | 0 | 121 | 121 |
| postgres | condition | 200 | 200 | 0 | 0 | 0 |
