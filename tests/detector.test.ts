import assert from "node:assert/strict";
import test from "node:test";
import {
  auroc,
  claimSupport,
  meaningClusters,
  seededRandom,
  semanticEntropy,
  softmax,
} from "../src/detector/math.ts";
import type { PairEvidence } from "../src/detector/types.ts";

const yes = { entailment: 0.9, contradiction: 0.05, neutral: 0.05 };
const no = { entailment: 0.1, contradiction: 0.8, neutral: 0.1 };
test("semantic entropy uses meanings, not unique wordings", () => {
  assert.equal(semanticEntropy([[0, 1, 2, 3]]), 0);
  assert.equal(
    semanticEntropy([
      [0, 1],
      [2, 3],
    ]),
    1,
  );
  assert.equal(semanticEntropy([[0], [1], [2], [3]]), 2);
  assert.throws(() => semanticEntropy([]));
  assert.throws(() => semanticEntropy([[0], [0]]));
});
test("one-way implication cannot merge meanings; nontransitive links cannot bridge contradictions", () => {
  const pairs: PairEvidence[] = [
    { a: 0, b: 1, forward: yes, backward: yes },
    { a: 1, b: 2, forward: yes, backward: yes },
    { a: 0, b: 2, forward: yes, backward: no },
  ];
  assert.deepEqual(meaningClusters(3, pairs), [[0, 1], [2]]);
  assert.deepEqual(meaningClusters(3, pairs, 0.95), [[0], [1], [2]]);
  assert.deepEqual(meaningClusters(2, pairs.slice(2)), [[0], [1]]);
});
test("AUROC handles ties, reversed scores, and undefined one-class evaluations", () => {
  assert.equal(auroc([false, false, true, true], [0, 1, 2, 3]), 1);
  assert.equal(auroc([false, false, true, true], [3, 2, 1, 0]), 0);
  assert.equal(auroc([false, true], [0.5, 0.5]), 0.5);
  assert.equal(auroc([true], [1]), null);
  assert.throws(() => auroc([true], []));
});
test("probabilities are numerically stable and neutral support does not invent truth", () => {
  assert.deepEqual(softmax([10000, 10000]), [0.5, 0.5]);
  assert.equal(claimSupport([yes, yes]), 0.925);
  assert.equal(claimSupport([{ entailment: 0.05, contradiction: 0.05, neutral: 0.9 }]), 0.5);
});

test("record parsing rejects internally inconsistent entropy and verdicts", async () => {
  const { parseDetectorResult } = await import("../src/detector/validation.ts");
  const samples = Array.from({ length: 5 }, () => ({
    truncated: false,
    text: "Pacific Ocean.",
    tokens: [{ id: 1, text: "Pacific", probability: 0.9 }],
    meanLogProbability: Math.log(0.9),
    milliseconds: 10,
  }));
  const pairs = [];
  for (let a = 0; a < 5; a++)
    for (let b = a + 1; b < 5; b++) pairs.push({ a, b, forward: yes, backward: yes });
  const result = {
    input: { id: "h-12", question: "Which ocean?", claim: "Atlantic.", seed: 1 },
    samples,
    pairs,
    claimRelations: Array(5).fill(yes),
    clusters: [[0, 1, 2, 3, 4]],
    entropyBits: 0,
    normalizedEntropy: 0,
    support: 0.925,
    predictedReal: true,
    threshold: 0.6,
    milliseconds: 100,
    backend: "test",
  };
  assert.equal(parseDetectorResult(result).entropyBits, 0);
  assert.throws(() => parseDetectorResult({ ...result, entropyBits: 2 }), /Inconsistent/);
  assert.throws(() => parseDetectorResult({ ...result, predictedReal: false }), /Inconsistent/);
  assert.throws(
    () =>
      parseDetectorResult({
        ...result,
        samples: samples.map((s) => ({ ...s, meanLogProbability: 0 })),
      }),
    /confidence/,
  );
  assert.throws(
    () =>
      parseDetectorResult({
        ...result,
        samples: samples.map((s) => ({
          ...s,
          tokens: [{ id: -1, text: "Pacific", probability: 0.9 }],
        })),
      }),
    /token/,
  );
  assert.throws(
    () =>
      parseDetectorResult({ ...result, samples: samples.map((s) => ({ ...s, milliseconds: -1 })) }),
    /duration/,
  );
});

test("library metadata probes at main resolve only to the selected immutable model revision", async () => {
  const { pinModelRequest } = await import("../src/detector/model-request.ts");
  const path =
    "http://127.0.0.1:5177/__models/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/tokenizer_config.json";
  assert.equal(
    pinModelRequest(path),
    path.replace("/main/", "/22942cb7d7ba4cc81bb4673549ca4d4614469b5e/"),
  );
  assert.throws(() => pinModelRequest(path.replace("/main/", "/unreviewed/")), /revision/);
});

test("meaning uncertainty does not turn an otherwise supported claim into a false claim", () => {
  assert.equal(claimSupport([yes]), 0.925);
  assert.ok(Math.abs(claimSupport([no]) - 0.15) < 1e-12);
  assert.equal(claimSupport([{ entailment: 0.05, contradiction: 0.05, neutral: 0.9 }]), 0.5);
});

test("sampling seeds reproduce independently mixed streams, including zero", () => {
  const one = seededRandom(1);
  assert.deepEqual(
    Array.from({ length: 3 }, () => one()),
    [0.6270739405881613, 0.002735721180215478, 0.5274470399599522],
  );
  for (const seed of [0, 1, 20261102, 0xffffffff]) {
    const a = seededRandom(seed),
      b = seededRandom(seed);
    for (let i = 0; i < 100; i++) {
      const value = a();
      assert.equal(value, b());
      assert.ok(value >= 0 && value < 1);
    }
  }
  const first = Array.from({ length: 5 }, (_, i) => seededRandom(20261102 + i * 1009)());
  assert.ok(
    Math.max(...first) - Math.min(...first) > 0.9,
    "Nearby sample seeds must not repeat the former correlated first-draw ramp",
  );
});
