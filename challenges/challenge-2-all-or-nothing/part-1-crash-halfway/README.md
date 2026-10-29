# Part 1: a crash halfway

Back to the [challenge 2 overview](../README.md).

## The idea

Starting a task takes three writes: claim it, create its session, log an event. These are three separate statements.

By default, a database saves each statement the moment it runs. This is called auto-commit: every write is its own tiny commit. Nothing joins the three writes together. So there is a moment, after write 1 and before write 3, when the database holds a task that is only partly started. If the watcher dies in that moment, the partly started task stays in the database for good.

In this part we do not use a transaction. We kill the watcher with SIGKILL on purpose, twice, and look at the rows:

1. Kill it right after the **claim**. The task has `status = claimed` and `claimed_by = A`, but `sessions = 0`. A task that is `claimed` looks like it is already being handled, but no session exists.
2. Kill it right after the **session**. The task is `claimed`, `sessions = 1`, but `events = 0`. The log is missing its line.

Then we restart the watcher. You might hope the restart repairs things. It does not. The watcher looks for tasks with `status = 'pending'` ([watcher.js#L46](../watcher.js#L46)). Task 1 is `claimed`, so the restarted watcher says `no pending task found` and exits. Nobody will ever start task 1 again. We call this **stuck**.

### Why the restart cannot tell what happened

After the crash, the database holds one row: `status = claimed`, `claimed_by = A`. That row looks exactly the same in two different worlds:

- Watcher A is alive and busy with task 1 right now.
- Watcher A died after the first write.

The row does not say which one is true. A restarted watcher that took every `claimed` task would risk starting a task that another watcher is already handling. That is why the watcher takes only `pending` tasks, and why the dead watcher's task is lost. The way out is to make the half-written state impossible. Part 2 does that.

When you run the script, the console also prints what the restarted watcher said. In both crash cases it is `no pending task found` ([watcher.js#L48](../watcher.js#L48)).

## What the script does

[crash.js](crash.js) runs each case on SQLite and, if it is running, on PostgreSQL. Each case is a call to `crashThenRestart`.

| Step | What happens | Code |
| --- | --- | --- |
| 1 | Make a fresh database with empty tables. | [crash.js#L21](crash.js#L21) |
| 2 | Add one `pending` task. It gets id 1. | [crash.js#L22](crash.js#L22) |
| 3 | Start the watcher with `crashAfter` set to `claim` or `session` and no transaction. | [crash.js#L23](crash.js#L23) |
| 4 | The watcher runs its writes, then kills itself after the chosen one. | [watcher.js#L59-L63](../watcher.js#L59-L63) |
| 5 | Read task 1: status, who claimed it, how many sessions and events. | [crash.js#L24](crash.js#L24) |
| 6 | Start the watcher again, with nothing to crash. | [crash.js#L25](crash.js#L25) |
| 7 | Read task 1 again. | [crash.js#L26](crash.js#L26) |
| 8 | Give each result a verdict. | [crash.js#L33-L39](crash.js#L33-L39) |
| 9 | Loop over both databases and both crash points. | [crash.js#L63-L71](crash.js#L63-L71) |
| 10 | Write `results.md` with three tables. | [crash.js#L78-L91](crash.js#L78-L91) |
| 11 | Draw `chart.svg` from the last table. | [crash.js#L41-L54](crash.js#L41-L54) |

## Where each number comes from

| In the tables | Where it comes from |
| --- | --- |
| `steps` | The messages the watcher sent with `step()` before it died ([watcher.js#L21](../watcher.js#L21)). The text `process killed` is sent just before the SIGKILL ([watcher.js#L25](../watcher.js#L25)). |
| `status`, `claimed by` | The `status` and `claimed_by` columns of task 1, read by `taskState` ([toolkit/db.js#L195-L199](../../../toolkit/db.js#L195-L199)). `claimed by` shows `A`, the watcher's default name ([watcher.js#L16](../watcher.js#L16)). A task nobody has claimed would show `nobody`. |
| `sessions` | `COUNT(*)` of rows in `sessions` with `task_id = 1` ([toolkit/db.js#L197](../../../toolkit/db.js#L197)). |
| `events` | `COUNT(*)` of rows in `events` with `task_id = 1` ([toolkit/db.js#L198](../../../toolkit/db.js#L198)). |
| `verdict` | The `verdict` function: `claimed` with 0 sessions is `stuck`; 1 session and 0 events is `half` ([crash.js#L33-L39](crash.js#L33-L39)). |
| Bar heights in the chart | `sessions` and `events` from the `After the restart` table. A bar is green when the value is 1 and red otherwise ([crash.js#L49-L50](crash.js#L49-L50)). |

## The real results

These are copied from [results.md](results.md).

Recorded 2026-10-29 08:49 UTC with Node.js 22.22.2, SQLite 3.51.2, PostgreSQL 17.11.

### What the watcher did before it died

| database | crash after | steps |
| --- | --- | --- |
| sqlite | claim | claim written for task 1, process killed |
| sqlite | session | claim written for task 1, session written for task 1, process killed |
| postgres | claim | claim written for task 1, process killed |
| postgres | session | claim written for task 1, session written for task 1, process killed |

### Right after the crash

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| sqlite | session | claimed | A | 1 | 0 | half: session, no event |
| postgres | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| postgres | session | claimed | A | 1 | 0 | half: session, no event |

### After the restart

The restarted watcher looks for pending tasks. Task 1 is no longer pending, so nobody will ever start it again.

| database | crash after | status | claimed by | sessions | events | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| sqlite | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| sqlite | session | claimed | A | 1 | 0 | half: session, no event |
| postgres | claim | claimed | A | 0 | 0 | stuck: claimed, no session |
| postgres | session | claimed | A | 1 | 0 | half: session, no event |

Look at the two tables for each case: they are the same. The restart changed nothing. SQLite and PostgreSQL behave the same way.

## The chart

![Bar chart of sessions and events for task 1 after the restart, with no transaction](chart.svg)

Red bars are missing rows: after a crash following the claim there are 0 sessions and 0 events, and after a crash following the session there is 1 session but 0 events.

## What the test checks

[crash.test.js](crash.test.js) runs the same cases on both databases. PostgreSQL tests are skipped when PostgreSQL is not running ([crash.test.js#L11](crash.test.js#L11)).

- Crash after the claim: the watcher process really died, and the verdict after the restart is `stuck: claimed, no session` ([crash.test.js#L13-L17](crash.test.js#L13-L17)).
- Crash after the session: the verdict after the restart is `half: session, no event` ([crash.test.js#L19-L22](crash.test.js#L19-L22)).

The test passes when the task is broken. It protects the lesson, not the watcher.

## Try this

Each change makes the script overwrite `results.md` and `chart.svg` with your run. If you use git, `git restore` brings the old files back. Put the code back when you are done.

1. **Crash after the third write.** In [crash.js#L64](crash.js#L64), change `["claim", "session"]` to `["claim", "session", "event"]`.
   - Expect a third case per database. All three writes have already run, and each one is saved at once, so the task has `status = claimed`, 1 session and 1 event. The verdict should be `clean: started once`.
   - Lesson: the damage depends on where the crash lands. Without a transaction you cannot choose where.
2. **Let the restarted watcher also look at claimed tasks.** In [watcher.js#L46](../watcher.js#L46), change `status = 'pending'` to `status IN ('pending', 'claimed')`.
   - Expect the crash-after-claim case to look fixed: the restart finds task 1, its claim matches 0 rows (the task is no longer `pending`, see [watcher.js#L51](../watcher.js#L51)), but the watcher does not look at that count, so it goes on to add 1 session and 1 event. The verdict should be `clean: started once`.
   - Expect the crash-after-session case to get worse: the restart adds a second session, so there are 2 sessions and 1 event, and the verdict should be `broken`.
   - Lesson: widening the search does not fix a missing transaction. It trades a stuck task for a duplicate session.
