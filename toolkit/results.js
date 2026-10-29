// toolkit/results.js: write a results.md file, and read its tables back.
// Charts are always drawn from results.md, so the picture and the table
// can never disagree.
import fs from "node:fs";

// recordedWith: the versions line from versions() in toolkit/db.js.
// sections: [{ heading, text, columns: ["a", "b"], rows: [{ a: 1, b: 2 }] }]
export function writeResults(file, title, recordedWith, sections) {
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  const lines = [`# ${title}`, "", `Recorded ${when} UTC with ${recordedWith}.`, ""];
  for (const section of sections) {
    lines.push(`## ${section.heading}`, "");
    if (section.text) lines.push(section.text, "");
    if (section.columns) {
      lines.push(`| ${section.columns.join(" | ")} |`);
      lines.push(`| ${section.columns.map(() => "---").join(" | ")} |`);
      for (const row of section.rows) {
        lines.push(`| ${section.columns.map((c) => String(row[c] ?? "")).join(" | ")} |`);
      }
      lines.push("");
    }
  }
  fs.writeFileSync(file, lines.join("\n"));
}

// The table under `## heading`, as a list of objects. Numbers become numbers.
export function readTable(file, heading) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`No "## ${heading}" in ${file}`);
  const table = [];
  let i = start + 1;
  while (i < lines.length && !lines[i].startsWith("|")) i++;
  while (i < lines.length && lines[i].startsWith("|")) table.push(lines[i++]);
  const cells = (line) => line.slice(1, -1).split("|").map((c) => c.trim());
  const columns = cells(table[0]);
  return table.slice(2).map((line) => {
    const values = cells(line);
    return Object.fromEntries(
      columns.map((c, k) => [c, values[k] !== "" && !Number.isNaN(Number(values[k])) ? Number(values[k]) : values[k]]),
    );
  });
}
