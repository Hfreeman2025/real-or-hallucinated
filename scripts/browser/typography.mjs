import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { assertQuiet, base, launch, pageFor, sizes } from "./runtime.mjs";

const phase = process.env.TYPE_PHASE ?? "before";
assert.ok(["before", "after"].includes(phase));
const unreserved = process.env.TYPE_RESERVATIONS === "off";
const slowData = process.env.TYPE_SLOW_DATA === "1";
const warmReload = process.env.TYPE_WARM_RELOAD === "1";
const out = `shots/typography/${unreserved ? "unreserved" : phase}${slowData ? "/slow-startup" : warmReload ? "/warm-reload" : ""}`;
await mkdir(out, { recursive: true });
// Refuse launch if another automation browser is active; idle MCP servers are not browsers.
const occupied = execFileSync("ps", ["-axo", "pid,ppid,comm"], { encoding: "utf8" })
  .split("\n")
  .filter((l) =>
    /Google Chrome for Testing\.app|chrome-headless-shell|Playwright\.app|\/MiniBrowser|\/firefox(?:\s|$)/.test(
      l,
    ),
  );
assert.deepEqual(occupied, [], `Browser slot occupied: ${occupied.join("\n")}`);
const browser = await launch("chromium");
const results = [];
try {
  for (const size of sizes)
    for (const view of ["detector", "daily"]) {
      const f = await pageFor(browser, { size, reducedMotion: "no-preference" });
      try {
        if (slowData)
          await f.page.route(
            /\/assets\/(?:puzzles|detector-recording)-[^/]+\.js$/,
            async (route) => {
              // Deliberate network fixture, not a workaround for application races.
              await new Promise((resolve) => setTimeout(resolve, 250));
              await route.continue();
            },
          );
        if (unreserved) {
          await f.page.route("**/startup.css", (route) =>
            route.fulfill({ contentType: "text/css", body: "" }),
          );
          await f.page.route("**/bootstrap.js", (route) =>
            route.fulfill({ contentType: "text/javascript", body: "" }),
          );
        }
        await f.page.addInitScript(() => {
          window.__typeShifts = [];
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              if (!e.hadRecentInput)
                window.__typeShifts.push({
                  value: e.value,
                  startTime: e.startTime,
                  sources: e.sources?.map((s) => ({
                    node: s.node?.id || s.node?.className || s.node?.nodeName,
                    previous: s.previousRect.toJSON?.() ?? s.previousRect,
                    current: s.currentRect.toJSON?.() ?? s.currentRect,
                  })),
                });
          }).observe({ type: "layout-shift", buffered: true });
        });
        await f.page.goto(`${base}/?view=${view}`);
        await f.page.waitForSelector(
          view === "detector" ? "#cluster-stage.is-grouped" : ".claim-text",
        );
        await f.page.evaluate(() => document.fonts.ready);
        if (warmReload) {
          await f.page.reload();
          await f.page.waitForSelector(
            view === "detector" ? "#cluster-stage.is-grouped" : ".claim-text",
          );
          await f.page.evaluate(() => document.fonts.ready);
        }
        await f.page.waitForTimeout(1800);
        const snapshot = await f.page.evaluate(() => ({
          preloads: document.querySelectorAll('link[rel="preload"][as="font"]').length,
          cls: window.__typeShifts.reduce((s, e) => s + e.value, 0),
          shifts: window.__typeShifts,
          fonts: document.fonts.status,
          body: getComputedStyle(document.body).fontFamily,
          wordmark: getComputedStyle(document.querySelector("h1")).fontFamily,
          overflow: document.documentElement.scrollWidth > innerWidth,
          fontResources: performance
            .getEntriesByType("resource")
            .filter((e) => /woff2/.test(e.name))
            .map((e) => e.name),
        }));
        results.push({ view, size, ...snapshot });
        await writeFile(`${out}/report.json`, `${JSON.stringify({ phase, results }, null, 2)}\n`);
        if (phase === "after" && !unreserved)
          assert.equal(
            snapshot.preloads,
            warmReload ? 0 : 2,
            "Critical fonts preload only on cold navigation",
          );
        assert.ok(!snapshot.overflow, `${view} ${size.name} no overflow`);
        if (phase === "after" && view === "detector") {
          assert.ok(
            await f.page.locator(".sample-card").evaluateAll((cards) =>
              cards.every((card) => {
                const r = card.getBoundingClientRect();
                return r.top >= 0 && r.bottom <= innerHeight;
              }),
            ),
            `${size.name}: all five opening answers fit the viewport`,
          );
          assert.ok(snapshot.body.includes("IBM Plex Sans"));
          assert.ok(snapshot.wordmark.includes("IBM Plex Sans Condensed"));
          assert.ok(
            await f.page
              .locator("#entropy-number")
              .evaluate((el) => getComputedStyle(el).fontFamily.includes("IBM Plex Mono")),
          );
          assert.ok(snapshot.fontResources.length >= 3);
        }
        await f.page.screenshot({ path: `${out}/${size.name}-${view}.png` });
        if (view === "detector") {
          await f.page.locator(".sample-card").first().click();
          await f.page.locator(".token").first().focus();
          await f.page.screenshot({ path: `${out}/${size.name}-tokens.png` });
          await f.page.locator("#open-entailment").click();
          await f.page.screenshot({ path: `${out}/${size.name}-entailment.png` });
          await f.page.locator("#detector-question").selectOption("h-30");
          await f.page.locator('[data-guess="real"]').click();
          await f.page.locator("#detector-truth").scrollIntoViewIfNeeded();
          await f.page.screenshot({
            path: `${out}/${size.name}-detector-proof.png`,
            fullPage: true,
          });
        } else {
          await f.page.locator("#answer-real").click();
          await f.page.screenshot({ path: `${out}/${size.name}-daily-proof.png`, fullPage: true });
        }
        assertQuiet(f.issues, f.requests, `${phase} ${view} ${size.name}`);
      } finally {
        await f.context.close();
      }
    }
} finally {
  await browser.close();
}
await writeFile(`${out}/report.json`, `${JSON.stringify({ phase, results }, null, 2)}\n`);
console.log(JSON.stringify(results.map(({ view, size, cls }) => ({ view, size: size.name, cls }))));

if (process.env.TYPE_ENFORCE_ZERO === "1")
  for (const result of results)
    assert.equal(result.cls, 0, `${result.view} ${result.size.name}: total startup CLS`);
