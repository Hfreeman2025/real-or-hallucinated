import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, statfs, writeFile } from "node:fs/promises";
import { assertQuiet, base, launch, pageFor, playwright, sizes } from "./runtime.mjs";

const folder = `${process.env.EVIDENCE_DIR ?? "shots/v3"}/${process.env.CRITIQUE_PASS ?? "pass-1"}`;
await mkdir(folder, { recursive: true });
async function liveBrowser(engine) {
  if (process.env.CACHE_PROFILE === "incognito") return launch(engine);
  const disk = await statfs("/");
  assert.ok(
    disk.bavail * disk.bsize >= 10 * 1024 ** 3,
    "Disk reserve before persistent cache check",
  );
  await mkdir(".cache/tmp", { recursive: true });
  const profile = await mkdtemp(`${process.cwd()}/.cache/tmp/live-${engine}-`);
  const context = await playwright[engine].launchPersistentContext(profile, {
    executablePath: playwright[engine].executablePath(),
    headless: true,
    timeout: 30000,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    timezoneId: "America/Los_Angeles",
    ...(engine === "chromium"
      ? {
          args: [
            "--mute-audio",
            "--enable-unsafe-webgpu",
            ...(process.platform === "darwin" ? ["--use-gl=angle", "--use-angle=metal"] : []),
          ],
        }
      : {}),
  });
  for (const page of context.pages()) await page.close();
  const version = context.browser().version();
  return {
    newContext: async () => context,
    version: () => version,
    async close() {
      await context.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
    },
  };
}
const reports = [],
  captures = [];
async function completed(page) {
  await page.waitForFunction(
    () =>
      /^(Live run complete|Local run unavailable)/.test(
        document.querySelector("#model-status").textContent,
      ),
    {},
    { timeout: 120000 },
  );
  assert.match(await page.locator("#model-status").textContent(), /^Live run complete/);
}
for (const engine of process.env.BROWSER_ENGINE
  ? [process.env.BROWSER_ENGINE]
  : ["chromium", "webkit"]) {
  const browser = await liveBrowser(engine);
  const f = await pageFor(browser);
  await f.page.addInitScript(() => {
    window.__modelFiles = {};
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data?.type === "progress" && data.progress.total > 0)
            window.__modelFiles[data.progress.file] = data.progress;
        });
      }
    };
  });
  const network = [];
  let diagnosticTimer;
  if (process.env.LIVE_DIAGNOSTIC === "1") {
    f.page.on("crash", () => console.log("PAGE CRASH"));
    f.page.on("close", () => console.log("PAGE CLOSED"));
    diagnosticTimer = setInterval(() => {
      f.page
        .locator("#model-status")
        .textContent({ timeout: 500 })
        .then((s) => console.log("STATUS", s))
        .catch(() => {});
    }, 2000);
  }
  f.context.on("request", (r) => network.push({ url: r.url(), method: r.method() }));
  try {
    if (process.env.CACHE_DIAGNOSTIC === "1") {
      f.page.on("console", (m) => {
        if (m.text().startsWith("CACHE_NATIVE_FAILURE")) console.log(m.text());
      });
      await f.page.route(/\/assets\/worker-[^/]+\.js/, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: `const nativePut=Cache.prototype.put;Cache.prototype.put=async function(...args){const backup=args[1].clone();try{return await nativePut.apply(this,args)}catch(error){console.log("CACHE_NATIVE_FAILURE "+JSON.stringify({name:error.name,message:error.message,key:String(args[0]),status:args[1].status,headers:[...args[1].headers],bodyUsed:args[1].bodyUsed}));const bytes=await backup.arrayBuffer();console.log("CACHE_NATIVE_FAILURE retry-body "+bytes.byteLength);return await nativePut.call(this,args[0],new Response(bytes,{headers:backup.headers}));}};${await response.text()}`,
        });
      });
    }
    await f.page.goto(`${base}/?view=detector`);
    await f.page.waitForSelector("#cluster-stage.is-grouped");
    await f.page.waitForFunction(
      () => !document.querySelector("#gpu-support").textContent.startsWith("Checking"),
    );
    const available = !(await f.page.locator("#models-load").isDisabled());
    if (!available) {
      assert.equal(await f.page.locator(".sample-card").count(), 5);
      const message = await f.page.locator("#gpu-support").textContent();
      await f.page.screenshot({ path: `${folder}/${engine}-live-fallback.png`, fullPage: true });
      reports.push({ engine, version: browser.version(), live: false, reason: message });
      assertQuiet(f.issues, f.requests, `${engine} live fallback`);
      continue;
    }
    const shot = async (name, size = sizes[0]) => {
      // Playwright WebKit screenshots inject an inline stylesheet, rejected by the real CSP.
      // Capture every state in Chromium; keep WebKit functional checks under the unchanged CSP.
      if (engine !== "chromium") return;
      await f.page
        .locator(name === "cache-cleared" ? "#live-heading" : ".meaning-desk")
        .scrollIntoViewIfNeeded();
      const file = `${folder}/${size.name}-${name}${engine === "chromium" ? "" : `-${engine}`}.png`;
      await f.page.screenshot({ path: file, fullPage: true });
      const focusFile = file.replace(/\.png$/, "-focus.png");
      await f.page.screenshot({ path: focusFile });
      captures.push({ name, size: size.name, file: focusFile, fullFile: file, engine });
    };
    const started = performance.now();
    await f.page.locator("#models-load").click();
    await f.page.waitForFunction(
      () =>
        document.querySelector("#detector-origin").textContent.startsWith("Live") &&
        document.querySelectorAll("#cluster-stage .sample-card").length > 0,
      {},
      { timeout: 120000 },
    );
    assert.ok(
      await f.page.locator("#meaning-cancel").isVisible(),
      "Cancel remains available beside live samples",
    );
    assert.ok(
      await f.page
        .locator("#cluster-stage")
        .evaluate(
          (el) =>
            el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0,
        ),
      "Live sampling is brought into view",
    );
    await shot("live-generating");
    await f.page.locator("#meaning-cancel").click();
    await f.page.waitForFunction(() =>
      document.querySelector("#model-status").textContent.startsWith("Cancelled"),
    );
    await f.page.waitForSelector("#cluster-stage.is-grouped");
    assert.equal(await f.page.locator("#detector-origin").textContent(), "Recorded model run");
    assert.equal(await f.page.locator("#cluster-stage .sample-card").count(), 5);
    await shot("live-cancelled");
    await f.page.setViewportSize({ width: 390, height: 844 });
    await shot("live-cancelled", sizes[1]);
    await f.page.setViewportSize({ width: 1440, height: 900 });
    const cachedFiles = await f.page.evaluate(async () =>
      [...(await (await caches.open("lie-detector-models-v3")).keys())].map((r) => r.url),
    );
    await writeFile(
      `.cache/${engine}-progress-events.json`,
      JSON.stringify(await f.page.evaluate(() => window.__modelFiles), null, 2),
    );
    console.log(
      "Cache diagnostic:",
      JSON.stringify({
        cachedFileCount: cachedFiles.length,
        status: await f.page.locator("#cache-status").textContent(),
        estimate: await f.page.evaluate(() => navigator.storage.estimate()),
      }),
    );
    await writeFile(
      ".cache/live-cache-diagnostic.json",
      JSON.stringify(
        {
          cachedFiles,
          status: await f.page.locator("#cache-status").textContent(),
          estimate: await f.page.evaluate(() => navigator.storage.estimate()),
        },
        null,
        2,
      ),
    );
    assert.ok(
      cachedFiles.some((url) => url.endsWith("model_q4.onnx")),
      "Generator file really cached",
    );
    assert.ok(
      cachedFiles.some((url) => url.endsWith("model_quantized.onnx")),
      "NLI file really cached",
    );
    const beforeCached = network.length;
    await f.page.locator("#models-load").click();
    await completed(f.page);
    assert.equal(await f.page.locator("#detector-origin").textContent(), "Live · this device");
    assert.equal(
      network
        .slice(beforeCached)
        .filter(
          (r) => r.method === "GET" && r.url.includes("/__models/") && /\.onnx(?:$|\?)/.test(r.url),
        ).length,
      0,
      "Cached run transfers no ONNX weights",
    );
    const texts = await f.page
      .locator("#cluster-stage .sample-card")
      .evaluateAll((els) =>
        els
          .sort((a, b) => Number(a.dataset.sample) - Number(b.dataset.sample))
          .map((el) => el.querySelector(".sample-text").textContent),
      );
    assert.equal(texts.length, 5);
    assert.ok(texts.every(Boolean));
    await shot("live-complete");
    const status = await f.page.locator("#model-status").textContent();
    await f.page.reload();
    await f.page.waitForSelector("#cluster-stage.is-grouped");
    await f.page.waitForFunction(() => !document.querySelector("#models-load").disabled);
    const beforeReloaded = network.length;
    await f.page.locator("#models-load").click();
    await f.page.waitForFunction(
      () =>
        document.querySelector("#detector-origin").textContent.startsWith("Live") &&
        document.querySelectorAll("#cluster-stage .sample-card").length > 0,
      {},
      { timeout: 120000 },
    );
    await f.page.setViewportSize({ width: 390, height: 844 });
    await shot("live-generating", sizes[1]);
    await completed(f.page);
    const repeated = await f.page
      .locator("#cluster-stage .sample-card")
      .evaluateAll((els) =>
        els
          .sort((a, b) => Number(a.dataset.sample) - Number(b.dataset.sample))
          .map((el) => el.querySelector(".sample-text").textContent),
      );
    assert.deepEqual(repeated, texts, "Same question and seed repeat after cached reload");
    assert.equal(
      network
        .slice(beforeReloaded)
        .filter(
          (r) => r.method === "GET" && r.url.includes("/__models/") && /\.onnx(?:$|\?)/.test(r.url),
        ).length,
      0,
      "Reload uses persisted cached ONNX weights",
    );
    await shot("live-complete", sizes[1]);
    await f.page.locator("#models-clear").click();
    await f.page.waitForFunction(
      async () => !(await caches.keys()).includes("lie-detector-models-v3"),
    );
    assert.ok((await f.page.locator("#model-status").textContent()).includes("cache removed"));
    await shot("cache-cleared", sizes[1]);
    await f.page.setViewportSize({ width: 1440, height: 900 });
    await shot("cache-cleared");
    assertQuiet(f.issues, f.requests, `${engine} real live/cache/cancel`);
    reports.push({
      engine,
      version: browser.version(),
      live: true,
      wallMs: performance.now() - started,
      cachedFiles,
      status,
      texts,
      consoleIssues: f.issues,
      requests: network,
    });
    console.log(
      `${engine}: real live inference, in-flight cancel, cache hit, cached reload and cache removal passed.`,
    );
  } finally {
    clearInterval(diagnosticTimer);
    await f.context.close();
    await browser.close();
  }
}
await writeFile(
  `${folder}/${process.env.BROWSER_ENGINE ? `${process.env.BROWSER_ENGINE}-` : ""}live-report.json`,
  `${JSON.stringify({ checkedAt: new Date().toISOString(), reports, captures, narrowViewport: "Mobile live captures are a running desktop session resized for responsive layout; phones initially loaded at390px use the recorded fallback. No physical-phone inference is claimed." }, null, 2)}\n`,
);
