// toolkit/doctor.js: check your setup before the first challenge.
//   npm run doctor
// Each line says OK or what to fix. Nothing here changes your machine.
import { PG_URL, postgresIsUp } from "./db.js";

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

let pg = false;
try {
  await import("pg");
  pg = true;
} catch {}
ok(pg, "the pg package", "Run: npm install");

const up = pg && (await postgresIsUp());
ok(up, `PostgreSQL at ${PG_URL}`,
  "Start Docker Desktop (or Docker Engine), then run: npm run db:up. Wait 10 seconds and run npm run doctor again. " +
  "If port 5440 is taken, change it in docker-compose.yml and set DATABASE_URL to match.");

console.log(lines.join("\n"));
console.log(up ? "\nAll set." : "\nSQLite parts will still run. PostgreSQL parts are skipped until the FIX lines are done.");
