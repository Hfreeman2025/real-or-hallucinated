import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { base, launch, pageFor, sizes } from "./runtime.mjs";

const reports = [];
for (const engine of ["chromium", "webkit", "firefox"]) {
  const browser = await launch(engine);
  try {
    for (const origin of [new URL(base).origin, "http://127.0.0.1:5177"])
      for (const size of sizes) {
        const f = await pageFor(browser, { size });
        const checks = [];
        const check = (name, value) => {
          assert.ok(value, `${engine} ${origin} ${size.name}: ${name}`);
          checks.push(name);
        };
        try {
          await f.page.goto(`${origin}/?view=detector`);
          await f.page.waitForSelector("#cluster-stage.is-grouped");
          check(
            "five actual recorded samples",
            (await f.page.locator(".sample-card").count()) === 5,
          );
          check(
            "strict CSP external stylesheet works",
            await f.page.evaluate(
              () =>
                getComputedStyle(document.querySelector(".topbar")).backgroundColor ===
                "rgb(24, 27, 25)",
            ),
          );
          check(
            "no horizontal overflow",
            await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          );
          check(
            "no automatic model or external download",
            f.requests.every((u) => new URL(u).origin === origin && !u.includes("/__models/")),
          );
          await f.page.locator(".sample-card").first().click();
          await f.page.locator(".token").first().focus();
          check(
            "visible numeric probability on keyboard focus",
            (await f.page.locator("#token-probability").textContent()).includes("% probability"),
          );
          await f.page.locator("#detector-question").selectOption("h-30");
          await f.page.locator('[data-guess="real"]').click();
          check(
            "opened source state is accurate",
            (await f.page.locator("#citation-state").textContent()) ===
              "Verified passage opened below.",
          );
          check(
            "verified context uses display-only CO₂",
            (await f.page.locator("#detector-truth blockquote").textContent()).includes(
              "CO₂ mole fraction",
            ),
          );
          await f.page.locator("#detector-evaluation summary").click();
          if (size.name === "mobile") {
            check(
              "table has a visible horizontal scroll hint",
              await f.page
                .locator(".evaluation-table-wrap")
                .evaluate((el) =>
                  getComputedStyle(el, "::before").content.includes("Scroll across"),
                ),
            );
            await f.page.locator(".evaluation-table-wrap").focus();
            await f.page.keyboard.press("ArrowRight");
            await f.page.waitForFunction(
              () => document.querySelector(".evaluation-table-wrap").scrollLeft > 0,
            );
            check("keyboard can reveal the remaining table columns", true);
          }
          const image = await f.page.evaluate(async () => {
            const img = new Image();
            img.src = "/og.png";
            await img.decode();
            return [img.naturalWidth, img.naturalHeight];
          });
          check(
            "current actual social preview has correct dimensions",
            image[0] === 1200 && image[1] === 630,
          );
          assert.deepEqual(f.issues, [], "No browser console issues");
          assert.ok(
            f.requests.every((u) => new URL(u).origin === origin),
            "No external requests",
          );
          reports.push({
            engine,
            version: browser.version(),
            origin,
            viewport: size,
            checks,
            consoleIssues: f.issues,
          });
        } finally {
          await f.context.close();
        }
      }
  } finally {
    await browser.close();
  }
}
for (const origin of [new URL(base).origin, "http://127.0.0.1:5177"]) {
  const url = `${origin}/__models/onnx-community/Qwen2.5-0.5B-Instruct/resolve/22942cb7d7ba4cc81bb4673549ca4d4614469b5e/onnx/model_q4.onnx`;
  const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-0/786156820");
  assert.equal((await response.arrayBuffer()).byteLength, 1);
  assert.equal((await fetch(`${origin}/__models/unlisted/file.onnx`)).status, 404);
}
await writeFile(
  "shots/v3/final-smoke-report.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      reports,
      rangeProbes:
        "Both loopback servers returned exactly one byte, correct206/Content-Range; unlisted file404",
    },
    null,
    2,
  ),
);
console.log(
  `${reports.length} final engine/size/server combinations passed, zero console issues; one-byte metadata probes pass.`,
);
