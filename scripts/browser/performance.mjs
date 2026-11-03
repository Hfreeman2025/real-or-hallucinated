import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { assertQuiet, bank, base, launch, loaded, pageFor, savedRound } from "./runtime.mjs";

const heavy = bank.puzzles
  .flatMap((p, day) => p.claims.map((claim, index) => ({ claim, index, day })))
  .filter((c) => !c.claim.real)
  .sort(
    (a, b) =>
      b.claim.text.length +
      Object.values(b.claim.evidence.context).join("").length +
      b.claim.evidence.proof.reason.length -
      (a.claim.text.length +
        Object.values(a.claim.evidence.context).join("").length +
        a.claim.evidence.proof.reason.length),
  )[0];
const heavyDate = new Date(Date.UTC(2026, 9, 19 + heavy.day)).toISOString().slice(0, 10);
const results = [];
for (const engine of ["chromium", "webkit", "firefox"]) {
  const samples = [];
  let version = "";
  for (let i = 0; i < 3; i++) {
    const browser = await launch(engine);
    version = browser.version();
    const { page, context, issues, requests } = await pageFor(browser, {
      reducedMotion: "no-preference",
    });
    try {
      await loaded(page);
      await page.waitForFunction(
        () => performance.getEntriesByName("roh:first-claim-painted").length > 0,
      );
      const firstMeaningfulPaintMs = await page.evaluate(
        () => performance.getEntriesByName("roh:first-claim-painted")[0].startTime,
      );
      await page.evaluate(
        (state) => localStorage.setItem("real-or-hallucinated:v1", JSON.stringify(state)),
        savedRound(
          heavyDate,
          bank.puzzles[heavy.day].claims.slice(0, heavy.index).map((c) => c.real),
          heavy.index,
        ),
      );
      await loaded(page, `${base}/?date=${heavyDate}`);
      await page.evaluate(() => {
        window.__frames = [];
        window.__done = false;
        window.__renderTask = null;
        const observer = new MutationObserver(() => {
          const entry = performance.getEntriesByName("roh:reveal-start").at(-1);
          if (entry) {
            window.__renderTask = performance.now() - entry.startTime;
            observer.disconnect();
          }
        });
        observer.observe(document.querySelector("#game"), { childList: true, subtree: true });
        let start = 0;
        let last = 0;
        function tick(t) {
          if (!start) start = t;
          if (last) window.__frames.push({ time: t, delta: t - last });
          last = t;
          if (t - start < 500) requestAnimationFrame(tick);
          else window.__done = true;
        }
        requestAnimationFrame(tick);
      });
      await page.locator("#answer-real").click();
      await page.waitForFunction(() => window.__done);
      const data = await page.evaluate(() => {
        const start = performance.getEntriesByName("roh:reveal-start").at(-1).startTime;
        return {
          frames: window.__frames
            .filter((f) => f.time >= start && f.time <= start + 200)
            .map((f) => f.delta),
          renderTask: window.__renderTask,
          focused: document.hasFocus(),
          hidden: document.hidden,
        };
      });
      assert.ok(data.frames.length > 0);
      assertQuiet(issues, requests, `${engine} performance sample ${i + 1}`);
      const frames = data.frames.sort((a, b) => a - b);
      samples.push({
        firstMeaningfulPaintMs: +firstMeaningfulPaintMs.toFixed(2),
        renderTaskMs: +data.renderTask.toFixed(2),
        medianFrameMs: +frames[Math.floor(frames.length * 0.5)].toFixed(2),
        p95FrameMs: +frames[Math.floor(frames.length * 0.95)].toFixed(2),
        maxFrameMs: +frames.at(-1).toFixed(2),
        frames,
        focused: data.focused,
        hidden: data.hidden,
      });
    } finally {
      await context.close();
      await browser.close();
    }
  }
  const median = (key) => samples.map((s) => s[key]).sort((a, b) => a - b)[1];
  results.push({
    engine,
    version,
    samples,
    medianFirstMeaningfulPaintMs: median("firstMeaningfulPaintMs"),
    medianRenderTaskMs: median("renderTaskMs"),
    medianFrameMs: median("medianFrameMs"),
    medianP95FrameMs: median("p95FrameMs"),
    worstFrameMs: Math.max(...samples.map((s) => s.maxFrameMs)),
  });
  console.log(
    `${engine}: paints ${samples.map((s) => s.firstMeaningfulPaintMs).join(", ")}ms; median frame ${median("medianFrameMs")}ms; median p95 ${median("p95FrameMs")}ms.`,
  );
}
const javascript = [];
for (const file of await readdir("dist/assets"))
  if (file.endsWith(".js")) {
    const bytes = await readFile(`dist/assets/${file}`);
    javascript.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
  }
await writeFile(
  `${process.env.EVIDENCE_DIR ?? "shots/v2"}/performance-report.json`,
  `${JSON.stringify({ measuredAt: new Date().toISOString(), testedUrl: base, results, javascript, javascriptGzipBytes: javascript.reduce((sum, f) => sum + f.gzipBytes, 0), revealClaim: heavy.claim.id, method: "Three fresh browser launches per engine, no simultaneous build or screenshot tasks. Foreground headless contexts, native Performance and rAF, Date-only calendar fixture. First meaningful paint is the first-claim render followed by two rAF callbacks. Reveal frames include the first event-crossing interval; render-task time is captured by a MutationObserver after the answer handler. Frame intervals are not GPU timings or hosted-device guarantees. Full functional-suite timings and their outliers remain in browser-report.json." }, null, 2)}\n`,
);
