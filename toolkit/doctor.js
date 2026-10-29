// toolkit/doctor.js: check your setup before the first challenge.
//   npm run doctor
// Each line says OK or what to fix. Nothing here changes your machine.
const [major, minor] = process.versions.node.split(".").map(Number);
const lines = [];
const ok = (good, text, fix) => lines.push(`${good ? "OK " : "FIX"} ${text}${good ? "" : `\n    ${fix}`}`);

ok(major > 22 || (major === 22 && minor >= 13), `Node.js ${process.versions.node}`,
  "Install Node.js 24 (or 22.13 or newer) from https://nodejs.org, then open a new terminal.");

let sqlite = false;
try {
  const { DatabaseSync } = await import("node:sqlite");
  new DatabaseSync(":memory:").close();
  sqlite = true;
} catch {}
ok(sqlite, `SQLite built into Node.js (${process.versions.sqlite ?? "missing"})`,
  "Your Node.js has no node:sqlite. Install Node.js 24.");

// The toolkit needs both drivers, so check them before loading it.
let drivers = false;
try {
  await import("pg");
  await import("mysql2/promise");
  drivers = true;
} catch {}
ok(drivers, "the pg and mysql2 packages", "Run: npm install");

let pgUp = false;
let myUp = false;
if (drivers) {
  const { MYSQL_URL, PG_URL, mysqlIsUp, postgresIsUp } = await import("./db.js");
  pgUp = await postgresIsUp();
  ok(pgUp, `PostgreSQL at ${PG_URL}`,
    "Start Docker Desktop (or Docker Engine), then run: npm run db:up. Wait 10 seconds and run npm run doctor again. " +
    "If port 5440 is taken, change it in docker-compose.yml and set DATABASE_URL to match.");
  myUp = await mysqlIsUp();
  ok(myUp, `MySQL at ${MYSQL_URL}`,
    "Run npm run db:up and wait about 30 seconds: MySQL takes longer than PostgreSQL to start the first time. " +
    "If port 5441 is taken, change it in docker-compose.yml and set MYSQL_URL to match.");
}

console.log(lines.join("\n"));
console.log(pgUp && myUp
  ? "\nAll set."
  : "\nSQLite parts will still run. The other databases are skipped until their FIX lines are done.");
