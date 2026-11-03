import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { assertQuiet, base, launch, pageFor, sizes } from "./runtime.mjs";

const folder = `${process.env.EVIDENCE_DIR ?? "shots/v3"}/${process.env.CRITIQUE_PASS ?? "pass-1"}`;
await mkdir(folder, { recursive: true });
const recording = JSON.parse(await readFile("data/detector-recording.json", "utf8"));
const longest = recording.records
  .slice()
  .sort(
    (a, b) =>
      b.samples.reduce((s, x) => s + x.text.length, 0) -
      a.samples.reduce((s, x) => s + x.text.length, 0),
  )[0].input.id;
const captures = [];
const browser = await launch("chromium");
try {
  for (const name of [
    "offline",
    "long-answers",
    "evaluation",
    "method",
    "keyboard",
    "reduced-motion",
    "empty-recording",
    "invalid-recording",
    "no-webgpu",
    "recording-loading",
  ])
    for (const size of sizes) {
      const f = await pageFor(browser, { size });
      let release = () => {};
      try {
        if (name === "no-webgpu")
          await f.page.addInitScript(() =>
            Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
          );
        if (name === "empty-recording" || name === "invalid-recording")
          await f.page.route(/\/assets\/detector-recording-[^/]+\.js/, (route) =>
            route.fulfill({
              status: 200,
              contentType: "text/javascript",
              body: `export default ${JSON.stringify({ recordedAt: "2026-11-02T00:00:00Z", records: name === "empty-recording" ? [] : [{}] })}`,
            }),
          );
        if (name === "recording-loading") {
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          await f.page.route(/\/assets\/detector-recording-[^/]+\.js/, async (route) => {
            await gate;
            await route.continue().catch(() => {});
          });
        }
        await f.page.goto(`${base}/?view=detector`, { waitUntil: "domcontentloaded" });
        if (name === "recording-loading") {
          await f.page.waitForSelector(".detector-unavailable");
          assert.ok(
            (await f.page.locator("#detector").textContent()).includes(
              "No model download has started",
            ),
          );
        } else if (name.endsWith("-recording")) {
          await f.page.waitForFunction(() =>
            document
              .querySelector("#detector")
              .textContent.includes("No model output has been substituted"),
          );
          assert.equal(await f.page.locator(".sample-card").count(), 0);
          assert.ok(await f.page.locator("#daily-open").isEnabled());
        } else {
          await f.page.waitForSelector("#cluster-stage.is-grouped");
          if (name === "offline") {
            await f.context.setOffline(true);
            await f.page.waitForFunction(() =>
              document.querySelector("#connection-status").textContent.startsWith("Offline"),
            );
            await f.page.locator("#cluster-stage .sample-card").first().click();
          }
          if (name === "long-answers") {
            await f.page.locator("#detector-question").selectOption(longest);
            await f.page.waitForSelector("#cluster-stage.is-grouped");
          }
          if (name === "evaluation") {
            await f.page.locator("#detector-evaluation summary").click();
            assert.equal(await f.page.locator("#detector-evaluation tbody tr").count(), 70);
          }
          if (name === "method") await f.page.locator("#detector-method").scrollIntoViewIfNeeded();
          if (name === "keyboard") {
            await f.page.locator("#cluster-stage .sample-card").first().focus();
            assert.equal(
              await f.page.evaluate(() => document.activeElement?.className),
              "sample-card sample-arriving",
            );
          }
          if (name === "reduced-motion")
            assert.equal(
              await f.page.evaluate(
                () => document.getAnimations().filter((a) => a.playState === "running").length,
              ),
              0,
            );
          if (name === "no-webgpu") assert.ok(await f.page.locator("#models-load").isDisabled());
          assert.equal(await f.page.locator("#cluster-stage .sample-card").count(), 5);
        }
        assert.ok(
          await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${name} ${size.name}: no overflow`,
        );
        const file = `${folder}/${size.name}-${name}.png`;
        await f.page.screenshot({
          path: file,
          fullPage: !["method", "keyboard", "recording-loading"].includes(name),
        });
        const focusFile = `${folder}/${size.name}-${name}-focus.png`;
        await f.page.screenshot({ path: focusFile });
        captures.push({ name, size: size.name, file: focusFile, fullFile: file });
        assertQuiet(f.issues, f.requests, `${name} ${size.name}`);
      } finally {
        release();
        await f.context.close();
      }
    }
} finally {
  await browser.close();
}
await writeFile(
  `${folder}/extra-captures.json`,
  `${JSON.stringify({ captures, fixtures: "Empty/invalid/held recording chunks and disabled adapter are explicitly injected test states; other content is the real recorded bank.", longest }, null, 2)}\n`,
);
console.log(`${captures.length} extra detector state captures passed, zero console issues.`);
