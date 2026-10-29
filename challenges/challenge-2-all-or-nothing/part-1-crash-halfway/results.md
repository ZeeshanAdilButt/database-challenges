# Challenge 2, part 1: a crash halfway

Recorded 2026-10-29 12:49 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11, MySQL 8.4.13.

## What the watcher did before it died

| database | crash after | steps |
| --- | --- | --- |
| sqlite | claim | claim written for task 1, process killed |
| sqlite | session | claim written for task 1, session written for task 1, process killed |
| postgres | claim | claim written for task 1, process killed |
| postgres | session | claim written for task 1, session written for task 1, process killed |
| mysql | claim | claim written for task 1, process killed |
| mysql | session | claim written for task 1, session written for task 1, process killed |

## Right after the crash

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| sqlite | session | claimed | A | 1 | 0 | half: session, no event |
| postgres | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| postgres | session | claimed | A | 1 | 0 | half: session, no event |
| mysql | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| mysql | session | claimed | A | 1 | 0 | half: session, no event |

## After the restart

The restarted watcher looks for pending tasks. Task 1 is no longer pending, so nobody will ever start it again.

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| sqlite | session | claimed | A | 1 | 0 | half: session, no event |
| postgres | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| postgres | session | claimed | A | 1 | 0 | half: session, no event |
| mysql | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| mysql | session | claimed | A | 1 | 0 | half: session, no event |
