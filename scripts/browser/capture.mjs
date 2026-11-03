import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
  sizes,
  today,
} from "./runtime.mjs";

const pass = process.env.CRITIQUE_PASS ?? "pass-1";
assert.ok(/^pass-[12]$/.test(pass));
const out = `${process.env.EVIDENCE_DIR ?? "shots/v2"}/${pass}`;
await mkdir(out, { recursive: true });
const browser = await launch("chromium");
const captures = [];
async function capture(
  name,
  { state = null, action = null, blockedStorage = false, date, url = base, prepare = null } = {},
) {
  for (const size of sizes) {
    const { page, context, issues, requests } = await pageFor(browser, {
      size,
      state,
      blockedStorage,
      date,
    });
    try {
      if (prepare) await prepare(page, context, size);
      await loaded(page, url);
      assert.equal(
        await page.locator(".topbar").evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgb(24, 27, 25)",
      );
      if (!["unavailable", "empty-content"].includes(name))
        assert.equal(
          await page.locator(".unavailable-desk").count(),
          0,
          `Unexpected unavailable state: ${name}`,
        );
      if (action) await action(page, context, size);
      await layout(page, `${name} ${size.name}`);
      await page.screenshot({
        path: `${out}/${size.name}-${name}.png`,
        fullPage: ![
          "archive",
          "about",
          "sources",
          "empty-archive",
          "loading",
          "slow-network",
        ].includes(name),
      });
      assertQuiet(issues, requests, `${name} ${size.name}`);
      captures.push({ name, size: size.name, file: `${out}/${size.name}-${name}.png` });
    } finally {
      await context.close();
    }
  }
}
try {
  await capture("initial");
  await capture("real", { action: async (page) => page.locator("#answer-real").click() });
  await capture("fabricated", { state: savedRound(today, [true, true], 1) });
  const longClaim = bank.puzzles
    .flatMap((p, day) => p.claims.map((c, i) => ({ claim: c, day, index: i })))
    .sort((a, b) => b.claim.text.length - a.claim.text.length)[0];
  const longDate = new Date(Date.UTC(2026, 9, 19 + longClaim.day)).toISOString().slice(0, 10);
  await capture("long-claim", {
    url: `${base}/?date=${longDate}`,
    state: savedRound(
      longDate,
      bank.puzzles[longClaim.day].claims.slice(0, longClaim.index).map((c) => c.real),
      longClaim.index,
    ),
  });
  const longest = bank.puzzles
    .flatMap((p, day) => p.claims.map((c, i) => ({ claim: c, day, index: i })))
    .sort(
      (a, b) =>
        (
          b.claim.evidence.context.before +
          b.claim.evidence.context.match +
          b.claim.evidence.context.after
        ).length -
        (
          a.claim.evidence.context.before +
          a.claim.evidence.context.match +
          a.claim.evidence.context.after
        ).length,
    )[0];
  const ld = new Date(Date.UTC(2026, 9, 19 + longest.day)).toISOString().slice(0, 10);
  await capture("long-evidence", {
    url: `${base}/?date=${ld}`,
    state: savedRound(
      ld,
      bank.puzzles[longest.day].claims.slice(0, longest.index + 1).map((c) => c.real),
      longest.index,
    ),
  });
  await capture("source-expanded", {
    state: savedRound(today, [true], 0),
    action: async (page) => page.locator(".source-analysis summary").click(),
  });
  await capture("new-day", {
    action: async (page) => {
      await page.evaluate(() => {
        window.__testNow = Date.parse("2026-11-02T12:00:00Z");
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForSelector(".state-notice");
    },
  });
  const wrong = edition.claims.map((c) => !c.real);
  const perfect = edition.claims.map((c) => c.real);
  await capture("summary-missed", { state: savedRound(today, wrong, 5) });
  await capture("summary-perfect", { state: savedRound(today, perfect, 5) });
  await capture("review-expanded", {
    state: savedRound(today, wrong, 5),
    action: async (page) => {
      await page.locator("details").first().locator("summary").click();
    },
  });
  await capture("clipboard-denied", {
    state: savedRound(today, wrong, 5),
    action: async (page) => {
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
      await page.waitForSelector("#result-text");
    },
  });
  await capture("storage-denied", { blockedStorage: true });
  await capture("storage-corrupt", {
    prepare: async (page) =>
      page.addInitScript(() => localStorage.setItem("real-or-hallucinated:v1", "{broken")),
  });
  await capture("offline", {
    action: async (page, context) => {
      await context.setOffline(true);
      await page.waitForFunction(() =>
        document.querySelector("#connection-status").textContent.startsWith("Offline"),
      );
    },
  });
  await capture("archive", {
    action: async (page) => {
      await page.locator("#archive-open").click();
    },
  });
  await capture("empty-archive", {
    date: "2026-10-18T12:00:00Z",
    action: async (page) => {
      await page.locator("#archive-open").click();
    },
  });
  await capture("about", {
    action: async (page) => {
      await page.locator("#about-open").click();
    },
  });
  await capture("sources", {
    action: async (page) => {
      await page.locator("#sources-open").click();
    },
  });
  for (const name of ["unavailable", "empty-content"])
    await capture(name, {
      prepare: async (page) =>
        page.route(/\/assets\/puzzles-[^/]+\.js/, (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/javascript",
            body:
              name === "empty-content"
                ? "export default {version:2,puzzles:[]}"
                : "export default {invalid:true}",
          }),
        ),
    });
  // Pause only the local content chunk, so loading is captured without a real network delay.
  for (const size of sizes) {
    const { page, context, issues, requests } = await pageFor(browser, { size });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/puzzles-[^/]+\.js/, async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await page.goto(`${base}/?view=daily`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".loading-desk");
      await page.screenshot({ path: `${out}/${size.name}-loading.png` });
      await page.screenshot({ path: `${out}/${size.name}-slow-network.png` });
      captures.push(
        ...["loading", "slow-network"].map((name) => ({
          name,
          size: size.name,
          file: `${out}/${size.name}-${name}.png`,
        })),
      );
      release();
      await page.waitForSelector(".claim-text");
      assertQuiet(issues, requests, `loading ${size.name}`);
    } finally {
      release();
      await context.close();
    }
  }
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForSelector(".no-script");
    assert.ok(await page.locator(".workspace").isHidden(), "No-JS shell is hidden");
    assert.ok(await page.locator(".topbar nav").isHidden(), "No-JS navigation is hidden");
    const noScript = await page.locator(".no-script").boundingBox();
    assert.ok(
      noScript && noScript.y + noScript.height <= size.height,
      "No-JS instruction fits the viewport",
    );
    await page.screenshot({ path: `${out}/${size.name}-javascript-disabled.png` });
    captures.push({
      name: "javascript-disabled",
      size: size.name,
      file: `${out}/${size.name}-javascript-disabled.png`,
    });
    await context.close();
  }
  const phone = await pageFor(browser, { size: sizes[1] });
  try {
    await loaded(phone.page);
    await phone.page.locator("#answer-real").click();
    await phone.page.screenshot({ path: `${out}/mobile-real-viewport.png` });
  } finally {
    await phone.context.close();
  }
  await writeFile(
    `${out}/capture-report.json`,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        captures,
        states: new Set(captures.map((c) => c.name)).size,
        viewports: sizes,
        consoleErrorsAndWarnings: 0,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `${captures.length} screenshots captured with no console errors/warnings or external runtime requests.`,
  );
} finally {
  await browser.close();
}
