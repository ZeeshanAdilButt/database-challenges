// toolkit/workers.js: run several copies of a worker script at the same
// time, as separate processes, like two watchers started by accident.
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

// Start `count` copies of `scriptUrl`. Each copy gets its name (A, B, ...)
// and `options`. All copies get "go" at the same moment, so they really
// overlap. Resolves with the report each copy sent back.
export async function runWorkers(scriptUrl, count, options) {
  const names = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
  const children = names.map((name) =>
    fork(fileURLToPath(scriptUrl), [], { env: { ...process.env, WORKER: name } }),
  );
  const message = (child, type) =>
    new Promise((resolve, reject) => {
      child.on("message", (m) => m.type === type && resolve(m));
      child.once("exit", (code) => code !== 0 && reject(new Error(`worker exited with code ${code}`)));
    });
  // Wait until every copy has opened its connection, then start them together.
  await Promise.all(children.map((child, i) => {
    const ready = message(child, "ready");
    child.send({ type: "setup", name: names[i], options });
    return ready;
  }));
  const done = children.map((child) => message(child, "done"));
  for (const child of children) child.send({ type: "go" });
  const reports = await Promise.all(done);
  for (const child of children) child.disconnect();
  return reports.map((m) => m.report);
}

// Start one copy of `scriptUrl` with `options` and wait until it exits, even
// if it crashes. Resolves with how it ended and the steps it reported.
export function runUntilExit(scriptUrl, options) {
  const child = fork(fileURLToPath(scriptUrl), [], { env: { ...process.env, OPTIONS: JSON.stringify(options) } });
  const steps = [];
  child.on("message", (m) => m.type === "step" && steps.push(m.step));
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal, crashed: code !== 0, steps }));
  });
}

// The worker side. `setup(name, options)` opens connections and returns the
// function to run on "go"; that function returns a report object.
export function workerMain(setup) {
  // Only when started by runWorkers; importing the file does nothing.
  if (!process.send) return;
  let work;
  process.on("message", async (m) => {
    if (m.type === "setup") {
      work = await setup(m.name, m.options);
      process.send({ type: "ready" });
    } else if (m.type === "go") {
      const report = await work();
      process.send({ type: "done", report });
    }
  });
}
