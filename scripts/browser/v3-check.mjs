import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { meaningClusters, semanticEntropy } from "../../src/detector/math.ts";
import { assertQuiet, base, launch, pageFor, sizes } from "./runtime.mjs";

const recording = JSON.parse(await readFile("data/detector-recording.json", "utf8"));
assert.equal(recording.records.length, 70);
const folder = process.env.EVIDENCE_DIR ?? "shots/v3";
const pass = process.env.CRITIQUE_PASS ?? "pass-1";
await mkdir(`${folder}/${pass}`, { recursive: true });
const engines = process.env.BROWSER_ENGINE
  ? [process.env.BROWSER_ENGINE]
  : ["chromium", "webkit", "firefox"];
const reports = [];
const captures = [];
for (const engine of engines) {
  const browser = await launch(engine);
  const checks = [];
  const check = (name, condition) => {
    assert.ok(condition, `${engine}: ${name}`);
    checks.push(name);
  };
  try {
    for (const size of sizes) {
      const f = await pageFor(browser, { size });
      const shot = async (name) => {
        if (process.env.CAPTURE !== "1" || engine !== "chromium") return;
        const file = `${folder}/${pass}/${size.name}-${name}.png`;
        await f.page.screenshot({ path: file, fullPage: true });
        if (name !== "detector") {
          const focusFile = `${folder}/${pass}/${size.name}-${name}-focus.png`;
          await f.page.screenshot({ path: focusFile });
          captures.push({ name, size: size.name, file: focusFile, fullFile: file });
        } else captures.push({ name, size: size.name, file });
        if (name.startsWith("source-")) {
          await f.page.locator("#detector-truth").scrollIntoViewIfNeeded();
          await f.page.screenshot({ path: `${folder}/${pass}/${size.name}-${name}-passage.png` });
        }
        if (name === "detector") {
          await f.page.evaluate(() => scrollTo(0, 0));
          const viewportFile = `${folder}/${pass}/${size.name}-viewport.png`;
          await f.page.screenshot({ path: viewportFile });
          captures.push({ name: "viewport", size: size.name, file: viewportFile });
        }
      };

      try {
        await f.page.goto(`${base}/?view=detector`);
        await f.page.waitForSelector("#cluster-stage.is-grouped .sample-card");
        check(
          `${size.name}: five visible model-generated samples`,
          (await f.page.locator("#cluster-stage .sample-card").count()) === 5,
        );
        check(
          `${size.name}: recording labelled before any models load`,
          (await f.page.locator("#detector-origin").textContent()) === "Recorded model run",
        );
        check(
          `${size.name}: no automatic model download`,
          !f.requests.some((url) => url.includes("/__models/") || url.includes("huggingface.co")),
        );
        check(
          `${size.name}: no horizontal overflow`,
          await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
        check(
          `${size.name}: device-free audio guard`,
          await f.page.evaluate(() => new AudioContext() instanceof OfflineAudioContext),
        );
        check(
          `${size.name}: no source passage before player decision`,
          (await f.page.locator("#detector-truth .source-passage").count()) === 0,
        );
        await shot("detector");
        const firstId = await f.page.locator("#detector-question").inputValue();
        const result = recording.records.find((r) => r.input.id === firstId);
        check(
          `${size.name}: displayed entropy from actual recorded pairs`,
          (await f.page.locator("#entropy-number").textContent()) === result.entropyBits.toFixed(2),
        );
        await f.page.locator("#cluster-stage .sample-card").first().click();
        check(
          `${size.name}: token confidence inspector opens`,
          await f.page.locator("#token-inspector").evaluate((el) => el.open),
        );
        check(
          `${size.name}: opened token inspection is visible and receives keyboard focus`,
          await f.page
            .locator("#token-inspector summary")
            .evaluate(
              (el) =>
                el === document.activeElement &&
                el.getBoundingClientRect().top >= 0 &&
                el.getBoundingClientRect().bottom <= innerHeight,
            ),
        );
        check(
          `${size.name}: token probabilities have keyboard labels`,
          (await f.page.locator('#token-content .token[tabindex="0"][aria-label]').count()) > 0,
        );
        await f.page.locator("#token-content .token").first().focus();
        check(
          `${size.name}: keyboard focus exposes the exact numeric token probability visually`,
          (await f.page.locator("#token-probability").textContent()).includes(
            `${(result.samples[0].tokens[0].probability * 100).toFixed(1)}%`,
          ),
        );
        await shot("tokens");
        await f.page.locator("#open-entailment").click();
        check(
          `${size.name}: both-direction matrix exposes twenty off-diagonal relations`,
          (await f.page.locator(".matrix-cell").count()) === 20,
        );
        await f.page.locator('[data-pair="0:1"]').click();
        check(
          `${size.name}: pair explanation reports reverse probability`,
          (await f.page.locator("#pair-explanation").textContent()).includes("Reverse:"),
        );
        await shot("entailment");
        await f.page.locator("#entailment-threshold").focus();
        await f.page.keyboard.press("End");
        const expected = semanticEntropy(meaningClusters(5, result.pairs, 0.95));
        check(
          `${size.name}: threshold recomputes meaning entropy`,
          (await f.page.locator("#entropy-number").textContent()) === expected.toFixed(2),
        );
        check(
          `${size.name}: threshold exploration does not rewrite benchmark`,
          (await f.page.locator("#replay-status").textContent()).includes(
            "published evaluation remains",
          ),
        );
        await shot("threshold");
        await f.page.locator("#detector-question").selectOption("h-30");
        await f.page.waitForSelector("#cluster-stage.is-grouped");
        await f.page.locator('[data-guess="real"]').click();
        check(
          `${size.name}: you-detector-source verdicts visible`,
          (await f.page.locator(".judgement-grid > div").count()) === 3,
        );
        check(
          `${size.name}: source explicitly labels fabricated claim`,
          (await f.page.locator("#detector-claim-status").textContent()) === "Fabricated claim",
        );
        check(
          `${size.name}: exact invented phrase retained`,
          (await f.page.locator("#detector-claim del").textContent()) === "includes water vapour",
        );
        check(
          `${size.name}: display-only CO₂ retained in detector source`,
          (await f.page.locator("#detector-truth blockquote").textContent()).includes(
            "CO₂ mole fraction",
          ),
        );
        check(
          `${size.name}: citation accurately reports its opened state after a decision`,
          (await f.page.locator("#citation-state").textContent()) ===
            "Verified passage opened below.",
        );
        await shot("source-fabricated");
        await f.page.locator("#detector-question").selectOption("r-35");
        await f.page.locator('[data-guess="real"]').click();
        check(
          `${size.name}: real source passage retains highlighted context`,
          (await f.page.locator("#detector-truth .source-passage mark").count()) === 1,
        );
        await shot("source-real");
        await f.page.locator("#daily-open").click();
        await f.page.waitForSelector("#answer-real");
        await f.page.locator("#answer-real").click();
        check(
          `${size.name}: daily game still reveals checked claim`,
          (await f.page.locator("#verdict").count()) === 1,
        );
        await f.page.locator("#detector-open").click();
        await f.page.locator("#daily-open").click();
        check(
          `${size.name}: switching views preserves daily answer`,
          (await f.page.locator("#verdict").count()) === 1,
        );
        await f.page.locator("#detector-open").click();
        if (size.name === "mobile")
          check(
            "Phone uses designed recorded fallback",
            (await f.page.locator("#models-load").isDisabled()) &&
              (await f.page.locator("#gpu-support").textContent()).includes("Phone mode"),
          );
        assertQuiet(f.issues, f.requests, `${engine} ${size.name} recorded`);
      } finally {
        await f.context.close();
      }
    }
    const fallback = await pageFor(browser);
    try {
      await fallback.page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
      );
      await fallback.page.goto(`${base}/?view=detector`);
      await fallback.page.waitForSelector("#cluster-stage.is-grouped");
      check(
        "No-WebGPU fallback is interactive and explicit",
        (await fallback.page.locator("#models-load").isDisabled()) &&
          (await fallback.page.locator("#gpu-support").textContent()).includes("unavailable"),
      );
      if (process.env.CAPTURE === "1" && engine === "chromium")
        await fallback.page.screenshot({
          path: `${folder}/${pass}/desktop-no-webgpu.png`,
          fullPage: true,
        });
      assertQuiet(fallback.issues, fallback.requests, `${engine} fallback`);
    } finally {
      await fallback.context.close();
    }
    console.log(`${engine}: ${checks.length} detector checks passed.`);
    reports.push({ engine, version: browser.version(), checks: checks.length, assertions: checks });
  } finally {
    await browser.close();
  }
}
await writeFile(
  `${folder}/detector-browser-report${process.env.BROWSER_ENGINE ? `-${process.env.BROWSER_ENGINE}` : ""}.json`,
  `${JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2)}\n`,
);

if (captures.length)
  await writeFile(
    `${folder}/${pass}/capture-report.json`,
    `${JSON.stringify({ capturedAt: new Date().toISOString(), captures, states: new Set(captures.map((c) => c.name)).size, viewports: sizes }, null, 2)}\n`,
  );
