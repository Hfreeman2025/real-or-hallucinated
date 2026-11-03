import assert from "node:assert/strict";
import { copyFile, writeFile } from "node:fs/promises";
import { assertQuiet, base, launch, pageFor } from "./runtime.mjs";

const browser = await launch("chromium");
const f = await pageFor(browser, { size: { width: 1200, height: 630 } });
try {
  await f.page.goto(`${base}/?view=detector`);
  await f.page.waitForSelector("#cluster-stage.is-grouped");
  await f.page.evaluate(() => document.fonts.ready);
  let zoom = 0.75;
  for (const candidate of [0.75, 0.72, 0.7, 0.68, 0.65, 0.62]) {
    zoom = candidate;
    await f.page.evaluate((value) => {
      document.body.style.zoom = String(value);
      scrollTo(0, 0);
    }, candidate);
    const bounds = await f.page.locator("#cluster-stage").boundingBox();
    if (bounds && bounds.y + bounds.height <= 630) break;
  }
  assert.equal(await f.page.locator(".sample-card").count(), 5);
  const bounds = await f.page.locator("#cluster-stage").boundingBox();
  assert.ok(
    bounds && bounds.y + bounds.height <= 630,
    "All five real samples fit the social capture",
  );
  await f.page.screenshot({ path: "public/og.png" });
  await copyFile("public/og.png", "dist/og.png");
  await copyFile("public/og.png", `${process.env.EVIDENCE_DIR ?? "shots/v3"}/og.png`);
  assertQuiet(f.issues, f.requests, "Actual UI social capture");
  await writeFile(
    `${process.env.EVIDENCE_DIR ?? "shots/v3"}/social-report.json`,
    JSON.stringify(
      {
        url: base,
        width: 1200,
        height: 630,
        browserZoom: zoom,
        samples: 5,
        bounds,
        method:
          "Running UI at the largest tested browser zoom that fits all five actual samples; no compositing or fabricated output",
        issues: f.issues,
      },
      null,
      2,
    ),
  );
} finally {
  await f.context.close();
  await browser.close();
}
