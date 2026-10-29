// toolkit/chart.js: two small SVG charts. SVG is a text format for pictures
// that GitHub shows directly inside a README.
import fs from "node:fs";

const COLORS = { ok: "#1f7a4d", bad: "#c0392b", wait: "#b9770e", plain: "#34495e" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A timeline: one row (lane) per worker, one box per step, left to right in
// the order the steps happened.
// steps: [{ lane: "Watcher A", label: "reads task 1: pending", tone: "bad" }]
export function timelineChart(file, { title, lanes, steps }) {
  const boxW = 150;
  const gap = 12;
  const laneH = 64;
  const left = 110;
  const top = 50;
  const width = left + steps.length * (boxW + gap) + 20;
  const height = top + lanes.length * laneH + 40;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif" font-size="12">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="12" y="26" font-size="16" font-weight="bold" fill="#111">${esc(title)}</text>`,
  ];
  lanes.forEach((lane, i) => {
    const y = top + i * laneH;
    parts.push(`<line x1="${left}" y1="${y + laneH / 2}" x2="${width - 10}" y2="${y + laneH / 2}" stroke="#ccc"/>`);
    parts.push(`<text x="12" y="${y + laneH / 2 + 4}" font-weight="bold" fill="#111">${esc(lane)}</text>`);
  });
  steps.forEach((step, k) => {
    const lane = lanes.indexOf(step.lane);
    const x = left + k * (boxW + gap);
    const y = top + lane * laneH + 8;
    const color = COLORS[step.tone] ?? COLORS.plain;
    parts.push(`<rect x="${x}" y="${y}" width="${boxW}" height="${laneH - 16}" rx="6" fill="${color}"/>`);
    const words = wrap(step.label, 22);
    words.forEach((line, j) => {
      parts.push(`<text x="${x + 8}" y="${y + 18 + j * 14}" fill="#fff">${esc(line)}</text>`);
    });
    parts.push(`<text x="${x + boxW / 2}" y="${height - 14}" text-anchor="middle" fill="#555">${k + 1}</text>`);
  });
  parts.push(`<text x="12" y="${height - 14}" fill="#555">step</text>`, `</svg>`);
  fs.writeFileSync(file, parts.join("\n"));
}

// Grouped bars: one group per label, one bar per series.
// groups: [{ label: "SQLite", bars: [{ name: "read, then update", value: 12, tone: "bad" }] }]
export function barChart(file, { title, unit, groups }) {
  const barW = 56;
  const groupGap = 50;
  const left = 60;
  const top = 50;
  const plotH = 220;
  const seriesNames = [...new Set(groups.flatMap((g) => g.bars.map((b) => b.name)))];
  const groupW = seriesNames.length * (barW + 8);
  const width = Math.max(left + groups.length * (groupW + groupGap) + 20, 420);
  const height = top + plotH + 60 + seriesNames.length * 18;
  const max = Math.max(1, ...groups.flatMap((g) => g.bars.map((b) => b.value)));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif" font-size="12">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="12" y="26" font-size="16" font-weight="bold" fill="#111">${esc(title)}</text>`,
    `<line x1="${left}" y1="${top + plotH}" x2="${width - 10}" y2="${top + plotH}" stroke="#888"/>`,
    `<text x="12" y="${top + 10}" fill="#555">${esc(unit)}</text>`,
  ];
  groups.forEach((group, g) => {
    const gx = left + 10 + g * (groupW + groupGap);
    group.bars.forEach((bar) => {
      const k = seriesNames.indexOf(bar.name);
      const h = Math.round((bar.value / max) * plotH);
      const x = gx + k * (barW + 8);
      const color = COLORS[bar.tone] ?? COLORS.plain;
      parts.push(`<rect x="${x}" y="${top + plotH - h}" width="${barW}" height="${Math.max(h, 1)}" fill="${color}"/>`);
      parts.push(`<text x="${x + barW / 2}" y="${top + plotH - h - 6}" text-anchor="middle" fill="#111">${bar.value}</text>`);
    });
    parts.push(`<text x="${gx + groupW / 2 - 4}" y="${top + plotH + 18}" text-anchor="middle" font-weight="bold" fill="#111">${esc(group.label)}</text>`);
  });
  seriesNames.forEach((name, k) => {
    const tone = groups.flatMap((g) => g.bars).find((b) => b.name === name)?.tone;
    const y = top + plotH + 40 + k * 18;
    parts.push(`<rect x="${left}" y="${y - 10}" width="12" height="12" fill="${COLORS[tone] ?? COLORS.plain}"/>`);
    parts.push(`<text x="${left + 18}" y="${y}" fill="#111">${esc(name)}</text>`);
  });
  parts.push(`</svg>`);
  fs.writeFileSync(file, parts.join("\n"));
}

function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// Bars on a real time axis: one row per worker, each bar from `from` to
// `to` milliseconds. Use it to see who waited, and for how long.
// bars: [{ lane: "Watcher B", from: 52, to: 310, label: "waits for the lock", tone: "wait" }]
export function waitChart(file, { title, lanes, bars }) {
  const left = 110;
  const top = 50;
  const laneH = 56;
  const plotW = 640;
  const end = Math.max(1, ...bars.map((b) => b.to));
  const x = (ms) => left + (ms / end) * plotW;
  const width = left + plotW + 30;
  const height = top + lanes.length * laneH + 50;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif" font-size="12">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="12" y="26" font-size="16" font-weight="bold" fill="#111">${esc(title)}</text>`,
  ];
  lanes.forEach((lane, i) => {
    parts.push(`<text x="12" y="${top + i * laneH + laneH / 2 + 4}" font-weight="bold" fill="#111">${esc(lane)}</text>`);
  });
  for (const bar of bars) {
    const i = lanes.indexOf(bar.lane);
    const y = top + i * laneH + 10;
    const w = Math.max(x(bar.to) - x(bar.from), 2);
    parts.push(`<rect x="${x(bar.from)}" y="${y}" width="${w}" height="${laneH - 20}" rx="4" fill="${COLORS[bar.tone] ?? COLORS.plain}"/>`);
    if (w > 60) parts.push(`<text x="${x(bar.from) + 6}" y="${y + laneH / 2 - 6}" fill="#fff">${esc(bar.label)}</text>`);
  }
  const axisY = top + lanes.length * laneH + 10;
  parts.push(`<line x1="${left}" y1="${axisY}" x2="${left + plotW}" y2="${axisY}" stroke="#888"/>`);
  for (let k = 0; k <= 4; k++) {
    const ms = Math.round((end * k) / 4);
    parts.push(`<text x="${x(ms)}" y="${axisY + 16}" text-anchor="middle" fill="#555">${ms} ms</text>`);
  }
  parts.push(`</svg>`);
  fs.writeFileSync(file, parts.join("\n"));
}
