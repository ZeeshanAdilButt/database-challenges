# Database challenges

By **Zeeshan Adil**. This repository goes with the course *Database Challenges: Races, Locks and Transactions* on Edorax. To start, press **Use this template** on GitHub to make your own copy.

Break a small task queue on purpose, on a real PostgreSQL, a real MySQL and a real SQLite database, watch it fail, then fix it with the right database tool.

The task queue is the same in every challenge. A command-line tool adds tasks. A watcher checks for new tasks every 500 ms, claims each one, and creates one session for it. The rules sound simple:

- each task is claimed exactly once, and gets exactly one session;
- a task only moves along allowed steps: pending, claimed, running, then done or failed;
- after a crash or a restart, nothing is left half-done or stuck.

Each challenge breaks one of these rules and then fixes it. Every script runs the same steps on every database that is running and writes what really happened to a `results.md` file, with a chart drawn from it.

| Challenge | What breaks | What fixes it |
|---|---|---|
| [1. Claim once](challenges/challenge-1-claim-once/README.md) | Two watchers claim the same task and both create a session | A checked `UPDATE`, rows changed, and a unique index |
| [2. All or nothing](challenges/challenge-2-all-or-nothing/README.md) | A watcher dies between two writes and leaves a stuck task | A transaction, allowed moves, and a recovery step |
| [3. Locks](challenges/challenge-3-locks/README.md) | Workers wait for each other, or fail with "database is locked" | `FOR UPDATE`, `SKIP LOCKED`, `BEGIN IMMEDIATE` and a busy timeout |
| [4. Advisory locks and leases](challenges/challenge-4-advisory-locks/README.md) | A second copy of the watcher starts, or a dead watcher leaves its lock or its task behind | A named lock, a lease with an expiry, and a fencing token |
| 5. Optimistic locking | Coming soon | |

## What you need

- **Node.js 22.13 or newer** (24 recommended). SQLite is built into Node.js as `node:sqlite`, so there is nothing else to install for it. Node.js 22 prints an "ExperimentalWarning" about SQLite; that is expected.
- **Docker** (Docker Desktop on Windows and macOS, or Docker Engine on Linux) for PostgreSQL 17 and MySQL 8.4.
- Git, and a terminal.

## Start

```bash
npm install          # installs pg and mysql2, the PostgreSQL and MySQL drivers (the only packages)
npm run db:up        # starts PostgreSQL 17 on port 5440 and MySQL 8.4 on port 5441, in Docker
npm run doctor       # checks your setup: five OK lines when everything is ready
npm test             # runs every challenge's tests on every database that is running
```

MySQL takes about 30 seconds to start the first time. If `npm run doctor` shows a FIX line for MySQL, wait a little and run it again.

No Docker? Every script and test still runs the SQLite half and says which databases were skipped.

Then open a challenge and run its parts one by one, for example:

```bash
node challenges/challenge-1-claim-once/part-1-the-race/race.js
```

Each script prints a short report and rewrites the part's `results.md` and `chart.svg` with your own numbers. Add `--chart` to redraw the chart from `results.md` without running again.

When you are done, `npm run db:down` stops PostgreSQL and MySQL.

## How the folders work

```text
toolkit/
  db.js        one small interface for the three databases, the tables, helpers
  workers.js   start several watcher processes at the same moment
  results.js   write results.md, and read its tables back
  chart.js     draw SVG charts from those tables
challenges/challenge-N-name/
  README.md    the challenge: why it matters, a 101 glossary, the parts
  part-N-name/ README.md, one script, its test, results.md, chart.svg
```

The PostgreSQL connection is `postgresql://challenge:challenge@127.0.0.1:5440/challenges`. Set `DATABASE_URL` to use another one. The MySQL connection is `mysql://challenge:challenge@127.0.0.1:5441/challenges`. Set `MYSQL_URL` to use another one. SQLite files go in `.cache/`, one per script.
