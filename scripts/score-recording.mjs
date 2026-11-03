import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { auroc } from "../src/detector/math.ts";

const recording = JSON.parse(await readFile("data/detector-recording.json", "utf8"));
const review = JSON.parse(await readFile("data/detector-review.json", "utf8"));
assert.equal(recording.records.length, 70);
assert.equal(review.labels.length, 70);
const labels = new Map(review.labels.map((label) => [label.id, label]));
assert.equal(labels.size, 70);
const errors = [];
for (const r of recording.records) {
  const label = labels.get(r.input.id);
  assert.ok(label && typeof label.correct === "boolean" && typeof label.reason === "string");
  assert.equal(
    createHash("sha256").update(r.samples[0].text).digest("hex"),
    label.answerSha256,
    `Review no longer matches ${r.input.id}`,
  );
  errors.push(!label.correct);
}
recording.evaluation.semanticAuroc = auroc(
  errors,
  recording.records.map((r) => r.entropyBits),
);
recording.evaluation.tokenAuroc = auroc(
  errors,
  recording.records.map((r) => -r.samples[0].meanLogProbability),
);
recording.evaluation.answerAccuracy = errors.filter((v) => !v).length / errors.length;
recording.evaluation.answerCorrect = errors.filter((v) => !v).length;
recording.evaluation.review = review.method;
recording.evaluation.reviewedAt = review.reviewedAt;
recording.evaluation.reviewSha256 = createHash("sha256")
  .update(await readFile("data/detector-review.json"))
  .digest("hex");
const chosen = recording.records
  .filter((r) => r.clusters.length >= 2 && r.clusters.length <= 3)
  .sort((a, b) => Math.abs(a.entropyBits - 1) - Math.abs(b.entropyBits - 1))[0];
if (chosen) recording.defaultId = chosen.input.id;
await writeFile("data/detector-recording.json", `${JSON.stringify(recording, null, 2)}\n`);
console.log(JSON.stringify(recording.evaluation, null, 2));
