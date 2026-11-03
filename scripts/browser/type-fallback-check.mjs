import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { base, launch, sizes } from "./runtime.mjs";

const reports = [];
for (const engine of ["chromium", "webkit", "firefox"]) {
  const browser = await launch(engine);
  try {
    for (const size of sizes) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        javaScriptEnabled: false,
      });
      try {
        const page = await context.newPage();
        const issues = [];
        const external = [];
        page.on("console", (msg) => {
          if (["error", "warning"].includes(msg.type())) issues.push(msg.text());
        });
        page.on("pageerror", (error) => issues.push(error.message));
        page.on("request", (request) => {
          if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
        });
        await page.goto(base);
        await page.locator(".no-script").waitFor();
        // Keep observing beyond the browser's unused-preload warning window.
        await page.waitForTimeout(4000);
        assert.ok(await page.locator(".workspace").isHidden());
        assert.ok(await page.locator(".topbar nav").isHidden());
        const box = await page.locator(".no-script").boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height <= size.height);
        assert.deepEqual(external, []);
        assert.deepEqual(issues, []);
        reports.push({ engine, size: size.name, checks: 5, issues, external });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  "shots/typography/after/no-js-report.json",
  `${JSON.stringify({ reports }, null, 2)}\n`,
);
console.log(
  "No-JS: 30 checks across 3 engines and both sizes, zero browser issues or external requests.",
);
