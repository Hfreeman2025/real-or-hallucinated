import { mkdir, readFile, writeFile } from "node:fs/promises";

const pass = process.env.CRITIQUE_PASS ?? "pass-1";
const root = "shots/typography/after";
const out = `shots/typography/audit/${pass}`;
await mkdir(out, { recursive: true });
const captures = [];
for (const [file, prefix] of [
  [`${root}/${pass}/capture-report.json`, "detector"],
  [`${root}/${pass}/extra-captures.json`, "state"],
  [`${root}/${pass}/download-captures.json`, "download"],
  [`${root}/daily/${pass}/capture-report.json`, "daily"],
]) {
  const report = JSON.parse(await readFile(file, "utf8"));
  captures.push(...report.captures.map((c) => ({ ...c, name: `${prefix}: ${c.name}` })));
}
await writeFile(`${out}/capture-report.json`, JSON.stringify({ captures }, null, 2));
process.env.EVIDENCE_DIR = "shots/typography/audit";
await import("./contact-sheet.mjs");
