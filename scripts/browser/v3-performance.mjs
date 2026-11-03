import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { assertQuiet, base, launch, pageFor } from "./runtime.mjs";

const recording = JSON.parse(await readFile("data/detector-recording.json", "utf8"));
const heavy = recording.records
  .slice()
  .sort(
    (a, b) =>
      b.samples.reduce((s, x) => s + x.text.length, 0) -
      a.samples.reduce((s, x) => s + x.text.length, 0),
  )[0];
const results = [];
for (const engine of ["chromium", "webkit", "firefox"]) {
  const browser = await launch(engine);
  const samples = [];
  try {
    for (let i = 0; i < 3; i++) {
      const f = await pageFor(browser, { reducedMotion: "no-preference" });
      try {
        await f.page.goto(`${base}/?view=detector`);
        await f.page.waitForFunction(
          () => performance.getEntriesByName("roh:detector-painted").length,
        );
        await f.page.waitForSelector("#cluster-stage.is-grouped");
        const paint = await f.page.evaluate(() => ({
          meaningfulPaintMs: performance.getEntriesByName("roh:detector-painted")[0].startTime,
          initialClusteringStartMs: performance.getEntriesByName("roh:cluster-start")[0]?.startTime,
          resources: performance.getEntriesByType("resource").map((r) => r.name),
        }));
        await f.page.locator("#detector-question").selectOption(heavy.input.id);
        await f.page.waitForSelector("#cluster-stage.is-grouped");
        await f.page.locator("#cluster-stage").scrollIntoViewIfNeeded();
        await f.page.evaluate(() => {
          performance.clearMarks("roh:cluster-start");
          window.__frames = [];
          window.__frameDone = false;
          let start = 0,
            last = 0;
          function tick(t) {
            if (!start) start = t;
            if (last) window.__frames.push({ time: t, delta: t - last });
            last = t;
            if (t - start < 2300) requestAnimationFrame(tick);
            else window.__frameDone = true;
          }
          requestAnimationFrame(tick);
        });
        await f.page.evaluate(() => document.querySelector("#detector-replay").click());
        await f.page.waitForFunction(() => window.__frameDone);
        const frameData = await f.page.evaluate(() => {
          const marker = performance.getEntriesByName("roh:cluster-start").at(-1);
          if (!marker) throw new Error("Clustering animation did not start");
          return {
            frames: window.__frames
              .filter((f) => f.time >= marker.startTime && f.time <= marker.startTime + 650)
              .map((f) => f.delta),
            focused: document.hasFocus(),
            hidden: document.hidden,
          };
        });
        assert.ok(frameData.frames.length >= 10, "Enough animation frames measured");
        assertQuiet(f.issues, f.requests, `${engine} detector performance ${i + 1}`);
        const frames = frameData.frames.sort((a, b) => a - b);
        samples.push({
          ...paint,
          ...frameData,
          medianFrameMs: frames[Math.floor(frames.length * 0.5)],
          p95FrameMs: frames[Math.floor(frames.length * 0.95)],
          maxFrameMs: frames.at(-1),
        });
      } finally {
        await f.context.close();
      }
    }
    const median = (key) => samples.map((s) => s[key]).sort((a, b) => a - b)[1];
    results.push({
      engine,
      version: browser.version(),
      samples,
      medianMeaningfulPaintMs: median("meaningfulPaintMs"),
      medianClusteringStartMs: median("initialClusteringStartMs"),
      medianFrameMs: median("medianFrameMs"),
      medianP95FrameMs: median("p95FrameMs"),
      worstFrameMs: Math.max(...samples.map((s) => s.maxFrameMs)),
    });
    console.log(
      `${engine}: meaningful paint ${median("meaningfulPaintMs").toFixed(1)} ms; median animation frame ${median("medianFrameMs").toFixed(1)} ms; p95 ${median("p95FrameMs").toFixed(1)} ms`,
    );
  } finally {
    await browser.close();
  }
}
const javascript = [];
for (const dir of ["assets", "runtime"])
  for (const name of await readdir(`dist/${dir}`))
    if (/\.(?:m?js)$/.test(name)) {
      const file = `${dir}/${name}`;
      const contents = await readFile(`dist/${file}`);
      javascript.push({
        file,
        bytes: contents.length,
        gzipBytes: gzipSync(contents).length,
        fetchedByOpener: results[0].samples[0].resources.some((u) =>
          new URL(u).pathname.endsWith(file),
        ),
      });
    }
const wasmFiles = [];
for (const name of (await readdir("dist/runtime")).filter((n) => n.endsWith(".wasm"))) {
  const bytes = await readFile(`dist/runtime/${name}`);
  wasmFiles.push({
    file: `runtime/${name}`,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
  });
}
await writeFile(
  "shots/v3/performance-report.json",
  `${JSON.stringify({ measuredAt: new Date().toISOString(), testedUrl: base, method: "Three fresh contexts per engine, one browser at a time; no simultaneous model/build/capture tasks. Native Performance and rAF with foreground pages and Date-only fixture. Meaningful paint is initial detector content after two rAF callbacks; the separately measured cluster start follows real recorded-answer arrival. Frame intervals cover the five-card FLIP gather for the longest total recorded answer text, with the stage in view and its real replay handler invoked and are not GPU timings or guarantees for physical phones. Initial JS includes dynamic modules actually fetched by the opener; model runtime is lazy.", results, heaviestRecordedCase: heavy.input.id, heaviestAnswerCharacters: heavy.samples.reduce((s, x) => s + x.text.length, 0), wasmFiles, javascript, openerJavascriptGzipBytes: javascript.filter((f) => f.fetchedByOpener).reduce((s, f) => s + f.gzipBytes, 0), optionalJavascriptGzipBytes: javascript.filter((f) => !f.fetchedByOpener).reduce((s, f) => s + f.gzipBytes, 0) }, null, 2)}\n`,
);
