import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { assertQuiet, base, launch, pageFor, sizes } from "./runtime.mjs";

const browser = await launch("webkit");
const checks = [];
try {
  for (const size of sizes) {
    const f = await pageFor(browser);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let waiting;
    try {
      await f.page.route(/\/__models\/.*\.onnx(?:\?|$)/, async (route) => {
        if (route.request().headers().range) return route.continue();
        waiting?.();
        await gate;
        await route.abort().catch(() => {});
      });
      await f.page.goto(`${base}/?view=detector`);
      await f.page.waitForFunction(() => !document.querySelector("#models-load")?.disabled);
      for (let attempt = 0; attempt < 2; attempt++) {
        const requested = new Promise((resolve) => {
          waiting = resolve;
        });
        await f.page.setViewportSize({ width: 1440, height: 900 });
        await f.page.locator("#models-load").click();
        let timer;
        await Promise.race([
          requested,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("No weight request")), 20000);
          }),
        ]).finally(() => clearTimeout(timer));
        await f.page.setViewportSize({ width: size.width, height: size.height });
        await f.page.locator("#models-cancel").click();
        await f.page.waitForFunction(() =>
          document.querySelector("#model-status").textContent.startsWith("Cancelled"),
        );
        assert.ok(await f.page.locator("#models-load").isEnabled());
        assert.equal(await f.page.locator(".sample-card").count(), 5);
        checks.push(`${size.name}: download cancellation and retry ${attempt + 1}`);
      }
      assertQuiet(f.issues, f.requests, `WebKit unfinished download ${size.name}`);
    } finally {
      release();
      await f.context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  "shots/v3/webkit-download-report.json",
  JSON.stringify({ checks, consoleIssues: [], noOnnxWeightsTransferred: true }, null, 2),
);
console.log(
  "WebKit: unfinished-download cancellation and immediate retry passed at both sizes, zero console issues.",
);
