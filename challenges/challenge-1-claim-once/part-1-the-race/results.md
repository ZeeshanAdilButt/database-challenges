# Challenge 1, part 1: the race

Recorded 2026-10-29 12:48 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## Step by step

One task, two watchers, steps forced into the worst order. The result column shows what each database answered.

| step | watcher | action | sqlite | postgres | mysql |
| --- | --- | --- | --- | --- | --- |
| 1 | A | reads task 1 | pending | pending | pending |
| 2 | B | reads task 1 | pending | pending | pending |
| 3 | A | claims task 1 | 1 row changed | 1 row changed | 1 row changed |
| 4 | A | creates a session for task 1 | saved | saved | saved |
| 5 | B | claims task 1 | 1 row changed | 1 row changed | 1 row changed |
| 6 | B | creates a session for task 1 | saved | saved | saved |

## Sessions after the steps

| database | tasks | sessions |
| --- | --- | --- |
| sqlite | 1 | 2 |
| postgres | 1 | 2 |
| mysql | 1 | 2 |

## Real run

Two watcher processes started at the same moment. Each polls every 50 ms and reads up to 10 pending tasks per poll.

| database | tasks | sessions | tasks with two sessions |
| --- | --- | --- | --- |
| sqlite | 200 | 348 | 148 |
| postgres | 200 | 355 | 155 |
| mysql | 200 | 360 | 160 |
