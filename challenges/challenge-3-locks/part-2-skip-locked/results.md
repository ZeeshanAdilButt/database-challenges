# Challenge 3, part 2: skip locked

Recorded 2026-10-29 08:56 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

## Draining 100 tasks with 4 workers

Worker processes start together. Each task takes 20 ms of work (a timer, so on Windows it often takes closer to 30 ms). "for update", "skip locked" and "begin immediate" hold the lock during the work; "short claim" commits the claim first and works with no lock held. The first row of each database is one worker alone, the time to beat.

| database | claim | workers | tasks | sessions | tasks with two sessions | total (ms) | waiting (ms) | claimed per worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sqlite | one worker alone | 1 | 100 | 100 | 0 | 3105 | 335 | 100 |
| sqlite | begin immediate | 4 | 100 | 100 | 0 | 3387 | 9853 | 0 / 100 / 0 / 0 |
| sqlite | short claim | 4 | 100 | 100 | 0 | 1595 | 3517 | 27 / 23 / 26 / 24 |
| postgres | one worker alone | 1 | 100 | 100 | 0 | 3217 | 919 | 100 |
| postgres | for update | 4 | 100 | 100 | 0 | 3226 | 9628 | 29 / 19 / 32 / 20 |
| postgres | skip locked | 4 | 100 | 100 | 0 | 979 | 265 | 25 / 25 / 26 / 24 |
| postgres | short claim | 4 | 100 | 100 | 0 | 1230 | 2095 | 23 / 24 / 27 / 26 |
