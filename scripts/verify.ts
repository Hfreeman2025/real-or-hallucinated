import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { extractContext } from "../src/context.ts";
import { londonDate } from "../src/core.ts";
import { quoteMatches } from "../src/matching.ts";
import { parseBank } from "../src/schema.ts";
import { withVerifiedContexts } from "./context-refresh.ts";
import { fetchSource } from "./source-fetch.ts";

// Deliberately no cache fallback: a failed fetch must never be reported as a fresh verification.
const bank = parseBank(
  JSON.parse(await readFile(new URL("../data/puzzles.json", import.meta.url), "utf8")),
);
const claims = bank.puzzles.flatMap((puzzle) => puzzle.claims);
const urls = [...new Set(claims.map((claim) => claim.source.url))];
const started = performance.now();
const pages = new Map<string, { text: string; sha256: string }>();
const failures = new Map<string, string>();
const queue = [...urls];
async function worker() {
  for (let url = queue.shift(); url; url = queue.shift()) {
    try {
      pages.set(url, await fetchSource(url));
      console.log(`FETCHED ${url}`);
    } catch (error) {
      failures.set(url, error instanceof Error ? error.message : String(error));
      console.error(`FETCH FAILED ${url}: ${failures.get(url)}`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
const checks = claims.map((claim) => {
  const page = pages.get(claim.source.url);
  const matched = page !== undefined && quoteMatches(page.text, claim.evidence.quote);
  const context = matched && page ? extractContext(page.text, claim.evidence.quote) : null;
  const contextMatched =
    context !== null &&
    page !== undefined &&
    quoteMatches(page.text, context.before + context.match + context.after);
  return {
    id: claim.id,
    real: claim.real,
    method: claim.evidence.method,
    url: claim.source.url,
    matched: matched && contextMatched,
    context,
    sha256: page?.sha256 ?? null,
    error:
      failures.get(claim.source.url) ??
      (matched ? null : "Evidence quote missing from fetched page"),
  };
});
const failed = checks.filter((check) => !check.matched);
const report = {
  checkedAt: new Date().toISOString(),
  elapsedSeconds: Math.round((performance.now() - started) / 100) / 10,
  uniqueSources: urls.length,
  realClaims: claims.filter((c) => c.real).length,
  fabrications: claims.filter((c) => !c.real).length,
  passed: checks.length - failed.length,
  failed: failed.length,
  meaning:
    "Quote presence only. Supporting and contradicting meaning was assessed during original authoring. No failed fetch uses cached content.",
  checks,
};
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/verification.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  `${report.passed}/${checks.length} evidence quotes matched across ${urls.length} sources in ${report.elapsedSeconds}s.`,
);
for (const check of failed) console.error(`${check.id}: ${check.error}`);
if (failed.length) process.exitCode = 1;
else {
  const contexts = new Map(
    checks.flatMap((check) => (check.context ? [[check.id, check.context] as const] : [])),
  );
  const refreshed = withVerifiedContexts(bank, contexts, londonDate());
  const bankUrl = new URL("../data/puzzles.json", import.meta.url);
  const temporary = new URL("../data/puzzles.verified.tmp", import.meta.url);
  await writeFile(temporary, `${JSON.stringify(refreshed, null, 2)}\n`);
  await rename(temporary, bankUrl);
  console.log("Saved freshly fetched surrounding source sentences for all 70 claims.");
}
