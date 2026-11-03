import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { assertQuiet, base, launch, pageFor, sizes } from "./runtime.mjs";

const folder = `${process.env.EVIDENCE_DIR ?? "shots/v3"}/${process.env.CRITIQUE_PASS ?? "pass-1"}`;
await mkdir(folder, { recursive: true });
const browser = await launch("chromium");
const captures = [];
try {
  for (const size of sizes) {
    const f = await pageFor(browser); // Begin on a capable desktop; resize only after the download starts.
    let release = () => {};
    try {
      let waiting;
      const requested = new Promise((resolve) => {
        waiting = resolve;
      });
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await f.page.route(/\/__models\/.*\.onnx(?:\?|$)/, async (route) => {
        if (route.request().headers().range) return route.continue();
        waiting();
        await gate;
        await route.abort().catch(() => {});
      });
      await f.page.goto(`${base}/?view=detector`);
      await f.page.waitForSelector("#cluster-stage.is-grouped");
      await f.page.locator("#models-load").waitFor({ state: "visible" });
      await f.page.waitForFunction(() => !document.querySelector("#models-load").disabled);
      await f.page.locator("#models-load").click();
      let requestTimer;
      await Promise.race([
        requested,
        new Promise((_, reject) => {
          requestTimer = setTimeout(
            () =>
              reject(
                new Error("No ONNX request in20seconds; check the local model middleware/status"),
              ),
            20000,
          );
        }),
      ]).finally(() => clearTimeout(requestTimer));
      await f.page.setViewportSize({ width: size.width, height: size.height });
      await f.page.locator("#live-heading").scrollIntoViewIfNeeded();
      assert.ok(await f.page.locator("#models-cancel").isVisible());
      const loadingFile = `${folder}/${size.name}-model-loading.png`;
      await f.page.screenshot({ path: loadingFile, fullPage: true });
      const loadingFocus = `${folder}/${size.name}-model-loading-focus.png`;
      await f.page.screenshot({ path: loadingFocus });
      captures.push({
        name: "model-loading",
        size: size.name,
        file: loadingFocus,
        fullFile: loadingFile,
      });
      await f.page.locator("#models-cancel").click();
      release();
      await f.page.waitForFunction(
        () => document.querySelector("#model-status").textContent.startsWith("Cancelled"),
        {},
        { timeout: 20000 },
      );
      assert.equal(await f.page.locator("#cluster-stage .sample-card").count(), 5);
      const cancelFile = `${folder}/${size.name}-model-cancelled.png`;
      await f.page.screenshot({ path: cancelFile, fullPage: true });
      const cancelFocus = `${folder}/${size.name}-model-cancelled-focus.png`;
      await f.page.screenshot({ path: cancelFocus });
      captures.push({
        name: "model-cancelled",
        size: size.name,
        file: cancelFocus,
        fullFile: cancelFile,
      });
      assertQuiet(f.issues, f.requests, `cancel ${size.name}`);
    } finally {
      release();
      await f.context.close();
    }
    const failure = await pageFor(browser);
    try {
      await failure.page.route(/\/__models\//, (route) => route.abort("failed"));
      await failure.page.goto(`${base}/?view=detector`);
      await failure.page.waitForSelector("#cluster-stage.is-grouped");
      await failure.page.waitForFunction(() => !document.querySelector("#models-load").disabled);
      await failure.page.locator("#models-load").click();
      await failure.page.waitForFunction(() =>
        document.querySelector("#model-status").textContent.includes("unavailable"),
      );
      await failure.page.setViewportSize({ width: size.width, height: size.height });
      const file = `${folder}/${size.name}-model-failed.png`;
      await failure.page.locator("#live-heading").scrollIntoViewIfNeeded();
      await failure.page.screenshot({ path: file, fullPage: true });
      const focusFile = `${folder}/${size.name}-model-failed-focus.png`;
      await failure.page.screenshot({ path: focusFile });
      captures.push({ name: "model-failed", size: size.name, file: focusFile, fullFile: file });
      assert.equal(await failure.page.locator("#cluster-stage .sample-card").count(), 5);
      assertQuiet(failure.issues, failure.requests, `download failure ${size.name}`);
    } finally {
      await failure.context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  `${folder}/download-captures.json`,
  `${JSON.stringify({ captures, fixture: "Real worker loads tokenizers; ONNX requests are held/cancelled or failed before weights transfer. A capable desktop run is resized for the phone layout. This is not a live-inference performance measurement." }, null, 2)}\n`,
);
console.log(
  "Loading, cancellation and failed-download states passed at both sizes, zero console issues.",
);
