import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { displaySourceText } from "../../src/display.ts";
import {
  assertQuiet,
  bank,
  base,
  edition,
  launch,
  layout,
  loaded,
  pageFor,
  savedRound,
} from "./runtime.mjs";

const reports = [];
const evidenceDir = process.env.EVIDENCE_DIR ?? "shots/v2";
await mkdir(evidenceDir, { recursive: true });
const engines = process.env.BROWSER_ENGINE
  ? [process.env.BROWSER_ENGINE]
  : ["chromium", "webkit", "firefox"];
assert.ok(engines.every((engine) => ["chromium", "webkit", "firefox"].includes(engine)));
for (const engine of engines) {
  const browser = await launch(engine);
  const checks = [];
  const layouts = [];
  const check = (name, condition) => {
    assert.ok(condition, `${engine}: ${name}`);
    checks.push(name);
  };
  try {
    const { page, context, issues, requests } = await pageFor(browser);
    try {
      await loaded(page);
      await page.waitForFunction(
        () => performance.getEntriesByName("roh:first-claim-painted").length > 0,
      );
      const firstMeaningfulPaint = await page.evaluate(
        () => performance.getEntriesByName("roh:first-claim-painted")[0].startTime,
      );
      const initialCLS = await page.evaluate(() => window.__initialCLS);
      check(
        "London date in a Los Angeles browser",
        (await page.locator("#edition-date").textContent()).includes("1 November 2026"),
      );
      check(
        "New identity and external CSS load under CSP",
        (await page.locator(".topbar").evaluate((el) => getComputedStyle(el).backgroundColor)) ===
          "rgb(24, 27, 25)",
      );
      check(
        "No reveal evidence before the decision",
        (await page.locator(".source-passage, .proof-phrase").count()) === 0,
      );
      check(
        "Evidence is deliberately sealed, with no skeleton or loading state",
        (await page.locator(".sealed-evidence h4").textContent()) ===
          "Citation on record.Passage held back." &&
          (await page.locator(".evidence-placeholder, .sealed-evidence [aria-busy]").count()) === 0,
      );
      check(
        "Desktop decisions follow the claim and its margin within 28 pixels",
        await page.evaluate(() => {
          const bottom = Math.max(
            ...[".claim-text", ".proof-waiting"].map(
              (selector) => document.querySelector(selector).getBoundingClientRect().bottom,
            ),
          );
          const gap =
            document.querySelector(".answer-buttons").getBoundingClientRect().top - bottom;
          return gap >= 0 && gap <= 28;
        }),
      );
      await page.keyboard.press(
        engine === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
      );
      check(
        "Skip action is the first platform keyboard stop (Option-Tab on macOS WebKit)",
        await page.locator(".skip-link").evaluate((el) => el === document.activeElement),
      );
      await page.keyboard.press("Enter");
      check(
        "Skip link reaches desk",
        await page.locator("#game").evaluate((el) => el === document.activeElement),
      );
      await page.keyboard.press("ArrowRight");
      check(
        "Right arrow reveals real source context",
        (await page.locator("#verdict").textContent()) === "Real",
      );
      check(
        "Quote highlight preserves evidence with display typography",
        (await page.locator(".source-passage mark").textContent()) ===
          displaySourceText(edition.claims[0].evidence.context.match),
      );
      check(
        "Surrounding source sentences are visible",
        (await page.locator(".source-passage blockquote").textContent()).includes(
          displaySourceText(edition.claims[0].evidence.context.before),
        ),
      );
      check(
        "Verdict receives focus",
        await page.locator("#verdict").evaluate((el) => el === document.activeElement),
      );
      check(
        "Reduced motion disables source reveal animation",
        (await page
          .locator(".source-passage")
          .evaluate((el) => getComputedStyle(el).animationName)) === "none",
      );
      await page.keyboard.press("ArrowLeft");
      check(
        "A locked answer cannot be changed",
        (await page.locator("#verdict").textContent()) === "Real",
      );
      await page.reload();
      await page.waitForSelector("#verdict");
      check("Reload preserves reveal", (await page.locator("#verdict").textContent()) === "Real");
      await page.locator("#next").click();
      await page.keyboard.press("ArrowRight");
      check(
        "Fabrication is explicitly labelled",
        (await page.locator(".claim-status").textContent()) === "Fabricated claim",
      );
      check(
        "Exact invented phrase gets a proof mark",
        (await page.locator("#proof-phrase").textContent()) ===
          edition.claims[1].evidence.proof.phrase,
      );
      check(
        "Margin note contains actual correction",
        (await page.locator(".editor-note strong").textContent()) ===
          edition.claims[1].evidence.proof.replacement,
      );
      await page.locator("#proof-phrase").focus();
      await page.keyboard.press("Enter");
      check(
        "Marked phrase keyboard action reaches editor note",
        await page.locator("#proof-note").evaluate((el) => el === document.activeElement),
      );
      await page.locator("#next").click();
      for (let i = 2; i < 5; i++) {
        await page.locator(edition.claims[i].real ? "#answer-fake" : "#answer-real").click();
        await page.locator("#next").click();
      }
      check("Summary uses actual score", (await page.locator(".score").textContent()) === "1/5");
      check(
        "Only actual mistakes become missed tells",
        (await page.locator(".missed-tell").count()) === 4,
      );
      check(
        "Completing today adds one streak day",
        (await page.locator("#streak").textContent()) === "Daily streak: 1",
      );
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__shared = text;
            },
          },
        }),
      );
      await page.locator("#share").click();
      const shared = await page.evaluate(() => window.__shared);
      check("Share is plain ASCII", /^[\x20-\x7E\n]+$/.test(shared));
      check(
        "Share has no claims or verdicts",
        !bank.puzzles.flatMap((p) => p.claims).some((c) => shared.includes(c.text)) &&
          !/fabricated|real claim/.test(shared),
      );
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error("denied");
            },
          },
        }),
      );
      await page.locator("#share").click();
      check(
        "Clipboard denial has a usable fallback",
        (await page.locator("#result-text").inputValue()) === shared,
      );
      await page.locator("#archive-open").click();
      await page.keyboard.press("ArrowLeft");
      check(
        "Archive blocks answering behind modal",
        await page.locator("dialog").evaluate((d) => d.open),
      );
      await page.keyboard.press("Escape");
      check("Escape closes archive", !(await page.locator("dialog").evaluate((d) => d.open)));
      check(
        "Modal restores opener focus",
        await page.locator("#archive-open").evaluate((el) => el === document.activeElement),
      );
      await page.locator("#archive-open").click();
      await page.locator('[data-date="2026-10-31"]').click();
      check(
        "Archive date and URL are honest",
        page.url().includes("2026-10-31") &&
          (await page.locator("#edition-date").textContent()).startsWith("Archive"),
      );
      // Exercise every claim in both decision and evidence states at the narrowest supported width.
      await page.setViewportSize({ width: 320, height: 740 });
      for (let day = 0; day < 14; day++) {
        const date = new Date(Date.UTC(2026, 9, 19 + day)).toISOString().slice(0, 10);
        await page.evaluate(() => localStorage.clear());
        await loaded(page, `${base}/?date=${date}`);
        for (let i = 0; i < 5; i++) {
          layouts.push(await layout(page, `${date} claim ${i + 1}`));
          const claim = bank.puzzles[day].claims[i];
          await page.locator(claim.real ? "#answer-real" : "#answer-fake").click();
          check(
            `${claim.id}: correct verdict`,
            (await page.locator("#verdict").textContent()) ===
              (claim.real ? "Real" : "Hallucinated"),
          );
          check(
            `${claim.id}: context quote with display typography`,
            (await page.locator(".source-passage mark").textContent()) ===
              displaySourceText(claim.evidence.context.match),
          );
          if (JSON.stringify(claim.evidence.context).includes("CO 2"))
            check(
              `${claim.id}: scraped carbon dioxide is typeset, not rewritten in the bank`,
              (await page.locator(".source-passage blockquote").textContent()).includes("CO₂") &&
                !(await page.locator(".source-passage blockquote").textContent()).includes("CO 2"),
            );
          if (!claim.real)
            check(
              `${claim.id}: exact proof phrase`,
              (await page.locator("#proof-phrase").textContent()) === claim.evidence.proof.phrase,
            );
          layouts.push(await layout(page, `${date} reveal ${i + 1}`));
          await page.locator("#next").click();
        }
        check(`${date}: five correct`, (await page.locator(".score").textContent()) === "5/5");
        check(
          `${date}: no archive streak backfill`,
          (await page.locator("#streak").textContent()) ===
            (day === 13 ? "Daily streak: 1" : "Daily streak: 0"),
        );
      }
      check("Every claim at 320px stays within viewport", layouts.length === 140);
      await page.evaluate(() => localStorage.clear());
      await loaded(page);
      await page.setViewportSize({ width: 390, height: 844 });
      const button = await page.locator("#answer-real").boundingBox();
      check("Mobile first-screen answer controls are visible", button.y + button.height <= 844);
      const touch = async (dx, dy) =>
        page.locator(".claim-text").evaluate(
          (el, { dx, dy }) => {
            for (const [type, x, y] of [
              ["touchstart", 220, 400],
              ["touchend", 220 + dx, 400 + dy],
            ]) {
              const ev = new Event(type, { bubbles: true });
              const t = { clientX: x, clientY: y };
              Object.defineProperties(ev, {
                touches: { value: type === "touchstart" ? [t] : [] },
                changedTouches: { value: [t] },
              });
              el.dispatchEvent(ev);
            }
          },
          { dx, dy },
        );
      await touch(8, 150);
      check(
        "Vertical scroll gesture does not answer",
        (await page.locator("#answer-real").count()) === 1,
      );
      await touch(-120, 0);
      check("Horizontal swipe answers", (await page.locator("#verdict").count()) === 1);
      await context.setOffline(true);
      await page.waitForFunction(() =>
        document.querySelector("#connection-status").textContent.startsWith("Offline"),
      );
      check(
        "Offline status is explicit",
        await page
          .locator("#connection-status")
          .evaluate((el) => el.textContent.startsWith("Offline")),
      );
      await context.setOffline(false);
      await page.evaluate(() => {
        window.__testNow = Date.parse("2026-11-02T12:00:00Z");
        window.dispatchEvent(new Event("focus"));
      });
      check(
        "Midnight preserves the open round and stops labelling it today",
        (await page.locator("#edition-date").textContent()).startsWith("Open edition") &&
          (await page.locator("#verdict").count()) === 1,
      );
      assertQuiet(issues, requests, engine);
      checks.push("Zero console warnings/errors and no external requests");
      reports.push({
        engine,
        browserVersion: browser.version(),
        passed: true,
        checks: checks.length,
        assertions: checks,
        firstMeaningfulPaintMs: Math.round(firstMeaningfulPaint),
        initialCLS,
        layoutChecks: layouts.length,
        consoleErrorsAndWarnings: issues,
        externalRequests: requests.filter((u) => new URL(u).origin !== new URL(base).origin),
      });
    } finally {
      await context.close();
    }
    const blocked = await pageFor(browser, { blockedStorage: true });
    try {
      await loaded(blocked.page);
      check(
        "Storage denial is explicit",
        (await blocked.page.locator(".state-notice").textContent()).includes("session only"),
      );
      await blocked.page.locator("#answer-real").click();
      check(
        "Storage denial leaves a working game",
        (await blocked.page.locator("#verdict").count()) === 1,
      );
      assertQuiet(blocked.issues, blocked.requests, `${engine} blocked storage`);
    } finally {
      await blocked.context.close();
    }
    // Sample actual rAF intervals during the heaviest reveal with motion enabled.
    const heaviest = bank.puzzles
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
    const motionDate = new Date(Date.UTC(2026, 9, 19 + heaviest.day)).toISOString().slice(0, 10);
    const motion = await pageFor(browser, {
      reducedMotion: "no-preference",
      state: savedRound(
        motionDate,
        bank.puzzles[heaviest.day].claims.slice(0, heaviest.index).map((c) => c.real),
        heaviest.index,
      ),
    });
    try {
      await loaded(motion.page, `${base}/?date=${motionDate}`);
      await motion.page.evaluate(() => {
        window.__frameIntervals = [];
        window.__frameDone = false;
        let last = 0;
        let start = 0;
        function tick(now) {
          if (!start) start = now;
          if (last) window.__frameIntervals.push({ time: now, delta: now - last });
          last = now;
          if (now - start < 500) requestAnimationFrame(tick);
          else window.__frameDone = true;
        }
        requestAnimationFrame(tick);
      });
      await motion.page.locator("#answer-real").click();
      await motion.page.waitForFunction(() => window.__frameDone);
      const intervals = await motion.page.evaluate(() => {
        const start = performance.getEntriesByName("roh:reveal-start").at(-1).startTime;
        return window.__frameIntervals
          .filter((f) => f.time >= start && f.time <= start + 200)
          .map((f) => f.delta);
      });
      assert.ok(intervals.length > 0, "Reveal frame samples were captured");
      intervals.sort((a, b) => a - b);
      const report = reports.find((r) => r.engine === engine);
      report.revealClaim = heaviest.claim.id;
      report.revealFrameTimeMs = {
        median: +intervals[Math.floor(intervals.length * 0.5)].toFixed(2),
        p95: +intervals[Math.floor(intervals.length * 0.95)].toFixed(2),
        max: +intervals.at(-1).toFixed(2),
        frames: intervals.length,
      };
      report.checks = checks.length;
      report.assertions = checks;
      assertQuiet(motion.issues, motion.requests, `${engine} motion`);
    } finally {
      await motion.context.close();
    }
    console.log(
      `${engine}: ${checks.length} assertions, 140 narrow-layout checks, no console warnings/errors.`,
    );
  } finally {
    await browser.close();
  }
}
const js = [];
for (const file of await readdir("dist/assets"))
  if (file.endsWith(".js")) {
    const b = await readFile(`dist/assets/${file}`);
    js.push({ file, bytes: b.length, gzipBytes: gzipSync(b).length });
  }
await writeFile(
  process.env.BROWSER_ENGINE
    ? `${evidenceDir}/browser-report-${process.env.BROWSER_ENGINE}.json`
    : `${evidenceDir}/browser-report.json`,
  `${JSON.stringify({ checkedAt: new Date().toISOString(), testedUrl: base, reports, javascript: js, javascriptGzipBytes: js.reduce((sum, f) => sum + f.gzipBytes, 0), measurement: "First meaningful paint is an application mark after first-claim render and two requestAnimationFrame callbacks; rAF deltas are measured during an actual 180ms proof reveal, not GPU timings. Synthetic swipe and clipboard edge tests do not replace physical-device or native permission testing." }, null, 2)}\n`,
);
