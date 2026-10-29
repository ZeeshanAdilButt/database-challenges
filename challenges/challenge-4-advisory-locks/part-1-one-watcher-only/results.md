# Challenge 4, part 1: one watcher only

Recorded 2026-10-29 13:09 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## Without a lock: two copies of watcher A

Copy 1 starts task 1 and keeps working on it. Copy 2, with the same name, starts and runs its recovery step from challenge 2 part 3.

| database | task 1 while copy 1 works | copy 2 on start | task 1 after copy 2 started |
| --- | --- | --- | --- |
| sqlite | running | recovered 1 interrupted task(s) | failed |
| postgres | running | recovered 1 interrupted task(s) | failed |
| mysql | running | recovered 1 interrupted task(s) | failed |

## While A runs

A starts first and takes the lock. B starts while A is still running.

| database | watcher A | watcher B | lock held by |
| --- | --- | --- | --- |
| sqlite | watcher A got the lock and is running | watcher B found the lock taken and stopped | row says A |
| postgres | watcher A got the lock and is running | watcher B found the lock taken and stopped | connection 3550 |
| mysql | watcher A got the lock and is running | watcher B found the lock taken and stopped | connection 635 |

## After A is killed

A is killed with SIGKILL: no cleanup, no unlock. Then C starts.

| database | lock held by | watcher C | C got the lock |
| --- | --- | --- | --- |
| sqlite | row says A | watcher C found the lock taken and stopped | no |
| postgres | nobody | watcher C got the lock and is running | yes |
| mysql | nobody | watcher C got the lock and is running | yes |
