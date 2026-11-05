import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auroc } from "../../src/detector/math.ts";
import {
  MAX_TOKENS,
  REPETITION_PENALTY,
  SAMPLE_COUNT,
  SYSTEM_PROMPT,
  TEMPERATURE,
  TOP_K,
  TOP_P,
} from "../../src/detector/models.ts";
import { parseDetectorResult } from "../../src/detector/validation.ts";
import { bank, base, launch, pageFor } from "./runtime.mjs";

// Recording requires the development server to expose the TypeScript worker entry.
const sources = [
  "engine.ts",
  "models.ts",
  "sampling.ts",
  "model-request.ts",
  "model-cache.ts",
  "chunk-cache.ts",
  "math.ts",
  "types.ts",
  "validation.ts",
  "worker.ts",
  "client.ts",
  "webkit-worker.ts",
  "webkit-engine.ts",
  "webkit-environment.ts",
  "nli-bridge.ts",
  "nli-worker.ts",
  "nli-wire.ts",
]
  .map((name) => `src/detector/${name}`)
  .concat([
    "vendor/transformers/PROVENANCE.json",
    "vendor/transformers/transformers.web.js",
    "package-lock.json",
    "data/models.json",
  ]);
const sourceDigests = {};
for (const name of sources)
  sourceDigests[name] = createHash("sha256")
    .update(await readFile(name))
    .digest("hex");
const engineHash = createHash("sha256").update(JSON.stringify(sourceDigests)).digest("hex");
const modelManifest = JSON.parse(await readFile("data/models.json", "utf8"));
const modelDirectory = resolve(process.env.MODEL_DIR ?? ".cache/models");
const cachedManifest = JSON.parse(await readFile(join(modelDirectory, "manifest.json"), "utf8"));
for (const model of modelManifest.models) {
  assert.deepEqual(
    cachedManifest.models.find((m) => m.id === model.id && m.dtype === model.dtype),
    model,
    "Cached model manifest must match the evaluated files",
  );
  for (const file of model.files) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(
      join(modelDirectory, model.id, model.revision, file.file),
    )) {
      hash.update(chunk);
      size += chunk.length;
    }
    assert.equal(size, file.bytes, `Model size: ${file.file}`);
    assert.equal(hash.digest("hex"), file.sha256, `Model digest: ${file.file}`);
  }
}
const weightsVerifiedAt = new Date().toISOString();
console.log("Cached model files: exact sizes and SHA-256 hashes verified, no download.");
const questions = JSON.parse(await readFile("data/questions.json", "utf8")).questions;
const claims = new Map(bank.puzzles.flatMap((p) => p.claims).map((c) => [c.id, c]));
const records = [];
const checkpoint = `.cache/model-recording/${engineHash}`;
await mkdir(checkpoint, { recursive: true });
const browser = await launch("chromium");
const startedAt = new Date().toISOString();
try {
  const f = await pageFor(browser);
  try {
    await f.page.goto(`${base}/?view=daily`);
    f.context.on("requestfailed", (r) =>
      console.log("Request failed:", r.url(), r.failure()?.errorText),
    );
    f.page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") console.log("Browser:", m.text());
    });
    await f.page.exposeFunction("recordProgress", (event) => {
      if (
        event.type === "phase" &&
        (event.phase.startsWith("Loading") || event.phase.startsWith("Worker"))
      )
        console.log(event.phase);
    });
    const loadStart = performance.now();
    const backend = await f.page.evaluate(async () => {
      const { DetectorClient } = await import("/src/detector/client.ts");
      window.__recordClient = new DetectorClient();
      return window.__recordClient.load((e) => window.recordProgress(e), { cache: false });
    });
    const loadMs = performance.now() - loadStart;
    console.log(`Models ready in ${loadMs.toFixed(0)}ms: ${backend}`);
    for (const [index, question] of questions.entries()) {
      const disk = await statfs("/");
      if (disk.bavail * disk.bsize < 10 * 1024 ** 3)
        throw new Error("Disk reserve reached; checkpoints saved, browser will close");
      const claim = claims.get(question.claimId);
      assert.ok(claim);
      const input = {
        id: claim.id,
        question: question.question,
        claim: claim.text,
        seed: 20261102 + index * 7919,
      };
      let result;
      try {
        const saved = JSON.parse(await readFile(`${checkpoint}/${claim.id}.json`, "utf8"));
        result = parseDetectorResult(saved);
        assert.deepEqual(result.input, input);
        console.log(`Reused checkpoint ${claim.id}`);
      } catch {
        result = parseDetectorResult(
          await f.page.evaluate(
            (input) => window.__recordClient.run(input, (e) => window.recordProgress(e)),
            input,
          ),
        );
        await writeFile(`${checkpoint}/${claim.id}.json`, `${JSON.stringify(result, null, 2)}\n`);
      }
      records.push(result);
      console.log(
        `${index + 1}/70 ${claim.id}: ${result.entropyBits.toFixed(3)} bits; detector ${result.predictedReal ? "real" : "hallucinated"}; ${(result.milliseconds / 1000).toFixed(1)}s; primary: ${result.samples[0].text}`,
      );
      if (
        process.env.MODEL_RECORD_LIMIT &&
        records.length >= Number(process.env.MODEL_RECORD_LIMIT)
      )
        break;
    }
    await f.page.evaluate(() => window.__recordClient.cancel());
    if (records.length === 70) {
      const labels = records.map((r) => !claims.get(r.input.id).real);
      const correct = records.filter((r) => r.predictedReal === claims.get(r.input.id).real).length;
      const recording = {
        version: 1,
        recordedAt: new Date().toISOString(),
        startedAt,
        recordingMethod:
          "Real sequential sampling and NLI in headless Chromium via the browser worker. Shared immutable weights streamed from loopback; no inference API and no browser weight cache. All questions, no cherry-picked subset.",
        browser: browser.version(),
        engineSourceSha256: sourceDigests,
        engineHash,
        modelManifest,
        weightsVerifiedAt,
        parameters: {
          samples: SAMPLE_COUNT,
          prompt: SYSTEM_PROMPT,
          maxNewTokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          topP: TOP_P,
          topK: TOP_K,
          repetitionPenalty: REPETITION_PENALTY,
          sampler:
            "Local seeded temperature/top-k/nucleus over raw logits, original model probabilities retained; one reused worker; Mulberry32 per-sample seed mixing",
          clustering: "complete-link bidirectional entailment",
          entailmentThreshold: 0.6,
          entropy: "discrete occupancy, base 2",
          claimScore:
            "(1 + mean(entailment - contradiction)) / 2; entropy reported separately; verdict threshold 0.5",
        },
        loadMs,
        defaultId: records.slice().sort((a, b) => b.entropyBits - a.entropyBits)[0].input.id,
        evaluation: {
          count: 70,
          correct,
          accuracy: correct / 70,
          claimAuroc: auroc(
            labels,
            records.map((r) => 1 - r.support),
          ),
          semanticAuroc: null,
          answerAccuracy: null,
          review:
            "Generated-answer error labels await source-backed editorial review. No answer-error AUROC is claimed yet.",
        },
        records,
      };
      await writeFile("data/detector-recording.json", `${JSON.stringify(recording, null, 2)}\n`);
      console.log("Complete recorded bank saved:", JSON.stringify(recording.evaluation));
    } else
      console.log(
        `Checkpoint batch saved; ${records.length}/70 visited. No partial bank published.`,
      );
    await writeFile(
      `${checkpoint}/browser-evidence.json`,
      `${JSON.stringify({ startedAt, closedAt: new Date().toISOString(), backend, loadMs, issues: f.issues, requests: f.requests }, null, 2)}\n`,
    );
    assert.deepEqual(f.issues, [], "No unexpected browser console warnings/errors");
  } finally {
    await f.context.close();
  }
} finally {
  await browser.close();
}
