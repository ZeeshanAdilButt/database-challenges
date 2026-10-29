# Challenge 1, part 2: the fix

Recorded 2026-10-29 08:46 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

## Step by step

One task, two watchers, the same worst order as part 1. The claim now checks the status, and the watcher looks at the rows changed.

| step | watcher | action | sqlite | postgres |
| --- | --- | --- | --- | --- |
| 1 | A | reads task 1 | pending | pending |
| 2 | B | reads task 1 | pending | pending |
| 3 | A | claims task 1 | 1 row changed | 1 row changed |
| 4 | A | creates a session for task 1 | saved | saved |
| 5 | B | claims task 1 | 0 rows changed | 0 rows changed |
| 6 | B | skips the task | someone else has it | someone else has it |

## Sessions after the steps

| database | tasks | sessions |
| --- | --- | --- |
| sqlite | 1 | 1 |
| postgres | 1 | 1 |

## Real run

Two watcher processes started at the same moment, 200 tasks, a poll every 50 ms. "races caught" counts claims that changed 0 rows because the other watcher got there first.

| database | claim | tasks | sessions | tasks with two sessions | races caught | left pending |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | condition | 200 | 200 | 0 | 111 | 0 |
| sqlite | one-statement | 200 | 200 | 0 | 0 | 0 |
| postgres | condition | 200 | 200 | 0 | 186 | 0 |
| postgres | one-statement | 200 | 200 | 0 | 13 | 0 |
