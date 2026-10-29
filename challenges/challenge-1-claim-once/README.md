# Challenge 1: claim once

## Why this matters

You write a small program. It works. Then one day you start it twice by accident: two terminals, or an old copy that never stopped after a restart. Now the same job runs two times, and nothing told you.

That is the bug in this challenge. You will make it happen on purpose, count it, fix it, and then add a second layer of protection. You will run every step on three databases: SQLite, PostgreSQL and MySQL.

The story:

1. A command-line tool adds **tasks** to a database.
2. A **watcher** checks the database every 500 ms. For each pending task it **claims** the task and creates one **session** for it.
3. Start two watchers, and some tasks get two sessions.

The scripts poll every 50 ms instead of 500 ms, so a run takes seconds, not minutes.

## 101: the words used in this challenge

| Word | Plain meaning |
| --- | --- |
| task | One job to do. It is a row in the `tasks` table. The tool adds it with status `pending`. |
| watcher | A program that keeps running and looks for pending tasks. |
| poll | One check of the database, on a timer. "Poll every 500 ms" means "ask again every half second". |
| claim | Take a task for yourself: change its `status` from `pending` to `claimed` and write your name in `claimed_by`. |
| session | The work space the watcher creates for a claimed task. It is a row in the `sessions` table. One task should have exactly one. |
| connection | One open line between a program and the database. Each connection can be in the middle of its own steps. |
| row | One record in a table. A task is one row. A session is one row. |
| rows changed | The number the database gives back after an `UPDATE`: how many rows it changed. `0` means no row matched. |
| race | A bug where the result depends on which program is a little faster. It may not show up every time. |
| interleaving | The order in which steps of two programs are mixed. "A reads, B reads, A writes" is a different interleaving from "A reads, A writes, B reads". |
| process | One running copy of a program, with its own memory. Two watchers are two processes. |
| unique index | A rule the database checks on every write: no two rows may have the same value in a column. A second row with the same value is refused. |
| SQLite | A database that is one file. It is built into Node.js, so it needs nothing extra. |
| PostgreSQL | A database server. In this repository it runs in Docker. |
| MySQL | Another database server. It also runs in Docker. |
| `RETURNING` | Words you add to an `UPDATE` so the database sends back the rows it changed. SQLite and PostgreSQL have it. MySQL does not. |
| `LAST_INSERT_ID(id)` | A MySQL function. Inside an `UPDATE` it remembers the `id` of the row the `UPDATE` changed. You read it back with `SELECT LAST_INSERT_ID()`. MySQL uses it where the other two use `RETURNING`. |
| insert or do nothing | An `INSERT` that does not fail when the unique index says the row already exists. It changes 0 rows instead. Each database spells it differently (part 4). |

The three tables are created in [`toolkit/db.js`](../../toolkit/db.js#L34-L91), once for each database. A task has `id`, `title`, `status` (`pending`, `claimed`, `running`, `done` or `failed`) and `claimed_by`. A session has `id`, `task_id` and `worker`. The `events` table is a log of what happened. The tables are the same on all three databases. MySQL only needs a length for its text columns, so it writes `VARCHAR` where the other two write `TEXT`.

## How to run

You need Node.js 22.13 or newer (see [`package.json`](../../package.json)) and Docker for PostgreSQL and MySQL. SQLite is built into Node.js, so it needs nothing extra.

From the repository root:

```
npm install
npm run db:up
npm run doctor
```

`npm run db:up` starts PostgreSQL 17 on port 5440 and MySQL 8.4 on port 5441, both in Docker (see [`docker-compose.yml`](../../docker-compose.yml)). MySQL needs about 30 seconds to start the first time.

`npm run doctor` checks your setup. When everything is ready it shows five OK lines: Node.js, SQLite, the `pg` and `mysql2` packages, PostgreSQL and MySQL. A line that says FIX tells you what to do.

Without Docker, the scripts still run, on SQLite only. A database that is not running is skipped, and the script tells you how to start it.

Then run each part from this folder:

```
cd challenges/challenge-1-claim-once
node part-1-the-race/race.js
node part-2-the-fix/claim.js
node part-3-safety-net/safety.js
node part-4-claim-by-insert/insert.js
```

Each script runs on every database that is running, rewrites its own `results.md` and redraws its charts. Your numbers will differ from the ones in this repository, because a race depends on timing. Add `--chart` to redraw only the charts from the existing `results.md`.

To run the tests, go back to the repository root:

```
npm test
```

This runs the tests of every challenge. The tests of a database that is not running are skipped.

## The shared watcher

All four parts use the same watcher: [`watcher.js`](watcher.js). The part scripts start two copies of it as two separate processes, with [`runWorkers`](../../toolkit/workers.js#L9-L30). Each copy gets a name (`A`, `B`), and both receive "go" at the same moment.

| Step | What the watcher does | Code |
| --- | --- | --- |
| 1 | Open its own connection to the database. | [`watcher.js#L74`](watcher.js#L74) |
| 2 | Keep looping until it sees three empty polls in a row (the queue is empty). | [`watcher.js#L78-L80`](watcher.js#L78-L80) |
| 3 | Poll: `SELECT` the ids of up to `batch` pending tasks. | [`watcher.js#L123-L126`](watcher.js#L123-L126) |
| 4 | Count the poll. Count an empty poll if nothing was pending. | [`watcher.js#L127-L128`](watcher.js#L127-L128) |
| 5 | For each task, try to claim it. The claim style is chosen by the part. | [`watcher.js#L129-L130`](watcher.js#L129-L130) |
| 6 | Claim style 1, `read-then-update` (part 1, part 3): `UPDATE` with no check. | [`watcher.js#L9-L14`](watcher.js#L9-L14) |
| 7 | Claim style 2, `condition` (part 2, part 3): `UPDATE ... AND status = 'pending'`, then look at rows changed. | [`watcher.js#L16-L28`](watcher.js#L16-L28) |
| 8 | Claim style 3, `one-statement` (part 2): find and claim the next task in one statement. SQLite and PostgreSQL use `RETURNING`. | [`watcher.js#L30-L42`](watcher.js#L30-L42) and [`watcher.js#L103-L122`](watcher.js#L103-L122) |
| 9 | Claim style 3 on MySQL: no `RETURNING`, so `claimNextMysql` uses `LAST_INSERT_ID(id)`. | [`watcher.js#L44-L56`](watcher.js#L44-L56) |
| 10 | Claim style 4, `insert` (part 4): the session `INSERT` is the claim. If it changes 1 row, mark the task claimed and log the event. | [`watcher.js#L81-L102`](watcher.js#L81-L102) |
| 11 | If the claim worked: count it and create the session. | [`watcher.js#L130-L132`](watcher.js#L130-L132) |
| 12 | Create the session: `INSERT` into `sessions`, then into `events`. If the database refuses a second session (part 3), count it as `refused`. | [`watcher.js#L60-L71`](watcher.js#L60-L71) |
| 13 | If the claim did not work: count it as `lost`. | [`watcher.js#L133-L135`](watcher.js#L133-L135) |
| 14 | Sleep for `pollMs`, then poll again. | [`watcher.js#L137`](watcher.js#L137) |
| 15 | When the queue is empty: close the connection and send back a report. | [`watcher.js#L139-L140`](watcher.js#L139-L140) |

The report has five counters: `polls`, `claimed`, `lost`, `created` and `refused` ([`watcher.js#L77`](watcher.js#L77)).

Two things are different on MySQL, and `watcher.js` shows both. MySQL has no `RETURNING`, so `claimNextMysql` claims with `UPDATE ... ORDER BY id LIMIT 1` and then reads the id back with `SELECT LAST_INSERT_ID()`. And when the database refuses a second session, MySQL's error code is `ER_DUP_ENTRY`, not the codes of the other two. The toolkit knows all three spellings in [`isDuplicateKey`](../../toolkit/db.js#L237-L240).

## Part 1: the race

[Read the part 1 README](part-1-the-race/README.md). Two watchers read the same pending task, and both claim it. On a run with 200 tasks, SQLite saved 348 sessions, PostgreSQL saved 355 and MySQL saved 360.

![Timeline of part 1: both watchers read task 1 as pending, then both claim it](part-1-the-race/chart.svg)

## Part 2: the fix

[Read the part 2 README](part-2-the-fix/README.md). One extra condition in the `UPDATE`, and a look at rows changed. Every task gets one session on all three databases. A claim in one statement also works, but on PostgreSQL it sometimes finds nothing even when tasks are waiting: 22 empty answers in the recorded run, against 0 on SQLite and 0 on MySQL.

![Bars for part 2: sessions equal 200, no task has two sessions, and the races caught are shown in green](part-2-the-fix/chart-real-run.svg)

## Part 3: the safety net

[Read the part 3 README](part-3-safety-net/README.md). A unique index makes the database refuse a second session. It stops the double, but not the wrong owner it leaves behind, so it is a safety net and not the fix.

![Bars for part 3: with the bug and the index, the second sessions are refused but the owners do not match](part-3-safety-net/chart.svg)

## Part 4: claim by insert

[Read the part 4 README](part-4-claim-by-insert/README.md). Do not update the task first. Insert the session, and let the unique index decide. The first insert for a task works. Every later one is ignored and changes 0 rows. All three databases end with 200 sessions, 0 doubles and 0 wrong owners. Each database spells "insert or do nothing" in its own way, and the part README shows the three statements side by side. The price: the session row exists before any work starts.

![Bars for part 4: 200 sessions in every group, no task with two sessions, and the ignored inserts in green](part-4-claim-by-insert/chart-real-run.svg)

## What comes next

Challenge 2 asks what happens when a watcher crashes in the middle of its steps. Challenge 3 uses locks, including `SKIP LOCKED`, to let watchers share a queue without waiting for each other.
