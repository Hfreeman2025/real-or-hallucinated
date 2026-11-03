import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { auroc } from "../src/detector/math.ts";
import {
  GENERATOR,
  MAX_TOKENS,
  NLI,
  REPETITION_PENALTY,
  SAMPLE_COUNT,
  SYSTEM_PROMPT,
  TEMPERATURE,
  TOP_K,
  TOP_P,
} from "../src/detector/models.ts";
import { parseDetectorResult } from "../src/detector/validation.ts";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const recording = JSON.parse(await readFile("data/detector-recording.json", "utf8"));
const reviewBytes = await readFile("data/detector-review.json");
const review = JSON.parse(reviewBytes);
const bank = JSON.parse(await readFile("data/puzzles.json", "utf8"));
const questions = JSON.parse(await readFile("data/questions.json", "utf8")).questions;
const claims = new Map(bank.puzzles.flatMap((p) => p.claims).map((c) => [c.id, c]));
assert.equal(recording.records.length, 70);
assert.equal(new Set(recording.records.map((r) => r.input.id)).size, 70);
for (const [path, expected] of Object.entries(recording.engineSourceSha256))
  assert.equal(sha(await readFile(path)), expected, `Engine changed since recording: ${path}`);
assert.equal(recording.engineHash, sha(JSON.stringify(recording.engineSourceSha256)));
for (const [key, expected] of Object.entries({
  samples: SAMPLE_COUNT,
  maxNewTokens: MAX_TOKENS,
  prompt: SYSTEM_PROMPT,
  temperature: TEMPERATURE,
  topP: TOP_P,
  topK: TOP_K,
  repetitionPenalty: REPETITION_PENALTY,
  entailmentThreshold: 0.6,
}))
  assert.equal(recording.parameters[key], expected, `Recording parameter: ${key}`);
for (const selected of [GENERATOR, NLI])
  assert.ok(
    recording.modelManifest.models.some(
      (m) => m.id === selected.id && m.revision === selected.revision,
    ),
    "Pinned model revision recorded",
  );
assert.equal(review.labels.length, 70);
const labels = new Map(review.labels.map((l) => [l.id, l]));
assert.equal(labels.size, 70);
const errors = [],
  claimErrors = [],
  results = [];
for (const raw of recording.records) {
  const r = parseDetectorResult(raw);
  const claim = claims.get(r.input.id);
  assert.ok(claim);
  assert.equal(r.input.claim, claim.text);
  assert.equal(r.input.question, questions.find((q) => q.claimId === claim.id)?.question);
  const label = labels.get(r.input.id);
  assert.ok(
    label &&
      typeof label.correct === "boolean" &&
      typeof label.reason === "string" &&
      label.reason.trim(),
  );
  assert.equal(label.answerSha256, sha(r.samples[0].text), `Answer review: ${r.input.id}`);
  assert.equal(label.sourceQuoteSha256, sha(claim.evidence.quote), `Source review: ${r.input.id}`);
  assert.equal(label.sourceUrl, claim.source.url);
  errors.push(!label.correct);
  claimErrors.push(!claim.real);
  results.push(r);
}
const ev = recording.evaluation;
assert.equal(ev.reviewSha256, sha(reviewBytes));
assert.equal(ev.count, 70);
assert.equal(
  ev.correct,
  results.filter((r) => r.predictedReal === claims.get(r.input.id).real).length,
);
assert.equal(ev.accuracy, ev.correct / 70);
assert.equal(ev.answerAccuracy, errors.filter((e) => !e).length / 70);
assert.equal(
  ev.semanticAuroc,
  auroc(
    errors,
    results.map((r) => r.entropyBits),
  ),
);
assert.equal(
  ev.tokenAuroc,
  auroc(
    errors,
    results.map((r) => -r.samples[0].meanLogProbability),
  ),
);
assert.equal(
  ev.claimAuroc,
  auroc(
    claimErrors,
    results.map((r) => 1 - r.support),
  ),
);
console.log(
  "70 recorded questions: engine digests, source inputs, token confidence, NLI, entropy, exact answer reviews and evaluation metrics verified.",
);
