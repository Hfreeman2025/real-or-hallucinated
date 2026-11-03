import { readFile, writeFile } from "node:fs/promises";

const pass = process.env.CRITIQUE_PASS ?? "pass-1";
const folder = `shots/v3/${pass}`;
const captures = [];
for (const [path, prefix] of [
  [`${folder}/capture-report.json`, "detector"],
  [`${folder}/extra-captures.json`, "state"],
  [`${folder}/download-captures.json`, "download"],
  [`shots/v3/daily/${pass}/capture-report.json`, "daily"],
  [`${folder}/live-report.json`, "live"],
]) {
  const report = JSON.parse(await readFile(path, "utf8"));
  for (const c of report.captures)
    if (!c.engine || c.engine === "chromium") captures.push({ ...c, name: `${prefix}: ${c.name}` });
}
await writeFile(`${folder}/all-captures.json`, `${JSON.stringify({ captures }, null, 2)}\n`);
// Reuse the silent, serial renderer against the combined report.
const original = await readFile(`${folder}/capture-report.json`);
try {
  await writeFile(`${folder}/capture-report.json`, JSON.stringify({ captures }));
  process.env.EVIDENCE_DIR = "shots/v3";
  await import("./contact-sheet.mjs");
} finally {
  await writeFile(`${folder}/capture-report.json`, original);
}
