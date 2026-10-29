# Challenge 2, part 2: a transaction

Recorded 2026-10-29 08:49 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

## What the watcher did before it died

| database | crash after | steps |
| --- | --- | --- |
| sqlite | claim | BEGIN, claim written for task 1, process killed |
| sqlite | session | BEGIN, claim written for task 1, session written for task 1, process killed |
| postgres | claim | BEGIN, claim written for task 1, process killed |
| postgres | session | BEGIN, claim written for task 1, session written for task 1, process killed |

## Right after the crash

The writes before the crash were never committed, so the database threw them away.

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | pending | nobody | 0 | 0 | clean: still pending |
| sqlite | session | pending | nobody | 0 | 0 | clean: still pending |
| postgres | claim | pending | nobody | 0 | 0 | clean: still pending |
| postgres | session | pending | nobody | 0 | 0 | clean: still pending |

## After the restart

Task 1 was still pending, so the restarted watcher found it and started it, once.

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | claimed | A | 1 | 1 | clean: started once |
| sqlite | session | claimed | A | 1 | 1 | clean: started once |
| postgres | claim | claimed | A | 1 | 1 | clean: started once |
| postgres | session | claimed | A | 1 | 1 | clean: started once |

## An error halfway

The third write fails. Without a transaction the first two stay saved. With one, ROLLBACK removes them.

| database | transaction | error | status | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | no | NOT NULL constraint failed: events.kind | claimed | 1 | 0 | half: session, no event |
| sqlite | yes | NOT NULL constraint failed: events.kind | pending | 0 | 0 | clean: still pending |
| postgres | no | null value in column "kind" of relation "events" violates not-null constraint | claimed | 1 | 0 | half: session, no event |
| postgres | yes | null value in column "kind" of relation "events" violates not-null constraint | pending | 0 | 0 | clean: still pending |
