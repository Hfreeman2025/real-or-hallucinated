import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat, statfs } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { silenceLiveAudio } from "./silent.mjs";

const require = createRequire(
  process.env.CI
    ? new URL("../../package.json", import.meta.url)
    : "<local path>",
);
export const playwright = require("playwright");
export const bank = JSON.parse(await readFile("data/puzzles.json", "utf8"));
export const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:4184";
assert.ok(
  new URL(base).hostname === "127.0.0.1" || new URL(base).hostname === "localhost",
  "Browser checks must stay local",
);
export const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
export const today = "2026-11-01";
export const edition = bank.puzzles[13];
export function savedRound(date, answers = [], reviewed = 0) {
  const index =
    ((Math.round(
      (Date.parse(`${date}T12:00Z`) - Date.parse(`${bank.startDate}T12:00Z`)) / 86400000,
    ) %
      14) +
      14) %
    14;
  return {
    version: 1,
    rounds: { [date]: { editionId: bank.puzzles[index].id, answers, reviewed } },
    completedDates: reviewed === 5 && date === today ? [date] : [],
  };
}
export async function launch(engine) {
  if (!process.env.CI && process.platform === "darwin") {
    const occupied = execFileSync("ps", ["-axo", "pid,ppid,comm"], { encoding: "utf8" })
      .split("\n")
      .filter((line) =>
        /Google Chrome for Testing\.app|chrome-headless-shell|Playwright\.app|\/MiniBrowser|\/firefox(?:\s|$)/.test(
          line,
        ),
      );
    assert.deepEqual(occupied, [], "Browser slot occupied; wait for the current builder's handoff");
    const disk = await statfs("/");
    if (disk.bavail * disk.bsize < 10 * 1024 ** 3)
      throw new Error("Browser launch held: less than 10 GiB free");
  }
  const type = playwright[engine];
  const options = { headless: true, timeout: 30000 };
  if (engine === "chromium") {
    options.executablePath = type.executablePath();
    options.args = [
      "--mute-audio",
      "--enable-unsafe-webgpu",
      "--use-gl=angle",
      "--use-angle=metal",
    ];
  }
  if (engine === "firefox") options.firefoxUserPrefs = { "media.volume_scale": "0.0" };
  if (!process.env.CI && engine !== "chromium") {
    let available = false;
    try {
      available = (await stat(type.executablePath())).isFile();
    } catch {}
    if (!available)
      options.executablePath = resolve(
        ".cache/browsers",
        type.executablePath().split("/ms-playwright/")[1],
      );
  }
  return type.launch(options);
}
export async function pageFor(
  browser,
  {
    size = sizes[0],
    state = null,
    reducedMotion = "reduce",
    date = "2026-11-01T12:00:00Z",
    blockedStorage = false,
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    reducedMotion,
    timezoneId: "America/Los_Angeles",
  });
  await context.addInitScript(silenceLiveAudio);
  const page = await context.newPage();
  await page.bringToFront();
  await page.addInitScript((epoch) => {
    const NativeDate = window.Date;
    window.__testNow = epoch;
    window.Date = class extends NativeDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(window.__testNow);
      }
      static now() {
        return window.__testNow;
      }
    };
  }, Date.parse(date));
  await page.addInitScript(() => {
    window.__initialCLS = null;
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("layout-shift")
    ) {
      window.__initialCLS = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!entry.hadRecentInput) window.__initialCLS += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    }
  });
  const issues = [];
  const requests = [];
  page.on("pageerror", (error) => issues.push({ type: "pageerror", message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      issues.push({ type: message.type(), message: message.text() });
  });
  page.on("request", (request) => requests.push(request.url()));
  if (state !== null)
    await page.addInitScript(
      (value) => localStorage.setItem("real-or-hallucinated:v1", JSON.stringify(value)),
      state,
    );
  if (blockedStorage)
    await page.addInitScript(() =>
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      }),
    );
  return { page, context, issues, requests };
}
export async function loaded(page, url = base) {
  const daily = new URL(url);
  daily.searchParams.set("view", "daily");
  await page.goto(daily.href, { waitUntil: "load" });
  await page.waitForSelector(".claim-text, .score, .unavailable-desk");
}
export async function layout(page, label) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    claim: document.querySelector(".claim-text")?.getBoundingClientRect().toJSON(),
    answer: document.querySelector("#answer-real")?.getBoundingClientRect().toJSON(),
  }));
  assert.ok(result.documentWidth <= result.width, `${label}: horizontal overflow`);
  return { label, ...result };
}
export function assertQuiet(issues, requests, label) {
  assert.deepEqual(issues, [], `${label}: zero console errors and warnings`);
  assert.deepEqual(
    requests.filter((url) => new URL(url).origin !== new URL(base).origin),
    [],
    `${label}: no external runtime requests`,
  );
}
