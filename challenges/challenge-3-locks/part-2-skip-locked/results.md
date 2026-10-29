# Challenge 3, part 2: skip locked

Recorded 2026-10-29 12:50 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## Draining 100 tasks with 4 workers

Worker processes start together. Each task takes 20 ms of work (a timer, so on Windows it often takes closer to 30 ms). "for update", "skip locked" and "begin immediate" hold the lock during the work; "short claim" commits the claim first and works with no lock held. The first row of each database is one worker alone, the time to beat.

| database | claim | workers | tasks | sessions | tasks with two sessions | total (ms) | waiting (ms) | claimed per worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | one worker alone | 1 | 100 | 100 | 0 | 3107 | 369 | 100 |
| sqlite | begin immediate | 4 | 100 | 100 | 0 | 3379 | 9694 | 100 / 0 / 0 / 0 |
| sqlite | short claim | 4 | 100 | 100 | 0 | 1584 | 3494 | 25 / 23 / 27 / 25 |
| postgres | one worker alone | 1 | 100 | 100 | 0 | 5138 | 2212 | 100 |
| postgres | for update | 4 | 100 | 100 | 0 | 4069 | 12070 | 24 / 34 / 6 / 36 |
| postgres | skip locked | 4 | 100 | 100 | 0 | 1216 | 493 | 26 / 25 / 25 / 24 |
| postgres | short claim | 4 | 100 | 100 | 0 | 1598 | 2991 | 28 / 19 / 27 / 26 |
| mysql | one worker alone | 1 | 100 | 100 | 0 | 5476 | 2706 | 100 |
| mysql | for update | 4 | 100 | 100 | 0 | 4743 | 14184 | 25 / 25 / 25 / 25 |
| mysql | skip locked | 4 | 100 | 100 | 0 | 1557 | 588 | 26 / 24 / 25 / 25 |
| mysql | short claim | 4 | 100 | 100 | 0 | 2415 | 6801 | 25 / 25 / 25 / 25 |
