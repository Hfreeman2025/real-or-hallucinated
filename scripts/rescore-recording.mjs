import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { auroc, claimSupport } from "../src/detector/math.ts";
import { parseDetectorResult } from "../src/detector/validation.ts";

const recording = JSON.parse(await readFile("data/detector-recording.json", "utf8"));
const bank = JSON.parse(await readFile("data/puzzles.json", "utf8"));
const truth = new Map(bank.puzzles.flatMap((p) => p.claims).map((c) => [c.id, c.real]));
for (const record of recording.records) {
  record.support = claimSupport(record.claimRelations);
  record.predictedReal = record.support >= 0.5;
  parseDetectorResult(record);
}
recording.rescore = {
  at: new Date().toISOString(),
  note: "Original browser-sampled text, probabilities and NLI distributions are unchanged. Only the authored claim-score rule was recomputed; entropy remains an uncertainty signal, not a false-claim verdict.",
  source: "src/detector/math.ts",
  sourceSha256: createHash("sha256")
    .update(await readFile("src/detector/math.ts"))
    .digest("hex"),
};
recording.parameters.claimScore =
  "(1 + mean(entailment - contradiction)) / 2; entropy reported separately; threshold 0.5";
const correct = recording.records.filter((r) => r.predictedReal === truth.get(r.input.id)).length;
recording.evaluation.correct = correct;
recording.evaluation.accuracy = correct / 70;
recording.evaluation.claimAuroc = auroc(
  recording.records.map((r) => !truth.get(r.input.id)),
  recording.records.map((r) => 1 - r.support),
);
recording.defaultId = "r-03";
await writeFile("data/detector-recording.json", `${JSON.stringify(recording, null, 2)}\n`);
console.log(recording.evaluation);
