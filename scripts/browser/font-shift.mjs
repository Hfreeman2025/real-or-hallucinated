import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { assertQuiet, base, launch, pageFor, sizes } from "./runtime.mjs";

const active = execFileSync("ps", ["-axo", "pid,ppid,comm"], { encoding: "utf8" })
  .split("\n")
  .filter((l) =>
    /Google Chrome for Testing\.app|chrome-headless-shell|Playwright\.app|\/MiniBrowser|\/firefox(?:\s|$)/.test(
      l,
    ),
  );
assert.deepEqual(active, [], "Browser slot must be free");
await mkdir("shots/typography/after", { recursive: true });
const browser = await launch("chromium");
const results = [];
try {
  for (const size of sizes)
    for (const view of ["detector", "daily"]) {
      const f = await pageFor(browser, { size, reducedMotion: "reduce" });
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await f.page.addInitScript(() => {
          window.__fontShifts = [];
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              if (!e.hadRecentInput)
                window.__fontShifts.push({
                  value: e.value,
                  startTime: e.startTime,
                  sources: e.sources?.map((s) => ({
                    node: s.node?.id || s.node?.className || s.node?.nodeName,
                    parent:
                      s.node?.parentElement?.id ||
                      s.node?.parentElement?.className ||
                      s.node?.parentElement?.nodeName,
                    text: s.node?.textContent?.slice(0, 100),
                    previous: s.previousRect.toJSON?.() ?? s.previousRect,
                    current: s.currentRect.toJSON?.() ?? s.currentRect,
                  })),
                });
          }).observe({ type: "layout-shift", buffered: true });
        });
        await f.page.route(/\/fonts\/.*\.woff2$/, async (route) => {
          await gate;
          await route.continue();
        });
        await f.page.goto(`${base}/?view=${view}`, { waitUntil: "domcontentloaded" });
        await f.page.waitForSelector(
          view === "detector" ? "#cluster-stage.is-grouped" : ".claim-text",
        );
        await f.page.waitForTimeout(500);
        const boundary = await f.page.evaluate(() => performance.now());
        release();
        await f.page.evaluate(() => document.fonts.ready);
        await f.page.waitForTimeout(600);
        const result = await f.page.evaluate(
          (boundary) => ({
            fontBoundaryMs: boundary,
            fontSwapCls: window.__fontShifts
              .filter((e) => e.startTime >= boundary)
              .reduce((s, e) => s + e.value, 0),
            startupCls: window.__fontShifts
              .filter((e) => e.startTime < boundary)
              .reduce((s, e) => s + e.value, 0),
            entries: window.__fontShifts,
            fonts: document.fonts.status,
          }),
          boundary,
        );
        assertQuiet(f.issues, f.requests, `${size.name} ${view} delayed font swap`);
        results.push({ size, view, ...result });
      } finally {
        release();
        await f.context.close();
      }
    }
} finally {
  await browser.close();
}
await writeFile(
  "shots/typography/after/font-shift.json",
  `${JSON.stringify(
    {
      method:
        "Hold font WOFF2 requests until source data and recorded grouping are stable, then measure all shifts from BEFORE releasing the font responses through fonts.ready plus600ms. Startup shifts are retained separately; none are filtered from the raw entries.",
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify(
    results.map(({ view, size, fontSwapCls, startupCls }) => ({
      view,
      size: size.name,
      fontSwapCls,
      startupCls,
    })),
  ),
);

if (process.env.TYPE_ENFORCE_ZERO === "1")
  for (const result of results) {
    assert.equal(result.fontSwapCls, 0, `${result.view} ${result.size.name}: delayed font CLS`);
    assert.equal(result.startupCls, 0, `${result.view} ${result.size.name}: delayed startup CLS`);
  }
